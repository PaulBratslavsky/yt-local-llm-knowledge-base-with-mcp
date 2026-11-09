import { describe, expect, it, vi } from 'vitest';
import fetcherController from './fetcher';
import { TRANSCRIPT_FETCH_REASONS, TranscriptFetchError } from '../services/fetch-errors';

function fakeCtx(opts: { params?: Record<string, unknown>; body?: unknown } = {}) {
  return {
    params: opts.params ?? {},
    request: { body: opts.body },
    state: { auth: undefined },
    status: 200,
    body: undefined as any,
    badRequest: vi.fn(function (this: any, m: string) {
      this.status = 400;
      this.body = { error: { message: m } };
    }),
  };
}

function fakeStrapi() {
  const fetchAndStore = vi.fn();
  const strapi = {
    plugin: () => ({ service: () => ({ fetchAndStore }) }),
    getModel: () => ({}),
    contentAPI: { sanitize: { output: vi.fn(async (d: unknown) => d) } },
  };
  return { controller: fetcherController({ strapi: strapi as never }), fetchAndStore };
}

const EXPECTED_STATUS = {
  invalid_id: 400,
  unavailable: 404,
  no_captions: 404,
  blocked: 502,
  rate_limited: 502,
  network: 502,
} as const;

describe('fetcher controller', () => {
  it.each(TRANSCRIPT_FETCH_REASONS.map((r) => [r, EXPECTED_STATUS[r]] as const))(
    'getOrFetch answers %s with %i and the reason in details',
    async (reason, status) => {
      const { controller, fetchAndStore } = fakeStrapi();
      fetchAndStore.mockRejectedValue(new TranscriptFetchError(reason, 'm'));
      const ctx = fakeCtx({ params: { videoId: 'dQw4w9WgXcQ' } });

      await controller.getOrFetch(ctx);

      expect(ctx.status).toBe(status);
      expect(ctx.body).toEqual({
        data: null,
        error: { status, name: 'TranscriptFetchError', message: 'm', details: { reason } },
      });
    },
  );

  it('getOrFetch accepts a YouTube URL and returns a stored row without meta', async () => {
    const { controller, fetchAndStore } = fakeStrapi();
    fetchAndStore.mockResolvedValue({ action: 'skipped', transcript: { documentId: 'd' } });
    const ctx = fakeCtx({ params: { videoId: 'https://youtu.be/dQw4w9WgXcQ?si=x' } });

    await controller.getOrFetch(ctx);

    expect(fetchAndStore).toHaveBeenCalledWith('dQw4w9WgXcQ', { force: false });
    expect(ctx.body).toEqual({ data: { documentId: 'd' } });
  });

  it('getOrFetch reports a newly created row in meta', async () => {
    const { controller, fetchAndStore } = fakeStrapi();
    fetchAndStore.mockResolvedValue({ action: 'created', transcript: { documentId: 'd' } });
    const ctx = fakeCtx({ params: { videoId: 'dQw4w9WgXcQ' } });

    await controller.getOrFetch(ctx);

    expect(ctx.body.meta).toEqual({ action: 'created' });
  });

  it('getOrFetch passes an unparseable value through for fetchAndStore to reject', async () => {
    const { controller, fetchAndStore } = fakeStrapi();
    fetchAndStore.mockRejectedValue(new TranscriptFetchError('invalid_id', 'bad'));
    const ctx = fakeCtx({ params: { videoId: 'nonsense' } });

    await controller.getOrFetch(ctx);

    expect(fetchAndStore).toHaveBeenCalledWith('nonsense', { force: false });
  });

  it('fetchTranscript rejects a non-boolean force without fetching', async () => {
    const { controller, fetchAndStore } = fakeStrapi();
    const ctx = fakeCtx({ body: { data: { videoId: 'dQw4w9WgXcQ', force: 'yes' } } });

    await controller.fetchTranscript(ctx);

    expect(ctx.badRequest).toHaveBeenCalled();
    expect(fetchAndStore).not.toHaveBeenCalled();
  });

  it('fetchTranscript passes force through and reports the action', async () => {
    const { controller, fetchAndStore } = fakeStrapi();
    fetchAndStore.mockResolvedValue({ action: 'updated', transcript: { documentId: 'd' } });
    const ctx = fakeCtx({ body: { data: { videoId: 'dQw4w9WgXcQ', force: true } } });

    await controller.fetchTranscript(ctx);

    expect(fetchAndStore).toHaveBeenCalledWith('dQw4w9WgXcQ', { force: true });
    expect(ctx.body.meta.action).toBe('updated');
  });

  it('rethrows an error that is not a TranscriptFetchError', async () => {
    const { controller, fetchAndStore } = fakeStrapi();
    const err = new Error('db down');
    fetchAndStore.mockRejectedValue(err);

    await expect(controller.getOrFetch(fakeCtx({ params: { videoId: 'dQw4w9WgXcQ' } }))).rejects.toBe(err);
  });
});
