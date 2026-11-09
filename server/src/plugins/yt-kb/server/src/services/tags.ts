import type { Core } from '@strapi/strapi';
import { normalizeTagName } from '../document-rules';
import { isUniqueViolation } from './db-errors';

const TAG = 'plugin::yt-kb.tag';

export type TagRow = { documentId: string; name: string; slug: string };

/**
 * The one tag find-or-create (addVideo, tagVideo). Returns null for a name
 * that is empty after normalization.
 *
 * Outside a transaction, a unique violation means another writer won the
 * race: re-read by name and return that row; if no row has the name (the
 * clash was on the slug), create once more — the slug rule then picks the
 * next free suffix. Inside a transaction the error is rethrown: Postgres
 * has aborted the transaction, so the caller retries it whole
 * (withUniqueRetry).
 */
export async function findOrCreateTag(strapi: Core.Strapi, rawName: string): Promise<TagRow | null> {
  const name = normalizeTagName(rawName);
  if (!name) return null;

  const find = async () =>
    (await strapi.documents(TAG as never).findFirst({
      filters: { name: { $eq: name } },
      fields: ['name', 'slug'],
    } as never)) as unknown as TagRow | null;

  const existing = await find();
  if (existing) return existing;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return (await strapi.documents(TAG as never).create({ data: { name } } as never)) as unknown as TagRow;
    } catch (err) {
      if (!isUniqueViolation(err) || strapi.db.inTransaction() || attempt === 2) throw err;
      const raced = await find();
      if (raced) return raced;
    }
  }
}
