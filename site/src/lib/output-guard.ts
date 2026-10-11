import { FORBIDDEN_FIELDS } from './video';

/** Field names that must never appear in published output.
 *
 *  Matched as exact field names, not as substrings of prose — a summary that
 *  discusses "embeddings" is fine; a page carrying a `summaryEmbedding` key
 *  is a leak. */
export function findForbidden(text: string): string[] {
  return FORBIDDEN_FIELDS.filter((field) => text.includes(field)).sort();
}
