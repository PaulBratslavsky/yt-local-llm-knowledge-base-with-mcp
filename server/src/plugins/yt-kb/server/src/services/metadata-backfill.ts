import type { Core } from '@strapi/strapi';
import { transcriptMetadataData, YOUTUBE_VIDEO_ID } from './fetcher';
import { fetchYouTubeMetadata } from './youtube-transcript';

// Fills the metadata on transcripts stored before M3 (M2's new fields, plus
// author / thumbnailUrl / durationSec where YouTube has them). Same semantics
// as strapi-plugin-youtube-transcripts' backfill (YT L367-438): at most
// `limit` rows per boot, a pause after each YouTube call, one failure never
// stops the run. Differences: it reads only rows that still need it
// (`thumbnails` is null), paged by id; metadata only — no caption download;
// rawSegments, rawText, fetchedAt and `language` are left alone — and only
// non-null values are written, so a field YouTube omits keeps what it had.
// `language` is not re-derived for existing rows: a metadata call cannot
// tell which caption track the stored rawSegments came from, so the row
// keeps its old 'en' until a forced re-fetch (`force: true`) rewrites the
// captions and their language together. Started from bootstrap.ts when the
// plugin config has `backfillMetadata: true`.

const UID = 'plugin::yt-kb.transcript';

export const BACKFILL_FIELDS = [
  'channelId',
  'thumbnails',
  'viewCount',
  'description',
  'keywords',
  'category',
  'videoPublishedAt',
] as const;

export type BackfillResult = {
  scanned: number;
  updated: number;
  skipped: number;
  failed: Array<{ videoId: string; reason: string }>;
};

export function needsMetadataBackfill(row: Record<string, unknown>): boolean {
  const missing = (field: string) => row[field] === null || row[field] === undefined;
  return BACKFILL_FIELDS.every(missing) || missing('thumbnails');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rows read per findMany. */
const PAGE_SIZE = 100;

export async function backfillTranscriptMetadata(
  strapi: Core.Strapi,
  options: { proxyUrl?: string; limit?: number; pauseMs?: number } = {},
): Promise<BackfillResult> {
  const result: BackfillResult = { scanned: 0, updated: 0, skipped: 0, failed: [] };
  const limit = options.limit ?? 500;
  // needsMetadataBackfill(row) is true exactly when `thumbnails` is missing
  // (thumbnails is one of BACKFILL_FIELDS), so this filter reads the same
  // rows it would accept. Paged by id rather than by offset: a row this run
  // fills leaves the filter, and an offset would then skip the next one.
  let lastId = 0;
  while (result.scanned < limit) {
    const rows = (await strapi.documents(UID as never).findMany({
      filters: { thumbnails: { $null: true }, id: { $gt: lastId } },
      sort: 'id:asc',
      limit: Math.min(PAGE_SIZE, limit - result.scanned),
      fields: ['youtubeVideoId', ...BACKFILL_FIELDS],
    } as never)) as Array<Record<string, any>>;
    if (rows.length === 0) break;
    lastId = Number(rows[rows.length - 1].id);
    result.scanned += rows.length;

    for (const row of rows) {
      if (!needsMetadataBackfill(row)) {
        result.skipped += 1;
        continue;
      }
      const videoId = String(row.youtubeVideoId ?? '');
      if (!YOUTUBE_VIDEO_ID.test(videoId)) {
        result.failed.push({ videoId: videoId || '(missing)', reason: 'row has no valid youtubeVideoId' });
        continue;
      }
      try {
        const meta = await fetchYouTubeMetadata(videoId, { proxyUrl: options.proxyUrl });
        // `language` is left alone (see the header comment).
        const data = Object.fromEntries(
          Object.entries(transcriptMetadataData(meta)).filter(
            ([k, v]) => k !== 'language' && v !== null && v !== undefined,
          ),
        );
        if (Object.keys(data).length === 0) throw new Error('YouTube returned no metadata');
        await strapi.documents(UID as never).update({ documentId: row.documentId, data: data as never });
        result.updated += 1;
        strapi.log.info(`[yt-kb] backfilled metadata for ${videoId}`);
      } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error)).slice(0, 120);
        result.failed.push({ videoId, reason });
        strapi.log.warn(`[yt-kb] metadata backfill failed for ${videoId}: ${reason}`, { videoId, reason });
      }
      await sleep(options.pauseMs ?? 1500);
    }
  }

  strapi.log.info(
    `[yt-kb] metadata backfill complete: ${result.updated} updated, ${result.skipped} already had metadata, ${result.failed.length} failed`,
  );
  return result;
}
