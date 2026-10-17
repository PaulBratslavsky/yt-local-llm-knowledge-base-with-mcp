import { describe, expect, it, vi } from 'vitest';
import { runCancellableBatch, type BatchProgress } from './cancellable-batch';

const never = () => false;

describe('runCancellableBatch', () => {
  it('processes every item and counts the outcomes', async () => {
    const result = await runCancellableBatch({
      items: ['a', 'b', 'c'],
      labelOf: (s) => s,
      process: async (s) => s !== 'b',
      isCancelled: never,
      onProgress: () => {},
    });

    expect(result).toEqual({ status: 'completed', ok: 2, failed: 1, total: 3 });
  });

  it('reports progress per item, one-based, with a label', async () => {
    const seen: BatchProgress[] = [];

    await runCancellableBatch({
      items: ['first', 'second'],
      labelOf: (s) => s.toUpperCase(),
      process: async () => true,
      isCancelled: never,
      onProgress: (p) => seen.push(p),
    });

    expect(seen).toEqual([
      { current: 1, total: 2, label: 'FIRST' },
      { current: 2, total: 2, label: 'SECOND' },
    ]);
  });

  // The bug this exists to fix. The component read a `useState` value
  // captured in the closure that started the loop, so a Cancel click — which
  // only ever creates a *new* closure — was invisible to the run already in
  // flight. Asking a function each time is what makes a mid-run change
  // observable at all.
  it('sees a cancellation raised after the run started', async () => {
    let cancelled = false;
    const processed: string[] = [];

    const result = await runCancellableBatch({
      items: ['a', 'b', 'c', 'd'],
      labelOf: (s) => s,
      process: async (s) => {
        processed.push(s);
        if (s === 'b') cancelled = true;
        return true;
      },
      isCancelled: () => cancelled,
      onProgress: () => {},
    });

    // Stopped within one item of the flag flipping — 'c' never ran.
    expect(processed).toEqual(['a', 'b']);
    expect(result).toEqual({ status: 'cancelled', ok: 2, failed: 0, total: 4 });
  });

  it('checks for cancellation before every item, not just the first', async () => {
    const isCancelled = vi.fn(() => false);

    await runCancellableBatch({
      items: [1, 2, 3],
      labelOf: String,
      process: async () => true,
      isCancelled,
      onProgress: () => {},
    });

    expect(isCancelled).toHaveBeenCalledTimes(3);
  });

  it('stops before doing any work when cancelled up front', async () => {
    const process = vi.fn(async () => true);

    const result = await runCancellableBatch({
      items: ['a', 'b'],
      labelOf: (s) => s,
      process,
      isCancelled: () => true,
      onProgress: () => {},
    });

    expect(process).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'cancelled', ok: 0, failed: 0, total: 2 });
  });

  // A failure in one item is not a reason to abandon the rest — the point of
  // the batch is to get through the library.
  it('counts a thrown error as a failure and keeps going', async () => {
    const result = await runCancellableBatch({
      items: ['a', 'boom', 'c'],
      labelOf: (s) => s,
      process: async (s) => {
        if (s === 'boom') throw new Error('Ollama timed out');
        return true;
      },
      isCancelled: never,
      onProgress: () => {},
    });

    expect(result).toEqual({ status: 'completed', ok: 2, failed: 1, total: 3 });
  });

  it('completes rather than cancels when the flag flips after the last item', async () => {
    let cancelled = false;

    const result = await runCancellableBatch({
      items: ['only'],
      labelOf: (s) => s,
      process: async () => {
        cancelled = true;
        return true;
      },
      isCancelled: () => cancelled,
      onProgress: () => {},
    });

    expect(result.status).toBe('completed');
  });

  it('handles an empty list without reporting progress', async () => {
    const onProgress = vi.fn();

    const result = await runCancellableBatch({
      items: [],
      labelOf: String,
      process: async () => true,
      isCancelled: never,
      onProgress,
    });

    expect(result).toEqual({ status: 'completed', ok: 0, failed: 0, total: 0 });
    expect(onProgress).not.toHaveBeenCalled();
  });
});
