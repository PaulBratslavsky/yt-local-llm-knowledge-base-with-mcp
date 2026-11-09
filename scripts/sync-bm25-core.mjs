#!/usr/bin/env node
/**
 * Copies the BM25 core from strapi-plugin-yt-kb into the client.
 *
 * The plugin owns the search code: it builds each transcript's model-free
 * search index and grounds saveSummary's timecodes without the app. The
 * client scores the same stored indexes and runs the same cleaning and
 * chunking, but the two halves are independent packages that talk over REST
 * (CLAUDE.md) — neither imports from the other — so the client gets a
 * generated copy, and `client/src/lib/services/bm25-core.sync.test.ts` fails
 * if it drifts.
 *
 * The alternative — a hand-written "mirror" — is what this replaced: it had
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
const SOURCE = join(REPO_ROOT, 'server', 'src', 'plugins', 'yt-kb', 'server', 'src', 'services', 'bm25-core.ts');
const COPY = join(REPO_ROOT, 'client', 'src', 'lib', 'services', 'bm25-core.ts');

const BANNER = `// GENERATED FILE — DO NOT EDIT.
//
// Verbatim copy of server/src/plugins/yt-kb/server/src/services/bm25-core.ts,
// produced by scripts/sync-bm25-core.mjs. Edit the source and run \`yarn sync:bm25\`.
// bm25-core.sync.test.ts fails if this file drifts from the source.

`;

const source = readFileSync(SOURCE, 'utf8');
if (source.startsWith('// GENERATED FILE')) {
  console.error(`${SOURCE} carries the generated banner, but it is the source. Remove the banner first.`);
  process.exit(1);
}
const want = BANNER + source;

let current = null;
try {
  current = readFileSync(COPY, 'utf8');
} catch {
  // Not generated yet.
}

if (process.argv.includes('--check')) {
  if (current !== want) {
    console.error('client/src/lib/services/bm25-core.ts is out of date. Run `yarn sync:bm25`.');
    process.exit(1);
  }
  console.log('bm25-core copy is up to date.');
} else if (current === want) {
  console.log('bm25-core copy already up to date.');
} else {
  writeFileSync(COPY, want);
  console.log('Wrote client/src/lib/services/bm25-core.ts');
}
