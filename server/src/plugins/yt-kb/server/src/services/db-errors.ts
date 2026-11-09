import { errors } from '@strapi/utils';

/** `details.code` on every duplicate error yt-kb raises itself. */
export const UNIQUE_CODE = 'YT_KB_UNIQUE';

/** Strapi's entity-validator message for a failed `unique` / `uid` check
 *  (@strapi/core services/entity-validator/validators.js). */
export const UNIQUE_MESSAGE = 'This attribute must be unique';

type Loose = {
  code?: unknown;
  details?: { code?: unknown; errors?: Array<{ message?: unknown }> };
};

/**
 * True when `err` is a duplicate on a unique key, however it surfaced:
 *  - better-sqlite3 `SqliteError` `SQLITE_CONSTRAINT_UNIQUE` and pg
 *    `DatabaseError` `23505` — Strapi 5.52.1–5.61.0 pass both through
 *    unchanged (the dialects map only NOT NULL);
 *  - mysql2 `ER_DUP_ENTRY` — recognised only so the check is complete;
 *    the plugin supports SQLite and PostgreSQL, not MySQL/MariaDB;
 *  - an error yt-kb raised with `details.code === UNIQUE_CODE`;
 *  - Strapi's validator `ValidationError` "This attribute must be unique".
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Loose;
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === '23505' || e.code === 'ER_DUP_ENTRY') return true;
  if (e.details?.code === UNIQUE_CODE) return true;
  return (
    err instanceof errors.ValidationError &&
    Array.isArray(e.details?.errors) &&
    e.details.errors.some((x) => x?.message === UNIQUE_MESSAGE)
  );
}

/**
 * Run `work` (normally a whole `strapi.db.transaction`) and, if it fails on
 * a unique key, run it once more. The second pass sees the row the other
 * writer committed. Postgres aborts a transaction on its first error, so
 * this retry — outside the transaction — is the only safe recovery.
 */
export async function withUniqueRetry<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return work();
  }
}
