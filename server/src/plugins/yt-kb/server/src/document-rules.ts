import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { slugifyTagName } from './mcp/tools/tag-utils';
import { UNIQUE_CODE, UNIQUE_MESSAGE, isUniqueViolation } from './services/db-errors';

type WithData = { data?: Record<string, unknown> };

const VIDEO = 'plugin::yt-kb.video';
const TRANSCRIPT = 'plugin::yt-kb.transcript';
const TAG = 'plugin::yt-kb.tag';
const YT_KB_UIDS = new Set<string>([VIDEO, TRANSCRIPT, TAG, 'plugin::yt-kb.note', 'plugin::yt-kb.digest']);
const WRITE_ACTIONS = new Set<string>(['create', 'update']);

/** The one tag-name normalization. Every tag lookup and create in the
 *  plugin goes through it: trim, lower-case, collapse inner whitespace. */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The first free slug: `base`, else `base-2`, `base-3`, … (M-12: `c++`
 *  and `c#` both slugify to `c`; non-Latin names all become `tag`). */
export async function freeTagSlug(strapi: Core.Strapi, base: string): Promise<string> {
  const rows = (await strapi.db.query(TAG).findMany({
    where: { slug: { $startsWith: base } },
    select: ['slug'],
  })) as Array<{ slug: string }>;
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

async function applyCreateRules(strapi: Core.Strapi, uid: string, params: WithData) {
  // Video: require youtubeVideoId and return a readable error for a
  // duplicate. The unique index on youtube_video_id is the real gate; this
  // check only names the existing row.
  if (uid === VIDEO) {
    const data = params.data ?? {};
    const videoId = data.youtubeVideoId as string | undefined;
    if (!videoId) throw new errors.ApplicationError('youtubeVideoId is required');
    const existing: any = await strapi
      .documents(VIDEO as never)
      .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } } as never);
    if (existing) {
      throw new errors.ApplicationError(
        `A video for this id already exists. documentId=${existing.documentId}`,
        { code: UNIQUE_CODE, uid: VIDEO, field: 'youtubeVideoId', documentId: existing.documentId },
      );
    }
  }

  // Transcript: same.
  if (uid === TRANSCRIPT) {
    const data = params.data ?? {};
    const videoId = data.youtubeVideoId as string | undefined;
    if (!videoId) throw new errors.ApplicationError('youtubeVideoId is required on transcript');
    const existing: any = await strapi
      .documents(TRANSCRIPT as never)
      .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } } as never);
    if (existing) {
      throw new errors.ApplicationError(
        `A transcript for this id already exists. documentId=${existing.documentId}`,
        { code: UNIQUE_CODE, uid: TRANSCRIPT, field: 'youtubeVideoId', documentId: existing.documentId },
      );
    }
  }

  // Tag: normalize the name, then generate a free slug. `slug` is a
  // required uid and Strapi fills uid fields only in the admin panel, so
  // without this every API-created tag fails 400 "slug must be defined".
  // An explicit slug (the importer, the admin panel) is left alone.
  if (uid === TAG) {
    const data = params.data ?? {};
    if (typeof data.name === 'string') data.name = normalizeTagName(data.name);
    if (!data.slug && typeof data.name === 'string') {
      data.slug = await freeTagSlug(strapi, slugifyTagName(data.name));
    }
    params.data = data;
  }
}

function applyUpdateRules(uid: string, params: WithData) {
  // Tag: a renamed tag is normalized like a created one, so lookups by the
  // normalized name keep finding it. The slug is left as it is: changing it
  // would break links to the tag.
  if (uid === TAG && typeof params.data?.name === 'string') {
    params.data.name = normalizeTagName(params.data.name);
  }
}

/**
 * Document Service rules for this plugin's own types. Each rule checks the
 * UID first, so in a host app they never touch anything but yt-kb data.
 * Registered from register() so they apply to every create path: REST from
 * the app, MCP tools, the admin panel, scripts.
 *
 * Every duplicate on a yt-kb write leaves here in one of two shapes, both
 * a 400 with `details.code === UNIQUE_CODE`:
 *  - yt-kb's own "A … already exists. documentId=…" (the create rules
 *    above), passed through unchanged because it names the row;
 *  - everything else, rethrown as `ValidationError(UNIQUE_MESSAGE)`:
 *    Strapi's validator on one attribute ("This attribute must be
 *    unique") or on several at once (a lost tag race fails `name` and
 *    `slug` → yup's "2 errors occurred", recognised by `details.errors[]`),
 *    and a raw unique-index error from two writes at once, which would
 *    otherwise reach REST as a 500 (see services/db-errors.ts).
 */
export function registerDocumentRules(strapi: Core.Strapi) {
  strapi.documents.use(async (context, next) => {
    const uid = context.uid as string;
    if (!YT_KB_UIDS.has(uid) || !WRITE_ACTIONS.has(context.action)) return next();

    if (context.action === 'create') await applyCreateRules(strapi, uid, context.params as WithData);
    if (context.action === 'update') applyUpdateRules(uid, context.params as WithData);

    try {
      return await next();
    } catch (err) {
      const ownDuplicate =
        err instanceof errors.ApplicationError &&
        (err.details as { code?: unknown } | undefined)?.code === UNIQUE_CODE;
      if (!ownDuplicate && isUniqueViolation(err)) {
        throw new errors.ValidationError(UNIQUE_MESSAGE, { code: UNIQUE_CODE });
      }
      throw err;
    }
  });
}
