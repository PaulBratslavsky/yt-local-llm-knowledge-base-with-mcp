import { describe, expect, it, vi } from 'vitest';
import { fetchTranscriptTool } from './fetch-transcript';
import { TranscriptFetchError } from '../../services/fetch-errors';

function fakeStrapi(fetchAndStore: (...args: unknown[]) => Promise<unknown>) {
  return { plugin: () => ({ service: () => ({ fetchAndStore: vi.fn(fetchAndStore) }) }) } as never;
}

describe('fetchTranscript tool', () => {
  it('rejects a malformed video id', () => {
    expect(fetchTranscriptTool.schema.safeParse({ videoId: 'short' }).success).toBe(false);
  });

  it('accepts no caller-supplied proxy', () => {
    const parsed = fetchTranscriptTool.schema.parse({ videoId: 'dQw4w9WgXcQ', proxyUrl: 'http://evil.test' });
    expect(parsed).not.toHaveProperty('proxyUrl');
  });

  it('returns the failure reason as a result', async () => {
    const strapi = fakeStrapi(async () => {
      throw new TranscriptFetchError('no_captions', 'none');
    });
    await expect(fetchTranscriptTool.execute({ videoId: 'dQw4w9WgXcQ', force: false }, { strapi } as never)).resolves.toEqual({
      videoId: 'dQw4w9WgXcQ',
      error: 'none',
      reason: 'no_captions',
    });
  });

  it('rethrows any other error', async () => {
    const strapi = fakeStrapi(async () => {
      throw new Error('db');
    });
    await expect(fetchTranscriptTool.execute({ videoId: 'dQw4w9WgXcQ', force: false }, { strapi } as never)).rejects.toThrow('db');
  });
});
