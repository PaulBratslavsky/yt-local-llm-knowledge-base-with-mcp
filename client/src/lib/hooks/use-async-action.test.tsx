// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAsyncAction } from './use-async-action';

afterEach(() => {
  cleanup();
});

describe('useAsyncAction (M-15)', () => {
  it('clears the busy flag and keeps the message when the action throws', async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(async () => {
        throw new Error('boom');
      });
    });
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBe('boom');
  });

  it('does not start a second action while one is running', async () => {
    const { result } = renderHook(() => useAsyncAction());
    let release: () => void = () => {};
    const first = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const second = vi.fn(async () => {});

    let firstRun: Promise<void> = Promise.resolve();
    act(() => {
      firstRun = result.current.run(first);
    });
    expect(result.current.running).toBe(true);
    await act(async () => {
      await result.current.run(second);
    });
    expect(second).not.toHaveBeenCalled();

    await act(async () => {
      release();
      await firstRun;
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(false);
  });
});
