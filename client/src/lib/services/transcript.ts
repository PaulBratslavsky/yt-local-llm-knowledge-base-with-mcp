// Transcript utilities used by the summary + chat pipelines.
//
// Cleaning, retrieval chunking, BM25 and timecode grounding come from
// ./bm25-core — a generated copy of strapi-plugin-yt-kb's source — and are
// re-exported below so every caller keeps importing from './transcript'.
// This module adds what only the app needs: timecode annotation for
// prompts, summary-sized chunks, multi-query fusion, passage chunks for
// embeddings, citation verification and the section contextualizer for
// Contextual Retrieval.

export {
  CURRENT_INDEX_PARAMS,
  STOPWORDS,
  STORED_INDEX_VERSION,
  TOKENIZER_VERSION,
  buildBM25Index,
  buildTranscriptSearchIndex,
  chunkForRetrieval,
  cleanTranscript,
  findEvidenceForQuote,
  groundSectionsToTranscript,
  isStoredIndex,
  loadStoredIndex,
  makeStoredIndex,
  prepareSegmentedTranscript,
  searchBM25,
  searchBM25Ranked,
  storedIndexStatus,
  tokenize,
} from './bm25-core';
export type {
  BM25Index,
  ScorableDoc,
  BM25IndexParams,
  Contextualizer,
  GroundableSection,
  GroundedSection,
  PreparedTranscript,
  RankedChunk,
  StoredIndexStatus,
  StoredTranscriptIndex,
  TimedTextSegment,
  TranscriptChunk,
  TranscriptEvidence,
} from './bm25-core';

import {
  annotateSpan,
  chunkBy,
  findEvidenceForQuote,
  formatMmss,
  searchBM25,
  type BM25Index,
  type Contextualizer,
  type PreparedTranscript,
  type TimedTextSegment,
  type TranscriptChunk,
} from './bm25-core';

// Full-transcript annotation for the single-pass summary prompt. Default
// `minGapSec=30` → roughly one time anchor per 30s of video. Sections the
// model generates can point at these real anchors instead of estimating.
export function annotateWithTimecodes(
  prepared: PreparedTranscript,
  minGapSec = 30,
): string {
  const words = prepared.cleanedText.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return annotateSpan(words, prepared.wordStartMs, 0, words.length, minGapSec);
}

// Retrieval and summarization want different chunk sizes. Retrieval (BM25)
// is best with small windows so term frequency stays informative and the
// top-k ranking is precise. Map-reduce summarization wants larger windows
// so each partial summary has enough context to produce coherent bullets
// without fragmenting the narrative across chunk boundaries. Industry
// guidance: 150–300 tokens for retrieval, 1,500–3,000 tokens for summary.

// Summary chunks tuned for throughput on local 8B. Larger windows (~3,300
// tokens) mean fewer chunks → fewer orchestration round-trips for the same
// total tokens processed. Overlap dropped to ~2% — industry guidance says
// 10-20% but for summarization the model easily handles sharp boundaries,
// and lower overlap = less duplicate inference.
const SUMMARY_CHUNK_WORDS = 2500;
const SUMMARY_CHUNK_OVERLAP = 50;

// Large windows for map-reduce summarization.
export function chunkForSummary(
  input: string | PreparedTranscript,
  durationSec?: number | null,
): TranscriptChunk[] {
  return chunkBy(input, SUMMARY_CHUNK_WORDS, SUMMARY_CHUNK_OVERLAP, durationSec);
}

// Reciprocal Rank Fusion constant. 60 is the canonical value from Cormack
// et al. (2009) — dampens the contribution of very-top ranks so no single
// query can dominate the fused list, while still keeping near-top hits
// meaningful.
const RRF_K = 60;

// Run BM25 once per query and fuse the rankings via reciprocal rank fusion.
// Used for query rewriting — the model expands the user question into
// several phrasings, each retrieves its own top-N, then we blend them so
// chunks that match multiple phrasings rise to the top. Handles score-scale
// differences across queries cleanly, since RRF is rank-based not
// score-based.
export function searchBM25MultiQuery(
  index: BM25Index,
  queries: string[],
  topK: number,
): TranscriptChunk[] {
  const nonEmpty = queries.map((q) => q.trim()).filter((q) => q.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return searchBM25(index, nonEmpty[0], topK);

  // Retrieve a wider pool per query than we return — gives RRF enough
  // ranks from each phrasing to find consensus.
  const pool = Math.max(topK * 3, 30);
  const fused = new Map<number, { chunk: TranscriptChunk; score: number }>();
  for (const q of nonEmpty) {
    const ranked = searchBM25(index, q, pool);
    ranked.forEach((chunk, rank) => {
      const contribution = 1 / (RRF_K + rank + 1);
      const entry = fused.get(chunk.id);
      if (entry) entry.score += contribution;
      else fused.set(chunk.id, { chunk, score: contribution });
    });
  }
  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((e) => e.chunk);
}

// Rough token count — 1 token ≈ 4 chars for English. Good enough for the
// "should we map-reduce?" decision without pulling in a tokenizer.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// -----------------------------------------------------------------------------
// Passage chunker — fine-grained, time-based chunks for moment search.
// Adapted from the strapi-plugin-ai-sdk-yt-embeddings `yt-chunker`. Groups
// caption segments into ~60-second windows that respect natural pauses
// (>1s gap between segments) and sentence boundaries; hard cap 90s, min 15s
// so we don't emit micro-chunks for dense intros.
//
// Each output chunk carries real startSec/endSec derived from segment
// timestamps (not wpm estimates), so a "jump to this moment" UI can seek
// the player to the exact span that matched a query.
//
// Decoupled from `chunkForSummary` on purpose: summary chunks are huge
// (~2500 words, tuned for map-reduce LLM calls); passage chunks are small
// (~150 words, tuned for retrieval granularity). Different jobs.
// -----------------------------------------------------------------------------

export type PassageChunk = {
  text: string;
  startSec: number;
  endSec: number;
  chunkIndex: number;
};

const PASSAGE_TARGET_MS = 60_000;
const PASSAGE_MAX_MS = 90_000;
const PASSAGE_MIN_MS = 15_000;
const PASSAGE_PAUSE_MS = 1_000;

export function chunkForPassages(segments: TimedTextSegment[]): PassageChunk[] {
  if (segments.length === 0) return [];

  // Normalize: fill endMs where missing by using the next segment's start,
  // or a +2s fallback for the trailing segment. The chunker decides
  // boundaries off endMs, so it needs to be defined everywhere.
  const normalized: Array<{ text: string; startMs: number; endMs: number }> = [];
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    const next = segments[i + 1];
    let end = s.endMs;
    if (end === undefined || end <= s.startMs) {
      end = next ? next.startMs : s.startMs + 2000;
    }
    normalized.push({ text: s.text, startMs: s.startMs, endMs: end });
  }

  const chunks: PassageChunk[] = [];
  let buffer: typeof normalized = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const text = buffer
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Skip vacuous chunks (e.g. a single "[Music]" segment).
    if (text.length < 20) {
      buffer = [];
      return;
    }
    chunks.push({
      text,
      startSec: buffer[0].startMs / 1000,
      endSec: buffer[buffer.length - 1].endMs / 1000,
      chunkIndex: chunks.length,
    });
    buffer = [];
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const seg = normalized[i];
    const next = normalized[i + 1];
    buffer.push(seg);

    const bufferMs = buffer[buffer.length - 1].endMs - buffer[0].startMs;
    const isLast = !next;
    const atHardCap = bufferMs >= PASSAGE_MAX_MS;
    const atTarget = bufferMs >= PASSAGE_TARGET_MS;
    const pauseAfter = next ? next.startMs - seg.endMs : Infinity;
    const isNaturalPause = pauseAfter > PASSAGE_PAUSE_MS;
    const endsSentence = /[.!?]\s*$/.test(seg.text.trim());

    const shouldFlush =
      isLast ||
      atHardCap ||
      (atTarget && (isNaturalPause || endsSentence));

    if (shouldFlush && (bufferMs >= PASSAGE_MIN_MS || isLast)) {
      flushBuffer();
    }
  }

  // Any residue (if the last segment didn't trigger flush).
  if (buffer.length > 0) flushBuffer();

  return chunks;
}

// -----------------------------------------------------------------------------
// Section-based contextualizer for Contextual Retrieval.
//
// The AI summary pipeline already produces timestamped `sections[]` — each
// one a paraphrased heading + body describing a narrative beat of the video.
// Those are semantically rich anchors the original transcript doesn't have.
// For every retrieval chunk we prepend the nearest section's heading and a
// clipped slice of its body; BM25 indexes that blended string. Result: a
// query like "is the author optimistic?" can now match "Optimistic outlook
// on the industry" in a section heading even when the transcript word never
// appears, because the chunk's indexed text contains the paraphrase.
// -----------------------------------------------------------------------------

type SectionAnchor = { timeSec: number; heading: string; body: string };

// Trim the section body snippet fed into BM25 — a few hundred chars is
// enough to carry the paraphrased semantics; more just dilutes the signal.
const SECTION_BODY_CLIP_CHARS = 240;

function findNearestSection(
  timeSec: number,
  sections: SectionAnchor[],
): SectionAnchor | null {
  if (sections.length === 0) return null;
  // Sections generated by the AI sometimes lack a timeSec — fall back to
  // array order. For ones that have timestamps, pick the section whose
  // start is the greatest timeSec ≤ chunk.timeSec.
  const withTime = sections.filter((s) => typeof s.timeSec === 'number');
  if (withTime.length === 0) {
    // No timed sections — use sections in order, one per ~N chunks.
    // Cheap heuristic: use the first section as the anchor for everything.
    return sections[0];
  }
  let best: SectionAnchor | null = null;
  for (const s of withTime) {
    if (s.timeSec <= timeSec) {
      if (!best || s.timeSec > best.timeSec) best = s;
    }
  }
  // If the chunk starts before any section (rare — first few seconds), use
  // the earliest section as the anchor.
  return best ?? withTime[0];
}

// Parse a `mm:ss`, `h:mm:ss`, or bare-seconds string into seconds.
// Mirrors parseTcToSeconds in TimecodeMarkdown — kept here to avoid a
// dependency from services → components.
function parseTcStringToSeconds(tc: string): number {
  const parts = tc.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

// (formatMmss comes from ./bm25-core.)

// Scan a text for model-emitted `[mm:ss]` / `(mm:ss)` / bare mm:ss citations.
// For each, extract the surrounding context (~±200 chars) and verify the
// cited timecode matches where that content actually lives in the transcript.
// If the best chunk is >`toleranceSec` from the cited value AND the match
// confidence clears `minScore`, swap the citation for the correct one.
// Preserves wrapper style (brackets / parens / bare).
export function verifyTimecodesInText(
  text: string,
  index: BM25Index,
  opts: { toleranceSec?: number; minScore?: number } = {},
): {
  text: string;
  overrides: Array<{ from: string; to: string; context: string }>;
} {
  const tolerance = opts.toleranceSec ?? 30;
  const minScore = opts.minScore ?? 1.5;
  const overrides: Array<{ from: string; to: string; context: string }> = [];

  // Same three-alternative pattern as TimecodeMarkdown. Matches preserved
  // so we can swap only the number while keeping punctuation intact.
  const pattern = new RegExp(
    [
      '\\[(\\d{1,2}:\\d{2}(?::\\d{2})?)\\]',
      '\\((\\d{1,2}:\\d{2}(?::\\d{2})?)\\)',
      '\\b(\\d{1,2}:\\d{2}(?::\\d{2})?)\\b',
    ].join('|'),
    'g',
  );

  const corrected = text.replace(pattern, (match, bracketed, parens, bare, offset: number) => {
    const tc: string | undefined = bracketed ?? parens ?? bare;
    if (!tc) return match;
    const cited = parseTcStringToSeconds(tc);

    // Context window: ~200 chars before and after the citation, enough to
    // BM25-score reliably without running over neighboring sections.
    const before = text.slice(Math.max(0, offset - 200), offset);
    const after = text.slice(offset + match.length, offset + match.length + 200);
    const context = `${before} ${after}`.replace(/\s+/g, ' ').trim();
    if (context.length < 20) return match; // not enough content to verify

    const hit = findEvidenceForQuote(context, index, minScore);
    if (!hit) return match;

    if (Math.abs(hit.timeSec - cited) <= tolerance) return match;

    const newTc = formatMmss(hit.timeSec);
    overrides.push({ from: tc, to: newTc, context: context.slice(0, 80) });

    if (bracketed) return `[${newTc}]`;
    if (parens) return `(${newTc})`;
    return newTc;
  });

  return { text: corrected, overrides };
}

// Extract every timecode citation in a text along with the transcript chunk
// that grounds it — the data shape the chat UI accordion needs. For each
// citation we return:
//   - the citation as the model wrote it (timecode + wrapper style)
//   - the surrounding claim (≈200 chars context)
//   - the real transcript snippet that best matches that context
//   - drift flag (whether the cited timecode is far from the grounded one)
//
// The UI renders these below the chat response as expandable evidence
// panels: user sees what the model cited, can click to expand the actual
// transcript text, and can instantly spot drift.
export type EvidenceCitation = {
  /** The timecode as the model wrote it (e.g. "20:19"). */
  citedTimecode: string;
  /** Seconds value of the cited timecode. */
  citedTimeSec: number;
  /** The claim in the response text surrounding this citation. */
  claim: string;
  /** Best-matching transcript chunk's start time (seconds). Null if no match. */
  groundedTimeSec: number | null;
  /** The transcript chunk text we matched against. Null if no match. */
  groundedSnippet: string | null;
  /** BM25 relevance score. Null when no match. */
  score: number | null;
  /** True when citedTimeSec differs from groundedTimeSec by > toleranceSec. */
  drift: boolean;
};

export function extractCitationsWithEvidence(
  text: string,
  index: BM25Index,
  opts: { toleranceSec?: number; minScore?: number } = {},
): EvidenceCitation[] {
  const tolerance = opts.toleranceSec ?? 30;
  const minScore = opts.minScore ?? 1.0;
  const out: EvidenceCitation[] = [];
  const seen = new Set<string>(); // dedupe same citation used twice

  const pattern = new RegExp(
    [
      '\\[(\\d{1,2}:\\d{2}(?::\\d{2})?)\\]',
      '\\((\\d{1,2}:\\d{2}(?::\\d{2})?)\\)',
      '\\b(\\d{1,2}:\\d{2}(?::\\d{2})?)\\b',
    ].join('|'),
    'g',
  );

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const tc = match[1] ?? match[2] ?? match[3];
    if (!tc) continue;
    const citedTimeSec = parseTcStringToSeconds(tc);
    const offset = match.index;

    // Dedupe when the same timecode is referenced multiple places — first
    // occurrence wins for UI cleanliness.
    if (seen.has(tc)) continue;
    seen.add(tc);

    const before = text.slice(Math.max(0, offset - 200), offset);
    const after = text.slice(offset + match[0].length, offset + match[0].length + 200);
    const claim = `${before}${match[0]}${after}`.replace(/\s+/g, ' ').trim();
    const queryContext = `${before} ${after}`.replace(/\s+/g, ' ').trim();

    const evidence = queryContext.length >= 20
      ? findEvidenceForQuote(queryContext, index, minScore)
      : null;

    out.push({
      citedTimecode: tc,
      citedTimeSec,
      claim: claim.slice(0, 300),
      groundedTimeSec: evidence?.timeSec ?? null,
      groundedSnippet: evidence?.snippet ?? null,
      score: evidence?.score ?? null,
      drift: evidence
        ? Math.abs(evidence.timeSec - citedTimeSec) > tolerance
        : false,
    });
  }

  // Dedupe by grounded timeSec — two model citations that resolve to the
  // same moment in the transcript (within GROUND_DEDUPE_TOLERANCE seconds)
  // are effectively the same evidence and shouldn't be shown as separate
  // rows. E.g. model cites both [13:18] and [10:50] but BM25 resolves
  // [13:18] → 10:52; they're both pointing at ~10:50 in the actual video.
  // Keep the citation with the smallest drift (cited ≈ grounded = more
  // accurate original), drop the other.
  const GROUND_DEDUPE_TOLERANCE = 15;
  const merged: EvidenceCitation[] = [];
  for (const cite of out) {
    if (cite.groundedTimeSec === null) {
      merged.push(cite);
      continue;
    }
    const existingIdx = merged.findIndex(
      (m) =>
        m.groundedTimeSec !== null &&
        Math.abs(m.groundedTimeSec - (cite.groundedTimeSec as number)) <=
          GROUND_DEDUPE_TOLERANCE,
    );
    if (existingIdx === -1) {
      merged.push(cite);
      continue;
    }
    const existing = merged[existingIdx];
    const existingDrift = Math.abs(
      existing.citedTimeSec - (existing.groundedTimeSec as number),
    );
    const newDrift = Math.abs(
      cite.citedTimeSec - (cite.groundedTimeSec as number),
    );
    if (newDrift < existingDrift) {
      merged[existingIdx] = cite;
    }
    // else keep existing — it's the less-drifted original
  }

  return merged;
}

export function makeSectionContextualizer(
  sections: SectionAnchor[],
): Contextualizer {
  return (chunk) => {
    const anchor = findNearestSection(chunk.timeSec, sections);
    if (!anchor) return chunk.text;
    const clipped = anchor.body.length > SECTION_BODY_CLIP_CHARS
      ? `${anchor.body.slice(0, SECTION_BODY_CLIP_CHARS)}…`
      : anchor.body;
    // Prepend context as natural sentences so BM25 tokenizes it cleanly.
    return `Section: ${anchor.heading}. Context: ${clipped}. Transcript: ${chunk.text}`;
  };
}
