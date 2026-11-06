// The canonical `name → slug` transform for Tag rows.
//
// The Tag content type has `slug: { type: 'uid', targetField: 'name',
// required: true }`, and Strapi generates uid fields only in the admin panel.
// The Document Service middleware in src/index.ts applies this function to
// every tag create that arrives without a slug — REST (the app), MCP, or
// anything else — so callers no longer need to pass one.
//
// Do not change its output: the existing tag rows already hold slugs made by
// it, and the admin UI's own generator produces the same shape.

export function slugifyTagName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tag';
}
