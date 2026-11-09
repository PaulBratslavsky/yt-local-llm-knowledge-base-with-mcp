import type { Core } from '@strapi/strapi';
import { extractYouTubeId } from '../services/fetcher';
import { TranscriptFetchError, transcriptFetchErrorResponse } from '../services/fetch-errors';

// POST /api/yt-kb/transcripts/fetch  { data: { videoId, force? } }   scope plugin::yt-kb.fetcher.fetchTranscript
//   → 200 { data, meta: { action: created | updated | skipped } }
// GET  /api/yt-kb/yt-transcript/:videoId (content API)                scope plugin::yt-kb.fetcher.getOrFetch
// GET  /yt-kb/yt-transcript/:videoId     (admin, plugin::yt-kb.tool.fetch-transcript)
//   → 200 { data } when stored (no YouTube call), else fetch + store → 200 { data, meta: { action: 'created' } }
// A TranscriptFetchError answers with services/fetch-errors.ts's status and body.
// fetchAndStore already logged it; this file does not log.
const TRANSCRIPT_UID = 'plugin::yt-kb.transcript';

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const fetcher = () => strapi.plugin('yt-kb').service('fetcher');

  const sendTranscript = async (ctx: any, transcript: Record<string, unknown>, meta?: Record<string, unknown>) => {
    const schema = strapi.getModel(TRANSCRIPT_UID as never);
    ctx.body = {
      data: await strapi.contentAPI.sanitize.output(transcript, schema, { auth: ctx.state.auth }),
      ...(meta ? { meta } : {}),
    };
  };

  // TranscriptFetchError → mapped status and body; anything else goes to Strapi's error middleware.
  const sendFetchError = (ctx: any, err: unknown) => {
    if (!(err instanceof TranscriptFetchError)) throw err;
    const { status, body } = transcriptFetchErrorResponse(err);
    ctx.status = status;
    ctx.body = body;
  };

  return {
    async fetchTranscript(ctx: any) {
      const { videoId, force } = ctx.request.body?.data ?? {};
      if (force !== undefined && typeof force !== 'boolean') {
        return ctx.badRequest('data.force must be true or false');
      }
      try {
        const result = await fetcher().fetchAndStore(typeof videoId === 'string' ? videoId : '', {
          force: force === true,
        });
        await sendTranscript(ctx, result.transcript, { action: result.action });
      } catch (err) {
        sendFetchError(ctx, err);
      }
    },

    async getOrFetch(ctx: any) {
      const raw = String(ctx.params?.videoId ?? '');
      // An unparseable value is passed through so fetchAndStore rejects (and logs) it as invalid_id.
      const videoId = extractYouTubeId(raw) ?? raw;
      try {
        const result = await fetcher().fetchAndStore(videoId, { force: false });
        await sendTranscript(
          ctx,
          result.transcript,
          result.action === 'skipped' ? undefined : { action: result.action },
        );
      } catch (err) {
        sendFetchError(ctx, err);
      }
    },
  };
};
