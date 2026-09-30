import { describe, expect, it } from 'vitest';
import {
  buildBM25Index,
  searchBM25,
  tokenize,
  type TranscriptChunk,
} from './transcript';
import { cosineSimilarity } from './embeddings';
import type { StrapiVideo } from './videos';
import {
  buildVideoSearchText,
  rankRelatedVideos,
  rankVideosByQuery,
} from './retrieval';

// #13 moved four ranking pipelines out of createServerFn handlers into
// retrieval.ts. Moving ranking code is exactly the kind of refactor where a
// green suite proves nothing — the unit tests cover the new primitives, not
// that the pipeline as a whole still ranks the same way.
//
// So this file keeps a verbatim copy of the pre-extraction algorithm and
// asserts the extracted version produces an identical order, including tie
// ordering, over generated corpora.
//
// Delete it once the extraction has shipped and settled; it exists to make
// one commit safe, not to pin the algorithm forever.

const RRF_K = 60;
const BM25_WEIGHT = 2.5;
const TAG_BOOST_PER_TAG = 0.06;
const TITLE_BOOST_PER_TOKEN = 0.015;

function makeVideo(i: number, dims: number): StrapiVideo {
  // Deterministic pseudo-random vectors and text, so a failure reproduces.
  const seeded = (n: number) => ((Math.sin(n) * 10000) % 1 + 1) / 2;
  const topics = ['strapi', 'kubernetes', 'qwen', 'ollama', 'react', 'mcp'];
  const topic = topics[i % topics.length];
  const second = topics[(i * 3 + 1) % topics.length];
  return {
    documentId: `doc-${i}`,
    youtubeVideoId: `vid-${i}`,
    videoTitle: `${topic} deep dive ${i} with ${second}`,
    videoAuthor: `channel ${i % 4}`,
    summaryTitle: `${topic} explained`,
    summaryDescription: `A walkthrough of ${topic} internals and ${second} tooling.`,
    summaryOverview: `Covers ${topic} setup, ${second} integration, and tradeoffs.`,
    keyTakeaways: [{ text: `${topic} is worth learning` }],
    sections: [{ heading: `${topic} basics` }, { heading: `${second} setup` }],
    tags: i % 3 === 0 ? [{ name: topic, slug: topic }] : [],
    summaryEmbedding: Array.from({ length: dims }, (_, d) => seeded(i * 31 + d)),
  } as unknown as StrapiVideo;
}

// ---------------------------------------------------------------------------
// The pre-extraction implementations, copied verbatim.
// ---------------------------------------------------------------------------

function legacySemanticSearch(candidates: StrapiVideo[], qVec: number[], query: string) {
  const cosineScores = candidates.map((v) =>
    cosineSimilarity(qVec, v.summaryEmbedding as number[]),
  );
  const denseOrder = cosineScores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);

  const bm25Chunks: TranscriptChunk[] = candidates.map((v, i) => ({
    id: i,
    text: buildVideoSearchText(v),
    startWord: 0,
    timeSec: 0,
  }));
  const bm25Index = buildBM25Index(bm25Chunks);
  const bm25Hits = searchBM25(bm25Index, query, candidates.length);
  const bm25Order = bm25Hits.map((c) => c.id);

  const rrf = new Map<number, number>();
  denseOrder.forEach((id, rank) => {
    rrf.set(id, (rrf.get(id) ?? 0) + 1 / (rank + 1 + RRF_K));
  });
  bm25Order.forEach((id, rank) => {
    rrf.set(id, (rrf.get(id) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
  });

  return Array.from(rrf.entries())
    .map(([i, rrfScore]) => ({ i, rrfScore, cosineScore: cosineScores[i] }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

function legacyRelated(target: StrapiVideo, candidates: StrapiVideo[], targetVec: number[]) {
  const cosineScores = candidates.map((v) =>
    cosineSimilarity(targetVec, v.summaryEmbedding as number[]),
  );
  const denseOrder = cosineScores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);

  const targetQuery = buildVideoSearchText(target);
  const bm25Chunks: TranscriptChunk[] = candidates.map((v, i) => ({
    id: i,
    text: buildVideoSearchText(v),
    startWord: 0,
    timeSec: 0,
  }));
  const bm25Index = buildBM25Index(bm25Chunks);
  const bm25Hits = searchBM25(bm25Index, targetQuery, candidates.length, {
    maxQueryTerms: 15,
  });
  const bm25Order = bm25Hits.map((c) => c.id);

  const targetTags = new Set((target.tags ?? []).map((t) => t.slug));
  const targetTitleTokens = new Set(
    tokenize(target.videoTitle ?? '').filter((t) => {
      const idf = bm25Index.idf[t];
      return idf !== undefined && idf >= 1.5;
    }),
  );

  const rrf = new Map<number, number>();
  denseOrder.forEach((id, rank) => {
    rrf.set(id, (rrf.get(id) ?? 0) + 1 / (rank + 1 + RRF_K));
  });
  bm25Order.forEach((id, rank) => {
    rrf.set(id, (rrf.get(id) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
  });

  candidates.forEach((v, i) => {
    if (targetTags.size === 0) return;
    const candTags = (v.tags ?? []).map((t) => t.slug);
    const matched: string[] = [];
    for (const slug of candTags) if (targetTags.has(slug)) matched.push(slug);
    if (matched.length > 0) {
      rrf.set(i, (rrf.get(i) ?? 0) + matched.length * TAG_BOOST_PER_TAG);
    }
  });

  candidates.forEach((v, i) => {
    if (targetTitleTokens.size === 0) return;
    const candTitleTokens = new Set(tokenize(v.videoTitle ?? ''));
    const matched: string[] = [];
    for (const t of targetTitleTokens) if (candTitleTokens.has(t)) matched.push(t);
    if (matched.length > 0) {
      rrf.set(i, (rrf.get(i) ?? 0) + matched.length * TITLE_BOOST_PER_TOKEN);
    }
  });

  return Array.from(rrf.entries())
    .map(([i, rrfScore]) => ({ i, rrfScore, cosineScore: cosineScores[i] }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

// ---------------------------------------------------------------------------

const DIMS = 24;
const QUERIES = ['qwen', 'strapi mcp server', 'kubernetes scheduling', 'how do agents work'];

describe('retrieval extraction is behaviour-preserving', () => {
  for (const size of [12, 40]) {
    const corpus = Array.from({ length: size }, (_, i) => makeVideo(i, DIMS));
    const qVec = Array.from({ length: DIMS }, (_, d) => ((Math.sin(d * 7) % 1) + 1) / 2);

    for (const query of QUERIES) {
      it(`semantic search matches the pre-extraction order (n=${size}, "${query}")`, () => {
        const before = legacySemanticSearch(corpus, qVec, query);
        const after = rankVideosByQuery(corpus, qVec, query).ranked;

        expect(after.map((r) => r.index)).toEqual(before.map((r) => r.i));
        after.forEach((r, i) => {
          expect(r.rrfScore).toBeCloseTo(before[i].rrfScore, 12);
          expect(r.cosineScore).toBeCloseTo(before[i].cosineScore, 12);
        });
      });
    }

    it(`related videos match the pre-extraction order (n=${size})`, () => {
      const target = corpus[0];
      const candidates = corpus.slice(1);
      const targetVec = target.summaryEmbedding as number[];

      const before = legacyRelated(target, candidates, targetVec);
      const after = rankRelatedVideos(target, candidates, targetVec).ranked;

      expect(after.map((r) => r.index)).toEqual(before.map((r) => r.i));
      after.forEach((r, i) => {
        expect(r.rrfScore).toBeCloseTo(before[i].rrfScore, 12);
      });
    });
  }
});
