import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVideoService,
  fetchFeedService,
  fetchVideoByVideoIdService,
  fetchVideoByVideoIdWithStatusService,
  findTagByNameService,
  listAllVideosForEmbeddingService,
  requestTranscriptFetchService,
  stripVideoForClient,
  type StrapiVideo,
} from './videos';

// M-8: the feed and detail reads name their fields, and no embedding or
// stored index reaches the browser. Driven at the Strapi HTTP boundary, as
// in videos.corpus-fields.test.ts, asserting on the URL that goes out.
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const page = (data: unknown[]) =>
  json(200, { data, meta: { pagination: { page: 1, pageCount: 1, pageSize: 25, total: data.length } } });

const HEAVY = ['summaryEmbedding', 'passageEmbeddings', 'transcriptSegments'];

/** Decoded query of the n-th request, as `key=value` strings. */
function params(n = 0): string[] {
  const url = new URL(String(fetchMock.mock.calls[n][0]));
  return [...url.searchParams.entries()].map(([k, v]) => `${k}=${v}`);
}
const fieldValues = (ps: string[], prefix: string) =>
  ps.filter((p) => new RegExp(`^${prefix.replace(/[[\]]/g, '\\$&')}\\[\\d+\\]=`).test(p)).map((p) => p.split('=')[1]);

describe('feed and detail field allowlists (M-8)', () => {
  it('fetchFeedService asks for the card fields only', async () => {
    fetchMock.mockResolvedValue(page([]));
    await fetchFeedService({});
    const ps = params();
    const fields = fieldValues(ps, 'fields');
    for (const f of [
      'youtubeVideoId', 'videoTitle', 'videoAuthor', 'caption', 'createdAt',
      'summaryStatus', 'watchVerdict', 'verdictSummary', 'finalScore',
    ]) {
      expect(fields).toContain(f);
    }
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    for (const heavy of [...HEAVY, 'readableArticle']) expect(url).not.toContain(heavy);
  });

  it('fetchVideoByVideoIdWithStatusService names its fields and the transcript fields', async () => {
    fetchMock.mockResolvedValue(page([]));
    await fetchVideoByVideoIdWithStatusService('dQw4w9WgXcQ');
    const ps = params();
    const fields = fieldValues(ps, 'fields');
    expect(fields).toContain('videoTitle');
    expect(fields).toContain('createdAt');
    expect(fieldValues(ps, 'populate[transcript][fields]')).toContain('rawSegments');
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    for (const heavy of [...HEAVY, 'searchIndex']) expect(url).not.toContain(heavy);
  });

  it('fetchVideoByVideoIdService still reads the full row for internal callers', async () => {
    fetchMock.mockResolvedValue(page([]));
    await fetchVideoByVideoIdService('dQw4w9WgXcQ');
    expect(params().some((p) => p.startsWith('fields['))).toBe(false);
  });

  it('stripVideoForClient nulls the three heavy fields and keeps the rest', () => {
    const row = {
      documentId: 'v1',
      videoTitle: 'Kept',
      transcriptSegments: { bm25: {} },
      summaryEmbedding: [1, 2],
      passageEmbeddings: { chunks: [] },
    } as unknown as StrapiVideo;
    const out = stripVideoForClient(row)!;
    expect(out.transcriptSegments).toBeNull();
    expect(out.summaryEmbedding).toBeNull();
    expect(out.passageEmbeddings).toBeNull();
    expect(out.videoTitle).toBe('Kept');
  });

  it('listAllVideosForEmbeddingService keeps the embedding it asked for', async () => {
    fetchMock.mockResolvedValue(page([{ documentId: 'v1', youtubeVideoId: 'a', summaryEmbedding: [1, 2] }]));
    const corpus = await listAllVideosForEmbeddingService(['summaryEmbedding']);
    expect(corpus.error).toBeUndefined();
    expect(corpus.videos[0].summaryEmbedding).toEqual([1, 2]);
  });
});

describe('tag lookups normalise like the plugin (M-12)', () => {
  it('findTagByNameService looks up the normalised name', async () => {
    fetchMock.mockResolvedValue(page([]));
    await findTagByNameService(' C++ ');
    expect(params()).toContain('filters[name][$eq]=c++');
  });
});

describe("duplicate detection reads the plugin's code (B-2)", () => {
  it('createVideoService re-reads when the 400 carries only YT_KB_UNIQUE', async () => {
    const row = { id: 1, documentId: 'v1', youtubeVideoId: 'abcdefghijk', summaryStatus: 'pending' };
    fetchMock
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(
        json(400, { data: null, error: { status: 400, message: 'Duplicate', details: { code: 'YT_KB_UNIQUE' } } }),
      )
      .mockResolvedValueOnce(page([row]));
    const result = await createVideoService({
      videoId: 'abcdefghijk',
      url: 'https://youtu.be/abcdefghijk',
      tagNames: [],
    });
    expect(result).toMatchObject({ success: false, kind: 'exists', video: { documentId: 'v1' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('transcript fetch timeout (M-4)', () => {
  it('waits up to 120 s for the plugin fetcher', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(json(200, { data: { documentId: 't1' }, meta: { action: 'created' } }));
    await requestTranscriptFetchService('dQw4w9WgXcQ', { force: false });
    expect(timeout).toHaveBeenCalledWith(120000);
  });
});
