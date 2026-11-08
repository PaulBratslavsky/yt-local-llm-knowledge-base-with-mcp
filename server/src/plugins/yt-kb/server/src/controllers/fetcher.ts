import type { Core } from '@strapi/strapi';
import { YOUTUBE_VIDEO_ID } from '../services/fetcher';

// POST /api/yt-kb/transcripts/fetch  { data: { videoId, force? } }
// Fetches the transcript from YouTube and stores it, or returns the stored
// one (force re-fetches). Responds { data: <transcript>, meta: { action } }.
// Scope plugin::yt-kb.fetcher.fetchTranscript — granted to no role.
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async fetchTranscript(ctx: any) {
    const { videoId, force } = ctx.request.body?.data ?? {};
    if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID.test(videoId)) {
      return ctx.badRequest('data.videoId must be an 11-character YouTube video id');
    }
    if (force !== undefined && typeof force !== 'boolean') {
      return ctx.badRequest('data.force must be true or false');
    }

    let result;
    try {
      result = await strapi
        .plugin('yt-kb')
        .service('fetcher')
        .fetchAndStore(videoId, { force: force === true });
    } catch (err) {
      // YouTube refused or failed (no captions, bot wall, network). 502:
      // the request was fine, the upstream wasn't.
      const message = err instanceof Error ? err.message : 'Transcript fetch failed';
      strapi.log.warn(`[yt-kb] transcript fetch failed for ${videoId}: ${message}`);
      ctx.status = 502;
      ctx.body = { data: null, error: { status: 502, name: 'TranscriptFetchError', message } };
      return;
    }

    const schema = strapi.getModel('plugin::yt-kb.transcript' as never);
    ctx.body = {
      data: await strapi.contentAPI.sanitize.output(result.transcript, schema, {
        auth: ctx.state.auth,
      }),
      meta: { action: result.action },
    };
  },
});
