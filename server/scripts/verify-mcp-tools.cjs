#!/usr/bin/env node
/**
 * Exercises the MCP tool bodies against the real database and asserts the
 * invariants that have no other guard. The server has no unit-test suite,
 * and `tsconfig.json` sets `strict: false`, so nothing else catches a tool
 * that silently ignores its own bounds.
 *
 * Replaces the retired `test-mcp.mjs`, which spoke Streamable HTTP to
 * `/api/mcp` — an endpoint removed in ADR-0008. This calls the tool bodies
 * directly instead, so it needs no admin token and no running server.
 *
 * Boots Strapi with `.load()` (not `.start()`), so it binds no port and
 * can't collide with a dev server. It does open the SQLite file, so stop
 * `strapi develop` first:
 *
 *   yarn --cwd server build && node server/scripts/verify-mcp-tools.cjs
 *
 * CommonJS on purpose: Strapi's ESM entrypoint fails to resolve its own
 * `lodash/fp` directory import under Node 24.
 *
 * Exits non-zero if any assertion fails.
 */

const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');

// Resolved explicitly so the script works from any cwd — Strapi otherwise
// looks for config/ and .env relative to process.cwd().
const APP_DIR = path.join(__dirname, '..');

// The `strapi` CLI loads .env for you; createStrapi() does not, and the
// session middleware refuses to start without APP_KEYS.
require('dotenv').config({ path: path.join(APP_DIR, '.env') });

const failures = [];
const passes = [];

function check(name, condition, detail) {
  if (condition) {
    passes.push(name);
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const strapi = await createStrapi({
    appDir: APP_DIR,
    distDir: path.join(APP_DIR, 'dist'),
  }).load();
  const ctx = { strapi };

  try {
    const { listVideosTool } = require('../dist/src/mcp/tools/list-videos.js');
    const { listTranscriptsTool } = require('../dist/src/mcp/tools/list-transcripts.js');
    const { searchVideosTool } = require('../dist/src/mcp/tools/search-videos.js');
    const { findTranscriptsTool } = require('../dist/src/mcp/tools/find-transcripts.js');
    const { listUntaggedTool } = require('../dist/src/mcp/tools/list-untagged.js');
    const { listTagsTool } = require('../dist/src/mcp/tools/tags.js');

    const totalVideos = await strapi.db.query('api::video.video').count({});
    console.log(`\nlibrary: ${totalVideos} videos\n`);
    if (totalVideos < 4) {
      console.error(
        'Need at least 4 videos to tell "limit honoured" from "small library". Run `yarn seed` first.',
      );
      process.exitCode = 1;
      return;
    }

    // The bug this file was written for: every tool passed its bounds as
    // `pagination: { start, limit }`, which Strapi's document service
    // accepts at the root and then strips — so the query ran unbounded.
    console.log('pagination bounds:');

    const videos = await listVideosTool.execute(
      { page: 1, pageSize: 3, status: 'any', verdict: 'any' },
      ctx,
    );
    check(
      'listVideos honours pageSize',
      videos.videos.length <= 3,
      `got ${videos.videos.length} rows for pageSize 3`,
    );

    const page2 = await listVideosTool.execute(
      { page: 2, pageSize: 3, status: 'any', verdict: 'any' },
      ctx,
    );
    const firstIds = new Set(videos.videos.map((v) => v.youtubeVideoId));
    check(
      'listVideos page 2 returns different rows than page 1',
      page2.videos.length > 0 &&
        page2.videos.every((v) => !firstIds.has(v.youtubeVideoId)),
      `page1=[${[...firstIds].slice(0, 3).join(',')}] page2=[${page2.videos
        .map((v) => v.youtubeVideoId)
        .slice(0, 3)
        .join(',')}]`,
    );

    const transcripts = await listTranscriptsTool.execute({ page: 1, pageSize: 2 }, ctx);
    check(
      'listTranscripts honours pageSize',
      transcripts.transcripts.length <= 2,
      `got ${transcripts.transcripts.length} rows for pageSize 2`,
    );

    const found = await searchVideosTool.execute({ query: 'the', limit: 2 }, ctx);
    check(
      'searchVideos honours limit',
      found.videos.length <= 2,
      `got ${found.videos.length} rows for limit 2`,
    );

    const ft = await findTranscriptsTool.execute(
      { query: 'the', limit: 2, includeFullContent: false },
      ctx,
    );
    check(
      'findTranscripts honours limit',
      ft.results.length <= 2,
      `got ${ft.results.length} rows for limit 2`,
    );

    const untagged = await listUntaggedTool.execute({ limit: 2 }, ctx);
    check(
      'listUntagged honours limit',
      untagged.videos.length <= 2,
      `got ${untagged.videos.length} rows for limit 2`,
    );

    const tags = await listTagsTool.execute({ limit: 2 }, ctx);
    check(
      'listTags honours limit',
      tags.tags.length <= 2,
      `got ${tags.tags.length} rows for limit 2`,
    );

    console.log(`\n${passes.length} passed, ${failures.length} failed`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await strapi.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
