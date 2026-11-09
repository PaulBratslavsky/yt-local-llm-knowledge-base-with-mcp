import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const yt = vi.hoisted(() => ({
  create: vi.fn(),
  client: { getInfo: vi.fn(), getBasicInfo: vi.fn() },
}));
vi.mock('youtubei.js', () => ({ Innertube: { create: yt.create } }));

import fetcherService from './fetcher';
import { TranscriptFetchError } from './fetch-errors';

const ID = 'dQw4w9WgXcQ';
const CAPTION_URL = `https://www.youtube.com/api/timedtext?v=${ID}&lang=de`;
const XML = '<timedtext><body><p t="0" d="1500">Hallo Welt</p><p t="1500" d="2000">zweite Zeile</p></body></timedtext>';

const germanInfo = {
  basic_info: {
    title: 'Ein Video',
    author: 'Kanal',
    channel_id: 'UC_fixture',
    thumbnail: [
      { url: 'https://i.ytimg.com/a.jpg', width: 120, height: 90 },
      { url: 'https://i.ytimg.com/b.jpg', width: 1280, height: 720 },
    ],
    duration: 61,
    view_count: 12345,
    short_description: 'Beschreibung',
    keywords: ['eins', 'zwei'],
    category: 'Education',
  },
  primary_info: { published: { text: 'Nov 1, 2026' } },
  captions: { caption_tracks: [{ base_url: CAPTION_URL, language_code: 'de', kind: 'asr' }] },
  playability_status: { status: 'OK' },
};

function fakeStrapi(stored: Record<string, unknown> | null = null) {
  const transcripts = {
    findFirst: vi.fn(async () => stored),
    create: vi.fn(async ({ data }: any) => ({ documentId: 'doc-new', ...data })),
    update: vi.fn(async ({ documentId, data }: any) => ({ documentId, ...data })),
  };
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const strapi = {
    documents: vi.fn(() => transcripts),
    plugin: vi.fn(() => ({ config: (key: string) => (key === 'proxyUrl' ? '' : undefined) })),
    log,
  };
  return { service: fetcherService({ strapi: strapi as never }), transcripts, log };
}

const fetchMock = vi.fn();
const captionCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/timedtext')).length;
let captionResponses: Array<() => Response>;

beforeEach(() => {
  yt.create.mockReset().mockResolvedValue(yt.client);
  yt.client.getInfo.mockReset().mockResolvedValue(germanInfo);
  yt.client.getBasicInfo.mockReset().mockResolvedValue(germanInfo);
  captionResponses = [() => new Response(XML, { status: 200 })];
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (String(url).includes('/oembed')) {
      return new Response(JSON.stringify({ title: 'oEmbed title', author_name: 'oEmbed author' }), { status: 200 });
    }
    const next = captionResponses.length > 1 ? captionResponses.shift()! : captionResponses[0];
    return next();
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const infoLogged = (log: { info: ReturnType<typeof vi.fn> }, text: string) =>
  log.info.mock.calls.some(([m]) => String(m).includes(text));

describe('fetchAndStore', () => {
  it('stores captions, metadata and the language of a non-English track', async () => {
    const { service, transcripts, log } = fakeStrapi();
    await expect(service.fetchAndStore(ID)).resolves.toMatchObject({ action: 'created' });

    expect(transcripts.create).toHaveBeenCalledTimes(1);
    const { data } = transcripts.create.mock.calls[0][0] as { data: Record<string, unknown> };
    const { fetchedAt, ...rest } = data;
    expect(typeof fetchedAt).toBe('string');
    expect(rest).toEqual({
      youtubeVideoId: ID,
      title: 'Ein Video',
      author: 'Kanal',
      channelId: 'UC_fixture',
      thumbnailUrl: 'https://i.ytimg.com/b.jpg',
      thumbnails: [
        { url: 'https://i.ytimg.com/b.jpg', width: 1280, height: 720 },
        { url: 'https://i.ytimg.com/a.jpg', width: 120, height: 90 },
      ],
      durationSec: 61,
      viewCount: 12345,
      description: 'Beschreibung',
      keywords: ['eins', 'zwei'],
      category: 'Education',
      videoPublishedAt: 'Nov 1, 2026',
      language: 'de',
      rawSegments: [
        { text: 'Hallo Welt', startMs: 0, endMs: 1500 },
        { text: 'zweite Zeile', startMs: 1500, endMs: 3500 },
      ],
      rawText: 'Hallo Welt zweite Zeile',
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('returns a stored transcript without calling YouTube unless forced', async () => {
    const { service } = fakeStrapi({ documentId: 'd1', youtubeVideoId: ID });
    await expect(service.fetchAndStore(ID)).resolves.toMatchObject({ action: 'skipped' });
    expect(yt.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a 429 after its Retry-After, with a fresh session', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    captionResponses = [
      () => new Response('', { status: 429, headers: { 'retry-after': '5' } }),
      () => new Response(XML, { status: 200 }),
    ];
    const { service, log } = fakeStrapi();

    const p = service.fetchAndStore(ID);
    await vi.advanceTimersByTimeAsync(4999);
    expect(captionCalls()).toBe(1);
    await vi.runAllTimersAsync();

    await expect(p).resolves.toMatchObject({ action: 'created' });
    expect(captionCalls()).toBe(2);
    expect(yt.create).toHaveBeenCalledTimes(2);
    expect(infoLogged(log, 'retrying in 5000ms with a fresh session')).toBe(true);
  });

  it('gives up as rate_limited after three limited attempts, and logs the failure once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    captionResponses = [() => new Response('', { status: 429 })];
    const { service, transcripts, log } = fakeStrapi();

    const p = service.fetchAndStore(ID);
    await Promise.all([expect(p).rejects.toMatchObject({ reason: 'rate_limited' }), vi.runAllTimersAsync()]);

    expect(captionCalls()).toBe(3);
    expect(infoLogged(log, 'retrying in 2000ms')).toBe(true);
    expect(infoLogged(log, 'retrying in 6000ms')).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[yt-kb\] transcript fetch failed: dQw4w9WgXcQ \(rate_limited\): /),
      expect.objectContaining({ videoId: ID, reason: 'rate_limited' }),
    );
    expect(transcripts.create).not.toHaveBeenCalled();
  });

  it('reports a sign-in wall as blocked', async () => {
    yt.client.getInfo.mockResolvedValue({
      basic_info: { title: 't' },
      captions: undefined,
      playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' },
    });
    const { service, transcripts, log } = fakeStrapi();

    const err = await service.fetchAndStore(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptFetchError);
    expect(err).toMatchObject({ reason: 'blocked' });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[yt-kb\] transcript fetch failed: /),
      expect.objectContaining({ videoId: ID, reason: 'blocked' }),
    );
    expect(captionCalls()).toBe(0);
    expect(transcripts.create).not.toHaveBeenCalled();
  });

  it('reports a video without caption tracks as no_captions', async () => {
    yt.client.getInfo.mockResolvedValue({ ...germanInfo, captions: { caption_tracks: [] } });
    const { service } = fakeStrapi();
    await expect(service.fetchAndStore(ID)).rejects.toMatchObject({ reason: 'no_captions' });
  });

  it('falls back to getBasicInfo when getInfo fails', async () => {
    yt.client.getInfo.mockRejectedValue(new Error('boom'));
    yt.client.getBasicInfo.mockResolvedValue({ ...germanInfo, primary_info: null });
    const { service, transcripts } = fakeStrapi();

    await expect(service.fetchAndStore(ID)).resolves.toMatchObject({ action: 'created' });
    expect(transcripts.create.mock.calls[0][0]).toMatchObject({ data: { videoPublishedAt: null, language: 'de' } });
  });

  it('reports an unreachable YouTube as network', async () => {
    yt.create.mockRejectedValue(new TypeError('fetch failed'));
    const { service } = fakeStrapi();
    await expect(service.fetchAndStore(ID)).rejects.toMatchObject({ reason: 'network' });
  });

  it('rejects an invalid id before reading the database or calling YouTube', async () => {
    const { service, transcripts, log } = fakeStrapi();
    await expect(service.fetchAndStore('not-an-id')).rejects.toMatchObject({ reason: 'invalid_id' });
    expect(transcripts.findFirst).not.toHaveBeenCalled();
    expect(yt.create).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('returns the stored row when a concurrent fetch created it first', async () => {
    const { errors } = await import('@strapi/utils');
    const { service, transcripts } = fakeStrapi();
    transcripts.create.mockRejectedValueOnce(
      new errors.ApplicationError('A transcript for this id already exists. documentId=winner', { code: 'YT_KB_UNIQUE' }),
    );
    transcripts.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ documentId: 'winner' });

    await expect(service.fetchAndStore(ID)).resolves.toEqual({ action: 'skipped', transcript: { documentId: 'winner' } });
  });
});

describe('maskProxyUrl', () => {
  it('masks the proxy password', async () => {
    const { maskProxyUrl } = await import('./youtube-transcript');
    expect(maskProxyUrl('http://user:secret@proxy.test:8080')).toBe('http://user:****@proxy.test:8080');
  });
});
