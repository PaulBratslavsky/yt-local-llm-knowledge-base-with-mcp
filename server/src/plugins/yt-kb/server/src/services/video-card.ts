import type { Core } from '@strapi/strapi';
import { findOrCreateTag } from './tags';
import { isUniqueViolation, withUniqueRetry } from './db-errors';

// The library card for a YouTube video: a Video row in `pending` state,
// linked to its stored Transcript. The app's /learn page generates the
// summary for a pending card. Used by the addVideo and fetchTranscript MCP
// tools, so a video fetched through either one shows up in the library.

const VIDEO = 'plugin::yt-kb.video';

export type VideoCardResult = { action: 'created' | 'exists'; documentId: string };

export async function findVideoCard(strapi: Core.Strapi, videoId: string): Promise<{ documentId: string } | null> {
  return (await strapi.documents(VIDEO as never).findFirst({
    filters: { youtubeVideoId: { $eq: videoId } } as never,
  })) as { documentId: string } | null;
}

/** Create the pending card (and any tags) in one transaction. If another
 *  caller created the same video meanwhile, return that one as `exists`.
 *  The caller has already checked that no card exists. */
export async function createVideoCard(
  strapi: Core.Strapi,
  input: { videoId: string; url: string; transcript: Record<string, any>; caption?: string | null; tags?: string[] },
): Promise<VideoCardResult> {
  const { videoId, url, transcript, caption, tags } = input;
  const create = async () =>
    (await strapi.db.transaction(async () => {
      const tagDocumentIds: string[] = [];
      for (const raw of tags ?? []) {
        const tag = await findOrCreateTag(strapi, raw);
        if (tag && !tagDocumentIds.includes(tag.documentId)) tagDocumentIds.push(tag.documentId);
      }
      return strapi.documents(VIDEO as never).create({
        data: {
          youtubeVideoId: videoId,
          url,
          videoTitle: transcript.title ?? null,
          videoAuthor: transcript.author ?? null,
          videoThumbnailUrl: transcript.thumbnailUrl ?? null,
          caption: caption ?? null,
          summaryStatus: 'pending',
          transcript: transcript.documentId,
          tags: tagDocumentIds,
        } as never,
      });
    })) as { documentId: string };

  try {
    const video = await withUniqueRetry(create);
    return { action: 'created', documentId: video.documentId };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await findVideoCard(strapi, videoId);
    if (!raced) throw err;
    return { action: 'exists', documentId: raced.documentId };
  }
}
