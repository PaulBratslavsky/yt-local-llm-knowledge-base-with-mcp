// Ingest a YouTube URL into the knowledge base. Creates a Video row +
// fetches and stores the transcript (services/fetcher.ts — the same
// fetch-and-store the app's POST /api/yt-kb/transcripts/fetch uses).
//
// The plugin's Document Service rules already enforce dedupe on
// youtubeVideoId — this tool surfaces the resulting error cleanly instead
// of crashing the MCP call.
//
// Summary generation is NOT triggered here — that's an Ollama-bound task
// and belongs in the in-app pipeline. After adding, the user can generate
// the summary from the app UI, or (from Claude Desktop) call saveSummary
// with a summary the frontier model produced itself.

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';
import { slugifyTagName } from './tag-utils';

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

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (/youtube\.com$/.test(u.hostname) || /youtube\.com$/.test(u.hostname.replace(/^www\./, ''))) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const shorts = u.pathname.match(/\/shorts\/([^/?#]+)/);
      if (shorts) return shorts[1];
    }
    return null;
  } catch {
    return null;
  }
}

export const addVideoTool: ToolDef<z.infer<typeof schema>> = {
  name: 'addVideo',
  description:
    'WRITE OPERATION — ingest a NEW YouTube URL into the knowledge base. DO NOT call this for "find", "summarize", "look up", "tell me about", or "get info on" a video — those are READ requests and must go through `searchVideos`/`findTranscripts` FIRST. Only call `addVideo` when (a) the user used an explicit write verb like "add", "ingest", "import", "save", or "ingest this video", AND (b) `searchVideos` has already returned zero matches for that URL/title/videoId. If both conditions aren\'t met, call `searchVideos` instead. Ingesting a video that already exists throws a duplicate-key error; ingesting when the user didn\'t ask to ingest wastes a YouTube fetch and surprises the user.',
  schema,
  execute: async ({ url, caption, tags }, { strapi }) => {
    const videoId = extractVideoId(url);
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
    const { transcript: transcriptRow } = await strapi
      .plugin('yt-kb')
      .service('fetcher')
      .fetchAndStore(videoId);

    // Resolve tags: create any that don't exist yet (the plugin's rules
    // normalize names lower-case on create).
    const tagDocumentIds: string[] = [];
    for (const raw of tags ?? []) {
      const name = raw.trim().toLowerCase();
      if (!name) continue;
      let existing = (await strapi.documents('plugin::yt-kb.tag').findFirst({
        filters: { name: { $eq: name } },
      })) as { documentId: string } | null;
      if (!existing) {
        // `documents().create()` does NOT auto-generate uid fields, so we
        // pass the slug explicitly (matches what the admin UI produces).
        existing = (await strapi.documents('plugin::yt-kb.tag').create({
          data: { name, slug: slugifyTagName(name) } as never,
        })) as { documentId: string };
      }
      tagDocumentIds.push(existing.documentId);
    }

    const video = (await strapi.documents('plugin::yt-kb.video').create({
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
    })) as { documentId: string };

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
