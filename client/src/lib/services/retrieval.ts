// Hybrid retrieval: the ranking policy behind Related videos, semantic
// feed search, moment search and /api/ask.
//
// This used to live inside `createServerFn().handler()` bodies in
// data/server-functions/videos.ts — four pipelines, ~500 lines, with the
// tuning constants (RRF_K, BM25_WEIGHT, the tag and title boosts, the
// per-video cap) declared inline where no test could reach them. The same
// RRF merge loop was written out four times, and `ask-library.ts`
// reimplemented the whole passage pipeline with a comment asking the next
// reader to keep two sets of constants in sync by hand.
//
// Everything here takes an already-fetched corpus and returns rankings.
// Fetching, embedding and response shaping stay in the server functions.

import { buildBM25Index, searchBM25, tokenize, type ScorableDoc } from './transcript';
import { cosineSimilarity, passageStatus } from './embeddings';
import type { StrapiVideo } from './videos';

// =============================================================================
// Tuning constants. Exported so they are testable and so there is exactly
// one place to change ranking behaviour.
// =============================================================================

/** Reciprocal Rank Fusion constant — Cormack et al. (2009). Dampens the
 *  contribution of very-top ranks so no single retriever dominates. */
export const RRF_K = 60;

/** BM25's weight relative to dense in the fusion. Above 1 because exact
 *  token matches on proper nouns ("MCP", "Qwen") are a stronger relevance
 *  signal than embedding similarity for this corpus. */
export const BM25_WEIGHT = 2.5;

/** Per shared tag, added to a candidate's fused score. Tags are
 *  user-curated, so this is the strongest relatedness signal available —
 *  calibrated against a typical RRF top score of ~0.05. */
export const TAG_BOOST_PER_TAG = 0.06;

/** Per shared title token. Softer, secondary: catches related videos that
 *  nobody has tagged yet. */
export const TITLE_BOOST_PER_TOKEN = 0.015;

/** Title tokens below this IDF are too common to indicate relatedness. */
export const TITLE_TOKEN_MIN_IDF = 1.5;

/** Doc-as-query expands to hundreds of tokens that dilute BM25 into noise;
 *  keep only the most distinctive ones. */
export const RELATED_MAX_QUERY_TERMS = 15;

/** Max passages from one video in a moment-search result. Without it, long
 *  videos saturate the top with consecutive chunks on the same point. */
export const PER_VIDEO_CAP = 2;

// =============================================================================
// Primitives
// =============================================================================

export type Ranking = {
  /** Document indices, best first. */
  order: number[];
  /** Defaults to 1. */
  weight?: number;
};

/** Reciprocal Rank Fusion over any number of rankings.
 *
 *  A document appearing in only one ranking still scores (partial credit);
 *  one strong in both wins comfortably. Replaces four hand-written copies
 *  of this loop. */
export function fuseRRF(rankings: Ranking[]): Map<number, number> {
  const fused = new Map<number, number>();
  for (const { order, weight = 1 } of rankings) {
    order.forEach((id, rank) => {
      fused.set(id, (fused.get(id) ?? 0) + weight / (rank + 1 + RRF_K));
    });
  }
  return fused;
}

/** Cosine scores (index-aligned to `vectors`) plus the order they imply. */
export function cosineRanking(
  vectors: number[][],
  query: number[],
): { scores: number[]; order: number[] } {
  const scores = vectors.map((v) => cosineSimilarity(query, v));
  const order = scores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);
  return { scores, order };
}

/** BM25 order over an arbitrary document set. `id` is the caller's join key. */
export function bm25Ranking(
  docs: ScorableDoc[],
  query: string,
  opts?: { maxQueryTerms?: number },
): { order: number[]; index: ReturnType<typeof buildBM25Index<ScorableDoc>> } {
  const index = buildBM25Index(docs);
  const hits = searchBM25(index, query, docs.length, opts);
  return { order: hits.map((d) => d.id), index };
}

/** Fused scores as a sorted list, carrying the dense score for display and
 *  for the minScore gate (RRF drives order; cosine stays the user-facing
 *  "% match"). */
export function rankedByFusion(
  fused: Map<number, number>,
  cosineScores: number[],
): Array<{ index: number; rrfScore: number; cosineScore: number }> {
  return Array.from(fused.entries())
    .map(([index, rrfScore]) => ({
      index,
      rrfScore,
      cosineScore: cosineScores[index] ?? 0,
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

/** Keep at most `cap` entries per group, in rank order. */
export function capPerVideo<T>(
  ranked: T[],
  groupOf: (item: T) => string,
  cap: number = PER_VIDEO_CAP,
): T[] {
  const seen = new Map<string, number>();
  return ranked.filter((item) => {
    const key = groupOf(item);
    const count = seen.get(key) ?? 0;
    if (count >= cap) return false;
    seen.set(key, count + 1);
    return true;
  });
}

// =============================================================================
// Related videos — the two explicit boosts on top of cosine + BM25.
// =============================================================================

export type BoostInputs = {
  targetTags: Set<string>;
  targetTitleTokens: Set<string>;
  /** Per candidate, its tag slugs. Index-aligned with the corpus. */
  candidateTags: string[][];
  /** Per candidate, its title tokens. Index-aligned with the corpus. */
  candidateTitleTokens: Array<Set<string>>;
};

export type BoostReport = {
  tagBoosts: Map<number, { count: number; tags: string[] }>;
  titleBoosts: Map<number, { count: number; tokens: string[] }>;
};

/** Mutates `fused` in place, adding tag- and title-overlap boosts, and
 *  reports what it applied so the caller can log it. */
export function applyTagAndTitleBoosts(
  fused: Map<number, number>,
  inputs: BoostInputs,
): BoostReport {
  const tagBoosts = new Map<number, { count: number; tags: string[] }>();
  const titleBoosts = new Map<number, { count: number; tokens: string[] }>();

  if (inputs.targetTags.size > 0) {
    inputs.candidateTags.forEach((tags, i) => {
      const matched = tags.filter((slug) => inputs.targetTags.has(slug));
      if (matched.length === 0) return;
      fused.set(i, (fused.get(i) ?? 0) + matched.length * TAG_BOOST_PER_TAG);
      tagBoosts.set(i, { count: matched.length, tags: matched });
    });
  }

  if (inputs.targetTitleTokens.size > 0) {
    inputs.candidateTitleTokens.forEach((tokens, i) => {
      const matched = Array.from(inputs.targetTitleTokens).filter((t) =>
        tokens.has(t),
      );
      if (matched.length === 0) return;
      fused.set(i, (fused.get(i) ?? 0) + matched.length * TITLE_BOOST_PER_TOKEN);
      titleBoosts.set(i, { count: matched.length, tokens: matched });
    });
  }

  return { tagBoosts, titleBoosts };
}

/** Title tokens distinctive enough to indicate relatedness. */
export function distinctiveTitleTokens(
  title: string | null | undefined,
  idf: Record<string, number>,
): Set<string> {
  return new Set(
    tokenize(title ?? '').filter((t) => {
      const score = idf[t];
      return score !== undefined && score >= TITLE_TOKEN_MIN_IDF;
    }),
  );
}

// =============================================================================
// Passage corpus — shared by moment search (/search) and /api/ask, which
// previously had two copies of this flatten-and-rank pipeline.
// =============================================================================

export type FlatPassage = {
  video: StrapiVideo;
  text: string;
  startSec: number;
  endSec: number;
  embedding: number[];
};

/** Every current passage across the corpus, with a stable global index —
 *  the join key the fusion uses. Videos whose passage index is stale or
 *  missing are skipped. */
export function flattenPassages(videos: StrapiVideo[]): FlatPassage[] {
  const flat: FlatPassage[] = [];
  for (const video of videos) {
    const index = video.passageEmbeddings;
    if (passageStatus(index) !== 'current' || !index) continue;
    for (const p of index.chunks) {
      flat.push({
        video,
        text: p.text,
        startSec: p.startSec,
        endSec: p.endSec,
        embedding: p.embedding,
      });
    }
  }
  return flat;
}

/** BM25 text for a passage: the parent video's title and author, then the
 *  passage itself.
 *
 *  Proper nouns like "Qwen" or "Kimi" often appear only in the video title —
 *  auto-captions transcribe them phonetically wrong ("Quinn", "keemi") or
 *  the speaker shows them on screen without saying them. Without the title
 *  line, searching "qwen" matches zero passages in the Qwen video itself. */
function passageBm25Text(p: FlatPassage): string {
  const titleLine = [p.video.videoTitle, p.video.videoAuthor]
    .filter(Boolean)
    .join(' ');
  return titleLine ? `${titleLine}\n${p.text}` : p.text;
}

export type RankedPassage = {
  index: number;
  rrfScore: number;
  cosineScore: number;
};

export type PassageRanking = {
  ranked: RankedPassage[];
  cosineScores: number[];
  denseOrder: number[];
  bm25Order: number[];
};

/** Dense + BM25 over the flattened passages, fused. Order only — the caller
 *  applies its own minScore gate, grouping and shaping. */
export function rankPassages(
  flat: FlatPassage[],
  queryVector: number[],
  query: string,
): PassageRanking {
  const { scores: cosineScores, order: denseOrder } = cosineRanking(
    flat.map((p) => p.embedding),
    queryVector,
  );
  const { order: bm25Order } = bm25Ranking(
    flat.map((p, i) => ({ id: i, text: passageBm25Text(p) })),
    query,
  );
  const fused = fuseRRF([
    { order: denseOrder },
    { order: bm25Order, weight: BM25_WEIGHT },
  ]);
  return {
    ranked: rankedByFusion(fused, cosineScores),
    cosineScores,
    denseOrder,
    bm25Order,
  };
}

// =============================================================================
// Video corpus — shared by semantic feed search and related videos.
// =============================================================================

/** The topical surface of a video: the same bag of fields the embedding
 *  sees, used as the BM25 document (and as the doc-as-query for related).
 *
 *  Deliberately *not* `buildEmbeddingText` from embeddings.ts, despite the
 *  overlap: that one is versioned by EMBEDDING_VERSION because changing it
 *  invalidates stored vectors, while this one only affects live BM25
 *  scoring. Kept byte-equivalent to the version that lived in
 *  server-functions/videos.ts so this extraction doesn't move rankings. */
export function buildVideoSearchText(v: StrapiVideo): string {
  const parts: string[] = [];
  if (v.videoTitle) parts.push(v.videoTitle);
  if (v.videoAuthor) parts.push(v.videoAuthor);
  if (v.summaryTitle && v.summaryTitle !== v.videoTitle) {
    parts.push(v.summaryTitle);
  }
  if (v.summaryDescription) parts.push(v.summaryDescription);
  if (v.summaryOverview) parts.push(v.summaryOverview);
  if (v.keyTakeaways && v.keyTakeaways.length > 0) {
    parts.push(v.keyTakeaways.map((t) => t.text).join(' '));
  }
  if (v.sections && v.sections.length > 0) {
    parts.push(v.sections.map((s) => s.heading).join(' '));
  }
  if (v.tags && v.tags.length > 0) {
    parts.push(v.tags.map((t) => t.name).join(' '));
  }
  return parts.join(' ');
}

export type RankedVideo = {
  index: number;
  rrfScore: number;
  cosineScore: number;
};

export type VideoRanking = {
  ranked: RankedVideo[];
  cosineScores: number[];
  denseOrder: number[];
  bm25Order: number[];
};

/** Query-seeded hybrid ranking over a video corpus (semantic feed search). */
export function rankVideosByQuery(
  candidates: StrapiVideo[],
  queryVector: number[],
  query: string,
): VideoRanking {
  const { scores: cosineScores, order: denseOrder } = cosineRanking(
    candidates.map((v) => v.summaryEmbedding as number[]),
    queryVector,
  );
  const { order: bm25Order } = bm25Ranking(
    candidates.map((v, i) => ({ id: i, text: buildVideoSearchText(v) })),
    query,
  );
  const fused = fuseRRF([
    { order: denseOrder },
    { order: bm25Order, weight: BM25_WEIGHT },
  ]);
  return {
    ranked: rankedByFusion(fused, cosineScores),
    cosineScores,
    denseOrder,
    bm25Order,
  };
}

export type RelatedRanking = VideoRanking &
  BoostReport & {
    targetTags: Set<string>;
    targetTitleTokens: Set<string>;
  };

/** Video-seeded hybrid ranking (Related videos): the target's own topical
 *  text is the BM25 query, then tag- and title-overlap boosts on top. */
export function rankRelatedVideos(
  target: StrapiVideo,
  candidates: StrapiVideo[],
  targetVector: number[],
): RelatedRanking {
  const { scores: cosineScores, order: denseOrder } = cosineRanking(
    candidates.map((v) => v.summaryEmbedding as number[]),
    targetVector,
  );

  const { order: bm25Order, index } = bm25Ranking(
    candidates.map((v, i) => ({ id: i, text: buildVideoSearchText(v) })),
    buildVideoSearchText(target),
    { maxQueryTerms: RELATED_MAX_QUERY_TERMS },
  );

  const fused = fuseRRF([
    { order: denseOrder },
    { order: bm25Order, weight: BM25_WEIGHT },
  ]);

  const targetTags = new Set((target.tags ?? []).map((t) => t.slug));
  const targetTitleTokens = distinctiveTitleTokens(target.videoTitle, index.idf);

  const boosts = applyTagAndTitleBoosts(fused, {
    targetTags,
    targetTitleTokens,
    candidateTags: candidates.map((v) => (v.tags ?? []).map((t) => t.slug)),
    candidateTitleTokens: candidates.map(
      (v) => new Set(tokenize(v.videoTitle ?? '')),
    ),
  });

  return {
    ranked: rankedByFusion(fused, cosineScores),
    cosineScores,
    denseOrder,
    bm25Order,
    targetTags,
    targetTitleTokens,
    ...boosts,
  };
}
