import { describe, expect, it } from 'vitest';
import {
  BM25_WEIGHT,
  PER_VIDEO_CAP,
  RRF_K,
  TAG_BOOST_PER_TAG,
  TITLE_BOOST_PER_TOKEN,
  applyTagAndTitleBoosts,
  capPerVideo,
  cosineRanking,
  fuseRRF,
} from './retrieval';

// These constants are the app's retrieval policy — the difference between
// "related videos feel right" and "related videos feel random". They lived
// inside createServerFn handlers, where nothing could reach them, so every
// one of them was unverified. That is what #13 is about.

describe('fuseRRF', () => {
  it('scores a document by 1/(rank + 1 + K) per ranking', () => {
    const fused = fuseRRF([{ order: [7] }]);
    expect(fused.get(7)).toBeCloseTo(1 / (0 + 1 + RRF_K), 10);
  });

  it('sums across rankings, so appearing in both beats appearing in one', () => {
    const fused = fuseRRF([
      { order: [1, 2] },
      { order: [2, 1], weight: BM25_WEIGHT },
    ]);
    // 2 is rank 1 dense + rank 0 bm25; 1 is rank 0 dense + rank 1 bm25.
    // With BM25 weighted above dense, the bm25-leader wins.
    expect(fused.get(2)!).toBeGreaterThan(fused.get(1)!);
  });

  it('weights a ranking when asked', () => {
    const plain = fuseRRF([{ order: [5] }]);
    const weighted = fuseRRF([{ order: [5], weight: BM25_WEIGHT }]);
    expect(weighted.get(5)! / plain.get(5)!).toBeCloseTo(BM25_WEIGHT, 10);
  });

  it('gives a document present in only one ranking partial credit, not zero', () => {
    const fused = fuseRRF([{ order: [1] }, { order: [2] }]);
    expect(fused.get(1)).toBeGreaterThan(0);
    expect(fused.get(2)).toBeGreaterThan(0);
  });

  it('ignores empty rankings', () => {
    expect(fuseRRF([{ order: [] }, { order: [] }]).size).toBe(0);
  });
});

describe('cosineRanking', () => {
  it('orders by similarity, descending, and keeps scores index-aligned', () => {
    const query = [1, 0];
    const vectors = [
      [0, 1], // orthogonal
      [1, 0], // identical
      [0.7071, 0.7071], // 45 degrees
    ];

    const { order, scores } = cosineRanking(vectors, query);

    expect(order[0]).toBe(1);
    expect(order[2]).toBe(0);
    expect(scores[1]).toBeCloseTo(1, 3);
    expect(scores[0]).toBeCloseTo(0, 3);
  });
});

describe('applyTagAndTitleBoosts', () => {
  const base = () => new Map<number, number>([[0, 0.05], [1, 0.05]]);

  it('adds one tag boost per shared tag', () => {
    const fused = base();
    const { tagBoosts } = applyTagAndTitleBoosts(fused, {
      targetTags: new Set(['strapi', 'mcp']),
      targetTitleTokens: new Set<string>(),
      candidateTags: [['strapi', 'mcp'], []],
      candidateTitleTokens: [new Set<string>(), new Set<string>()],
    });

    expect(fused.get(0)).toBeCloseTo(0.05 + 2 * TAG_BOOST_PER_TAG, 10);
    expect(fused.get(1)).toBeCloseTo(0.05, 10);
    expect(tagBoosts.get(0)?.count).toBe(2);
  });

  it('weights a tag match above a title-token match', () => {
    expect(TAG_BOOST_PER_TAG).toBeGreaterThan(TITLE_BOOST_PER_TOKEN);

    const fused = base();
    applyTagAndTitleBoosts(fused, {
      targetTags: new Set(['strapi']),
      targetTitleTokens: new Set(['strapi']),
      candidateTags: [['strapi'], []],
      candidateTitleTokens: [new Set<string>(), new Set(['strapi'])],
    });

    // 0 matched by tag, 1 matched by title token. Tag must win.
    expect(fused.get(0)!).toBeGreaterThan(fused.get(1)!);
  });

  it('does nothing when the target has no tags or title tokens', () => {
    const fused = base();
    applyTagAndTitleBoosts(fused, {
      targetTags: new Set<string>(),
      targetTitleTokens: new Set<string>(),
      candidateTags: [['strapi'], ['mcp']],
      candidateTitleTokens: [new Set(['a']), new Set(['b'])],
    });
    expect(fused.get(0)).toBeCloseTo(0.05, 10);
    expect(fused.get(1)).toBeCloseTo(0.05, 10);
  });
});

describe('capPerVideo', () => {
  // Without the cap, one long video saturates the top of moment search with
  // consecutive chunks about the same thing, hiding every other video.
  it('keeps at most PER_VIDEO_CAP passages per video, in rank order', () => {
    const ranked = [0, 1, 2, 3, 4].map((i) => ({ index: i }));
    const videoIds = ['a', 'a', 'a', 'b', 'a'];

    const capped = capPerVideo(ranked, (r) => videoIds[r.index], PER_VIDEO_CAP);

    expect(capped.map((r) => r.index)).toEqual([0, 1, 3]);
  });

  it('honours a caller-supplied cap', () => {
    const ranked = [0, 1, 2].map((i) => ({ index: i }));
    const capped = capPerVideo(ranked, () => 'same', 1);
    expect(capped.map((r) => r.index)).toEqual([0]);
  });
});
