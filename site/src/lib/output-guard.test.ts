import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findForbidden } from './output-guard';
import { FORBIDDEN_FIELDS } from './video';

describe('findForbidden', () => {
  // The allowlist in content.config.ts is the mechanism. This proves it held
  // all the way through to the bytes on disk.
  it('catches each piece of retrieval state by name', () => {
    expect(findForbidden('{"summaryEmbedding":[0.1]}')).toContain('summaryEmbedding');
    expect(findForbidden('{"passageEmbeddings":{}}')).toContain('passageEmbeddings');
    expect(findForbidden('{"transcriptSegments":{}}')).toContain('transcriptSegments');
  });

  it('reports every violation in one pass, not just the first', () => {
    expect(findForbidden('summaryEmbedding passageEmbeddings')).toEqual([
      'passageEmbeddings',
      'summaryEmbedding',
    ]);
  });

  it('passes ordinary page markup', () => {
    expect(findForbidden('<h1>How the scheduler works</h1>')).toEqual([]);
  });

  it('does not fire on the words in ordinary prose', () => {
    expect(findForbidden('This video covers embeddings and transcripts.')).toEqual([]);
  });
});

describe('the build-time guard script', () => {
  // scripts/verify-output.mjs runs as plain node after astro build, so it
  // cannot import the TypeScript list and keeps its own copy. Two copies of
  // a list drift, and the one that drifts here stops catching a leak
  // silently. Same guard the repo puts on its two copies of bm25-core.
  it('checks exactly the fields the allowlist forbids', () => {
    const source = readFileSync(
      new URL('../../scripts/verify-output.mjs', import.meta.url),
      'utf8',
    );
    const literal = source.match(/const FORBIDDEN = \[([^\]]*)\]/)?.[1];
    expect(literal, 'FORBIDDEN array not found in verify-output.mjs').toBeDefined();

    const inScript = [...literal!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...inScript].sort()).toEqual([...FORBIDDEN_FIELDS].sort());
  });
});
