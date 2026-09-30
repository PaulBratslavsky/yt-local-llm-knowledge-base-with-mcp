import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const byVideoId = vi.hoisted(() => vi.fn());
const byDocumentId = vi.hoisted(() => vi.fn());

vi.mock('./videos', () => ({
  fetchVideoByVideoIdWithStatusService: byVideoId,
  fetchVideoByDocumentIdWithStatusService: byDocumentId,
}));

import { resolveDigestVideos } from './digest-videos';

function found(id: string) {
  return { video: { documentId: `doc-${id}`, youtubeVideoId: id }, error: null };
}
const notFound = { video: null, error: null };
const down = { video: null, error: 'Backend unreachable. Check that Strapi is running on port 1340.' };

beforeEach(() => {
  byVideoId.mockReset();
  byDocumentId.mockReset();
  byDocumentId.mockResolvedValue(notFound);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveDigestVideos', () => {
  // The two digest orchestrators pushed into a shared array from inside
  // Promise.all, so the order was whichever Strapi lookup returned first.
  // formatVideoForSynthesis labels them "Video 1..N", so an identical
  // selection produced a different prompt every run — which undercuts
  // ADR-0006's premise that a video set maps to a stable digest.
  it('returns videos in the order the caller asked for', async () => {
    byVideoId.mockImplementation(async (id: string) => {
      // Make the first id resolve slowest, so completion order != input order.
      if (id === 'aaa') await new Promise((r) => setTimeout(r, 20));
      return found(id);
    });

    const res = await resolveDigestVideos(['aaa', 'bbb', 'ccc']);

    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.videos.map((v) => v.youtubeVideoId)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('falls back to documentId when the youtubeVideoId misses', async () => {
    byVideoId.mockResolvedValue(notFound);
    byDocumentId.mockResolvedValue(found('xyz'));

    const res = await resolveDigestVideos(['xyz']);

    expect(res.status).toBe('ok');
  });

  it('reports genuinely missing ids by name', async () => {
    byVideoId.mockResolvedValue(notFound);

    const res = await resolveDigestVideos(['nope', 'alsonope']);

    expect(res.status).toBe('missing');
    if (res.status !== 'missing') return;
    expect(res.missing).toEqual(['nope', 'alsonope']);
  });

  // ADR-0007: a dead backend must not read as a deleted video. This is what
  // put "Could not find: abc123" on /digest when Strapi was simply down.
  it('distinguishes a dead backend from a missing video', async () => {
    byVideoId.mockResolvedValue(down);

    const res = await resolveDigestVideos(['abc123']);

    expect(res.status).toBe('backend-error');
    if (res.status !== 'backend-error') return;
    expect(res.error).toMatch(/unreachable/i);
  });

  it('prefers reporting the backend failure over the missing ids', async () => {
    byVideoId.mockImplementation(async (id: string) =>
      id === 'dead' ? down : notFound,
    );

    const res = await resolveDigestVideos(['gone', 'dead']);

    expect(res.status).toBe('backend-error');
  });
});
