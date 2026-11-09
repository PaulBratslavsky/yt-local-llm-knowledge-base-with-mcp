import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllVideosForEmbeddingService } from './videos';

// Drives the Strapi HTTP boundary and asserts on the URL that goes out.
// The point of these tests is wire cost: measured on the live database,
// passageEmbeddings is 80 MB, transcriptSegments 33 MB and summaryEmbedding
// 2.7 MB across 192 videos, against ~1 MB for every other field combined.
// A caller that pulls a field it does not use pays for it on every request,
// which is invisible over localhost and very much not over a network.
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

function emptyPage(): Response {
  return new Response(
    JSON.stringify({ data: [], meta: { pagination: { page: 1, pageCount: 1, pageSize: 100, total: 0 } } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

async function urlFor(include: Array<'summaryEmbedding' | 'passageEmbeddings'>): Promise<string> {
  fetchMock.mockResolvedValue(emptyPage());
  await listAllVideosForEmbeddingService(include);
  return decodeURIComponent(String(fetchMock.mock.calls[0][0]));
}

describe('listAllVideosForEmbeddingService — field selection', () => {
  it('never requests transcriptSegments, which the caller discards anyway', async () => {
    // stripVideoForClient nulls transcriptSegments on arrival, so fetching
    // it was 33 MB of pure waste on every one of the eleven call sites.
    for (const inc of [[], ['summaryEmbedding'], ['passageEmbeddings']] as const) {
      const url = await urlFor([...inc]);
      expect(url).not.toContain('transcriptSegments');
      fetchMock.mockReset();
    }
  });

  it('asks for an explicit field list rather than every column', async () => {
    const url = await urlFor([]);
    expect(url).toContain('fields');
    // A representative scalar the callers actually use.
    expect(url).toContain('videoTitle');
  });

  it('omits both embedding fields when neither is asked for', async () => {
    const url = await urlFor([]);
    expect(url).not.toContain('summaryEmbedding');
    expect(url).not.toContain('passageEmbeddings');
  });

  it('includes only summaryEmbedding for the related-videos path', async () => {
    const url = await urlFor(['summaryEmbedding']);
    expect(url).toContain('summaryEmbedding');
    expect(url).not.toContain('passageEmbeddings');
  });

  it('includes only passageEmbeddings for the passage-search path', async () => {
    const url = await urlFor(['passageEmbeddings']);
    expect(url).toContain('passageEmbeddings');
    expect(url).not.toContain('summaryEmbedding');
  });

  it('still populates the relations callers rely on', async () => {
    const url = await urlFor([]);
    expect(url).toContain('tags');
    expect(url).toContain('keyTakeaways');
    expect(url).toContain('sections');
  });
});

describe('listAllVideosForEmbeddingService — remote-host page cost', () => {
  // Over a network, a 100-row page of passageEmbeddings is ~40 MB and does
  // not arrive inside the default timeout. Passage reads page smaller, and
  // every corpus page gets a 120 s budget.
  it('pages a passage read at 20 rows with a 120 s timeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const url = await urlFor(['passageEmbeddings']);
    expect(url).toContain('pagination[pageSize]=20');
    expect(timeoutSpy).toHaveBeenCalledWith(120_000);
  });

  it('keeps 100-row pages, with the 120 s timeout, when passages are not asked for', async () => {
    for (const inc of [[], ['summaryEmbedding']] as const) {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      const url = await urlFor([...inc]);
      expect(url).toContain('pagination[pageSize]=100');
      expect(timeoutSpy).toHaveBeenCalledWith(120_000);
      timeoutSpy.mockRestore();
      fetchMock.mockReset();
    }
  });
});
