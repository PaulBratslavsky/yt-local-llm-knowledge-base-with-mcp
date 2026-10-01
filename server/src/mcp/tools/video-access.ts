// Shared Video access for the MCP tools.
//
// Seven tools wrote out the same two-step "resolve by youtubeVideoId, else
// documentId" lookup, each choosing its own populate set, its own cast and
// its own not-found wording. That duplication is also what let the
// `pagination: { start, limit }` bug (#2) sit in thirteen separate places:
// when the query shape is written once per tool, fixing it means finding
// every copy.

import type { Core } from '@strapi/strapi';

/** A Video row as the tools see it: unknown fields plus the bits every
 *  caller touches. Individual tools narrow further where they need to. */
export type VideoRow = Record<string, unknown> & {
  documentId: string;
  youtubeVideoId: string;
  tags?: Array<{ name: string }>;
};

type Populate = Record<string, unknown>;

/** Resolve a video by either identifier.
 *
 *  Callers accept both because the two audiences differ: a human pasting
 *  from the app has a youtubeVideoId, while a tool chaining off an earlier
 *  result has a documentId.
 *
 *  Generic in the row type so a caller that populates extra fields states
 *  what it gets back instead of casting the result. */
export async function resolveByEitherId<T = VideoRow>(
  strapi: Core.Strapi,
  videoId: string,
  opts: { populate?: Populate; fields?: string[] } = {},
): Promise<T | null> {
  const query = {
    ...(opts.populate ? { populate: opts.populate } : {}),
    ...(opts.fields ? { fields: opts.fields } : {}),
  };

  const byYoutubeId = (await strapi.documents('api::video.video').findFirst({
    filters: { youtubeVideoId: { $eq: videoId } },
    ...query,
  } as never)) as T | null;
  if (byYoutubeId) return byYoutubeId;

  return (await strapi.documents('api::video.video').findOne({
    documentId: videoId,
    ...query,
  } as never)) as T | null;
}

/** The not-found result shape these tools already use — a successful call
 *  carrying `{ error }`, not a thrown exception. */
export function videoNotFound(videoId: string): { error: string } {
  return { error: `No video found for "${videoId}".` };
}

/** Populate sets, named so a tool states what it needs rather than
 *  restating the shape. */
export const POPULATE = {
  /** Summary surface: everything the full record view shows. */
  full: {
    tags: { fields: ['name'] },
    keyTakeaways: true,
    sections: true,
    actionSteps: true,
  },
  /** Just the tags, for tagging and aggregation. */
  tags: { tags: { fields: ['name'] } },
} as const;
