import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', () => ({
  ProxyAgent: vi.fn(),
  fetch: vi.fn(async () => ({ ok: true, json: async () => ({ origin: '203.0.113.7' }) })),
}));
vi.mock('./services/metadata-backfill', () => ({
  backfillTranscriptMetadata: vi.fn(async () => ({ scanned: 0, updated: 0, skipped: 0, failed: [] })),
}));
vi.mock('./permission-seeding', () => ({ seedPermissions: vi.fn(async () => {}) }));

import { fetch as undiciFetch } from 'undici';
import { backfillTranscriptMetadata } from './services/metadata-backfill';
import { seedPermissions } from './permission-seeding';
import bootstrap from './bootstrap';

function fakeStrapi(cfg: Record<string, unknown>) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const strapi = { plugin: () => ({ config: (k: string) => cfg[k] }), log };
  return { strapi, log };
}

const RENAME_WARNING =
  '[yt-kb] TRANSCRIPT_PROXY_URL is set but no longer read; rename it to PROXY_URL (or set the plugin config proxyUrl).';

beforeEach(() => {
  vi.mocked(undiciFetch).mockClear();
  vi.mocked(backfillTranscriptMetadata).mockClear();
  vi.mocked(seedPermissions).mockClear();
  // The developer's shell must not decide these tests.
  vi.stubEnv('TRANSCRIPT_PROXY_URL', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('bootstrap', () => {
  it('logs the masked proxy and the outbound IP, never the password', async () => {
    const { strapi, log } = fakeStrapi({ proxyUrl: 'http://user:secret@proxy.test:8080' });

    await bootstrap({ strapi: strapi as never });
    await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Outbound IP: 203.0.113.7')));

    expect(log.info).toHaveBeenCalledWith('[yt-kb] Proxy configured: http://user:****@proxy.test:8080/');
    const args = Object.values(log).flatMap((fn) => fn.mock.calls.flat());
    expect(args.some((a) => JSON.stringify(a)?.includes('secret'))).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('warns when no proxy is configured and makes no proxy check', async () => {
    const { strapi, log } = fakeStrapi({ proxyUrl: '' });

    await bootstrap({ strapi: strapi as never });

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0][0]).startsWith('[yt-kb] No proxy configured; YouTube may block datacenter IPs')).toBe(true);
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('warns once that the old TRANSCRIPT_PROXY_URL is not read, without logging its value', async () => {
    vi.stubEnv('TRANSCRIPT_PROXY_URL', 'http://olduser:oldsecret@old-proxy.test:3128');
    const { strapi, log } = fakeStrapi({ proxyUrl: '' });

    await bootstrap({ strapi: strapi as never });

    expect(log.warn.mock.calls.filter((c) => c[0] === RENAME_WARNING)).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(RENAME_WARNING);
    const args = Object.values(log).flatMap((fn) => fn.mock.calls.flat());
    expect(args.some((a) => /olduser|oldsecret|old-proxy/.test(JSON.stringify(a) ?? ''))).toBe(false);
  });

  it('does not warn about TRANSCRIPT_PROXY_URL when a proxy is configured', async () => {
    vi.stubEnv('TRANSCRIPT_PROXY_URL', 'http://old-proxy.test:3128');
    const { strapi, log } = fakeStrapi({ proxyUrl: 'http://proxy.test:8080' });

    await bootstrap({ strapi: strapi as never });

    expect(log.warn).not.toHaveBeenCalledWith(RENAME_WARNING);
  });

  it('starts the metadata backfill when backfillMetadata is true', async () => {
    const { strapi } = fakeStrapi({ proxyUrl: '', backfillMetadata: true });

    await bootstrap({ strapi: strapi as never });

    expect(backfillTranscriptMetadata).toHaveBeenCalledTimes(1);
    expect(backfillTranscriptMetadata).toHaveBeenCalledWith(strapi, { proxyUrl: undefined });
  });

  it('does not start the backfill by default', async () => {
    const { strapi } = fakeStrapi({ proxyUrl: '' });

    await bootstrap({ strapi: strapi as never });

    expect(backfillTranscriptMetadata).not.toHaveBeenCalled();
  });

  it('seeds permissions once, with the strapi instance, before the first warning', async () => {
    const { strapi, log } = fakeStrapi({ proxyUrl: '' });

    await bootstrap({ strapi: strapi as never });

    expect(seedPermissions).toHaveBeenCalledTimes(1);
    expect(seedPermissions).toHaveBeenCalledWith(strapi);
    expect(log.warn).toHaveBeenCalled();
    expect(vi.mocked(seedPermissions).mock.invocationCallOrder[0]).toBeLessThan(log.warn.mock.invocationCallOrder[0]);
  });
});
