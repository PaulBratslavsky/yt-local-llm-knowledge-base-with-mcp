// Fetch a transcript from YouTube and store it (services/fetcher.ts, the
// same fetch-and-store the REST routes use). A stored transcript is returned
// as "skipped" unless force=true, which re-fetches and overwrites it. The
// proxy is the plugin setting proxyUrl; a caller cannot choose one.
//
// Does NOT run any LLM.

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';
import { YOUTUBE_VIDEO_ID } from '../../services/fetcher';
import { TranscriptFetchError } from '../../services/fetch-errors';

const schema = z.object({
  videoId: z
    .string()
    .regex(YOUTUBE_VIDEO_ID, 'videoId must be an 11-character YouTube video id')
    .describe('YouTube video id: the 11 characters after ?v= or youtu.be/.'),
  force: z
    .boolean()
    .default(false)
    .describe('If a transcript already exists, re-fetch from YouTube and overwrite. Default false.'),
});

export const fetchTranscriptTool: ToolDef<z.infer<typeof schema>> = {
  name: 'fetchTranscript',
  description:
    'WRITE OPERATION — fetch a YouTube transcript via youtubei.js and upsert the stored Transcript row. Acts as "regenerate" when force=true. DO NOT call this to "read" or "get" a transcript the user already has in the KB — use `getTranscript` instead. Only call `fetchTranscript` when the user explicitly asks to "fetch", "refresh", "re-fetch", or "regenerate" the transcript for a known videoId, OR when `getTranscript` reports no transcript stored. Idempotent only when force=false; force=true overwrites. On failure returns { error, reason } where reason is one of invalid_id, unavailable, no_captions, blocked, rate_limited, network.',
  schema,
  execute: async ({ videoId, force }, { strapi }) => {
    let fetched: { action: 'created' | 'updated' | 'skipped'; transcript: Record<string, any> };
    try {
      fetched = await strapi.plugin('yt-kb').service('fetcher').fetchAndStore(videoId, { force });
    } catch (err) {
      // Already logged by fetchAndStore. A result, not a throw, so the agent can act on the reason.
      if (err instanceof TranscriptFetchError) return { videoId, error: err.message, reason: err.reason };
      throw err;
    }
    const { action, transcript } = fetched;

    if (action === 'skipped') {
      return {
        videoId,
        action,
        message: 'Transcript already exists. Set force=true to re-fetch from YouTube.',
        transcriptDocumentId: transcript.documentId,
      };
    }
    return {
      videoId,
      action,
      transcriptDocumentId: transcript.documentId,
      language: transcript.language ?? null,
      segmentCount: transcript.rawSegments?.length ?? 0,
      durationSec: transcript.durationSec,
      characters: transcript.rawText?.length ?? 0,
    };
  },
};
