import { describe, expect, it } from 'vitest';
import { collectTags, tagSlug } from './tags';

describe('tagSlug', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(tagSlug('Local AI')).toBe('local-ai');
  });

  it('strips punctuation that would break a URL', () => {
    expect(tagSlug('C#/.NET')).toBe('c-net');
    expect(tagSlug('ai & agents')).toBe('ai-agents');
  });

  it('collapses runs of separators and trims them', () => {
    expect(tagSlug('  spaced   out  ')).toBe('spaced-out');
    expect(tagSlug('--edge--')).toBe('edge');
  });

  it('is stable — slugging a slug changes nothing', () => {
    expect(tagSlug(tagSlug('Local AI'))).toBe('local-ai');
  });

  // Tags are typed by hand in the app. A name with no ASCII letters at all
  // must still get a page rather than vanishing from the site silently.
  it('gives a name with no latin characters a stable slug of its own', () => {
    const slug = tagSlug('日本語');
    expect(slug).not.toBe('');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(tagSlug(slug)).toBe(slug);
    expect(tagSlug('中文')).not.toBe(slug);
  });
});

describe('collectTags', () => {
  const videos = [
    { tags: [{ name: 'Local AI' }, { name: 'strapi' }] },
    { tags: [{ name: 'local ai' }] },
    { tags: [] },
  ] as never[];

  it('counts videos per tag, merging names that slug the same', () => {
    const tags = collectTags(videos);
    const localAi = tags.find((t) => t.slug === 'local-ai');
    expect(localAi?.count).toBe(2);
  });

  it('sorts by count, then name', () => {
    expect(collectTags(videos).map((t) => t.slug)).toEqual(['local-ai', 'strapi']);
  });

  it('handles a library with no tags at all', () => {
    expect(collectTags([{ tags: [] }] as never[])).toEqual([]);
  });
});
