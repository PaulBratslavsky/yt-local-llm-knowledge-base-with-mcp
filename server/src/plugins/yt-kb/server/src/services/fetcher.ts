import type { Core } from '@strapi/strapi';
import { isUniqueViolation } from './db-errors';
import { TranscriptFetchError } from './fetch-errors';
import {
  fetchOEmbedMeta,
  fetchYouTubeTranscript,
  type FetchLogger,
  type VideoMetadata,
} from './youtube-transcript';

// The one place yt-kb fetches a transcript from YouTube and stores it. Used by
// POST /api/yt-kb/transcripts/fetch and GET .../yt-transcript/:videoId
// (controllers/fetcher.ts) and by the fetchTranscript and addVideo MCP tools.
// The proxy is the plugin setting `proxyUrl` (default env PROXY_URL), read
// here and nowhere else; no caller can pass one.

/** An 11-character YouTube video id. */
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const ID = '([A-Za-z0-9_-]{11})';
// YT L439-451.
const URL_PATTERNS = [
  new RegExp(`youtube\\.com/watch\\?(?:.*&)?v=${ID}`), // also m. and music. subdomains
  new RegExp(`youtu\\.be/${ID}`),
  new RegExp(`youtube\\.com/shorts/${ID}`),
  new RegExp(`youtube\\.com/embed/${ID}`),
  new RegExp(`youtube\\.com/live/${ID}`),
];

/** The id itself, or the id inside a watch / youtu.be / shorts / embed / live URL; null otherwise. */
export function extractYouTubeId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (YOUTUBE_VIDEO_ID.test(trimmed)) return trimmed;
  for (const pattern of URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

const clip = (value: string | null | undefined, max: number): string | null =>
  typeof value === 'string' ? value.slice(0, max) : null;

/** The stored metadata fields of a fetch, clipped to the schema's limits (M2). */
export function transcriptMetadataData(meta: VideoMetadata) {
  return {
    author: clip(meta.author, 200),
    channelId: clip(meta.channelId, 64),
    thumbnailUrl: clip(meta.thumbnailUrl, 2000),
    thumbnails: meta.thumbnails,
    durationSec: meta.durationSec,
    viewCount: meta.viewCount,
    description: meta.description,
    keywords: meta.keywords,
    category: clip(meta.category, 100),
    videoPublishedAt: clip(meta.videoPublishedAt, 100),
    language: clip(meta.language, 10),
  };
}

export type FetchAction = 'created' | 'updated' | 'skipped';
export type FetchOptions = {
  /** Re-fetch and overwrite a transcript that is already stored. */
  force?: boolean;
};
export type FetchResult = { action: FetchAction; transcript: Record<string, any> };

const UID = 'plugin::yt-kb.transcript';

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const logger: FetchLogger = {
    info: (message) => strapi.log.info(`[yt-kb] ${message}`),
    debug: (message) => strapi.log.debug(`[yt-kb] ${message}`),
  };

  const findStored = async (videoId: string) =>
    (await strapi.documents(UID as never).findFirst({
      filters: { youtubeVideoId: { $eq: videoId } } as never,
    })) as Record<string, any> | null;

  // The single log line for a failed fetch, whichever path asked
  // (REST, MCP, ai-tools). Callers must not log it again. The fields go
  // in the message too; the meta object is for JSON log transports and
  // never has a `message` key (Strapi 5.61's console format appends it to
  // the line, which would print the message twice).
  const fail = (videoId: string, err: unknown): never => {
    const error =
      err instanceof TranscriptFetchError
        ? err
        : new TranscriptFetchError('network', err instanceof Error ? err.message : String(err));
    const id = videoId.slice(0, 100);
    strapi.log.warn(`[yt-kb] transcript fetch failed: ${id} (${error.reason}): ${error.message}`, {
      videoId: id,
      reason: error.reason,
    });
    throw error;
  };

  return {
    /** Stored transcript (`skipped`) unless `force`; else fetch from YouTube and create or update it.
     *  Throws TranscriptFetchError for every fetch failure; database errors are rethrown as they are. */
    async fetchAndStore(videoId: string, options: FetchOptions = {}): Promise<FetchResult> {
      if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID.test(videoId)) {
        fail(
          String(videoId ?? ''),
          new TranscriptFetchError(
            'invalid_id',
            'videoId must be an 11-character YouTube video id, or a YouTube watch, youtu.be, shorts, embed or live URL',
          ),
        );
      }

      const existing = await findStored(videoId);
      if (existing && !options.force) return { action: 'skipped', transcript: existing };

      const proxyUrl = (strapi.plugin('yt-kb').config('proxyUrl') as string | undefined) || undefined;
      const [result, oembed] = await Promise.all([
        fetchYouTubeTranscript(videoId, { proxyUrl, logger }),
        fetchOEmbedMeta(videoId, { proxyUrl }),
      ]).catch((err) => fail(videoId, err));

      const rawSegments = result.segments.map((s) => ({ text: s.text, startMs: s.start, endMs: s.end }));
      const meta = transcriptMetadataData(result);
      const data = {
        ...meta,
        title: clip(result.title ?? oembed.title, 300),
        author: meta.author ?? clip(oembed.author, 200),
        thumbnailUrl: meta.thumbnailUrl ?? clip(oembed.thumbnailUrl, 2000),
        rawSegments,
        rawText: result.fullTranscript,
        fetchedAt: new Date().toISOString(),
      };

      if (existing) {
        const transcript = await strapi.documents(UID as never).update({
          documentId: existing.documentId,
          data: data as never,
        });
        return { action: 'updated', transcript: transcript as Record<string, any> };
      }

      try {
        const transcript = await strapi.documents(UID as never).create({
          data: { youtubeVideoId: videoId, ...data } as never,
        });
        return { action: 'created', transcript: transcript as Record<string, any> };
      } catch (err) {
        // Two fetches of the same id raced and the other stored it first.
        // Every duplicate on a yt-kb write reaches here carrying
        // details.code 'YT_KB_UNIQUE' (M2): the Document Service rule's own
        // "A transcript for this id already exists", or a unique-index or
        // validator failure rethrown by document-rules.ts. isUniqueViolation
        // matches all of them; any other error (a real ApplicationError
        // included) is rethrown. The stored row wins.
        if (isUniqueViolation(err)) {
          const winner = await findStored(videoId);
          if (winner) return { action: 'skipped', transcript: winner };
        }
        throw err;
      }
    },
  };
};
