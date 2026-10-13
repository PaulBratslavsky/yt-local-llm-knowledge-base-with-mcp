import { VIDEO_FIELDS } from './video';

/** Nested shapes and the fields published from each. Components and the tag
 *  relation need an explicit `populate` — Strapi omits them otherwise — so
 *  this is the allowlist for the nested half of a row. */
const NESTED_FIELDS: Record<string, readonly string[]> = {
  keyTakeaways: ['text'],
  sections: ['heading', 'body', 'timeSec'],
  actionSteps: ['title', 'body'],
  tags: ['name'],
};

/** Strapi's REST default cap. Asking for more silently gets you 100. */
const DEFAULT_PAGE_SIZE = 100;

/** The query for one page of publishable videos.
 *
 *  Every field the site may render is named here and nothing else is, which
 *  is what keeps retrieval state out of the output: an unnamed field never
 *  crosses the wire, so it cannot leak by accident later. */
export function buildVideoQuery(page: number, pageSize: number): URLSearchParams {
  const params = new URLSearchParams();

  VIDEO_FIELDS.forEach((field, i) => params.set(`fields[${i}]`, field));

  for (const [nested, fields] of Object.entries(NESTED_FIELDS)) {
    fields.forEach((field, i) => params.set(`populate[${nested}][fields][${i}]`, field));
  }

  params.set('filters[summaryStatus][$eq]', 'generated');
  params.set('sort[0]', 'summaryGeneratedAt:desc');
  // summaryGeneratedAt is not unique, and a tie ordered differently on two
  // page requests silently drops one row and duplicates another.
  params.set('sort[1]', 'youtubeVideoId:asc');
  params.set('pagination[page]', String(page));
  params.set('pagination[pageSize]', String(pageSize));

  return params;
}

interface FetchOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  pageSize?: number;
}

/** Every video with a generated summary, newest first.
 *
 *  Throws on anything short of a complete library. A build that quietly
 *  shipped half the content — or none of it — is worse than a build that
 *  failed, because nobody would notice. Same rule the app follows for
 *  backend errors (ADR-0007): surface it, don't degrade to empty data.
 */
export async function fetchGeneratedVideos({
  baseUrl,
  fetchImpl = fetch,
  pageSize = DEFAULT_PAGE_SIZE,
}: FetchOptions): Promise<unknown[]> {
  const root = baseUrl.replace(/\/+$/, '');
  const rows: unknown[] = [];
  let page = 1;
  let pageCount = 1;
  let expectedTotal: number | null = null;

  do {
    const url = `${root}/videos?${buildVideoQuery(page, pageSize).toString()}`;

    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch (cause) {
      throw new Error(
        `Cannot reach Strapi at ${baseUrl} — is the stack running? ` +
          `(${cause instanceof Error ? cause.message : String(cause)})`,
        { cause },
      );
    }

    if (!response.ok) {
      throw new Error(`Strapi answered ${response.status} for ${url}`);
    }

    const payload = (await response.json()) as {
      data?: unknown;
      meta?: { pagination?: { pageCount?: number; total?: number } };
    };

    if (!Array.isArray(payload.data)) {
      throw new Error(
        `Unexpected response from ${url} — expected a Strapi collection, got ${typeof payload.data}`,
      );
    }

    const pagination = payload.meta?.pagination;

    if (page === 1) {
      // Without a declared total there is no way to tell a complete library
      // from a truncated one, and `withCount: false` in Strapi's config
      // removes it. Refuse rather than guess: a one-page read of a 172-video
      // library looks exactly like a complete 100-video library.
      const total = Number(pagination?.total);
      if (!Number.isFinite(total)) {
        throw new Error(
          `Strapi did not report how many videos exist (meta.pagination.total ` +
            `missing from ${url}). Refusing to build a library whose ` +
            `completeness cannot be checked — is withCount disabled?`,
        );
      }
      expectedTotal = total;
    }

    rows.push(...payload.data);

    // Strapi may report the total without a page count. Deriving it from the
    // total keeps a multi-page library complete; stopping at page one would
    // fetch a fraction and then blame the row count for the shortfall.
    const reported = Number(pagination?.pageCount);
    pageCount =
      Number.isFinite(reported) && reported > 0
        ? reported
        : Math.max(1, Math.ceil((expectedTotal ?? 0) / pageSize));
    page += 1;
  } while (page <= pageCount);

  if (rows.length !== expectedTotal) {
    throw new Error(
      `Fetched ${rows.length} videos but Strapi reports ${expectedTotal} exist. ` +
        'Refusing to build a partial site.',
    );
  }

  if (rows.length === 0) {
    throw new Error(
      `No videos with summaryStatus "generated" came back from ${baseUrl}. ` +
        'Refusing to build an empty site.',
    );
  }

  return rows;
}
