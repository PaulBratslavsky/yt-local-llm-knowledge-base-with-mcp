#!/usr/bin/env node
// Fails the build if any published file carries server-side retrieval
// state. The field allowlist in src/content.config.ts is the mechanism;
// this is the proof it held, run over the bytes that actually ship.
//
// Runs as plain node after `astro build`, so it cannot import the list from
// src/lib/video.ts. output-guard.test.ts fails if this copy drifts from it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const FORBIDDEN = [
  'transcriptSegments',
  'summaryEmbedding',
  'passageEmbeddings',
  'rawText',
  'rawSegments',
];
const TEXT = /\.(html|json|js|css|txt|xml|svg|map|webmanifest)$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (TEXT.test(entry)) out.push(full);
  }
  return out;
}

// The sync/typecheck escape hatch must never reach a build: with it set the
// loader returns nothing, and the build would otherwise publish an empty
// site without complaining.
if (process.env.SITE_SKIP_STRAPI_FETCH === '1') {
  console.error(
    'SITE_SKIP_STRAPI_FETCH=1 is set during a build. That flag is for ' +
      '`astro sync` and typechecking only — this build loaded no videos.\n' +
      'Unset it and build again.',
  );
  process.exit(1);
}

const files = walk(DIST);
const violations = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const field of FORBIDDEN) {
    if (text.includes(field)) violations.push(`${file}: ${field}`);
  }
}

if (violations.length > 0) {
  console.error('Published output contains server-side retrieval state:\n');
  for (const v of violations.slice(0, 20)) console.error('  ' + v);
  console.error(`\n${violations.length} violation(s). Check the fields[] allowlist.`);
  process.exit(1);
}

console.log(`Output guard: clean (${files.length} files checked).`);
