import { z } from 'astro/zod';

/** Server-side retrieval state. These are the bulk of a Video row and must
 *  never reach the published output: the BM25 token tables, the per-video
 *  vector, and the per-passage vectors. The allowlist below is how that is
 *  enforced — they are simply never requested. */
export const FORBIDDEN_FIELDS = [
  'transcriptSegments',
  'summaryEmbedding',
  'passageEmbeddings',
] as const;

/** The only Video fields the site fetches. Adding a field here is a
 *  deliberate act; anything absent cannot appear in the output. */
export const VIDEO_FIELDS = [
  'youtubeVideoId',
  'url',
  'videoTitle',
  'videoAuthor',
  'videoThumbnailUrl',
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
