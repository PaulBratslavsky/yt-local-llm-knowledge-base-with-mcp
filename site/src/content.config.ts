import { defineCollection } from 'astro:content';
import type { Loader } from 'astro/loaders';
import { fetchGeneratedVideos } from './lib/strapi';
import { videoSchema } from './lib/video';

/** Build-time only. No runtime call to Strapi, so no base URL and no
 *  credentials ever reach the published output. */
const STRAPI_BASE_URL =
  process.env.STRAPI_BASE_URL ??
  import.meta.env.STRAPI_BASE_URL ??
  'http://localhost:1340/api';

/** Reads the library straight from Strapi's REST API.
 *
 *  Hand-rolled rather than using `strapi-community-astro-loader`: its latest
 *  release pins `engines.node` to a single Node minor this repo is past. The
 *  query it would have built lives in `lib/strapi.ts` instead, where the
 *  field allowlist that keeps retrieval state out of the output is covered by
 *  tests. */
const strapiVideoLoader: Loader = {
  name: 'yt-kb-strapi-videos',
  load: async ({ store, parseData, logger, generateDigest }) => {
    // `astro sync` runs loaders, and CI typechecks without a Strapi. The
    // flag exists for that one case. It is never set by a build path, and
    // verify-output.mjs fails the build if it ever is — an empty site
    // published quietly is the outcome this whole package is built to avoid.
    if (process.env.SITE_SKIP_STRAPI_FETCH === '1') {
      logger.warn(
        'SITE_SKIP_STRAPI_FETCH=1 — no videos loaded. Valid for sync and ' +
          'typecheck only; a build made this way publishes nothing.',
      );
      return;
    }

    logger.info(`Fetching videos from ${STRAPI_BASE_URL}`);

    const rows = await fetchGeneratedVideos({ baseUrl: STRAPI_BASE_URL });

    store.clear();
    for (const row of rows) {
      // Slugs are the YouTube id, not a title slug: summary titles change
      // when a summary is regenerated, the video id never does.
      const id = (row as { youtubeVideoId?: unknown }).youtubeVideoId;
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          'A published video row has no youtubeVideoId, so it has no stable URL. ' +
            'Refusing to build.',
        );
      }
      const data = await parseData({ id, data: row as Record<string, unknown> });
      store.set({ id, data, digest: generateDigest(data) });
    }

    logger.info(`Loaded ${rows.length} videos`);
  },
};

const videos = defineCollection({
  loader: strapiVideoLoader,
  schema: videoSchema,
});

export const collections = { videos };
