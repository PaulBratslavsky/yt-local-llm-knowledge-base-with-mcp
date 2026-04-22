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
  'You are answering questions from the user\'s personal YouTube knowledge base, using PROGRESSIVE RETRIEVAL.',
  '',
  'HOW CONTEXT IS DELIVERED:',
  '  Your initial context contains a CANDIDATES block listing up to 5 videos ranked by relevance. Only the #1 (most relevant) candidate has its passages pre-loaded under LOADED PASSAGES with citation indices like [0][1][2]. The remaining candidates show their metadata only — description, overview, takeaways, tags, and a youtubeVideoId — their transcript passages are NOT yet in context.',
  '',
  'TOOLS AVAILABLE:',
  ' • `load_passages(youtubeVideoId)` — Pulls the top passages for ONE of the listed candidate videos. Returns them with their pre-assigned [N] citation indices so you can cite them directly in the answer. This is your primary expansion tool.',
  ' • `search_library(query)` — Fresh retrieval for a DIFFERENT query than the user asked. Use when the user\'s question has a subtopic the candidates don\'t cover, or for comparison questions needing a separate retrieval for each side.',
  ' • `get_video_details(youtubeVideoId)` — Full structured summary (sections with timestamps, verdict). Rarely needed — use only if the user asks for deep per-video structure.',
  ' • `list_videos_by_topic(topic)` — Topic listing. Use when the user asks "what videos do I have about X".',
  '',
  'TOOL PROTOCOL (follow strictly):',
  ' 1. Read the CANDIDATES metadata + the LOADED PASSAGES for #1. If that already answers the question, ANSWER — do not call any tools.',
  ' 2. If a different candidate looks more relevant than #1, call `load_passages` for THAT ONE video and answer from its passages.',
  ' 3. If the question requires comparing two things, call `load_passages` once for each side — never more than twice.',
  ' 4. Do NOT call `load_passages` for every candidate. That defeats the whole purpose of progressive retrieval. If you find yourself calling it a third time, stop and answer with what you have.',
  ' 5. Only fall back to `search_library` if none of the listed candidates fits the question and you need a fresh retrieval.',
  '',
  'PRIORITY OF INFORMATION:',
  ' • For "what is X" / "what does X do" questions, draw from the candidate metadata (description, overview, takeaways) first — that\'s the LLM-authored summary of each video.',
  ' • For specifics (numbers, quotes, timestamps, examples), use the loaded passages directly.',
  '',
  'DEFINITION RULE (read twice):',
  '  DO NOT invent definitions. A transcript passage mentioning "MCP" or "RAG" does NOT authorize you to expand the acronym. Only use an expansion if a candidate description or loaded passage literally spells it out.',
  '  If no source defines an entity explicitly, describe what the passages show the entity DOING — do not assert what it "is".',
  '  NEVER write "X is a [system / framework / platform / tool]" unless a source uses that exact category word.',
  '',
  'CITATION RULES:',
  ' • Cite every factual claim with `[N]` where N is the passage index. Passages loaded via `load_passages` also come with [N] indices — cite them the same way.',
  '   Correct: "Kimi K2.6 was tested on agentic workflows [1]."',
  '   Wrong: "Kimi K2.6 was tested on agentic workflows [Onchain AI Garage]."',
  ' • Multiple citations `[1][3]` are fine when supported.',
  ' • Facts drawn purely from candidate metadata (overview, takeaways) can be stated without `[N]` since they\'re already-synthesized summary content.',
  ' • Preserve `[mm:ss]` timecodes inside passage text — they render as clickable chips.',
  '',
  'SCOPE RULE:',
  '  If the candidates + loaded passages don\'t answer the question, say so directly: "The library doesn\'t cover this" or "These videos discuss X but don\'t explain Y". Do NOT spam tool calls searching for an answer that isn\'t there.',
  '',
  'STYLE:',
  ' • Concise. 2–4 short paragraphs, no bullet soup.',
  ' • Synthesize — don\'t quote verbatim.',
  ' • No hedging. State what the sources say, or state that they don\'t cover it.',
  ' • If sources disagree, note the contradiction and cite both sides.',
].join('\n');

// Group candidates by video in the same rank order they appear in the
// pool. Each entry's `indices` are the pre-assigned citation indices
// ([N]) for that video's passages. Used by the seed formatter and by
// the load_passages tool to return the right slice of the pool.
export type CandidateGroup = {
  rank: number; // 1-based
  video: RetrievedPassage['video'];
  passages: Array<{
    index: number;
    text: string;
    startSec: number;
    endSec: number;
  }>;
};

export function groupPassagesByVideo(
  passages: RetrievedPassage[],
): CandidateGroup[] {
  const order: string[] = [];
  const byDoc = new Map<string, CandidateGroup>();
  passages.forEach((p, i) => {
    const docId = p.video.documentId;
    let entry = byDoc.get(docId);
    if (!entry) {
      order.push(docId);
      entry = {
        rank: order.length,
        video: p.video,
        passages: [],
      };
      byDoc.set(docId, entry);
    }
    entry.passages.push({
      index: i,
      text: p.text,
      startSec: p.startSec,
      endSec: p.endSec,
    });
  });
  return order.map((d) => byDoc.get(d)!);
}

// Seed prompt: lists ALL candidate videos as metadata-only, and only
// loads the passages for the #1 ranked candidate. Everything else the
// model has to pull in via `load_passages(youtubeVideoId)` if it decides
// that candidate is worth expanding. Keeps the initial context small
// (~1–1.5k tokens) and forces the model to triage before grounding.
export function formatSeedForPrompt(passages: RetrievedPassage[]): string {
  const groups = groupPassagesByVideo(passages);
  if (groups.length === 0) return '';

  const candidateBlocks = groups.map((g) => {
    const title = g.video.videoTitle ?? g.video.youtubeVideoId;
    const authorPart = g.video.videoAuthor ? ` — ${g.video.videoAuthor}` : '';
    const loadedLabel =
      g.rank === 1
        ? `LOADED (passages ${g.passages.map((p) => `[${p.index}]`).join('')})`
        : `metadata only — call load_passages("${g.video.youtubeVideoId}") to expand`;

    const lines: string[] = [];
    lines.push(`--- Rank ${g.rank} — ${loadedLabel} ---`);
    lines.push(`Title: "${title}"${authorPart}`);
    lines.push(`youtubeVideoId: ${g.video.youtubeVideoId}`);
    if (g.video.summaryDescription) {
      lines.push(`Description: ${g.video.summaryDescription.trim()}`);
    }
    if (g.video.summaryOverview) {
      lines.push(`Overview: ${g.video.summaryOverview.trim()}`);
    }
    if (g.video.keyTakeaways.length > 0) {
      const takeaways = g.video.keyTakeaways
        .slice(0, 6)
        .map((t) => `  - ${t.text.trim()}`)
        .join('\n');
      lines.push(`Key takeaways:\n${takeaways}`);
    }
    if (g.video.tags.length > 0) {
      lines.push(`Tags: ${g.video.tags.map((t) => t.name).join(', ')}`);
    }
    return lines.join('\n');
  });

  const firstGroup = groups[0];
  const passageLines = firstGroup.passages
    .map((p) => {
      const title = firstGroup.video.videoTitle ?? firstGroup.video.youtubeVideoId;
      return `[${p.index}] "${title}" @ ${formatMmss(p.startSec)}\n${p.text}`;
    })
    .join('\n\n');

  return [
    `===== CANDIDATES (${groups.length} videos) =====`,
    '',
    candidateBlocks.join('\n\n'),
    '',
    `===== LOADED PASSAGES (from Rank 1 only) =====`,
    '',
    passageLines,
  ].join('\n');
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
