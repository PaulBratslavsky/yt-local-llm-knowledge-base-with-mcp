import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { slugifyTagName } from './mcp/tools/tag-utils';

type WithData = { data?: Record<string, unknown> };

const VIDEO = 'plugin::yt-kb.video';
const TRANSCRIPT = 'plugin::yt-kb.transcript';
const TAG = 'plugin::yt-kb.tag';

// Normalize a user-supplied tag name so free-form input dedupes into one row.
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Document Service rules for this plugin's own types. Each rule checks the
 * UID first, so in a host app they never touch anything but yt-kb data.
 *
 * Registered from register() so they apply to every create path: REST from
 * the app, MCP tools, the admin panel, scripts.
 */
export function registerDocumentRules(strapi: Core.Strapi) {
  strapi.documents.use(async (context, next) => {
    if (context.action !== 'create') return next();

    // Video: require youtubeVideoId and enforce one row per video. The client
    // also pre-checks; this is the authoritative gate.
    if (context.uid === VIDEO) {
      const data = (context.params as WithData).data ?? {};
      const videoId = data.youtubeVideoId as string | undefined;
      if (!videoId) throw new errors.ApplicationError('youtubeVideoId is required');
      const existing: any = await strapi
        .documents(VIDEO as never)
        .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } } as never);
      if (existing) {
        throw new errors.ApplicationError(
          `A video for this id already exists. documentId=${existing.documentId}`,
        );
      }
    }

    // Transcript: same dedupe. The schema is unique at the DB level too, but
    // this returns a readable error and catches races in flight.
    if (context.uid === TRANSCRIPT) {
      const data = (context.params as WithData).data ?? {};
      const videoId = data.youtubeVideoId as string | undefined;
      if (!videoId) throw new errors.ApplicationError('youtubeVideoId is required on transcript');
      const existing: any = await strapi
        .documents(TRANSCRIPT as never)
        .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } } as never);
      if (existing) {
        throw new errors.ApplicationError(
          `A transcript for this id already exists. documentId=${existing.documentId}`,
        );
      }
    }

    // Tag: normalize the name, then generate the slug. `slug` is a required
    // uid and Strapi fills uid fields only in the admin panel, so without this
    // every tag created through the API fails 400 "slug must be defined".
    // Normalize first so the slug derives from the normalized name. An
    // explicit slug is left alone.
    if (context.uid === TAG) {
      const data = (context.params as WithData).data ?? {};
      if (typeof data.name === 'string') data.name = normalizeTagName(data.name);
      if (!data.slug && typeof data.name === 'string') data.slug = slugifyTagName(data.name);
      (context.params as WithData).data = data;
    }

    return next();
  });
}
