// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
}));

import { POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS, usePollingInvalidation } from './use-polling-invalidation';

beforeEach(() => {
  vi.useFakeTimers();
  invalidate.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePollingInvalidation (M-15)', () => {
  it('polls 200 times, then stops and reports the cap', () => {
    const { result, rerender } = renderHook(({ active }) => usePollingInvalidation(active), {
      initialProps: { active: true },
    });

    act(() => {
      vi.advanceTimersByTime(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS);
    });
    expect(invalidate).toHaveBeenCalledTimes(200);
    expect(result.current.capReached).toBe(false);

    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(result.current.capReached).toBe(true);

    act(() => {
      vi.advanceTimersByTime(10 * POLL_INTERVAL_MS);
    });
    expect(invalidate).toHaveBeenCalledTimes(200);

    rerender({ active: false });
    expect(result.current.capReached).toBe(false);
  });

  it('refreshes on focus only when asked to', () => {
    const withFocus = renderHook(() => usePollingInvalidation(true, { refreshOnFocus: true }));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    withFocus.unmount();

    invalidate.mockClear();
    renderHook(() => usePollingInvalidation(true));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
