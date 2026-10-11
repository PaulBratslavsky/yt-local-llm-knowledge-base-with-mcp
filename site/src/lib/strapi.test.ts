import { describe, expect, it } from 'vitest';
import { FORBIDDEN_FIELDS, VIDEO_FIELDS } from './video';
import { buildVideoQuery, fetchGeneratedVideos } from './strapi';

/** A `fetch` stand-in that serves canned pages and records the URLs asked for. */
function fakeFetch(pages: { data: unknown[]; pageCount: number }[]) {
  const calls: string[] = [];
  const impl = async (url: string | URL) => {
    calls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get('pagination[page]') ?? '1');
    const body = pages[page - 1];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: body.data,
        meta: { pagination: { page, pageCount: body.pageCount } },
      }),
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
    expect(params.get('sort')).toBe('summaryGeneratedAt:desc');
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
});
