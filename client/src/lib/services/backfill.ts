// Settings backfills (M-13). Each one writes the field it filters on, so a
// row it fixes drops out of the eligible set; paging page=2,3,… over a set
// that shrinks underneath skipped rows. This re-reads from the front
// instead, starting after the rows this run could not fix: they stay
// eligible and, with a stable `id:asc` sort, sit before every row not yet
// seen.
import type { StrapiResult } from './strapi-client';
import { friendlyBackendError } from './backend-errors';

export type BackfillOutcome = 'updated' | 'skipped' | { failed: string };

export type BackfillRunResult = {
  /** 'error' = the run stopped early; `error` says why. Counts cover what ran. */
  status: 'ok' | 'error';
  updated: number;
  /** Rows this backfill cannot fix (e.g. no cached transcript). */
  skipped: number;
  /** Rows whose write failed. */
  failed: number;
  /** Eligible rows when the run started. */
  total: number;
  /** The first five write failures, as `<documentId>: <message>`. */
  errors: string[];
  error?: string;
};

/** Upper bound on read passes: 200 × 100 rows covers 20,000 videos. */
export const BACKFILL_MAX_PASSES = 200;

export async function runBackfill<Row extends { documentId: string }>(opts: {
  pageSize: number;
  readPage: (start: number, limit: number) => Promise<StrapiResult<Row[]>>;
  process: (row: Row) => Promise<BackfillOutcome>;
  maxPasses?: number;
}): Promise<BackfillRunResult> {
  const maxPasses = opts.maxPasses ?? BACKFILL_MAX_PASSES;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let total: number | null = null;
  const errors: string[] = [];
  const finish = (status: 'ok' | 'error', error?: string): BackfillRunResult => ({
    status,
    updated,
    skipped,
    failed,
    total: total ?? 0,
    errors,
    ...(error ? { error } : {}),
  });

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const page = await opts.readPage(skipped + failed, opts.pageSize);
    if (!page.ok) return finish('error', friendlyBackendError(page.status, page.error));
    const rows = page.data ?? [];
    if (total === null) total = page.meta?.pagination?.total ?? rows.length;
    if (rows.length === 0) return finish('ok');
    for (const row of rows) {
      const outcome = await opts.process(row);
      if (outcome === 'updated') updated += 1;
      else if (outcome === 'skipped') skipped += 1;
      else {
        failed += 1;
        if (errors.length < 5) errors.push(`${row.documentId}: ${outcome.failed}`);
      }
    }
  }
  return finish('error', `Stopped after ${maxPasses} passes — run it again to continue.`);
}
