import { describe, expect, it } from 'vitest';
import { createIndex, filterDocs, runSearch } from './search-engine';
import type { SearchDoc } from './search-docs';

const docs: SearchDoc[] = [
  {
    id: 'kube',
    title: 'How the scheduler works',
    author: 'Cluster channel',
    description: 'Kubernetes scheduling internals.',
    overview: 'Covers pods, nodes and bin packing.',
    takeaways: 'The scheduler binds pods to nodes',
    sections: 'Scheduling Storage classes',
    tags: ['kubernetes'],
    verdict: 'worth_it',
    contentScore: 83,
  },
  {
    id: 'strapi',
    title: 'Building an MCP server in Strapi',
    author: 'Paul',
    description: 'Exposing tools to a frontier model.',
    overview: 'Admin tokens, permission tiers, tool bodies.',
    takeaways: 'Tool bodies are defined once',
    sections: 'Setup Tiering',
    tags: ['strapi', 'mcp'],
    verdict: 'worth_it',
    contentScore: 91,
  },
];

describe('runSearch', () => {
  const index = createIndex(docs);

  it('finds a video by a word in its title', () => {
    expect(runSearch(index, 'scheduler')[0].id).toBe('kube');
  });

  it('finds a video by a word that appears only in a takeaway', () => {
    expect(runSearch(index, 'binds')[0].id).toBe('kube');
  });

  it('finds a video by a word that appears only in the description', () => {
    expect(runSearch(index, 'frontier')[0].id).toBe('strapi');
  });

  it('matches on a prefix, so results appear while typing', () => {
    expect(runSearch(index, 'sched').map((d) => d.id)).toContain('kube');
  });

  it('returns an empty list for a blank query rather than everything', () => {
    expect(runSearch(index, '   ')).toEqual([]);
  });

  it('filters by tag when asked', () => {
    const hits = runSearch(index, 'tool', { tag: 'mcp' });
    expect(hits.map((d) => d.id)).toEqual(['strapi']);
    expect(runSearch(index, 'tool', { tag: 'kubernetes' })).toEqual([]);
  });

  // The facets are independent of the query, so a narrowed search must still
  // rank by relevance rather than silently reordering.
  it('filters by verdict and minimum score', () => {
    expect(runSearch(index, 'server', { verdict: 'skip' })).toEqual([]);
    expect(runSearch(index, 'server', { minScore: 90 }).map((d) => d.id)).toEqual([
      'strapi',
    ]);
    expect(runSearch(index, 'server', { minScore: 95 })).toEqual([]);
  });

  it('keeps the fields the result list renders', () => {
    const hit = runSearch(index, 'scheduler')[0];
    expect(hit.title).toBe('How the scheduler works');
    expect(hit.author).toBe('Cluster channel');
    expect(hit.description).toBe('Kubernetes scheduling internals.');
  });

  // MiniSearch names its own relevance field `score` on every result and
  // sorts by it. A stored field called `score` lands on the same property,
  // so the list silently sorts by the video's content score instead and the
  // field boosts stop mattering entirely.
  it('ranks by textual relevance, not by the video content score', () => {
    const ranked = createIndex([
      {
        id: 'exact',
        title: 'TanStack Start deep dive',
        author: '',
        description: '',
        overview: '',
        takeaways: '',
        sections: '',
        tags: [],
        verdict: 'worth_it',
        contentScore: 10,
      },
      {
        id: 'passing-mention',
        title: 'Unrelated video',
        author: '',
        description: '',
        overview: 'mentions tanstack once',
        takeaways: '',
        sections: '',
        tags: [],
        verdict: 'worth_it',
        contentScore: 99,
      },
    ]);

    expect(runSearch(ranked, 'tanstack').map((d) => d.id)).toEqual([
      'exact',
      'passing-mention',
    ]);
  });
});

describe('filterDocs', () => {
  // Picking a facet with the search box empty should narrow the library,
  // not search for nothing and show an empty page.
  it('returns the whole library when no facet is set', () => {
    expect(filterDocs(docs, {}).map((d) => d.id)).toEqual(['strapi', 'kube']);
  });

  it('narrows by tag, verdict and minimum score', () => {
    expect(filterDocs(docs, { tag: 'mcp' }).map((d) => d.id)).toEqual(['strapi']);
    expect(filterDocs(docs, { minScore: 90 }).map((d) => d.id)).toEqual(['strapi']);
    expect(filterDocs(docs, { verdict: 'skip' })).toEqual([]);
  });

  it('applies every facet at once', () => {
    expect(filterDocs(docs, { tag: 'mcp', minScore: 95 })).toEqual([]);
  });

  // With no query there is no relevance to rank by, so the best-rated
  // video leads rather than whichever happened to be fetched first.
  it('orders by content score, best first', () => {
    expect(filterDocs(docs, {}).map((d) => d.contentScore)).toEqual([91, 83]);
  });
});
