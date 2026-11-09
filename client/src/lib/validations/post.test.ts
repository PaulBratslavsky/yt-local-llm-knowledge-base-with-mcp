import { describe, expect, it } from 'vitest';
import { DOCUMENT_ID, VIDEO_REF, normalizeTagName, parseTagInput } from './post';

const DOC = 'k3x9q2m8v7b6n5c4z1a0s2d3';

describe('DOCUMENT_ID (B-1)', () => {
  it('accepts a Strapi 5 documentId', () => {
    expect(DOCUMENT_ID.safeParse(DOC).success).toBe(true);
  });

  it.each([
    '../../users/1',
    'K3X9Q2M8V7B6N5C4Z1A0S2D3',
    DOC.slice(0, 23),
    `${DOC}a`,
    'abc?def',
  ])('rejects %j', (id) => {
    expect(DOCUMENT_ID.safeParse(id).success).toBe(false);
  });
});

describe('VIDEO_REF (B-1)', () => {
  it.each(['dQw4w9WgXcQ', DOC])('accepts %j', (id) => {
    expect(VIDEO_REF.safeParse(id).success).toBe(true);
  });

  it.each(['../x', 'a/b', 'a.b', ''])('rejects %j', (id) => {
    expect(VIDEO_REF.safeParse(id).success).toBe(false);
  });
});

describe('tag names (M-12)', () => {
  it('normalizeTagName trims, lowercases and collapses whitespace like the plugin', () => {
    expect(normalizeTagName('  C++   Tips ')).toBe('c++ tips');
  });

  it('parseTagInput normalises and de-duplicates', () => {
    expect(parseTagInput('AI,  ai , Deep   Learning')).toEqual(['ai', 'deep learning']);
  });
});
