// YouTube captions and metadata for strapi-plugin-yt-kb: the one place the
// plugin talks to YouTube. services/fetcher.ts stores what this returns.
//
// Ported from strapi-plugin-youtube-transcripts 2.6.2 (dist/server/index.js
// lines 1-366: metadata extraction, the proxy fetch, the caption XML parsers,
// the hardened caption download and the English-first track pick; lines
// 1104-1122: the proxy check), used under the MIT licence:
//
//   Copyright (c) Paul Brats
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the
//   "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to
//   permit persons to whom the Software is furnished to do so, subject to
//   the following conditions:
//
//   The above copyright notice and this permission notice shall be included
//   in all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
//   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
//   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
//   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
//   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
//   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// Changes from the original, on purpose:
//   - every failure is a TranscriptFetchError with a machine-readable reason
//     (./fetch-errors.ts), not a message to pattern-match;
//   - the proxy fetch forwards the caller's AbortSignal, so the 25 s
//     per-attempt caption timeout also holds through a proxy (the original
//     dropped the signal);
//   - the oEmbed fallback goes through the proxy and has a 5 s timeout;
//   - a metadata-only fetch (no caption download) for the boot backfill;
//   - log lines go to a logger the caller passes (Strapi's), not console.

import { Innertube } from 'youtubei.js';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { TranscriptFetchError } from './fetch-errors';

export type TranscriptSegment = { text: string; start: number; end: number; duration: number };
export type Thumbnail = { url: string; width: number; height: number };

/** What YouTube says about a video, besides its captions. */
export type VideoMetadata = {
  title: string | null;
  author: string | null;
  channelId: string | null;
  thumbnailUrl: string | null;
  thumbnails: Thumbnail[] | null;
  durationSec: number | null;
  viewCount: number | null;
  description: string | null;
  keywords: string[] | null;
  category: string | null;
  videoPublishedAt: string | null;
  /** Language code of the caption track used (or that would be used). */
  language: string | null;
};

export type TranscriptResult = VideoMetadata & {
  videoId: string;
  language: string;
  fullTranscript: string;
  segments: TranscriptSegment[];
};

export type FetchLogger = { info: (message: string) => void; debug: (message: string) => void };
export type FetchOptions = { proxyUrl?: string; logger?: FetchLogger };

const SILENT: FetchLogger = { info: () => undefined, debug: () => undefined };

export const TIMEDTEXT_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = [1000, 3000];
export const RATE_LIMIT_BACKOFF_MS = [2000, 6000];
export const MAX_RETRY_AFTER_MS = 15000;
export const TIMEDTEXT_TIMEOUT_MS = 25000;
export const OEMBED_TIMEOUT_MS = 5000;
export const PROXY_TEST_TIMEOUT_MS = 10000;

const BROWSER_HEADERS = {
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `http://user:secret@host:8080` → `http://user:****@host:8080`, for logs. */
export function maskProxyUrl(proxyUrl: string): string {
  return proxyUrl.replace(/:([^@:]+)@/, ':****@');
}

// ---------------------------------------------------------------------------
// Metadata (YT L5-47)
// ---------------------------------------------------------------------------

type RawThumbnail = { url?: unknown; width?: unknown; height?: unknown };
type CaptionTrack = { base_url?: string; language_code?: string; kind?: string };

/** The parts of a youtubei.js VideoInfo this module reads. */
type VideoInfoLike = {
  basic_info?: {
    title?: string;
    author?: string;
    channel_id?: string;
    thumbnail?: RawThumbnail[];
    duration?: number;
    view_count?: number;
    short_description?: string;
    keywords?: string[];
    category?: string | null;
  };
  primary_info?: { published?: { text?: string } } | null;
  captions?: { caption_tracks?: CaptionTrack[] } | null;
  playability_status?: { status?: string; reason?: string };
};

function allThumbnails(thumbnails: RawThumbnail[] | undefined): Thumbnail[] | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const usable = thumbnails
    .filter((t) => typeof t?.url === 'string')
    .map((t) => ({
      url: t.url as string,
      width: typeof t.width === 'number' ? t.width : 0,
      height: typeof t.height === 'number' ? t.height : 0,
    }))
    .sort((a, b) => b.width - a.width);
  return usable.length > 0 ? usable : null;
}

function bestThumbnail(thumbnails: RawThumbnail[] | undefined): string | null {
  return allThumbnails(thumbnails)?.[0]?.url ?? null;
}

function extractMetadata(info: VideoInfoLike, language: string | null): VideoMetadata {
  const b = info?.basic_info ?? {};
  return {
    title: b.title ?? null,
    author: b.author ?? null,
    channelId: b.channel_id ?? null,
    thumbnailUrl: bestThumbnail(b.thumbnail),
    thumbnails: allThumbnails(b.thumbnail),
    durationSec: typeof b.duration === 'number' ? b.duration : null,
    viewCount: typeof b.view_count === 'number' ? b.view_count : null,
    description: b.short_description ?? null,
    keywords: Array.isArray(b.keywords) ? b.keywords : null,
    category: b.category ?? null,
    // Named videoPublishedAt, not publishedAt: Strapi reserves that name for
    // draft-and-publish state. Null when getInfo fell back to getBasicInfo.
    videoPublishedAt: info?.primary_info?.published?.text ?? null,
    language,
  };
}

// ---------------------------------------------------------------------------
// Proxy fetch (YT L48-103), forwarding the AbortSignal
// ---------------------------------------------------------------------------

function isRequestLike(input: unknown): input is Request {
  return (
    typeof input === 'object' &&
    input !== null &&
    'url' in input &&
    typeof (input as Request).url === 'string' &&
    'method' in input
  );
}

function toHeaderRecord(h: RequestInit['headers']): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}

/** A fetch that sends every request through `proxyUrl`; undefined without one. */
export function createProxyFetch(proxyUrl?: string, logger: FetchLogger = SILENT): typeof fetch | undefined {
  if (!proxyUrl) return undefined;
  const proxyAgent = new ProxyAgent(proxyUrl);
  const masked = maskProxyUrl(proxyUrl);

  return (async (input: string | URL | Request, init?: RequestInit) => {
    let url: string;
    let method: string;
    let headers: Record<string, string> = {};
    let body: unknown;
    let signal: AbortSignal | undefined = init?.signal ?? undefined;

    if (isRequestLike(input)) {
      url = input.url;
      method = init?.method ?? input.method ?? 'GET';
      input.headers?.forEach?.((value, key) => {
        headers[key] = value;
      });
      if (init?.headers) headers = { ...headers, ...toHeaderRecord(init.headers) };
      if (init?.body !== undefined) {
        body = init.body;
      } else if (method !== 'GET' && method !== 'HEAD' && input.body) {
        try {
          body = await input.clone().text();
        } catch {
          // Body not readable — send none.
        }
      }
      signal = signal ?? input.signal ?? undefined;
    } else {
      url = input instanceof URL ? input.toString() : input;
      method = init?.method ?? 'GET';
      headers = toHeaderRecord(init?.headers);
      body = init?.body;
    }

    logger.debug(`proxy ${method} ${new URL(url).pathname} via ${masked}`);
    const response = await undiciFetch(url, {
      method,
      headers,
      dispatcher: proxyAgent,
      ...(body && method !== 'GET' && method !== 'HEAD' ? { body: body as never } : {}),
      ...(signal ? { signal: signal as never } : {}),
    });
    if (!response.ok) logger.debug(`proxy response ${response.status} ${response.statusText}`);
    return response as unknown as Response;
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Caption XML (YT L104-160): `<p t d>` (ms) and `<text start dur>` (s)
// ---------------------------------------------------------------------------

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/<[^>]+>/g, '')
    .trim();
}

function parsePTagFormat(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const re = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const [, startMs, durMs, rawText] = match;
    if (!startMs || !durMs || !rawText) continue;
    const text = decodeHtmlEntities(rawText);
    if (!text) continue;
    const start = parseInt(startMs, 10);
    const duration = parseInt(durMs, 10);
    segments.push({ text, start, end: start + duration, duration });
  }
  return segments;
}

function parseTextTagFormat(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const re = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const [, startS, durS, rawText] = match;
    if (!startS || !rawText) continue;
    const text = decodeHtmlEntities(rawText);
    if (!text) continue;
    const start = Math.round(parseFloat(startS) * 1000);
    const duration = Math.round(parseFloat(durS || '0') * 1000);
    segments.push({ text, start, end: start + duration, duration });
  }
  return segments;
}

export function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const p = parsePTagFormat(xml);
  return p.length > 0 ? p : parseTextTagFormat(xml);
}

// ---------------------------------------------------------------------------
// Hardened caption download (YT L161-246)
// ---------------------------------------------------------------------------

class TimedTextError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'TimedTextError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function isRateLimited(error: unknown): error is TimedTextError {
  return error instanceof TimedTextError && (error.status === 429 || error.status === 403);
}

/** Retry-After in ms (seconds or an HTTP date), capped at 15 s; undefined when absent or past. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchTimedTextOnce(captionUrl: string, proxyFetch?: typeof fetch): Promise<string> {
  const fetchFn = proxyFetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEDTEXT_TIMEOUT_MS);
  try {
    const response = await fetchFn(captionUrl, { signal: controller.signal, headers: BROWSER_HEADERS });
    if (!response.ok) {
      throw new TimedTextError(
        `Failed to fetch timedtext: ${response.status}`,
        response.status,
        parseRetryAfter(response.headers?.get?.('retry-after')),
      );
    }
    const xml = await response.text();
    if (!xml) throw new Error('Empty timedtext response');
    return xml;
  } finally {
    clearTimeout(timer);
  }
}

type CaptionSource = { url: string; fetch?: typeof fetch };

async function fetchTimedTextXml(
  first: CaptionSource,
  options: { viaProxy: boolean; logger: FetchLogger; refresh?: () => Promise<CaptionSource> },
): Promise<string> {
  let source = first;
  let lastError: unknown;
  for (let attempt = 1; attempt <= TIMEDTEXT_ATTEMPTS; attempt += 1) {
    try {
      return await fetchTimedTextOnce(source.url, source.fetch);
    } catch (error) {
      lastError = error;
      if (attempt === TIMEDTEXT_ATTEMPTS) break;
      const limited = isRateLimited(error);
      const backoff = (limited ? RATE_LIMIT_BACKOFF_MS : RETRY_BACKOFF_MS)[attempt - 1] ?? 6000;
      const wait = isRateLimited(error) ? Math.max(backoff, error.retryAfterMs ?? 0) : backoff;
      options.logger.info(
        `caption fetch attempt ${attempt}/${TIMEDTEXT_ATTEMPTS} failed (${errorMessage(error)}); retrying in ${wait}ms${
          limited && options.refresh ? ' with a fresh session' : ''
        }`,
      );
      await sleep(wait);
      if (limited && options.refresh) {
        try {
          source = await options.refresh();
        } catch (refreshError) {
          options.logger.info(`could not start a fresh session: ${errorMessage(refreshError)}`);
        }
      }
    }
  }
  if (isRateLimited(lastError)) {
    throw new TranscriptFetchError(
      'rate_limited',
      `YouTube is rate limiting caption downloads from this server (HTTP ${lastError.status}), ${TIMEDTEXT_ATTEMPTS} attempts. This is about the server's IP address, not the video. ` +
        (options.viaProxy
          ? 'The configured proxy is being limited too: use a rotating residential proxy, or try again later.'
          : 'Set PROXY_URL (the yt-kb plugin setting proxyUrl) to a residential proxy, or try again later.'),
    );
  }
  throw new TranscriptFetchError(
    'network',
    `Caption download failed after ${TIMEDTEXT_ATTEMPTS} attempts. Last error: ${errorMessage(lastError)}`,
  );
}

// ---------------------------------------------------------------------------
// Session, video info and track pick (YT L19-28, 247-306)
// ---------------------------------------------------------------------------

function createClient(proxyFetch?: typeof fetch) {
  return Innertube.create({
    generate_session_locally: true,
    lang: 'en',
    location: 'US',
    retrieve_player: true, // required to get caption tracks
    fetch: proxyFetch,
  });
}

type InnertubeClient = Awaited<ReturnType<typeof createClient>>;

/** An Innertube failure that is not about captions, classified. */
function classifyYouTubeError(err: unknown): TranscriptFetchError {
  if (err instanceof TranscriptFetchError) return err;
  const message = errorMessage(err);
  if (/unavailable|private|does not exist|not found/i.test(message)) {
    return new TranscriptFetchError('unavailable', `Video is unavailable: ${message}`);
  }
  if (/sign in|log in|login|bot/i.test(message)) {
    return new TranscriptFetchError('blocked', `YouTube refused the request (the IP is likely blocked): ${message}`);
  }
  return new TranscriptFetchError('network', `Could not reach YouTube: ${message}`);
}

async function openClient(proxyFetch?: typeof fetch): Promise<InnertubeClient> {
  try {
    return await createClient(proxyFetch);
  } catch (err) {
    throw classifyYouTubeError(err);
  }
}

/** getInfo (has the publish date), falling back to getBasicInfo (YT L19-28). */
async function fetchVideoInfo(client: InnertubeClient, videoId: string, logger: FetchLogger): Promise<VideoInfoLike> {
  try {
    return (await client.getInfo(videoId)) as unknown as VideoInfoLike;
  } catch (err) {
    logger.info(`getInfo failed for ${videoId}, falling back to getBasicInfo (publish date will be null): ${errorMessage(err)}`);
    try {
      return (await client.getBasicInfo(videoId)) as unknown as VideoInfoLike;
    } catch (basicErr) {
      throw classifyYouTubeError(basicErr);
    }
  }
}

/** Human English, else any English, else the first track (YT L300-302). */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  return (
    tracks.find((t) => t.language_code === 'en' && t.kind !== 'asr') ??
    tracks.find((t) => t.language_code?.startsWith('en')) ??
    tracks[0]
  );
}

/** Why a video has no caption tracks (YT L271-299). */
function noCaptionsError(info: VideoInfoLike, viaProxy: boolean): TranscriptFetchError {
  const status = info.playability_status?.status;
  const reason = info.playability_status?.reason;
  if ((reason && /sign in/i.test(reason)) || status === 'LOGIN_REQUIRED') {
    return new TranscriptFetchError(
      'blocked',
      "YouTube requires sign-in, which usually means this server's IP is blocked. " +
        (viaProxy
          ? 'The configured proxy is blocked too: use a rotating residential proxy.'
          : 'Set PROXY_URL (the yt-kb plugin setting proxyUrl) to a residential proxy.'),
    );
  }
  if (status === 'ERROR' || status === 'UNPLAYABLE') {
    return new TranscriptFetchError(
      'unavailable',
      `Video is not playable (status: ${status}). ${reason ?? 'The video may be private, deleted, or unavailable in your region.'}`,
    );
  }
  return new TranscriptFetchError('no_captions', `No captions available for this video. Playability: ${status ?? 'unknown'}.`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Captions plus metadata. Throws TranscriptFetchError. */
export async function fetchYouTubeTranscript(videoId: string, options: FetchOptions = {}): Promise<TranscriptResult> {
  const logger = options.logger ?? SILENT;
  const viaProxy = Boolean(options.proxyUrl);
  logger.info(
    viaProxy ? `fetching ${videoId} via proxy ${maskProxyUrl(options.proxyUrl as string)}` : `fetching ${videoId} without proxy`,
  );

  const proxyFetch = createProxyFetch(options.proxyUrl, logger);
  const client = await openClient(proxyFetch);
  const info = await fetchVideoInfo(client, videoId, logger);
  const tracks = info.captions?.caption_tracks ?? [];
  logger.info(`${videoId}: playability ${info.playability_status?.status ?? 'unknown'}, ${tracks.length} caption track(s)`);
  if (tracks.length === 0) throw noCaptionsError(info, viaProxy);

  const track = pickTrack(tracks);
  if (!track?.base_url) throw new TranscriptFetchError('no_captions', 'No valid caption track URL found');
  logger.info(
    `${videoId}: tracks ${tracks.map((t) => `${t.language_code}${t.kind === 'asr' ? ' (auto)' : ''}`).join(', ')}; using ${track.language_code}`,
  );

  const xml = await fetchTimedTextXml(
    { url: track.base_url, fetch: proxyFetch },
    {
      viaProxy,
      logger,
      // A new proxy agent opens a new connection, and a new session gets a
      // newly signed caption URL. getBasicInfo is enough: only the tracks
      // are needed.
      refresh: async () => {
        const freshFetch = createProxyFetch(options.proxyUrl, logger);
        const fresh = (await (await createClient(freshFetch)).getBasicInfo(videoId)) as unknown as VideoInfoLike;
        const freshTracks = fresh.captions?.caption_tracks ?? [];
        const match =
          freshTracks.find((t) => t.language_code === track.language_code && t.kind === track.kind) ??
          freshTracks.find((t) => t.language_code === track.language_code);
        if (!match?.base_url) throw new Error('fresh session returned no matching caption track');
        return { url: match.base_url, fetch: freshFetch };
      },
    },
  );

  const segments = parseTimedTextXml(xml);
  if (segments.length === 0) {
    throw new TranscriptFetchError('no_captions', 'The caption track had no transcript segments.');
  }
  logger.info(`${videoId}: ${segments.length} segments`);

  // The language of the track actually used, so a stored transcript says which one it is.
  const language = track.language_code || 'und';
  return {
    videoId,
    fullTranscript: segments.map((s) => s.text).join(' '),
    segments,
    ...extractMetadata(info, language),
    language,
  };
}

/** Metadata only — no caption download. For the boot backfill. Throws TranscriptFetchError. */
export async function fetchYouTubeMetadata(videoId: string, options: FetchOptions = {}): Promise<VideoMetadata> {
  const logger = options.logger ?? SILENT;
  const client = await openClient(createProxyFetch(options.proxyUrl, logger));
  const info = await fetchVideoInfo(client, videoId, logger);
  return extractMetadata(info, pickTrack(info.captions?.caption_tracks ?? [])?.language_code ?? null);
}

/** oEmbed title/author/thumbnail, a fallback when Innertube omits them. Through the proxy, 5 s timeout. Never throws. */
export async function fetchOEmbedMeta(
  videoId: string,
  options: { proxyUrl?: string } = {},
): Promise<{ title?: string; author?: string; thumbnailUrl?: string }> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const fetchFn = createProxyFetch(options.proxyUrl) ?? fetch;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });
    if (!res.ok) return {};
    const json = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return { title: json.title, author: json.author_name, thumbnailUrl: json.thumbnail_url };
  } catch {
    return {};
  }
}

/** Boot check: the outbound IP seen through the proxy (YT L1104-1122). Never throws. */
export async function testProxyConnection(
  proxyUrl: string,
): Promise<{ success: true; ip: string } | { success: false; error: string }> {
  try {
    const response = await undiciFetch('https://httpbin.org/ip', {
      dispatcher: new ProxyAgent(proxyUrl),
      signal: AbortSignal.timeout(PROXY_TEST_TIMEOUT_MS) as never,
    });
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const data = (await response.json()) as { origin?: string };
    return { success: true, ip: String(data.origin ?? 'unknown') };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
