import { describe, it, expect, beforeAll } from 'vitest';

// Smoke test: hits a running local Strapi at STRAPI_URL and verifies the
// PUBLIC ROLE IS READ-ONLY. Auto-skips if Strapi isn't reachable.
//
//   yarn --cwd server develop   # in one terminal
//   yarn --cwd client test      # in another
//
// These used to assert the opposite — that an unauthenticated caller could
// create videos and tags. That was true, and it was the problem: the Public
// role held 11 write actions reachable with no credential, including delete
// on notes and digests. Writes now go through the client's server layer with
// STRAPI_API_TOKEN, so an anonymous write must be refused.
//
// Nothing is created here any more, so there is nothing to clean up.

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1340';
const TEST_VIDEO_ID = 'test-smoke-001';

async function isStrapiUp(): Promise<boolean> {
  try {
    const res = await fetch(`${STRAPI_URL}/api/videos?pagination[pageSize]=1`);
    return res.ok;
  } catch {
    return false;
  }
}

describe('videos service — smoke', () => {
  let strapiUp = false;

  beforeAll(async () => {
    strapiUp = await isStrapiUp();
    if (!strapiUp) {
      console.warn(
        `[smoke] Strapi not reachable at ${STRAPI_URL} — skipping. ` +
          `Start it with \`yarn --cwd server develop\`.`,
      );
    }
  });

  it('public role can list videos (find permission granted)', async () => {
    if (!strapiUp) return;
    const res = await fetch(`${STRAPI_URL}/api/videos?pagination[pageSize]=1`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: unknown[] };
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('public role CANNOT create a video', async () => {
    if (!strapiUp) return;
    const res = await fetch(`${STRAPI_URL}/api/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          youtubeVideoId: TEST_VIDEO_ID,
          url: `https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`,
          videoTitle: 'Smoke test video',
          summaryStatus: 'pending',
        },
      }),
    });
    // 403, flatly. The previous version of this test branched on 400 and
    // only asserted a status in the else arm, so it passed without ever
    // evaluating its own assertion.
    expect(res.status).toBe(403);
  });

  it('a filtered feed query is served to an anonymous caller', async () => {
    if (!strapiUp) return;
    // Reads must keep working — the Astro site builds against them. This no
    // longer asserts a specific row: the row it used to look for could only
    // be created by the anonymous write this milestone removes, so requiring
    // it would fail on any database where that write never happened.
    const params = new URLSearchParams();
    params.set('filters[youtubeVideoId][$eq]', TEST_VIDEO_ID);
    params.set('pagination[pageSize]', '1');
    const res = await fetch(`${STRAPI_URL}/api/videos?${params.toString()}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: unknown[] };
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('public role CANNOT create a tag', async () => {
    if (!strapiUp) return;
    const res = await fetch(`${STRAPI_URL}/api/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { name: `smoke-${Date.now()}` } }),
    });
    expect(res.status).toBe(403);
  });

  it('public role CANNOT delete a note or a digest', async () => {
    if (!strapiUp) return;
    // These two were the only deletes the Public role held. An anonymous
    // caller could remove saved notes and digests with one request.
    for (const path of ['notes', 'digests']) {
      const res = await fetch(`${STRAPI_URL}/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { body: 'x', title: 'x' } }),
      });
      expect(res.status).toBe(403);
    }
  });

});
