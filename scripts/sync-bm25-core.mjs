#!/usr/bin/env node
/**
 * Copies the BM25 core from the client into the Strapi server.
 *
 * The two halves of this repo are independent packages that talk over REST
 * (CLAUDE.md) — neither imports from the other, and adding a workspace
 * package for one 350-line file would be a bigger change than the problem
 * warrants. So the server gets a generated copy, and
 * `client/src/lib/services/bm25-core.sync.test.ts` fails if it drifts.
 *
 * The alternative — a hand-written "mirror" — is what this replaces: it had
 * silently lost the min-IDF query gate, the query-TF damping, the
 * alpha-prefix expansion and the prototype guard.
 *
 *   yarn sync:bm25            # write the copy
 *   yarn sync:bm25 --check    # exit 1 if it would change (CI-friendly)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(REPO_ROOT, 'client', 'src', 'lib', 'services', 'bm25-core.ts');
const COPY = join(REPO_ROOT, 'server', 'src', 'services', 'bm25-core.ts');

const BANNER = `// GENERATED FILE — DO NOT EDIT.
//
// Verbatim copy of client/src/lib/services/bm25-core.ts, produced by
// scripts/sync-bm25-core.mjs. Edit the source and run \`yarn sync:bm25\`.
// bm25-core.sync.test.ts fails if this file drifts from the source.

`;

const want = BANNER + readFileSync(SOURCE, 'utf8');

let current = null;
try {
  current = readFileSync(COPY, 'utf8');
} catch {
  // Not generated yet.
}

if (process.argv.includes('--check')) {
  if (current !== want) {
    console.error(
      'server/src/services/bm25-core.ts is out of date. Run `yarn sync:bm25`.',
    );
    process.exit(1);
  }
  console.log('bm25-core copy is up to date.');
} else if (current === want) {
  console.log('bm25-core copy already up to date.');
} else {
  writeFileSync(COPY, want);
  console.log('Wrote server/src/services/bm25-core.ts');
}
