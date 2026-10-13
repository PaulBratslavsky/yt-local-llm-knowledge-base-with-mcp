import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildSearchDocs } from '../lib/search-docs';

/** Emitted as a static file at build time. The search island fetches it
 *  once and searches in memory — no per-keystroke network. */
export const GET: APIRoute = async () => {
  const entries = await getCollection('videos');
  const docs = buildSearchDocs(entries.map((e) => e.data));

  return new Response(JSON.stringify(docs), {
    headers: { 'Content-Type': 'application/json' },
  });
};
