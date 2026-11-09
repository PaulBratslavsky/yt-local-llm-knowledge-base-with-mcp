// Tag tools: list, apply, remove. Names are normalized with normalizeTagName (document-rules.ts) for every lookup, the same as the create rule.

import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { ToolDef } from '../registry';
import { resolveByEitherId } from './video-access';
import { normalizeTagName } from '../../document-rules';
import { findOrCreateTag } from '../../services/tags';
import { withUniqueRetry } from '../../services/db-errors';

const listSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
});

export const listTagsTool: ToolDef<z.infer<typeof listSchema>> = {
  name: 'listTags',
  description: 'List every tag in the knowledge base with the count of videos that use it.',
  schema: listSchema,
  execute: async ({ limit }, { strapi }) => {
    const tags = (await strapi.documents('plugin::yt-kb.tag').findMany({
      limit,
      sort: 'name:asc',
      populate: { videos: { fields: ['documentId'] } },
    })) as unknown as Array<{ name: string; slug: string; videos?: Array<{ documentId: string }> }>;

    return {
      tags: tags.map((t) => ({
        name: t.name,
        slug: t.slug,
        videoCount: (t.videos ?? []).length,
      })),
    };
  },
};

const tagVideoSchema = z.object({
  videoId: z.string().min(1).describe('youtubeVideoId or Video documentId.'),
  tags: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(20)
    .describe('Tag names to apply. Created on-the-fly if they don\'t exist.'),
});

type TaggedVideo = {
  documentId: string;
  tags?: Array<{ documentId: string; name: string }>;
};

async function resolveVideo(strapi: Core.Strapi, id: string) {
  return resolveByEitherId<TaggedVideo>(strapi, id, {
    populate: { tags: { fields: ['documentId', 'name'] } },
  });
}

export const tagVideoTool: ToolDef<z.infer<typeof tagVideoSchema>> = {
  name: 'tagVideo',
  description: 'Apply one or more tags to a video. Unknown tags are created. Existing tags on the video are preserved — this only adds.',
  schema: tagVideoSchema,
  execute: async ({ videoId, tags }, { strapi }) => {
    const video = await resolveVideo(strapi, videoId);
    if (!video) return { error: `No video found for "${videoId}".` };

    // New tags and the Video's tag list change together (M-18). A unique
    // violation inside rolls the transaction back; withUniqueRetry runs it
    // once more and the second pass finds the other writer's tag.
    const apply = async () =>
      (await strapi.db.transaction(async () => {
        const resolvedIds = new Set<string>((video.tags ?? []).map((t) => t.documentId));
        const added: string[] = [];
        for (const raw of tags) {
          const tag = await findOrCreateTag(strapi, raw);
          if (!tag) continue;
          if (!resolvedIds.has(tag.documentId)) {
            resolvedIds.add(tag.documentId);
            added.push(tag.name);
          }
        }
        await strapi.documents('plugin::yt-kb.video').update({
          documentId: video.documentId,
          data: { tags: Array.from(resolvedIds) } as Record<string, unknown>,
        });
        return { videoDocumentId: video.documentId, tagsAdded: added, totalTags: resolvedIds.size };
      })) as { videoDocumentId: string; tagsAdded: string[]; totalTags: number };

    return withUniqueRetry(apply);
  },
};

const untagSchema = z.object({
  videoId: z.string().min(1),
  tags: z.array(z.string().min(1).max(40)).min(1).max(20),
});

export const untagVideoTool: ToolDef<z.infer<typeof untagSchema>> = {
  name: 'untagVideo',
  description: 'Remove one or more tags from a video. Missing tags are silently ignored. Does not delete the Tag row itself.',
  schema: untagSchema,
  execute: async ({ videoId, tags }, { strapi }) => {
    const video = await resolveVideo(strapi, videoId);
    if (!video) return { error: `No video found for "${videoId}".` };

    const drop = new Set(tags.map(normalizeTagName));
    const remaining = (video.tags ?? [])
      .filter((t) => !drop.has(t.name))
      .map((t) => t.documentId);

    await strapi.documents('plugin::yt-kb.video').update({
      documentId: video.documentId,
      data: { tags: remaining } as Record<string, unknown>,
    });

    return {
      videoDocumentId: video.documentId,
      removed: Array.from(drop),
      remainingTagCount: remaining.length,
    };
  },
};
