import { describe, expect, it } from 'vitest';
import { FORBIDDEN_FIELDS, VIDEO_FIELDS } from './video';
import { buildVideoQuery, fetchGeneratedVideos } from './strapi';

/** A `fetch` stand-in that serves canned pages and records the URLs asked for.
 *  `total` defaults to the number of rows across all pages, which is what a
 *  healthy Strapi reports. */
function fakeFetch(
  pages: { data: unknown[]; pageCount: number }[],
  meta?: { total?: number | null; omitPageCount?: boolean },
) {
  const calls: string[] = [];
  const total =
    meta && 'total' in meta ? meta.total : pages.reduce((n, p) => n + p.data.length, 0);
  const impl = async (url: string | URL) => {
    calls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get('pagination[page]') ?? '1');
    const body = pages[page - 1];
    const pagination: Record<string, unknown> = { page };
    if (!meta?.omitPageCount) pagination.pageCount = body.pageCount;
    if (total !== null && total !== undefined) pagination.total = total;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: body.data, meta: { pagination } }),
    } as Response;
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

const row = (id: string) => ({ youtubeVideoId: id, videoTitle: `v ${id}` });

describe('buildVideoQuery', () => {
  it('asks for every allowlisted field, by index', () => {
    const params = buildVideoQuery(1, 100);
    for (const [i, field] of VIDEO_FIELDS.entries()) {
      expect(params.get(`fields[${i}]`)).toBe(field);
    }
  });

  // The allowlist only protects anything if the request it builds honours it.
  // This asserts on the whole query, so a forbidden field smuggled in via
  // `populate` would fail here too.
  it('never names retrieval state anywhere in the query', () => {
    const query = decodeURIComponent(buildVideoQuery(1, 100).toString());
    for (const forbidden of FORBIDDEN_FIELDS) {
      expect(query).not.toContain(forbidden);
    }
  });

  it('publishes only generated summaries, newest first', () => {
    const params = buildVideoQuery(1, 100);
    expect(params.get('filters[summaryStatus][$eq]')).toBe('generated');
    expect(params.get('sort[0]')).toBe('summaryGeneratedAt:desc');
  });

  // summaryGeneratedAt is not unique. Two rows sharing a timestamp across a
  // page boundary can be returned in a different order for each page
  // request, which drops one row and duplicates another.
  it('breaks ordering ties on a unique key so paging is stable', () => {
    expect(buildVideoQuery(1, 100).get('sort[1]')).toBe('youtubeVideoId:asc');
  });

  it('populates the four nested shapes the pages render', () => {
    const query = decodeURIComponent(buildVideoQuery(1, 100).toString());
    for (const nested of ['keyTakeaways', 'sections', 'actionSteps', 'tags']) {
      expect(query).toContain(`populate[${nested}]`);
    }
    expect(query).toContain('populate[sections][fields][2]=timeSec');
  });

  it('carries the requested page and page size', () => {
    const params = buildVideoQuery(3, 50);
    expect(params.get('pagination[page]')).toBe('3');
    expect(params.get('pagination[pageSize]')).toBe('50');
  });
});

describe('fetchGeneratedVideos', () => {
  it('follows pagination to the last page', async () => {
    const { impl, calls } = fakeFetch([
      { data: [row('a'), row('b')], pageCount: 3 },
      { data: [row('c')], pageCount: 3 },
      { data: [row('d')], pageCount: 3 },
    ]);

    const rows = await fetchGeneratedVideos({
      baseUrl: 'http://localhost:1340/api',
      fetchImpl: impl,
    });

    expect(rows.map((r) => (r as { youtubeVideoId: string }).youtubeVideoId)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('/videos?');
  });

  // A build that silently shipped half the library is the worst outcome
  // available here, so every one of these must stop the build.
  it('throws when Strapi answers with an error status', async () => {
    const impl = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;

    await expect(
      fetchGeneratedVideos({ baseUrl: 'http://localhost:1340/api', fetchImpl: impl }),
    ).rejects.toThrow(/503/);
  });

  it('throws naming the base URL when Strapi is unreachable', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(
      fetchGeneratedVideos({ baseUrl: 'http://localhost:1340/api', fetchImpl: impl }),
    ).rejects.toThrow(/localhost:1340/);
  });

  it('throws rather than return an empty library', async () => {
    const { impl } = fakeFetch([{ data: [], pageCount: 1 }]);

    await expect(
      fetchGeneratedVideos({ baseUrl: 'http://localhost:1340/api', fetchImpl: impl }),
    ).rejects.toThrow(/no videos/i);
  });

  it('throws when the payload is not a Strapi collection', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { youtubeVideoId: 'not-an-array' } }),
    })) as unknown as typeof fetch;

    await expect(
      fetchGeneratedVideos({ baseUrl: 'http://localhost:1340/api', fetchImpl: impl }),
    ).rejects.toThrow(/unexpected/i);
  });

  // Review Focus 1's other half: not "Strapi is down" but "Strapi answered
  // and we got less than the library". A build that ships 100 of 172 videos
  // and exits 0 is the worst outcome available here, because nobody looks.
  it('throws when it fetched fewer rows than Strapi says exist', async () => {
    const { impl } = fakeFetch([{ data: [row('a'), row('b')], pageCount: 1 }], {
      total: 172,
    });

    await expect(
      fetchGeneratedVideos({ baseUrl: 'http://localhost:1340/api', fetchImpl: impl }),
    ).rejects.toThrow(/2 .*172|172/);
  });

  // `withCount: false` in server/config/api.ts — an ordinary Strapi perf
  // tweak — removes pageCount and total. Without them a one-page read looks
  // exactly like a complete library.
  it('throws when Strapi does not say how many videos exist', async () => {
    const { impl } = fakeFetch([{ data: [row('a')], pageCount: 1 }], {
      total: null,
      omitPageCount: true,
    });

    await expect(
      fetchGeneratedVideos({ baseUrl: 'http://localhost:1340/api', fetchImpl: impl }),
    ).rejects.toThrow(/how many|total/i);
  });
});
