#!/usr/bin/env node
'use strict';
// Create the two Content API tokens yt-kb's callers use, on the Strapi app
// this is run from (M-14, B-5):
//   yt-kb-app   the TanStack app: find/findOne/create/update/delete on video,
//               tag, note, digest; find/findOne on transcript;
//               fetcher.fetchTranscript; fetcher.getOrFetch
//   yt-kb-site  the static site build: video.find, tag.find
//
// Run from the host app root, with Strapi STOPPED when the app uses SQLite:
//   node node_modules/strapi-plugin-yt-kb/scripts/create-tokens.cjs \
//     --out-app <file> --out-site <file> [--rotate yt-kb-app] [--rotate yt-kb-site]
// (in this repo: cd server && node src/plugins/yt-kb/scripts/create-tokens.cjs …)
//
// Each access key is written to its file with mode 0600 and is never
// printed. A token whose name already exists is left alone (logged) and its
// file is not written — unless its name is passed to --rotate (repeatable):
// then the existing Content API token is revoked and the token is created
// fresh, in one transaction, and its file is written. --rotate accepts only
// the two names above. An existing output file is never overwritten.
// Exit codes: 0 done, 1 failed, 2 usage or precondition.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const CRUD = ['find', 'findOne', 'create', 'update', 'delete'];
const APP_PERMISSIONS = [
  ...['video', 'tag', 'note', 'digest'].flatMap((t) => CRUD.map((a) => `plugin::yt-kb.${t}.${a}`)),
  'plugin::yt-kb.transcript.find',
  'plugin::yt-kb.transcript.findOne',
  'plugin::yt-kb.fetcher.fetchTranscript',
  'plugin::yt-kb.fetcher.getOrFetch',
];
const SITE_PERMISSIONS = ['plugin::yt-kb.video.find', 'plugin::yt-kb.tag.find'];

const TOKENS = [
  {
    name: 'yt-kb-app',
    flag: '--out-app',
    description: 'yt-kb TanStack app: reads and writes yt-kb content, fetches transcripts.',
    permissions: APP_PERMISSIONS,
  },
  {
    name: 'yt-kb-site',
    flag: '--out-site',
    description: 'yt-kb static site build: reads videos and tags.',
    permissions: SITE_PERMISSIONS,
  },
];

function fail(code, message) {
  console.error(`[create-tokens] ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { rotate: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--out-app' && arg !== '--out-site' && arg !== '--rotate') fail(2, `unknown argument ${arg}`);
    const value = argv[i + 1];
    if (arg === '--rotate') {
      if (!TOKENS.some((t) => t.name === value)) {
        fail(2, `--rotate takes ${TOKENS.map((t) => t.name).join(' or ')}, not ${value ?? 'nothing'}`);
      }
      out.rotate.add(value);
      i += 1;
      continue;
    }
    if (!value || value.startsWith('--')) fail(2, `${arg} needs a file path`);
    out[arg] = path.resolve(value);
    i += 1;
  }
  for (const t of TOKENS) if (!out[t.flag]) fail(2, `${t.flag} <file> is required`);
  if (out['--out-app'] === out['--out-site']) fail(2, '--out-app and --out-site must be different files');
  for (const t of TOKENS) {
    const file = out[t.flag];
    if (fs.existsSync(file)) fail(2, `${file} already exists; pass a new path (key files are never overwritten)`);
    if (!fs.existsSync(path.dirname(file))) fail(2, `directory ${path.dirname(file)} does not exist`);
  }
  return out;
}

function connects(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

// IPv4 and IPv6 loopback: a Strapi on HOST=::1 (or `localhost` resolving
// to it) does not answer on 127.0.0.1.
async function isListening(port) {
  return (await connects('127.0.0.1', port)) || (await connects('::1', port));
}

function writeKey(file, key) {
  fs.writeFileSync(file, `${key}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
}

async function main() {
  const out = parseArgs(process.argv.slice(2));
  const appDir = process.cwd();
  if (!fs.existsSync(path.join(appDir, 'config'))) fail(2, `run this from a Strapi app root (no config/ in ${appDir})`);
  let strapiEntry;
  try {
    strapiEntry = require.resolve('@strapi/strapi', { paths: [appDir] });
  } catch {
    fail(2, `@strapi/strapi is not installed in ${appDir}`);
  }
  const isTs = fs.existsSync(path.join(appDir, 'tsconfig.json'));
  const distDir = isTs ? path.join(appDir, 'dist') : appDir;
  if (isTs && !fs.existsSync(path.join(distDir, 'config'))) {
    fail(2, `${path.join(distDir, 'config')} not found; build the app first (strapi build)`);
  }

  // Requiring Strapi loads <appDir>/.env (dotenv, cwd), so cwd must be the app root.
  const { createStrapi } = require(strapiEntry);
  const app = createStrapi({ appDir, distDir });
  const client = String(app.config.get('database.connection.client'));
  const port = Number(app.config.get('server.port'));
  if (/sqlite/i.test(client) && (await isListening(port))) {
    fail(2, `something is listening on port ${port}. Stop Strapi first: this app uses SQLite, which needs exclusive access.`);
  }

  await app.load();
  let exitCode = 0;
  try {
    const tokens = app.service('admin::api-token-content-api');
    const createToken = (t) =>
      tokens.create({
        name: t.name,
        description: t.description,
        type: 'custom',
        lifespan: null,
        permissions: t.permissions,
      });
    for (const t of TOKENS) {
      const existing = await app.db.query('admin::api-token').findOne({ where: { name: t.name }, select: ['id', 'kind'] });
      let created;
      if (existing && !out.rotate.has(t.name)) {
        console.log(`[create-tokens] ${t.name} already exists (id ${existing.id}); left as is, ${out[t.flag]} not written (pass --rotate ${t.name} to replace it)`);
        continue;
      }
      if (existing) {
        // --rotate: only a Content API token (kind null on rows older than
        // token kinds) is ours to replace; an admin token of that name is not.
        if (existing.kind === 'admin') {
          console.error(`[create-tokens] ${t.name} (id ${existing.id}) is an admin token, not a Content API token; not rotated, ${out[t.flag]} not written`);
          exitCode = 1;
          continue;
        }
        // Revoke and re-create in one transaction: if the create fails
        // (e.g. an unknown action id), the old token is kept.
        created = await app.db.transaction(async () => {
          await tokens.revoke(existing.id);
          return createToken(t);
        });
        console.log(`[create-tokens] revoked ${t.name} (id ${existing.id})`);
      } else {
        created = await createToken(t);
      }
      try {
        writeKey(out[t.flag], created.accessKey);
      } catch (err) {
        console.error(
          `[create-tokens] created ${t.name} (id ${created.id}) but could not write ${out[t.flag]}: ${err.message}. Run again with --rotate ${t.name} and a new file path.`,
        );
        exitCode = 1;
        continue;
      }
      console.log(
        `[create-tokens] created ${t.name} (id ${created.id}, ${created.permissions.length} permissions); key written to ${out[t.flag]} (mode 0600)`,
      );
    }
  } catch (err) {
    console.error(`[create-tokens] failed: ${err instanceof Error ? err.message : String(err)}`);
    exitCode = 1;
  } finally {
    await app.destroy();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`[create-tokens] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
