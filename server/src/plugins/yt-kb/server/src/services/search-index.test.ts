import { describe, expect, it, vi } from 'vitest';
import { buildTranscriptSearchIndex, storedIndexStatus } from './bm25-core';
import { ensureTranscriptSearchIndex, loadTranscriptSearchIndex, loadTranscriptSearchIndexes } from './search-index';
import { DURATION_SEC, RAW_SEGMENTS } from '../__fixtures__/eight-topics';

function fakeStrapi(opts: { findOne?: unknown; updateRejects?: boolean } = {}) {
  const transcript = {
    findFirst: vi.fn(),
    findOne: vi.fn(async () => opts.findOne ?? null),
    findMany: vi.fn(),
    update: vi.fn(async ({ documentId, data }: any) => {
      if (opts.updateRejects) throw new Error('db down');
      return { documentId, ...data };
    }),
  };
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const strapi = { documents: vi.fn(() => transcript), log };
  return { strapi: strapi as never, transcript, log };
}

describe('buildTranscriptSearchIndex', () => {
  it('builds a current index over the retrieval chunks', () => {
    const result = buildTranscriptSearchIndex(RAW_SEGMENTS, DURATION_SEC);
    expect(storedIndexStatus(result)).toBe('current');
    expect(result!.bm25.chunks).toHaveLength(16);
    expect(result!.rawSegments).toEqual(RAW_SEGMENTS);
    expect(result!.durationSec).toBe(480);
  });

  it('returns null without segments', () => {
    expect(buildTranscriptSearchIndex([], 480)).toBeNull();
    expect(buildTranscriptSearchIndex(null, null)).toBeNull();
  });
});

describe('ensureTranscriptSearchIndex', () => {
  it('returns a current stored index without reading or writing', async () => {
    const { strapi, transcript } = fakeStrapi();
    const current = buildTranscriptSearchIndex(RAW_SEGMENTS, DURATION_SEC);
    const result = await ensureTranscriptSearchIndex(strapi, { documentId: 't1', searchIndex: current });
    expect(result).toEqual(current);
    expect(transcript.update).not.toHaveBeenCalled();
    expect(transcript.findOne).not.toHaveBeenCalled();
  });

  it('builds and saves a missing index from the segments in hand', async () => {
    const { strapi, transcript } = fakeStrapi();
    const result = await ensureTranscriptSearchIndex(strapi, {
      documentId: 't1',
      searchIndex: null,
      rawSegments: RAW_SEGMENTS,
      durationSec: DURATION_SEC,
    });
    expect(transcript.update).toHaveBeenCalledTimes(1);
    const arg = transcript.update.mock.calls[0][0] as { documentId: string; data: { searchIndex: unknown } };
    expect(arg).toEqual({ documentId: 't1', data: { searchIndex: arg.data.searchIndex } });
    expect(storedIndexStatus(arg.data.searchIndex)).toBe('current');
    expect(result).toBe(arg.data.searchIndex);
  });

  it('rebuilds and saves a stale index', async () => {
    const { strapi, transcript } = fakeStrapi();
    const stale = {
      ...buildTranscriptSearchIndex(RAW_SEGMENTS, DURATION_SEC)!,
      params: { chunkWords: 150, chunkOverlap: 20, tokenizer: 1 },
    };
    const result = await ensureTranscriptSearchIndex(strapi, {
      documentId: 't3',
      searchIndex: stale,
      rawSegments: RAW_SEGMENTS,
      durationSec: DURATION_SEC,
    });
    expect(transcript.update).toHaveBeenCalledTimes(1);
    const arg = transcript.update.mock.calls[0][0] as { documentId: string; data: { searchIndex: unknown } };
    expect(arg).toEqual({ documentId: 't3', data: { searchIndex: arg.data.searchIndex } });
    expect(storedIndexStatus(arg.data.searchIndex)).toBe('current');
    expect(storedIndexStatus(result)).toBe('current');
  });

  it('reads the segments when the row was loaded without them', async () => {
    const { strapi, transcript } = fakeStrapi({ findOne: { rawSegments: RAW_SEGMENTS, durationSec: DURATION_SEC } });
    const result = await ensureTranscriptSearchIndex(strapi, { documentId: 't4', searchIndex: null });
    expect(transcript.findOne).toHaveBeenCalledTimes(1);
    expect(transcript.findOne).toHaveBeenCalledWith({ documentId: 't4', fields: ['rawSegments', 'durationSec'] });
    expect(transcript.update).toHaveBeenCalledTimes(1);
    expect(transcript.findOne.mock.invocationCallOrder[0]).toBeLessThan(transcript.update.mock.invocationCallOrder[0]);
    expect(storedIndexStatus(result)).toBe('current');
  });

  it('returns null and saves nothing when there are no segments', async () => {
    const { strapi, transcript } = fakeStrapi();
    const result = await ensureTranscriptSearchIndex(strapi, { documentId: 't5', searchIndex: null, rawSegments: null });
    expect(result).toBeNull();
    expect(transcript.update).not.toHaveBeenCalled();
  });

  it('still returns the built index when the save fails', async () => {
    const { strapi, log } = fakeStrapi({ updateRejects: true });
    const result = await ensureTranscriptSearchIndex(strapi, {
      documentId: 't6',
      searchIndex: null,
      rawSegments: RAW_SEGMENTS,
      durationSec: DURATION_SEC,
    });
    expect(storedIndexStatus(result)).toBe('current');
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe('loading the private searchIndex root-level', () => {
  it('reads one transcript with a root-level findOne', async () => {
    const current = buildTranscriptSearchIndex(RAW_SEGMENTS, DURATION_SEC);
    const { strapi, transcript } = fakeStrapi({ findOne: { searchIndex: current, durationSec: DURATION_SEC } });
    await expect(loadTranscriptSearchIndex(strapi, 't1')).resolves.toEqual({ searchIndex: current, durationSec: DURATION_SEC });
    expect(transcript.findOne).toHaveBeenCalledWith({ documentId: 't1', fields: ['searchIndex', 'durationSec'] });
  });

  it('reads many in one query, and segments only for the rows that need a build', async () => {
    const current = buildTranscriptSearchIndex(RAW_SEGMENTS, DURATION_SEC);
    const { strapi, transcript } = fakeStrapi();
    transcript.findMany
      .mockResolvedValueOnce([
        { documentId: 'tA', searchIndex: current, durationSec: DURATION_SEC },
        { documentId: 'tB', searchIndex: null, durationSec: null },
      ])
      .mockResolvedValueOnce([{ documentId: 'tB', rawSegments: RAW_SEGMENTS, durationSec: DURATION_SEC }]);

    const rows = await loadTranscriptSearchIndexes(strapi, ['tA', 'tB', 'tA']);
    expect(transcript.findMany).toHaveBeenCalledTimes(2);
    expect(transcript.findMany.mock.calls[0][0]).toEqual({
      filters: { documentId: { $in: ['tA', 'tB'] } },
      fields: ['documentId', 'searchIndex', 'durationSec'],
      limit: 2,
    });
    expect(transcript.findMany.mock.calls[1][0]).toEqual({
      filters: { documentId: { $in: ['tB'] } },
      fields: ['documentId', 'rawSegments', 'durationSec'],
      limit: 1,
    });
    expect(rows.get('tA')).not.toHaveProperty('rawSegments');
    expect(rows.get('tB')).toMatchObject({ rawSegments: RAW_SEGMENTS, durationSec: DURATION_SEC });

    // The built row needs no further read.
    await ensureTranscriptSearchIndex(strapi, rows.get('tB')!);
    expect(transcript.findOne).not.toHaveBeenCalled();
    expect(transcript.update).toHaveBeenCalledTimes(1);
  });

  it('makes no query for no ids', async () => {
    const { strapi, transcript } = fakeStrapi();
    await expect(loadTranscriptSearchIndexes(strapi, [])).resolves.toEqual(new Map());
    expect(transcript.findMany).not.toHaveBeenCalled();
  });
});
