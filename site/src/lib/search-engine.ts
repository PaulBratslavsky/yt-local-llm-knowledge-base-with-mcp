import MiniSearch from 'minisearch';
import type { SearchDoc } from './search-docs';

/** Field weights: a hit in the title is worth more than one buried in the
 *  overview, which is what makes two-word queries land on the right video. */
const FIELD_BOOSTS = {
  title: 4,
  tags: 3,
  description: 2,
  takeaways: 2,
  sections: 2,
  author: 1.5,
  overview: 1,
};

export function createIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const index = new MiniSearch<SearchDoc>({
    idField: 'id',
    fields: [
      'title',
      'author',
      'description',
      'overview',
      'takeaways',
      'sections',
      'tags',
    ],
    // Never store a field named `score`: MiniSearch assigns stored fields
    // onto the result object, over its own `score` (the relevance), and then
    // sorts by it — which would order results by content score.
    storeFields: ['id', 'title', 'author', 'description', 'tags', 'verdict', 'contentScore'],
    searchOptions: {
      boost: FIELD_BOOSTS,
      prefix: true,
      fuzzy: 0.2,
    },
  });
  index.addAll(docs);
  return index;
}

export type SearchOptions = {
  tag?: string;
  verdict?: string;
  minScore?: number;
};

/** Does this document pass the facets? Shared by the query path and the
 *  browse path so a facet cannot mean one thing while typing and another
 *  thing at rest. */
export function matchesFacets(doc: SearchDoc, opts: SearchOptions): boolean {
  if (opts.tag && !(doc.tags ?? []).includes(opts.tag)) return false;
  if (opts.verdict && doc.verdict !== opts.verdict) return false;
  if (typeof opts.minScore === 'number' && (doc.contentScore ?? 0) < opts.minScore) {
    return false;
  }
  return true;
}

/** The library narrowed by facet alone, best-rated first.
 *
 *  Picking a facet with an empty search box should narrow what you are
 *  browsing, not search for nothing. MiniSearch has no match-all query, so
 *  this path filters the documents directly. */
export function filterDocs(docs: readonly SearchDoc[], opts: SearchOptions): SearchDoc[] {
  return docs
    .filter((doc) => matchesFacets(doc, opts))
    .sort((a, b) => (b.contentScore ?? 0) - (a.contentScore ?? 0));
}

/** Ranked matches, optionally narrowed by facet.
 *
 *  A blank query returns nothing rather than the whole library — the home
 *  page already lists videos, so dumping all of them into the result area
 *  would just be noise. */
export function runSearch(
  index: MiniSearch<SearchDoc>,
  query: string,
  opts: SearchOptions = {},
): SearchDoc[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return index
    .search(trimmed)
    .map((hit) => hit as unknown as SearchDoc)
    .filter((doc) => matchesFacets(doc, opts));
}
