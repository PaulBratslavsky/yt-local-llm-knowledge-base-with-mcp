import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllVideosForEmbeddingService } from './videos';

// These tests drive the Strapi HTTP boundary directly (same harness as
// strapi-client.test.ts) so a backend failure can be simulated per page.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function videoPage(ids: string[], page: number, pageCount: number): Response {
  return new Response(
    JSON.stringify({
      data: ids.map((id, i) => ({
        id: i,
        documentId: id,
        youtubeVideoId: id,
        videoTitle: `Video ${id}`,
        summaryStatus: 'generated',
      })),
      meta: { pagination: { page, pageCount, pageSize: 100, total: pageCount * 100 } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('listAllVideosForEmbeddingService', () => {
  it('returns every row across pages when the backend is healthy', async () => {
    fetchMock
      .mockResolvedValueOnce(videoPage(['a', 'b'], 1, 2))
      .mockResolvedValueOnce(videoPage(['c'], 2, 2));

    const result = await listAllVideosForEmbeddingService();

    expect(result.videos.map((v) => v.youtubeVideoId)).toEqual(['a', 'b', 'c']);
    expect(result.error).toBeUndefined();
  });

  // The whole point of #3: a dead backend must not look like an empty
  // library, because every cross-video surface reads this one function.
  it('reports an error instead of an empty library when the first page fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await listAllVideosForEmbeddingService();

    expect(result.videos).toEqual([]);
    expect(result.error).toMatch(/unreachable/i);
  });

  // Worse than the empty case, because the caller can't tell by looking:
  // a truncated library scores and ranks as if it were complete.
  it('reports an error rather than silently truncating when a later page fails', async () => {
    fetchMock
      .mockResolvedValueOnce(videoPage(['a', 'b'], 1, 3))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await listAllVideosForEmbeddingService();

    expect(result.error).toMatch(/unreachable/i);
  });

  it('surfaces a 5xx as a backend error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));

    const result = await listAllVideosForEmbeddingService();

    expect(result.videos).toEqual([]);
    expect(result.error).toMatch(/Backend error/i);
  });
});
