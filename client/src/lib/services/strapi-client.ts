// Strapi REST client — one Module owning the URL composition, auth
// header, query-param syntax, JSON envelope, and error normalization
// for every Strapi call across the codebase. Replaces ~17 inline
// `fetch(${STRAPI_URL}/api/...)` sites that each rebuilt the same
// boilerplate with subtle variations.
//
// Used by every service that talks to Strapi (`videos.ts`, `notes.ts`,
// `digests.ts`, `reader.ts`) and the Settings backfill server functions.
// Server-only — pulls `STRAPI_URL` and `STRAPI_API_TOKEN` from the env layer.
//
// Exposes a discriminated-union return type (`StrapiResult<T>`). The
// helper never throws on HTTP errors — callers handle the `ok: false`
// branch explicitly. This matches the existing `ServiceResult` pattern
// across the services layer.

import { STRAPI_URL, STRAPI_API_TOKEN } from '#/lib/env';

// -----------------------------------------------------------------------------
// Query types
// -----------------------------------------------------------------------------

// Recursive value type covering everything Strapi's query syntax accepts
// inside a `filters[]` or `populate[]` chain — primitives, arrays
// (which become indexed keys: `[0]`, `[1]`…), and nested objects.
type QueryValue = string | number | boolean | QueryValue[] | { [key: string]: QueryValue };

// `populate` has three idiomatic shapes in Strapi:
//   - '*'                              → populate=*
//   - ['tags', 'sections']             → populate[tags]=true&populate[sections]=true
//   - { contradictions: { populate: ['positions'] } }
//                                      → populate[contradictions][populate][positions]=true
type Populate = '*' | string[] | { [key: string]: QueryValue };

export type StrapiQuery = {
  populate?: Populate;
  filters?: { [key: string]: QueryValue };
  fields?: string[];
  sort?: string | string[];
  pagination?: {
    page?: number;
    pageSize?: number;
    /** Offset form; Strapi rejects mixing it with page/pageSize. */
    start?: number;
    limit?: number;
    withCount?: boolean;
  };
};

// -----------------------------------------------------------------------------
// Result types
// -----------------------------------------------------------------------------

export type StrapiResult<T> =
  | { ok: true; data: T; meta?: StrapiMeta }
  | { ok: false; status: number; error: string; details?: Record<string, unknown> };

export type StrapiMeta = {
  pagination?: {
    page?: number;
    pageCount?: number;
    pageSize?: number;
    total?: number;
  };
};

/** A duplicate on a unique key, so the caller re-reads before reporting an
 *  error: a 400 carrying strapi-plugin-yt-kb's `details.code: 'YT_KB_UNIQUE'`.
 *  Since M2 every duplicate on a yt-kb type has it: yt-kb's create rules
 *  ("… already exists …"), and everything the plugin's Document Service
 *  middleware rethrows as "This attribute must be unique" — a validator
 *  failure on one attribute or several (a lost tag race's "2 errors
 *  occurred"), and a raw unique-index error. The message test is the
 *  fallback for a 400 without details. A 500 is never read as a duplicate:
 *  since M2 a duplicate on a yt-kb type never reaches REST as one. */
export function isUniqueViolation(result: StrapiResult<unknown>): boolean {
  if (result.ok || result.status !== 400) return false;
  if (result.details?.code === 'YT_KB_UNIQUE') return true;
  return /already exists|must be unique/i.test(result.error);
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Default deadline for one Strapi exchange, body included. */
export const STRAPI_TIMEOUT_MS = 30_000;

function networkErrorMessage(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return `Strapi did not respond within ${Math.round(timeoutMs / 1000)} s.`;
  }
  return err instanceof Error ? err.message : 'Network error';
}

type FetchOpts = {
  query?: StrapiQuery;
  body?: unknown;
  /** Abort after this many ms. Default STRAPI_TIMEOUT_MS. */
  timeoutMs?: number;
};

// -----------------------------------------------------------------------------
// Query → URLSearchParams
// -----------------------------------------------------------------------------

// Recursive flattener: turns a nested value into Strapi's
// `key[a][b][c]=value` URL-param syntax. Arrays use numeric indices
// (`[0]`, `[1]`…); objects use bracketed keys; primitives terminate.
function appendQueryValue(
  params: URLSearchParams,
  key: string,
  value: QueryValue,
): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => appendQueryValue(params, `${key}[${i}]`, v));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      appendQueryValue(params, `${key}[${k}]`, v);
    }
    return;
  }
  // primitive (string | number | boolean)
  params.set(key, String(value));
}

export function buildQueryParams(query: StrapiQuery | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (!query) return params;

  // populate has special-cased shapes; everything else flattens
  // through the same recursive path.
  if (query.populate !== undefined) {
    if (query.populate === '*') {
      params.set('populate', '*');
    } else if (Array.isArray(query.populate)) {
      for (const name of query.populate) {
        params.set(`populate[${name}]`, 'true');
      }
    } else {
      for (const [k, v] of Object.entries(query.populate)) {
        appendQueryValue(params, `populate[${k}]`, v);
      }
    }
  }

  if (query.filters !== undefined) {
    for (const [k, v] of Object.entries(query.filters)) {
      appendQueryValue(params, `filters[${k}]`, v);
    }
  }

  if (query.fields !== undefined) {
    query.fields.forEach((f, i) => params.set(`fields[${i}]`, f));
  }

  if (query.sort !== undefined) {
    if (typeof query.sort === 'string') {
      params.set('sort', query.sort);
    } else {
      query.sort.forEach((s, i) => params.set(`sort[${i}]`, s));
    }
  }

  if (query.pagination) {
    const { page, pageSize, start, limit, withCount } = query.pagination;
    if (page !== undefined) params.set('pagination[page]', String(page));
    if (pageSize !== undefined) params.set('pagination[pageSize]', String(pageSize));
    if (start !== undefined) params.set('pagination[start]', String(start));
    if (limit !== undefined) params.set('pagination[limit]', String(limit));
    if (withCount !== undefined) params.set('pagination[withCount]', String(withCount));
  }

  return params;
}

// -----------------------------------------------------------------------------
// Path segments
// -----------------------------------------------------------------------------

/** Encode one Strapi path segment. Every value from input goes through this
 *  before it is put into a path (B-1): `fetch` resolves dot segments, so an
 *  unencoded `../../users/1` turns `/api/yt-kb/notes/<id>` into
 *  `/api/users/1`, sent with the app's token. encodeURIComponent turns `/`,
 *  `?` and `#` into %2F, %3F and %23. It leaves `.` alone, and a WHATWG URL
 *  resolves a whole `..` or `.` segment (and `%2e%2e`) even when encoded, so
 *  those — and the empty segment — are refused outright. */
export function seg(value: string): string {
  if (value === '' || value === '.' || value === '..') {
    throw new Error(`Refusing to build a Strapi path from the segment "${value}"`);
  }
  return encodeURIComponent(value);
}

// -----------------------------------------------------------------------------
// Fetch
// -----------------------------------------------------------------------------

function buildHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (STRAPI_API_TOKEN) headers.Authorization = `Bearer ${STRAPI_API_TOKEN}`;
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}

function buildUrl(path: string, query: StrapiQuery | undefined): string {
  const params = buildQueryParams(query);
  const qs = params.toString();
  const sep = qs ? (path.includes('?') ? '&' : '?') : '';
  return `${STRAPI_URL}${path}${sep}${qs}`;
}

function logFailure(method: Method, url: string, status: number, body: string): void {
  // eslint-disable-next-line no-console
  console.error('[strapi]', { method, status, url, body: body.slice(0, 500) });
}

export async function strapiFetch<T>(
  method: Method,
  path: string,
  opts?: FetchOpts,
): Promise<StrapiResult<T>> {
  const url = buildUrl(path, opts?.query);
  const hasBody = opts?.body !== undefined;
  const timeoutMs = opts?.timeoutMs ?? STRAPI_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: buildHeaders(hasBody),
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal,
    });
  } catch (err) {
    const message = networkErrorMessage(err, timeoutMs);
    logFailure(method, url, 0, message);
    return { ok: false, status: 0, error: message };
  }

  if (!res.ok) {
    // Read the body once for both error parsing and logging — calling
    // res.text()/json() twice would throw on a consumed body.
    const raw = await res.text().catch(() => '');
    let error = `Strapi error ${res.status}`;
    let details: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string; details?: unknown } };
      if (parsed.error?.message) error = parsed.error.message;
      const d = parsed.error?.details;
      if (d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length > 0) {
        details = d as Record<string, unknown>;
      }
    } catch {
      /* not JSON */
    }
    logFailure(method, url, res.status, raw);
    return details ? { ok: false, status: res.status, error, details } : { ok: false, status: res.status, error };
  }

  // Some endpoints (DELETE, no-content writes) return nothing. We treat
  // an empty body as `{ data: undefined as T }` — callers using the
  // helper for fire-and-forget writes can ignore the data field.
  // AbortSignal.timeout also aborts a body that is still streaming, and
  // this helper must never throw.
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    const message = networkErrorMessage(err, timeoutMs);
    logFailure(method, url, 0, message);
    return { ok: false, status: 0, error: message };
  }
  if (!text) {
    return { ok: true, data: undefined as T };
  }
  let json: { data?: T; meta?: StrapiMeta };
  try {
    json = JSON.parse(text) as { data?: T; meta?: StrapiMeta };
  } catch {
    logFailure(method, url, res.status, text);
    return { ok: false, status: res.status, error: 'Invalid JSON in Strapi response' };
  }
  return { ok: true, data: json.data as T, meta: json.meta };
}
