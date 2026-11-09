// BM25 search across many transcripts in one call: the top-k chunks per
// video, videos ordered by their best hit. Each video is searched with the
// app's contextual index (Video.transcriptSegments) when current, else its
// transcript's model-free index (built and saved on first use). Every video
// with a stored transcript is searched, summarized or not — a video added
// over MCP is still `pending` and must not be invisible here. There is no
// substring fallback: it needs the segments, and segments always yield an
// index.
//
// Optional tag filter so the scope matches the user's framing ("what do my
// rag videos say about chunking?" → tags: ['rag'], query: 'chunking').
// Capped per video to keep the response small — call `searchTranscript`
// on one video for more.

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';
import { normalizeTagName } from '../../document-rules';
import { formatTimecode, loadStoredIndex, searchBM25, type StoredTranscriptIndex } from '../../services/bm25-search';
import { ensureTranscriptSearchIndex, loadTranscriptSearchIndexes } from '../../services/search-index';

const schema = z.object({
  query: z.string().min(2).max(300),
  tags: z
    .array(z.string().min(1).max(40))
    .max(10)
    .optional()
    .describe('Optional tag filter — limit the search to videos with any of these tags.'),
  perVideo: z.number().int().min(1).max(10).default(3).describe('Max chunks to return per video.'),
  maxVideos: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Max videos to scan, newest first. Videos with no stored transcript are skipped.'),
});

type VideoRow = {
  youtubeVideoId: string;
  videoTitle?: string | null;
  summaryTitle?: string | null;
  transcriptSegments?: unknown;
  tags?: Array<{ name: string }>;
  transcript?: { documentId: string } | null;
};

export const crossSearchTranscriptsTool: ToolDef<z.infer<typeof schema>> = {
  name: 'crossSearchTranscripts',
  description:
    'BM25 search across multiple transcripts in a single call. Returns top-k passages per matching video with timecodes — ideal for "what do my `rag` videos say about chunking?" style questions. Optional tag filter scopes the search. Use `searchTranscript` instead when you already know the specific videoId.',
  schema,
  execute: async ({ query, tags, perVideo, maxVideos }, { strapi }) => {
    const filters: Record<string, unknown> = {};
    if (tags && tags.length > 0) {
      filters.tags = { name: { $in: tags.map(normalizeTagName) } };
    }

    const videos = (await strapi.documents('plugin::yt-kb.video').findMany({
      filters,
      limit: maxVideos,
      sort: 'createdAt:desc',
      fields: ['youtubeVideoId', 'videoTitle', 'summaryTitle', 'transcriptSegments'],
      populate: {
        tags: { fields: ['name'] },
        // Only the id: searchIndex is private, and Strapi 5.61 rejects it inside a
        // populate's `fields`. The indexes are read below in one root-level query
        // (rawSegments only for rows that need a build).
        transcript: { fields: ['documentId'] },
      },
    } as never)) as unknown as VideoRow[];

    const perVideoResults: Array<{
      youtubeVideoId: string;
      videoTitle: string | null;
      tags: string[];
      indexSource: 'bm25' | 'bm25-transcript';
      topScore: number;
      passages: Array<{ timecode: string; timeSec: number; text: string; score: number }>;
    }> = [];

    // Transcript indexes for the videos the app has not indexed: one query for all of them.
    const transcriptRows = await loadTranscriptSearchIndexes(
      strapi,
      videos
        .filter((v) => v.transcript && !loadStoredIndex(v.transcriptSegments))
        .map((v) => v.transcript!.documentId),
    );

    for (const v of videos) {
      let index: StoredTranscriptIndex | null = loadStoredIndex(v.transcriptSegments);
      let indexSource: 'bm25' | 'bm25-transcript' = 'bm25';
      const transcriptRow = v.transcript ? transcriptRows.get(v.transcript.documentId) : undefined;
      if (!index && transcriptRow) {
        index = await ensureTranscriptSearchIndex(strapi, transcriptRow);
        indexSource = 'bm25-transcript';
      }
      if (!index) continue;
      const ranked = searchBM25(index.bm25, query, perVideo);
      if (ranked.length === 0) continue;
      perVideoResults.push({
        youtubeVideoId: v.youtubeVideoId,
        videoTitle: v.videoTitle ?? v.summaryTitle ?? null,
        tags: (v.tags ?? []).map((t) => t.name),
        indexSource,
        topScore: ranked[0].score,
        passages: ranked.map((r) => ({
          timecode: formatTimecode(r.chunk.timeSec),
          timeSec: r.chunk.timeSec,
          text: r.chunk.text,
          score: Number(r.score.toFixed(4)),
        })),
      });
    }
    // Strongest matches first.
    perVideoResults.sort((a, b) => b.topScore - a.topScore);

    return {
      query,
      tags: tags ?? null,
      videosScanned: videos.length,
      videosWithHits: perVideoResults.length,
      results: perVideoResults,
      ...(perVideoResults.length === 0
        ? {
            hint: "No transcripts had passages matching that query. Try different terms, drop the tag filter, or call `listVideos` to see what's actually in the KB.",
          }
        : {}),
    };
  },
};
