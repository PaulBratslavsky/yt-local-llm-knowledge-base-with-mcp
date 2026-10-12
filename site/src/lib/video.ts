import { z } from 'astro/zod';

/** Server-side retrieval state. These are the bulk of a Video row and must
 *  never reach the published output: the BM25 token tables, the per-video
 *  vector, and the per-passage vectors. The allowlist below is how that is
 *  enforced — they are simply never requested. */
export const FORBIDDEN_FIELDS = [
  'transcriptSegments',
  'summaryEmbedding',
  'passageEmbeddings',
  // The Transcript relation's own fields. Nothing populates it today, but a
  // future `populate[transcript]` would publish other people's spoken words
  // verbatim — the spec excludes raw transcripts for that reason as much as
  // for size.
  'rawText',
  'rawSegments',
] as const;

/** The only Video fields the site fetches. Adding a field here is a
 *  deliberate act; anything absent cannot appear in the output. */
export const VIDEO_FIELDS = [
  'youtubeVideoId',
  'videoTitle',
  'videoAuthor',
  'summaryTitle',
  'summaryDescription',
  'summaryOverview',
  'watchVerdict',
  'verdictSummary',
  'verdictReason',
  'finalScore',
  'summaryGeneratedAt',
  'readableArticle',
] as const;

export const videoSchema = z.object({
  youtubeVideoId: z.string(),
  url: z.string().nullable().optional(),
  videoTitle: z.string().nullable().optional(),
  videoAuthor: z.string().nullable().optional(),
  videoThumbnailUrl: z.string().nullable().optional(),
  summaryTitle: z.string().nullable().optional(),
  summaryDescription: z.string().nullable().optional(),
  summaryOverview: z.string().nullable().optional(),
  watchVerdict: z.enum(['worth_it', 'skim', 'skip']).nullable().optional(),
  verdictSummary: z.string().nullable().optional(),
  verdictReason: z.string().nullable().optional(),
  finalScore: z.number().nullable().optional(),
  summaryGeneratedAt: z.string().nullable().optional(),
  readableArticle: z.string().nullable().optional(),
  keyTakeaways: z.array(z.object({ text: z.string() })).default([]),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string().nullable().optional(),
        // Absent when BM25 found no confident match. Never invent one.
        timeSec: z.number().nullable().optional(),
      }),
    )
    .default([]),
  actionSteps: z
    .array(
      z.object({
        title: z.string(),
        body: z.string().nullable().optional(),
      }),
    )
    .default([]),
  tags: z.array(z.object({ name: z.string() })).default([]),
});

export type Video = z.infer<typeof videoSchema>;

/** The title to show: the model's summary title when it wrote one, else
 *  YouTube's. */
export function displayTitle(video: Video): string {
  return video.summaryTitle?.trim() || video.videoTitle?.trim() || video.youtubeVideoId;
}

/** A YouTube link, optionally seeking to a section's start.
 *
 *  Returns the plain watch URL when `timeSec` is absent — a section the
 *  pipeline could not ground gets no timecode rather than `t=0s`, which
 *  would be a fabricated claim about where the content is (ADR-0004). */
export function youtubeUrlAt(youtubeVideoId: string, timeSec?: number | null): string {
  const base = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  if (typeof timeSec !== 'number' || !Number.isFinite(timeSec) || timeSec < 0) {
    return base;
  }
  return `${base}&t=${Math.floor(timeSec)}s`;
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
