import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { slugifyTagName } from './mcp/tools/tag-utils';

type WithData = { data?: Record<string, unknown> };

// Normalize a user-supplied tag name so free-form input dedupes into one row.
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export default {
  async register({ strapi }: { strapi: Core.Strapi }) {
    strapi.documents.use(async (context, next) => {
      // Rule 1: video.create — require youtubeVideoId and enforce dedupe.
      // The client also pre-checks, but this is the authoritative gate.
      if (
        context.uid === 'api::video.video' &&
        context.action === 'create'
      ) {
        const data = (context.params as WithData).data ?? {};
        const videoId = data.youtubeVideoId as string | undefined;
        if (!videoId) {
          throw new errors.ApplicationError('youtubeVideoId is required');
        }

        const existing: any = await strapi
          .documents('api::video.video')
          .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } });
        if (existing) {
          throw new errors.ApplicationError(
            `A video for this id already exists. documentId=${existing.documentId}`,
          );
        }
      }

      // Rule 1b: transcript.create — same dedupe on youtubeVideoId. The
      // schema has `unique: true` at the DB level, but this returns a
      // cleaner error and handles races in-flight.
      if (
        context.uid === 'api::transcript.transcript' &&
        context.action === 'create'
      ) {
        const data = (context.params as WithData).data ?? {};
        const videoId = data.youtubeVideoId as string | undefined;
        if (!videoId) {
          throw new errors.ApplicationError('youtubeVideoId is required on transcript');
        }
        const existing: any = await strapi
          .documents('api::transcript.transcript')
          .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } });
        if (existing) {
          throw new errors.ApplicationError(
            `A transcript for this id already exists. documentId=${existing.documentId}`,
          );
        }
      }

      // Rule 2: tag.create — normalize the name, and generate the slug.
      //
      // `slug` is a required `uid`, and Strapi fills uid fields only in the
      // admin panel — not through the content API or the Document Service.
      // Without this, POST /api/tags { data: { name } } was rejected 400
      // ("slug must be defined") and the client's createTagService swallowed
      // it, so a new tag typed in the share form was silently dropped.
      //
      // Order matters: normalize first, so the slug derives from the
      // normalized name and app-created tags line up with MCP-created ones.
      // An explicit slug (the MCP tools still pass one) is left alone.
      if (
        context.uid === 'api::tag.tag' &&
        context.action === 'create'
      ) {
        const data = (context.params as WithData).data ?? {};
        const raw = data.name as string | undefined;
        if (typeof raw === 'string') {
          data.name = normalizeTagName(raw);
        }
        if (!data.slug && typeof data.name === 'string') {
          data.slug = slugifyTagName(data.name);
        }
        (context.params as WithData).data = data;
      }

      return next();
    });


    // MCP tools are served by strapi-plugin-yt-kb (config/plugins.ts).
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // The Public role is READ-ONLY. Every write goes through the client's
    // server layer with STRAPI_API_TOKEN (strapi-client.ts), and the Astro
    // site only reads, at build time.
    //
    // It was not always so. This role previously held 11 write actions —
    // create/update on video, tag and transcript, plus create/update/DELETE
    // on note and digest — reachable with no credential at all. The comment
    // here claimed "delete stays admin-only", which was never true for note
    // or digest. On a LAN that is anyone on the network; on a public host it
    // is anyone with the URL.
    //
    // `await`ed so Strapi logs the result during startup and so the grants
    // are in place before the server accepts requests. The previous fire-
    // and-forget pattern had a startup race: the web server could answer
    // "403" for a brief window after the app was "ready".
    const actions = [
      'api::video.video.find',
      'api::video.video.findOne',
      'api::tag.tag.find',
      'api::tag.tag.findOne',
      'api::transcript.transcript.find',
      'api::transcript.transcript.findOne',
      'api::note.note.find',
      'api::note.note.findOne',
      'api::digest.digest.find',
      'api::digest.digest.findOne',
    ];

    try {
      const publicRole: any = await strapi
        .db.query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } });

      if (!publicRole) {
        strapi.log.warn('[bootstrap] public role not found — skipping grants');
        return;
      }

      let granted = 0;
      let existing = 0;
      for (const action of actions) {
        const hit = await strapi
          .db.query('plugin::users-permissions.permission')
          .findOne({ where: { action, role: publicRole.id } });
        if (hit) {
          existing += 1;
          continue;
        }
        await strapi
          .db.query('plugin::users-permissions.permission')
          .create({ data: { action, role: publicRole.id } });
        granted += 1;
      }

      // Seeding alone is not enough. The loop above only ADDS, so shortening
      // `actions` would leave every previously granted write row sitting in
      // the database, still live. Revoke anything this role should no longer
      // hold. Scoped to `api::` so plugin permissions are never touched.
      const held: Array<{ id: number; action: string }> = await strapi
        .db.query('plugin::users-permissions.permission')
        .findMany({ where: { role: publicRole.id } });
      let revoked = 0;
      for (const row of held) {
        if (!row.action.startsWith('api::')) continue;
        if (actions.includes(row.action)) continue;
        await strapi
          .db.query('plugin::users-permissions.permission')
          .delete({ where: { id: row.id } });
        strapi.log.info(`[bootstrap] revoked public permission: ${row.action}`);
        revoked += 1;
      }

      strapi.log.info(
        `[bootstrap] public permissions: granted=${granted}, already-present=${existing}, revoked=${revoked}, total=${actions.length}`,
      );
    } catch (err) {
      strapi.log.error('[bootstrap] public permission grant failed:', err);
    }
  },
};
