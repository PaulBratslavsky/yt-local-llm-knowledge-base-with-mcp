import { describe, expect, it } from 'vitest';
import { buildBM25Index, storedIndexStatus, type TimedTextSegment } from './transcript';
import { rebuildStoredIndex } from './transcript-index';
import type { StrapiVideo } from './videos';

const segments: TimedTextSegment[] = [
  { text: 'today we look at kubernetes scheduling', startMs: 0, endMs: 4000 },
  { text: 'the scheduler binds pods to nodes', startMs: 4000, endMs: 8000 },
  { text: 'then we cover storage classes', startMs: 8000, endMs: 12000 },
];

function videoWith(transcriptSegments: unknown): StrapiVideo {
  return {
    documentId: 'doc1',
    youtubeVideoId: 'abc123',
    videoTitle: 'Kubernetes internals',
    sections: [{ heading: 'Scheduling', body: 'how the scheduler works' }],
    transcriptSegments,
  } as unknown as StrapiVideo;
}

// Every index written before params existed is stale (see
// bm25-core.invalidation.test.ts). Rebuilding one must not need Ollama or
// YouTube: the raw caption segments were cached alongside the index, which
// is what makes a backfill possible at all.
describe('rebuildStoredIndex', () => {
  it('rebuilds a current index from a legacy one using its cached segments', () => {
    const legacy = {
      version: 1,
      bm25: buildBM25Index([
        { id: 0, text: 'stale content', startWord: 0, timeSec: 0 },
      ]),
      rawSegments: segments,
      durationSec: 12,
    };
    expect(storedIndexStatus(legacy)).toBe('stale');

    const result = rebuildStoredIndex(videoWith(legacy));

    expect(result.status).toBe('rebuilt');
    if (result.status !== 'rebuilt') return;
    expect(storedIndexStatus(result.index)).toBe('current');
    expect(result.index.rawSegments).toEqual(segments);
    expect(result.index.durationSec).toBe(12);
    expect(result.index.bm25.chunks.length).toBeGreaterThan(0);
  });

  it('indexes the real transcript text, not the stale chunks', () => {
    const legacy = {
      version: 1,
      bm25: buildBM25Index([
        { id: 0, text: 'stale content', startWord: 0, timeSec: 0 },
      ]),
      rawSegments: segments,
    };

    const result = rebuildStoredIndex(videoWith(legacy));

    if (result.status !== 'rebuilt') throw new Error('expected a rebuild');
    const text = result.index.bm25.chunks.map((c) => c.text).join(' ');
    expect(text).toContain('kubernetes');
    expect(text).not.toContain('stale content');
  });

  // Pre-cache rows never stored raw segments. Those genuinely need a full
  // regenerate (YouTube fetch), so the backfill must report them rather
  // than quietly skipping or pretending to succeed.
  it('reports rows with no cached segments as unrecoverable', () => {
    const noSegments = { version: 1, bm25: buildBM25Index([]) };
    const result = rebuildStoredIndex(videoWith(noSegments));
    expect(result.status).toBe('unrecoverable');
  });

  it('reports rows with no index at all as unrecoverable', () => {
    expect(rebuildStoredIndex(videoWith(null)).status).toBe('unrecoverable');
  });
});
