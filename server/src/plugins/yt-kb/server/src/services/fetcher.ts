import type { Core } from '@strapi/strapi';
import { fetchYouTubeMeta, fetchYouTubeTranscript } from './youtube-transcript';
import { isUniqueViolation } from './db-errors';

// The one place yt-kb fetches a transcript from YouTube and stores it.
// Used by POST /api/yt-kb/transcripts/fetch (the app) and by the
// fetchTranscript and addVideo MCP tools, so every fetch goes out from
// Strapi, through the same TRANSCRIPT_PROXY_URL.

// An 11-character YouTube video id.
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export type FetchAction = 'created' | 'updated' | 'skipped';
export type FetchOptions = {
  // Re-fetch and overwrite a transcript that is already stored.
  force?: boolean;
  // Overrides TRANSCRIPT_PROXY_URL for this call (the MCP tool accepts one).
  proxyUrl?: string;
};

const UID = 'plugin::yt-kb.transcript';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async fetchAndStore(
    videoId: string,
    options: FetchOptions = {},
  ): Promise<{ action: FetchAction; transcript: Record<string, any> }> {
    const existing = (await strapi.documents(UID as never).findFirst({
      filters: { youtubeVideoId: { $eq: videoId } } as never,
    })) as Record<string, any> | null;

    if (existing && !options.force) return { action: 'skipped', transcript: existing };

    const [result, meta] = await Promise.all([
      fetchYouTubeTranscript(videoId, {
        proxyUrl: options.proxyUrl ?? process.env.TRANSCRIPT_PROXY_URL,
      }),
      fetchYouTubeMeta(videoId),
    ]);

    const data = {
      title: result.title ?? meta.title ?? null,
      author: meta.author ?? null,
      thumbnailUrl: meta.thumbnailUrl ?? null,
      language: 'en',
      durationSec: result.durationSec,
      rawSegments: result.segments.map((s) => ({ text: s.text, startMs: s.start, endMs: s.end })),
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
      // Another caller stored the same transcript while this one fetched.
      if (!isUniqueViolation(err)) throw err;
      const raced = (await strapi.documents(UID as never).findFirst({
        filters: { youtubeVideoId: { $eq: videoId } } as never,
      })) as Record<string, any> | null;
      if (!raced) throw err;
      return { action: 'skipped', transcript: raced };
    }
  },
});
