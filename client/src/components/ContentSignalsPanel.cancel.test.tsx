// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listRegenerableVideosMock = vi.hoisted(() => vi.fn());
const regenerateVideoVerdictMock = vi.hoisted(() => vi.fn());

vi.mock('#/data/server-functions/videos', () => ({
  listRegenerableVideos: listRegenerableVideosMock,
  regenerateVideoVerdict: regenerateVideoVerdictMock,
  countMissingSignalScores: vi.fn(async () => ({ missing: 0 })),
  countMissingFinalScores: vi.fn(async () => ({ missing: 0 })),
  backfillSignalScores: vi.fn(),
  backfillFinalScores: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { ContentSignalsPanel } from './ContentSignalsPanel';

afterEach(() => {
  cleanup();
  listRegenerableVideosMock.mockReset();
  regenerateVideoVerdictMock.mockReset();
});

/** The AI batch lives behind an "Advanced" toggle, so open that first. */
const openAiPanel = () => {
  render(<ContentSignalsPanel />);
  fireEvent.click(screen.getByRole('button', { name: /advanced: re-rate/i }));
};

const videos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    videoId: `vid-${i}`,
    videoTitle: `Video ${i}`,
  }));

describe('batch AI re-rate', () => {
  // The bug: the loop read a useState boolean captured when it started, so
  // a Cancel click — which only makes a new closure — was invisible to it.
  // The button said "Stopping…" while every remaining video kept running,
  // about ten minutes of local inference on a 50-video library.
  it('stops the batch when Cancel is clicked mid-run', async () => {
    listRegenerableVideosMock.mockResolvedValue(videos(20));

    // Each re-rate waits for a release, so the run is held open at a known
    // point rather than racing the test.
    let releaseCurrent: (() => void) | null = null;
    const processed: string[] = [];
    regenerateVideoVerdictMock.mockImplementation(
      ({ data }: { data: { videoId: string } }) =>
        new Promise((resolve) => {
          processed.push(data.videoId);
          releaseCurrent = () => resolve({ status: 'ok' });
        }),
    );

    openAiPanel();
    fireEvent.click(screen.getByRole('button', { name: /^re-rate with ai$/i }));

    // First item is in flight.
    await waitFor(() => expect(processed).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    releaseCurrent!();

    await waitFor(() => expect(screen.getByText(/cancelled/i)).toBeDefined());

    // One item in flight when Cancel was clicked, and nothing after it.
    expect(processed).toEqual(['vid-0']);
  });

  it('reports what it managed to finish before stopping', async () => {
    listRegenerableVideosMock.mockResolvedValue(videos(5));

    let releaseCurrent: (() => void) | null = null;
    const processed: string[] = [];
    regenerateVideoVerdictMock.mockImplementation(
      ({ data }: { data: { videoId: string } }) =>
        new Promise((resolve) => {
          processed.push(data.videoId);
          releaseCurrent = () => resolve({ status: 'ok' });
        }),
    );

    openAiPanel();
    fireEvent.click(screen.getByRole('button', { name: /^re-rate with ai$/i }));

    await waitFor(() => expect(processed).toHaveLength(1));
    releaseCurrent!();
    await waitFor(() => expect(processed).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    releaseCurrent!();

    await waitFor(() => expect(screen.getByText(/cancelled/i)).toBeDefined());
    expect(processed).toEqual(['vid-0', 'vid-1']);
  });

  it('runs the whole batch when nobody cancels', async () => {
    listRegenerableVideosMock.mockResolvedValue(videos(3));
    regenerateVideoVerdictMock.mockResolvedValue({ status: 'ok' });

    openAiPanel();
    fireEvent.click(screen.getByRole('button', { name: /^re-rate with ai$/i }));

    await waitFor(() => {
      expect(regenerateVideoVerdictMock).toHaveBeenCalledTimes(3);
    });
  });
});
