import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchYouTubeMeta } from './learning';
import { webSearch } from './web-search';

// M-4: every outbound call the app makes has a deadline, and a timeout
// degrades the feature instead of hanging it.
const fetchMock = vi.fn();
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchYouTubeMeta (oEmbed)', () => {
  it('times out after 5 s and falls back to no metadata', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockRejectedValue(timeoutError());
    await expect(fetchYouTubeMeta('dQw4w9WgXcQ')).resolves.toEqual({});
    expect(timeout).toHaveBeenCalledWith(5000);
  });
});

describe('webSearch (DuckDuckGo)', () => {
  it('times out after 8 s and answers with no results', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockRejectedValue(timeoutError());
    await expect(webSearch('q')).resolves.toEqual([]);
    expect(timeout).toHaveBeenCalledWith(8000);
    // withRetry treats the timeout as transient: one retry, then give up.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
