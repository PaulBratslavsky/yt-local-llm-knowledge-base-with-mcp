// BM25 search within a single transcript, in this order:
//   1. the app's contextual index on Video.transcriptSegments, when current;
//   2. the transcript's model-free index (Transcript.searchIndex), built and
//      saved on first use — so a video added over MCP, or a transcript
//      fetched without a Video row, is searchable too;
//   3. substring scoring over the raw segments (reached only when the
//      segments yield no index).

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';
import { formatTimecode, loadStoredIndex, searchBM25, type TranscriptChunk } from '../../services/bm25-search';
import {
  ensureTranscriptSearchIndex,
  loadTranscriptSearchIndex,
  type TranscriptIndexSource,
} from '../../services/search-index';

const schema = z.object({
  videoId: z.string().min(1).describe('YouTube video id to search within.'),
  query: z
    .string()
    .min(2)
    .max(300)
    .describe('Natural-language search query. Multi-word phrases work; stopwords are ignored.'),
  k: z.number().int().min(1).max(25).default(8).describe('Top-k chunks to return. Default 8.'),
});

type TranscriptRow = TranscriptIndexSource & { title?: string | null };
type VideoRow = {
  youtubeVideoId: string;
  videoTitle?: string | null;
  transcriptSegments?: unknown;
  transcript?: TranscriptRow | null;
};

const TRANSCRIPT_FIELDS = ['title', 'searchIndex', 'rawSegments', 'durationSec'];
// searchIndex is private, and Strapi 5.61 rejects a private attribute inside a
// populate's `fields`: the populated transcript leaves it out and it is read
// root-level (services/search-index.ts).
const POPULATED_TRANSCRIPT_FIELDS = ['documentId', 'title', 'rawSegments', 'durationSec'];

export const searchTranscriptTool: ToolDef<z.infer<typeof schema>> = {
  name: 'searchTranscript',
  description:
    'BM25 full-text search INSIDE a single already-known transcript. REQUIRES a videoId — do not call this when the user only gave you a title or description; use `searchVideos` first to find the videoId. Returns top-k passages with timecodes, ideal for answering fine-grained questions grounded in that video. Works for any stored transcript, summarized or not. Use `findTranscripts` for cross-video discovery, `searchVideos` for catalog-level title lookup.',
  schema,
  execute: async ({ videoId, query, k }, { strapi }) => {
    const video = (await strapi.documents('plugin::yt-kb.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
      fields: ['youtubeVideoId', 'videoTitle', 'transcriptSegments'],
      populate: { transcript: { fields: POPULATED_TRANSCRIPT_FIELDS } },
    } as never)) as unknown as VideoRow | null;

    // 1. The app's contextual index.
    const videoIndex = loadStoredIndex(video?.transcriptSegments);
    if (video && videoIndex) {
      return {
        videoId,
        title: video.videoTitle ?? null,
        source: 'bm25',
        query,
        results: searchBM25(videoIndex.bm25, query, k).map((r) => formatResult(r.chunk, r.score)),
      };
    }

    const transcript = video?.transcript
      ? { ...video.transcript, ...((await loadTranscriptSearchIndex(strapi, video.transcript.documentId)) ?? {}) }
      : ((await strapi.documents('plugin::yt-kb.transcript').findFirst({
          filters: { youtubeVideoId: { $eq: videoId } },
          fields: TRANSCRIPT_FIELDS,
        } as never)) as unknown as TranscriptRow | null);
    if (!video && !transcript) {
      return { error: `No video or transcript found for videoId "${videoId}".` };
    }
    const title = video?.videoTitle ?? transcript?.title ?? null;

    // 2. The transcript's own index.
    const transcriptIndex = transcript ? await ensureTranscriptSearchIndex(strapi, transcript) : null;
    if (transcriptIndex) {
      return {
        videoId,
        title,
        source: 'bm25-transcript',
        query,
        results: searchBM25(transcriptIndex.bm25, query, k).map((r) => formatResult(r.chunk, r.score)),
      };
    }

    // 3. Substring fallback.
    const segments = transcript?.rawSegments ?? [];
    if (segments.length === 0) {
      return { error: `No searchable transcript for videoId "${videoId}". Call fetchTranscript to store one.` };
    }
    const q = query.toLowerCase();
    const hits = segments
      .map((seg, idx) => ({
        seg,
        idx,
        score: (seg.text.toLowerCase().match(new RegExp(escapeRegex(q), 'g')) ?? []).length,
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return {
      videoId,
      title,
      source: 'substring',
      query,
      results: hits.map((h) => ({
        timecode: formatTimecode(Math.floor(h.seg.startMs / 1000)),
        timeSec: Math.floor(h.seg.startMs / 1000),
        text: h.seg.text,
        score: h.score,
      })),
    };
  },
};

function formatResult(chunk: TranscriptChunk, score: number) {
  return {
    timecode: formatTimecode(chunk.timeSec),
    timeSec: chunk.timeSec,
    text: chunk.text,
    score: Number(score.toFixed(4)),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
