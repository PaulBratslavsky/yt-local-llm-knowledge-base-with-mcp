import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #6 and #7 are both failures of the generation pipeline's persistence
// story, and both were invisible: one leaves a row claiming to be working
// forever, the other silently keeps serving captions the user asked to
// replace. The split in #14 is what makes them reachable from a test.

const services = vi.hoisted(() => ({
  fetchVideoByVideoIdService: vi.fn(),
  markSummaryFailedService: vi.fn(),
  updateVideoSummaryService: vi.fn(),
  createTranscriptService: vi.fn(),
  updateTranscriptService: vi.fn(),
  linkVideoToTranscriptService: vi.fn(),
  fetchTranscriptByVideoIdService: vi.fn(),
}));

vi.mock('./videos', () => ({
  ...services,
  computeFinalScore: (v: number | null, s: number | null) =>
    v === null || s === null ? null : Math.round(0.6 * s + 0.4 * v),
}));

// learning.ts wraps `fetchYouTubeTranscript` in a local `fetchTranscript`,
// so the module boundary to stub is the youtube-transcript service.
const fetchYouTubeTranscript = vi.hoisted(() => vi.fn());
vi.mock('#/lib/services/youtube-transcript', () => ({ fetchYouTubeTranscript }));

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
  fetchYouTubeTranscript.mockReset();
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

// The shape fetchYouTubeTranscript returns (learning.ts maps it into
// TranscriptData).
const freshCaptions = {
  fullTranscript: 'fresh captions that replace the bad ones',
  segments: [{ text: 'fresh captions that replace the bad ones', startMs: 0, endMs: 3000 }],
  durationSec: 3,
  language: 'en',
  title: 'Title',
};

describe('resolveGenerationInputs with forceRefetch', () => {
  beforeEach(() => {
    services.fetchVideoByVideoIdService.mockResolvedValue(video);
    fetchYouTubeTranscript.mockResolvedValue(freshCaptions);
  });

  it('updates the existing transcript row rather than trying to create a duplicate', async () => {
    // Transcript.youtubeVideoId is unique, so the POST the old code issued
    // could only ever 400 for a video that already had one — and the error
    // was swallowed as "non-fatal", leaving the stale row in place.
    services.fetchTranscriptByVideoIdService.mockResolvedValue({
      documentId: 'transcript-1',
      youtubeVideoId: 'abc123',
    });
    services.updateTranscriptService.mockResolvedValue({
      success: true,
      transcript: { documentId: 'transcript-1' },
    });

    const outcome = await resolveGenerationInputs('abc123', { forceRefetch: true });

    expect(outcome.kind).toBe('ready');
    expect(services.updateTranscriptService).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'transcript-1',
        rawText: 'fresh captions that replace the bad ones',
      }),
    );
    expect(services.createTranscriptService).not.toHaveBeenCalled();
  });

  it('creates a row when the video has no transcript yet', async () => {
    services.fetchTranscriptByVideoIdService.mockResolvedValue(null);
    services.createTranscriptService.mockResolvedValue({
      success: true,
      transcript: { documentId: 'transcript-new' },
    });

    const outcome = await resolveGenerationInputs('abc123', { forceRefetch: true });

    expect(outcome.kind).toBe('ready');
    expect(services.createTranscriptService).toHaveBeenCalled();
  });

  it('fails the run when the refreshed transcript cannot be saved', async () => {
    // Continuing here is what made forceRefetch a no-op: the run would
    // succeed on in-memory captions while the stored row kept the bad ones,
    // and the next regeneration would silently revert.
    services.fetchTranscriptByVideoIdService.mockResolvedValue({
      documentId: 'transcript-1',
      youtubeVideoId: 'abc123',
    });
    services.updateTranscriptService.mockResolvedValue({
      success: false,
      error: 'Backend unreachable',
    });

    const outcome = await resolveGenerationInputs('abc123', { forceRefetch: true });

    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.error).toMatch(/unreachable/i);
  });

  it('still treats a save failure as non-fatal on a normal run', async () => {
    // Without forceRefetch the in-memory transcript is as good as the
    // stored one for this run, so a failed write shouldn't lose the summary.
    services.fetchTranscriptByVideoIdService.mockResolvedValue(null);
    services.createTranscriptService.mockResolvedValue({
      success: false,
      error: 'Backend unreachable',
    });

    const outcome = await resolveGenerationInputs('abc123', {});

    expect(outcome.kind).toBe('ready');
  });
});
