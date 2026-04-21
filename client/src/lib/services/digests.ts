// Digest CRUD against `api::digest.digest`. Persists the structured data
// as Strapi components (matching how Video stores sections/takeaways/etc.)
// rather than a single JSON blob — so digests are first-class editable
// content in the admin panel and queryable by sub-field.
//
// The service boundary translates between the LLM-shaped `Digest` Zod
// type (what the UI consumes) and the decomposed Strapi row + components.
// Callers never see the raw component arrays; they get a `Digest`.

import { STRAPI_URL, STRAPI_API_TOKEN } from '#/lib/env';
import type { Digest } from './digest';

type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

function strapiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (STRAPI_API_TOKEN) headers.Authorization = `Bearer ${STRAPI_API_TOKEN}`;
  return headers;
}

async function logFetchError(res: Response, tag: string): Promise<void> {
  const body = await res.text().catch(() => '');
  // eslint-disable-next-line no-console
  console.error(`[${tag}] strapi request failed`, {
    status: res.status,
    url: res.url,
    body: body.slice(0, 500),
  });
}

// =============================================================================
// Strapi row types — shape of what /api/digests returns when fully populated.
// =============================================================================

export type StrapiDigestVideo = {
  id: number;
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
};

type StrapiDigestVideoTitle = { id: number; title: string };

type StrapiDigestSharedTheme = {
  id: number;
  title: string;
  body: string;
  videoTitles: StrapiDigestVideoTitle[] | null;
};

type StrapiDigestUniqueInsight = {
  id: number;
  videoTitle: string;
  insight: string;
};

type StrapiDigestContradictionPosition = {
  id: number;
  videoTitle: string;
  stance: string;
};

type StrapiDigestContradiction = {
  id: number;
  topic: string;
  positions: StrapiDigestContradictionPosition[] | null;
};

type StrapiDigestViewingOrder = {
  id: number;
  videoTitle: string;
  why: string;
};

export type StrapiDigest = {
  id: number;
  documentId: string;
  title: string;
  description: string | null;
  overallTheme: string | null;
  bottomLine: string | null;
  sharedThemes: StrapiDigestSharedTheme[] | null;
  uniqueInsights: StrapiDigestUniqueInsight[] | null;
  contradictions: StrapiDigestContradiction[] | null;
  viewingOrder: StrapiDigestViewingOrder[] | null;
  articleMarkdown: string | null;
  model: string | null;
  videoSetKey: string | null;
  videos: StrapiDigestVideo[];
  createdAt: string;
  updatedAt: string;
};

// =============================================================================
// (Dis)assembly — translate between the LLM-shaped `Digest` and the component
// arrays Strapi stores. The UI only ever sees `Digest`.
// =============================================================================

// Pull a `Digest` out of a populated Strapi row. Missing/null component
// arrays collapse to empty arrays; missing scalar strings collapse to ''.
// This keeps the UI rendering code unchanged — it still consumes a Digest.
export function strapiRowToDigest(row: StrapiDigest): Digest {
  return {
    title: row.title,
    description: row.description ?? '',
    overallTheme: row.overallTheme ?? '',
    bottomLine: row.bottomLine ?? '',
    sharedThemes: (row.sharedThemes ?? []).map((t) => ({
      title: t.title,
      body: t.body,
      videoTitles: (t.videoTitles ?? []).map((vt) => vt.title),
    })),
    uniqueInsights: (row.uniqueInsights ?? []).map((u) => ({
      videoTitle: u.videoTitle,
      insight: u.insight,
    })),
    contradictions: (row.contradictions ?? []).map((c) => ({
      topic: c.topic,
      positions: (c.positions ?? []).map((p) => ({
        videoTitle: p.videoTitle,
        stance: p.stance,
      })),
    })),
    viewingOrder: (row.viewingOrder ?? []).map((v) => ({
      videoTitle: v.videoTitle,
      why: v.why,
    })),
  };
}

// Inverse: build the Strapi POST/PUT payload fragment from a Digest.
// Component writes are inline in the data payload — Strapi creates the
// component rows and links them.
function digestToComponentPayload(d: Digest): Record<string, unknown> {
  return {
    overallTheme: d.overallTheme,
    bottomLine: d.bottomLine,
    sharedThemes: d.sharedThemes.map((t) => ({
      title: t.title,
      body: t.body,
      videoTitles: t.videoTitles.map((title) => ({ title })),
    })),
    uniqueInsights: d.uniqueInsights.map((u) => ({
      videoTitle: u.videoTitle,
      insight: u.insight,
    })),
    contradictions: d.contradictions.map((c) => ({
      topic: c.topic,
      positions: c.positions.map((p) => ({
        videoTitle: p.videoTitle,
        stance: p.stance,
      })),
    })),
    viewingOrder: d.viewingOrder.map((v) => ({
      videoTitle: v.videoTitle,
      why: v.why,
    })),
  };
}

// =============================================================================
// CRUD
// =============================================================================

function digestQueryParams(): URLSearchParams {
  const params = new URLSearchParams();
  params.set('populate[videos]', 'true');
  // Populate every component array + their nested components so the row
  // comes back fully reassemble-able.
  params.set('populate[sharedThemes][populate][videoTitles]', 'true');
  params.set('populate[uniqueInsights]', 'true');
  params.set('populate[contradictions][populate][positions]', 'true');
  params.set('populate[viewingOrder]', 'true');
  return params;
}

export function makeVideoSetKey(youtubeVideoIds: string[]): string {
  return [...youtubeVideoIds]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

export async function createDigestService(input: {
  title: string;
  description?: string | null;
  digest: Digest;
  articleMarkdown?: string | null;
  videoDocumentIds: string[];
  videoSetKey: string;
  model?: string | null;
}): Promise<ServiceResult<StrapiDigest>> {
  const componentPayload = digestToComponentPayload(input.digest);
  const res = await fetch(`${STRAPI_URL}/api/digests?${digestQueryParams().toString()}`, {
    method: 'POST',
    headers: strapiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      data: {
        title: input.title,
        description: input.description ?? null,
        ...componentPayload,
        articleMarkdown: input.articleMarkdown ?? null,
        model: input.model ?? null,
        videoSetKey: input.videoSetKey,
        videos: input.videoDocumentIds,
      },
    }),
  });
  if (!res.ok) {
    await logFetchError(res, 'createDigestService');
    return { success: false, error: `Strapi error ${res.status}` };
  }
  const json = (await res.json()) as { data: StrapiDigest };
  return { success: true, data: json.data };
}

export type PaginatedDigests = {
  digests: StrapiDigest[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function listDigestsService(input?: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<ServiceResult<PaginatedDigests>> {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 20;
  const params = digestQueryParams();
  params.set('sort', 'createdAt:desc');
  params.set('pagination[page]', String(page));
  params.set('pagination[pageSize]', String(pageSize));
  params.set('pagination[withCount]', 'true');

  const q = input?.q?.trim();
  if (q) {
    params.set('filters[$or][0][title][$containsi]', q);
    params.set('filters[$or][1][description][$containsi]', q);
  }

  const res = await fetch(`${STRAPI_URL}/api/digests?${params.toString()}`, {
    headers: strapiHeaders(),
  });
  if (!res.ok) {
    await logFetchError(res, 'listDigestsService');
    return { success: false, error: `Strapi error ${res.status}` };
  }
  const json = (await res.json()) as {
    data: StrapiDigest[];
    meta?: { pagination?: { total?: number; pageCount?: number } };
  };
  const total = json.meta?.pagination?.total ?? json.data.length;
  const pageCount = json.meta?.pagination?.pageCount ?? 1;
  return {
    success: true,
    data: { digests: json.data, total, page, pageSize, pageCount },
  };
}

export async function fetchDigestByDocumentIdService(
  documentId: string,
): Promise<StrapiDigest | null> {
  const res = await fetch(
    `${STRAPI_URL}/api/digests/${documentId}?${digestQueryParams().toString()}`,
    { headers: strapiHeaders() },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    await logFetchError(res, 'fetchDigestByDocumentIdService');
    return null;
  }
  const json = (await res.json()) as { data: StrapiDigest | null };
  return json.data ?? null;
}

export async function updateDigestService(input: {
  documentId: string;
  title?: string;
  description?: string | null;
  digest?: Digest;
  articleMarkdown?: string | null;
  videoDocumentIds?: string[];
  model?: string | null;
}): Promise<ServiceResult<StrapiDigest>> {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.digest !== undefined) {
    Object.assign(data, digestToComponentPayload(input.digest));
  }
  if (input.articleMarkdown !== undefined) data.articleMarkdown = input.articleMarkdown;
  if (input.videoDocumentIds !== undefined) data.videos = input.videoDocumentIds;
  if (input.model !== undefined) data.model = input.model;
  const res = await fetch(
    `${STRAPI_URL}/api/digests/${input.documentId}?${digestQueryParams().toString()}`,
    {
      method: 'PUT',
      headers: strapiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data }),
    },
  );
  if (!res.ok) {
    await logFetchError(res, 'updateDigestService');
    return { success: false, error: `Strapi error ${res.status}` };
  }
  const json = (await res.json()) as { data: StrapiDigest };
  return { success: true, data: json.data };
}

export async function findDigestByVideoSetKeyService(
  videoSetKey: string,
): Promise<ServiceResult<StrapiDigest | null>> {
  const params = digestQueryParams();
  params.set('filters[videoSetKey][$eq]', videoSetKey);
  params.set('pagination[pageSize]', '1');
  const res = await fetch(`${STRAPI_URL}/api/digests?${params.toString()}`, {
    headers: strapiHeaders(),
  });
  if (!res.ok) {
    await logFetchError(res, 'findDigestByVideoSetKeyService');
    return { success: false, error: `Strapi error ${res.status}` };
  }
  const json = (await res.json()) as { data: StrapiDigest[] };
  return { success: true, data: json.data[0] ?? null };
}

export async function deleteDigestService(
  documentId: string,
): Promise<ServiceResult<void>> {
  const res = await fetch(`${STRAPI_URL}/api/digests/${documentId}`, {
    method: 'DELETE',
    headers: strapiHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    await logFetchError(res, 'deleteDigestService');
    return { success: false, error: `Strapi error ${res.status}` };
  }
  return { success: true, data: undefined };
}
