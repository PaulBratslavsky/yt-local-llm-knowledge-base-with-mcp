import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #6 and #7 are both failures of the generation pipeline's persistence
// story, and both were invisible: one leaves a row claiming to be working
// forever, the other silently keeps serving captions the user asked to
// replace. The split in #14 is what makes them reachable from a test.

const services = vi.hoisted(() => ({
  fetchVideoByVideoIdService: vi.fn(),
  markSummaryFailedService: vi.fn(),
  updateVideoSummaryService: vi.fn(),
  linkVideoToTranscriptService: vi.fn(),
  fetchTranscriptByVideoIdService: vi.fn(),
  requestTranscriptFetchService: vi.fn(),
}));

vi.mock('./videos', () => ({
  ...services,
  computeFinalScore: (v: number | null, s: number | null) =>
    v === null || s === null ? null : Math.round(0.6 * s + 0.4 * v),
}));

import {
  persistSummaryDraft,
  resolveGenerationInputs,
  type SummaryDraft,
} from './learning';

const video = {
  documentId: 'doc-1',
  youtubeVideoId: 'abc123',
  summaryStatus: 'pending',
} as never;

const draft = {
  safe: {
    title: 't',
    description: 'd',
    overview: 'o',
    watchVerdict: 'worth_it',
    verdictSummary: 'v',
    verdictReason: 'r',
    valueScore: 70,
    keyTakeaways: [],
    sections: [],
    actionSteps: [],
  },
  transcriptSegments: { version: 2, params: {}, bm25: { chunks: [] } },
  finalSections: [],
  signalScores: {},
  signalScore: 60,
  finalScore: 64,
} as unknown as SummaryDraft;

beforeEach(() => {
  for (const fn of Object.values(services)) fn.mockReset();
  services.markSummaryFailedService.mockResolvedValue({ success: true });
  services.linkVideoToTranscriptService.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// #6 — a failed save must not leave the row pending forever
// ---------------------------------------------------------------------------

describe('persistSummaryDraft when the save fails', () => {
  it('marks the row failed instead of leaving it pending', async () => {
    services.updateVideoSummaryService.mockResolvedValue({
      success: false,
      error: 'Backend unreachable',
    });

    const res = await persistSummaryDraft(video, draft);

    expect(res).toEqual({ success: false, error: 'Backend unreachable' });
    // The transcript and AI paths already did this. Without it the row
    // stays 'pending', the in-memory failure record expires after five
    // minutes, and the learn page polls a permanently-pending row.
    expect(services.markSummaryFailedService).toHaveBeenCalledWith('doc-1');
  });

  it('reports when marking failed also fails, rather than swallowing it', async () => {
    services.updateVideoSummaryService.mockResolvedValue({
      success: false,
      error: 'Backend unreachable',
    });
    services.markSummaryFailedService.mockResolvedValue({
      success: false,
      error: 'Backend unreachable',
    });
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {});

    await persistSummaryDraft(video, draft);

    // If Strapi is what's down, marking failed is down too — and the row is
    // genuinely stuck. That has to be visible somewhere.
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toMatch(/stuck/i);
  });

  it('does not touch status when the save succeeds', async () => {
    services.updateVideoSummaryService.mockResolvedValue({
      success: true,
      video: { ...(video as object), summaryStatus: 'generated' },
    });

    const res = await persistSummaryDraft(video, draft);

    expect(res.success).toBe(true);
    expect(services.markSummaryFailedService).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #7 — forceRefetch must actually replace the cached transcript
// ---------------------------------------------------------------------------

// The app no longer talks to YouTube. It asks Strapi to fetch and store the
// transcript (POST /api/yt-kb/transcripts/fetch) and works from the row that
// comes back, so a refetch either replaces the stored captions or fails.
const freshRow = {
  documentId: 'transcript-1',
  youtubeVideoId: 'abc123',
  title: 'Title',
  durationSec: 3,
  language: 'en',
  rawText: 'fresh captions that replace the bad ones',
  rawSegments: [{ text: 'fresh captions that replace the bad ones', startMs: 0, endMs: 3000 }],
};

describe('resolveGenerationInputs and the transcript', () => {
  beforeEach(() => {
    services.fetchVideoByVideoIdService.mockResolvedValue(video);
    services.fetchTranscriptByVideoIdService.mockResolvedValue(null);
    services.requestTranscriptFetchService.mockResolvedValue({
      success: true,
      action: 'created',
      transcript: freshRow,
    });
  });

  it('asks Strapi to re-fetch with force when forceRefetch is set', async () => {
    services.requestTranscriptFetchService.mockResolvedValue({
      success: true,
      action: 'updated',
      transcript: freshRow,
    });

    const outcome = await resolveGenerationInputs('abc123', { forceRefetch: true });

    expect(services.requestTranscriptFetchService).toHaveBeenCalledWith('abc123', { force: true });
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    // The run works from what Strapi stored, not from a separate in-app fetch.
    expect(outcome.inputs.raw.transcript).toBe('fresh captions that replace the bad ones');
    expect(outcome.inputs.raw.segments).toEqual(freshRow.rawSegments);
  });

  it('asks Strapi to fetch, without force, when no transcript is stored', async () => {
    const outcome = await resolveGenerationInputs('abc123', {});

    expect(services.requestTranscriptFetchService).toHaveBeenCalledWith('abc123', { force: false });
    expect(outcome.kind).toBe('ready');
    expect(services.linkVideoToTranscriptService).toHaveBeenCalledWith('doc-1', 'transcript-1');
  });

  it('fails the run when Strapi cannot fetch the transcript', async () => {
    services.requestTranscriptFetchService.mockResolvedValue({ success: false, error: 'No captions available for this video', status: 404, reason: 'no_captions' });

    const outcome = await resolveGenerationInputs('abc123', { forceRefetch: true });

    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.error).toMatch(/no captions/i);
    expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(1);
  });

  it('does not ask Strapi to fetch when the stored transcript has segments', async () => {
    services.fetchTranscriptByVideoIdService.mockResolvedValue(freshRow);

    const outcome = await resolveGenerationInputs('abc123', {});

    expect(outcome.kind).toBe('ready');
    expect(services.requestTranscriptFetchService).not.toHaveBeenCalled();
  });

  it('re-fetches with force when the stored row has no segments', async () => {
    // Rows from before segments were cached. Without force Strapi would skip
    // them as "already stored" and the run would have no timings.
    services.fetchTranscriptByVideoIdService.mockResolvedValue({
      ...freshRow,
      rawSegments: null,
    });

    await resolveGenerationInputs('abc123', {});

    expect(services.requestTranscriptFetchService).toHaveBeenCalledWith('abc123', { force: true });
  });
});

// ---------------------------------------------------------------------------
// M-4 — the app retries only what the plugin did not: Strapi down, or a
// network failure reaching YouTube.
// ---------------------------------------------------------------------------

describe('resolveGenerationInputs retries the transcript fetch only on network failures', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // The run also asks YouTube oEmbed for metadata; keep it off the network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    services.fetchVideoByVideoIdService.mockResolvedValue(video);
    services.fetchTranscriptByVideoIdService.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const run = async () => {
    const pending = resolveGenerationInputs('abc123', { forceRefetch: true });
    await vi.runAllTimersAsync();
    return pending;
  };

  it('retries when the plugin reports a network failure', async () => {
    services.requestTranscriptFetchService
      .mockResolvedValueOnce({ success: false, error: 'Could not reach YouTube: fetch failed', status: 502, reason: 'network' })
      .mockResolvedValueOnce({ success: true, action: 'updated', transcript: freshRow });

    const outcome = await run();

    expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(2);
    expect(outcome.kind).toBe('ready');
  });

  it('retries when Strapi is unreachable, up to three attempts in all', async () => {
    services.requestTranscriptFetchService.mockResolvedValue({
      success: false,
      error: 'Backend unreachable. Check that Strapi is running on port 1340.',
      status: 0,
      reason: null,
    });

    const outcome = await run();

    expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(3);
    expect(outcome.kind).toBe('error');
  });

  it('does not retry a rate limit — the plugin already did', async () => {
    services.requestTranscriptFetchService.mockResolvedValue({
      success: false,
      error: 'YouTube is rate limiting caption downloads from this server (HTTP 429), 3 attempts.',
      status: 502,
      reason: 'rate_limited',
    });

    const outcome = await run();

    expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('error');
  });

  it('does not retry a 502 that carries no reason', async () => {
    services.requestTranscriptFetchService.mockResolvedValue({
      success: false,
      error: 'Backend error. Strapi is up but rejected the request — check its console for details.',
      status: 502,
      reason: null,
    });

    await run();

    expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(1);
  });
});
