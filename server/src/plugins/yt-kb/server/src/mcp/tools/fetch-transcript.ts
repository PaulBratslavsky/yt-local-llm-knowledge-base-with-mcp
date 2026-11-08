// Fetch a transcript from YouTube and store it (services/fetcher.ts, the
// same fetch-and-store the app uses). A stored transcript is returned as
// "skipped" unless force=true, which re-fetches and overwrites it.
//
// Does NOT run any LLM. Claude Desktop / Claude Code can call this when it
// wants up-to-date caption data, then reason over it with its own model.

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('YouTube video id (the 11-char string after ?v= or youtu.be/).'),
  force: z
    .boolean()
    .default(false)
    .describe('If a transcript already exists, re-fetch from YouTube and overwrite. Default false.'),
  proxyUrl: z
    .string()
    .url()
    .optional()
    .describe('Optional residential proxy (http://user:pass@host:port) for YouTube bot-wall bypass. Falls back to TRANSCRIPT_PROXY_URL env var if unset.'),
});

export const fetchTranscriptTool: ToolDef<z.infer<typeof schema>> = {
  name: 'fetchTranscript',
  description:
    'WRITE OPERATION — fetch a YouTube transcript via youtubei.js and upsert the stored Transcript row. Acts as "regenerate" when force=true. DO NOT call this to "read" or "get" a transcript the user already has in the KB — use `getTranscript` instead. Only call `fetchTranscript` when the user explicitly asks to "fetch", "refresh", "re-fetch", or "regenerate" the transcript for a known videoId, OR when `getTranscript` reports no transcript stored. Idempotent only when force=false; force=true overwrites.',
  schema,
  execute: async ({ videoId, force, proxyUrl }, { strapi }) => {
    // Same fetch-and-store the app uses (POST /api/yt-kb/transcripts/fetch).
    const { action, transcript } = await strapi
      .plugin('yt-kb')
      .service('fetcher')
      .fetchAndStore(videoId, { force, proxyUrl });

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
      segmentCount: transcript.rawSegments?.length ?? 0,
      durationSec: transcript.durationSec,
      characters: transcript.rawText?.length ?? 0,
    };
  },
};
