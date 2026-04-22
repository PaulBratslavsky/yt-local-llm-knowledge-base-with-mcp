// Library-wide retrieval + synthesis helpers.
//
// `retrievePassagesForQuery` is the shared core that both /search (listing)
// and /api/ask (synthesis) use. Extracting it out of the server function
// keeps the two paths aligned — any retrieval tuning that helps moment
// search also helps the ask-library answer quality.
//
// The synthesis prompt lives here too so the API route and any future
// MCP tool share the same grounding rules.

import {
  buildBM25Index,
  searchBM25,
  tokenize,
  type TranscriptChunk,
} from './transcript';
import {
  cosineSimilarity,
  embedText,
  passageStatus,
} from './embeddings';
import {
  listAllVideosForEmbeddingService,
  type StrapiVideo,
} from './videos';

// Keep in sync with the constants used in server-functions/videos.ts —
// these control the hybrid retrieval behavior. Duplicated here because
// the server function module has other server-only imports we don't
// want to pull into code paths that might run in different contexts.
const RRF_K = 60;
const BM25_WEIGHT = 2.5;

// Parent-document retrieval config. Instead of letting 15 scattered
// passages across 8+ videos compete for Gemma's attention, we pick the
// top N most-relevant videos by aggregated passage score and pass each
// one's full summary + top-K passages. Gemma then has deep context on
// a focused set of sources — much more accurate synthesis than shallow
// breadth across many.
const MAX_VIDEOS = 5;
const PASSAGES_PER_VIDEO = 3;

export type RetrievedPassage = {
  id: number;
  video: {
    documentId: string;
    youtubeVideoId: string;
    videoTitle: string | null;
    videoAuthor: string | null;
    videoThumbnailUrl: string | null;
    summaryDescription: string | null;
    summaryOverview: string | null;
    keyTakeaways: Array<{ text: string }>;
    tags: Array<{ name: string }>;
  };
  text: string;
  startSec: number;
  endSec: number;
  cosineScore: number;
  rrfScore: number;
};

export async function retrievePassagesForQuery(
  query: string,
  opts: {
    maxVideos?: number;
    passagesPerVideo?: number;
    minScore?: number;
  } = {},
): Promise<RetrievedPassage[]> {
  const maxVideos = opts.maxVideos ?? MAX_VIDEOS;
  const passagesPerVideo = opts.passagesPerVideo ?? PASSAGES_PER_VIDEO;
  const minScore = opts.minScore ?? 0.35;

  const qVec = await embedText(query, 'query');
  const all = await listAllVideosForEmbeddingService();

  // Flatten every current passage into one corpus.
  type Flat = {
    video: StrapiVideo;
    text: string;
    startSec: number;
    endSec: number;
    embedding: number[];
  };
  const flat: Flat[] = [];
  for (const v of all) {
    const index = v.passageEmbeddings;
    if (passageStatus(index) !== 'current' || !index) continue;
    for (const p of index.chunks) {
      flat.push({
        video: v,
        text: p.text,
        startSec: p.startSec,
        endSec: p.endSec,
        embedding: p.embedding,
      });
    }
  }
  if (flat.length === 0) return [];

  // Dense cosine.
  const cosineScores = flat.map((p) => cosineSimilarity(qVec, p.embedding));
  const denseOrder = cosineScores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);

  // BM25 over passage text with parent-video metadata prepended.
  const bm25Chunks: TranscriptChunk[] = flat.map((p, i) => {
    const titleLine = [p.video.videoTitle, p.video.videoAuthor]
      .filter(Boolean)
      .join(' ');
    return {
      id: i,
      text: titleLine ? `${titleLine}\n${p.text}` : p.text,
      startWord: 0,
      timeSec: p.startSec,
    };
  });
  const bm25Index = buildBM25Index(bm25Chunks);
  const bm25Hits = searchBM25(bm25Index, query, flat.length);
  const bm25Order = bm25Hits.map((c) => c.id);

  // RRF merge with BM25 weight.
  const rrf = new Map<number, number>();
  denseOrder.forEach((id, rank) => {
    rrf.set(id, (rrf.get(id) ?? 0) + 1 / (rank + 1 + RRF_K));
  });
  bm25Order.forEach((id, rank) => {
    rrf.set(id, (rrf.get(id) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
  });

  // Step 1: rank passages by RRF (descending) and filter by cosine floor.
  const rankedPassages = Array.from(rrf.entries())
    .map(([i, rrfScore]) => ({
      i,
      rrfScore,
      cosineScore: cosineScores[i],
    }))
    .filter((x) => x.cosineScore >= minScore)
    .sort((a, b) => b.rrfScore - a.rrfScore);

  // Step 2: group by video. Each video's score = its BEST passage's RRF
  // score. This correctly identifies the most topically-relevant videos —
  // a video with one strong match outranks one with several weak matches.
  const perVideo = new Map<
    string,
    {
      video: StrapiVideo;
      bestRrf: number;
      passages: Array<{ i: number; rrfScore: number; cosineScore: number }>;
    }
  >();
  for (const r of rankedPassages) {
    const doc = flat[r.i].video.documentId;
    const entry = perVideo.get(doc);
    if (entry) {
      entry.passages.push(r);
    } else {
      perVideo.set(doc, {
        video: flat[r.i].video,
        bestRrf: r.rrfScore,
        passages: [r],
      });
    }
  }

  // Step 3: pick top-N videos by best-passage RRF. For each, keep their
  // top-M passages. Emit passages in the order videos are ranked, with
  // passages within a video ordered by RRF — the resulting [0], [1], [2]
  // assignment clusters by source, which Gemma reads naturally.
  const topVideos = Array.from(perVideo.values())
    .sort((a, b) => b.bestRrf - a.bestRrf)
    .slice(0, maxVideos);

  const result: RetrievedPassage[] = [];
  let idCounter = 0;
  for (const v of topVideos) {
    const chosen = v.passages.slice(0, passagesPerVideo);
    for (const p of chosen) {
      result.push({
        id: idCounter++,
        video: {
          documentId: flat[p.i].video.documentId,
          youtubeVideoId: flat[p.i].video.youtubeVideoId,
          videoTitle: flat[p.i].video.videoTitle,
          videoAuthor: flat[p.i].video.videoAuthor,
          videoThumbnailUrl: flat[p.i].video.videoThumbnailUrl,
          summaryDescription: flat[p.i].video.summaryDescription,
          summaryOverview: flat[p.i].video.summaryOverview,
          keyTakeaways: (flat[p.i].video.keyTakeaways ?? []).map((t) => ({
            text: t.text,
          })),
          tags: (flat[p.i].video.tags ?? []).map((t) => ({ name: t.name })),
        },
        text: flat[p.i].text,
        startSec: flat[p.i].startSec,
        endSec: flat[p.i].endSec,
        cosineScore: p.cosineScore,
        rrfScore: p.rrfScore,
      });
    }
  }

  return result;
}

// =============================================================================
// Prompts
// =============================================================================

export const ASK_LIBRARY_SYSTEM = [
  'You are answering questions from the user\'s personal YouTube knowledge base.',
  '',
  'INPUT SHAPE:',
  ' 1. "SOURCES" block — for each cited video: title, author, a one-sentence description, an overview paragraph, and bullet takeaways. This is the canonical "what each video is about" information, written by a prior summarization pass. Use it as ground truth.',
  ' 2. "PASSAGES" block — numbered 30–60 second transcript chunks retrieved for the query. Format: `[N] "Video Title" @ mm:ss`. Use these for specific quotes, examples, and timestamps.',
  '',
  'PRIORITY OF INFORMATION (critical):',
  ' • For "what is X" / "what does X do" questions, draw from the SOURCES block first — it contains the LLM-authored summary of what each video covers. Passages are supporting evidence.',
  ' • For specifics (numbers, quotes, timestamps, examples), use the PASSAGES directly.',
  '',
  'DEFINITION RULE (read twice):',
  '  DO NOT invent definitions. A transcript passage mentioning "MCP" or "RAG" does NOT authorize you to expand the acronym. Only use an expansion if a SOURCE or PASSAGE literally spells it out.',
  '  If no source defines an entity explicitly, describe what the passages show the entity DOING — do not assert what it "is".',
  '  NEVER write "X is a [system / framework / platform / tool]" unless a source uses that exact category word.',
  '',
  'CITATION RULES:',
  ' • Cite every factual claim with `[N]` referring to the PASSAGE index number. Not the video title. Not the channel name.',
  '   Correct: "Kimi K2.6 was tested on agentic workflows [1]."',
  '   Wrong: "Kimi K2.6 was tested on agentic workflows [Onchain AI Garage]."',
  ' • Multiple citations `[1][3]` are fine when supported.',
  ' • Facts drawn purely from the SOURCES block (overview, takeaways) can be stated without `[N]` since they represent already-synthesized summary content.',
  ' • Preserve `[mm:ss]` timecodes inside passage text — they render as clickable chips.',
  '',
  'SCOPE RULE:',
  '  If sources + passages don\'t answer the question, say so directly: "The library doesn\'t cover this" or "These videos discuss X but don\'t explain Y".',
  '',
  'STYLE:',
  ' • Concise. 2–4 short paragraphs, no bullet soup.',
  ' • Synthesize — don\'t quote verbatim.',
  ' • No hedging. State what the sources say, or state that they don\'t cover it.',
  ' • If sources disagree, note the contradiction and cite both sides.',
].join('\n');

// Parent-document retrieval: in addition to the fine-grained retrieved
// passages, include the video-level summary (description + overview +
// key takeaways) for each unique cited video. The summary was authored
// by the LLM during video ingestion specifically to capture "what this
// video is about" — it's much richer grounding than scraping definitions
// out of transcript chunks (which often are show-opens or outros for
// "what is X" queries, where the speaker assumes audience context).
//
// Budget: each video summary ≈ 300–600 words. With typical 4–6 unique
// cited videos per query, that's ~2–3k words of summary context, plus
// 15 × ~150 words of passage text ≈ 2k words, total ≈ 5k words ≈ 6k
// tokens. Well within most Ollama models' context window.
export function formatPassagesForPrompt(passages: RetrievedPassage[]): string {
  // Deduplicate videos — multiple passages often come from the same
  // video, no need to repeat its summary.
  const seen = new Set<string>();
  const sourceBlocks: string[] = [];
  for (const p of passages) {
    if (seen.has(p.video.documentId)) continue;
    seen.add(p.video.documentId);

    const lines: string[] = [];
    const title = p.video.videoTitle ?? p.video.youtubeVideoId;
    const authorPart = p.video.videoAuthor ? ` — ${p.video.videoAuthor}` : '';
    lines.push(`### "${title}"${authorPart}`);

    if (p.video.summaryDescription) {
      lines.push(`Description: ${p.video.summaryDescription.trim()}`);
    }
    if (p.video.summaryOverview) {
      lines.push(`Overview:\n${p.video.summaryOverview.trim()}`);
    }
    if (p.video.keyTakeaways.length > 0) {
      const takeaways = p.video.keyTakeaways
        .slice(0, 6)
        .map((t) => `  - ${t.text.trim()}`)
        .join('\n');
      lines.push(`Key takeaways:\n${takeaways}`);
    }
    if (p.video.tags.length > 0) {
      lines.push(`Tags: ${p.video.tags.map((t) => t.name).join(', ')}`);
    }

    sourceBlocks.push(lines.join('\n'));
  }

  const sourcesSection = sourceBlocks.length > 0
    ? `===== SOURCES (canonical summaries of the cited videos) =====\n\n${sourceBlocks.join('\n\n')}\n\n`
    : '';

  const passageBlock = passages
    .map((p, i) => {
      const title = p.video.videoTitle ?? p.video.youtubeVideoId;
      const start = formatMmss(p.startSec);
      return `[${i}] "${title}" @ ${start}\n${p.text}`;
    })
    .join('\n\n');

  return `${sourcesSection}===== PASSAGES (retrieved transcript chunks) =====\n\n${passageBlock}`;
}

function formatMmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}:${String(rest).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

// `tokenize` re-export — used by clients that want to extract tokens
// without pulling transcript.ts directly.
export { tokenize };
