import { describe, it, expect, beforeAll } from 'vitest';

// Smoke test: hits a running local Strapi at STRAPI_URL and verifies that an
// ANONYMOUS CALLER GETS NOTHING from yt-kb's routes (/api/yt-kb/*) — neither
// reads nor writes. Auto-skips if Strapi isn't reachable.
//
// strapi-plugin-yt-kb grants the Public role nothing: the app reads and
// writes with STRAPI_API_TOKEN, the Astro site reads with its own read-only
// token. Before the plugin, the Public role could read, and the site relied
// on it.
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
    // /_health, not a content route: a 403 from a content route means
    // "up and refusing", and reading it as "down" silently skipped every test.
    const res = await fetch(`${STRAPI_URL}/_health`);
    return res.status === 204;
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

  it('public role CANNOT list videos', async () => {
    if (!strapiUp) return;
    const res = await fetch(`${STRAPI_URL}/api/yt-kb/videos?pagination[pageSize]=1`);
    expect(res.status).toBe(403);
  });

  it('public role CANNOT create a video', async () => {
    if (!strapiUp) return;
    const res = await fetch(`${STRAPI_URL}/api/yt-kb/videos`, {
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

  it('public role CANNOT run a filtered feed query', async () => {
    if (!strapiUp) return;
    const params = new URLSearchParams();
    params.set('filters[youtubeVideoId][$eq]', TEST_VIDEO_ID);
    params.set('pagination[pageSize]', '1');
    const res = await fetch(`${STRAPI_URL}/api/yt-kb/videos?${params.toString()}`);
    expect(res.status).toBe(403);
  });

  it('public role CANNOT create a tag', async () => {
    if (!strapiUp) return;
    const res = await fetch(`${STRAPI_URL}/api/yt-kb/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { name: `smoke-${Date.now()}` } }),
    });
    expect(res.status).toBe(403);
  });

  it('public role CANNOT create a note or a digest', async () => {
    if (!strapiUp) return;
    // Notes and digests were the only types whose delete the old Public role
    // held. Before the plugin, this hit /api/notes and /api/digests; once the
    // api:: types were removed those answered 405, not 403.
    for (const path of ['notes', 'digests']) {
      const res = await fetch(`${STRAPI_URL}/api/yt-kb/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { body: 'x', title: 'x' } }),
      });
      expect(res.status).toBe(403);
    }
  });

});
