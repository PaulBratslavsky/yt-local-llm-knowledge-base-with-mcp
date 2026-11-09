// Ingest a YouTube URL into the knowledge base. Creates a Video row +
// fetches and stores the transcript (services/fetcher.ts — the same
// fetch-and-store the app's POST /api/yt-kb/transcripts/fetch uses).
//
// A video that is already stored (or that another caller adds while this
// one fetches) returns `action: 'exists'` with its documentId, and nothing
// is written. The plugin's Document Service rules and the unique index on
// youtubeVideoId remain the real dedupe gate.
//
// Summary generation is NOT triggered here — that's an Ollama-bound task
// and belongs in the in-app pipeline. After adding, the user can generate
// the summary from the app UI, or (from Claude Desktop) call saveSummary
// with a summary the frontier model produced itself.

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';
import { findOrCreateTag } from '../../services/tags';
import { isUniqueViolation, withUniqueRetry } from '../../services/db-errors';
import { extractYouTubeId } from '../../services/fetcher';
import { TranscriptFetchError } from '../../services/fetch-errors';

const schema = z.object({
  url: z
    .string()
    .url()
    .describe('Full YouTube URL (youtube.com/watch?v=..., youtu.be/..., or shorts URL).'),
  caption: z
    .string()
    .max(500)
    .optional()
    .describe('Optional user-facing caption for this video.'),
  tags: z
    .array(z.string().min(1).max(40))
    .max(20)
    .optional()
    .describe('Optional tags to apply. Normalized lowercase-trimmed on save.'),
});

export const addVideoTool: ToolDef<z.infer<typeof schema>> = {
  name: 'addVideo',
  description:
    'WRITE OPERATION — ingest a NEW YouTube URL into the knowledge base. DO NOT call this for "find", "summarize", "look up", "tell me about", or "get info on" a video — those are READ requests and must go through `searchVideos`/`findTranscripts` FIRST. Only call `addVideo` when (a) the user used an explicit write verb like "add", "ingest", "import", "save", or "ingest this video", AND (b) `searchVideos` has already returned zero matches for that URL/title/videoId. If both conditions aren\'t met, call `searchVideos` instead. Ingesting a video that already exists returns `action: \'exists\'` without writing; ingesting when the user didn\'t ask to ingest wastes a YouTube fetch and surprises the user.',
  schema,
  execute: async ({ url, caption, tags }, { strapi }) => {
    const videoId = extractYouTubeId(url);
    if (!videoId) {
      return { error: `Could not extract a YouTube video id from url "${url}".` };
    }

    const existingVideo = (await strapi.documents('plugin::yt-kb.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
    })) as { documentId: string } | null;
    if (existingVideo) {
      return {
        videoId,
        action: 'exists',
        videoDocumentId: existingVideo.documentId,
        message: 'Video already in knowledge base.',
      };
    }

    // Transcript first, so a later failure doesn't orphan a Video without
    // its cached captions. Reuses a stored transcript if there is one.
    let transcriptRow: Record<string, any>;
    try {
      ({ transcript: transcriptRow } = await strapi.plugin('yt-kb').service('fetcher').fetchAndStore(videoId));
    } catch (err) {
      // Already logged by fetchAndStore. No Video row is created.
      if (err instanceof TranscriptFetchError) return { videoId, error: err.message, reason: err.reason };
      throw err;
    }

    // Tags and the Video are written together or not at all (M-18). The
    // YouTube fetch above stays outside: a slow network call must not
    // hold a transaction open (and on SQLite, the only connection).
    const createVideo = async () =>
      (await strapi.db.transaction(async () => {
        const tagDocumentIds: string[] = [];
        for (const raw of tags ?? []) {
          const tag = await findOrCreateTag(strapi, raw);
          if (tag && !tagDocumentIds.includes(tag.documentId)) tagDocumentIds.push(tag.documentId);
        }
        return strapi.documents('plugin::yt-kb.video').create({
          data: {
            youtubeVideoId: videoId,
            url,
            videoTitle: transcriptRow.title ?? null,
            videoAuthor: transcriptRow.author ?? null,
            videoThumbnailUrl: transcriptRow.thumbnailUrl ?? null,
            caption: caption ?? null,
            summaryStatus: 'pending',
            transcript: transcriptRow.documentId,
            tags: tagDocumentIds,
          } as never,
        });
      })) as { documentId: string };

    let video: { documentId: string };
    try {
      video = await withUniqueRetry(createVideo);
    } catch (err) {
      // Another caller added the same video while this one fetched.
      if (!isUniqueViolation(err)) throw err;
      const raced = (await strapi.documents('plugin::yt-kb.video').findFirst({
        filters: { youtubeVideoId: { $eq: videoId } },
      })) as { documentId: string } | null;
      if (!raced) throw err;
      return {
        videoId,
        action: 'exists',
        videoDocumentId: raced.documentId,
        message: 'Video already in knowledge base.',
      };
    }

    return {
      videoId,
      action: 'created',
      videoDocumentId: video.documentId,
      transcriptDocumentId: transcriptRow.documentId,
      segmentCount: transcriptRow.rawSegments?.length ?? 0,
      durationSec: transcriptRow.durationSec,
      tags: tags ?? [],
    };
  },
};
