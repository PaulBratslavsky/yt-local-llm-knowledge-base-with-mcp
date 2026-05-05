import { STRAPI_URL } from '#/lib/env';
import { strapiFetch, type StrapiQuery } from './strapi-client';
import type { StoredTranscriptIndex } from './transcript';

// `STRAPI_URL` is kept here only for `strapiAssetUrl` (asset URL composition
// for uploaded media). Every REST call goes through `strapi-client` instead.

// =============================================================================
// Types
// =============================================================================

export type StrapiMedia = {
  url: string;
  alternativeText: string | null;
} | null;

export type StrapiTag = {
  id: number;
  documentId: string;
  name: string;
  slug: string;
};

export type StrapiTakeaway = {
  id: number;
  text: string;
};

export type StrapiSection = {
  id: number;
  timeSec: number | null;
  heading: string;
  body: string;
};

export type StrapiActionStep = {
  id: number;
  title: string;
  body: string;
};

// Transcript = the cached YouTube caption source-of-truth. 1:1 with Video,
// but lives on its own row so the fetch is resilient: if AI generation
// fails after the fetch, the Transcript survives and regen skips YouTube.
export type StrapiTranscriptSegment = {
  text: string;
  startMs: number;
  endMs?: number;
};

export type StrapiTranscript = {
  id: number;
  documentId: string;
  youtubeVideoId: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  language: string | null;
  durationSec: number | null;
  rawSegments: StrapiTranscriptSegment[] | null;
  rawText: string | null;
  fetchedAt: string | null;
};

export type SummaryStatus = 'pending' | 'generated' | 'failed';

export type WatchVerdict = 'skip' | 'skim' | 'worth_it';

export type StrapiVideo = {
  id: number;
  documentId: string;
  youtubeVideoId: string;
  url: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
  caption: string | null;
  createdAt: string;
  tags: StrapiTag[] | null;
  summaryStatus: SummaryStatus;
  summaryTitle: string | null;
  summaryDescription: string | null;
  summaryOverview: string | null;
  watchVerdict: WatchVerdict | null;
  verdictSummary: string | null;
  verdictReason: string | null;
  readableArticle: string | null;
  readableArticleGeneratedAt: string | null;
  readableArticleModel: string | null;
  summaryGeneratedAt: string | null;
  aiModel: string | null;
  transcriptSegments: StoredTranscriptIndex | null;
  summaryEmbedding: number[] | null;
  embeddingModel: string | null;
  embeddingVersion: number | null;
  embeddingGeneratedAt: string | null;
  passageEmbeddings: {
    model: string;
    version: number;
    generatedAt: string;
    chunks: Array<{
      text: string;
      startSec: number;
      endSec: number;
      embedding: number[];
    }>;
  } | null;
  keyTakeaways: StrapiTakeaway[] | null;
  sections: StrapiSection[] | null;
  actionSteps: StrapiActionStep[] | null;
  // 1:1 relation to Transcript (source of truth for caption data).
  // Null on pre-migration rows; populated on all freshly-generated videos.
  transcript: StrapiTranscript | null;
};

export type PaginatedVideos = {
  videos: StrapiVideo[];
  page: number;
  pageCount: number;
  total: number;
};

// =============================================================================
// Feed / search
// =============================================================================

export type FeedQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  tag?: string; // slug
};

function feedQuery({ page = 1, pageSize = 20, q, tag }: FeedQuery): StrapiQuery {
  // Keep the feed payload light. No component populate on the list view —
  // summary fields are only needed on the detail page.
  const filters: Record<string, unknown> = {};
  const trimmed = q?.trim();
  if (trimmed) {
    filters.$or = [
      { videoTitle: { $containsi: trimmed } },
      { videoAuthor: { $containsi: trimmed } },
      { caption: { $containsi: trimmed } },
      { summaryTitle: { $containsi: trimmed } },
    ];
  }
  if (tag) {
    filters.tags = { slug: { $eq: tag } };
  }
  return {
    populate: ['tags'],
    sort: 'createdAt:desc',
    pagination: { page, pageSize, withCount: true },
    ...(Object.keys(filters).length > 0
      ? { filters: filters as StrapiQuery['filters'] }
      : {}),
  };
}

export async function fetchFeedService(query: FeedQuery): Promise<PaginatedVideos> {
  const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
    query: feedQuery(query),
  });
  if (!result.ok) {
    return { videos: [], page: query.page ?? 1, pageCount: 0, total: 0 };
  }
  return {
    videos: result.data ?? [],
    page: result.meta?.pagination?.page ?? 1,
    pageCount: result.meta?.pagination?.pageCount ?? 0,
    total: result.meta?.pagination?.total ?? 0,
  };
}

// =============================================================================
// Single-video lookups
// =============================================================================

// Populate strategy for the detail page — everything, including the heavy
// components that the summary view needs.
const detailQuery: StrapiQuery = {
  populate: ['tags', 'keyTakeaways', 'sections', 'actionSteps', 'transcript'],
};

// Lightweight listing used by embedding-dependent features (backfill,
// relatedVideos, semantic search). Pulls the fields needed to rebuild the
// embedding text + the existing vector for comparison — nothing else.
// Paginates internally so one call returns every eligible row.
export async function listAllVideosForEmbeddingService(): Promise<StrapiVideo[]> {
  const pageSize = 100;
  const all: StrapiVideo[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
      query: {
        populate: ['tags', 'keyTakeaways', 'sections'],
        filters: { summaryStatus: { $eq: 'generated' } },
        sort: 'createdAt:desc',
        pagination: { page, pageSize, withCount: true },
      },
    });
    if (!result.ok) break;
    all.push(...(result.data ?? []));
    const pageCount = result.meta?.pagination?.pageCount ?? 1;
    if (page >= pageCount) break;
  }
  return all;
}

export async function fetchVideoByDocumentIdService(
  documentId: string,
): Promise<StrapiVideo | null> {
  const result = await strapiFetch<StrapiVideo>(
    'GET',
    `/api/videos/${documentId}`,
    { query: detailQuery },
  );
  return result.ok ? (result.data ?? null) : null;
}

export async function fetchVideoByVideoIdService(
  videoId: string,
): Promise<StrapiVideo | null> {
  const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
    query: {
      ...detailQuery,
      filters: { youtubeVideoId: { $eq: videoId } },
      pagination: { pageSize: 1 },
    },
  });
  return result.ok ? (result.data?.[0] ?? null) : null;
}

// =============================================================================
// Create a video (with tag upsert)
// =============================================================================

export type CreateVideoServiceInput = {
  videoId: string;
  url: string;
  caption?: string;
  videoTitle?: string;
  videoAuthor?: string;
  videoThumbnailUrl?: string;
  tagNames: string[];
};

export type CreateVideoServiceResult =
  | { success: true; video: StrapiVideo }
  | { success: false; kind: 'exists'; video: StrapiVideo }
  | { success: false; kind: 'error'; error: string };

export async function createVideoService(
  input: CreateVideoServiceInput,
): Promise<CreateVideoServiceResult> {
  // Pre-check dedupe so we can return 'exists' without parsing Strapi
  // error strings. Server middleware catches races as a second line of
  // defense.
  const existing = await fetchVideoByVideoIdService(input.videoId);
  if (existing) return { success: false, kind: 'exists', video: existing };

  const tagDocumentIds: string[] = [];
  for (const raw of input.tagNames) {
    const existingTag = await findTagByNameService(raw);
    if (existingTag) {
      tagDocumentIds.push(existingTag.documentId);
      continue;
    }
    const created = await createTagService(raw);
    if (created) tagDocumentIds.push(created.documentId);
  }

  const body = {
    data: {
      youtubeVideoId: input.videoId,
      url: input.url,
      caption: input.caption,
      videoTitle: input.videoTitle,
      videoAuthor: input.videoAuthor,
      videoThumbnailUrl: input.videoThumbnailUrl,
      tags: tagDocumentIds,
      summaryStatus: 'pending' as SummaryStatus,
    },
  };

  const result = await strapiFetch<StrapiVideo>('POST', '/api/videos', { body });
  if (!result.ok) {
    return { success: false, kind: 'error', error: result.error };
  }
  return { success: true, video: result.data };
}

// =============================================================================
// Update a video (used by the summary-generation pipeline to land AI output)
// =============================================================================

export type UpdateVideoSummaryInput = {
  documentId: string;
  summaryTitle: string;
  summaryDescription: string;
  summaryOverview: string;
  watchVerdict: WatchVerdict;
  verdictSummary: string;
  verdictReason: string;
  aiModel: string;
  transcriptSegments?: StoredTranscriptIndex;
  keyTakeaways: Array<{ text: string }>;
  sections: Array<{ timeSec?: number; heading: string; body: string }>;
  actionSteps: Array<{ title: string; body: string }>;
};

export async function updateVideoSummaryService(
  input: UpdateVideoSummaryInput,
): Promise<{ success: true; video: StrapiVideo } | { success: false; error: string }> {
  const { documentId, ...rest } = input;
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${documentId}`,
    {
      body: {
        data: {
          ...rest,
          summaryStatus: 'generated' as SummaryStatus,
          summaryGeneratedAt: new Date().toISOString(),
        },
      },
    },
  );
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, video: result.data };
}

// Dedicated writer for embedding fields. Keeping this isolated from the
// summary write path lets the embedding layer evolve (different storage,
// pgvector migration, tier-2 passage-level vectors) without touching
// summary code.
export async function updateVideoEmbeddingService(input: {
  documentId: string;
  embedding: number[];
  model: string;
  version: number;
  generatedAt: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${input.documentId}`,
    {
      body: {
        data: {
          summaryEmbedding: input.embedding,
          embeddingModel: input.model,
          embeddingVersion: input.version,
          embeddingGeneratedAt: input.generatedAt,
        },
      },
    },
  );
  return result.ok ? { success: true } : { success: false, error: result.error };
}

// Dedicated writer for the Tier-2 passage-index JSON blob.
export async function updateVideoPassagesService(input: {
  documentId: string;
  passageEmbeddings: NonNullable<StrapiVideo['passageEmbeddings']>;
}): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${input.documentId}`,
    { body: { data: { passageEmbeddings: input.passageEmbeddings } } },
  );
  return result.ok ? { success: true } : { success: false, error: result.error };
}

export async function markSummaryFailedService(documentId: string): Promise<void> {
  // Best-effort — the chat UI will show the error via its own retry path.
  await strapiFetch('PUT', `/api/videos/${documentId}`, {
    body: { data: { summaryStatus: 'failed' } },
  });
}

// Manually set the timeSec of a single section on a Video row. Strapi's
// repeatable-component semantics mean we have to PUT the whole sections
// array back with the one field updated. Keeps heading/body untouched.
export async function updateSectionTimecodeService(input: {
  documentId: string;
  sectionId: number;
  timeSec: number;
}): Promise<{ success: true } | { success: false; error: string }> {
  // Fetch current sections so we can resend the array with one edit.
  const read = await strapiFetch<StrapiVideo>(
    'GET',
    `/api/videos/${input.documentId}`,
    { query: detailQuery },
  );
  if (!read.ok) return { success: false, error: read.error };
  const video = read.data;
  if (!video) return { success: false, error: 'Video not found' };

  const currentSections = video.sections ?? [];
  let matched = false;
  const nextSections = currentSections.map((s) => {
    if (s.id !== input.sectionId) return { heading: s.heading, body: s.body, timeSec: s.timeSec };
    matched = true;
    return { heading: s.heading, body: s.body, timeSec: input.timeSec };
  });
  if (!matched) return { success: false, error: 'Section not found on this video' };

  const write = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${input.documentId}`,
    { body: { data: { sections: nextSections } } },
  );
  return write.ok ? { success: true } : { success: false, error: write.error };
}

// Flip a completed (or failed) summary back to 'pending' so the generation
// pipeline treats it as fresh work. Intentionally does NOT clear the old
// summary fields — if regeneration fails, the previous content is still on
// the row and can be recovered by clearing the pending flag.
export async function markSummaryPendingService(
  documentId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>('PUT', `/api/videos/${documentId}`, {
    body: { data: { summaryStatus: 'pending' } },
  });
  return result.ok ? { success: true } : { success: false, error: result.error };
}

// =============================================================================
// Transcript (cached YouTube caption source)
//
// Transcripts live on their own collection keyed by youtubeVideoId. The
// generation pipeline looks one up before hitting YouTube; if found, it
// reuses the cached segments. If the AI generation crashes downstream,
// the Transcript remains saved — next retry skips the YouTube fetch.
// =============================================================================

export async function fetchTranscriptByVideoIdService(
  videoId: string,
): Promise<StrapiTranscript | null> {
  const result = await strapiFetch<StrapiTranscript[]>('GET', '/api/transcripts', {
    query: {
      filters: { youtubeVideoId: { $eq: videoId } },
      pagination: { pageSize: 1 },
    },
  });
  return result.ok ? (result.data?.[0] ?? null) : null;
}

export type CreateTranscriptServiceInput = {
  youtubeVideoId: string;
  title?: string;
  author?: string;
  thumbnailUrl?: string;
  language?: string;
  durationSec?: number | null;
  rawSegments: StrapiTranscriptSegment[];
  rawText: string;
};

export async function createTranscriptService(
  input: CreateTranscriptServiceInput,
): Promise<{ success: true; transcript: StrapiTranscript } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiTranscript>('POST', '/api/transcripts', {
    body: { data: { ...input, fetchedAt: new Date().toISOString() } },
  });
  return result.ok
    ? { success: true, transcript: result.data }
    : { success: false, error: result.error };
}

// Attach a Transcript to a Video via the 1:1 relation. Used after the
// Transcript row is created so subsequent reads of the Video populate it.
export async function linkVideoToTranscriptService(
  videoDocumentId: string,
  transcriptDocumentId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${videoDocumentId}`,
    { body: { data: { transcript: transcriptDocumentId } } },
  );
  return result.ok ? { success: true } : { success: false, error: result.error };
}

// =============================================================================
// Tags
// =============================================================================

export async function findTagByNameService(rawName: string): Promise<StrapiTag | null> {
  const name = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!name) return null;
  const result = await strapiFetch<StrapiTag[]>('GET', '/api/tags', {
    query: {
      filters: { name: { $eq: name } },
      pagination: { pageSize: 1 },
    },
  });
  return result.ok ? (result.data?.[0] ?? null) : null;
}

export async function searchTagsService(query: string, limit = 8): Promise<StrapiTag[]> {
  const q = query.trim().toLowerCase();
  const result = await strapiFetch<StrapiTag[]>('GET', '/api/tags', {
    query: {
      ...(q ? { filters: { name: { $containsi: q } } } : {}),
      sort: 'name:asc',
      pagination: { pageSize: limit },
    },
  });
  return result.ok ? (result.data ?? []) : [];
}

async function createTagService(name: string): Promise<StrapiTag | null> {
  const result = await strapiFetch<StrapiTag>('POST', '/api/tags', {
    body: { data: { name } },
  });
  return result.ok ? result.data : null;
}

// =============================================================================
// Asset URL helper
// =============================================================================

export const strapiAssetUrl = (path: string | null | undefined) => {
  if (!path) return null;
  if (path.startsWith('data:') || path.startsWith('http') || path.startsWith('//')) {
    return path;
  }
  return `${STRAPI_URL}${path}`;
};
