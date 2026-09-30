import { describe, expect, it, vi } from 'vitest';
import { prepareSegmentedTranscript, storedIndexStatus } from './transcript';
import type { TimedTextSegment } from './transcript';

// learning.ts is the largest module in the app and had no tests, because
// generateVideoSummary was a 390-line transaction script that fetched,
// called Ollama, and wrote to Strapi in one pass — there was nowhere to
// stand. #14 split it into resolve / build / persist; this covers the
// middle phase, which is where the derived data (timecodes, scores, the
// stored index) is actually computed.
//
// Ollama is replaced through `deps.summarize`, not by mocking
// @tanstack/ai — the AI step is a parameter now.

vi.mock('./videos', () => ({
  fetchVideoByVideoIdService: vi.fn(),
  markSummaryFailedService: vi.fn(),
  updateVideoSummaryService: vi.fn(),
  createTranscriptService: vi.fn(),
  linkVideoToTranscriptService: vi.fn(),
  fetchTranscriptByVideoIdService: vi.fn(),
  computeFinalScore: (value: number | null, signal: number | null) =>
    value === null || signal === null ? null : Math.round(0.6 * signal + 0.4 * value),
}));

import { buildSummaryDraft, type GenerationInputs } from './learning';

// Long enough to chunk (the retrieval chunker uses 150-word windows), with
// the scheduler discussed at the start and storage only near the end — so a
// grounding that actually works must give the two sections different times.
const FILLER_TOPICS = [
  'networking policies and the container runtime interface',
  'rolling deployments and readiness probes in production',
  'observability dashboards, metrics scraping and alert routing',
  'role based access control and service account tokens',
  'ingress controllers, certificates and DNS records',
  'autoscaling behaviour under sustained CPU pressure',
];
const filler = (i: number) =>
  `next we discuss ${FILLER_TOPICS[i % FILLER_TOPICS.length]} in some detail ` +
  `as part ${i} of the walkthrough before moving on to the next area`;

const segments: TimedTextSegment[] = [
  { text: 'welcome to the show today we are talking about kubernetes', startMs: 0, endMs: 5000 },
  { text: 'the scheduler assigns pods to nodes based on available resources', startMs: 5000, endMs: 10000 },
  ...Array.from({ length: 30 }, (_, i) => ({
    text: filler(i),
    startMs: 10000 + i * 5000,
    endMs: 15000 + i * 5000,
  })),
  { text: 'storage classes let you describe the kind of disk you want', startMs: 160000, endMs: 165000 },
  { text: 'a storage class binds a volume claim to a provisioner', startMs: 165000, endMs: 170000 },
];

function makeInputs(): GenerationInputs {
  const prepared = prepareSegmentedTranscript(segments);
  const transcript = {
    videoId: 'abc123',
    transcript: prepared.cleanedText,
    segments,
    durationSec: 170,
    prepared,
  } as unknown as GenerationInputs['cleaned'];

  return {
    video: {
      documentId: 'doc-1',
      youtubeVideoId: 'abc123',
      summaryStatus: 'pending',
    } as unknown as GenerationInputs['video'],
    raw: { ...transcript, prepared: null } as GenerationInputs['raw'],
    cleaned: transcript,
    prepared,
    meta: { title: 'Kubernetes internals', author: 'A channel' } as GenerationInputs['meta'],
  };
}

const summary = {
  title: 'Kubernetes internals',
  description: 'A walkthrough of scheduling and storage.',
  overview: 'Covers the scheduler and storage classes.',
  watchVerdict: 'worth_it' as const,
  verdictSummary: 'Worth it if you run clusters.',
  verdictReason: 'Concrete and specific.',
  valueScore: 80,
  keyTakeaways: [{ text: 'The scheduler assigns pods to nodes' }],
  sections: [
    { heading: 'Scheduling', body: 'the scheduler assigns pods to nodes based on resources' },
    { heading: 'Storage classes', body: 'storage classes let you describe the kind of disk' },
  ],
  actionSteps: [{ title: 'Read the scheduler docs', body: 'Start with the kube-scheduler design doc.' }],
};

const summarize = vi.fn(async () => ({ success: true as const, data: summary }));

describe('buildSummaryDraft', () => {
  // ADR-0004: the model is told not to emit timecodes. Each section's time
  // is recovered by searching the BM25 index and taking the best-matching
  // chunk's REAL caption start — so every time we emit must be a value that
  // exists in the transcript, never an interpolation or a model guess.
  it('only emits section timecodes that exist in the transcript', async () => {
    const res = await buildSummaryDraft(makeInputs(), 'auto', { summarize });
    if (!res.success) throw new Error('expected success');

    const realStarts = new Set(
      res.data.transcriptSegments.bm25.chunks.map((c) => c.timeSec),
    );
    const grounded = res.data.finalSections.filter((s) => s.timeSec !== undefined);

    expect(grounded.length).toBeGreaterThan(0);
    for (const section of grounded) {
      expect(realStarts.has(section.timeSec!)).toBe(true);
    }
  });

  // The other half of the same contract: a section BM25 can't place gets no
  // time at all. "No timecode" is correct; a confidently wrong one is not.
  it('leaves a section ungrounded rather than inventing a time', async () => {
    const withUnplaceable = {
      ...summary,
      sections: [
        ...summary.sections,
        { heading: 'Unrelated', body: 'zzyzx quuxial flibbertigibbet nonsense' },
      ],
    };
    const res = await buildSummaryDraft(makeInputs(), 'auto', {
      summarize: async () => ({ success: true as const, data: withUnplaceable }),
    });
    if (!res.success) throw new Error('expected success');

    const unrelated = res.data.finalSections.find((s) => s.heading === 'Unrelated');
    expect(unrelated?.timeSec).toBeUndefined();
  });

  it('is deterministic for the same transcript and summary', async () => {
    const a = await buildSummaryDraft(makeInputs(), 'auto', { summarize });
    const b = await buildSummaryDraft(makeInputs(), 'auto', { summarize });
    if (!a.success || !b.success) throw new Error('expected success');

    expect(a.data.finalSections.map((s) => s.timeSec)).toEqual(
      b.data.finalSections.map((s) => s.timeSec),
    );
    expect(a.data.finalScore).toBe(b.data.finalScore);
  });

  it('stamps the stored index so it is not born stale', async () => {
    const res = await buildSummaryDraft(makeInputs(), 'auto', { summarize });
    if (!res.success) throw new Error('expected success');

    expect(storedIndexStatus(res.data.transcriptSegments)).toBe('current');
    // Cached captions are what makes a later rebuild possible without
    // re-fetching from YouTube (#15).
    expect(res.data.transcriptSegments.rawSegments).toHaveLength(segments.length);
  });

  it('computes the hybrid score from the model value and the programmatic signals', async () => {
    const res = await buildSummaryDraft(makeInputs(), 'auto', { summarize });
    if (!res.success) throw new Error('expected success');

    expect(res.data.signalScore).toBeGreaterThanOrEqual(0);
    expect(res.data.signalScore).toBeLessThanOrEqual(100);
    expect(res.data.finalScore).toBeGreaterThanOrEqual(0);
    expect(res.data.finalScore).toBeLessThanOrEqual(100);
    // finalScore blends both inputs, so it must not simply echo either one
    // unless they happen to agree.
    expect(res.data.safe.valueScore).toBe(80);
  });

  it('passes the caller mode through to the AI step', async () => {
    let seenMode: string | undefined;
    await buildSummaryDraft(makeInputs(), 'single', {
      summarize: async (_transcript, _meta, mode) => {
        seenMode = mode;
        return { success: true as const, data: summary };
      },
    });
    expect(seenMode).toBe('single');
  });

  it('returns the AI failure unchanged rather than half-building a draft', async () => {
    const failing = vi.fn(async () => ({
      success: false as const,
      error: 'Ollama unreachable',
    }));

    const res = await buildSummaryDraft(makeInputs(), 'auto', { summarize: failing });

    expect(res).toEqual({ success: false, error: 'Ollama unreachable' });
  });
});
