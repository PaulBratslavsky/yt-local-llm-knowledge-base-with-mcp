import type { Video } from './video';

/** URL-safe, stable, and idempotent.
 *
 *  Tag names are user-entered in the app, so they arrive with spaces, case
 *  and punctuation. The slug is what appears in `/t/<slug>`, and
 *  `tagSlug(tagSlug(x)) === tagSlug(x)` so a slug can be round-tripped
 *  through the function without drifting.
 *
 *  A name with no ASCII alphanumerics at all — "日本語", "???" — would
 *  reduce to the empty string, which is not a URL. Those fall back to their
 *  code points, which is ugly but stable, distinct per name, and still
 *  idempotent. Dropping the tag instead would make it disappear from the
 *  site with nothing to show why. */
export function tagSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug) return slug;

  const codePoints = Array.from(name.trim())
    .map((char) => char.codePointAt(0)?.toString(16) ?? '')
    .filter(Boolean)
    .join('-');

  return codePoints ? `tag-${codePoints}` : '';
}

export type TagSummary = { name: string; slug: string; count: number };

/** Every tag in the library with its video count, most used first.
 *
 *  Two names that slug the same ("Local AI" and "local ai") are one tag —
 *  the first name seen wins as the display name. */
export function collectTags(videos: Pick<Video, 'tags'>[]): TagSummary[] {
  const bySlug = new Map<string, TagSummary>();

  for (const video of videos) {
    for (const tag of video.tags ?? []) {
      const slug = tagSlug(tag.name);
      if (!slug) continue;
      const existing = bySlug.get(slug);
      if (existing) existing.count += 1;
      else bySlug.set(slug, { name: tag.name, slug, count: 1 });
    }
  }

  return Array.from(bySlug.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}
