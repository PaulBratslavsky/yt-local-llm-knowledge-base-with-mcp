// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  listRegenerableVideos: vi.fn(),
  regenerateVideoVerdict: vi.fn(),
  countMissingSignalScores: vi.fn(),
  countMissingFinalScores: vi.fn(),
  backfillSignalScores: vi.fn(),
  backfillFinalScores: vi.fn(),
}));

vi.mock('#/data/server-functions/videos', () => m);
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { ContentSignalsPanel } from './ContentSignalsPanel';

const DOWN = 'Backend unreachable. Check that Strapi is running on port 1340.';

beforeEach(() => {
  m.countMissingSignalScores.mockResolvedValue({ missing: 0 });
  m.countMissingFinalScores.mockResolvedValue({ missing: 0 });
});

afterEach(() => {
  cleanup();
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('ContentSignalsPanel error states (M-13)', () => {
  it('says the library could not be checked instead of "all current"', async () => {
    m.countMissingSignalScores.mockResolvedValue({ missing: 0, error: DOWN });
    render(<ContentSignalsPanel />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(DOWN);
    expect(screen.queryByText('All videos have current scores.')).toBeNull();
  });

  it('reports skipped rows and an early stop in the refresh message', async () => {
    m.countMissingSignalScores.mockResolvedValue({ missing: 3 });
    m.countMissingFinalScores.mockResolvedValue({ missing: 3 });
    m.backfillSignalScores.mockResolvedValue({
      status: 'ok', updated: 0, skipped: 3, failed: 0, total: 3, errors: [],
    });
    m.backfillFinalScores.mockResolvedValue({
      status: 'error', updated: 1, skipped: 0, failed: 0, total: 3, errors: [], error: DOWN,
    });
    render(<ContentSignalsPanel />);
    const button = await screen.findByRole('button', { name: 'Refresh scores' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    const message = await screen.findByText(/Updated 1 final score\./);
    expect(message.textContent).toContain('3 videos skipped — no cached transcript');
    expect(message.textContent).toContain('Final scores stopped early: Backend unreachable');
  });

  it('does not start a re-rate over a library it could not list', async () => {
    m.listRegenerableVideos.mockResolvedValue({ status: 'error', error: DOWN });
    render(<ContentSignalsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /advanced: re-rate/i }));
    fireEvent.click(screen.getByRole('button', { name: /^re-rate with ai$/i }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((a) =>
          (a.textContent ?? '').includes("Couldn't list the videos to re-rate: Backend unreachable"),
        ),
      ).toBe(true),
    );
    expect(m.regenerateVideoVerdict).not.toHaveBeenCalled();
  });
});
