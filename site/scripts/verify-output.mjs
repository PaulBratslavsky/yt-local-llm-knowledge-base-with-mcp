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
const FORBIDDEN = ['transcriptSegments', 'summaryEmbedding', 'passageEmbeddings'];
const TEXT = /\.(html|json|js|css|txt|xml)$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (TEXT.test(entry)) out.push(full);
  }
  return out;
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
