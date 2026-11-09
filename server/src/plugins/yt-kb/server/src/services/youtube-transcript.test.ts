import { describe, expect, it } from 'vitest';
import { withRequestTimeout, INNERTUBE_TIMEOUT_MS } from './youtube-transcript';

// A fetch that only settles when its signal aborts, like a YouTube call that hangs.
const hangingFetch = ((_input: unknown, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  })) as typeof fetch;

describe('withRequestTimeout', () => {
  it('aborts a request that hangs past the timeout', async () => {
    const timed = withRequestTimeout(hangingFetch, 20);
    await expect(timed('https://www.youtube.com/youtubei/v1/player')).rejects.toThrow(/timeout|abort/i);
  });

  it("still honours the caller's own signal", async () => {
    const timed = withRequestTimeout(hangingFetch, 60_000);
    const controller = new AbortController();
    const pending = timed('https://www.youtube.com/youtubei/v1/player', { signal: controller.signal });
    controller.abort(new Error('caller aborted'));
    await expect(pending).rejects.toThrow('caller aborted');
  });

  it('passes a response through untouched', async () => {
    const ok = new Response('ok');
    const timed = withRequestTimeout((async () => ok) as typeof fetch, 1000);
    await expect(timed('https://www.youtube.com/')).resolves.toBe(ok);
  });

  it('gives Innertube calls a bounded default', () => {
    expect(INNERTUBE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(INNERTUBE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
