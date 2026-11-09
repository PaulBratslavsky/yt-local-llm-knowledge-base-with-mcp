import { describe, expect, it, vi } from 'vitest';

vi.mock('./youtube-transcript', async (orig) => ({
  ...(await orig<typeof import('./youtube-transcript')>()),
  fetchYouTubeMetadata: vi.fn(),
}));

import { fetchYouTubeMetadata } from './youtube-transcript';
import { backfillTranscriptMetadata } from './metadata-backfill';
import { TranscriptFetchError } from './fetch-errors';

const META = {
  title: 'T',
  author: 'A',
  channelId: 'UC1',
  thumbnailUrl: 'https://i/t.jpg',
  thumbnails: [{ url: 'https://i/t.jpg', width: 1, height: 1 }],
  durationSec: 10,
  viewCount: 5,
  description: null,
  keywords: null,
  category: 'Music',
  videoPublishedAt: null,
  language: 'fr',
};

function fakeStrapi(findMany: (args: any) => Promise<unknown[]>) {
  const docs = { findMany: vi.fn(findMany), update: vi.fn(async () => ({})) };
  const strapi = {
    documents: vi.fn(() => docs),
    log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
  return { strapi, docs };
}

describe('backfillTranscriptMetadata', () => {
  it('fills one page of rows, skips rows that have metadata, and records failures', async () => {
    const pages: unknown[][] = [
      [
        { id: 1, documentId: 'a', youtubeVideoId: 'AAAAAAAAAAA', thumbnails: null },
        { id: 2, documentId: 'b', youtubeVideoId: 'BBBBBBBBBBB', thumbnails: [{ url: 'u', width: 1, height: 1 }], channelId: 'x' },
        { id: 3, documentId: 'c', youtubeVideoId: 'CCCCCCCCCCC', thumbnails: null },
      ],
      [],
    ];
    const { strapi, docs } = fakeStrapi(async () => pages.shift() ?? []);
    vi.mocked(fetchYouTubeMetadata).mockReset().mockImplementation(async (videoId: string) => {
      if (videoId === 'AAAAAAAAAAA') return META;
      throw new TranscriptFetchError('blocked', 'nope');
    });

    const result = await backfillTranscriptMetadata(strapi as never, { pauseMs: 0 });

    expect(result).toEqual({ scanned: 3, updated: 1, skipped: 1, failed: [{ videoId: 'CCCCCCCCCCC', reason: 'nope' }] });
    expect(docs.update).toHaveBeenCalledTimes(1);
    const arg = (docs.update.mock.calls[0] as unknown[])[0] as { documentId: string; data: Record<string, unknown> };
    expect(arg.documentId).toBe('a');
    expect(Object.keys(arg.data).sort()).toEqual(
      ['author', 'channelId', 'thumbnailUrl', 'thumbnails', 'durationSec', 'viewCount', 'category'].sort(),
    );
    expect(docs.findMany).toHaveBeenCalledTimes(2);
    expect(docs.findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({ filters: { thumbnails: { $null: true }, id: { $gt: 0 } }, sort: 'id:asc', limit: 100 }),
    );
    expect(docs.findMany.mock.calls[1][0].filters.id).toEqual({ $gt: 3 });
  });

  it('stops at the limit', async () => {
    const { strapi, docs } = fakeStrapi(async (args) =>
      Array.from({ length: args.limit }, (_, i) => {
        const id = args.filters.id.$gt + 1 + i;
        return { id, documentId: `d${id}`, youtubeVideoId: 'AAAAAAAAAAA', thumbnails: null };
      }),
    );
    vi.mocked(fetchYouTubeMetadata).mockReset().mockResolvedValue(META);

    const result = await backfillTranscriptMetadata(strapi as never, { limit: 150, pauseMs: 0 });

    expect(result.scanned).toBe(150);
    expect(result.updated).toBe(150);
    expect(docs.findMany).toHaveBeenCalledTimes(2);
    expect(docs.findMany.mock.calls[0][0].limit).toBe(100);
    expect(docs.findMany.mock.calls[1][0].limit).toBe(50);
  });
});
