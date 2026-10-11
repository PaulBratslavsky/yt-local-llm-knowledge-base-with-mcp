import { describe, expect, it } from 'vitest';
import { buildSearchDocs } from './search-docs';

const video = {
  youtubeVideoId: 'abc123',
  videoTitle: 'Kubernetes internals',
  summaryTitle: 'How the scheduler works',
  videoAuthor: 'A channel',
  summaryDescription: 'Scheduling and storage.',
  summaryOverview: 'Covers the scheduler and storage classes.',
  readableArticle: 'A very long article body that should not be in the index.',
  watchVerdict: 'worth_it',
  finalScore: 83,
  keyTakeaways: [{ text: 'The scheduler binds pods to nodes' }],
  sections: [{ heading: 'Scheduling', body: 'how it works', timeSec: 42 }],
  actionSteps: [],
  tags: [{ name: 'kubernetes' }],
} as never;

describe('buildSearchDocs', () => {
  it('keys each document by the youtube video id', () => {
    expect(buildSearchDocs([video])[0].id).toBe('abc123');
  });

  it('indexes takeaway text and section headings', () => {
    const doc = buildSearchDocs([video])[0];
    expect(doc.takeaways).toContain('binds pods to nodes');
    expect(doc.sections).toContain('Scheduling');
  });

  // The article can be 7KB+ per video. Including it would multiply the index
  // size for little gain: the summary layer already names the same topics.
  it('leaves the readable article out of the index', () => {
    const serialized = JSON.stringify(buildSearchDocs([video]));
    expect(serialized).not.toContain('should not be in the index');
  });

  it('carries the facet fields the UI filters on', () => {
    const doc = buildSearchDocs([video])[0];
    expect(doc.tags).toEqual(['kubernetes']);
    expect(doc.verdict).toBe('worth_it');
    expect(doc.score).toBe(83);
  });

  it('tolerates a row with nothing but an id', () => {
    const sparse = {
      youtubeVideoId: 'x',
      keyTakeaways: [],
      sections: [],
      actionSteps: [],
      tags: [],
    } as never;

    const doc = buildSearchDocs([sparse])[0];

    expect(doc.id).toBe('x');
    expect(doc.title).toBe('x');
    expect(doc.takeaways).toBe('');
    expect(doc.score).toBe(0);
  });
});
