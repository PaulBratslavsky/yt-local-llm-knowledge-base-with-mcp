import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  createVideoService,
  fetchFeedService,
  fetchVideoByDocumentIdService,
  fetchVideoByVideoIdService,
  fetchTranscriptByVideoIdService,
  listAllVideosForEmbeddingService,
  markSummaryFailedService,
  markSummaryPendingService,
  searchTagsService,
  updateSectionTimecodeService,
  updateVideoEmbeddingService,
  updateVideoPassagesService,
  type PaginatedVideos,
  type StrapiTag,
  type StrapiVideo,
} from '#/lib/services/videos';
import {
  aggregateTagsFromNeighbors,
  computePassageIndex,
  computeVideoEmbedding,
  cosineSimilarity,
  embedText,
  embeddingStatus,
  passageStatus,
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_VERSION,
  CURRENT_PASSAGE_VERSION,
  type PassageStatus,
  type SuggestedTag,
  type VideoEmbeddingStatus,
} from '#/lib/services/embeddings';
import {
  fetchYouTubeMeta,
  generateVideoSummary,
  askAboutVideoService,
  readGenerationStep,
  type ChatMessage,
  type GenerationStep,
} from '#/lib/services/learning';
import {
  buildBM25Index,
  extractCitationsWithEvidence,
  isStoredIndex,
  searchBM25,
  tokenize,
  type EvidenceCitation,
  type TranscriptChunk,
} from '#/lib/services/transcript';
import {
  CreateVideoInputSchema,
  GenerationModeSchema,
  extractYouTubeVideoId,
  parseTagInput,
  type GenerationMode,
} from '#/lib/validations/post';

// =============================================================================
// Feed
// =============================================================================

const FeedQuerySchema = z.object({
  page: z.number().int().min(1).max(1000).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  q: z.string().max(200).optional(),
  tag: z.string().max(80).optional(),
});

export const getFeed = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof FeedQuerySchema>) => FeedQuerySchema.parse(data))
  .handler(async ({ data }): Promise<PaginatedVideos> => {
    return await fetchFeedService(data);
  });

// =============================================================================
// Single-video lookups
// =============================================================================

const VideoIdSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\w-]+$/, 'Invalid video id'),
});

const DocumentIdSchema = z.object({ documentId: z.string().min(1) });

export const getVideoByDocumentId = createServerFn({ method: 'GET' })
  .inputValidator((data: { documentId: string }) => DocumentIdSchema.parse(data))
  .handler(async ({ data }): Promise<StrapiVideo | null> => {
    return await fetchVideoByDocumentIdService(data.documentId);
  });

export const getVideoByVideoId = createServerFn({ method: 'GET' })
  .inputValidator((data: { videoId: string }) => VideoIdSchema.parse(data))
  .handler(async ({ data }): Promise<StrapiVideo | null> => {
    return await fetchVideoByVideoIdService(data.videoId);
  });

// =============================================================================
// Share a video
//
// Extract video id → oEmbed metadata → create Video row → fire-and-forget
// the AI summary generation. By the time the user clicks through to
// /learn/$videoId the summary is usually done (or polling catches it).
// =============================================================================

const ShareVideoInputSchema = z.object({
  url: z.string().url(),
  caption: z.string().max(500).optional(),
  tags: z.string().max(240).optional(),
  mode: GenerationModeSchema.optional(),
});

export type ShareVideoResult =
  | { status: 'created'; video: StrapiVideo }
  | { status: 'exists'; video: StrapiVideo }
  | { status: 'error'; error: string };

// Shared in-memory set of videoIds for which a background generation is
// currently running. Previously split into two Sets (one for the share
// kickoff, one for trigger/regenerate) which let the SAME videoId run
// TWICE concurrently: the share flow kicked off gen A, then the learn
// page loader's trigger call didn't see gen A and kicked off gen B. Both
// writing to the same Video row, competing for GPU time, halving effective
// throughput. Single Set fixes it.
const generationInflight = new Set<string>();

function kickoffSummaryGeneration(videoId: string, mode?: GenerationMode) {
  if (generationInflight.has(videoId)) return;
  generationInflight.add(videoId);
  void (async () => {
    try {
      const result = await generateVideoSummary(videoId, { mode });
      if (!result.success) {
        console.error('[summary bg] failed', { videoId, error: result.error });
      }
    } catch (err) {
      // Last-resort catch: mark the Video row as failed so the UI flips out
      // of pending. Otherwise a crashed bg job leaves the row at
      // summaryStatus: 'pending' forever and the learn page polls forever.
      const message = err instanceof Error ? err.message : 'Generation crashed';
      console.error('[summary bg] exception', { videoId, err });
      const video = await fetchVideoByVideoIdService(videoId);
      if (video) await markSummaryFailedService(video.documentId);
      recentFailures.set(videoId, { error: message, at: Date.now() });
    } finally {
      generationInflight.delete(videoId);
    }
  })();
}

export const shareVideo = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof ShareVideoInputSchema>) =>
    ShareVideoInputSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ShareVideoResult> => {
    const videoId = extractYouTubeVideoId(data.url);
    if (!videoId) {
      return { status: 'error', error: "Doesn't look like a YouTube URL" };
    }

    const alreadyExists = await fetchVideoByVideoIdService(videoId);
    if (alreadyExists) return { status: 'exists', video: alreadyExists };

    const parsed = CreateVideoInputSchema.parse({
      videoId,
      url: data.url,
      caption: data.caption,
      tagNames: parseTagInput(data.tags ?? ''),
    });

    const meta = await fetchYouTubeMeta(videoId);

    const result = await createVideoService({
      videoId: parsed.videoId,
      url: parsed.url,
      caption: parsed.caption,
      tagNames: parsed.tagNames,
      videoTitle: meta.title,
      videoAuthor: meta.author,
      videoThumbnailUrl:
        meta.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });

    if (!result.success) {
      if (result.kind === 'exists') return { status: 'exists', video: result.video };

      // Race recovery — if the server dedupe check caught what our pre-check
      // missed, re-fetch and surface as 'exists' for clean redirect.
      if (/already exists/i.test(result.error)) {
        const recovered = await fetchVideoByVideoIdService(videoId);
        if (recovered) return { status: 'exists', video: recovered };
      }
      return { status: 'error', error: result.error };
    }

    kickoffSummaryGeneration(videoId, data.mode);
    return { status: 'created', video: result.video };
  });

// =============================================================================
// Summary lifecycle — trigger + clear for retry
// =============================================================================

export type TriggerResult =
  | { status: 'found'; video: StrapiVideo }
  | { status: 'started' }
  | { status: 'error'; error: string };

// `inflight` is an alias to the shared set — kept as a local name here
// for readability in the trigger/regenerate handlers below.
const inflight = generationInflight;
type RecentFailure = { error: string; at: number };
const recentFailures = new Map<string, RecentFailure>();
const FAILURE_TTL_MS = 5 * 60 * 1000;

function readRecentFailure(videoId: string): string | null {
  const entry = recentFailures.get(videoId);
  if (!entry) return null;
  if (Date.now() - entry.at > FAILURE_TTL_MS) {
    recentFailures.delete(videoId);
    return null;
  }
  return entry.error;
}

const TriggerInputSchema = VideoIdSchema.extend({
  mode: GenerationModeSchema.optional(),
});

export const triggerSummaryGeneration = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof TriggerInputSchema>) =>
    TriggerInputSchema.parse(data),
  )
  .handler(async ({ data }): Promise<TriggerResult> => {
    const existing = await fetchVideoByVideoIdService(data.videoId);
    if (existing && existing.summaryStatus === 'generated') {
      recentFailures.delete(data.videoId);
      return { status: 'found', video: existing };
    }

    if (inflight.has(data.videoId)) return { status: 'started' };

    const previousError = readRecentFailure(data.videoId);
    if (previousError) return { status: 'error', error: previousError };

    inflight.add(data.videoId);
    void (async () => {
      try {
        const result = await generateVideoSummary(data.videoId, { mode: data.mode });
        if (!result.success) {
          recentFailures.set(data.videoId, { error: result.error, at: Date.now() });
          console.error('[bg generation] failed', {
            videoId: data.videoId,
            error: result.error,
          });
        } else {
          recentFailures.delete(data.videoId);
        }
      } catch (err) {
        // generateVideoSummary threw (vs. returning {success:false}). It
        // may not have reached its own markSummaryFailedService call, so
        // flip the DB row here — otherwise the UI polls a pending row
        // forever while the only evidence of failure lives in memory.
        const message = err instanceof Error ? err.message : 'Generation failed';
        recentFailures.set(data.videoId, { error: message, at: Date.now() });
        console.error('[bg generation] exception', { videoId: data.videoId, err });
        try {
          const row = await fetchVideoByVideoIdService(data.videoId);
          if (row) await markSummaryFailedService(row.documentId);
        } catch (markErr) {
          console.error('[bg generation] mark-failed itself failed', {
            videoId: data.videoId,
            markErr,
          });
        }
      } finally {
        inflight.delete(data.videoId);
      }
    })();

    return { status: 'started' };
  });

// Manually override a section's timecode — the escape hatch for AI drift
// that BM25 grounding doesn't fix. Scoped to the single section so edits
// don't race against other summary updates.
const UpdateSectionTimecodeSchema = z.object({
  documentId: z.string().min(1),
  sectionId: z.number().int().nonnegative(),
  timeSec: z.number().int().min(0).max(24 * 3600), // sanity: <= 24h
});

export const updateSectionTimecode = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof UpdateSectionTimecodeSchema>) =>
    UpdateSectionTimecodeSchema.parse(data),
  )
  .handler(async ({ data }): Promise<{ success: true } | { success: false; error: string }> => {
    return await updateSectionTimecodeService(data);
  });

export const clearSummaryFailure = createServerFn({ method: 'POST' })
  .inputValidator((data: { videoId: string }) => VideoIdSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    recentFailures.delete(data.videoId);
    return { ok: true };
  });

// Manual regenerate — for videos that already have a summary but the user
// wants to re-run generation (e.g. after prompt changes or a mediocre result).
// Flips the Strapi row back to 'pending' and kicks off the same background
// job as the share flow. Safe to click while the old summary is on the row;
// fields are overwritten on success, preserved on failure.
export type RegenerateResult =
  | { status: 'started' }
  | { status: 'already_running' }
  | { status: 'error'; error: string };

const RegenerateInputSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\w-]+$/),
  // Skip the transcript cache and re-fetch fresh from YouTube. Needed
  // when the uploader updated captions or the cached segments are bad.
  forceRefetch: z.boolean().optional(),
  mode: GenerationModeSchema.optional(),
});

export const regenerateSummary = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof RegenerateInputSchema>) =>
    RegenerateInputSchema.parse(data),
  )
  .handler(async ({ data }): Promise<RegenerateResult> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video) {
      return { status: 'error', error: 'Video not found' };
    }
    if (inflight.has(data.videoId)) {
      return { status: 'already_running' };
    }

    // Clear any stale failure marker and flip the row to pending so the
    // loader sees a fresh pending state (not 'generated') while work runs.
    recentFailures.delete(data.videoId);
    const flip = await markSummaryPendingService(video.documentId);
    if (!flip.success) {
      return { status: 'error', error: flip.error };
    }

    inflight.add(data.videoId);
    void (async () => {
      try {
        const result = await generateVideoSummary(data.videoId, {
          forceRefetch: data.forceRefetch,
          mode: data.mode,
        });
        if (!result.success) {
          recentFailures.set(data.videoId, { error: result.error, at: Date.now() });
          console.error('[regenerate] failed', {
            videoId: data.videoId,
            error: result.error,
          });
        } else {
          recentFailures.delete(data.videoId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Regeneration failed';
        recentFailures.set(data.videoId, { error: message, at: Date.now() });
        console.error('[regenerate] exception', { videoId: data.videoId, err });
        try {
          const row = await fetchVideoByVideoIdService(data.videoId);
          if (row) await markSummaryFailedService(row.documentId);
        } catch (markErr) {
          console.error('[regenerate] mark-failed itself failed', { markErr });
        }
      } finally {
        inflight.delete(data.videoId);
      }
    })();

    return { status: 'started' };
  });

export type GenerationProgress = {
  step: GenerationStep | null;
  detail: string | null;
  elapsedMs: number | null;
  detailElapsedMs: number | null;
};

// POST (not GET) to sidestep any HTTP caching that would serve stale
// progress back to the UI while the background job keeps advancing. Also
// logs every read so we can spot-check "is the server returning fresh
// state on each poll tick" against what the UI shows.
export const getGenerationProgress = createServerFn({ method: 'POST' })
  .inputValidator((data: { videoId: string }) => VideoIdSchema.parse(data))
  .handler(async ({ data }): Promise<GenerationProgress> => {
    const current = readGenerationStep(data.videoId);
    if (!current) {
      return { step: null, detail: null, elapsedMs: null, detailElapsedMs: null };
    }
    // eslint-disable-next-line no-console
    console.log(
      `[${new Date().toISOString().slice(11, 23)}] [progress ${data.videoId}] ${current.step}${current.detail ? ` · ${current.detail}` : ''} (step +${Math.round(current.elapsedMs / 1000)}s, detail +${Math.round(current.detailElapsedMs / 1000)}s)`,
    );
    return {
      step: current.step,
      detail: current.detail,
      elapsedMs: current.elapsedMs,
      detailElapsedMs: current.detailElapsedMs,
    };
  });

// =============================================================================
// Chat about a video
// =============================================================================

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

const AskAboutVideoSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\w-]+$/),
  messages: z.array(ChatMessageSchema).min(1).max(30),
});

export type AskAboutVideoResult =
  | { status: 'ok'; reply: string }
  | { status: 'not_ready' }
  | { status: 'error'; error: string };

export const askAboutVideo = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof AskAboutVideoSchema>) =>
    AskAboutVideoSchema.parse(data),
  )
  .handler(async ({ data }): Promise<AskAboutVideoResult> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video || video.summaryStatus !== 'generated') return { status: 'not_ready' };

    const result = await askAboutVideoService(video, data.messages as ChatMessage[]);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', reply: result.data };
  });

// =============================================================================
// Chat response evidence
//
// Given a completed chat response text, returns every timecode citation the
// model produced alongside the actual transcript chunk that best grounds
// each one. The chat UI renders these as expandable accordions below the
// assistant message so the user can verify each citation against the real
// source text rather than trust a raw `[mm:ss]` chip.
// =============================================================================

const ChatEvidenceSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\w-]+$/),
  responseText: z.string().min(1).max(50_000),
});

export const getChatResponseEvidence = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof ChatEvidenceSchema>) =>
    ChatEvidenceSchema.parse(data),
  )
  .handler(async ({ data }): Promise<EvidenceCitation[]> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video || !isStoredIndex(video.transcriptSegments)) return [];
    return extractCitationsWithEvidence(
      data.responseText,
      video.transcriptSegments.bm25,
    );
  });

// =============================================================================
// Embeddings
//
// - `getEmbeddingStatus` — quick check for the UI (missing / stale / current)
//   without pulling the full vector.
// - `regenerateVideoEmbedding` — recompute + persist, used by the button on
//   the learn page when the embedding is missing or stale.
// =============================================================================

const VideoIdOnlySchema = z.object({
  videoId: z.string().min(1).max(64),
});

export type EmbeddingStatusResult =
  | {
      status: VideoEmbeddingStatus;
      generatedAt: string | null;
      model: string | null;
      version: number | null;
      currentModel: string;
      currentVersion: number;
    }
  | { status: 'error'; error: string };

export const getEmbeddingStatus = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof VideoIdOnlySchema>) =>
    VideoIdOnlySchema.parse(data),
  )
  .handler(async ({ data }): Promise<EmbeddingStatusResult> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video) return { status: 'error', error: 'Video not found' };
    return {
      status: embeddingStatus(video),
      generatedAt: video.embeddingGeneratedAt,
      model: video.embeddingModel,
      version: video.embeddingVersion,
      currentModel: CURRENT_EMBEDDING_MODEL,
      currentVersion: CURRENT_EMBEDDING_VERSION,
    };
  });

export type RegenerateEmbeddingResult =
  | {
      status: 'ok';
      dims: number;
      model: string;
      version: number;
      generatedAt: string;
    }
  | { status: 'error'; error: string };

export const regenerateVideoEmbedding = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof VideoIdOnlySchema>) =>
    VideoIdOnlySchema.parse(data),
  )
  .handler(async ({ data }): Promise<RegenerateEmbeddingResult> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video) return { status: 'error', error: 'Video not found' };
    if (video.summaryStatus !== 'generated') {
      return {
        status: 'error',
        error: 'Summary not ready — generate the summary before embedding.',
      };
    }
    try {
      const computed = await computeVideoEmbedding(video);
      const saved = await updateVideoEmbeddingService({
        documentId: video.documentId,
        embedding: computed.embedding,
        model: computed.model,
        version: computed.version,
        generatedAt: computed.generatedAt,
      });
      if (!saved.success) {
        return { status: 'error', error: saved.error };
      }
      return {
        status: 'ok',
        dims: computed.embedding.length,
        model: computed.model,
        version: computed.version,
        generatedAt: computed.generatedAt,
      };
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : 'Embedding failed',
      };
    }
  });

// =============================================================================
// Embedding coverage — quick stats for the UI ("N/M videos embedded").
// =============================================================================

export type EmbeddingCoverage = {
  total: number;
  current: number;
  stale: number;
  missing: number;
  currentModel: string;
  currentVersion: number;
};

export const getEmbeddingCoverage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EmbeddingCoverage> => {
    const videos = await listAllVideosForEmbeddingService();
    let current = 0;
    let stale = 0;
    let missing = 0;
    for (const v of videos) {
      const s = embeddingStatus(v);
      if (s === 'current') current += 1;
      else if (s === 'stale') stale += 1;
      else missing += 1;
    }
    return {
      total: videos.length,
      current,
      stale,
      missing,
      currentModel: CURRENT_EMBEDDING_MODEL,
      currentVersion: CURRENT_EMBEDDING_VERSION,
    };
  },
);

// =============================================================================
// Backfill — walk videos and compute embeddings for anything that doesn't
// have a current vector. `scope` controls which rows to touch:
//   'missing' — only rows with no vector at all (default; safest)
//   'stale'   — only rows whose model/version doesn't match current
//   'all'     — 'missing' ∪ 'stale'
//
// Concurrency is bounded (3) — Ollama's /api/embeddings serializes anyway
// and we don't want to overwhelm a laptop running Gemma + embeddings at
// the same time.
// =============================================================================

const ReindexSchema = z.object({
  scope: z.enum(['missing', 'stale', 'all']).default('missing'),
  // When true, reindex every generated-summary video regardless of stored
  // status. Bypasses the stale/missing gate. Used from the "Force reindex"
  // button when the user suspects stored vectors are wrong despite being
  // labeled current.
  force: z.boolean().optional(),
});

export type ReindexResult = {
  status: 'ok';
  scope: 'missing' | 'stale' | 'all';
  total: number;
  targeted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ youtubeVideoId: string; error: string }>;
  tookMs: number;
};

export const reindexAllEmbeddings = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof ReindexSchema>) =>
    ReindexSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ReindexResult> => {
    const started = performance.now();
    const videos = await listAllVideosForEmbeddingService();

    const candidates = data.force
      ? videos
      : videos.filter((v) => {
          const s = embeddingStatus(v);
          if (data.scope === 'missing') return s === 'missing';
          if (data.scope === 'stale') return s === 'stale';
          return s !== 'current';
        });

    const errors: Array<{ youtubeVideoId: string; error: string }> = [];
    let succeeded = 0;
    let cursor = 0;
    const CONCURRENCY = 3;

    const processOne = async (video: StrapiVideo) => {
      try {
        const computed = await computeVideoEmbedding(video);
        const saved = await updateVideoEmbeddingService({
          documentId: video.documentId,
          embedding: computed.embedding,
          model: computed.model,
          version: computed.version,
          generatedAt: computed.generatedAt,
        });
        if (!saved.success) {
          errors.push({ youtubeVideoId: video.youtubeVideoId, error: saved.error });
          return;
        }
        succeeded += 1;
      } catch (err) {
        errors.push({
          youtubeVideoId: video.youtubeVideoId,
          error: err instanceof Error ? err.message : 'embed failed',
        });
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= candidates.length) return;
        await processOne(candidates[i]);
      }
    });
    await Promise.all(workers);

    return {
      status: 'ok',
      scope: data.scope,
      total: videos.length,
      targeted: candidates.length,
      succeeded,
      failed: errors.length,
      errors,
      tookMs: Math.round(performance.now() - started),
    };
  });

// =============================================================================
// relatedVideos — semantic neighbors for one video. In-memory cosine over all
// current-vector rows in the library. Returns minimal video metadata + score.
// =============================================================================

const RelatedVideosSchema = z.object({
  videoId: z.string().min(1).max(64),
  limit: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(-1).max(1).optional(),
});

export type RelatedVideo = {
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
  score: number;
};

export type RelatedVideosResult =
  | { status: 'ok'; results: RelatedVideo[]; reason?: undefined }
  | {
      status: 'ok';
      results: [];
      reason: 'target-missing-embedding' | 'no-candidates';
    }
  | { status: 'error'; error: string };

// Hybrid related-videos: treat the target video as a "query" — its
// topical text goes through BM25 to find candidates sharing exact rare
// tokens (proper nouns like "Strapi", "Ollama", company names); its
// embedding vector goes through cosine to find topically-similar
// candidates. RRF-merge the two rankings.
//
// Why the dense-only version fails: "Strapi" embeds weakly in
// nomic-embed-text (rare token → low contribution to the final vector),
// so the target's vector is dominated by generic dev-tech semantics.
// Other Strapi videos end up ranked below generic API/auth/tool videos.
// BM25 catches the proper-noun overlap the dense path misses.
export const relatedVideos = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof RelatedVideosSchema>) =>
    RelatedVideosSchema.parse(data),
  )
  .handler(async ({ data }): Promise<RelatedVideosResult> => {
    const target = await fetchVideoByVideoIdService(data.videoId);
    if (!target) return { status: 'error', error: 'Video not found' };
    if (embeddingStatus(target) !== 'current') {
      return {
        status: 'ok',
        results: [],
        reason: 'target-missing-embedding',
      };
    }
    const targetVec = target.summaryEmbedding as number[];

    const all = await listAllVideosForEmbeddingService();
    const limit = data.limit ?? 6;
    const minScore = data.minScore ?? 0.5;

    const candidates = all.filter(
      (v) =>
        v.documentId !== target.documentId &&
        embeddingStatus(v) === 'current' &&
        Array.isArray(v.summaryEmbedding),
    );

    if (candidates.length === 0) {
      return { status: 'ok', results: [], reason: 'no-candidates' };
    }

    // Dense order.
    const cosineScores = candidates.map((v) =>
      cosineSimilarity(targetVec, v.summaryEmbedding as number[]),
    );
    const denseOrder = cosineScores
      .map((score, i) => ({ i, score }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i);

    // BM25 order — target's topical text as the "query" over the
    // candidate corpus. Cap to the 15 highest-IDF terms: doc-as-query
    // naturally expands to hundreds of tokens that dilute BM25 into
    // noise. 15 keeps the target's most distinctive signals (product
    // names, speakers, domain terms) and drops the generic dev-content
    // shared with half the library.
    const targetQuery = buildVideoSearchText(target);
    const bm25Chunks: TranscriptChunk[] = candidates.map((v, i) => ({
      id: i,
      text: buildVideoSearchText(v),
      startWord: 0,
      timeSec: 0,
    }));
    const bm25Index = buildBM25Index(bm25Chunks);
    const bm25Hits = searchBM25(bm25Index, targetQuery, candidates.length, {
      maxQueryTerms: 15,
    });
    const bm25Order = bm25Hits.map((c) => c.id);

    // Two explicit boost signals that encode user-intuition-level
    // relatedness, applied on top of cosine + BM25 RRF:
    //
    // 1. Tag overlap. Strongest signal — tags are user-curated
    //    categorization. If the target is tagged "strapi" and a
    //    candidate is too, that's the clearest "these are related".
    //    Much more reliable than summary-level topical similarity,
    //    which diffuses across every topic a target's summary touches.
    //
    // 2. Title-token overlap. Secondary signal, IDF-filtered to drop
    //    generic words. Catches cases where tags aren't set — e.g.
    //    a Qwen video and a Kimi video might both be un-tagged "LLM"
    //    content and share "model" in title as their only common
    //    indicator.
    //
    // Calibrated against typical RRF range (~0.05 top):
    //   - tag boost 0.06/tag — strong enough to dominate cases where
    //     the target's summary is topically diffuse (a tutorial target
    //     shares "tutorial" vibe with many docs), pushing tag-matching
    //     candidates clearly ahead of title-only matches
    //   - title boost 0.015/token — softer, secondary signal
    const TAG_BOOST_PER_TAG = 0.06;
    const TITLE_BOOST_PER_TOKEN = 0.015;

    const targetTags = new Set((target.tags ?? []).map((t) => t.slug));
    const targetTitleTokens = new Set(
      tokenize(target.videoTitle ?? '').filter((t) => {
        const idf = bm25Index.idf[t];
        return idf !== undefined && idf >= 1.5;
      }),
    );

    // RRF merge.
    const rrf = new Map<number, number>();
    denseOrder.forEach((id, rank) => {
      rrf.set(id, (rrf.get(id) ?? 0) + 1 / (rank + 1 + RRF_K));
    });
    bm25Order.forEach((id, rank) => {
      rrf.set(id, (rrf.get(id) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
    });
    // Apply tag-overlap boost per candidate.
    const tagBoosts = new Map<number, { count: number; tags: string[] }>();
    candidates.forEach((v, i) => {
      if (targetTags.size === 0) return;
      const candTags = (v.tags ?? []).map((t) => t.slug);
      const matched: string[] = [];
      for (const slug of candTags) {
        if (targetTags.has(slug)) matched.push(slug);
      }
      if (matched.length > 0) {
        rrf.set(i, (rrf.get(i) ?? 0) + matched.length * TAG_BOOST_PER_TAG);
        tagBoosts.set(i, { count: matched.length, tags: matched });
      }
    });

    // Apply title-token boost per candidate.
    const titleBoosts = new Map<number, { count: number; tokens: string[] }>();
    candidates.forEach((v, i) => {
      if (targetTitleTokens.size === 0) return;
      const candTitleTokens = new Set(tokenize(v.videoTitle ?? ''));
      const matched: string[] = [];
      for (const t of targetTitleTokens) {
        if (candTitleTokens.has(t)) matched.push(t);
      }
      if (matched.length > 0) {
        rrf.set(
          i,
          (rrf.get(i) ?? 0) + matched.length * TITLE_BOOST_PER_TOKEN,
        );
        titleBoosts.set(i, { count: matched.length, tokens: matched });
      }
    });

    const preFilter = Array.from(rrf.entries())
      .map(([i, rrfScore]) => ({ i, rrfScore, cosineScore: cosineScores[i] }))
      .sort((a, b) => b.rrfScore - a.rrfScore);

    // Diagnostic — same shape as the other hybrid server functions so we
    // can spot "target's rare tokens got filtered and BM25 had nothing
    // to work with" or similar failures in production data.
    // eslint-disable-next-line no-console
    console.log('[relatedVideos]', {
      target: target.videoTitle,
      candidates: candidates.length,
      bm25Size: bm25Order.length,
      targetTags: Array.from(targetTags),
      targetTitleTokens: Array.from(targetTitleTokens),
      denseTop10: denseOrder.slice(0, 10).map((i) => ({
        title: candidates[i].videoTitle,
        score: cosineScores[i].toFixed(3),
      })),
      bm25Top10: bm25Order.slice(0, 10).map((i) => ({
        title: candidates[i].videoTitle,
      })),
      rrfTop10: preFilter.slice(0, 10).map((r) => ({
        title: candidates[r.i].videoTitle,
        cosine: r.cosineScore.toFixed(3),
        rrf: r.rrfScore.toFixed(4),
        tagBoost: tagBoosts.get(r.i) ?? null,
        titleBoost: titleBoosts.get(r.i) ?? null,
      })),
    });

    const results: RelatedVideo[] = preFilter
      .filter((x) => x.cosineScore >= minScore)
      .slice(0, limit)
      .map(({ i, cosineScore }) => ({
        documentId: candidates[i].documentId,
        youtubeVideoId: candidates[i].youtubeVideoId,
        videoTitle: candidates[i].videoTitle,
        videoAuthor: candidates[i].videoAuthor,
        videoThumbnailUrl: candidates[i].videoThumbnailUrl,
        score: cosineScore,
      }));

    if (results.length === 0) {
      return { status: 'ok', results: [], reason: 'no-candidates' };
    }

    return { status: 'ok', results };
  });

// =============================================================================
// semanticSearchVideos — library-wide semantic search. Same cosine path as
// relatedVideos but seeded from an ad-hoc query string instead of a video.
// =============================================================================

const SemanticSearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(-1).max(1).optional(),
});

// Hit = full Video row + similarity score. Returning the full row lets the
// feed render its normal VideoCard with verdict/status unchanged.
export type SemanticHit = { video: StrapiVideo; score: number };

export type SemanticSearchResult =
  | { status: 'ok'; hits: SemanticHit[] }
  | { status: 'error'; error: string };

// Hybrid video search on the feed — same RRF pattern as passage search.
// Without BM25, proper-noun queries ("MCP", "Strapi", "Qwen") rank
// generic developer content above the videos actually about those tools.
export const semanticSearchVideos = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof SemanticSearchSchema>) =>
    SemanticSearchSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SemanticSearchResult> => {
    let qVec: number[];
    try {
      qVec = await embedText(data.query, 'query');
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : 'query embedding failed',
      };
    }

    const all = await listAllVideosForEmbeddingService();
    const limit = data.limit ?? 20;
    const minScore = data.minScore ?? 0.35;

    const candidates = all.filter(
      (v) =>
        embeddingStatus(v) === 'current' && Array.isArray(v.summaryEmbedding),
    );
    if (candidates.length === 0) return { status: 'ok', hits: [] };

    // Dense order: cosine against each video's summary embedding.
    const cosineScores = candidates.map((v) =>
      cosineSimilarity(qVec, v.summaryEmbedding as number[]),
    );
    const denseOrder = cosineScores
      .map((score, i) => ({ i, score }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i);

    // BM25 order: build a corpus from each video's topical surface
    // (title + author + description + overview + takeaways + tags) —
    // same bag of fields the embedding already sees. BM25 catches exact
    // tokens in the title and surface text that dense can miss.
    const bm25Chunks: TranscriptChunk[] = candidates.map((v, i) => ({
      id: i,
      text: buildVideoSearchText(v),
      startWord: 0,
      timeSec: 0,
    }));
    const bm25Index = buildBM25Index(bm25Chunks);
    const bm25Hits = searchBM25(bm25Index, data.query, candidates.length);
    const bm25Order = bm25Hits.map((c) => c.id);

    // RRF merge — same math as passage search.
    const rrf = new Map<number, number>();
    denseOrder.forEach((id, rank) => {
      rrf.set(id, (rrf.get(id) ?? 0) + 1 / (rank + 1 + RRF_K));
    });
    bm25Order.forEach((id, rank) => {
      rrf.set(id, (rrf.get(id) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
    });

    const finalRanked = Array.from(rrf.entries())
      .map(([i, rrfScore]) => ({ i, rrfScore, cosineScore: cosineScores[i] }))
      .sort((a, b) => b.rrfScore - a.rrfScore);

    // Diagnostic — top-10 from each retriever before the minScore filter.
    // eslint-disable-next-line no-console
    console.log('[semanticSearchVideos]', {
      query: data.query,
      candidates: candidates.length,
      bm25Size: bm25Order.length,
      denseTop10: denseOrder.slice(0, 10).map((i) => ({
        title: candidates[i].videoTitle,
        score: cosineScores[i].toFixed(3),
      })),
      bm25Top10: bm25Order.slice(0, 10).map((i) => ({
        title: candidates[i].videoTitle,
      })),
      rrfTop10: finalRanked.slice(0, 10).map((r) => ({
        title: candidates[r.i].videoTitle,
        cosine: r.cosineScore.toFixed(3),
        rrf: r.rrfScore.toFixed(4),
      })),
    });

    const lightened: SemanticHit[] = finalRanked
      .filter((x) => x.cosineScore >= minScore)
      .slice(0, limit)
      .map(({ i, cosineScore }) => ({
        video: { ...candidates[i], summaryEmbedding: null },
        score: cosineScore,
      }));

    return { status: 'ok', hits: lightened };
  });

// Bag-of-fields text used for BM25 at the video level. Mirrors what the
// embedding sees so keyword matches align with semantic matches.
function buildVideoSearchText(v: StrapiVideo): string {
  const parts: string[] = [];
  if (v.videoTitle) parts.push(v.videoTitle);
  if (v.videoAuthor) parts.push(v.videoAuthor);
  if (v.summaryTitle && v.summaryTitle !== v.videoTitle) {
    parts.push(v.summaryTitle);
  }
  if (v.summaryDescription) parts.push(v.summaryDescription);
  if (v.summaryOverview) parts.push(v.summaryOverview);
  if (v.keyTakeaways && v.keyTakeaways.length > 0) {
    parts.push(v.keyTakeaways.map((t) => t.text).join(' '));
  }
  if (v.sections && v.sections.length > 0) {
    parts.push(v.sections.map((s) => s.heading).join(' '));
  }
  if (v.tags && v.tags.length > 0) {
    parts.push(v.tags.map((t) => t.name).join(' '));
  }
  return parts.join(' ');
}

// =============================================================================
// Passage embeddings (Tier 2) — moment search across the library.
// =============================================================================

export type PassageCoverage = {
  total: number;
  current: number;
  stale: number;
  missing: number;
  currentModel: string;
  currentVersion: number;
};

export const getPassageCoverage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PassageCoverage> => {
    const videos = await listAllVideosForEmbeddingService();
    let current = 0;
    let stale = 0;
    let missing = 0;
    for (const v of videos) {
      const s = passageStatus(v.passageEmbeddings);
      if (s === 'current') current += 1;
      else if (s === 'stale') stale += 1;
      else missing += 1;
    }
    return {
      total: videos.length,
      current,
      stale,
      missing,
      currentModel: CURRENT_EMBEDDING_MODEL,
      currentVersion: CURRENT_PASSAGE_VERSION,
    };
  },
);

const ReindexPassagesSchema = z.object({
  scope: z.enum(['missing', 'stale', 'all']).default('missing'),
  force: z.boolean().optional(),
});

export type ReindexPassagesResult = {
  status: 'ok';
  scope: 'missing' | 'stale' | 'all';
  total: number;
  targeted: number;
  succeeded: number;
  failed: number;
  totalChunks: number;
  errors: Array<{ youtubeVideoId: string; error: string }>;
  tookMs: number;
};

export const reindexAllPassages = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof ReindexPassagesSchema>) =>
    ReindexPassagesSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ReindexPassagesResult> => {
    const started = performance.now();
    const videos = await listAllVideosForEmbeddingService();

    const candidates = data.force
      ? videos
      : videos.filter((v) => {
          const s: PassageStatus = passageStatus(v.passageEmbeddings);
          if (data.scope === 'missing') return s === 'missing';
          if (data.scope === 'stale') return s === 'stale';
          return s !== 'current';
        });

    const errors: Array<{ youtubeVideoId: string; error: string }> = [];
    let succeeded = 0;
    let totalChunks = 0;

    // Serial across videos — each video internally batches chunk embeds at
    // concurrency 2. Parallel video-level would thrash Ollama for no gain.
    for (const video of candidates) {
      try {
        const tx =
          video.transcript ??
          (await fetchTranscriptByVideoIdService(video.youtubeVideoId).catch(
            () => null,
          ));
        const segments = tx?.rawSegments ?? [];
        if (segments.length === 0) {
          errors.push({
            youtubeVideoId: video.youtubeVideoId,
            error: 'no raw transcript segments — regenerate summary first',
          });
          continue;
        }
        const passages = await computePassageIndex({ video, segments });
        if (passages.chunks.length === 0) {
          errors.push({
            youtubeVideoId: video.youtubeVideoId,
            error: 'transcript produced no passages',
          });
          continue;
        }
        const saved = await updateVideoPassagesService({
          documentId: video.documentId,
          passageEmbeddings: passages,
        });
        if (!saved.success) {
          errors.push({
            youtubeVideoId: video.youtubeVideoId,
            error: saved.error,
          });
          continue;
        }
        totalChunks += passages.chunks.length;
        succeeded += 1;
      } catch (err) {
        errors.push({
          youtubeVideoId: video.youtubeVideoId,
          error: err instanceof Error ? err.message : 'passage embed failed',
        });
      }
    }

    return {
      status: 'ok',
      scope: data.scope,
      total: videos.length,
      targeted: candidates.length,
      succeeded,
      failed: errors.length,
      totalChunks,
      errors,
      tookMs: Math.round(performance.now() - started),
    };
  });

// =============================================================================
// searchLibraryPassages — moment search. Embeds the query, cosine-ranks
// every passage across every video with a current passage index. Returns
// the top matches paired with minimal video metadata so the UI can render
// "this moment at 4:32 in <video title>".
// =============================================================================

const SearchLibraryPassagesSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(-1).max(1).optional(),
});

export type LibraryPassageHit = {
  video: {
    documentId: string;
    youtubeVideoId: string;
    videoTitle: string | null;
    videoAuthor: string | null;
    videoThumbnailUrl: string | null;
  };
  passage: {
    text: string;
    startSec: number;
    endSec: number;
    score: number;
  };
};

export type SearchLibraryPassagesResult =
  | { status: 'ok'; hits: LibraryPassageHit[] }
  | { status: 'error'; error: string };

// Hybrid passage search: dense cosine + BM25, merged with Reciprocal Rank
// Fusion (RRF_K=60). Dense catches synonyms and intent; BM25 catches exact
// rare tokens (proper nouns like "Qwen", "Kimi", "MCP") that dense vectors
// systematically under-weight. Either alone fails on real user queries —
// the combination is the standard retrieval pattern.
const RRF_K = 60;
// BM25 weight in the merge. Standard RRF uses 1:1. We bump BM25 because
// exact-token matches for rare proper-noun queries are far more reliable
// than dense similarity — and without the bump, the "what is qwen" case
// still lets generic "what is X" cosine matches tie-break the Qwen-specific
// result. 2.5x is the lowest value that consistently surfaces the proper-
// noun video at rank 1 in our tests without over-boosting common terms.
const BM25_WEIGHT = 2.5;

export const searchLibraryPassages = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof SearchLibraryPassagesSchema>) =>
    SearchLibraryPassagesSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SearchLibraryPassagesResult> => {
    let qVec: number[];
    try {
      qVec = await embedText(data.query, 'query');
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : 'query embedding failed',
      };
    }

    const all = await listAllVideosForEmbeddingService();
    const limit = data.limit ?? 20;
    const minScore = data.minScore ?? 0.4;

    // Flatten every current passage into one corpus with a stable global
    // index. The RRF merger uses these indices as join keys.
    type FlatPassage = {
      video: StrapiVideo;
      text: string;
      startSec: number;
      endSec: number;
      embedding: number[];
    };
    const flat: FlatPassage[] = [];
    for (const v of all) {
      const index = v.passageEmbeddings;
      if (passageStatus(index) !== 'current' || !index) continue;
      for (const p of index.chunks) {
        flat.push({
          video: v,
          text: p.text,
          startSec: p.startSec,
          endSec: p.endSec,
          embedding: p.embedding,
        });
      }
    }
    if (flat.length === 0) return { status: 'ok', hits: [] };

    // Dense ranking — cosine against every passage. Store scores so we can
    // render a meaningful "% match" in the UI after re-ranking.
    const cosineScores = flat.map((p) => cosineSimilarity(qVec, p.embedding));
    const denseOrder = cosineScores
      .map((score, i) => ({ i, score }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i);

    // BM25 ranking — reuse the existing infra by adapting passages to the
    // TranscriptChunk shape. `id` carries the global flat index so we can
    // map BM25 results back to FlatPassage entries.
    //
    // The BM25 text includes the parent VIDEO's title + author, not just
    // the passage text. Proper nouns like "Qwen" or "Kimi" often appear
    // only in video titles — YouTube's auto-captions transcribe them
    // phonetically wrong ("Quinn", "keemi") or the speaker shows them on
    // screen without saying them. Without this, searching for "qwen"
    // matches zero passages in the Qwen video itself.
    const bm25Chunks: TranscriptChunk[] = flat.map((p, i) => {
      const titleLine = [p.video.videoTitle, p.video.videoAuthor]
        .filter(Boolean)
        .join(' ');
      return {
        id: i,
        text: titleLine ? `${titleLine}\n${p.text}` : p.text,
        startWord: 0,
        timeSec: p.startSec,
      };
    });
    const bm25Index = buildBM25Index(bm25Chunks);
    const bm25Hits = searchBM25(bm25Index, data.query, flat.length);
    const bm25Order = bm25Hits.map((c) => c.id);

    // RRF merge: sum 1/(rank+K) across the two rankings. A passage that
    // appears only in one retriever still scores (half-credit); a passage
    // strong in both wins comfortably.
    const rrf = new Map<number, number>();
    denseOrder.forEach((id, rank) => {
      rrf.set(id, (rrf.get(id) ?? 0) + 1 / (rank + 1 + RRF_K));
    });
    bm25Order.forEach((id, rank) => {
      rrf.set(id, (rrf.get(id) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
    });

    const preFilter = Array.from(rrf.entries())
      .map(([i, rrfScore]) => ({ i, rrfScore, cosineScore: cosineScores[i] }))
      .sort((a, b) => b.rrfScore - a.rrfScore);

    // Diagnostic — top-10 from each retriever and the RRF merge, before
    // the minScore filter. Helps spot "BM25 found it, cosine didn't, and
    // minScore killed it" and similar failures in production data.
    // eslint-disable-next-line no-console
    console.log('[searchLibraryPassages]', {
      query: data.query,
      passages: flat.length,
      bm25Size: bm25Order.length,
      denseTop10: denseOrder.slice(0, 10).map((i) => ({
        title: flat[i].video.videoTitle,
        start: flat[i].startSec,
        score: cosineScores[i].toFixed(3),
        text: flat[i].text.slice(0, 80),
      })),
      bm25Top10: bm25Order.slice(0, 10).map((i) => ({
        title: flat[i].video.videoTitle,
        start: flat[i].startSec,
        text: flat[i].text.slice(0, 80),
      })),
      rrfTop10: preFilter.slice(0, 10).map((r) => ({
        title: flat[r.i].video.videoTitle,
        start: flat[r.i].startSec,
        cosine: r.cosineScore.toFixed(3),
        rrf: r.rrfScore.toFixed(4),
      })),
    });

    // Build the final hits list. `score` shown in the UI is the cosine
    // score (it's the familiar "% match" metric). RRF drives the ORDER;
    // we still filter by minScore so pure-keyword matches with no
    // semantic signal (cosine < minScore) don't leak in as noise.
    //
    // Per-video cap: MAX 2 passages per video in the final list. Without
    // this, long-form videos saturate the top-10 with consecutive chunks
    // about the same topic — crowding out diversity and hiding other
    // relevant videos. The second pass below enforces the cap in rank
    // order, preserving the best passage(s) from each video.
    const PER_VIDEO_CAP = 2;
    const perVideoCount = new Map<string, number>();
    const capped = preFilter
      .filter((x) => x.cosineScore >= minScore)
      .filter((x) => {
        const key = flat[x.i].video.documentId;
        const count = perVideoCount.get(key) ?? 0;
        if (count >= PER_VIDEO_CAP) return false;
        perVideoCount.set(key, count + 1);
        return true;
      });

    const ranked: LibraryPassageHit[] = capped
      .slice(0, limit)
      .map(({ i, cosineScore }) => {
        const p = flat[i];
        return {
          video: {
            documentId: p.video.documentId,
            youtubeVideoId: p.video.youtubeVideoId,
            videoTitle: p.video.videoTitle,
            videoAuthor: p.video.videoAuthor,
            videoThumbnailUrl: p.video.videoThumbnailUrl,
          },
          passage: {
            text: p.text,
            startSec: p.startSec,
            endSec: p.endSec,
            score: cosineScore,
          },
        };
      });

    return { status: 'ok', hits: ranked };
  });

// =============================================================================
// Suggest tags at ingest — given a YouTube URL the user is about to share,
// embed a lightweight description (title + author from oEmbed) and aggregate
// tags from the K most semantically similar videos already in the library.
//
// Best-effort everywhere: any failure (Ollama down, empty library, oEmbed
// rate-limited, URL can't be parsed) returns an empty suggestion list so
// the form shows nothing rather than blocking or erroring.
// =============================================================================

const SuggestTagsSchema = z.object({
  url: z.string().min(1).max(500),
});

export type SuggestTagsResult =
  | { status: 'ok'; suggestions: SuggestedTag[] }
  | { status: 'error'; error: string };

export const suggestTagsForUrl = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof SuggestTagsSchema>) =>
    SuggestTagsSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SuggestTagsResult> => {
    const videoId = extractYouTubeVideoId(data.url);
    if (!videoId) return { status: 'ok', suggestions: [] };

    // Lightweight metadata — oEmbed gives us title + author, enough to
    // place the video in topic space before the full summary exists.
    const meta = await fetchYouTubeMeta(videoId).catch(
      () => ({ title: undefined, author: undefined }) as const,
    );
    const probeText = [meta.title, meta.author]
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!probeText) return { status: 'ok', suggestions: [] };

    let qVec: number[];
    try {
      qVec = await embedText(probeText, 'query');
    } catch {
      // Ollama down / embed model not pulled — silent fallback.
      return { status: 'ok', suggestions: [] };
    }

    const all = await listAllVideosForEmbeddingService();
    const candidates = all.filter(
      (v) =>
        v.youtubeVideoId !== videoId &&
        embeddingStatus(v) === 'current' &&
        Array.isArray(v.summaryEmbedding),
    );
    if (candidates.length === 0) return { status: 'ok', suggestions: [] };

    const K = 5;
    const MIN_NEIGHBOR_SCORE = 0.4;
    const neighbors = candidates
      .map((video) => ({
        score: cosineSimilarity(qVec, video.summaryEmbedding as number[]),
        tags: video.tags,
      }))
      .filter((n) => n.score >= MIN_NEIGHBOR_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, K);

    const suggestions = aggregateTagsFromNeighbors(neighbors, 5);
    return { status: 'ok', suggestions };
  });

// =============================================================================
// Tag autocomplete
// =============================================================================

const TagSearchSchema = z.object({ q: z.string().max(40).default('') });

export const searchTags = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof TagSearchSchema>) => TagSearchSchema.parse(data))
  .handler(async ({ data }): Promise<StrapiTag[]> => {
    return await searchTagsService(data.q);
  });
