import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The client and the Strapi server both score the same stored BM25 index.
// They can't import from each other — the two halves are independent by
// design (CLAUDE.md) — so the server carries a generated copy of the core
// and this test is what keeps it honest.
//
// Before this, the server hand-mirrored the math and had silently drifted:
// no min-IDF query gate, no query-TF damping, no alpha-prefix expansion,
// no prototype guard. MCP's searchTranscript and the in-app chat ranked
// the same index differently while the header claimed they were identical.
//
// Regenerate with: yarn sync:bm25
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SOURCE = join(REPO_ROOT, 'client', 'src', 'lib', 'services', 'bm25-core.ts');
const COPY = join(REPO_ROOT, 'server', 'src', 'services', 'bm25-core.ts');

export const GENERATED_BANNER = `// GENERATED FILE — DO NOT EDIT.
//
// Verbatim copy of client/src/lib/services/bm25-core.ts, produced by
// scripts/sync-bm25-core.mjs. Edit the source and run \`yarn sync:bm25\`.
// bm25-core.sync.test.ts fails if this file drifts from the source.

`;

describe('bm25-core server copy', () => {
  it('is byte-for-byte the client source under the generated banner', () => {
    const source = readFileSync(SOURCE, 'utf8');
    const copy = readFileSync(COPY, 'utf8');
    expect(copy).toBe(GENERATED_BANNER + source);
  });

  it('stays free of imports, so it can be dropped into either package', () => {
    const source = readFileSync(SOURCE, 'utf8');
    // A path alias or an env read here would compile in the client and
    // break in Strapi, which has a different tsconfig and no `#/`.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/#\//);
    expect(source).not.toMatch(/process\.env/);
  });
});
