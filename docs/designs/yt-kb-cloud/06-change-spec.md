# YT Knowledge Base — Change spec: strapi-plugin-yt-kb for any Strapi app

> **For the implementing agent.** You have the repo `/Users/paul/projects/yt-knowledge-base` checked out. This spec plus the code and the official docs is everything you need.
> **Deviation protocol:** the files, commands, names and structures in this spec are the owner's decisions. If the code makes a step wrong or impossible, STOP and ask — don't improvise a substitute.
> **Safety:** work on branch `egm/yt-kb-any-strapi`, created from `feat/yt-kb-plugin` @ `721f210` (or its current head after the run folder's docs commit). Commit once per milestone, with the milestone title as the message. Don't push, don't publish to npm. Never use production data or credentials, never print a token or a `.env` value, and never point anything at `strapi-cloud-backend-main-site`.
> **Data:** the owner's library lives in `server/.tmp/data.db`. Every check runs against a scratch database named `server/.tmp/e8-m<N>.db` (or `e8-m<N>-<label>.db` for a second one), created as each milestone says, with the one check kit M1 defines (`server/.tmp/e8/e8.mjs`; conventions in M1, "Check conventions"). The one step that boots on `data.db` (Deployment, step 2) backs it up first.
> **Docs lookup:** the `strapi-docs` MCP, or https://docs.strapi.io (Strapi 5.61); TanStack Start / Router: https://tanstack.com/start/latest and https://tanstack.com/router/latest; Astro: https://docs.astro.build. Check version-sensitive APIs against the installed versions in `node_modules`.
> **Environment:** Node ≥ 22.12 is a stop-and-ask precondition (M1, precondition 4): Strapi 5.61.0 drops Node 20 (its v5.61.0 release notes) and `vite` 8.3.6 needs ≥ 22.12 — not verified by a failure seen here. The owner's machine runs Node 24.16.0 (checked 2026-11-08). Every other runtime version is to be confirmed in the E8 baseline and recorded in `reviews/E8-implementation-log.md`. `engines` fields are declarations, not tests.
> **Based on:** `04`/`05` as built @ `721f210`; findings from `reviews/B-design-review.md`; decisions recorded in `reviews/review-log.md` (2026-11-08).

## Goals

Owner goals (from `03-requirements.md`, "Change goals"):

- **G1:** `strapi-plugin-yt-kb` installs and works in any Strapi 5 app, built for the latest Strapi (5.61.0).
- **G2:** whichever Strapi hosts the plugin is the source of truth for the data and transcripts.
- **G3:** all AI stays local in the TanStack app, pointed at the host's URL and token.
- **G4:** the Astro site builds from the host.
- **G5:** parity with `strapi-plugin-youtube-transcripts` 2.6.2 — owner's choice: hardened fetcher + proxy check at boot, extra metadata, a REST fetch-or-return route, per-tool permissions (replacing yt-kb's three tiers).
- **G6:** `strapi-plugin-tanstack-ai`'s chat picks up yt-kb's tools when a host has it.
- **G7:** the proxy is configured the same way as in `youtube-transcripts` (plugin setting `proxyUrl`, default `PROXY_URL`).
- **G8:** agents work headless over MCP.

Accepted findings (`reviews/B-design-review.md`):

- **B-1:** browser-supplied ids are encoded and validated, so no request can be redirected to another Strapi route.
- **B-2:** the database enforces uniqueness of `youtubeVideoId` (video, transcript), tag `name` and `slug`, digest `videoSetKey`; races re-read instead of duplicating.
- **B-3:** an `ai-tools` service exposes yt-kb's tools to `tanstack-ai`.
- **B-4:** the parity items in G5 and G7, plus the real track language.
- **B-5:** the app keeps no sign-in (owner accepts "local, single user" as the reason) but uses a token scoped to yt-kb, and its dev server is pinned to `127.0.0.1`.
- **B-6** (owner-added 2026-11-08): per-video chat (`/api/chat`) and digest chat (`/api/digest-chat`) get transcript passages again — they load the video through a server-only fetch that keeps the stored BM25 index, instead of the browser-bound fetch that strips it.
- **M-1:** MCP tools are named `yt_kb__<snake_case>`; registration and execution errors are caught and logged.
- **M-2, M-3, M-20:** Strapi 5.61.0 on the test host, plugin peer `^5.61.0`, `undici` 6.29.1, `vite` 8.3.6, `seroval` ≥1.7.6 (advisories through 1.6.7), `vitest` 3.2.6 in the plugin and the client (advisory fixed in 3.2.6).
- **M-4:** fetch retries, timeouts and failure reasons live in the plugin; the app retries only network failures and times out its own calls.
- **M-5:** the plugin is installed, built, verified and tested by setup and CI; its guards live in the plugin.
- **M-6:** `copy-content.mjs` stays under a 1 MB body limit and reports what it can't send.
- **M-7:** the import route is off unless the plugin config enables it; partial failures answer 207.
- **M-8:** feed and detail reads name their fields; embeddings never reach the browser.
- **M-9:** the rule "MCP tokens hold only yt-kb's tool permissions, never Content Manager permissions on yt-kb types" is written down for host owners (docs only).
- **M-10:** `publish-site.sh` and `site:deploy` work against the plugin.
- **M-11, M-16:** the plugin owns the search code, keeps a model-free search index on each transcript, and `saveSummary` grounds timecodes itself.
- **M-12:** tag slugs never collide; tag lookups normalise names the same way the create rule does; failed tag creates are surfaced.
- **M-13:** Settings backfills don't skip rows and report errors; the AI re-rate's video list reports a failed read instead of returning a partial list.
- **M-14:** the plugin removes its actions from Public/Authenticated at boot; a script creates the app and site tokens with exact scopes.
- **M-15:** core-loop pages have loading and error states; polling is capped and says so; expensive loaders don't run on hover.
- **M-17:** YouTube-sourced strings use `text`.
- **M-18:** multi-record writes run in transactions.
- **M-19:** the plugin has tests with a stubbed fetcher; the robustness sweep is recorded (`05`, updated in E9).
- **M-21:** dead scripts, dependencies and lockfiles are removed; stale comments fixed.

## Non-goals

- All **Nits** in `reviews/B-design-review.md` (Content-Type check on chat routes, `telemetryDisabled`, `richtext` rationale, `start.sh` kill filter, stale text not listed under M-21).
- **M-8 (part):** an in-process cache for whole-corpus embedding reads — deferred; this change only adds field allowlists.
- **M-21 (part):** removing Users & Permissions from the test host (declined: stock, local only, nothing in the plugin depends on it).
- CVE-2026-118171 (unverifiable; the 5.61.0 upgrade supersedes it).
- Anything on `strapi-cloud-backend-main-site`; importing its `youtube_transcripts` rows; removing `youtube-transcripts` from any app.
- Publishing to npm and installing in a host — a separate step the owner approves.
- MySQL / MariaDB hosts: the plugin supports SQLite and PostgreSQL only (owner decision; stated in the plugin README, M8). `isUniqueViolation` recognising `ER_DUP_ENTRY` is not support.
- Bulk generation (next round). Any change to the summary prompt or scoring math.

## Current state

- Strapi 5.52.1 in `server/` (`server/package.json:21-23`), SQLite `server/.tmp/data.db` (`server/config/database.ts`), MCP on (`server/config/server.ts:22`).
- `strapi-plugin-yt-kb` 0.1.0 at `server/src/plugins/yt-kb/`, loaded with `resolve` (`server/config/plugins.ts:6-13`), built to gitignored `dist/` by hand; peer `^5.47.0`; deps `undici` 6.28.0, `youtubei.js` 17.2.0 (`server/src/plugins/yt-kb/package.json`).
- Five types under `plugin::yt-kb.*` with `unique: true` but no database index (`@strapi/database/dist/schema/schema.js:29,94`; no unique index in `data.db`). 195 videos, 195 transcripts, 17 tags, 11 notes, 6 digests; 0 duplicates on every key (checked 2026-11-08).
- 21 MCP tools with bare names, gated by `plugin::yt-kb.read|write|maintenance` (`PSRC/mcp-official/`). Admin token `claude-mcp-1782487483515` holds the three tiers.
- Transcript fetching only in the plugin (`PSRC/services/fetcher.ts`, `youtube-transcript.ts`), proxy from `TRANSCRIPT_PROXY_URL`, no retries; the app calls `POST /api/yt-kb/transcripts/fetch` (`client/src/lib/services/videos.ts`).
- TanStack app on `vite dev --port 3005`, no sign-in, one full-access Content API token `yt-kb-client` (`client/.env`); site builds with a read-only token `yt-kb-site` (`site/.env`).
- `PSRC` = `server/src/plugins/yt-kb/server/src`.

## Milestones

### M1 — Platform: Strapi 5.61.0, pinned dependencies, the plugin in setup, CI and tests

- **Why:** G1 ("built for the latest Strapi", installable in any Strapi 5 app), M-2 (test host on 5.52.1, peer floor `^5.47.0`), M-3 (`undici` 6.28.0 advisory), M-5 (plugin not installed, built, verified or tested by setup or CI; its guard lives in the client), M-20 (Vite 8.0.8, `seroval` 1.5.2).
- **Facts this milestone depends on** (read at `721f210`):
  - `server/package.json` pins `@strapi/strapi`, `@strapi/plugin-cloud`, `@strapi/plugin-users-permissions` at `5.52.1`; its `strapi:upgrade` / `upgrade:dry` scripts run `npx @strapi/upgrade latest` (`--dry` for the second). M1 does **not** use or change those scripts (owner decision): `latest` could install a version newer than 5.61.0, so step 3 runs the tool with an explicit target, `npx @strapi/upgrade to 5.61.0` (docs.strapi.io `cms/upgrade-tool`, "Upgrade to a specific version"; options `-n, --dry` and `-y, --yes`).
  - The plugin has its own `package.json` and `yarn.lock` (`server/src/plugins/yt-kb/`), its `dist/` is gitignored (`server/src/plugins/yt-kb/.gitignore`), and Strapi loads `dist/server/index.js` through `resolve: './src/plugins/yt-kb'` (`server/config/plugins.ts`). That `dist` `require`s `undici` and `youtubei.js` from the plugin's own `node_modules` and `@strapi/strapi` / `@strapi/utils` from `server/node_modules`. So a fresh clone cannot boot until the plugin is installed **and** built — nothing in `yarn setup` or `yarn install:all` does either today.
  - CI (`.github/workflows/ci.yml`) has a "Typecheck server" step, but `server/tsconfig.json` excludes `src/plugins/` (twice: `"src/plugins/"` and `"src/plugins/**"`), so CI never typechecks, builds, verifies or tests the plugin. The plugin's own typecheck (`tsc -p server/tsconfig.json --noEmit`) passes at `721f210` on 5.52.1 (run with `--incremental false`, 2026-11-08).
  - The only plugin-facing guard in the client is `client/src/lib/services/mcp-permissions.guard.test.ts` (3 tests; reads `PSRC/mcp-official/index.ts` and `permissions.ts`). `bm25-core.sync.test.ts` stays in the client (contract: Search). `strapi-paths.guard.test.ts` and `youtube-fetch.guard.test.ts` guard client code and stay.
  - Client: `vite` is `^8.0.0` (installed 8.0.8); `seroval` resolves to 1.5.2 (via `solid-js@1.9.12`, range `~1.5.0`), 1.6.2 and 1.7.6 (`client/yarn.lock`); seroval has advisories through 1.6.7, so the floor is 1.7.6. `vitest` is `^3.0.5` (installed 3.2.4), which has a critical advisory (its UI server only) fixed in 3.2.6.
  - **zod under `@strapi/utils` changes major.** On 5.52.1, `@strapi/utils` depends on `zod` 3.25.76 and exports its zod 4 API (`require('zod/v4')`, `@strapi/utils/dist/zod.js`); on 5.60.0 (`/Users/paul/work/plugin-dev/strapi-prod`) it depends on `zod` 4.4.3, and 5.61.0 is expected to match (M1 Verify 1 checks `zodForUtils` = 4.4.3). Every plugin tool schema is built with `z` from `@strapi/utils`, so the API the plugin uses stays zod 4, but the package underneath is new. **If `test:ts:back`, the plugin tests, or MCP `tools/list` (Verify 3, 6) fail because of zod types or schema conversion, STOP and ask** — do not rewrite schemas or pin zod.
- **Preconditions (stop and ask if any fails):**
  1. Nothing listens on ports 1340, 1341 or 3005, on IPv4 or IPv6. The upgrade replaces `server/node_modules` under any running Strapi, and the checks use 1341 and 3005. Check, from the repo root (`lsof -nP -iTCP:<port> -sTCP:LISTEN` exits 1 when nothing listens on the port, on any address):
     ```bash
     for p in 1340 1341 3005; do if lsof -nP -iTCP:$p -sTCP:LISTEN > /dev/null; then echo "{\"port\":$p,\"busy\":true}"; else echo "{\"port\":$p,\"busy\":false}"; fi; done
     ```
     Every line must print `"busy":false`. If one is busy, ask the owner to stop their stack. Do not kill it.
  2. `npm view @strapi/strapi@5.61.0 version` prints `5.61.0` (the target exists on the registry; a newer `latest` does not matter, step 3 targets 5.61.0 by name). `(cd server && npx @strapi/upgrade --help)` lists a `to [options] <target>` command; if it does not, stop and ask.
  3. The E8 baseline is recorded in `E8-implementation-log.md`: `node --version`, `yarn --version`, `jq --version` (M3–M7 parse the kit's JSON with `jq`; `/usr/bin/jq` 1.7.1 on this machine — if it is missing, stop and ask), the client suite's total from `yarn test` (call it `CLIENT_BASELINE`; CLAUDE.md says 319, so measure it), and `yarn site:test`'s total.
  4. Node is ≥ 22.12 (Strapi 5.61.0 dropped Node 20; `vite` 8.3.6 needs ≥ 22.12):
     ```bash
     node -e "process.exit(+process.versions.node.split('.')[0] > 22 || (process.versions.node.startsWith('22.') && +process.versions.node.split('.')[1] >= 12) ? 0 : 1)"
     ```
     → exit 0 (the owner's machine runs 24.16.0, checked 2026-11-08). Exit 1 — stop and ask; don't install or switch Node.

#### M1 files

1. **Check kit (scratch, not committed): `server/.tmp/e8/e8.mjs`, a new file.** `server/.tmp` is gitignored (`server/.gitignore` line 68, `.tmp`), so nothing here reaches a commit. M2 and later milestones reuse it. It prints JSON and exits 1 when a check fails. It never prints a token, a password or an access key.

   ```js
   #!/usr/bin/env node
   // E8 check kit for the yt-kb change spec. Scratch only: server/.tmp is
   // gitignored. Every command prints JSON; a failed check exits 1.
   // Never prints a token, a password or an access key.
   import { createRequire } from 'node:module';
   import { readFileSync, writeFileSync } from 'node:fs';
   import path from 'node:path';
   import { fileURLToPath } from 'node:url';

   const HERE = path.dirname(fileURLToPath(import.meta.url));
   const SERVER = path.resolve(HERE, '..', '..');
   const req = createRequire(path.join(SERVER, 'package.json'));
   const Database = req('better-sqlite3');

   const print = (o) => console.log(JSON.stringify(o, null, 2));
   const die = (o) => { print(o); process.exit(1); };
   const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

   const YT_TABLES = [
     'yt_kb_videos', 'yt_kb_transcripts', 'yt_kb_tags', 'yt_kb_notes', 'yt_kb_digests',
     'yt_kb_videos_tags_lnk', 'yt_kb_videos_transcript_lnk', 'yt_kb_notes_videos_lnk',
     'yt_kb_digests_videos_lnk', 'yt_kb_videos_cmps', 'yt_kb_digests_cmps',
   ];

   // Same SQL as the Postgres pre-step in M2 (CAST works in both).
   const DUP_SQL = `
   SELECT 'yt_kb_videos.youtube_video_id' AS key, CAST(youtube_video_id AS TEXT) AS value, COUNT(*) AS n
     FROM yt_kb_videos WHERE youtube_video_id IS NOT NULL GROUP BY youtube_video_id HAVING COUNT(*) > 1
   UNION ALL
   SELECT 'yt_kb_transcripts.youtube_video_id', CAST(youtube_video_id AS TEXT), COUNT(*)
     FROM yt_kb_transcripts WHERE youtube_video_id IS NOT NULL GROUP BY youtube_video_id HAVING COUNT(*) > 1
   UNION ALL
   SELECT 'yt_kb_tags.name', CAST(name AS TEXT), COUNT(*)
     FROM yt_kb_tags WHERE name IS NOT NULL GROUP BY name HAVING COUNT(*) > 1
   UNION ALL
   SELECT 'yt_kb_tags.slug', CAST(slug AS TEXT), COUNT(*)
     FROM yt_kb_tags WHERE slug IS NOT NULL GROUP BY slug HAVING COUNT(*) > 1
   UNION ALL
   SELECT 'yt_kb_digests.video_set_key', CAST(video_set_key AS TEXT), COUNT(*)
     FROM yt_kb_digests WHERE video_set_key IS NOT NULL GROUP BY video_set_key HAVING COUNT(*) > 1`;

   async function http(base, method, p, { token, body } = {}) {
     const headers = {};
     if (token) headers.Authorization = `Bearer ${token}`;
     if (body !== undefined) headers['Content-Type'] = 'application/json';
     const res = await fetch(base + p, {
       method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
     });
     const text = await res.text();
     let json = null;
     try { json = text ? JSON.parse(text) : null; } catch { json = { nonJson: text.slice(0, 300) }; }
     return { status: res.status, body: json };
   }

   // Strapi's /mcp is stateless Streamable HTTP; replies come as JSON or SSE.
   async function mcpRequest(base, token, method, params, id) {
     const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
     if (token) headers.Authorization = `Bearer ${token}`;
     const res = await fetch(`${base}/mcp`, {
       method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
     });
     const text = await res.text();
     const ct = res.headers.get('content-type') ?? '';
     const payloads = ct.includes('text/event-stream')
       ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean)
       : [text];
     const messages = payloads.map((p) => { try { return JSON.parse(p); } catch { return { error: { message: p.slice(0, 300) } }; } });
     return { status: res.status, msg: messages.find((m) => m.id === id) ?? messages[0] ?? { error: { message: 'empty response' } } };
   }

   const commands = {
     // Consistent copy through SQLite's online backup API (safe while Strapi runs).
     async backup(src, dst) {
       const db = new Database(src, { readonly: true, fileMustExist: true });
       await db.backup(dst);
       db.close();
       const copy = new Database(dst, { readonly: true, fileMustExist: true });
       const integrity = copy.pragma('integrity_check', { simple: true });
       copy.close();
       const r = { src, dst, integrity };
       if (integrity !== 'ok') die(r);
       print(r);
     },
     async sql(file, query) {
       const db = new Database(file, { readonly: true, fileMustExist: true });
       const rows = db.prepare(query).all();
       db.close();
       print({ rows });
     },
     // Runs one write inside a transaction that is always rolled back.
     async trysql(file, query) {
       const db = new Database(file, { fileMustExist: true, timeout: 10000 });
       db.exec('BEGIN');
       let r;
       try { db.prepare(query).run(); r = { ok: true }; }
       catch (e) { r = { ok: false, code: e.code ?? null, message: e.message }; }
       db.exec('ROLLBACK');
       db.close();
       print(r);
     },
     async counts(file) {
       const db = new Database(file, { readonly: true, fileMustExist: true });
       const tables = {};
       for (const t of YT_TABLES) tables[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
       const tagSlugs = db.prepare(
         "SELECT name, slug FROM yt_kb_tags WHERE name NOT LIKE 'e8%' AND name NOT IN ('日本語','中文') ORDER BY name",
       ).all();
       const internalMigrations = db.prepare('SELECT name FROM strapi_migrations_internal ORDER BY id').all().map((r) => r.name);
       db.close();
       print({ tables, tagSlugs, internalMigrations });
     },
     async dupcheck(file) {
       const db = new Database(file, { readonly: true, fileMustExist: true });
       const duplicates = db.prepare(DUP_SQL).all();
       db.close();
       if (duplicates.length > 0) die({ duplicates });
       print({ duplicates });
     },
     async wait(url, seconds = '300') {
       const until = Date.now() + Number(seconds) * 1000;
       while (Date.now() < until) {
         try {
           const res = await fetch(url);
           if (res.status === 204 || res.status === 200) { print({ url, status: res.status }); return; }
         } catch { /* not up yet */ }
         await new Promise((r) => setTimeout(r, 2000));
       }
       die({ url, error: 'timeout' });
     },
     // Logs in as the scratch admin and mints one full-access Content API
     // token and one admin token holding `actionsCsv`. Writes both keys to
     // `outFile` (mode 0600); prints only ids and the granted actions.
     async 'admin-tokens'(base, adminFile, outFile, actionsCsv) {
       const admin = readJson(adminFile);
       const login = await http(base, 'POST', '/admin/login', { body: { email: admin.email, password: admin.password } });
       const jwt = login.body?.data?.token ?? login.body?.data?.accessToken;
       if (login.status !== 200 || !jwt) die({ step: 'login', status: login.status, error: login.body?.error ?? null });
       const stamp = Date.now();
       const rest = await http(base, 'POST', '/admin/api-tokens', {
         token: jwt,
         body: { name: `e8-rest-${stamp}`, description: 'E8 scratch check', type: 'full-access', lifespan: null },
       });
       if (![200, 201].includes(rest.status) || !rest.body?.data?.accessKey) {
         die({ step: 'api-token', status: rest.status, error: rest.body?.error ?? null });
       }
       const adminPermissions = actionsCsv.split(',').filter(Boolean)
         .map((action) => ({ action, subject: null, properties: {}, conditions: [] }));
       const adm = await http(base, 'POST', '/admin/admin-tokens', {
         token: jwt,
         body: { name: `e8-mcp-${stamp}`, description: 'E8 scratch check', lifespan: null, adminPermissions },
       });
       if (![200, 201].includes(adm.status) || !adm.body?.data?.accessKey) {
         die({ step: 'admin-token', status: adm.status, error: adm.body?.error ?? null });
       }
       writeFileSync(outFile, JSON.stringify({ base, rest: rest.body.data.accessKey, mcp: adm.body.data.accessKey }), { mode: 0o600 });
       print({
         ok: true,
         restTokenId: rest.body.data.id,
         mcpTokenId: adm.body.data.id,
         grantedActions: (adm.body.data.adminPermissions ?? []).map((p) => p.action).sort(),
       });
     },
     // initialize, then `method`. tools/list follows nextCursor and prints names.
     async mcp(tokensFile, method, paramsJson = '{}', tokenKey = 'mcp') {
       const t = readJson(tokensFile);
       const token = tokenKey === 'none' ? undefined : t[tokenKey];
       const init = await mcpRequest(t.base, token, 'initialize', {
         protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e8-probe', version: '1.0.0' },
       }, 1);
       if (init.msg.error || !init.msg.result) die({ step: 'initialize', httpStatus: init.status, error: init.msg.error ?? null });
       if (method === 'tools/list') {
         const names = [];
         let cursor;
         do {
           const r = await mcpRequest(t.base, token, 'tools/list', cursor ? { cursor } : {}, 2);
           if (r.msg.error) die({ step: 'tools/list', httpStatus: r.status, error: r.msg.error });
           names.push(...r.msg.result.tools.map((x) => x.name));
           cursor = r.msg.result.nextCursor;
         } while (cursor);
         print({ protocolVersion: init.msg.result.protocolVersion, toolCount: names.length, tools: names.sort() });
         return;
       }
       const r = await mcpRequest(t.base, token, method, JSON.parse(paramsJson), 2);
       if (r.msg.error) die({ step: method, httpStatus: r.status, error: r.msg.error });
       print(r.msg.result);
     },
     async rest(tokensFile, method, p, bodyJson = '', tokenKey = 'rest') {
       const t = readJson(tokensFile);
       print(await http(t.base, method, p, {
         token: tokenKey === 'none' ? undefined : t[tokenKey],
         body: bodyJson ? JSON.parse(bodyJson) : undefined,
       }));
     },
     // n identical POSTs at once.
     async race(tokensFile, n, p, bodyJson) {
       const t = readJson(tokensFile);
       const body = JSON.parse(bodyJson);
       const results = await Promise.all(
         Array.from({ length: Number(n) }, () => http(t.base, 'POST', p, { token: t.rest, body })),
       );
       print({
         statuses: results.map((r) => r.status).sort(),
         errors: results.filter((r) => r.status >= 400).map((r) => r.body?.error?.message ?? null),
       });
     },
   };

   const [cmd, ...args] = process.argv.slice(2);
   const fn = commands[cmd];
   if (!fn) die({ error: `unknown command ${cmd}`, commands: Object.keys(commands) });
   await fn(...args);
   ```

   Create the scratch admin credentials (test values made in this session; never typed into chat):
   ```bash
   node -e 'const fs=require("fs"),c=require("crypto");fs.mkdirSync("server/.tmp/e8",{recursive:true});fs.writeFileSync("server/.tmp/e8/admin.json",JSON.stringify({email:"e8-check@example.test",password:"E8a"+c.randomBytes(12).toString("hex")+"!"}),{mode:0o600});console.log(JSON.stringify({ok:true}))'
   ```

   **Check conventions (M1–M7 all follow them; a milestone that needs more extends the kit explicitly — M3 adds `token`, `mcpx` and `@file` token keys, M5 adds `exec`):**
   - **Kit:** `K=server/.tmp/e8/e8.mjs`, run from the repo root. Every command prints JSON; checks parse it with `jq -e` or `node -e`, never `grep` on JSON.
   - **Scratch databases:** `server/.tmp/e8-m<N>.db` for milestone N (a copy of real data made with `node $K backup server/.tmp/data.db server/.tmp/e8-m<N>.db`, or a fresh file where the milestone says so), and `server/.tmp/e8-m<N>-<label>.db` for a second one. Strapi gets it as `DATABASE_FILENAME=.tmp/e8-m<N>.db` (relative to `server/`). Remove them at the end of the milestone's checks with `rm -f server/.tmp/e8-m<N>*.db*`.
   - **Backups of the owner's DB:** `node $K backup server/.tmp/data.db server/.tmp/data.db.pre-m<N>-$TS` (online backup + `integrity_check`), never a plain `cp` of a live file.
   - **Ports:** scratch Strapi on `127.0.0.1:1341` (`PORT=1341 HOST=127.0.0.1`), the app on `3005`, extra stubs on `1398`/`1399` where M6/M7 say. Before a milestone's checks, precondition 1's port check (1340, 1341, 3005, plus the milestone's stub ports, added to its `for p in …` list) must print `"busy":false` for each — never kill the owner's processes. The probe is always `lsof -nP -iTCP:<port> -sTCP:LISTEN` (exit 1 = free), which sees IPv4 and IPv6 (`::1`) listeners alike; no milestone probes a port by connecting to `127.0.0.1` only. Stop only what the checks started: `lsof -ti tcp:<port> -sTCP:LISTEN | xargs kill`.
   - **Starting the scratch Strapi:** `(cd server && DATABASE_FILENAME=.tmp/e8-m<N>.db PORT=1341 HOST=127.0.0.1 nohup yarn develop > .tmp/e8/m<N>-strapi.log 2>&1 &)` then `node $K wait http://127.0.0.1:1341/_health 300` → `"status": 204`. Each scratch DB gets the scratch admin with `(cd server && DATABASE_FILENAME=.tmp/e8-m<N>.db yarn -s strapi admin:create-user --email="$(node -p 'require("./.tmp/e8/admin.json").email')" --password="$(node -p 'require("./.tmp/e8/admin.json").password')" --firstname=E8 --lastname=Check)` with Strapi stopped.
   - **Tokens:** `T=server/.tmp/e8/tokens.json` (mode 0600), rewritten per milestone by `admin-tokens` (keys `base`, `rest` = full-access Content API, `mcp` = admin token) and extended with named keys by M3's `token`. A key file written by another tool (M5's `create-tokens.cjs`) is passed as `@<path>`. No step prints a key.
   - **Working files:** `server/.tmp/e8/m<N>-*` (JSON outputs, logs, key files, helper scripts), or the directory `server/.tmp/e8/m<N>/` (mode 700) where a milestone has many (M6, M7). `server/.tmp` is gitignored.

2. **Backup of the owner's database before anything else touches `server/node_modules`.** The upgrade may add Strapi internal migrations that run on the next boot of `server/.tmp/data.db` and cannot be undone by downgrading.
   ```bash
   TS=$(date +%s); node server/.tmp/e8/e8.mjs backup server/.tmp/data.db server/.tmp/data.db.pre-m1-$TS
   ```
   Expected: `"integrity": "ok"`. Record the file name in `E8-implementation-log.md`. Do not boot any Strapi against `server/.tmp/data.db` during E8.

3. **`server/package.json` and `server/yarn.lock` — Strapi upgrade, through Strapi's upgrade tool with an explicit target (never `yarn upgrade`; the `upgrade:dry` / `strapi:upgrade` scripts stay as they are).** Both commands run from `server/`.
   1. Dry run: `(cd server && npx @strapi/upgrade to 5.61.0 --dry --yes) > server/.tmp/e8/m1-upgrade-dry.log 2>&1` (it edits nothing and installs nothing).
      Expected: `Upgrading from 5.52.1 to 5.61.0`; the three `@strapi/*` dependencies (`@strapi/strapi`, `@strapi/plugin-cloud`, `@strapi/plugin-users-permissions`) planned at `5.61.0`; no code codemod for the range 5.52.1 → 5.61.0 (not verified — the tool's codemod list was not read).
      - If it lists any codemod that would edit a file under `server/src/plugins/` — **stop and ask**. The plugin is changed only by this spec.
      - If it lists a codemod for any other file, record the codemod name and files in the E8 log, then continue.
      - If it reports a target other than 5.61.0 — stop and ask.
   2. Real run: `(cd server && npx @strapi/upgrade to 5.61.0 --yes)`. It edits `server/package.json`, runs `yarn install` in `server/` and updates `server/yarn.lock`. (`--yes` also answers the tool's optional "clean git tree" prompt; the only untracked path is the run folder `docs/designs/yt-kb-cloud/`.)
   3. `git diff --stat -- server/` must list only `server/package.json`, `server/yarn.lock`, and any non-plugin file a codemod from step 1 listed. The `dependencies` in `server/package.json` must now read:
      ```json
      "@strapi/plugin-cloud": "5.61.0",
      "@strapi/plugin-users-permissions": "5.61.0",
      "@strapi/strapi": "5.61.0",
      ```
      Every other line of `server/package.json` stays as it is.

4. **`server/src/plugins/yt-kb/package.json` — whole file:**
   ```json
   {
     "name": "strapi-plugin-yt-kb",
     "version": "0.1.0",
     "description": "YouTube knowledge base for Strapi 5: videos, tags, notes, digests and transcripts, with MCP tools for agents. AI runs in your own client; Strapi stores and serves.",
     "license": "GPL-3.0-or-later",
     "type": "commonjs",
     "keywords": [
       "strapi",
       "strapi-plugin",
       "youtube",
       "mcp",
       "knowledge-base"
     ],
     "exports": {
       "./package.json": "./package.json",
       "./strapi-server": {
         "types": "./dist/server/src/index.d.ts",
         "source": "./server/src/index.ts",
         "import": "./dist/server/index.mjs",
         "require": "./dist/server/index.js",
         "default": "./dist/server/index.js"
       }
     },
     "files": [
       "dist",
       "scripts"
     ],
     "scripts": {
       "build": "strapi-plugin build",
       "watch": "strapi-plugin watch",
       "verify": "strapi-plugin verify",
       "test": "vitest run",
       "test:ts:back": "tsc -p server/tsconfig.json --noEmit"
     },
     "dependencies": {
       "undici": "6.29.1",
       "youtubei.js": "17.2.0"
     },
     "devDependencies": {
       "@strapi/sdk-plugin": "6.1.1",
       "@types/node": "^22.0.0",
       "typescript": "5.9.3",
       "vitest": "3.2.6"
     },
     "peerDependencies": {
       "@strapi/strapi": "^5.61.0",
       "@strapi/utils": "^5.61.0"
     },
     "strapi": {
       "kind": "plugin",
       "name": "yt-kb",
       "displayName": "YT Knowledge Base",
       "description": "Videos, tags, notes, digests and transcripts, with MCP tools for agents."
     }
   }
   ```
   Then `yarn --cwd server/src/plugins/yt-kb install` (updates `server/src/plugins/yt-kb/yarn.lock`; yarn warns that the peers are not installed in the plugin folder — expected, they resolve from `server/node_modules`). `vitest` 3.2.6 is the version step 7 pins in the client too (3.2.4, installed in `client/` today, has a critical advisory fixed in 3.2.6); `@types/node` `^22.0.0` matches the Node floor (precondition 4).

5. **`server/src/plugins/yt-kb/vitest.config.mts` — new file.** `.mts` because the plugin package is `"type": "commonjs"` and the config must load as ESM.
   ```ts
   import { defineConfig } from 'vitest/config';

   // The plugin's unit tests and guards. Node environment only; they never
   // boot Strapi. `server/tsconfig.build.json` excludes **/*.test.ts, so
   // nothing here reaches dist/.
   export default defineConfig({
     test: {
       include: ['server/src/**/*.test.ts'],
       environment: 'node',
     },
   });
   ```

6. **Move the guard.** `git mv client/src/lib/services/mcp-permissions.guard.test.ts server/src/plugins/yt-kb/server/src/mcp-official/permissions.guard.test.ts`, then replace the moved file's contents with:
   ```ts
   import { describe, expect, it } from 'vitest';
   import { readFileSync } from 'node:fs';
   import { join } from 'node:path';

   // Guards an ordering that nothing else can catch.
   //
   // Strapi admin's bootstrap runs cleanPermissionsInDatabase(), which deletes
   // every `admin::permission` row whose action is not registered in the
   // actionProvider. An admin API token's grants are exactly those rows. So if
   // the plugin::yt-kb actions register behind an enabled check, one boot with
   // the flag off deletes the grants from every token — permanently, silently,
   // and turning MCP back on does not bring them back. Measured on a copy of
   // the real database: six grant rows went to zero on a single boot.
   //
   // The guard reads the source rather than importing it: the ordering is
   // the thing under test, and importing would need a running Strapi.
   const ENTRY = join(__dirname, 'index.ts');
   const PERMISSIONS = join(__dirname, 'permissions.ts');

   describe('MCP admin permission registration', () => {
     const source = readFileSync(ENTRY, 'utf8');

     it('registers the permissions before the enabled check returns', () => {
       const register = source.indexOf('registerMcpAdminPermissions(strapi)');
       const gate = source.indexOf('isEnabled()');

       expect(register, 'registerMcpAdminPermissions call not found').toBeGreaterThan(-1);
       expect(gate, 'isEnabled() gate not found').toBeGreaterThan(-1);
       expect(
         register,
         'Permissions must register before the MCP_ENABLED gate. Behind it, one ' +
           'boot with MCP disabled deletes every token grant for good.',
       ).toBeLessThan(gate);
     });

     it('does not return from the function before registering them', () => {
       const register = source.indexOf('registerMcpAdminPermissions(strapi)');
       const earlyReturn = source.indexOf('return;');

       expect(
         earlyReturn === -1 || earlyReturn > register,
         'An early return above registerMcpAdminPermissions would skip it on ' +
           'exactly the boots that destroy token grants.',
       ).toBe(true);
     });

     // The three action ids are what a minted token's grants point at. Renaming
     // one has the same effect as not registering it: the old rows no longer
     // match a registered action and the next boot deletes them.
     it('still registers the three action ids tokens are granted', () => {
       const permissions = readFileSync(PERMISSIONS, 'utf8');

       // Registered as plugin::yt-kb.<uid>.
       expect(permissions).toContain("pluginName: 'yt-kb'");
       for (const uid of ['read', 'write', 'maintenance']) {
         expect(
           permissions,
           `plugin::yt-kb.${uid} missing — existing grants for it would be deleted`,
         ).toContain(`uid: '${uid}'`);
       }
     });
   });
   ```
   (M5 rewrites this guard for the per-tool actions; M1 only moves it.)

7. **`client/package.json`** — three edits, nothing else:
   - in `devDependencies`, `"vite": "^8.0.0"` → `"vite": "8.3.6"`;
   - in `devDependencies`, `"vitest": "^3.0.5"` → `"vitest": "3.2.6"`;
   - add a top-level key after `"devDependencies"` (before `"pnpm"`):
     ```json
     "resolutions": {
       "seroval": "^1.7.6"
     },
     ```
   Then `yarn --cwd client install` — this updates `client/yarn.lock` (vite, vitest and seroval entries), which is committed with M1. Then `yarn --cwd client install --frozen-lockfile` → exit 0 (the lockfile matches `package.json`; CI installs this way). Yarn classic applies `resolutions` to every `seroval` in the tree, including `solid-js`'s `~1.5.0`. `client/package-lock.json` and `client/pnpm-lock.yaml` are not touched here (M6 removes them, M-21).

8. **Root `package.json` — the `scripts` object, whole:**
   ```json
   "scripts": {
     "client": "yarn --cwd ./client dev",
     "server": "yarn --cwd ./server develop",
     "setup:client": "cd client && yarn && node ../copy-env.mjs ./",
     "setup:server": "cd server && yarn && node ../copy-env.mjs ./",
     "setup:plugin": "cd server/src/plugins/yt-kb && yarn && yarn build",
     "setup": "yarn install && yarn setup:client && yarn setup:server && yarn setup:plugin && yarn setup:site",
     "dev": "yarn concurrently \"cd server && yarn develop\" \"npx wait-on http://localhost:1340 && cd client && yarn dev\"",
     "start": "./start.sh",
     "start:fresh": "./start.sh --restart-ollama",
     "export": "yarn --cwd ./server export",
     "seed": "yarn --cwd ./server seed",
     "test": "yarn --cwd ./client test",
     "plugin:build": "yarn --cwd ./server/src/plugins/yt-kb build",
     "plugin:test": "yarn --cwd ./server/src/plugins/yt-kb test",
     "sync:bm25": "node scripts/sync-bm25-core.mjs",
     "install:all": "yarn install --frozen-lockfile && yarn --cwd server install --frozen-lockfile && yarn --cwd server/src/plugins/yt-kb install --frozen-lockfile && yarn --cwd client install --frozen-lockfile && yarn --cwd site install --frozen-lockfile",
     "site": "yarn --cwd ./site dev",
     "site:build": "yarn --cwd ./site build",
     "site:test": "yarn --cwd ./site test",
     "site:deploy": "yarn --cwd ./site deploy",
     "setup:site": "cd site && yarn && node ../copy-env.mjs ./",
     "site:publish": "./publish-site.sh",
     "site:publish:draft": "./publish-site.sh --draft"
   },
   ```
   `setup:plugin` runs after `setup:server` and `install:all` installs the plugin after `server/`: the plugin's build and tests resolve `@strapi/*` (and `better-sqlite3` in M2's tests) from `server/node_modules`. `yarn test` stays the client suite (CLAUDE.md's "one obvious entry point"); the plugin suite is `yarn plugin:test`. `site:deploy` is M7's.

9. **`.github/workflows/ci.yml` — whole file:**
   ```yaml
   # Minimal CI — the static gates from CLAUDE.md: typecheck every package,
   # build and verify strapi-plugin-yt-kb, and run the vitest suites. Both
   # live-backend test families self-skip headless: embeddings.ranking.test.ts
   # probes Ollama and videos.smoke.test.ts probes Strapi, so neither needs
   # services here.
   #
   # One job, five installs (root + server + the plugin + client + site). Each
   # package owns its dependencies — there is no workspace and no hoisting.
   # Keeping Strapi's React 18 unreachable from the React 19 client is
   # deliberate: sharing a root lets the two majors meet, which breaks SSR.
   # The plugin installs after server/: its build and tests resolve @strapi/*
   # from server/node_modules.
   #
   # Caching keys on every lockfile, so a change in any package busts it.
   name: ci

   on:
     push:
       branches: [main]
     pull_request:

   jobs:
     ci:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: yarn
             cache-dependency-path: |
               yarn.lock
               server/yarn.lock
               server/src/plugins/yt-kb/yarn.lock
               client/yarn.lock
               site/yarn.lock

         - name: Install all packages
           run: yarn install:all

         # Typecheck is per-package: each has its own tsconfig and there is no
         # project-wide script.
         - name: Typecheck client
           run: npx tsc --noEmit
           working-directory: client

         # server/tsconfig.json excludes src/plugins/, so this covers the host
         # app only. The plugin has its own steps below.
         - name: Typecheck server
           run: npx tsc --noEmit
           working-directory: server

         - name: Typecheck plugin
           run: yarn test:ts:back
           working-directory: server/src/plugins/yt-kb

         - name: Build plugin
           run: yarn build
           working-directory: server/src/plugins/yt-kb

         # strapi-plugin verify checks the built package (exports, dist) — after build.
         - name: Verify plugin
           run: yarn verify
           working-directory: server/src/plugins/yt-kb

         - name: Test plugin
           run: yarn test
           working-directory: server/src/plugins/yt-kb

         # `astro sync` first: tsconfig includes .astro/types.d.ts, which is
         # generated and gitignored, so tsc alone fails on a clean checkout.
         # Sync runs the content loader, and there is no Strapi here — the flag
         # skips the fetch. verify-output.mjs refuses a build with it set, so it
         # cannot leak into one.
         - name: Typecheck site
           run: SITE_SKIP_STRAPI_FETCH=1 npx astro sync && npx tsc --noEmit
           working-directory: site

         - name: Test
           run: yarn test

         # The site has its own suite and its own vitest config, so the root
         # `yarn test` (which is the client's) does not reach it. Without this
         # step its tests would never run in CI.
         - name: Test site
           run: yarn site:test

         # `tsc --noEmit` and the real Vite build check different things
         # (module resolution edge cases, asset imports, Rollup tree-shaking) —
         # ADR 0009 documents `--noEmit` passing twice while `vite build` failed
         # for real in the sibling repo. The pre-push hook already runs this
         # build locally, but that hook is opt-in per clone and skippable with
         # --no-verify, so CI runs it too as the one gate nobody can bypass.
         - name: Build client
           run: yarn build
           working-directory: client
   ```

10. **`server/types/generated/components.d.ts`, `server/types/generated/contentTypes.d.ts`** — Strapi rewrites these on the first boot (Verify step 4). Commit whatever the boot writes; do not edit them by hand.

11. **Comments that still say the plugin's schemas are zod 3** (comment-only; no code changes). They are written in `@strapi/utils`' `z`, which is the zod 4 API on both 5.52.1 and 5.61.0 (Facts).
    - `PSRC/mcp/registry.ts` lines 8–11 (from `// The schema is zod 3, from @strapi/utils` to `// and only the restated one was enforced at runtime (see docs/mcp.md).`) become:
      ```ts
      // The schema uses the zod 4 API from `@strapi/utils` — the same zod the
      // MCP SDK's schema conversion needs. It used to be the app's own zod here
      // and was re-declared with `@strapi/utils`' zod in ../mcp-official/tools.ts,
      // which meant every tool had two schemas and only the restated one was
      // enforced at runtime (see docs/mcp.md).
      ```
    - `PSRC/mcp-official/adapter.ts` lines 9–13 (from `//   - ADDED here, per tool: the input/output schemas, declared with` to `//     (read|write|maintenance) mapping to a custom admin permission.`) become:
      ```ts
      //   - ADDED here, per tool: the output schema, declared with the zod 4
      //     API from `@strapi/utils` (the input schema is the tool's own, in
      //     the same z, passed straight through). Plus a `title` and an
      //     `access` tier (read|write|maintenance) mapping to a custom admin
      //     permission.
      ```
      line 45 `   * Output schema in zod 3. Defaults to a permissive object (any shape) —` → `   * Output schema, in the zod 4 API from @strapi/utils. Defaults to a permissive object (any shape) —`; lines 93–94 `  // declared twice — zod 4 on the body, zod 3 here — and only this one was` / `  // enforced, so adding a field to a body and forgetting the copy left the` → `  // declared twice — the app's own zod on the body, @strapi/utils' here —` / `  // and only this one was enforced, so adding a field to a body and forgetting the copy left the`.
    - `PSRC/mcp-official/tools.ts` line 7 `// (zod 3 here, zod 4 on the body) because the two zods weren't` → `// (@strapi/utils' zod here, the app's own zod on the body) because the two weren't`; line 12 `// schemas in the same zod 3 the SDK needs, and the adapter passes` → `// schemas with the zod 4 API from @strapi/utils, the one the SDK needs, and the adapter passes`.
    - Check: `grep -rn "zod 3" server/src/plugins/yt-kb/server/src` → no output. M5 replaces `adapter.ts` and `tools.ts` whole; its text says "the zod 4 API from `@strapi/utils`" and never "zod 3", and its `registry.ts` edit touches only line 24.

- **Data:** no schema change. The upgrade can add Strapi internal migrations (`strapi_migrations_internal`) that run on the next boot of a database. They are exercised here only on the scratch copy `server/.tmp/e8-m1.db`; the owner's `server/.tmp/data.db` is backed up in step 2 and first migrates when the owner next runs `yarn dev`.
- **Callers updated:** the moved guard (`client/src/lib/services/mcp-permissions.guard.test.ts` → plugin). Docs that name the old path or the old install list — `docs/mcp.md:32`, `CLAUDE.md` (the `yarn install:all` row, the "319 tests" counts, the "Tests" section's "Unit tests are vitest, in `client/src/` only. The server has no test suite") — are rewritten in M8; record the new client total for M8.

#### M1 verify

Run from the repo root, in order. Every check prints JSON; "→" is the expected result.

1. **Installed versions:**
   ```bash
   node -e 'const {createRequire}=require("module");const r=createRequire(process.cwd()+"/server/package.json");const v=n=>r(n+"/package.json").version;const o={strapi:v("@strapi/strapi"),core:v("@strapi/core"),database:v("@strapi/database"),utils:v("@strapi/utils"),cloud:v("@strapi/plugin-cloud"),usersPermissions:v("@strapi/plugin-users-permissions"),zodForUtils:require(require.resolve("zod/package.json",{paths:[r.resolve("@strapi/utils")]})).version,undici:require("./server/src/plugins/yt-kb/node_modules/undici/package.json").version,vite:require("./client/node_modules/vite/package.json").version,clientVitest:require("./client/node_modules/vitest/package.json").version,pluginVitest:require("./server/src/plugins/yt-kb/node_modules/vitest/package.json").version};console.log(JSON.stringify(o));const bad=Object.entries({strapi:"5.61.0",core:"5.61.0",database:"5.61.0",utils:"5.61.0",cloud:"5.61.0",usersPermissions:"5.61.0",zodForUtils:"4.4.3",undici:"6.29.1",vite:"8.3.6",clientVitest:"3.2.6",pluginVitest:"3.2.6"}).filter(([k,x])=>o[k]!==x);if(bad.length){console.log(JSON.stringify({mismatch:bad}));process.exit(1)}'
   ```
   → exits 0. Then the lockfiles M1 changed match their `package.json`s: `yarn --cwd client install --frozen-lockfile && yarn --cwd server/src/plugins/yt-kb install --frozen-lockfile` → exit 0, and `git diff --name-only -- client/yarn.lock` lists `client/yarn.lock` (step 7's update is there to commit).
2. **Every `seroval` in the client tree is ≥ 1.6.8** (advisories through 1.6.7; the resolution `^1.7.6` should leave only 1.7.6 or later):
   ```bash
   yarn --cwd client list --pattern seroval --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const tree=s.split("\n").filter(Boolean).map(l=>JSON.parse(l)).find(j=>j.type==="tree");const found=[];const walk=n=>{const m=/^seroval@(\d+)\.(\d+)\.(\d+)$/.exec(n.name);if(m)found.push(m.slice(1).map(Number));(n.children||[]).forEach(walk)};tree.data.trees.forEach(walk);const low=found.filter(([a,b,c])=>a<1||(a===1&&(b<6||(b===6&&c<8))));console.log(JSON.stringify({versions:found.map(v=>v.join(".")),low:low.map(v=>v.join("."))}));process.exit(found.length&&!low.length?0:1)})'
   ```
   → exits 0, `low: []`.
3. **Plugin static gates:** `yarn --cwd server/src/plugins/yt-kb test:ts:back` → exit 0; `yarn plugin:build` → exit 0 and `node -e 'require.resolve("./server/src/plugins/yt-kb/dist/server/index.js")'` → exit 0; `yarn --cwd server/src/plugins/yt-kb verify` → exit 0 (if it fails, fix what it reports in M1; if that needs a structural change to the package, stop and ask — Open questions, OQ-1).
   Plugin tests, parsed:
   ```bash
   yarn --cwd server/src/plugins/yt-kb vitest run --reporter=json --outputFile="$PWD/server/.tmp/e8/m1-plugin-vitest.json"; node -e 'const r=require("./server/.tmp/e8/m1-plugin-vitest.json");console.log(JSON.stringify({passed:r.numPassedTests,failed:r.numFailedTests}));process.exit(r.numFailedTests===0&&r.numPassedTests===3?0:1)'
   ```
   → `{"passed":3,"failed":0}`.
   **Negative test (the guard bites):**
   ```bash
   F=server/src/plugins/yt-kb/server/src/mcp-official/index.ts; cp $F server/.tmp/e8/index.ts.orig
   node -e 'const fs=require("fs"),f=process.argv[1];const s=fs.readFileSync(f,"utf8");fs.writeFileSync(f,s.replace("  await registerMcpAdminPermissions(strapi);","  if (!toolsEnabled) return;\n  await registerMcpAdminPermissions(strapi);"))' $F
   yarn --cwd server/src/plugins/yt-kb vitest run --reporter=json --outputFile="$PWD/server/.tmp/e8/m1-guard-neg.json"; node -e 'const r=require("./server/.tmp/e8/m1-guard-neg.json");console.log(JSON.stringify({failed:r.numFailedTests}));process.exit(r.numFailedTests>=1?0:1)'
   cp server/.tmp/e8/index.ts.orig $F && git diff --exit-code -- $F
   ```
   → the second command exits 0 (`failed` ≥ 1); `git diff --exit-code` → exit 0 (file restored).
4. **Strapi 5.61.0 boots on a scratch copy of real data, with the plugin and its components:**
   ```bash
   node server/.tmp/e8/e8.mjs backup server/.tmp/data.db server/.tmp/e8-m1.db
   node server/.tmp/e8/e8.mjs counts server/.tmp/e8-m1.db > server/.tmp/e8/m1-counts-before.json
   (cd server && DATABASE_FILENAME=.tmp/e8-m1.db yarn -s strapi admin:create-user --email="$(node -p 'require("./.tmp/e8/admin.json").email')" --password="$(node -p 'require("./.tmp/e8/admin.json").password')" --firstname=E8 --lastname=Check)
   (cd server && DATABASE_FILENAME=.tmp/e8-m1.db PORT=1341 HOST=127.0.0.1 nohup yarn develop > .tmp/e8/m1-strapi.log 2>&1 &)
   node server/.tmp/e8/e8.mjs wait http://127.0.0.1:1341/_health 300
   ```
   → backup `"integrity": "ok"`; create-user exits 0; wait prints `"status": 204`. (`DATABASE_FILENAME` is relative to `server/`, `server/config/database.ts`; shell variables win over `server/.env`.)
5. **Tokens (scripted, no admin panel):**
   ```bash
   node server/.tmp/e8/e8.mjs admin-tokens http://127.0.0.1:1341 server/.tmp/e8/admin.json server/.tmp/e8/tokens.json plugin::yt-kb.read,plugin::yt-kb.write,plugin::yt-kb.maintenance
   ```
   → `"ok": true` and `grantedActions` = `["plugin::yt-kb.maintenance","plugin::yt-kb.read","plugin::yt-kb.write"]`. If `login` or a token step fails, the 5.61 admin API differs from the 5.52.1 shape this kit was written against (`@strapi/admin/dist/server/server/src/validation/admin-tokens.js`, `controllers/authentication.js`) — stop and ask.
6. **MCP still serves the 21 tools** (names as at `721f210`; M5 renames them):
   ```bash
   node server/.tmp/e8/e8.mjs mcp server/.tmp/e8/tokens.json tools/list > server/.tmp/e8/m1-tools.json
   node -e 'const r=require("./server/.tmp/e8/m1-tools.json");const want="libraryStats,listVideos,searchVideos,getVideo,getTranscript,searchTranscript,findTranscripts,crossSearchTranscripts,listTranscripts,aggregateByTag,listUntagged,listTags,relatedVideos,getReadableArticle,generateDigest,saveSummary,tagVideo,untagVideo,saveNote,addVideo,fetchTranscript".split(",");const missing=want.filter(n=>!r.tools.includes(n));console.log(JSON.stringify({toolCount:r.toolCount,missing}));process.exit(missing.length?1:0)'
   node server/.tmp/e8/e8.mjs mcp server/.tmp/e8/tokens.json tools/call '{"name":"libraryStats","arguments":{}}' > server/.tmp/e8/m1-stats.json
   node -e 'const s=require("./server/.tmp/e8/m1-stats.json").structuredContent;const c=require("./server/.tmp/e8/m1-counts-before.json").tables;console.log(JSON.stringify({mcpVideos:s.totals.videos,dbVideos:c.yt_kb_videos}));process.exit(s.totals.videos===c.yt_kb_videos?0:1)'
   ```
   → `missing: []`; the MCP video total equals the scratch DB's `yt_kb_videos` count.
   **Negative tests:** `node server/.tmp/e8/e8.mjs mcp server/.tmp/e8/tokens.json tools/list '{}' none` → exits 1 with `"step": "initialize"`; the same with `rest` as the last argument (a Content API token on `/mcp`) → exits 1 with `"step": "initialize"`.
7. **Components still register (the undocumented `strapi.get('components').add` path, `PSRC/register.ts:19-36`):**
   ```bash
   node server/.tmp/e8/e8.mjs rest server/.tmp/e8/tokens.json GET '/api/yt-kb/videos?filters[summaryStatus][$eq]=generated&populate[sections]=true&pagination[pageSize]=1' > server/.tmp/e8/m1-sections.json
   node -e 'const r=require("./server/.tmp/e8/m1-sections.json");const ok=r.status===200&&Array.isArray(r.body.data[0]?.sections)&&r.body.data[0].sections.length>0;console.log(JSON.stringify({status:r.status,sections:r.body.data?.[0]?.sections?.length??null}));process.exit(ok?0:1)'
   ```
   → status 200, `sections` > 0. If this fails, the component registry changed in 5.61 — stop and ask (the code comment names JSON fields as the fallback; that is a design change).
   **Negative test:** `node server/.tmp/e8/e8.mjs rest server/.tmp/e8/tokens.json GET /api/yt-kb/videos '' none` → `"status": 403` (no Public grants).
8. **Data survived the upgrade's first boot:** `node server/.tmp/e8/e8.mjs counts server/.tmp/e8-m1.db > server/.tmp/e8/m1-counts-after.json` then
   ```bash
   node -e 'const a=require("./server/.tmp/e8/m1-counts-before.json"),b=require("./server/.tmp/e8/m1-counts-after.json");const same=JSON.stringify(a.tables)===JSON.stringify(b.tables)&&JSON.stringify(a.tagSlugs)===JSON.stringify(b.tagSlugs);console.log(JSON.stringify({same,newInternalMigrations:b.internalMigrations.filter(m=>!a.internalMigrations.includes(m))}));process.exit(same?0:1)'
   ```
   → `same: true`. Record `newInternalMigrations` in the E8 log (these run on the owner's DB at its next boot).
9. **The seroval boundary through the app** (the e2e that guards M-20). With the scratch Strapi still up:
   ```bash
   (cd client && STRAPI_URL=http://127.0.0.1:1341 STRAPI_API_TOKEN="$(node -p 'require("../server/.tmp/e8/tokens.json").rest')" nohup yarn dev > ../server/.tmp/e8/m1-client.log 2>&1 &)
   node server/.tmp/e8/e8.mjs wait http://localhost:3005/feed 180
   yarn -s --cwd client test:e2e --reporter=json > server/.tmp/e8/m1-e2e.json; node -e 'const r=require("./server/.tmp/e8/m1-e2e.json");console.log(JSON.stringify(r.stats));process.exit(r.stats.unexpected===0&&r.stats.expected>0?0:1)'
   ```
   → `unexpected: 0`. If Playwright reports a missing browser, stop and ask (installing one is a download).
10. **Stop the scratch processes** (only what this milestone started; precondition 1 proved the ports were free): `lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill; lsof -ti tcp:3005 -sTCP:LISTEN | xargs kill`.
11. **Client and server gates:** `cd client && npx tsc --noEmit` → exit 0; `yarn --cwd client build` → exit 0; `cd server && npx tsc --noEmit` → exit 0. Client suite, parsed:
    ```bash
    yarn --cwd client vitest run --reporter=json --outputFile="$PWD/server/.tmp/e8/m1-client-vitest.json"; node -e 'const r=require("./server/.tmp/e8/m1-client-vitest.json");console.log(JSON.stringify({total:r.numTotalTests,failed:r.numFailedTests}));process.exit(r.numFailedTests===0?0:1)'
    ```
    → `failed: 0` and `total` = `CLIENT_BASELINE − 3` (the moved guard's three tests). `yarn site:test` → exit 0, same total as the baseline.
12. **CI, as a fresh clone would run it** (after the M1 commit):
    ```bash
    C="${TMPDIR:-/tmp}/yt-kb-e8-clone"; rm -rf "$C"; git clone --quiet "$PWD" "$C" && cd "$C" && git checkout --quiet egm/yt-kb-any-strapi \
      && yarn install:all \
      && (cd client && npx tsc --noEmit) && (cd server && npx tsc --noEmit) \
      && (cd server/src/plugins/yt-kb && yarn test:ts:back && yarn build && yarn verify && yarn test) \
      && (cd site && SITE_SKIP_STRAPI_FETCH=1 npx astro sync && npx tsc --noEmit) \
      && yarn test && yarn site:test && (cd client && yarn build); echo "{\"ciExit\":$?}"
    ```
    → `{"ciExit":0}`. Then, in the same clone: `rm -rf server/src/plugins/yt-kb/node_modules server/src/plugins/yt-kb/dist && yarn setup:plugin && node -e 'require.resolve("./server/src/plugins/yt-kb/dist/server/index.js");console.log(JSON.stringify({setupBuildsPlugin:true}))'` → `setupBuildsPlugin: true`. Remove the clone afterwards (`rm -rf "$C"` — a scratch directory this step created).

- **Done when:** the CI command sequence in Verify 12 exits 0 on a fresh clone of the M1 commit, and Verify 1–11 all exit 0.
- **Commit:** `M1: Strapi 5.61.0, pinned undici/vite/vitest/seroval, plugin in setup, CI and tests` — `server/package.json`, `server/yarn.lock`, `server/types/generated/*`, `server/src/plugins/yt-kb/{package.json,yarn.lock,vitest.config.mts}`, the moved guard, the step 11 comment fixes (`PSRC/mcp/registry.ts`, `PSRC/mcp-official/adapter.ts`, `PSRC/mcp-official/tools.ts`), `client/package.json`, `client/yarn.lock`, `package.json`, `.github/workflows/ci.yml`.
- **Rollback:** `git revert <M1 commit>`, then reinstall from the restored lockfiles: `yarn --cwd server install --frozen-lockfile && yarn --cwd server/src/plugins/yt-kb install --frozen-lockfile && yarn --cwd client install --frozen-lockfile`, and `yarn plugin:build`. If the owner's `server/.tmp/data.db` has already booted on 5.61.0, restore it with Strapi stopped: `cp server/.tmp/data.db.pre-m1-<TS> server/.tmp/data.db` — 5.52.1 is not guaranteed to boot on a database 5.61.0's internal migrations changed, and the restore loses anything written since the backup.

### M2 — Data model and integrity: unique keys, wider columns, new transcript attributes, race-safe writes

- **Why:** B-2 (uniqueness not enforced by the database; check-then-insert races), M-12 (tag slug collisions; lookups that don't collapse spaces; silent drop in the app), M-17 (`string` columns too short for YouTube data on Postgres), M-18 (multi-record writes not transactional). Also adds the empty transcript attributes M3 and M4 fill.
- **Out of scope here:** the fetcher rewrite, `language`, metadata extraction and `TranscriptFetchError` (M3); building `searchIndex` and every reader of it (M4). M2 adds those attributes empty.

#### What the installed source says (read on 5.52.1; re-checked on 5.61.0 in step 0)

At read time `server/node_modules` is 5.52.1, and the reference install `~/work/plugin-dev/strapi-prod` is 5.60.0; every fact below is identical in both.

| Fact | Source |
|---|---|
| A unique **index** comes only from `column: { unique: true }`; `unique: true` alone is an application check. The index is named `<table>_<column>_uq` (computed with the installed `identifiers.getUniqueIndexName`: `yt_kb_videos_youtube_video_id_uq`, `yt_kb_transcripts_youtube_video_id_uq`, `yt_kb_tags_name_uq`, `yt_kb_tags_slug_uq`, `yt_kb_digests_video_set_key_uq`). Scalar attributes pass to the database model unchanged, `column` included. Documented as experimental ("Database validations and settings", docs.strapi.io `cms/backend-customization/models`). | `@strapi/database/dist/schema/schema.js:18-31, 92-103`; `@strapi/core/dist/utils/transform-content-types-to-models.js:187-193` |
| Schema sync applies a whole diff in **one** transaction (`db.connection.transaction`), after `pragma foreign_keys = off` on SQLite. A `CREATE UNIQUE INDEX` that meets duplicate rows fails, the transaction rolls back, and Strapi does not boot. | `@strapi/database/dist/schema/builder.js:62-109`; `dialects/sqlite/index.js` (`startSchemaUpdate`) |
| `string` → `text`: the diff sees a type change (`varchar` → `text`) and calls `.alter()`. On SQLite, knex 3.0.1 rebuilds the table (create, copy every row, drop, rename, re-create indexes, with foreign-key checks off and a foreign-key check after). On Postgres it is `ALTER COLUMN … TYPE text`, which keeps every value. No data is lost either way. | `diff.js:119-147`; `builder.js:283-299`; `knex/lib/dialects/sqlite3/schema/ddl.js:336-370` |
| New attributes become nullable columns with no default; existing rows get `NULL`. | `builder.js:301-310`; `schema.js:18-31` |
| `forceMigration` defaults to **true**: a column or index that leaves the schema is dropped at the next boot. This matters for rollback. | `@strapi/database/dist/index.js:139-146`; `builder.js:164-166, 213-216` |
| A duplicate is caught at three points, in this order: (1) yt-kb's own Document Service rule for video and transcript (`ApplicationError`, message `A video for this id already exists. documentId=…`); (2) Strapi's entity validator, for any `unique: true` or `uid` attribute — `ValidationError` whose `details.errors[i].message` is `This attribute must be unique` (the string in `validators.js:236`). A single failure also has that as its top-level message; two failures at once — a tag whose `name` **and** uid `slug` are both taken, the usual shape of a lost tag race — have yup's top-level `2 errors occurred`, so only `details.errors[]` identifies them. `YupValidationError` extends `ValidationError`, which extends `ApplicationError` (`@strapi/utils/dist/errors.js`); (3) the database index, only when two writes pass (2) at once. | `PSRC/document-rules.ts:29-57`; `@strapi/core/dist/services/entity-validator/validators.js:104-280`; `@strapi/utils/dist/format-yup-error.js` |
| How (3) surfaces: **unchanged**. better-sqlite3 throws `SqliteError` with `code: 'SQLITE_CONSTRAINT_UNIQUE'` and no `errno`; the SQLite dialect maps only `errno === 19` (to `NotNullError`), so the error passes through untouched; knex prefixes the SQL to `message` and keeps the same object. Postgres throws pg's `DatabaseError` with `code: '23505'`; the Postgres dialect maps only `'23502'`. Strapi's Document Service error middleware converts only time/date/relation errors. REST turns a non-Strapi error into **500** (`formatInternalError`). | `@strapi/database/dist/dialects/sqlite/index.js:69-80`, `postgresql/index.js:41-53`, `query/query-builder.js:535-563`; `better-sqlite3/lib/sqlite-error.js`; `knex/lib/execution/internal/query-executioner.js:39`; `@strapi/core/dist/services/document-service/middlewares/errors.js`; `@strapi/core/dist/middlewares/errors.js` |
| Transactions: every Document Service method is wrapped in `strapi.db.transaction`; `strapi.db.transaction` reuses the open transaction when nested (AsyncLocalStorage, `transactionCtx`), and every query-builder query joins it. So Document Service calls inside `strapi.db.transaction(cb)` are one transaction, and a throw rolls all of them back. Raw knex through `strapi.db.connection(...)` does **not** join it — use the callback's `trx`. Document Service middlewares (`strapi.documents.use`) run outside that per-call wrapper, so a middleware's own queries before `next()` are not in the create's transaction unless the caller opened one. | `@strapi/core/dist/services/document-service/common.js`, `repository.js:566-576`, `middlewares/middleware-manager.js`; `@strapi/database/dist/index.js:57-96`, `transaction-context.js` |
| On SQLite the knex pool is `min 1, max 1`. A raw `strapi.db.connection(...)` query issued inside an open transaction waits for the one connection — until the 60 s `acquireConnectionTimeout`. | `knex/lib/dialects/sqlite3/index.js:215-217`; `server/config/database.ts` |
| On Postgres, a failed statement aborts the whole transaction: no further query in it works until rollback. So a unique violation inside a transaction can only be handled **outside** it (re-read, or retry the whole transaction). | Postgres behaviour; not in Strapi source |

#### M2 files

0. **Re-check the facts on 5.61.0** (after M1). Run from `server/node_modules/@strapi`:
   ```bash
   node -p "require('./database/package.json').version"                                   # → 5.61.0
   grep -n "case 19\|case '23502'\|23505\|UNIQUE" database/dist/dialects/sqlite/index.js database/dist/dialects/postgresql/index.js
   ls database/dist/errors/*.js
   grep -c "This attribute must be unique" core/dist/services/entity-validator/validators.js  # → 1 or more
   grep -n "databaseErrorsToTransform" -A6 core/dist/services/document-service/middlewares/errors.js
   grep -n "notNestedTransaction" database/dist/index.js                                    # → present
   grep -n "forceMigration: true" database/dist/index.js                                    # → present
   node -e "const {identifiers}=require('./database/dist/utils/identifiers/index.js');console.log(JSON.stringify(identifiers.getUniqueIndexName(['yt_kb_tags','slug'])))"   # → "yt_kb_tags_slug_uq"
   ```
   Expected: the grep shows only `case 19` (SQLite) and `case '23502'` (Postgres); `errors/` holds only `database`, `invalid-date`, `invalid-datetime`, `invalid-relation`, `invalid-time`, `not-null` (plus `index`); the transform list is the four time/date/relation errors. **If 5.61 maps unique violations to a new error class or code, or the suffix is not `_uq`, stop and ask** — `isUniqueViolation` and the checks below are written against the 5.52.1/5.60.0 shapes.

1. **Pre-step: duplicate check, then backup, before the first boot on the new schema.**
   - SQLite (the owner's DB, read-only): `node server/.tmp/e8/e8.mjs dupcheck server/.tmp/data.db` → `{"duplicates": []}`, exit 0 (0 duplicates were found on 2026-11-08).
   - Postgres (any host that already has yt-kb tables, before it upgrades the plugin), **where the database is reachable** (a self-hosted Postgres): run the same SQL with psql. If `DATABASE_SCHEMA` is not `public`, prefix `SET search_path TO "<schema>";`. Strapi Cloud's managed database is not reachable from outside, so psql cannot run there: on Strapi Cloud the safeguard is the schema sync itself — a `CREATE UNIQUE INDEX` that meets duplicates fails, its transaction rolls back and the deploy does not boot (Facts, row 2), with no data changed; the owner then removes the duplicates in the admin panel (Content Manager) and redeploys.
     ```sql
     SELECT 'yt_kb_videos.youtube_video_id' AS key, CAST(youtube_video_id AS TEXT) AS value, COUNT(*) AS n
       FROM yt_kb_videos WHERE youtube_video_id IS NOT NULL GROUP BY youtube_video_id HAVING COUNT(*) > 1
     UNION ALL
     SELECT 'yt_kb_transcripts.youtube_video_id', CAST(youtube_video_id AS TEXT), COUNT(*)
       FROM yt_kb_transcripts WHERE youtube_video_id IS NOT NULL GROUP BY youtube_video_id HAVING COUNT(*) > 1
     UNION ALL
     SELECT 'yt_kb_tags.name', CAST(name AS TEXT), COUNT(*)
       FROM yt_kb_tags WHERE name IS NOT NULL GROUP BY name HAVING COUNT(*) > 1
     UNION ALL
     SELECT 'yt_kb_tags.slug', CAST(slug AS TEXT), COUNT(*)
       FROM yt_kb_tags WHERE slug IS NOT NULL GROUP BY slug HAVING COUNT(*) > 1
     UNION ALL
     SELECT 'yt_kb_digests.video_set_key', CAST(video_set_key AS TEXT), COUNT(*)
       FROM yt_kb_digests WHERE video_set_key IS NOT NULL GROUP BY video_set_key HAVING COUNT(*) > 1;
     ```
     Command: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -F $'\t' -f dup-check.sql` → no output rows.
   - **If any row comes back, stop: do not boot on the new schema.** Bring the rows to the owner with this merge, to run on a backup copy first and then, once approved, on the real database, with Strapi stopped:
     - `yt_kb_tags.name` — keep the row with the lowest `id`; in `yt_kb_videos_tags_lnk`, repoint each loser's `tag_id` to the keeper unless that `(video_id, keeper)` pair already exists, in which case delete the loser's link row; delete the loser tags.
     - `yt_kb_tags.slug` (different names) — keep the lowest `id`'s slug; set each other row's slug to the first free `<slug>-2`, `<slug>-3`, … (the same rule the new create rule uses).
     - `yt_kb_transcripts.youtube_video_id` — keep the row a video links to in `yt_kb_videos_transcript_lnk`, else the newest `fetched_at`; repoint any other link to the keeper; delete the rest.
     - `yt_kb_digests.video_set_key` — keep the newest `updated_at`; delete the rest with their `yt_kb_digests_cmps` and `yt_kb_digests_videos_lnk` rows.
     - `yt_kb_videos.youtube_video_id` — no automatic merge (summaries, notes and digests hang off each row): the owner decides row by row.
   - Backup of the owner's DB, after the check passes and before anything boots on the new schema:
     ```bash
     TS=$(date +%s); node server/.tmp/e8/e8.mjs backup server/.tmp/data.db server/.tmp/data.db.pre-m2-$TS
     ```
     → `"integrity": "ok"`; record the path in the E8 log. As in M1, E8 never boots Strapi on `server/.tmp/data.db`; the owner's next `yarn dev` applies M2's schema, and this backup is what a rollback restores.

2. **Schemas** — `server/src/plugins/yt-kb/server/src/content-types/*/schema.json`. Only the attributes shown change; every other line stays.
   - `video/schema.json`:
     ```json
     "youtubeVideoId": {
       "type": "string",
       "required": true,
       "unique": true,
       "maxLength": 32,
       "column": { "unique": true }
     },
     ```
     ```json
     "videoAuthor": {
       "type": "text",
       "maxLength": 200
     },
     ```
   - `transcript/schema.json` — `youtubeVideoId` gets the same `"column": { "unique": true }`; `title` and `author` become:
     ```json
     "title": {
       "type": "text",
       "maxLength": 300
     },
     "author": {
       "type": "text",
       "maxLength": 200
     },
     ```
     and after `fetchedAt` add (all optional):
     ```json
     "fetchedAt": {
       "type": "datetime"
     },
     "channelId": {
       "type": "string",
       "maxLength": 64
     },
     "thumbnails": {
       "type": "json"
     },
     "viewCount": {
       "type": "biginteger"
     },
     "description": {
       "type": "text"
     },
     "keywords": {
       "type": "json"
     },
     "category": {
       "type": "string",
       "maxLength": 100
     },
     "videoPublishedAt": {
       "type": "string",
       "maxLength": 100,
       "description": "YouTube's display text for the publish date, stored as strapi-plugin-youtube-transcripts stores it. Not a datetime."
     },
     "searchIndex": {
       "type": "json",
       "description": "Model-free BM25 index over rawSegments (makeStoredIndex from services/bm25-core.ts, no contextualizer). Built by fetchAndStore and lazily by readers."
     }
     ```
     Filled by: `channelId`, `thumbnails`, `viewCount`, `description`, `keywords`, `category`, `videoPublishedAt` — M3 (fetcher metadata and the `backfillMetadata` boot job); `searchIndex` — M4. Until then they are `NULL` on every row. Strapi returns `biginteger` values as strings (M3's mapper must not assume a number).
   - `tag/schema.json`:
     ```json
     "name": {
       "type": "string",
       "required": true,
       "unique": true,
       "minLength": 1,
       "maxLength": 40,
       "column": { "unique": true }
     },
     "slug": {
       "type": "uid",
       "targetField": "name",
       "required": true,
       "column": { "unique": true }
     },
     ```
   - `digest/schema.json` — `videoSetKey` gets `"column": { "unique": true }` (type stays `text`, `maxLength` 500).

   What each change does to existing rows, at the first boot on the new schema: the five unique indexes are created over the existing values (fine with 0 duplicates; with any, the boot fails and rolls back, nothing changed); `video_author`, `title`, `author` are retyped `varchar(255)` → `text` keeping every value (SQLite rebuilds `yt_kb_videos` and `yt_kb_transcripts`; their link and component rows must survive — Verify 3 counts them); the eight new columns are `NULL`. None of these schemas is draft-and-publish, so one row per document and the unique indexes hold per row.

3. **`server/src/plugins/yt-kb/server/src/services/db-errors.ts` — new file:**
   ```ts
   import { errors } from '@strapi/utils';

   /** `details.code` on every duplicate error yt-kb raises itself. */
   export const UNIQUE_CODE = 'YT_KB_UNIQUE';

   /** Strapi's entity-validator message for a failed `unique` / `uid` check
    *  (@strapi/core services/entity-validator/validators.js). */
   export const UNIQUE_MESSAGE = 'This attribute must be unique';

   type Loose = {
     code?: unknown;
     details?: { code?: unknown; errors?: Array<{ message?: unknown }> };
   };

   /**
    * True when `err` is a duplicate on a unique key, however it surfaced:
    *  - better-sqlite3 `SqliteError` `SQLITE_CONSTRAINT_UNIQUE` and pg
    *    `DatabaseError` `23505` — Strapi 5.52.1–5.61.0 pass both through
    *    unchanged (the dialects map only NOT NULL);
    *  - mysql2 `ER_DUP_ENTRY` — recognised only so the check is complete;
    *    the plugin supports SQLite and PostgreSQL, not MySQL/MariaDB;
    *  - an error yt-kb raised with `details.code === UNIQUE_CODE`;
    *  - Strapi's validator `ValidationError` "This attribute must be unique".
    */
   export function isUniqueViolation(err: unknown): boolean {
     if (!err || typeof err !== 'object') return false;
     const e = err as Loose;
     if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === '23505' || e.code === 'ER_DUP_ENTRY') return true;
     if (e.details?.code === UNIQUE_CODE) return true;
     return (
       err instanceof errors.ValidationError &&
       Array.isArray(e.details?.errors) &&
       e.details.errors.some((x) => x?.message === UNIQUE_MESSAGE)
     );
   }

   /**
    * Run `work` (normally a whole `strapi.db.transaction`) and, if it fails on
    * a unique key, run it once more. The second pass sees the row the other
    * writer committed. Postgres aborts a transaction on its first error, so
    * this retry — outside the transaction — is the only safe recovery.
    */
   export async function withUniqueRetry<T>(work: () => Promise<T>): Promise<T> {
     try {
       return await work();
     } catch (err) {
       if (!isUniqueViolation(err)) throw err;
       return work();
     }
   }
   ```

4. **`server/src/plugins/yt-kb/server/src/document-rules.ts` — whole file:**
   ```ts
   import type { Core } from '@strapi/strapi';
   import { errors } from '@strapi/utils';
   import { slugifyTagName } from './mcp/tools/tag-utils';
   import { UNIQUE_CODE, UNIQUE_MESSAGE, isUniqueViolation } from './services/db-errors';

   type WithData = { data?: Record<string, unknown> };

   const VIDEO = 'plugin::yt-kb.video';
   const TRANSCRIPT = 'plugin::yt-kb.transcript';
   const TAG = 'plugin::yt-kb.tag';
   const YT_KB_UIDS = new Set<string>([VIDEO, TRANSCRIPT, TAG, 'plugin::yt-kb.note', 'plugin::yt-kb.digest']);
   const WRITE_ACTIONS = new Set<string>(['create', 'update']);

   /** The one tag-name normalization. Every tag lookup and create in the
    *  plugin goes through it: trim, lower-case, collapse inner whitespace. */
   export function normalizeTagName(name: string): string {
     return name.trim().toLowerCase().replace(/\s+/g, ' ');
   }

   /** The first free slug: `base`, else `base-2`, `base-3`, … (M-12: `c++`
    *  and `c#` both slugify to `c`; non-Latin names all become `tag`). */
   export async function freeTagSlug(strapi: Core.Strapi, base: string): Promise<string> {
     const rows = (await strapi.db.query(TAG).findMany({
       where: { slug: { $startsWith: base } },
       select: ['slug'],
     })) as Array<{ slug: string }>;
     const taken = new Set(rows.map((r) => r.slug));
     if (!taken.has(base)) return base;
     let n = 2;
     while (taken.has(`${base}-${n}`)) n += 1;
     return `${base}-${n}`;
   }

   async function applyCreateRules(strapi: Core.Strapi, uid: string, params: WithData) {
     // Video: require youtubeVideoId and return a readable error for a
     // duplicate. The unique index on youtube_video_id is the real gate; this
     // check only names the existing row.
     if (uid === VIDEO) {
       const data = params.data ?? {};
       const videoId = data.youtubeVideoId as string | undefined;
       if (!videoId) throw new errors.ApplicationError('youtubeVideoId is required');
       const existing: any = await strapi
         .documents(VIDEO as never)
         .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } } as never);
       if (existing) {
         throw new errors.ApplicationError(
           `A video for this id already exists. documentId=${existing.documentId}`,
           { code: UNIQUE_CODE, uid: VIDEO, field: 'youtubeVideoId', documentId: existing.documentId },
         );
       }
     }

     // Transcript: same.
     if (uid === TRANSCRIPT) {
       const data = params.data ?? {};
       const videoId = data.youtubeVideoId as string | undefined;
       if (!videoId) throw new errors.ApplicationError('youtubeVideoId is required on transcript');
       const existing: any = await strapi
         .documents(TRANSCRIPT as never)
         .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } } as never);
       if (existing) {
         throw new errors.ApplicationError(
           `A transcript for this id already exists. documentId=${existing.documentId}`,
           { code: UNIQUE_CODE, uid: TRANSCRIPT, field: 'youtubeVideoId', documentId: existing.documentId },
         );
       }
     }

     // Tag: normalize the name, then generate a free slug. `slug` is a
     // required uid and Strapi fills uid fields only in the admin panel, so
     // without this every API-created tag fails 400 "slug must be defined".
     // An explicit slug (the importer, the admin panel) is left alone.
     if (uid === TAG) {
       const data = params.data ?? {};
       if (typeof data.name === 'string') data.name = normalizeTagName(data.name);
       if (!data.slug && typeof data.name === 'string') {
         data.slug = await freeTagSlug(strapi, slugifyTagName(data.name));
       }
       params.data = data;
     }
   }

   /**
    * Document Service rules for this plugin's own types. Each rule checks the
    * UID first, so in a host app they never touch anything but yt-kb data.
    * Registered from register() so they apply to every create path: REST from
    * the app, MCP tools, the admin panel, scripts.
    *
    * Every duplicate on a yt-kb write leaves here in one of two shapes, both
    * a 400 with `details.code === UNIQUE_CODE`:
    *  - yt-kb's own "A … already exists. documentId=…" (the create rules
    *    above), passed through unchanged because it names the row;
    *  - everything else, rethrown as `ValidationError(UNIQUE_MESSAGE)`:
    *    Strapi's validator on one attribute ("This attribute must be
    *    unique") or on several at once (a lost tag race fails `name` and
    *    `slug` → yup's "2 errors occurred", recognised by `details.errors[]`),
    *    and a raw unique-index error from two writes at once, which would
    *    otherwise reach REST as a 500 (see services/db-errors.ts).
    */
   export function registerDocumentRules(strapi: Core.Strapi) {
     strapi.documents.use(async (context, next) => {
       const uid = context.uid as string;
       if (!YT_KB_UIDS.has(uid) || !WRITE_ACTIONS.has(context.action)) return next();

       if (context.action === 'create') await applyCreateRules(strapi, uid, context.params as WithData);

       try {
         return await next();
       } catch (err) {
         const ownDuplicate =
           err instanceof errors.ApplicationError &&
           (err.details as { code?: unknown } | undefined)?.code === UNIQUE_CODE;
         if (!ownDuplicate && isUniqueViolation(err)) {
           throw new errors.ValidationError(UNIQUE_MESSAGE, { code: UNIQUE_CODE });
         }
         throw err;
       }
     });
   }
   ```
   Behaviour changes, all intended: the wrong comment "The schema is unique at the DB level too" (`721f210` line 43) is gone; duplicate errors carry `details.code`; a generated slug that is taken gets `-2`, `-3`, …; a raw database duplicate on a yt-kb type is a 400 `ValidationError` instead of a 500; a validator unique failure on one or more attributes (including the two-attribute "2 errors occurred") is rethrown as `ValidationError("This attribute must be unique", { code: 'YT_KB_UNIQUE' })`, so callers match one message and one code.

5. **`server/src/plugins/yt-kb/server/src/services/tags.ts` — new file** (a helper module, not a Strapi service; do not add it to `services/index.ts`):
   ```ts
   import type { Core } from '@strapi/strapi';
   import { normalizeTagName } from '../document-rules';
   import { isUniqueViolation } from './db-errors';

   const TAG = 'plugin::yt-kb.tag';

   export type TagRow = { documentId: string; name: string; slug: string };

   /**
    * The one tag find-or-create (addVideo, tagVideo). Returns null for a name
    * that is empty after normalization.
    *
    * Outside a transaction, a unique violation means another writer won the
    * race: re-read by name and return that row; if no row has the name (the
    * clash was on the slug), create once more — the slug rule then picks the
    * next free suffix. Inside a transaction the error is rethrown: Postgres
    * has aborted the transaction, so the caller retries it whole
    * (withUniqueRetry).
    */
   export async function findOrCreateTag(strapi: Core.Strapi, rawName: string): Promise<TagRow | null> {
     const name = normalizeTagName(rawName);
     if (!name) return null;

     const find = async () =>
       (await strapi.documents(TAG as never).findFirst({
         filters: { name: { $eq: name } },
         fields: ['name', 'slug'],
       } as never)) as unknown as TagRow | null;

     const existing = await find();
     if (existing) return existing;

     for (let attempt = 1; ; attempt += 1) {
       try {
         return (await strapi.documents(TAG as never).create({ data: { name } } as never)) as unknown as TagRow;
       } catch (err) {
         if (!isUniqueViolation(err) || strapi.db.inTransaction() || attempt === 2) throw err;
         const raced = await find();
         if (raced) return raced;
       }
     }
   }
   ```

6. **`server/src/plugins/yt-kb/server/src/mcp/tools/add-video.ts`:**
   - imports: replace `import { slugifyTagName } from './tag-utils';` with
     ```ts
     import { findOrCreateTag } from '../../services/tags';
     import { isUniqueViolation, withUniqueRetry } from '../../services/db-errors';
     ```
   - replace everything in `execute` from the line `// Resolve tags: create any that don't exist yet` through the end of the `const video = (await strapi.documents('plugin::yt-kb.video').create({ … })) as { documentId: string };` statement (lines 83–114 at `721f210`) with:
     ```ts
         // Tags and the Video are written together or not at all (M-18). The
         // YouTube fetch above stays outside: a slow network call must not
         // hold a transaction open (and on SQLite, the only connection).
         const createVideo = async () =>
           (await strapi.db.transaction(async () => {
             const tagDocumentIds: string[] = [];
             for (const raw of tags ?? []) {
               const tag = await findOrCreateTag(strapi, raw);
               if (tag && !tagDocumentIds.includes(tag.documentId)) tagDocumentIds.push(tag.documentId);
             }
             return strapi.documents('plugin::yt-kb.video').create({
               data: {
                 youtubeVideoId: videoId,
                 url,
                 videoTitle: transcriptRow.title ?? null,
                 videoAuthor: transcriptRow.author ?? null,
                 videoThumbnailUrl: transcriptRow.thumbnailUrl ?? null,
                 caption: caption ?? null,
                 summaryStatus: 'pending',
                 transcript: transcriptRow.documentId,
                 tags: tagDocumentIds,
               } as never,
             });
           })) as { documentId: string };

         let video: { documentId: string };
         try {
           video = await withUniqueRetry(createVideo);
         } catch (err) {
           // Another caller added the same video while this one fetched.
           if (!isUniqueViolation(err)) throw err;
           const raced = (await strapi.documents('plugin::yt-kb.video').findFirst({
             filters: { youtubeVideoId: { $eq: videoId } },
           })) as { documentId: string } | null;
           if (!raced) throw err;
           return {
             videoId,
             action: 'exists',
             videoDocumentId: raced.documentId,
             message: 'Video already in knowledge base.',
           };
         }
     ```
     The pre-check at the top of `execute` and the `return { videoId, action: 'created', … }` block stay as they are.

7. **`server/src/plugins/yt-kb/server/src/mcp/tools/tags.ts`:**
   - imports: replace `import { slugifyTagName } from './tag-utils';` with
     ```ts
     import { normalizeTagName } from '../../document-rules';
     import { findOrCreateTag } from '../../services/tags';
     import { withUniqueRetry } from '../../services/db-errors';
     ```
   - header comment (lines 1–3) becomes: `// Tag tools: list, apply, remove. Names are normalized with normalizeTagName (document-rules.ts) for every lookup, the same as the create rule.`
   - `tagVideoTool.execute` — whole function:
     ```ts
       execute: async ({ videoId, tags }, { strapi }) => {
         const video = await resolveVideo(strapi, videoId);
         if (!video) return { error: `No video found for "${videoId}".` };

         // New tags and the Video's tag list change together (M-18). A unique
         // violation inside rolls the transaction back; withUniqueRetry runs it
         // once more and the second pass finds the other writer's tag.
         const apply = async () =>
           (await strapi.db.transaction(async () => {
             const resolvedIds = new Set<string>((video.tags ?? []).map((t) => t.documentId));
             const added: string[] = [];
             for (const raw of tags) {
               const tag = await findOrCreateTag(strapi, raw);
               if (!tag) continue;
               if (!resolvedIds.has(tag.documentId)) {
                 resolvedIds.add(tag.documentId);
                 added.push(tag.name);
               }
             }
             await strapi.documents('plugin::yt-kb.video').update({
               documentId: video.documentId,
               data: { tags: Array.from(resolvedIds) } as Record<string, unknown>,
             });
             return { videoDocumentId: video.documentId, tagsAdded: added, totalTags: resolvedIds.size };
           })) as { videoDocumentId: string; tagsAdded: string[]; totalTags: number };

         return withUniqueRetry(apply);
       },
     ```
   - `untagVideoTool.execute`: `const drop = new Set(tags.map((t) => t.trim().toLowerCase()));` → `const drop = new Set(tags.map(normalizeTagName));`.

8. **Every other tag lookup in the plugin uses `normalizeTagName`** (add `import { normalizeTagName } from '../../document-rules';` to each file):
   - `mcp/tools/list-videos.ts:35` — `{ name: { $eq: tag.trim().toLowerCase() } }` → `{ name: { $eq: normalizeTagName(tag) } }`;
   - `mcp/tools/search-videos.ts:61` — same replacement;
   - `mcp/tools/aggregate-by-tag.ts:48` — `tags.map((t) => t.trim().toLowerCase()).filter(Boolean)` → `tags.map(normalizeTagName).filter(Boolean)`;
   - `mcp/tools/cross-search-transcripts.ts:51` — `tags.map((t) => t.trim().toLowerCase())` → `tags.map(normalizeTagName)`.
   After the edits, `grep -rn "trim().toLowerCase()" server/src/plugins/yt-kb/server/src/mcp/tools/` must print nothing that touches a tag (the remaining hits, if any, are search text in `query-helpers.ts`, `find-transcripts.ts`, `search-transcript.ts`).

9. **`server/src/plugins/yt-kb/server/src/mcp/tools/tag-utils.ts`** — comment only: line 5 `The Document Service middleware in src/index.ts applies this function` → `The Document Service rule in document-rules.ts applies this function, then freeTagSlug adds -2, -3, … when the slug is taken,`. `slugifyTagName` itself does not change (existing slugs were made by it).

10. **`server/src/plugins/yt-kb/server/src/services/fetcher.ts`** — the race on create only (the rest of the file is M3's). Add `import { isUniqueViolation } from './db-errors';` and replace the last statement pair
    ```ts
        const transcript = await strapi.documents(UID as never).create({
          data: { youtubeVideoId: videoId, ...data } as never,
        });
        return { action: 'created', transcript: transcript as Record<string, any> };
    ```
    with
    ```ts
        try {
          const transcript = await strapi.documents(UID as never).create({
            data: { youtubeVideoId: videoId, ...data } as never,
          });
          return { action: 'created', transcript: transcript as Record<string, any> };
        } catch (err) {
          // Another caller stored the same transcript while this one fetched.
          if (!isUniqueViolation(err)) throw err;
          const raced = (await strapi.documents(UID as never).findFirst({
            filters: { youtubeVideoId: { $eq: videoId } } as never,
          })) as Record<string, any> | null;
          if (!raced) throw err;
          return { action: 'skipped', transcript: raced };
        }
    ```
    M3 rewrites `fetchAndStore` and must keep this branch.

11. **`server/src/plugins/yt-kb/server/src/services/importer.ts`** — one transaction per record. Replace the body of the `try { … }` inside the `for` loop (lines 102–128 at `721f210`) with:
    ```ts
            if (typeof documentId !== 'string' || !documentId) {
              throw new Error('documentId is required');
            }
            const data = toWriteData(model.attributes, record);

            // The write and the date stamp land together or not at all (M-18).
            // The stamp uses the transaction's own knex (`trx`): a plain
            // strapi.db.connection() query would wait for SQLite's single
            // pooled connection, which this transaction holds.
            const created = (await strapi.db.transaction(async ({ trx }) => {
              const existing = await docs.findOne({ documentId } as never);
              if (existing) {
                await docs.update({ documentId, data } as never);
              } else {
                await docs.create({ data: { ...data, documentId } } as never);
              }

              // Set the dates last: any write through the Document Service stamps
              // updatedAt with "now", and validation may drop createdAt. This goes
              // straight to the row, the same way on SQLite and Postgres.
              const createdAt = asDate(record.createdAt);
              const updatedAt = asDate(record.updatedAt);
              const stamps: AnyRecord = {};
              if (createdAt) stamps.created_at = createdAt;
              if (updatedAt) stamps.updated_at = updatedAt;
              if (Object.keys(stamps).length > 0) {
                await trx(model.collectionName).where({ document_id: documentId }).update(stamps);
              }
              return !existing;
            })) as boolean;

            if (created) result.created += 1;
            else result.updated += 1;
    ```
    The `catch` block, the import gate and the status codes are unchanged here (the gate and 207 are M5's).

12. **App — `client/src/lib/services/strapi-client.ts`**: add after the `StrapiMeta` type:
    ```ts
    /** A duplicate on a unique key, as strapi-plugin-yt-kb reports it: a 400
     *  whose message is yt-kb's "… already exists …" (its create rules) or
     *  exactly "This attribute must be unique" — the plugin's Document Service
     *  middleware rethrows every other duplicate (a validator failure on one
     *  attribute or several, e.g. a lost tag race's "2 errors occurred", and a
     *  raw unique-index error) in that one shape. M6 adds a `details.code`
     *  check (strapiFetch carries `details` from M3). */
    export function isUniqueViolation(result: StrapiResult<unknown>): boolean {
      return !result.ok && result.status === 400 && /already exists|must be unique/i.test(result.error);
    }
    ```

13. **App — `client/src/lib/services/videos.ts`:**
    - line 2: `import { strapiFetch, type StrapiQuery } from './strapi-client';` → `import { isUniqueViolation, strapiFetch, type StrapiQuery } from './strapi-client';`
    - `createVideoService` — whole function:
      ```ts
      export async function createVideoService(
        input: CreateVideoServiceInput,
      ): Promise<CreateVideoServiceResult> {
        // Pre-check so the common case returns 'exists' without a failed POST.
        // The unique index decides races; those come back as a 400 and are
        // re-read below.
        const existing = await fetchVideoByVideoIdService(input.videoId);
        if (existing) return { success: false, kind: 'exists', video: existing };

        const tagDocumentIds: string[] = [];
        for (const raw of input.tagNames) {
          const existingTag = await findTagByNameService(raw);
          if (existingTag) {
            tagDocumentIds.push(existingTag.documentId);
            continue;
          }
          const created = await createTagService(raw);
          // A tag that cannot be stored stops the share: dropping it silently
          // was M-12.
          if (!created.ok) {
            return { success: false, kind: 'error', error: `Could not create tag "${raw}": ${created.error}` };
          }
          tagDocumentIds.push(created.tag.documentId);
        }

        const body = {
          data: {
            youtubeVideoId: input.videoId,
            url: input.url,
            caption: input.caption,
            videoTitle: input.videoTitle,
            videoAuthor: input.videoAuthor,
            videoThumbnailUrl: input.videoThumbnailUrl,
            tags: tagDocumentIds,
            summaryStatus: 'pending' as SummaryStatus,
          },
        };

        const result = await strapiFetch<StrapiVideo>('POST', '/api/yt-kb/videos', { body });
        if (!result.ok) {
          if (isUniqueViolation(result)) {
            const raced = await fetchVideoByVideoIdService(input.videoId);
            if (raced) return { success: false, kind: 'exists', video: raced };
          }
          return { success: false, kind: 'error', error: result.error };
        }
        return { success: true, video: result.data };
      }
      ```
    - `createTagService` — whole function:
      ```ts
      async function createTagService(
        name: string,
      ): Promise<{ ok: true; tag: StrapiTag } | { ok: false; error: string }> {
        const result = await strapiFetch<StrapiTag>('POST', '/api/yt-kb/tags', {
          body: { data: { name } },
        });
        if (result.ok) return { ok: true, tag: result.data };
        // Another writer created it first: use theirs.
        if (isUniqueViolation(result)) {
          const raced = await findTagByNameService(name);
          if (raced) return { ok: true, tag: raced };
        }
        return { ok: false, error: result.error };
      }
      ```

14. **App — `client/src/data/server-functions/videos.ts`** (`shareVideo`): delete the race-recovery block that `createVideoService` now owns — the comment `// Race recovery — if the server dedupe check caught …` and the `if (/already exists/i.test(result.error)) { … }` statement (lines 233–240 at `721f210`). The `if (result.kind === 'exists')` branch above it and `return { status: 'error', error: result.error };` below it stay.

15. **App — `client/src/lib/services/digests.ts`:**
    - line 10: `import { strapiFetch, type StrapiQuery } from './strapi-client';` → `import { isUniqueViolation, strapiFetch, type StrapiQuery } from './strapi-client';`
    - `createDigestService`: return type `Promise<ServiceResult<StrapiDigest>>` → `Promise<ServiceResult<StrapiDigest> | { success: false; error: string; duplicate: true }>`, and its last statement becomes:
      ```ts
        if (result.ok) return { success: true, data: result.data };
        if (isUniqueViolation(result)) return { success: false, error: result.error, duplicate: true };
        return { success: false, error: result.error };
      ```
    - add after `findDigestByVideoSetKeyService`:
      ```ts
      export type UpsertDigestInput = {
        videoSetKey: string;
        title: string;
        description?: string | null;
        digest: Digest;
        /** undefined keeps a saved article; null clears it. */
        articleMarkdown?: string | null;
        videoDocumentIds: string[];
        model?: string | null;
      };

      /** Save the digest for a video set: update the row with this
       *  videoSetKey, else create it. A create that loses a race (two saves of
       *  the same set at once) re-reads and updates the winner's row. */
      export async function upsertDigestService(
        input: UpsertDigestInput,
      ): Promise<ServiceResult<{ documentId: string; created: boolean }>> {
        const updateExisting = async (
          row: StrapiDigest,
        ): Promise<ServiceResult<{ documentId: string; created: boolean }>> => {
          const updated = await updateDigestService({
            documentId: row.documentId,
            title: input.title,
            description: input.description,
            digest: input.digest,
            articleMarkdown: input.articleMarkdown !== undefined ? input.articleMarkdown : row.articleMarkdown,
            videoDocumentIds: input.videoDocumentIds,
            model: input.model,
          });
          return updated.success
            ? { success: true, data: { documentId: updated.data.documentId, created: false } }
            : { success: false, error: updated.error };
        };

        const existing = await findDigestByVideoSetKeyService(input.videoSetKey);
        if (!existing.success) return { success: false, error: existing.error };
        if (existing.data) return updateExisting(existing.data);

        const created = await createDigestService({
          title: input.title,
          description: input.description,
          digest: input.digest,
          articleMarkdown: input.articleMarkdown ?? null,
          videoDocumentIds: input.videoDocumentIds,
          videoSetKey: input.videoSetKey,
          model: input.model,
        });
        if (created.success) return { success: true, data: { documentId: created.data.documentId, created: true } };
        if ('duplicate' in created) {
          const raced = await findDigestByVideoSetKeyService(input.videoSetKey);
          if (raced.success && raced.data) return updateExisting(raced.data);
        }
        return { success: false, error: created.error };
      }
      ```

16. **App — `client/src/data/server-functions/digests.ts`:**
    - the import list from `#/lib/services/digests` (lines 3–14): remove `createDigestService` and `updateDigestService`, add `upsertDigestService` (`noUnusedLocals` is on).
    - in `saveDigest`'s handler, replace everything from `const existing = await findDigestByVideoSetKeyService(videoSetKey);` to the end of the handler (lines 73–113 at `721f210`) with:
      ```ts
          const saved = await upsertDigestService({
            videoSetKey,
            title: data.digest.title,
            description: data.digest.description,
            digest: data.digest,
            articleMarkdown: data.articleMarkdown,
            videoDocumentIds: resolved,
            model: OLLAMA_MODEL,
          });
          if (!saved.success) return { status: 'error', error: saved.error };
          return {
            status: 'ok',
            digestDocumentId: saved.data.documentId,
            created: saved.data.created,
          };
      ```
      Behaviour is the same as before for every non-race path: update keeps a saved article when `articleMarkdown` is undefined; create stores `articleMarkdown ?? null`.

17. **Tests — plugin** (all under `server/src/plugins/yt-kb/server/src/`, run by M1's vitest harness):
    - `services/db-errors.test.ts`:
      ```ts
      import { describe, expect, it } from 'vitest';
      import { createRequire } from 'node:module';
      import { join } from 'node:path';
      import { errors } from '@strapi/utils';
      import { UNIQUE_CODE, UNIQUE_MESSAGE, isUniqueViolation, withUniqueRetry } from './db-errors';

      // better-sqlite3 is the host app's driver (server/node_modules).
      const fromServer = createRequire(join(__dirname, '..', '..', '..', '..', '..', '..', 'package.json'));

      function sqliteError(ddl: string, insert: string): unknown {
        const Database = fromServer('better-sqlite3');
        const db = new Database(':memory:');
        db.exec(ddl);
        try {
          db.exec(insert);
          db.exec(insert);
        } catch (e) {
          return e;
        } finally {
          db.close();
        }
        return null;
      }

      describe('isUniqueViolation', () => {
        it('recognises a real better-sqlite3 unique violation', () => {
          const err = sqliteError('CREATE TABLE t (v TEXT); CREATE UNIQUE INDEX t_v_uq ON t (v);', "INSERT INTO t (v) VALUES ('a')");
          expect(isUniqueViolation(err)).toBe(true);
        });
        it('does not treat a NOT NULL failure as one', () => {
          const err = sqliteError('CREATE TABLE n (v TEXT NOT NULL);', 'INSERT INTO n (v) VALUES (NULL)');
          expect(isUniqueViolation(err)).toBe(false);
        });
        it('recognises Postgres 23505 and MySQL ER_DUP_ENTRY', () => {
          expect(isUniqueViolation(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(true);
          expect(isUniqueViolation(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }))).toBe(true);
        });
        it("recognises Strapi's validator error", () => {
          const err = new errors.ValidationError(UNIQUE_MESSAGE, {
            errors: [{ path: ['name'], message: UNIQUE_MESSAGE, name: 'ValidationError' }],
          });
          expect(isUniqueViolation(err)).toBe(true);
        });
        it("recognises yt-kb's own duplicate errors", () => {
          expect(isUniqueViolation(new errors.ApplicationError('A video for this id already exists.', { code: UNIQUE_CODE }))).toBe(true);
        });
        it('rejects everything else', () => {
          expect(isUniqueViolation(new errors.ValidationError('title must be at most 200 characters', { errors: [{ message: 'too long' }] }))).toBe(false);
          expect(isUniqueViolation(new Error('boom'))).toBe(false);
          expect(isUniqueViolation(null)).toBe(false);
          expect(isUniqueViolation('SQLITE_CONSTRAINT_UNIQUE')).toBe(false);
        });
      });

      describe('withUniqueRetry', () => {
        const unique = () => Object.assign(new Error('dup'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
        it('runs the work once more after a unique violation', async () => {
          let calls = 0;
          const out = await withUniqueRetry(async () => {
            calls += 1;
            if (calls === 1) throw unique();
            return 'ok';
          });
          expect([out, calls]).toEqual(['ok', 2]);
        });
        it('does not retry other errors', async () => {
          let calls = 0;
          await expect(withUniqueRetry(async () => { calls += 1; throw new Error('boom'); })).rejects.toThrow('boom');
          expect(calls).toBe(1);
        });
        it('lets a second unique violation through', async () => {
          await expect(withUniqueRetry(async () => { throw unique(); })).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
        });
      });
      ```
    - `document-rules.test.ts`:
      ```ts
      import { describe, expect, it } from 'vitest';
      import type { Core } from '@strapi/strapi';
      import { errors } from '@strapi/utils';
      import { registerDocumentRules } from './document-rules';
      import { UNIQUE_CODE, UNIQUE_MESSAGE } from './services/db-errors';

      type Mw = (ctx: any, next: () => Promise<unknown>) => Promise<unknown>;
      // `data` is a loose record so the rule's additions (`slug`) typecheck
      // under `test:ts:back`, which includes the tests.
      type Ctx = { uid: string; action: string; params: { data: Record<string, unknown> } };
      const unique = () => Object.assign(new Error('UNIQUE constraint failed: yt_kb_videos.youtube_video_id'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });

      function rules({ slugs = [] as string[], existingVideo = null as null | { documentId: string } } = {}) {
        let mw: Mw | undefined;
        let slugQuery: unknown;
        const documents = Object.assign(() => ({ findFirst: async () => existingVideo }), {
          use: (fn: Mw) => { mw = fn; },
        });
        const strapi = {
          documents,
          db: { query: () => ({ findMany: async (q: unknown) => { slugQuery = q; return slugs.map((slug) => ({ slug })); } }) },
        } as unknown as Core.Strapi;
        registerDocumentRules(strapi);
        return { mw: mw as Mw, slugQuery: () => slugQuery };
      }

      describe('tag create rule', () => {
        it('normalizes the name and suffixes a taken slug', async () => {
          const { mw, slugQuery } = rules({ slugs: ['c'] });
          const ctx: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: '  C#  ' } } };
          await mw(ctx, async () => 'ok');
          expect(ctx.params.data).toEqual({ name: 'c#', slug: 'c-2' });
          expect(slugQuery()).toEqual({ where: { slug: { $startsWith: 'c' } }, select: ['slug'] });
        });
        it('takes the next free suffix', async () => {
          const { mw } = rules({ slugs: ['tag', 'tag-2'] });
          const ctx: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: '中文' } } };
          await mw(ctx, async () => 'ok');
          expect(ctx.params.data.slug).toBe('tag-3');
        });
        it('keeps the bare slug when it is free and an explicit slug as given', async () => {
          const { mw } = rules({ slugs: ['c-sharp'] });
          const a: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: 'c' } } };
          const b: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: 'x', slug: 'given' } } };
          await mw(a, async () => 'ok');
          await mw(b, async () => 'ok');
          expect([a.params.data.slug, b.params.data.slug]).toEqual(['c', 'given']);
        });
      });

      describe('duplicates', () => {
        it('rethrows a raw database duplicate on a yt-kb type as the validator 400', async () => {
          const { mw } = rules();
          const err = await mw({ uid: 'plugin::yt-kb.digest', action: 'update', params: {} }, async () => { throw unique(); })
            .catch((e: unknown) => e);
          expect(err).toBeInstanceOf(errors.ValidationError);
          expect(err).toMatchObject({ message: UNIQUE_MESSAGE, details: { code: UNIQUE_CODE } });
        });
        it('rethrows a validator error that fails two unique attributes as one YT_KB_UNIQUE error', async () => {
          // A lost tag race: name and slug are both taken, so yup reports
          // "2 errors occurred" and only details.errors[] says why.
          const { mw } = rules();
          const twoFailures = new errors.ValidationError('2 errors occurred', {
            errors: [
              { path: ['name'], message: UNIQUE_MESSAGE, name: 'ValidationError', value: 'e8 race' },
              { path: ['slug'], message: UNIQUE_MESSAGE, name: 'ValidationError', value: 'e8-race' },
            ],
          });
          const ctx: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: 'e8 race' } } };
          const err = await mw(ctx, async () => { throw twoFailures; }).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(errors.ValidationError);
          expect(err).not.toBe(twoFailures);
          expect(err).toMatchObject({ message: UNIQUE_MESSAGE, details: { code: UNIQUE_CODE } });
        });
        it('leaves other content types alone', async () => {
          const { mw } = rules();
          const raw = unique();
          await expect(mw({ uid: 'api::article.article', action: 'create', params: {} }, async () => { throw raw; })).rejects.toBe(raw);
        });
        it('names the existing video on a duplicate create', async () => {
          const { mw } = rules({ existingVideo: { documentId: 'd1' } });
          const ctx: Ctx = { uid: 'plugin::yt-kb.video', action: 'create', params: { data: { youtubeVideoId: 'abcdefghijk' } } };
          await expect(mw(ctx, async () => 'ok')).rejects.toMatchObject({
            name: 'ApplicationError',
            details: { code: UNIQUE_CODE, documentId: 'd1' },
          });
        });
      });
      ```
    - `services/tags.test.ts`:
      ```ts
      import { describe, expect, it } from 'vitest';
      import type { Core } from '@strapi/strapi';
      import { findOrCreateTag, type TagRow } from './tags';

      const unique = () => Object.assign(new Error('UNIQUE constraint failed: yt_kb_tags.name'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
      const row = (name: string, slug = name): TagRow => ({ documentId: `doc-${slug}`, name, slug });

      function fake(finds: Array<TagRow | null>, creates: Array<TagRow | Error>, inTransaction = false) {
        const created: unknown[] = [];
        const strapi = {
          db: { inTransaction: () => inTransaction },
          documents: () => ({
            findFirst: async () => finds.shift() ?? null,
            create: async (params: unknown) => {
              created.push(params);
              const next = creates.shift();
              if (next instanceof Error) throw next;
              return next;
            },
          }),
        } as unknown as Core.Strapi;
        return { strapi, created };
      }

      describe('findOrCreateTag', () => {
        it('returns an existing tag without creating', async () => {
          const { strapi, created } = fake([row('ai')], []);
          expect(await findOrCreateTag(strapi, ' AI ')).toEqual(row('ai'));
          expect(created).toEqual([]);
        });
        it('creates with the normalized name only (the rule makes the slug)', async () => {
          const { strapi, created } = fake([null], [row('foo bar', 'foo-bar')]);
          await findOrCreateTag(strapi, '  Foo   BAR ');
          expect(created).toEqual([{ data: { name: 'foo bar' } }]);
        });
        it('returns the winner of a name race', async () => {
          const { strapi } = fake([null, row('ai')], [unique()]);
          expect(await findOrCreateTag(strapi, 'ai')).toEqual(row('ai'));
        });
        it('creates once more after a slug race', async () => {
          const { strapi, created } = fake([null, null], [unique(), row('c#', 'c-2')]);
          expect(await findOrCreateTag(strapi, 'c#')).toEqual(row('c#', 'c-2'));
          expect(created).toHaveLength(2);
        });
        it('rethrows inside a transaction so the caller retries it whole', async () => {
          const { strapi } = fake([null], [unique()], true);
          await expect(findOrCreateTag(strapi, 'ai')).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
        });
        it('rethrows other errors and skips empty names', async () => {
          const { strapi } = fake([null], [new Error('boom')]);
          await expect(findOrCreateTag(strapi, 'ai')).rejects.toThrow('boom');
          const empty = fake([], []);
          expect(await findOrCreateTag(empty.strapi, '   ')).toBeNull();
          expect(empty.created).toEqual([]);
        });
      });
      ```
    - `mcp/tools/writes.test.ts` (addVideo and tagVideo: fetch outside, writes inside one transaction, race → `exists`):
      ```ts
      import { describe, expect, it } from 'vitest';
      import type { Core } from '@strapi/strapi';
      import { addVideoTool } from './add-video';
      import { tagVideoTool } from './tags';

      const unique = () => Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });

      function fake(opts: { videoCreate?: () => unknown; videoFinds?: Array<unknown> } = {}) {
        const log: string[] = [];
        let depth = 0;
        const finds = [...(opts.videoFinds ?? [])];
        const strapi = {
          db: {
            inTransaction: () => depth > 0,
            transaction: async (cb: (p: unknown) => Promise<unknown>) => {
              depth += 1;
              log.push('tx:start');
              try { return await cb({}); } finally { depth -= 1; log.push('tx:end'); }
            },
          },
          plugin: () => ({
            service: () => ({
              fetchAndStore: async () => {
                log.push(`fetch:inTx=${depth > 0}`);
                return { action: 'created', transcript: { documentId: 't1', title: 'T', author: 'A', thumbnailUrl: null, rawSegments: [], durationSec: 1 } };
              },
            }),
          }),
          documents: (uid: string) =>
            uid === 'plugin::yt-kb.tag'
              ? {
                  findFirst: async () => null,
                  create: async ({ data }: { data: { name: string } }) => {
                    log.push(`tag:${data.name}:inTx=${depth > 0}`);
                    return { documentId: `tag-${data.name}`, name: data.name, slug: data.name };
                  },
                }
              : {
                  findFirst: async () => { log.push('video:find'); return finds.shift() ?? null; },
                  findOne: async () => null,
                  create: async () => { log.push(`video:create:inTx=${depth > 0}`); return opts.videoCreate ? opts.videoCreate() : { documentId: 'v1' }; },
                  update: async ({ data }: { data: unknown }) => { log.push(`video:update:inTx=${depth > 0}:${JSON.stringify(data)}`); return {}; },
                },
        } as unknown as Core.Strapi;
        return { strapi, log };
      }

      describe('addVideo', () => {
        const args = { url: 'https://www.youtube.com/watch?v=abcdefghijk', tags: ['  AI  '] };

        it('fetches outside the transaction and writes tags + video inside it', async () => {
          const { strapi, log } = fake();
          const out = (await addVideoTool.execute(args, { strapi })) as { action: string };
          expect(out.action).toBe('created');
          expect(log).toEqual(['video:find', 'fetch:inTx=false', 'tx:start', 'tag:ai:inTx=true', 'video:create:inTx=true', 'tx:end']);
        });

        it('returns exists when another caller created the video meanwhile', async () => {
          const { strapi, log } = fake({ videoCreate: () => { throw unique(); }, videoFinds: [null, { documentId: 'v-other' }] });
          const out = await addVideoTool.execute(args, { strapi });
          expect(out).toMatchObject({ action: 'exists', videoDocumentId: 'v-other' });
          expect(log.filter((l) => l === 'tx:start')).toHaveLength(2);
          expect(log.filter((l) => l.startsWith('fetch'))).toHaveLength(1);
        });
      });

      describe('tagVideo', () => {
        it('creates missing tags and updates the video in one transaction', async () => {
          const { strapi, log } = fake({ videoFinds: [{ documentId: 'v1', tags: [{ documentId: 't-old', name: 'old' }] }] });
          const out = await tagVideoTool.execute({ videoId: 'abcdefghijk', tags: ['C++', 'old'] }, { strapi });
          expect(out).toEqual({ videoDocumentId: 'v1', tagsAdded: ['c++', 'old'], totalTags: 3 });
          expect(log.slice(1)).toEqual([
            'tx:start',
            'tag:c++:inTx=true',
            'tag:old:inTx=true',
            'video:update:inTx=true:{"tags":["t-old","tag-c++","tag-old"]}',
            'tx:end',
          ]);
        });
      });
      ```
      (In the `tagVideo` case the fake's tag `findFirst` always returns `null`, so `old` is created as a new row `tag-old`; the test checks the call order and the transaction, not tag reuse — `services/tags.test.ts` covers reuse.)

18. **Tests — app: `client/src/lib/services/unique-recovery.test.ts` — new file** (same HTTP-boundary harness as `videos.test.ts`):
    ```ts
    import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
    import { createVideoService } from './videos';
    import { upsertDigestService } from './digests';
    import type { Digest } from './digest';

    // Duplicate-key races, driven at the Strapi HTTP boundary: the unique
    // index is the real gate, and each service must turn its 400 into the
    // row the other writer stored.
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const strapiError = (status: number, message: string) =>
      json(status, { data: null, error: { status, name: 'ValidationError', message, details: {} } });

    const video = { id: 1, documentId: 'v1', youtubeVideoId: 'abcdefghijk', summaryStatus: 'pending' };
    const base = { videoId: 'abcdefghijk', url: 'https://youtu.be/abcdefghijk' };

    describe('createVideoService', () => {
      it('returns exists when the POST loses a race', async () => {
        fetchMock
          .mockResolvedValueOnce(json(200, { data: [] }))
          .mockResolvedValueOnce(strapiError(400, 'This attribute must be unique'))
          .mockResolvedValueOnce(json(200, { data: [video] }));
        const result = await createVideoService({ ...base, tagNames: [] });
        expect(result).toMatchObject({ success: false, kind: 'exists', video: { documentId: 'v1' } });
      });

      it('uses the tag another writer created', async () => {
        fetchMock
          .mockResolvedValueOnce(json(200, { data: [] }))
          .mockResolvedValueOnce(json(200, { data: [] }))
          .mockResolvedValueOnce(strapiError(400, 'This attribute must be unique'))
          .mockResolvedValueOnce(json(200, { data: [{ id: 2, documentId: 't1', name: 'ai', slug: 'ai' }] }))
          .mockResolvedValueOnce(json(201, { data: video }));
        const result = await createVideoService({ ...base, tagNames: ['AI'] });
        expect(result.success).toBe(true);
        const postBody = JSON.parse(fetchMock.mock.calls[4][1].body as string);
        expect(postBody.data.tags).toEqual(['t1']);
      });

      it('stops with an error when a tag cannot be stored', async () => {
        fetchMock
          .mockResolvedValueOnce(json(200, { data: [] }))
          .mockResolvedValueOnce(json(200, { data: [] }))
          .mockResolvedValueOnce(strapiError(500, 'Internal Server Error'));
        const result = await createVideoService({ ...base, tagNames: ['AI'] });
        expect(result).toMatchObject({ success: false, kind: 'error' });
        expect(result.success === false && result.kind === 'error' && result.error).toContain('Could not create tag "AI"');
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });

      it('does not treat other 400s as a duplicate', async () => {
        fetchMock
          .mockResolvedValueOnce(json(200, { data: [] }))
          .mockResolvedValueOnce(strapiError(400, 'youtubeVideoId must be at most 32 characters'));
        const result = await createVideoService({ ...base, tagNames: [] });
        expect(result).toMatchObject({ success: false, kind: 'error' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
    });

    describe('upsertDigestService', () => {
      const digest = {
        title: 'T', description: 'D', overallTheme: 'O', bottomLine: 'B',
        sharedThemes: [{ title: 'S', body: 'b', videoTitles: [] }],
        uniqueInsights: [], contradictions: [], viewingOrder: [],
      } as unknown as Digest;
      const row = { id: 1, documentId: 'd1', title: 'T', articleMarkdown: null };

      it('updates the winner when the create loses a race', async () => {
        fetchMock
          .mockResolvedValueOnce(json(200, { data: [] }))
          .mockResolvedValueOnce(strapiError(400, 'This attribute must be unique'))
          .mockResolvedValueOnce(json(200, { data: [row] }))
          .mockResolvedValueOnce(json(200, { data: row }));
        const result = await upsertDigestService({ videoSetKey: 'a,b', title: 'T', digest, videoDocumentIds: ['v1', 'v2'] });
        expect(result).toEqual({ success: true, data: { documentId: 'd1', created: false } });
        expect(fetchMock.mock.calls[3][1].method).toBe('PUT');
      });

      it('creates when no row has the key', async () => {
        fetchMock
          .mockResolvedValueOnce(json(200, { data: [] }))
          .mockResolvedValueOnce(json(201, { data: row }));
        const result = await upsertDigestService({ videoSetKey: 'a,b', title: 'T', digest, videoDocumentIds: ['v1', 'v2'] });
        expect(result).toEqual({ success: true, data: { documentId: 'd1', created: true } });
      });
    });
    ```

19. **`server/types/generated/contentTypes.d.ts`** — Strapi rewrites it on the first boot on the new schema (Verify 3). Commit what it writes.

- **Data:** the schema sync in step 2 (indexes, retyped columns, new `NULL` columns), gated by the duplicate check and preceded by the backup in step 1. Tested on a copy of the real data (`server/.tmp/e8-m2.db`, Verify 3). No migration file: nothing moves between fields.
- **Callers updated:**
  - plugin — `document-rules.ts`, `services/db-errors.ts` (new), `services/tags.ts` (new), `services/fetcher.ts`, `services/importer.ts`, `mcp/tools/add-video.ts`, `tags.ts`, `tag-utils.ts`, `list-videos.ts`, `search-videos.ts`, `aggregate-by-tag.ts`, `cross-search-transcripts.ts`;
  - app — `client/src/lib/services/strapi-client.ts`, `videos.ts`, `digests.ts`, `client/src/data/server-functions/videos.ts`, `digests.ts`;
  - unchanged, checked: the site reads `tags.slug` for `/t/<slug>` (`site/src`), and existing slugs do not change (Verify 3's `tagSlugs`); `server/src/plugins/yt-kb/scripts/copy-content.mjs` sends explicit slugs, which the rule leaves alone; `yarn seed` imports `server/seed-data/seed.tar.gz` (untracked) and will now fail on an archive that holds duplicates;
  - docs (M8) — CLAUDE.md's "Tag slugs are generated server-side" gotcha (now: suffixed when taken; races caught by unique indexes), `docs/mcp.md` (addVideo returns `exists` on a race).

#### M2 verify

Run from the repo root, with M1 done. Ports 1341 and 3005 free (as in M1's precondition 1). Steps 6–8 use `T=server/.tmp/e8/tokens.json; K=server/.tmp/e8/e8.mjs` — set both in every shell that runs them.

1. **Facts on 5.61.0** — step 0's commands → the expected output listed there.
2. **Gates:** `yarn --cwd server/src/plugins/yt-kb test:ts:back` → 0; `yarn plugin:build` → 0; `yarn --cwd server/src/plugins/yt-kb verify` → 0; `cd client && npx tsc --noEmit` → 0; `yarn --cwd client build` → 0. Plugin tests, parsed:
   ```bash
   yarn --cwd server/src/plugins/yt-kb vitest run --reporter=json --outputFile="$PWD/server/.tmp/e8/m2-plugin-vitest.json"; node -e 'const r=require("./server/.tmp/e8/m2-plugin-vitest.json");console.log(JSON.stringify({passed:r.numPassedTests,failed:r.numFailedTests}));process.exit(r.numFailedTests===0&&r.numPassedTests===28?0:1)'
   ```
   → `{"passed":28,"failed":0}` (3 guard + 9 db-errors + 7 document-rules + 6 tags + 3 writes; any other count means a file did not run or a test was added without updating this check). Client suite with the same reporter → `failed: 0`, total = M1's total + 6.
3. **Schema sync on a copy of real data:**
   ```bash
   node server/.tmp/e8/e8.mjs backup server/.tmp/data.db server/.tmp/e8-m2.db
   node server/.tmp/e8/e8.mjs dupcheck server/.tmp/e8-m2.db
   node server/.tmp/e8/e8.mjs counts server/.tmp/e8-m2.db > server/.tmp/e8/m2-counts-before.json
   (cd server && DATABASE_FILENAME=.tmp/e8-m2.db yarn -s strapi admin:create-user --email="$(node -p 'require("./.tmp/e8/admin.json").email')" --password="$(node -p 'require("./.tmp/e8/admin.json").password')" --firstname=E8 --lastname=Check)
   (cd server && DATABASE_FILENAME=.tmp/e8-m2.db PORT=1341 HOST=127.0.0.1 nohup yarn develop > .tmp/e8/m2-strapi.log 2>&1 &)
   node server/.tmp/e8/e8.mjs wait http://127.0.0.1:1341/_health 300
   node server/.tmp/e8/e8.mjs counts server/.tmp/e8-m2.db > server/.tmp/e8/m2-counts-after.json
   node -e 'const a=require("./server/.tmp/e8/m2-counts-before.json"),b=require("./server/.tmp/e8/m2-counts-after.json");const r={tables:JSON.stringify(a.tables)===JSON.stringify(b.tables),tagSlugs:JSON.stringify(a.tagSlugs)===JSON.stringify(b.tagSlugs)};console.log(JSON.stringify(r));process.exit(r.tables&&r.tagSlugs?0:1)'
   ```
   → dupcheck `[]`; wait → 204; every table count (rows, link tables, component tables) and every existing tag slug unchanged.
   Indexes and columns:
   ```bash
   node server/.tmp/e8/e8.mjs sql server/.tmp/e8-m2.db "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('yt_kb_videos_youtube_video_id_uq','yt_kb_transcripts_youtube_video_id_uq','yt_kb_tags_name_uq','yt_kb_tags_slug_uq','yt_kb_digests_video_set_key_uq') ORDER BY name" > server/.tmp/e8/m2-idx.json
   node server/.tmp/e8/e8.mjs sql server/.tmp/e8-m2.db "SELECT 'v.'||name AS col, type FROM pragma_table_info('yt_kb_videos') UNION ALL SELECT 't.'||name, type FROM pragma_table_info('yt_kb_transcripts')" > server/.tmp/e8/m2-cols.json
   node -e 'const i=require("./server/.tmp/e8/m2-idx.json").rows.length;const c=Object.fromEntries(require("./server/.tmp/e8/m2-cols.json").rows.map(r=>[r.col,r.type.toLowerCase()]));const text=["v.video_author","t.title","t.author"].every(k=>c[k]==="text");const added=["t.channel_id","t.thumbnails","t.view_count","t.description","t.keywords","t.category","t.video_published_at","t.search_index"].every(k=>k in c);console.log(JSON.stringify({uniqueIndexes:i,retypedToText:text,newColumns:added}));process.exit(i===5&&text&&added?0:1)'
   ```
   → `{"uniqueIndexes":5,"retypedToText":true,"newColumns":true}`.
4. **The database enforces uniqueness on its own** (bypassing Strapi; each write is rolled back):
   ```bash
   for q in \
     "INSERT INTO yt_kb_videos (document_id, youtube_video_id, url) SELECT 'e8rawdup', youtube_video_id, url FROM yt_kb_videos LIMIT 1" \
     "INSERT INTO yt_kb_transcripts (document_id, youtube_video_id) SELECT 'e8rawdup', youtube_video_id FROM yt_kb_transcripts LIMIT 1" \
     "INSERT INTO yt_kb_tags (document_id, name, slug) SELECT 'e8rawdup', name, 'e8-raw-unused-slug' FROM yt_kb_tags LIMIT 1" \
     "INSERT INTO yt_kb_tags (document_id, name, slug) SELECT 'e8rawdup', 'e8 raw unused name', slug FROM yt_kb_tags LIMIT 1" \
     "INSERT INTO yt_kb_digests (document_id, video_set_key, title) SELECT 'e8rawdup', video_set_key, title FROM yt_kb_digests LIMIT 1"; do
     node server/.tmp/e8/e8.mjs trysql server/.tmp/e8-m2.db "$q"; done > server/.tmp/e8/m2-raw.jsonl
   node server/.tmp/e8/e8.mjs trysql server/.tmp/e8-m2.db "INSERT INTO yt_kb_tags (document_id, name, slug) VALUES ('e8rawok', 'e8 raw fresh', 'e8-raw-fresh')" > server/.tmp/e8/m2-raw-ok.json
   node -e 'const fs=require("fs");const codes=fs.readFileSync("server/.tmp/e8/m2-raw.jsonl","utf8").split(/\n(?=\{)/).map(s=>JSON.parse(s).code);const ctl=require("./server/.tmp/e8/m2-raw-ok.json");const ok=codes.length===5&&codes.every(c=>c==="SQLITE_CONSTRAINT_UNIQUE")&&ctl.ok===true;console.log(JSON.stringify({codes,controlOk:ctl.ok}));process.exit(ok?0:1)'
   ```
   → five `SQLITE_CONSTRAINT_UNIQUE` and `controlOk: true` (every write rolled back). The `trysql` output is multi-line JSON, one object per command; the split on a newline followed by `{` separates them.
5. **Tokens:** `node server/.tmp/e8/e8.mjs admin-tokens http://127.0.0.1:1341 server/.tmp/e8/admin.json server/.tmp/e8/tokens.json plugin::yt-kb.read,plugin::yt-kb.write,plugin::yt-kb.maintenance` → `"ok": true`.
6. **Races through REST — exactly one row each:**
   ```bash
   T=server/.tmp/e8/tokens.json; K=server/.tmp/e8/e8.mjs
   node $K race $T 5 /api/yt-kb/videos '{"data":{"youtubeVideoId":"e8RaceTst01","url":"https://www.youtube.com/watch?v=e8RaceTst01","summaryStatus":"pending"}}' > server/.tmp/e8/m2-race-video.json
   node $K race $T 5 /api/yt-kb/transcripts '{"data":{"youtubeVideoId":"e8RaceTst02"}}' > server/.tmp/e8/m2-race-transcript.json
   node $K race $T 5 /api/yt-kb/tags '{"data":{"name":"e8 race"}}' > server/.tmp/e8/m2-race-tag.json
   node $K race $T 5 /api/yt-kb/digests '{"data":{"videoSetKey":"e8a,e8b","title":"E8 race"}}' > server/.tmp/e8/m2-race-digest.json
   node -e 'const out={};let ok=true;for(const k of ["video","transcript","tag","digest"]){const r=require(`./server/.tmp/e8/m2-race-${k}.json`);const good=JSON.stringify(r.statuses)==="[201,400,400,400,400]"&&r.errors.every(m=>m==="This attribute must be unique"||/already exists\. documentId=/.test(m??""));out[k]=good;ok=ok&&good}console.log(JSON.stringify(out));process.exit(ok?0:1)'
   node $K sql server/.tmp/e8-m2.db "SELECT (SELECT COUNT(*) FROM yt_kb_videos WHERE youtube_video_id='e8RaceTst01') AS v, (SELECT COUNT(*) FROM yt_kb_transcripts WHERE youtube_video_id='e8RaceTst02') AS t, (SELECT COUNT(*) FROM yt_kb_tags WHERE name='e8 race') AS g, (SELECT COUNT(*) FROM yt_kb_digests WHERE video_set_key='e8a,e8b') AS d"
   ```
   → all four `true`; the count row is `{"v":1,"t":1,"g":1,"d":1}`. No 500 in any response. Every loser's message is exactly `This attribute must be unique` or yt-kb's `A … already exists. documentId=…` — never `2 errors occurred`: a tag loser usually fails both `name` and `slug`, and step 4's middleware rethrows that as the one message (the shape the app's `isUniqueViolation` matches).
7. **Slugs (M-12):**
   ```bash
   for n in 'E8 C++' 'e8 c#' '日本語' '中文'; do node $K rest $T POST /api/yt-kb/tags "{\"data\":{\"name\":\"$n\"}}"; done > server/.tmp/e8/m2-slugs.jsonl
   node $K rest $T POST /api/yt-kb/tags '{"data":{"name":"  e8   C++ "}}' > server/.tmp/e8/m2-slug-dup.json
   node -e 'const fs=require("fs");const objs=fs.readFileSync("server/.tmp/e8/m2-slugs.jsonl","utf8").split(/\n(?=\{)/).map(s=>JSON.parse(s));const got=objs.map(o=>[o.status,o.body.data?.name,o.body.data?.slug]);const dup=require("./server/.tmp/e8/m2-slug-dup.json");const want=[[201,"e8 c++","e8-c"],[201,"e8 c#","e8-c-2"],[201,"日本語","tag"],[201,"中文","tag-2"]];const ok=JSON.stringify(got)===JSON.stringify(want)&&dup.status===400&&/must be unique|already exists/i.test(dup.body.error.message);console.log(JSON.stringify({got,dupStatus:dup.status}));process.exit(ok?0:1)'
   ```
   → slugs `e8-c`, `e8-c-2`, `tag`, `tag-2`; the spaced/upper-case repeat of `e8 c++` → 400 (normalized to the same name). The `tag` expectation assumes no existing tag slug starts with `tag` (true on 2026-11-08; `counts` lists them).
8. **MCP tagVideo/untagVideo — normalization, suffix, transaction, idempotence:**
   ```bash
   node $K sql server/.tmp/e8-m2.db "SELECT document_id FROM yt_kb_videos WHERE youtube_video_id NOT LIKE 'e8%' ORDER BY id LIMIT 1" > server/.tmp/e8/m2-vid.json
   V=$(node -p 'require("./server/.tmp/e8/m2-vid.json").rows[0].document_id')
   node $K mcp $T tools/call "{\"name\":\"tagVideo\",\"arguments\":{\"videoId\":\"$V\",\"tags\":[\"E8 MCP C++\",\"e8 mcp c#\"]}}" > server/.tmp/e8/m2-tag1.json
   node $K mcp $T tools/call "{\"name\":\"tagVideo\",\"arguments\":{\"videoId\":\"$V\",\"tags\":[\"e8  mcp  c++\"]}}" > server/.tmp/e8/m2-tag2.json
   node $K mcp $T tools/call "{\"name\":\"untagVideo\",\"arguments\":{\"videoId\":\"$V\",\"tags\":[\"  E8 MCP C++ \"]}}" > server/.tmp/e8/m2-untag.json
   node $K sql server/.tmp/e8-m2.db "SELECT name, slug FROM yt_kb_tags WHERE name LIKE 'e8 mcp%' ORDER BY id" > server/.tmp/e8/m2-mcp-tags.json
   node -e 'const a=require("./server/.tmp/e8/m2-tag1.json").structuredContent,b=require("./server/.tmp/e8/m2-tag2.json").structuredContent,u=require("./server/.tmp/e8/m2-untag.json").structuredContent,t=require("./server/.tmp/e8/m2-mcp-tags.json").rows;const ok=JSON.stringify(a.tagsAdded)===JSON.stringify(["e8 mcp c++","e8 mcp c#"])&&b.tagsAdded.length===0&&b.totalTags===a.totalTags&&JSON.stringify(u.removed)===JSON.stringify(["e8 mcp c++"])&&u.remainingTagCount===a.totalTags-1&&JSON.stringify(t)===JSON.stringify([{name:"e8 mcp c++",slug:"e8-mcp-c"},{name:"e8 mcp c#",slug:"e8-mcp-c-2"}]);console.log(JSON.stringify({first:a,second:b,untag:u,tags:t}));process.exit(ok?0:1)'
   ```
   → exits 0. Then the M1 tool-list check (M1 Verify 6) still reports `missing: []`.
9. **Stop the scratch Strapi:** `lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill`.
10. **Not run here, and why:** `addVideo` and `fetchTranscript` call YouTube; their race and transaction paths are covered by `mcp/tools/writes.test.ts` with a stubbed fetcher. `shareVideo` and `saveDigest` call oEmbed / Ollama before the paths M2 changed; those paths are covered at the service level by `unique-recovery.test.ts`, which drives the real `strapiFetch` with the HTTP boundary mocked (Open questions, OQ-2).

- **Done when:** Verify 2–8 exit 0 — in particular five concurrent creates of the same key leave exactly one row for each of video, transcript, tag and digest, every loser gets a 400 (never a 500), and `c++` then `c#` give slugs `…-c` and `…-c-2`.
- **Commit:** `M2: unique keys in the database, text columns, transcript attributes, race-safe writes` — the four schemas, `server/types/generated/contentTypes.d.ts`, the plugin files and tests in steps 3–11 and 17, the app files and test in steps 12–16 and 18.
- **Rollback:** `git revert <M2 commit>` and `yarn plugin:build`. At the next boot, `forceMigration: true` makes Strapi drop the five unique indexes and the eight new transcript columns and retype the three columns back to `varchar(255)`. In M2 the new columns are empty, so nothing is lost on SQLite. On Postgres, the retype back fails if any `title`, `author` or `videoAuthor` value is longer than 255 characters — restore instead. Once M3/M4 have filled the new columns, reverting M2 alone drops that data: restore the backup with Strapi stopped (`cp server/.tmp/data.db.pre-m2-<TS> server/.tmp/data.db`), which loses anything written since it was taken.

### M3 — Fetcher parity and REST routes

- **Why:** B-4 (hardened fetcher, proxy check at boot, extra metadata with the real caption language, REST fetch-or-return route), M-4 plugin side (retry/timeout/backoff in the plugin, machine-readable failure reason, id check and logging on the MCP path, no caller-supplied proxy), G5 (parity with `strapi-plugin-youtube-transcripts` 2.6.2), G7 (proxy configured the same way: plugin setting `proxyUrl`, default `env('PROXY_URL')`).
- **Depends on:** M1 (Strapi 5.61.0, `undici` 6.29.1, plugin vitest harness with `yarn --cwd server/src/plugins/yt-kb test`), M2 (transcript attributes `channelId`, `thumbnails`, `viewCount`, `description`, `keywords`, `category`, `videoPublishedAt`, `searchIndex`; `title`/`author` as `text`; `isUniqueViolation` in `PSRC/services/db-errors.ts`; `findOrCreateTag`).
- **Reference:** `YT` = `/Users/paul/work/plugin-dev/strapi-prod/node_modules/strapi-plugin-youtube-transcripts/dist/server/index.js` (2.6.2, MIT, author "Paul Brats"). Line numbers below are YT's.
- **Pre-check on 5.61.0 (read only in installed 5.52.1 source; STOP and ask if any differs after M1):** plugin admin routes mount at `/<pluginName>` (`@strapi/core/dist/services/server/register-routes.js:76-79`); admin API tokens authenticate admin routes (`@strapi/admin/dist/server/server/src/strategies/admin-token.js`, registered for the `admin` scope in `register.js:15`) and `admin::hasPermissions` reads `ctx.state.userAbility`; a plugin's `config.default` may be a function of `{ env }` (`@strapi/core/dist/loaders/plugins/index.js:101-103`); `GET /_health` answers 204.
- **Search index:** M3 does **not** write `Transcript.searchIndex` and adds no placeholder for it. M4 adds the one `searchIndex:` line to `fetchAndStore` (M4 step 6). Nothing reads `searchIndex` before M4.
- **The admin permission `plugin::yt-kb.tool.fetch-transcript`:** M3 registers this one action itself (step 9), in exactly the shape M5 uses for all 21 per-tool actions. Why: the contract requires every milestone to boot and be verifiable on its own, and an admin token cannot be granted an unregistered action (`assertAdminPermissionsValidity` throws `Unknown admin action`, `@strapi/admin/dist/server/server/src/services/api-token.js:156-169` in 5.52.1). Without the action, M3's admin route would answer 403 to everyone, super admins included, until M5. The uid, section, pluginName, subCategory and displayName are fixed by the contract, so grants made after M3 survive M5. **M5 must keep this entry exactly once**: the admin action provider throws on a duplicate key (`@strapi/utils/dist/provider-factory.js:19-27`, `throwOnDuplicates = true`). M5 must also keep the `FETCH_TRANSCRIPT_ACTION` export (routes import it) or update `PSRC/routes/index.ts` in the same commit.

#### Files

PSRC = `server/src/plugins/yt-kb/server/src`.

1. **`PSRC/services/fetch-errors.ts` — new file.** The error class and its HTTP mapping.

   ```ts
   // Why a transcript fetch failed, in a form callers can branch on. Thrown by
   // services/fetcher.ts `fetchAndStore` (and the youtube-transcript.ts
   // functions it calls); mapped to HTTP by controllers/fetcher.ts.

   export const TRANSCRIPT_FETCH_REASONS = [
     'invalid_id',
     'unavailable',
     'no_captions',
     'blocked',
     'rate_limited',
     'network',
   ] as const;

   export type TranscriptFetchReason = (typeof TRANSCRIPT_FETCH_REASONS)[number];

   /** invalid_id → 400; unavailable/no_captions → 404; blocked/rate_limited/network → 502. */
   export const TRANSCRIPT_FETCH_STATUS: Record<TranscriptFetchReason, 400 | 404 | 502> = {
     invalid_id: 400,
     unavailable: 404,
     no_captions: 404,
     blocked: 502,
     rate_limited: 502,
     network: 502,
   };

   export class TranscriptFetchError extends Error {
     readonly reason: TranscriptFetchReason;

     constructor(reason: TranscriptFetchReason, message: string) {
       super(message);
       this.name = 'TranscriptFetchError';
       this.reason = reason;
     }
   }

   /** The REST answer for a TranscriptFetchError. */
   export function transcriptFetchErrorResponse(err: TranscriptFetchError) {
     const status = TRANSCRIPT_FETCH_STATUS[err.reason];
     return {
       status,
       body: {
         data: null,
         error: { status, name: 'TranscriptFetchError', message: err.message, details: { reason: err.reason } },
       },
     };
   }
   ```

2. **`PSRC/services/youtube-transcript.ts` — replace the whole file** with the port of YT L1-366 (+ the proxy test, YT L1104-1122):

   ```ts
   // YouTube captions and metadata for strapi-plugin-yt-kb: the one place the
   // plugin talks to YouTube. services/fetcher.ts stores what this returns.
   //
   // Ported from strapi-plugin-youtube-transcripts 2.6.2 (dist/server/index.js
   // lines 1-366: metadata extraction, the proxy fetch, the caption XML parsers,
   // the hardened caption download and the English-first track pick; lines
   // 1104-1122: the proxy check), used under the MIT licence:
   //
   //   Copyright (c) Paul Brats
   //
   //   Permission is hereby granted, free of charge, to any person obtaining a
   //   copy of this software and associated documentation files (the
   //   "Software"), to deal in the Software without restriction, including
   //   without limitation the rights to use, copy, modify, merge, publish,
   //   distribute, sublicense, and/or sell copies of the Software, and to
   //   permit persons to whom the Software is furnished to do so, subject to
   //   the following conditions:
   //
   //   The above copyright notice and this permission notice shall be included
   //   in all copies or substantial portions of the Software.
   //
   //   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
   //   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
   //   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
   //   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
   //   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
   //   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
   //   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
   //
   // Changes from the original, on purpose:
   //   - every failure is a TranscriptFetchError with a machine-readable reason
   //     (./fetch-errors.ts), not a message to pattern-match;
   //   - the proxy fetch forwards the caller's AbortSignal, so the 25 s
   //     per-attempt caption timeout also holds through a proxy (the original
   //     dropped the signal);
   //   - the oEmbed fallback goes through the proxy and has a 5 s timeout;
   //   - a metadata-only fetch (no caption download) for the boot backfill;
   //   - log lines go to a logger the caller passes (Strapi's), not console.

   import { Innertube } from 'youtubei.js';
   import { ProxyAgent, fetch as undiciFetch } from 'undici';
   import { TranscriptFetchError } from './fetch-errors';

   export type TranscriptSegment = { text: string; start: number; end: number; duration: number };
   export type Thumbnail = { url: string; width: number; height: number };

   /** What YouTube says about a video, besides its captions. */
   export type VideoMetadata = {
     title: string | null;
     author: string | null;
     channelId: string | null;
     thumbnailUrl: string | null;
     thumbnails: Thumbnail[] | null;
     durationSec: number | null;
     viewCount: number | null;
     description: string | null;
     keywords: string[] | null;
     category: string | null;
     videoPublishedAt: string | null;
     /** Language code of the caption track used (or that would be used). */
     language: string | null;
   };

   export type TranscriptResult = VideoMetadata & {
     videoId: string;
     language: string;
     fullTranscript: string;
     segments: TranscriptSegment[];
   };

   export type FetchLogger = { info: (message: string) => void; debug: (message: string) => void };
   export type FetchOptions = { proxyUrl?: string; logger?: FetchLogger };

   const SILENT: FetchLogger = { info: () => undefined, debug: () => undefined };

   export const TIMEDTEXT_ATTEMPTS = 3;
   export const RETRY_BACKOFF_MS = [1000, 3000];
   export const RATE_LIMIT_BACKOFF_MS = [2000, 6000];
   export const MAX_RETRY_AFTER_MS = 15000;
   export const TIMEDTEXT_TIMEOUT_MS = 25000;
   export const OEMBED_TIMEOUT_MS = 5000;
   export const PROXY_TEST_TIMEOUT_MS = 10000;

   const BROWSER_HEADERS = {
     'Accept-Language': 'en-US,en;q=0.9',
     'User-Agent':
       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
   };

   const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

   /** `http://user:secret@host:8080` → `http://user:****@host:8080`, for logs. */
   export function maskProxyUrl(proxyUrl: string): string {
     return proxyUrl.replace(/:([^@:]+)@/, ':****@');
   }

   // ---------------------------------------------------------------------------
   // Metadata (YT L5-47)
   // ---------------------------------------------------------------------------

   type RawThumbnail = { url?: unknown; width?: unknown; height?: unknown };
   type CaptionTrack = { base_url?: string; language_code?: string; kind?: string };

   /** The parts of a youtubei.js VideoInfo this module reads. */
   type VideoInfoLike = {
     basic_info?: {
       title?: string;
       author?: string;
       channel_id?: string;
       thumbnail?: RawThumbnail[];
       duration?: number;
       view_count?: number;
       short_description?: string;
       keywords?: string[];
       category?: string | null;
     };
     primary_info?: { published?: { text?: string } } | null;
     captions?: { caption_tracks?: CaptionTrack[] } | null;
     playability_status?: { status?: string; reason?: string };
   };

   function allThumbnails(thumbnails: RawThumbnail[] | undefined): Thumbnail[] | null {
     if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
     const usable = thumbnails
       .filter((t) => typeof t?.url === 'string')
       .map((t) => ({
         url: t.url as string,
         width: typeof t.width === 'number' ? t.width : 0,
         height: typeof t.height === 'number' ? t.height : 0,
       }))
       .sort((a, b) => b.width - a.width);
     return usable.length > 0 ? usable : null;
   }

   function bestThumbnail(thumbnails: RawThumbnail[] | undefined): string | null {
     return allThumbnails(thumbnails)?.[0]?.url ?? null;
   }

   function extractMetadata(info: VideoInfoLike, language: string | null): VideoMetadata {
     const b = info?.basic_info ?? {};
     return {
       title: b.title ?? null,
       author: b.author ?? null,
       channelId: b.channel_id ?? null,
       thumbnailUrl: bestThumbnail(b.thumbnail),
       thumbnails: allThumbnails(b.thumbnail),
       durationSec: typeof b.duration === 'number' ? b.duration : null,
       viewCount: typeof b.view_count === 'number' ? b.view_count : null,
       description: b.short_description ?? null,
       keywords: Array.isArray(b.keywords) ? b.keywords : null,
       category: b.category ?? null,
       // Named videoPublishedAt, not publishedAt: Strapi reserves that name for
       // draft-and-publish state. Null when getInfo fell back to getBasicInfo.
       videoPublishedAt: info?.primary_info?.published?.text ?? null,
       language,
     };
   }

   // ---------------------------------------------------------------------------
   // Proxy fetch (YT L48-103), forwarding the AbortSignal
   // ---------------------------------------------------------------------------

   function isRequestLike(input: unknown): input is Request {
     return (
       typeof input === 'object' &&
       input !== null &&
       'url' in input &&
       typeof (input as Request).url === 'string' &&
       'method' in input
     );
   }

   function toHeaderRecord(h: RequestInit['headers']): Record<string, string> {
     if (!h) return {};
     if (h instanceof Headers) return Object.fromEntries(h.entries());
     if (Array.isArray(h)) return Object.fromEntries(h);
     return h as Record<string, string>;
   }

   /** A fetch that sends every request through `proxyUrl`; undefined without one. */
   export function createProxyFetch(proxyUrl?: string, logger: FetchLogger = SILENT): typeof fetch | undefined {
     if (!proxyUrl) return undefined;
     const proxyAgent = new ProxyAgent(proxyUrl);
     const masked = maskProxyUrl(proxyUrl);

     return (async (input: string | URL | Request, init?: RequestInit) => {
       let url: string;
       let method: string;
       let headers: Record<string, string> = {};
       let body: unknown;
       let signal: AbortSignal | undefined = init?.signal ?? undefined;

       if (isRequestLike(input)) {
         url = input.url;
         method = init?.method ?? input.method ?? 'GET';
         input.headers?.forEach?.((value, key) => {
           headers[key] = value;
         });
         if (init?.headers) headers = { ...headers, ...toHeaderRecord(init.headers) };
         if (init?.body !== undefined) {
           body = init.body;
         } else if (method !== 'GET' && method !== 'HEAD' && input.body) {
           try {
             body = await input.clone().text();
           } catch {
             // Body not readable — send none.
           }
         }
         signal = signal ?? input.signal ?? undefined;
       } else {
         url = input instanceof URL ? input.toString() : input;
         method = init?.method ?? 'GET';
         headers = toHeaderRecord(init?.headers);
         body = init?.body;
       }

       logger.debug(`proxy ${method} ${new URL(url).pathname} via ${masked}`);
       const response = await undiciFetch(url, {
         method,
         headers,
         dispatcher: proxyAgent,
         ...(body && method !== 'GET' && method !== 'HEAD' ? { body: body as never } : {}),
         ...(signal ? { signal: signal as never } : {}),
       });
       if (!response.ok) logger.debug(`proxy response ${response.status} ${response.statusText}`);
       return response as unknown as Response;
     }) as typeof fetch;
   }

   // ---------------------------------------------------------------------------
   // Caption XML (YT L104-160): `<p t d>` (ms) and `<text start dur>` (s)
   // ---------------------------------------------------------------------------

   function decodeHtmlEntities(text: string): string {
     return text
       .replace(/&#39;/g, "'")
       .replace(/&quot;/g, '"')
       .replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&nbsp;/g, ' ')
       .replace(/&apos;/g, "'")
       .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
       .replace(/<[^>]+>/g, '')
       .trim();
   }

   function parsePTagFormat(xml: string): TranscriptSegment[] {
     const segments: TranscriptSegment[] = [];
     const re = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
     let match: RegExpExecArray | null;
     while ((match = re.exec(xml)) !== null) {
       const [, startMs, durMs, rawText] = match;
       if (!startMs || !durMs || !rawText) continue;
       const text = decodeHtmlEntities(rawText);
       if (!text) continue;
       const start = parseInt(startMs, 10);
       const duration = parseInt(durMs, 10);
       segments.push({ text, start, end: start + duration, duration });
     }
     return segments;
   }

   function parseTextTagFormat(xml: string): TranscriptSegment[] {
     const segments: TranscriptSegment[] = [];
     const re = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
     let match: RegExpExecArray | null;
     while ((match = re.exec(xml)) !== null) {
       const [, startS, durS, rawText] = match;
       if (!startS || !rawText) continue;
       const text = decodeHtmlEntities(rawText);
       if (!text) continue;
       const start = Math.round(parseFloat(startS) * 1000);
       const duration = Math.round(parseFloat(durS || '0') * 1000);
       segments.push({ text, start, end: start + duration, duration });
     }
     return segments;
   }

   export function parseTimedTextXml(xml: string): TranscriptSegment[] {
     const p = parsePTagFormat(xml);
     return p.length > 0 ? p : parseTextTagFormat(xml);
   }

   // ---------------------------------------------------------------------------
   // Hardened caption download (YT L161-246)
   // ---------------------------------------------------------------------------

   class TimedTextError extends Error {
     readonly status: number;
     readonly retryAfterMs?: number;

     constructor(message: string, status: number, retryAfterMs?: number) {
       super(message);
       this.name = 'TimedTextError';
       this.status = status;
       this.retryAfterMs = retryAfterMs;
     }
   }

   function isRateLimited(error: unknown): error is TimedTextError {
     return error instanceof TimedTextError && (error.status === 429 || error.status === 403);
   }

   /** Retry-After in ms (seconds or an HTTP date), capped at 15 s; undefined when absent or past. */
   export function parseRetryAfter(value: string | null | undefined): number | undefined {
     if (!value) return undefined;
     const seconds = Number(value);
     const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
     if (!Number.isFinite(ms) || ms <= 0) return undefined;
     return Math.min(ms, MAX_RETRY_AFTER_MS);
   }

   const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

   async function fetchTimedTextOnce(captionUrl: string, proxyFetch?: typeof fetch): Promise<string> {
     const fetchFn = proxyFetch ?? fetch;
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(), TIMEDTEXT_TIMEOUT_MS);
     try {
       const response = await fetchFn(captionUrl, { signal: controller.signal, headers: BROWSER_HEADERS });
       if (!response.ok) {
         throw new TimedTextError(
           `Failed to fetch timedtext: ${response.status}`,
           response.status,
           parseRetryAfter(response.headers?.get?.('retry-after')),
         );
       }
       const xml = await response.text();
       if (!xml) throw new Error('Empty timedtext response');
       return xml;
     } finally {
       clearTimeout(timer);
     }
   }

   type CaptionSource = { url: string; fetch?: typeof fetch };

   async function fetchTimedTextXml(
     first: CaptionSource,
     options: { viaProxy: boolean; logger: FetchLogger; refresh?: () => Promise<CaptionSource> },
   ): Promise<string> {
     let source = first;
     let lastError: unknown;
     for (let attempt = 1; attempt <= TIMEDTEXT_ATTEMPTS; attempt += 1) {
       try {
         return await fetchTimedTextOnce(source.url, source.fetch);
       } catch (error) {
         lastError = error;
         if (attempt === TIMEDTEXT_ATTEMPTS) break;
         const limited = isRateLimited(error);
         const backoff = (limited ? RATE_LIMIT_BACKOFF_MS : RETRY_BACKOFF_MS)[attempt - 1] ?? 6000;
         const wait = isRateLimited(error) ? Math.max(backoff, error.retryAfterMs ?? 0) : backoff;
         options.logger.info(
           `caption fetch attempt ${attempt}/${TIMEDTEXT_ATTEMPTS} failed (${errorMessage(error)}); retrying in ${wait}ms${
             limited && options.refresh ? ' with a fresh session' : ''
           }`,
         );
         await sleep(wait);
         if (limited && options.refresh) {
           try {
             source = await options.refresh();
           } catch (refreshError) {
             options.logger.info(`could not start a fresh session: ${errorMessage(refreshError)}`);
           }
         }
       }
     }
     if (isRateLimited(lastError)) {
       throw new TranscriptFetchError(
         'rate_limited',
         `YouTube is rate limiting caption downloads from this server (HTTP ${lastError.status}), ${TIMEDTEXT_ATTEMPTS} attempts. This is about the server's IP address, not the video. ` +
           (options.viaProxy
             ? 'The configured proxy is being limited too: use a rotating residential proxy, or try again later.'
             : 'Set PROXY_URL (the yt-kb plugin setting proxyUrl) to a residential proxy, or try again later.'),
       );
     }
     throw new TranscriptFetchError(
       'network',
       `Caption download failed after ${TIMEDTEXT_ATTEMPTS} attempts. Last error: ${errorMessage(lastError)}`,
     );
   }

   // ---------------------------------------------------------------------------
   // Session, video info and track pick (YT L19-28, 247-306)
   // ---------------------------------------------------------------------------

   function createClient(proxyFetch?: typeof fetch) {
     return Innertube.create({
       generate_session_locally: true,
       lang: 'en',
       location: 'US',
       retrieve_player: true, // required to get caption tracks
       fetch: proxyFetch,
     });
   }

   type InnertubeClient = Awaited<ReturnType<typeof createClient>>;

   /** An Innertube failure that is not about captions, classified. */
   function classifyYouTubeError(err: unknown): TranscriptFetchError {
     if (err instanceof TranscriptFetchError) return err;
     const message = errorMessage(err);
     if (/unavailable|private|does not exist|not found/i.test(message)) {
       return new TranscriptFetchError('unavailable', `Video is unavailable: ${message}`);
     }
     if (/sign in|log in|login|bot/i.test(message)) {
       return new TranscriptFetchError('blocked', `YouTube refused the request (the IP is likely blocked): ${message}`);
     }
     return new TranscriptFetchError('network', `Could not reach YouTube: ${message}`);
   }

   async function openClient(proxyFetch?: typeof fetch): Promise<InnertubeClient> {
     try {
       return await createClient(proxyFetch);
     } catch (err) {
       throw classifyYouTubeError(err);
     }
   }

   /** getInfo (has the publish date), falling back to getBasicInfo (YT L19-28). */
   async function fetchVideoInfo(client: InnertubeClient, videoId: string, logger: FetchLogger): Promise<VideoInfoLike> {
     try {
       return (await client.getInfo(videoId)) as unknown as VideoInfoLike;
     } catch (err) {
       logger.info(`getInfo failed for ${videoId}, falling back to getBasicInfo (publish date will be null): ${errorMessage(err)}`);
       try {
         return (await client.getBasicInfo(videoId)) as unknown as VideoInfoLike;
       } catch (basicErr) {
         throw classifyYouTubeError(basicErr);
       }
     }
   }

   /** Human English, else any English, else the first track (YT L300-302). */
   function pickTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
     return (
       tracks.find((t) => t.language_code === 'en' && t.kind !== 'asr') ??
       tracks.find((t) => t.language_code?.startsWith('en')) ??
       tracks[0]
     );
   }

   /** Why a video has no caption tracks (YT L271-299). */
   function noCaptionsError(info: VideoInfoLike, viaProxy: boolean): TranscriptFetchError {
     const status = info.playability_status?.status;
     const reason = info.playability_status?.reason;
     if ((reason && /sign in/i.test(reason)) || status === 'LOGIN_REQUIRED') {
       return new TranscriptFetchError(
         'blocked',
         "YouTube requires sign-in, which usually means this server's IP is blocked. " +
           (viaProxy
             ? 'The configured proxy is blocked too: use a rotating residential proxy.'
             : 'Set PROXY_URL (the yt-kb plugin setting proxyUrl) to a residential proxy.'),
       );
     }
     if (status === 'ERROR' || status === 'UNPLAYABLE') {
       return new TranscriptFetchError(
         'unavailable',
         `Video is not playable (status: ${status}). ${reason ?? 'The video may be private, deleted, or unavailable in your region.'}`,
       );
     }
     return new TranscriptFetchError('no_captions', `No captions available for this video. Playability: ${status ?? 'unknown'}.`);
   }

   // ---------------------------------------------------------------------------
   // Public API
   // ---------------------------------------------------------------------------

   /** Captions plus metadata. Throws TranscriptFetchError. */
   export async function fetchYouTubeTranscript(videoId: string, options: FetchOptions = {}): Promise<TranscriptResult> {
     const logger = options.logger ?? SILENT;
     const viaProxy = Boolean(options.proxyUrl);
     logger.info(
       viaProxy ? `fetching ${videoId} via proxy ${maskProxyUrl(options.proxyUrl as string)}` : `fetching ${videoId} without proxy`,
     );

     const proxyFetch = createProxyFetch(options.proxyUrl, logger);
     const client = await openClient(proxyFetch);
     const info = await fetchVideoInfo(client, videoId, logger);
     const tracks = info.captions?.caption_tracks ?? [];
     logger.info(`${videoId}: playability ${info.playability_status?.status ?? 'unknown'}, ${tracks.length} caption track(s)`);
     if (tracks.length === 0) throw noCaptionsError(info, viaProxy);

     const track = pickTrack(tracks);
     if (!track?.base_url) throw new TranscriptFetchError('no_captions', 'No valid caption track URL found');
     logger.info(
       `${videoId}: tracks ${tracks.map((t) => `${t.language_code}${t.kind === 'asr' ? ' (auto)' : ''}`).join(', ')}; using ${track.language_code}`,
     );

     const xml = await fetchTimedTextXml(
       { url: track.base_url, fetch: proxyFetch },
       {
         viaProxy,
         logger,
         // A new proxy agent opens a new connection, and a new session gets a
         // newly signed caption URL. getBasicInfo is enough: only the tracks
         // are needed.
         refresh: async () => {
           const freshFetch = createProxyFetch(options.proxyUrl, logger);
           const fresh = (await (await createClient(freshFetch)).getBasicInfo(videoId)) as unknown as VideoInfoLike;
           const freshTracks = fresh.captions?.caption_tracks ?? [];
           const match =
             freshTracks.find((t) => t.language_code === track.language_code && t.kind === track.kind) ??
             freshTracks.find((t) => t.language_code === track.language_code);
           if (!match?.base_url) throw new Error('fresh session returned no matching caption track');
           return { url: match.base_url, fetch: freshFetch };
         },
       },
     );

     const segments = parseTimedTextXml(xml);
     if (segments.length === 0) {
       throw new TranscriptFetchError('no_captions', 'The caption track had no transcript segments.');
     }
     logger.info(`${videoId}: ${segments.length} segments`);

     // The language of the track actually used, so a stored transcript says which one it is.
     const language = track.language_code || 'und';
     return {
       videoId,
       fullTranscript: segments.map((s) => s.text).join(' '),
       segments,
       ...extractMetadata(info, language),
       language,
     };
   }

   /** Metadata only — no caption download. For the boot backfill. Throws TranscriptFetchError. */
   export async function fetchYouTubeMetadata(videoId: string, options: FetchOptions = {}): Promise<VideoMetadata> {
     const logger = options.logger ?? SILENT;
     const client = await openClient(createProxyFetch(options.proxyUrl, logger));
     const info = await fetchVideoInfo(client, videoId, logger);
     return extractMetadata(info, pickTrack(info.captions?.caption_tracks ?? [])?.language_code ?? null);
   }

   /** oEmbed title/author/thumbnail, a fallback when Innertube omits them. Through the proxy, 5 s timeout. Never throws. */
   export async function fetchOEmbedMeta(
     videoId: string,
     options: { proxyUrl?: string } = {},
   ): Promise<{ title?: string; author?: string; thumbnailUrl?: string }> {
     try {
       const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
       const fetchFn = createProxyFetch(options.proxyUrl) ?? fetch;
       const res = await fetchFn(url, { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });
       if (!res.ok) return {};
       const json = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
       return { title: json.title, author: json.author_name, thumbnailUrl: json.thumbnail_url };
     } catch {
       return {};
     }
   }

   /** Boot check: the outbound IP seen through the proxy (YT L1104-1122). Never throws. */
   export async function testProxyConnection(
     proxyUrl: string,
   ): Promise<{ success: true; ip: string } | { success: false; error: string }> {
     try {
       const response = await undiciFetch('https://httpbin.org/ip', {
         dispatcher: new ProxyAgent(proxyUrl),
         signal: AbortSignal.timeout(PROXY_TEST_TIMEOUT_MS) as never,
       });
       if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
       const data = (await response.json()) as { origin?: string };
       return { success: true, ip: String(data.origin ?? 'unknown') };
     } catch (error) {
       return { success: false, error: errorMessage(error) };
     }
   }
   ```

   The old export `fetchYouTubeMeta` is gone (renamed `fetchOEmbedMeta`); its only importer is `PSRC/services/fetcher.ts` (replaced below).

3. **`PSRC/services/fetcher.ts` — replace the whole file:**

   ```ts
   import type { Core } from '@strapi/strapi';
   import { errors } from '@strapi/utils';
   import { isUniqueViolation } from './db-errors';
   import { TranscriptFetchError } from './fetch-errors';
   import {
     fetchOEmbedMeta,
     fetchYouTubeTranscript,
     type FetchLogger,
     type VideoMetadata,
   } from './youtube-transcript';

   // The one place yt-kb fetches a transcript from YouTube and stores it. Used by
   // POST /api/yt-kb/transcripts/fetch and GET .../yt-transcript/:videoId
   // (controllers/fetcher.ts) and by the fetchTranscript and addVideo MCP tools.
   // The proxy is the plugin setting `proxyUrl` (default env PROXY_URL), read
   // here and nowhere else; no caller can pass one.

   /** An 11-character YouTube video id. */
   export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

   const ID = '([A-Za-z0-9_-]{11})';
   // YT L439-451.
   const URL_PATTERNS = [
     new RegExp(`youtube\\.com/watch\\?(?:.*&)?v=${ID}`), // also m. and music. subdomains
     new RegExp(`youtu\\.be/${ID}`),
     new RegExp(`youtube\\.com/shorts/${ID}`),
     new RegExp(`youtube\\.com/embed/${ID}`),
     new RegExp(`youtube\\.com/live/${ID}`),
   ];

   /** The id itself, or the id inside a watch / youtu.be / shorts / embed / live URL; null otherwise. */
   export function extractYouTubeId(input: unknown): string | null {
     if (typeof input !== 'string') return null;
     const trimmed = input.trim();
     if (YOUTUBE_VIDEO_ID.test(trimmed)) return trimmed;
     for (const pattern of URL_PATTERNS) {
       const match = trimmed.match(pattern);
       if (match) return match[1];
     }
     return null;
   }

   const clip = (value: string | null | undefined, max: number): string | null =>
     typeof value === 'string' ? value.slice(0, max) : null;

   /** The stored metadata fields of a fetch, clipped to the schema's limits (M2). */
   export function transcriptMetadataData(meta: VideoMetadata) {
     return {
       author: clip(meta.author, 200),
       channelId: clip(meta.channelId, 64),
       thumbnailUrl: clip(meta.thumbnailUrl, 2000),
       thumbnails: meta.thumbnails,
       durationSec: meta.durationSec,
       viewCount: meta.viewCount,
       description: meta.description,
       keywords: meta.keywords,
       category: clip(meta.category, 100),
       videoPublishedAt: clip(meta.videoPublishedAt, 100),
       language: clip(meta.language, 10),
     };
   }

   export type FetchAction = 'created' | 'updated' | 'skipped';
   export type FetchOptions = {
     /** Re-fetch and overwrite a transcript that is already stored. */
     force?: boolean;
   };
   export type FetchResult = { action: FetchAction; transcript: Record<string, any> };

   const UID = 'plugin::yt-kb.transcript';

   export default ({ strapi }: { strapi: Core.Strapi }) => {
     const logger: FetchLogger = {
       info: (message) => strapi.log.info(`[yt-kb] ${message}`),
       debug: (message) => strapi.log.debug(`[yt-kb] ${message}`),
     };

     const findStored = async (videoId: string) =>
       (await strapi.documents(UID as never).findFirst({
         filters: { youtubeVideoId: { $eq: videoId } } as never,
       })) as Record<string, any> | null;

     // The single log line for a failed fetch, whichever path asked
     // (REST, MCP, ai-tools). Callers must not log it again. The fields go
     // in the message too: Strapi's default console format prints only the
     // message (@strapi/logger pretty-print), the meta object is for JSON
     // log transports.
     const fail = (videoId: string, err: unknown): never => {
       const error =
         err instanceof TranscriptFetchError
           ? err
           : new TranscriptFetchError('network', err instanceof Error ? err.message : String(err));
       const id = videoId.slice(0, 100);
       strapi.log.warn(`[yt-kb] transcript fetch failed: ${id} (${error.reason}): ${error.message}`, {
         videoId: id,
         reason: error.reason,
         message: error.message,
       });
       throw error;
     };

     return {
       /** Stored transcript (`skipped`) unless `force`; else fetch from YouTube and create or update it.
        *  Throws TranscriptFetchError for every fetch failure; database errors are rethrown as they are. */
       async fetchAndStore(videoId: string, options: FetchOptions = {}): Promise<FetchResult> {
         if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID.test(videoId)) {
           fail(
             String(videoId ?? ''),
             new TranscriptFetchError(
               'invalid_id',
               'videoId must be an 11-character YouTube video id, or a YouTube watch, youtu.be, shorts, embed or live URL',
             ),
           );
         }

         const existing = await findStored(videoId);
         if (existing && !options.force) return { action: 'skipped', transcript: existing };

         const proxyUrl = (strapi.plugin('yt-kb').config('proxyUrl') as string | undefined) || undefined;
         const [result, oembed] = await Promise.all([
           fetchYouTubeTranscript(videoId, { proxyUrl, logger }),
           fetchOEmbedMeta(videoId, { proxyUrl }),
         ]).catch((err) => fail(videoId, err));

         const rawSegments = result.segments.map((s) => ({ text: s.text, startMs: s.start, endMs: s.end }));
         const meta = transcriptMetadataData(result);
         const data = {
           ...meta,
           title: clip(result.title ?? oembed.title, 300),
           author: meta.author ?? clip(oembed.author, 200),
           thumbnailUrl: meta.thumbnailUrl ?? clip(oembed.thumbnailUrl, 2000),
           rawSegments,
           rawText: result.fullTranscript,
           fetchedAt: new Date().toISOString(),
         };

         if (existing) {
           const transcript = await strapi.documents(UID as never).update({
             documentId: existing.documentId,
             data: data as never,
           });
           return { action: 'updated', transcript: transcript as Record<string, any> };
         }

         try {
           const transcript = await strapi.documents(UID as never).create({
             data: { youtubeVideoId: videoId, ...data } as never,
           });
           return { action: 'created', transcript: transcript as Record<string, any> };
         } catch (err) {
           // Two fetches of the same id raced and the other stored it first —
           // the database's unique index (M2) or the Document Service rule
           // (document-rules.ts) refused ours. The stored row wins.
           if (isUniqueViolation(err) || err instanceof errors.ApplicationError) {
             const winner = await findStored(videoId);
             if (winner) return { action: 'skipped', transcript: winner };
           }
           throw err;
         }
       },
     };
   };
   ```

   This replaces the file M2 step 10 edited; M2's unique-violation branch is kept above (`action: 'skipped'` with the stored row), now also catching the Document Service rule's `ApplicationError`.

4. **`PSRC/services/metadata-backfill.ts` — new file** (YT L367-438 semantics, metadata only):

   ```ts
   import type { Core } from '@strapi/strapi';
   import { transcriptMetadataData, YOUTUBE_VIDEO_ID } from './fetcher';
   import { fetchYouTubeMetadata } from './youtube-transcript';

   // Fills the metadata on transcripts stored before M3: M2's new fields and the
   // real caption language (every row before M3 says 'en'). Same semantics as
   // strapi-plugin-youtube-transcripts' backfill (YT L367-438): at most `limit`
   // rows, a pause after each YouTube call, one failure never stops the run.
   // Differences: metadata only — no caption download; rawSegments, rawText and
   // fetchedAt are left alone — and only non-null values are written, so a field
   // YouTube omits keeps what it had. Started from bootstrap.ts when the plugin
   // config has `backfillMetadata: true`.

   const UID = 'plugin::yt-kb.transcript';

   export const BACKFILL_FIELDS = [
     'channelId',
     'thumbnails',
     'viewCount',
     'description',
     'keywords',
     'category',
     'videoPublishedAt',
   ] as const;

   export type BackfillResult = {
     scanned: number;
     updated: number;
     skipped: number;
     failed: Array<{ videoId: string; reason: string }>;
   };

   export function needsMetadataBackfill(row: Record<string, unknown>): boolean {
     const missing = (field: string) => row[field] === null || row[field] === undefined;
     return BACKFILL_FIELDS.every(missing) || missing('thumbnails');
   }

   const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

   export async function backfillTranscriptMetadata(
     strapi: Core.Strapi,
     options: { proxyUrl?: string; limit?: number; pauseMs?: number } = {},
   ): Promise<BackfillResult> {
     const result: BackfillResult = { scanned: 0, updated: 0, skipped: 0, failed: [] };
     const rows = (await strapi.documents(UID as never).findMany({
       limit: options.limit ?? 500,
       sort: 'createdAt:asc',
       fields: ['youtubeVideoId', ...BACKFILL_FIELDS],
     } as never)) as Array<Record<string, any>>;
     result.scanned = rows.length;

     for (const row of rows) {
       if (!needsMetadataBackfill(row)) {
         result.skipped += 1;
         continue;
       }
       const videoId = String(row.youtubeVideoId ?? '');
       if (!YOUTUBE_VIDEO_ID.test(videoId)) {
         result.failed.push({ videoId: videoId || '(missing)', reason: 'row has no valid youtubeVideoId' });
         continue;
       }
       try {
         const meta = await fetchYouTubeMetadata(videoId, { proxyUrl: options.proxyUrl });
         const data = Object.fromEntries(
           Object.entries(transcriptMetadataData(meta)).filter(([, v]) => v !== null && v !== undefined),
         );
         if (Object.keys(data).length === 0) throw new Error('YouTube returned no metadata');
         await strapi.documents(UID as never).update({ documentId: row.documentId, data: data as never });
         result.updated += 1;
         strapi.log.info(`[yt-kb] backfilled metadata for ${videoId}`);
       } catch (error) {
         const reason = (error instanceof Error ? error.message : String(error)).slice(0, 120);
         result.failed.push({ videoId, reason });
         strapi.log.warn(`[yt-kb] metadata backfill failed for ${videoId}: ${reason}`, { videoId, reason });
       }
       await sleep(options.pauseMs ?? 1500);
     }

     strapi.log.info(
       `[yt-kb] metadata backfill complete: ${result.updated} updated, ${result.skipped} already had metadata, ${result.failed.length} failed`,
     );
     return result;
   }
   ```

5. **`PSRC/bootstrap.ts` — new file**, wired as the plugin's `bootstrap` in step 6. M5 later adds one import and makes `await seedPermissions(strapi);` (legacy permission migration, Users & Permissions cleanup) the first statement of this function — the only change M5 makes here.

   ```ts
   import type { Core } from '@strapi/strapi';
   import { backfillTranscriptMetadata } from './services/metadata-backfill';
   import { maskProxyUrl, testProxyConnection } from './services/youtube-transcript';

   // Plugin bootstrap. The proxy check and the optional metadata backfill work as
   // in strapi-plugin-youtube-transcripts (YT L1123-1153); neither blocks boot.
   export default async ({ strapi }: { strapi: Core.Strapi }) => {
     const plugin = strapi.plugin('yt-kb');
     const proxyUrl = (plugin.config('proxyUrl') as string | undefined) || '';

     if (proxyUrl) {
       const masked = maskProxyUrl(proxyUrl);
       strapi.log.info(`[yt-kb] Proxy configured: ${masked}`);
       void testProxyConnection(proxyUrl).then((result) => {
         if (result.success) {
           strapi.log.info(`[yt-kb] Proxy connection successful - Outbound IP: ${result.ip}`);
         } else {
           strapi.log.error(`[yt-kb] Proxy connection FAILED (${masked}): ${result.error}`);
           strapi.log.error('[yt-kb] YouTube requests will likely fail. Check the proxy credentials and URL.');
         }
       });
     } else {
       strapi.log.warn(
         '[yt-kb] No proxy configured; YouTube may block datacenter IPs. Set PROXY_URL, or proxyUrl in the yt-kb plugin config (config/plugins.ts).',
       );
     }

     if (plugin.config('backfillMetadata') === true) {
       strapi.log.info('[yt-kb] backfillMetadata is on: refetching metadata for stored transcripts in the background');
       void backfillTranscriptMetadata(strapi, { proxyUrl: proxyUrl || undefined }).catch((error) => {
         const message = error instanceof Error ? error.message : String(error);
         strapi.log.warn(`[yt-kb] metadata backfill did not complete: ${message}`, { message });
       });
     }
   };
   ```

6. **`PSRC/index.ts` — replace the whole file.** The four config keys are the contract's; `import` is read by M5's import gate (nothing reads it in M3).

   ```ts
   import register from './register';
   import bootstrap from './bootstrap';
   import contentTypes from './content-types';
   import controllers from './controllers';
   import services from './services';
   import routes from './routes';

   type PluginConfig = { mcp?: unknown; proxyUrl?: unknown; import?: unknown; backfillMetadata?: unknown };
   const BOOLEAN_KEYS = ['mcp', 'import', 'backfillMetadata'] as const;

   export default {
     register,
     bootstrap,
     destroy() {},
     config: {
       // A function, so Strapi calls it with its env helper after .env is loaded
       // (core loaders/plugins/index.js). A value set in the host's
       // config/plugins.ts still wins over these defaults.
       default: ({ env }: { env: (key: string, fallback?: string) => string }) => ({
         // Register the MCP tools.
         mcp: true,
         // Proxy for every YouTube request; same shape as strapi-plugin-youtube-transcripts.
         proxyUrl: env('PROXY_URL', ''),
         // POST /api/yt-kb/import/:type is refused unless true (M5).
         import: false,
         // Refetch missing metadata for stored transcripts at boot (talks to YouTube once per row).
         backfillMetadata: false,
       }),
       validator(config: PluginConfig) {
         for (const key of BOOLEAN_KEYS) {
           if (config[key] !== undefined && typeof config[key] !== 'boolean') {
             throw new Error(`yt-kb: \`${key}\` must be a boolean`);
           }
         }
         if (config.proxyUrl !== undefined && typeof config.proxyUrl !== 'string') {
           throw new Error('yt-kb: `proxyUrl` must be a string');
         }
       },
     },
     contentTypes,
     controllers,
     services,
     routes,
   };
   ```

   `server/config/plugins.ts` is unchanged (it sets only `mcp: true`; `proxyUrl` comes from the default).

7. **`PSRC/controllers/fetcher.ts` — replace the whole file:**

   ```ts
   import type { Core } from '@strapi/strapi';
   import { extractYouTubeId } from '../services/fetcher';
   import { TranscriptFetchError, transcriptFetchErrorResponse } from '../services/fetch-errors';

   // POST /api/yt-kb/transcripts/fetch  { data: { videoId, force? } }   scope plugin::yt-kb.fetcher.fetchTranscript
   //   → 200 { data, meta: { action: created | updated | skipped } }
   // GET  /api/yt-kb/yt-transcript/:videoId (content API)                scope plugin::yt-kb.fetcher.getOrFetch
   // GET  /yt-kb/yt-transcript/:videoId     (admin, plugin::yt-kb.tool.fetch-transcript)
   //   → 200 { data } when stored (no YouTube call), else fetch + store → 200 { data, meta: { action: 'created' } }
   // A TranscriptFetchError answers with services/fetch-errors.ts's status and body.
   // fetchAndStore already logged it; this file does not log.
   const TRANSCRIPT_UID = 'plugin::yt-kb.transcript';

   export default ({ strapi }: { strapi: Core.Strapi }) => {
     const fetcher = () => strapi.plugin('yt-kb').service('fetcher');

     const sendTranscript = async (ctx: any, transcript: Record<string, unknown>, meta?: Record<string, unknown>) => {
       const schema = strapi.getModel(TRANSCRIPT_UID as never);
       ctx.body = {
         data: await strapi.contentAPI.sanitize.output(transcript, schema, { auth: ctx.state.auth }),
         ...(meta ? { meta } : {}),
       };
     };

     // TranscriptFetchError → mapped status and body; anything else goes to Strapi's error middleware.
     const sendFetchError = (ctx: any, err: unknown) => {
       if (!(err instanceof TranscriptFetchError)) throw err;
       const { status, body } = transcriptFetchErrorResponse(err);
       ctx.status = status;
       ctx.body = body;
     };

     return {
       async fetchTranscript(ctx: any) {
         const { videoId, force } = ctx.request.body?.data ?? {};
         if (force !== undefined && typeof force !== 'boolean') {
           return ctx.badRequest('data.force must be true or false');
         }
         try {
           const result = await fetcher().fetchAndStore(typeof videoId === 'string' ? videoId : '', {
             force: force === true,
           });
           await sendTranscript(ctx, result.transcript, { action: result.action });
         } catch (err) {
           sendFetchError(ctx, err);
         }
       },

       async getOrFetch(ctx: any) {
         const raw = String(ctx.params?.videoId ?? '');
         // An unparseable value is passed through so fetchAndStore rejects (and logs) it as invalid_id.
         const videoId = extractYouTubeId(raw) ?? raw;
         try {
           const result = await fetcher().fetchAndStore(videoId, { force: false });
           await sendTranscript(
             ctx,
             result.transcript,
             result.action === 'skipped' ? undefined : { action: result.action },
           );
         } catch (err) {
           sendFetchError(ctx, err);
         }
       },
     };
   };
   ```

8. **`PSRC/routes/index.ts` — edit.**
   - Add at the top: `import { FETCH_TRANSCRIPT_ACTION } from '../mcp-official/permissions';`
   - In the `'content-api'` routes array, after the `/transcripts/fetch` entry, add:

     ```ts
           // Stored transcript, or fetch and store it — same path as
           // strapi-plugin-youtube-transcripts. Accepts an id or a YouTube URL.
           { method: 'GET' as const, path: '/yt-transcript/:videoId', handler: 'fetcher.getOrFetch' },
     ```

   - Add a second router after the `'content-api'` key:

     ```ts
       // Admin API, served at /yt-kb/yt-transcript/:videoId: an admin session or an
       // admin API token holding the "Fetch transcript" permission.
       admin: {
         type: 'admin' as const,
         routes: [
           {
             method: 'GET' as const,
             path: '/yt-transcript/:videoId',
             handler: 'fetcher.getOrFetch',
             config: {
               policies: [{ name: 'admin::hasPermissions', config: { actions: [FETCH_TRANSCRIPT_ACTION] } }],
             },
           },
         ],
       },
     ```

   Admin routes of a plugin are mounted at `/<pluginName>` (`@strapi/core/dist/services/server/register-routes.js:76-79` in 5.52.1).

9. **`PSRC/mcp-official/permissions.ts` — edit.**
   - After `MCP_ACTIONS`, add:

     ```ts
     /** Gates GET /yt-kb/yt-transcript/:videoId (admin route) — the action
      *  youtube-transcripts uses for its route, and the per-tool action M5 gives
      *  the fetchTranscript tool. Registered here ahead of M5 so the route works
      *  now; M5 keeps this uid (it must not register it a second time). */
     export const FETCH_TRANSCRIPT_ACTION = 'plugin::yt-kb.tool.fetch-transcript';
     ```

   - Append to `ACTION_DEFS`:

     ```ts
       {
         section: 'plugins',
         pluginName: 'yt-kb',
         subCategory: 'AI tools',
         displayName: 'Fetch transcript',
         uid: 'tool.fetch-transcript',
       },
     ```

   The `[yt-kb] registered N MCP admin permission(s)` log line now says 4. The guard M1 moved to `PSRC/mcp-official/permissions.guard.test.ts` still passes: it checks `uid: 'read' | 'write' | 'maintenance'` and the call order in `mcp-official/index.ts`, which do not change.

10. **`PSRC/mcp/tools/fetch-transcript.ts` — replace the whole file:**

    ```ts
    // Fetch a transcript from YouTube and store it (services/fetcher.ts, the
    // same fetch-and-store the REST routes use). A stored transcript is returned
    // as "skipped" unless force=true, which re-fetches and overwrites it. The
    // proxy is the plugin setting proxyUrl; a caller cannot choose one.
    //
    // Does NOT run any LLM.

    import { z } from '@strapi/utils';
    import type { ToolDef } from '../registry';
    import { YOUTUBE_VIDEO_ID } from '../../services/fetcher';
    import { TranscriptFetchError } from '../../services/fetch-errors';

    const schema = z.object({
      videoId: z
        .string()
        .regex(YOUTUBE_VIDEO_ID, 'videoId must be an 11-character YouTube video id')
        .describe('YouTube video id: the 11 characters after ?v= or youtu.be/.'),
      force: z
        .boolean()
        .default(false)
        .describe('If a transcript already exists, re-fetch from YouTube and overwrite. Default false.'),
    });

    export const fetchTranscriptTool: ToolDef<z.infer<typeof schema>> = {
      name: 'fetchTranscript',
      description:
        'WRITE OPERATION — fetch a YouTube transcript via youtubei.js and upsert the stored Transcript row. Acts as "regenerate" when force=true. DO NOT call this to "read" or "get" a transcript the user already has in the KB — use `getTranscript` instead. Only call `fetchTranscript` when the user explicitly asks to "fetch", "refresh", "re-fetch", or "regenerate" the transcript for a known videoId, OR when `getTranscript` reports no transcript stored. Idempotent only when force=false; force=true overwrites. On failure returns { error, reason } where reason is one of invalid_id, unavailable, no_captions, blocked, rate_limited, network.',
      schema,
      execute: async ({ videoId, force }, { strapi }) => {
        let fetched: { action: 'created' | 'updated' | 'skipped'; transcript: Record<string, any> };
        try {
          fetched = await strapi.plugin('yt-kb').service('fetcher').fetchAndStore(videoId, { force });
        } catch (err) {
          // Already logged by fetchAndStore. A result, not a throw, so the agent can act on the reason.
          if (err instanceof TranscriptFetchError) return { videoId, error: err.message, reason: err.reason };
          throw err;
        }
        const { action, transcript } = fetched;

        if (action === 'skipped') {
          return {
            videoId,
            action,
            message: 'Transcript already exists. Set force=true to re-fetch from YouTube.',
            transcriptDocumentId: transcript.documentId,
          };
        }
        return {
          videoId,
          action,
          transcriptDocumentId: transcript.documentId,
          language: transcript.language ?? null,
          segmentCount: transcript.rawSegments?.length ?? 0,
          durationSec: transcript.durationSec,
          characters: transcript.rawText?.length ?? 0,
        };
      },
    };
    ```

11. **`PSRC/mcp/tools/add-video.ts` — edit** (M2 has already restructured this file around `findOrCreateTag` and a transaction; anchor on names, not line numbers):
    - Delete the local `function extractVideoId(url: string): string | null { … }`.
    - Add imports: `import { extractYouTubeId } from '../../services/fetcher';` and `import { TranscriptFetchError } from '../../services/fetch-errors';`.
    - Replace `const videoId = extractVideoId(url);` with `const videoId = extractYouTubeId(url);` (now also accepts embed and live URLs, and only ids that pass `YOUTUBE_VIDEO_ID`).
    - Replace the `fetchAndStore(videoId)` call (outside the transaction since M2) with:

      ```ts
          let transcriptRow: Record<string, any>;
          try {
            ({ transcript: transcriptRow } = await strapi.plugin('yt-kb').service('fetcher').fetchAndStore(videoId));
          } catch (err) {
            // Already logged by fetchAndStore. No Video row is created.
            if (err instanceof TranscriptFetchError) return { videoId, error: err.message, reason: err.reason };
            throw err;
          }
      ```

      keeping the variable name the rest of the function uses (`transcriptRow`, as at 721f210 and in M2 step 6).

12. **Plugin tests — new files** (vitest, M1 harness; `yarn --cwd server/src/plugins/yt-kb test`). No test touches the network: `youtubei.js` is replaced with `vi.mock`, the caption and oEmbed requests with `vi.stubGlobal('fetch', …)`, `undici` with `vi.mock` where the proxy test runs.

    **12a. `PSRC/services/fetcher.test.ts`** — drives `fetchAndStore` end to end with a fake Strapi:

    ```ts
    import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

    const yt = vi.hoisted(() => ({
      create: vi.fn(),
      client: { getInfo: vi.fn(), getBasicInfo: vi.fn() },
    }));
    vi.mock('youtubei.js', () => ({ Innertube: { create: yt.create } }));

    import fetcherService from './fetcher';
    import { TranscriptFetchError } from './fetch-errors';

    const ID = 'dQw4w9WgXcQ';
    const CAPTION_URL = `https://www.youtube.com/api/timedtext?v=${ID}&lang=de`;
    const XML = '<timedtext><body><p t="0" d="1500">Hallo Welt</p><p t="1500" d="2000">zweite Zeile</p></body></timedtext>';

    const germanInfo = {
      basic_info: {
        title: 'Ein Video',
        author: 'Kanal',
        channel_id: 'UC_fixture',
        thumbnail: [
          { url: 'https://i.ytimg.com/a.jpg', width: 120, height: 90 },
          { url: 'https://i.ytimg.com/b.jpg', width: 1280, height: 720 },
        ],
        duration: 61,
        view_count: 12345,
        short_description: 'Beschreibung',
        keywords: ['eins', 'zwei'],
        category: 'Education',
      },
      primary_info: { published: { text: 'Nov 1, 2026' } },
      captions: { caption_tracks: [{ base_url: CAPTION_URL, language_code: 'de', kind: 'asr' }] },
      playability_status: { status: 'OK' },
    };

    function fakeStrapi(stored: Record<string, unknown> | null = null) {
      const transcripts = {
        findFirst: vi.fn(async () => stored),
        create: vi.fn(async ({ data }: any) => ({ documentId: 'doc-new', ...data })),
        update: vi.fn(async ({ documentId, data }: any) => ({ documentId, ...data })),
      };
      const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
      const strapi = {
        documents: vi.fn(() => transcripts),
        plugin: vi.fn(() => ({ config: (key: string) => (key === 'proxyUrl' ? '' : undefined) })),
        log,
      };
      return { service: fetcherService({ strapi: strapi as never }), transcripts, log };
    }

    const fetchMock = vi.fn();
    const captionCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/timedtext')).length;
    let captionResponses: Array<() => Response>;

    beforeEach(() => {
      yt.create.mockReset().mockResolvedValue(yt.client);
      yt.client.getInfo.mockReset().mockResolvedValue(germanInfo);
      yt.client.getBasicInfo.mockReset().mockResolvedValue(germanInfo);
      captionResponses = [() => new Response(XML, { status: 200 })];
      fetchMock.mockReset().mockImplementation(async (url: string) => {
        if (String(url).includes('/oembed')) {
          return new Response(JSON.stringify({ title: 'oEmbed title', author_name: 'oEmbed author' }), { status: 200 });
        }
        const next = captionResponses.length > 1 ? captionResponses.shift()! : captionResponses[0];
        return next();
      });
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });
    ```

    Cases (each an `it`):

    | Case | Set-up | Expect |
    |---|---|---|
    | success with metadata and a non-English track | defaults | resolves `{ action: 'created' }`; `transcripts.create` called once with `data` containing exactly these values: `youtubeVideoId: ID`, `title: 'Ein Video'`, `author: 'Kanal'`, `channelId: 'UC_fixture'`, `thumbnailUrl: 'https://i.ytimg.com/b.jpg'`, `thumbnails` = the two thumbnails widest first, `durationSec: 61`, `viewCount: 12345`, `description: 'Beschreibung'`, `keywords: ['eins','zwei']`, `category: 'Education'`, `videoPublishedAt: 'Nov 1, 2026'`, `language: 'de'`, `rawSegments: [{ text: 'Hallo Welt', startMs: 0, endMs: 1500 }, { text: 'zweite Zeile', startMs: 1500, endMs: 3500 }]`, `rawText: 'Hallo Welt zweite Zeile'`, and a `fetchedAt` string; `log.warn` not called |
    | stored, not forced | `fakeStrapi({ documentId: 'd1', youtubeVideoId: ID })` | `{ action: 'skipped' }`; `yt.create` and `fetchMock` not called |
    | 429 then success, Retry-After honoured | `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`; `captionResponses = [() => new Response('', { status: 429, headers: { 'retry-after': '5' } }), () => new Response(XML, { status: 200 })]` | start `const p = service.fetchAndStore(ID)`; `await vi.advanceTimersByTimeAsync(4999)` → `captionCalls() === 1`; then `await vi.runAllTimersAsync()`; `await p` resolves `created`; `captionCalls() === 2`; `yt.create` called 2 times (fresh session); a `log.info` call contains `retrying in 5000ms with a fresh session` |
    | rate limited on every attempt | fake timers; all caption responses 429 without Retry-After | `await Promise.all([expect(p).rejects.toMatchObject({ reason: 'rate_limited' }), vi.runAllTimersAsync()])`; `captionCalls() === 3`; a `log.info` call contains `retrying in 2000ms` and one contains `retrying in 6000ms`; `log.warn` called once, with `(expect.stringMatching(/^\[yt-kb\] transcript fetch failed: dQw4w9WgXcQ \(rate_limited\): /), expect.objectContaining({ videoId: ID, reason: 'rate_limited' }))`; `create` not called |
    | sign-in wall | `getInfo` resolves `{ basic_info: { title: 't' }, captions: undefined, playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }` | rejects `TranscriptFetchError` with `reason: 'blocked'`; `log.warn` called exactly once, with `(expect.stringMatching(/^\[yt-kb\] transcript fetch failed: /), expect.objectContaining({ videoId: ID, reason: 'blocked' }))`; `captionCalls() === 0`; `create` not called |
    | no tracks | `getInfo` resolves `{ ...germanInfo, captions: { caption_tracks: [] } }` | rejects with `reason: 'no_captions'` |
    | getInfo fails, getBasicInfo works | `getInfo` rejects `new Error('boom')`; `getBasicInfo` resolves `{ ...germanInfo, primary_info: null }` | `created`; `create` data has `videoPublishedAt: null` and `language: 'de'` |
    | YouTube unreachable | `yt.create.mockRejectedValue(new TypeError('fetch failed'))` | rejects with `reason: 'network'` |
    | invalid id | `service.fetchAndStore('not-an-id')` | rejects with `reason: 'invalid_id'`; `transcripts.findFirst` and `yt.create` not called; `log.warn` called once |
    | create race | `create.mockRejectedValueOnce(new (await import('@strapi/utils')).errors.ApplicationError('A transcript for this id already exists.'))`; `findFirst` returns `null` on the first call and `{ documentId: 'winner' }` on the second | resolves `{ action: 'skipped', transcript: { documentId: 'winner' } }` |
    | the proxy URL is masked | `maskProxyUrl('http://user:secret@proxy.test:8080')` (import from `./youtube-transcript`) | `'http://user:****@proxy.test:8080'` |

    **12b. `PSRC/controllers/fetcher.test.ts`** — fake `ctx` `{ params, request: { body }, state: { auth: undefined }, status: 200, body: undefined, badRequest: vi.fn(function (this: any, m) { this.status = 400; this.body = { error: { message: m } }; }) }` and a fake Strapi whose `plugin().service('fetcher').fetchAndStore` is a `vi.fn`, `getModel` returns `{}`, `contentAPI.sanitize.output` is `vi.fn(async (d) => d)`:

    | Case | Expect |
    |---|---|
    | `fetchAndStore` throws `new TranscriptFetchError(r, 'm')` for each of the six reasons, via `getOrFetch` | `ctx.status` = 400 / 404 / 404 / 502 / 502 / 502 for invalid_id / unavailable / no_captions / blocked / rate_limited / network; `ctx.body` deep-equals `{ data: null, error: { status, name: 'TranscriptFetchError', message: 'm', details: { reason: r } } }` |
    | `getOrFetch` with `params.videoId = 'https://youtu.be/dQw4w9WgXcQ?si=x'` and `fetchAndStore` resolving `{ action: 'skipped', transcript: { documentId: 'd' } }` | `fetchAndStore` called with `('dQw4w9WgXcQ', { force: false })`; `ctx.body` deep-equals `{ data: { documentId: 'd' } }` (no `meta`) |
    | `getOrFetch` resolving `{ action: 'created', … }` | `ctx.body.meta` deep-equals `{ action: 'created' }` |
    | `getOrFetch` with `params.videoId = 'nonsense'` | `fetchAndStore` called with `('nonsense', { force: false })` |
    | `fetchTranscript` with `body.data = { videoId: 'dQw4w9WgXcQ', force: 'yes' }` | `badRequest` called; `fetchAndStore` not called |
    | `fetchTranscript` resolving `{ action: 'updated', … }` with `force: true` | `fetchAndStore` called with `('dQw4w9WgXcQ', { force: true })`; `ctx.body.meta.action === 'updated'` |
    | `fetchAndStore` throws `new Error('db down')` | the handler rejects with that error (rethrown) |

    **12c. `PSRC/bootstrap.test.ts`** — `vi.mock('undici', () => ({ ProxyAgent: vi.fn(), fetch: vi.fn(async () => ({ ok: true, json: async () => ({ origin: '203.0.113.7' }) })) }))` and `vi.mock('./services/metadata-backfill', () => ({ backfillTranscriptMetadata: vi.fn(async () => ({ scanned: 0, updated: 0, skipped: 0, failed: [] })) }))`; fake Strapi `{ plugin: () => ({ config: (k) => cfg[k] }), log: { info, warn, error, debug } }`:

    | Case | Expect |
    |---|---|
    | `cfg = { proxyUrl: 'http://user:secret@proxy.test:8080' }` | after `await bootstrap({ strapi })` and `await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Outbound IP: 203.0.113.7')))`: `log.info` was called with `'[yt-kb] Proxy configured: http://user:****@proxy.test:8080'`; no argument of any `log.*` call contains `secret`; `log.warn` not called |
    | `cfg = { proxyUrl: '' }` | `log.warn` called once with a string starting `'[yt-kb] No proxy configured; YouTube may block datacenter IPs'`; the mocked undici `fetch` not called |
    | `cfg = { proxyUrl: '', backfillMetadata: true }` | `backfillTranscriptMetadata` called once with `(strapi, { proxyUrl: undefined })` |
    | `cfg = { proxyUrl: '' }` (backfill unset) | `backfillTranscriptMetadata` not called |

    **12d. `PSRC/services/metadata-backfill.test.ts`** — `vi.mock('./youtube-transcript', async (orig) => ({ ...(await orig()), fetchYouTubeMetadata: vi.fn() }))`; fake `documents().findMany` returning `[{ documentId: 'a', youtubeVideoId: 'AAAAAAAAAAA', thumbnails: null }, { documentId: 'b', youtubeVideoId: 'BBBBBBBBBBB', thumbnails: [{ url: 'u', width: 1, height: 1 }], channelId: 'x' }, { documentId: 'c', youtubeVideoId: 'CCCCCCCCCCC', thumbnails: null }]`; `fetchYouTubeMetadata` resolves (for `AAAAAAAAAAA`) `{ title: 'T', author: 'A', channelId: 'UC1', thumbnailUrl: 'https://i/t.jpg', thumbnails: [{ url: 'https://i/t.jpg', width: 1, height: 1 }], durationSec: 10, viewCount: 5, description: null, keywords: null, category: 'Music', videoPublishedAt: null, language: 'fr' }` and rejects `new TranscriptFetchError('blocked', 'nope')` for `CCCCCCCCCCC`; call with `{ pauseMs: 0 }`:
    - result deep-equals `{ scanned: 3, updated: 1, skipped: 1, failed: [{ videoId: 'CCCCCCCCCCC', reason: 'nope' }] }`;
    - `update` called once, with `{ documentId: 'a', data }` where `data` has exactly the keys `author, channelId, thumbnailUrl, thumbnails, durationSec, viewCount, category, language` (no null-valued key, no `title`, no `rawSegments`, no `fetchedAt`) and `language: 'fr'`;
    - `findMany` called with `limit: 500`.

    **12e. `PSRC/mcp/tools/fetch-transcript.test.ts`:**
    - `fetchTranscriptTool.schema.safeParse({ videoId: 'short' }).success === false`;
    - `fetchTranscriptTool.schema.parse({ videoId: 'dQw4w9WgXcQ', proxyUrl: 'http://evil.test' })` has no `proxyUrl` key;
    - `execute({ videoId: 'dQw4w9WgXcQ', force: false }, { strapi })` with `fetchAndStore` rejecting `new TranscriptFetchError('no_captions', 'none')` resolves `{ videoId: 'dQw4w9WgXcQ', error: 'none', reason: 'no_captions' }`;
    - `fetchAndStore` rejecting `new Error('db')` → `execute` rejects.

13. **`client/src/lib/services/strapi-client.ts` — edit** (carry Strapi's `error.details`):
    - `StrapiResult<T>` failure branch becomes `| { ok: false; status: number; error: string; details?: Record<string, unknown> };`
    - In `strapiFetch`, replace the `if (!res.ok) { … }` block with:

      ```ts
        if (!res.ok) {
          // Read the body once for both error parsing and logging — calling
          // res.text()/json() twice would throw on a consumed body.
          const raw = await res.text().catch(() => '');
          let error = `Strapi error ${res.status}`;
          let details: Record<string, unknown> | undefined;
          try {
            const parsed = JSON.parse(raw) as { error?: { message?: string; details?: unknown } };
            if (parsed.error?.message) error = parsed.error.message;
            const d = parsed.error?.details;
            if (d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length > 0) {
              details = d as Record<string, unknown>;
            }
          } catch {
            /* not JSON */
          }
          logFailure(method, url, res.status, raw);
          return details ? { ok: false, status: res.status, error, details } : { ok: false, status: res.status, error };
        }
      ```

      `details` is present only when non-empty, so the existing `toEqual` assertions in `strapi-client.test.ts` (Strapi's `ValidationError` carries `details: {}`) keep passing.

14. **`client/src/lib/services/videos.ts` — edit `requestTranscriptFetchService`.** Replace the doc comment, the type `TranscriptFetchAction` line stays, and replace the function with:

    ```ts
    /** Why strapi-plugin-yt-kb could not fetch a transcript (its TranscriptFetchError reasons). */
    export type TranscriptFetchReason =
      | 'invalid_id'
      | 'unavailable'
      | 'no_captions'
      | 'blocked'
      | 'rate_limited'
      | 'network';

    const TRANSCRIPT_FETCH_REASONS: ReadonlySet<string> = new Set<TranscriptFetchReason>([
      'invalid_id',
      'unavailable',
      'no_captions',
      'blocked',
      'rate_limited',
      'network',
    ]);

    /** Ask Strapi to fetch a transcript from YouTube and store it.
     *
     *  The app never talks to YouTube itself: strapi-plugin-yt-kb does the fetch
     *  (POST /api/yt-kb/transcripts/fetch), stores the row, and returns it. A
     *  stored transcript comes back as `skipped` unless `force` is set, which
     *  re-fetches and replaces it. One fetcher and one proxy setting (the
     *  plugin's `proxyUrl`, default PROXY_URL), shared with the MCP tools.
     *
     *  On failure, `status` is the HTTP status (0 = Strapi unreachable) and
     *  `reason` the plugin's TranscriptFetchError reason, or null when the
     *  failure was not one (auth, Strapi down, unexpected 500). */
    export async function requestTranscriptFetchService(
      videoId: string,
      { force }: { force: boolean },
    ): Promise<
      | { success: true; action: TranscriptFetchAction; transcript: StrapiTranscript }
      | { success: false; error: string; status: number; reason: TranscriptFetchReason | null }
    > {
      const result = await strapiFetch<StrapiTranscript>('POST', '/api/yt-kb/transcripts/fetch', {
        body: { data: { videoId, force } },
      });
      if (result.ok && result.data) {
        const action = (result.meta as { action?: TranscriptFetchAction } | undefined)?.action;
        return { success: true, action: action ?? 'created', transcript: result.data };
      }
      if (result.ok) {
        return { success: false, error: 'Transcript fetch returned no row', status: 200, reason: null };
      }
      const raw = result.details?.reason;
      const reason =
        typeof raw === 'string' && TRANSCRIPT_FETCH_REASONS.has(raw) ? (raw as TranscriptFetchReason) : null;
      // A reasoned failure is the plugin saying what YouTube did (no captions,
      // bot wall, rate limit); its message says which, so pass it through
      // rather than the generic "Backend error".
      return {
        success: false,
        error: reason ? result.error : friendlyBackendError(result.status, result.error),
        status: result.status,
        reason,
      };
    }
    ```

15. **`client/src/lib/services/learning.ts` — edit `fetchTranscriptThroughStrapi`** (lines 104-147 at 721f210):
    - Add `type TranscriptFetchReason,` to the `import { … } from '#/lib/services/videos'` list.
    - Above `fetchTranscriptThroughStrapi`, add:

      ```ts
      /** A failed transcript fetch, with what the plugin said about it. */
      class TranscriptFetchFailure extends Error {
        readonly status: number;
        readonly reason: TranscriptFetchReason | null;

        constructor(message: string, status: number, reason: TranscriptFetchReason | null) {
          super(message);
          this.name = 'TranscriptFetchFailure';
          this.status = status;
          this.reason = reason;
        }
      }

      // Retry only when Strapi was unreachable or the plugin could not reach
      // YouTube. The plugin already retries YouTube's rate limits itself
      // (3 attempts, Retry-After, fresh session), and no captions, a bot wall
      // or an invalid id will not change on a second try.
      function isRetryableTranscriptFailure(err: unknown): boolean {
        return err instanceof TranscriptFetchFailure && (err.status === 0 || err.reason === 'network');
      }
      ```

    - Replace the comment above the function with `// Ask Strapi to fetch the transcript from YouTube and store it, and return\n// the stored row. Retried only per isRetryableTranscriptFailure.`
    - Inside, replace `if (!r.success) throw new Error(r.error);` with `if (!r.success) throw new TranscriptFetchFailure(r.error, r.status, r.reason);` and add `shouldRetry: isRetryableTranscriptFailure,` to the `withRetry` options object (after `attempts: 3,`). Nothing else in the function changes.

16. **`client/src/lib/services/learning.persistence.test.ts` — edit.**
    - In `'fails the run when Strapi cannot fetch the transcript'`, change the mocked value to `{ success: false, error: 'No captions available for this video', status: 404, reason: 'no_captions' }` and add `expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(1);` after the existing expectations.
    - Append:

      ```ts
      // ---------------------------------------------------------------------------
      // M-4 — the app retries only what the plugin did not: Strapi down, or a
      // network failure reaching YouTube.
      // ---------------------------------------------------------------------------

      describe('resolveGenerationInputs retries the transcript fetch only on network failures', () => {
        beforeEach(() => {
          vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
          // The run also asks YouTube oEmbed for metadata; keep it off the network.
          vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
          vi.spyOn(console, 'log').mockImplementation(() => {});
          services.fetchVideoByVideoIdService.mockResolvedValue(video);
          services.fetchTranscriptByVideoIdService.mockResolvedValue(null);
        });

        afterEach(() => {
          vi.useRealTimers();
          vi.unstubAllGlobals();
        });

        const run = async () => {
          const pending = resolveGenerationInputs('abc123', { forceRefetch: true });
          await vi.runAllTimersAsync();
          return pending;
        };

        it('retries when the plugin reports a network failure', async () => {
          services.requestTranscriptFetchService
            .mockResolvedValueOnce({ success: false, error: 'Could not reach YouTube: fetch failed', status: 502, reason: 'network' })
            .mockResolvedValueOnce({ success: true, action: 'updated', transcript: freshRow });

          const outcome = await run();

          expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(2);
          expect(outcome.kind).toBe('ready');
        });

        it('retries when Strapi is unreachable, up to three attempts in all', async () => {
          services.requestTranscriptFetchService.mockResolvedValue({
            success: false,
            error: 'Backend unreachable. Check that Strapi is running on port 1340.',
            status: 0,
            reason: null,
          });

          const outcome = await run();

          expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(3);
          expect(outcome.kind).toBe('error');
        });

        it('does not retry a rate limit — the plugin already did', async () => {
          services.requestTranscriptFetchService.mockResolvedValue({
            success: false,
            error: 'YouTube is rate limiting caption downloads from this server (HTTP 429), 3 attempts.',
            status: 502,
            reason: 'rate_limited',
          });

          const outcome = await run();

          expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(1);
          expect(outcome.kind).toBe('error');
        });

        it('does not retry a 502 that carries no reason', async () => {
          services.requestTranscriptFetchService.mockResolvedValue({
            success: false,
            error: 'Backend error. Strapi is up but rejected the request — check its console for details.',
            status: 502,
            reason: null,
          });

          await run();

          expect(services.requestTranscriptFetchService).toHaveBeenCalledTimes(1);
        });
      });
      ```

17. **`client/src/lib/services/videos.test.ts` — append** a `describe('requestTranscriptFetchService', …)` using the file's existing `fetchMock` harness (add `requestTranscriptFetchService` to the import):

    | `fetchMock` answers | Expect the result to deep-equal |
    |---|---|
    | `new Response(JSON.stringify({ data: null, error: { status: 404, name: 'TranscriptFetchError', message: 'No captions available for this video. Playability: OK.', details: { reason: 'no_captions' } } }), { status: 404 })` | `{ success: false, error: 'No captions available for this video. Playability: OK.', status: 404, reason: 'no_captions' }` |
    | rejects `new Error('ECONNREFUSED')` | `{ success: false, error: 'Backend unreachable. Check that Strapi is running on port 1340.', status: 0, reason: null }` |
    | 502 with `details: { reason: 'something-new' }` | `reason: null` and `error` = the `friendlyBackendError(502, …)` text |
    | 200 `{ data: { documentId: 't1' }, meta: { action: 'skipped' } }` | `{ success: true, action: 'skipped', transcript: { documentId: 't1' } }` |

    And in `client/src/lib/services/strapi-client.test.ts` append one case: a 404 whose body has `error: { message: 'm', details: { reason: 'no_captions' } }` → `toEqual({ ok: false, status: 404, error: 'm', details: { reason: 'no_captions' } })`.

18. **Remove `TRANSCRIPT_PROXY_URL` everywhere it is live; add `PROXY_URL`.**
    - `server/.env.example`: replace the last block (the comment starting `# Residential proxy for the YouTube caption fetch.` and the line `TRANSCRIPT_PROXY_URL=`) with:

      ```
      # Residential proxy for every YouTube request strapi-plugin-yt-kb makes
      # (captions, metadata, oEmbed): the app's transcript fetch, GET
      # /api/yt-kb/yt-transcript/:videoId and the MCP fetchTranscript / addVideo
      # tools. The plugin's `proxyUrl` setting defaults to this variable (the same
      # shape as strapi-plugin-youtube-transcripts). Leave empty for local dev;
      # set it on a cloud host, whose IPs YouTube tends to block. At boot the
      # plugin tests it against httpbin.org and logs the outbound IP.
      # Example: http://user:pass@proxy.example.com:8080
      PROXY_URL=
      ```

    - `client/.env.example` line 10: `# this app. Their proxy, TRANSCRIPT_PROXY_URL, is set in server/.env.` → `# this app. The proxy is the plugin setting proxyUrl (PROXY_URL in server/.env).`
    - `client/src/lib/services/videos.ts`: the old doc comment's `One fetcher, one TRANSCRIPT_PROXY_URL, shared with the MCP tools.` is replaced by step 14.
    - `CLAUDE.md` (MCP section, line 204): replace `through \`TRANSCRIPT_PROXY_URL\` in \`server/.env\` when set` with `through the plugin setting \`proxyUrl\` (default \`PROXY_URL\` in \`server/.env\`) when set`.
    - `docs/architecture.md` line 180: replace the sentence's subject `The residential proxy, \`TRANSCRIPT_PROXY_URL\`, is set in Strapi's environment (\`server/.env\`), not the app's.` with `The residential proxy is the plugin setting \`proxyUrl\`, which defaults to \`PROXY_URL\` in Strapi's environment (\`server/.env\`), not the app's.`
    - `docs/operations.md` line 85: `Set \`TRANSCRIPT_PROXY_URL\` in \`client/.env\` to a residential proxy.` → `Set \`PROXY_URL\` in \`server/.env\` (the yt-kb plugin setting \`proxyUrl\`) to a residential proxy.`
    - The code references (`PSRC/services/fetcher.ts`, `PSRC/services/youtube-transcript.ts`, `PSRC/mcp/tools/fetch-transcript.ts`) are gone with steps 2, 3 and 10.
    - Left as they are, on purpose: dated design records `docs/designs/yt-knowledge-base/05-tech-requirements.md` and `docs/designs/yt-kb-cloud/*` (E9 updates the run's own docs).
    - Check: `git grep -n TRANSCRIPT_PROXY_URL -- . ':!docs/designs'` prints nothing.

#### Data

None. M2 added the columns; no row is rewritten. Existing transcripts keep `language = 'en'` (all 195 local rows, `SELECT count(*), sum(language='en') FROM yt_kb_transcripts` → `195|195` on 2026-11-08) and empty metadata until they are re-fetched with `force` or the owner boots once with `backfillMetadata: true` (optional, see Env / deploy).

#### Callers updated

- `fetchAndStore` (signature lost `proxyUrl`; throws `TranscriptFetchError`): `PSRC/controllers/fetcher.ts` (step 7), `PSRC/mcp/tools/fetch-transcript.ts` (step 10), `PSRC/mcp/tools/add-video.ts` (step 11). M5's `ai-tools` service calls the same tool bodies.
- `fetchYouTubeMeta` → `fetchOEmbedMeta`: only `PSRC/services/fetcher.ts`.
- REST error body of `POST /api/yt-kb/transcripts/fetch` (502-only → 400/404/502 with `details.reason`): its only caller `client/src/lib/services/videos.ts` `requestTranscriptFetchService` (step 14). `git grep -n "transcripts/fetch" -- client site server/src scripts` lists no other caller.
- `requestTranscriptFetchService` result shape (adds `status`, `reason`): its only caller `client/src/lib/services/learning.ts` `fetchTranscriptThroughStrapi` (step 15) and the test mock `client/src/lib/services/learning.persistence.test.ts` (step 16).
- `StrapiResult` (optional `details`): additive; no caller changes.
- New route scope `plugin::yt-kb.fetcher.getOrFetch`: granted by M5's `create-tokens.cjs` to `yt-kb-app`.
- `TRANSCRIPT_PROXY_URL` → `PROXY_URL`: step 18.

#### Verify

Run from the repo root on branch `egm/yt-kb-any-strapi`, with M1's check conventions: in every shell `K=server/.tmp/e8/e8.mjs; T=server/.tmp/e8/tokens.json; A=server/.tmp/e8/admin.json; L=server/.tmp/e8/m3-strapi.log`. Never against `server/.tmp/data.db`: the scratch Strapi uses `server/.tmp/e8-m3.db` (a copy of real data) on port 1341 with `PROXY_URL=http://127.0.0.1:9` (a closed local port), so any request that would go to YouTube fails at once and nothing leaves the machine — except the one oEmbed request the app makes in step 8 (Open questions, OQ-5).

0. **Ports free:** M1 precondition 1's command → `"busy":false` for 1340, 1341 and 3005.

1. **Static gates and unit tests:**
   - `yarn --cwd server/src/plugins/yt-kb test` → exit 0; the five new test files (12a–12e) run and pass.
   - `yarn --cwd server/src/plugins/yt-kb test:ts:back` → exit 0.
   - `yarn --cwd server/src/plugins/yt-kb build` → exit 0.
   - `(cd client && npx tsc --noEmit)` → exit 0. `(cd server && npx tsc --noEmit)` → exit 0.
   - `yarn test` → exit 0; the count is the previous total + 9 (4 in `learning.persistence.test.ts`, 4 in `videos.test.ts`, 1 in `strapi-client.test.ts`).
   - `git grep -n TRANSCRIPT_PROXY_URL -- . ':!docs/designs'` → no output (exit 1).

2. **Extend the check kit** (`server/.tmp/e8/e8.mjs`, scratch, not committed). Three additions, used by M3–M7:
   - Above `const commands = {`, add:
     ```js
     // Added in M3. A token key is a key of tokens.json, 'none' (no
     // Authorization header) or '@<path>' (a key file another tool wrote,
     // e.g. M5's create-tokens.cjs). The key itself is never printed.
     const tokenOf = (t, key) =>
       key === 'none' ? undefined : key.startsWith('@') ? readFileSync(key.slice(1), 'utf8').trim() : t[key];
     ```
   - In `mcp`, replace `const token = tokenKey === 'none' ? undefined : t[tokenKey];` with `const token = tokenOf(t, tokenKey);`. In `rest`, replace `token: tokenKey === 'none' ? undefined : t[tokenKey],` with `token: tokenOf(t, tokenKey),`. Replace `race` with:
     ```js
     // n identical POSTs at once.
     async race(tokensFile, n, p, bodyJson, tokenKey = 'rest') {
       const t = readJson(tokensFile);
       const body = JSON.parse(bodyJson);
       const token = tokenOf(t, tokenKey);
       const results = await Promise.all(
         Array.from({ length: Number(n) }, () => http(t.base, 'POST', p, { token, body })),
       );
       print({
         statuses: results.map((r) => r.status).sort(),
         errors: results.filter((r) => r.status >= 400).map((r) => r.body?.error?.message ?? null),
       });
     },
     ```
   - Add two commands after `race`:
     ```js
     // Added in M3. Mints one more token on the scratch Strapi and stores its
     // key in tokensFile under `key` (the file stays 0600). kind
     // 'content-api': a custom token whose scopes are `csv` (Content API
     // action ids); kind 'admin': an admin token holding the admin actions in
     // `csv`. Prints ids and grants only.
     async token(tokensFile, adminFile, key, kind, csv) {
       const t = readJson(tokensFile);
       const admin = readJson(adminFile);
       const login = await http(t.base, 'POST', '/admin/login', { body: { email: admin.email, password: admin.password } });
       const jwt = login.body?.data?.token ?? login.body?.data?.accessToken;
       if (login.status !== 200 || !jwt) die({ step: 'login', status: login.status, error: login.body?.error ?? null });
       const actions = csv.split(',').filter(Boolean);
       const name = `e8-${key}-${Date.now()}`;
       let r;
       if (kind === 'admin') {
         r = await http(t.base, 'POST', '/admin/admin-tokens', {
           token: jwt,
           body: {
             name, description: 'E8 scratch check', lifespan: null,
             adminPermissions: actions.map((action) => ({ action, subject: null, properties: {}, conditions: [] })),
           },
         });
       } else if (kind === 'content-api') {
         r = await http(t.base, 'POST', '/admin/api-tokens', {
           token: jwt,
           body: { name, description: 'E8 scratch check', type: 'custom', lifespan: null, permissions: actions },
         });
       } else {
         die({ error: `unknown kind ${kind}; use content-api or admin` });
       }
       if (![200, 201].includes(r.status) || !r.body?.data?.accessKey) {
         die({ step: 'token', key, status: r.status, error: r.body?.error ?? null });
       }
       const d = r.body.data;
       writeFileSync(tokensFile, JSON.stringify({ ...t, [key]: d.accessKey }), { mode: 0o600 });
       const granted = kind === 'admin'
         ? (d.adminPermissions ?? []).map((p) => p.action)
         : (d.permissions ?? []).map((p) => (typeof p === 'string' ? p : p.action));
       print({ ok: true, key, id: d.id, granted: granted.sort() });
     },
     // Added in M3. Like `mcp`, but never exits 1 on a refusal: prints
     // { initStatus, httpStatus, rpcError, result }. tools/list follows
     // nextCursor and returns the whole tool objects in result.tools.
     async mcpx(tokensFile, tokenKey, method, paramsJson = '{}') {
       const t = readJson(tokensFile);
       const token = tokenOf(t, tokenKey);
       const init = await mcpRequest(t.base, token, 'initialize', {
         protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e8-probe', version: '1.0.0' },
       }, 1);
       if (init.msg.error || !init.msg.result) {
         print({ initStatus: init.status, httpStatus: null, rpcError: init.msg.error ?? null, result: null });
         return;
       }
       if (method === 'tools/list') {
         const tools = [];
         let cursor;
         let last;
         do {
           last = await mcpRequest(t.base, token, 'tools/list', cursor ? { cursor } : {}, 2);
           if (last.msg.error) {
             print({ initStatus: init.status, httpStatus: last.status, rpcError: last.msg.error, result: null });
             return;
           }
           tools.push(...last.msg.result.tools);
           cursor = last.msg.result.nextCursor;
         } while (cursor);
         print({ initStatus: init.status, httpStatus: last.status, rpcError: null, result: { tools } });
         return;
       }
       const r = await mcpRequest(t.base, token, method, JSON.parse(paramsJson), 2);
       print({ initStatus: init.status, httpStatus: r.status, rpcError: r.msg.error ?? null, result: r.msg.result ?? null });
     },
     ```
   Check: `node $K` (no command) → exits 1 and its `commands` list includes `token` and `mcpx`.

3. **Scratch Strapi, tokens and fixtures:**
   ```bash
   yarn --cwd server/src/plugins/yt-kb build
   node $K backup server/.tmp/data.db server/.tmp/e8-m3.db
   (cd server && DATABASE_FILENAME=.tmp/e8-m3.db yarn -s strapi admin:create-user --email="$(node -p 'require("./.tmp/e8/admin.json").email')" --password="$(node -p 'require("./.tmp/e8/admin.json").password')" --firstname=E8 --lastname=Check)
   (cd server && DATABASE_FILENAME=.tmp/e8-m3.db PROXY_URL=http://127.0.0.1:9 PORT=1341 HOST=127.0.0.1 nohup yarn develop > .tmp/e8/m3-strapi.log 2>&1 &)
   node $K wait http://127.0.0.1:1341/_health 300
   node $K admin-tokens http://127.0.0.1:1341 $A $T plugin::yt-kb.tool.fetch-transcript,plugin::yt-kb.maintenance
   node $K token $T $A app content-api plugin::yt-kb.fetcher.getOrFetch,plugin::yt-kb.fetcher.fetchTranscript,plugin::yt-kb.transcript.find
   node $K token $T $A noscope content-api plugin::yt-kb.transcript.find
   node $K token $T $A admread admin plugin::yt-kb.read
   node $K rest $T POST /api/yt-kb/transcripts '{"data":{"youtubeVideoId":"m3StoredAAA","title":"M3 stored","language":"de","durationSec":3,"rawSegments":[{"text":"Hallo Welt","startMs":0,"endMs":1500}],"rawText":"Hallo Welt","fetchedAt":"2026-11-08T00:00:00.000Z"}}' | jq -e '.status==201'
   node $K rest $T POST /api/yt-kb/videos '{"data":{"youtubeVideoId":"m3PendingAA","url":"https://www.youtube.com/watch?v=m3PendingAA","summaryStatus":"pending"}}' | jq -e '.status==201'
   fails() { grep -c '\[yt-kb\] transcript fetch failed:' $L || true; }
   ```
   → backup `"integrity": "ok"`; wait → 204; `admin-tokens` `grantedActions` = `["plugin::yt-kb.maintenance","plugin::yt-kb.tool.fetch-transcript"]` (the second exists only because M3 step 9 registers it); each `token` → `"ok": true`; both POSTs → 201. The token keys `rest` (full-access), `mcp` (the admin token above), `app`, `noscope` and `admread` are now in `$T`.

4. **Boot log** (structured output is not available for logs; these are plain-text log checks):
   - `grep -c '\[yt-kb\] Proxy configured: http://127.0.0.1:9' $L` → `1`.
   - `grep -c '\[yt-kb\] Proxy connection FAILED' $L` → `1` (the dead proxy refuses; nothing reached httpbin).
   - `grep -c 'registered 4 MCP admin permission' $L` → `1`.

5. **REST — content API:**
   - Stored, by id, no network: `node $K rest $T GET /api/yt-kb/yt-transcript/m3StoredAAA '' app | jq -e '.status==200 and .body.data.youtubeVideoId=="m3StoredAAA" and .body.data.language=="de" and (.body.meta // null)==null'`.
   - Stored, by URL: `node $K rest $T GET "/api/yt-kb/yt-transcript/$(node -p 'encodeURIComponent("https://www.youtube.com/watch?v=m3StoredAAA&t=10s")')" '' app | jq -e '.status==200 and .body.data.youtubeVideoId=="m3StoredAAA"'`; the same with `https://youtu.be/m3StoredAAA` and `https://www.youtube.com/live/m3StoredAAA`.
   - No YouTube call for the stored id: `grep -c 'fetching m3StoredAAA' $L` → `0`.
   - Invalid id: `N=$(fails); node $K rest $T GET /api/yt-kb/yt-transcript/not-an-id '' app | jq -e '.status==400 and .body.data==null and .body.error.name=="TranscriptFetchError" and .body.error.details.reason=="invalid_id"'`; then `[ $(fails) -eq $((N+1)) ]`.
   - Not stored, YouTube unreachable: `N=$(fails); node $K rest $T GET /api/yt-kb/yt-transcript/m3MissingAA '' app | jq -e '.status==502 and .body.error.details.reason=="network"'`; then `[ $(fails) -eq $((N+1)) ]` (logged once).
   - Negative — anonymous: `node $K rest $T GET /api/yt-kb/yt-transcript/m3StoredAAA '' none | jq -e '.status==403'`.
   - Negative — token without the scope: `node $K rest $T GET /api/yt-kb/yt-transcript/m3StoredAAA '' noscope | jq -e '.status==403'`.
   - `POST /transcripts/fetch` (all with `app`): `node $K rest $T POST /api/yt-kb/transcripts/fetch '{"data":{"videoId":"m3StoredAAA"}}' app | jq -e '.status==200 and .body.meta.action=="skipped"'`; body `'{"data":{"videoId":"bad"}}'` → `jq -e '.status==400 and .body.error.details.reason=="invalid_id"'`; body `'{"data":{"videoId":"m3StoredAAA","force":"yes"}}'` → `jq -e '.status==400 and .body.error.name!="TranscriptFetchError"'`; body `'{"data":{"videoId":"m3StoredAAA","force":true}}'` → `jq -e '.status==502 and .body.error.details.reason=="network"'`, and afterwards the stored row is untouched: `node $K rest $T GET '/api/yt-kb/transcripts?filters[youtubeVideoId][$eq]=m3StoredAAA' '' app | jq -e '.body.data[0].language=="de" and .body.data[0].title=="M3 stored"'`.

6. **REST — admin route:**
   - `node $K rest $T GET /yt-kb/yt-transcript/m3StoredAAA '' mcp | jq -e '.status==200 and .body.data.youtubeVideoId=="m3StoredAAA"'`.
   - Negative — admin token without the action: `node $K rest $T GET /yt-kb/yt-transcript/m3StoredAAA '' admread | jq -e '.status==403'`.
   - Negative — no token: `node $K rest $T GET /yt-kb/yt-transcript/m3StoredAAA '' none | jq -e '.status==401'`.

7. **MCP** (`fetchTranscript` is still in the `maintenance` tier in M3; the `mcp` token holds it):
   - `node $K mcpx $T mcp tools/list | jq -e '.result.tools | map(select(.name=="fetchTranscript"))[0].inputSchema.properties | has("proxyUrl") | not'`.
   - `node $K mcpx $T mcp tools/call '{"name":"fetchTranscript","arguments":{"videoId":"m3MissingAA"}}' | jq -e '(.result.isError // false)==false and .result.structuredContent.reason=="network"'`.
   - Negative — malformed id rejected by the schema: `node $K mcpx $T mcp tools/call '{"name":"fetchTranscript","arguments":{"videoId":"bad"}}' | jq -e '.rpcError!=null or .result.isError==true'`.

8. **Through the app** (the core-loop handler that calls the changed service). Start the client on 3005 against the scratch Strapi with the full-access scratch token (shell variables win over `client/.env`; if they did not, the scratch row below would stay `pending` and the check fails visibly — the owner's Strapi on 1340 is stopped and would not answer):
   ```bash
   (cd client && STRAPI_URL=http://127.0.0.1:1341 STRAPI_API_TOKEN="$(node -p 'require("../server/.tmp/e8/tokens.json").rest')" nohup yarn dev > ../server/.tmp/e8/m3-client.log 2>&1 &)
   node $K wait http://localhost:3005/feed 180
   ```
   Then:
   - `N=$(fails); curl -s -o /dev/null -w '%{http_code}' http://localhost:3005/learn/m3PendingAA` → `200` (the loader starts generation).
   - Poll every 2 s, up to 60 s: `node $K rest $T GET '/api/yt-kb/videos?filters[youtubeVideoId][$eq]=m3PendingAA&fields[0]=summaryStatus' | jq -e '.body.data[0].summaryStatus=="failed"'`.
   - `[ $(fails) -eq $((N+3)) ]` — three attempts, because the plugin said `network` (the retry rule). This step also makes the app's own oEmbed request for `m3PendingAA` to youtube.com (unchanged behaviour, `learning.ts:188`); its failure is ignored.
   - `curl -s http://localhost:3005/learn/m3PendingAA | grep -c 'Generation failed'` → at least `1` (what the user sees on error; a text check on rendered HTML).

9. **Clean up:** `lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill; lsof -ti tcp:3005 -sTCP:LISTEN | xargs kill; rm -f server/.tmp/e8-m3.db*`.

- **Done when:** `yarn --cwd server/src/plugins/yt-kb test` and `yarn test` pass, and every check in steps 2–8 passes against the scratch Strapi with no request leaving the machine other than step 8's one oEmbed request.
- **Rollback:** `git revert` the M3 commit. No data step to undo: transcripts fetched while M3 ran keep their extra metadata in M2's columns, which the reverted code ignores. If the owner had already renamed the variable, rename `PROXY_URL` back to `TRANSCRIPT_PROXY_URL` in `server/.env`.
- **Env / deploy:**

  | Variable | App | Change | Example value | Notes |
  |---|---|---|---|---|
  | `PROXY_URL` | backend (`server/.env`, any host's env) | add | `http://user:pass@proxy.example.com:8080` | Optional, server-only. Read through the plugin config default `proxyUrl: env('PROXY_URL', '')`; an explicit `proxyUrl` in the host's `config/plugins.ts` wins. |
  | `TRANSCRIPT_PROXY_URL` | backend | remove | — | No fallback. **Owner step** (the agent never opens, prints or edits a `.env`; it tells the owner what to change, as in Deployment step 3): if `server/.env` has a value for it, rename the key to `PROXY_URL` and keep the value. |

  Optional owner step after deploy: to fill metadata and the real language on the 195 stored transcripts, set `config: { mcp: true, backfillMetadata: true }` for `yt-kb` in the host's `config/plugins.ts`, boot once (it calls YouTube about 195 times, 1.5 s apart, ~5 min, in the background), check the log for `[yt-kb] metadata backfill complete`, then remove the setting.

### M4 — Search ownership and grounding

- **Why:** M-11 (the plugin owns the search code and builds a transcript search index without any model, so MCP-added videos are searchable), M-16 (`saveSummary` grounds section timecodes itself instead of storing the model's), contract § Search.
- **Depends on:** M3 (`fetchAndStore` shape), M2 (`Transcript.searchIndex` json attribute).
- **Index parameters:** no bump of `TOKENIZER_VERSION` or `CURRENT_INDEX_PARAMS`. `tokenize`, `STOPWORDS`, `RETRIEVAL_CHUNK_WORDS` (150), `RETRIEVAL_CHUNK_OVERLAP` (20) and `TOKENIZER_VERSION` (2) are not edited, and the chunker moves verbatim, so every index the app stored (190 of 195 local videos are current, `json_extract(transcript_segments,'$.params.tokenizer')=2`) stays current and scores the same. Verify step 1 checks this.
- **What moves** from `client/src/lib/services/transcript.ts` (line ranges at 721f210) to the end of the plugin's `bm25-core.ts`, verbatim except where noted:

  | Lines | What | Change on the way |
  |---|---|---|
  | 15–40 | `// 1. Clean` header, `FILLER_PATTERNS` | none |
  | 84–90 | `cleanTranscript` | none |
  | 92–134 | `// 1b.` header, `PreparedTranscript`, `prepareSegmentedTranscript` | none |
  | 136–179 | inline-timecode header, `formatMmss`, `annotateSpan` | add `export` to `formatMmss` and `annotateSpan` |
  | 193–203 | `// 2. Chunk` header, `FALLBACK_WPM` | none |
  | 221–282 | `effectiveWpm`, `chunkBy`, `chunkForRetrieval` | add `export` to `chunkBy` |
  | 480–531 | grounding header, `GROUNDING_MIN_SCORE`, citation header, `TranscriptEvidence`, `findEvidenceForQuote` | none |
  | 722–793 | `GroundableSection`, `GroundedSection`, `searchBM25Top1WithScore`, `groundSectionsToTranscript` | none |

  `groundSectionsToTranscript` (with its 2.0 `GROUNDING_MIN_SCORE`) moves only because the contract lists it and the client's `transcript.test.ts` uses it through the re-export; **nothing in the plugin calls it.** `saveSummary` grounds with `findEvidenceForQuote(\`${heading}. ${body}\`, bm25, 1.0)` — the same function, query and threshold the app's summary pipeline uses to set each section's `timeSec` (`client/src/lib/services/learning.ts:1051-1052` at 721f210) — so an MCP-saved summary and an app-generated one get the same timecodes from the same index.

  **What stays** in `transcript.ts`: the header (rewritten), `annotateWithTimecodes` (181–191), the summary-size comment and `SUMMARY_CHUNK_WORDS` / `SUMMARY_CHUNK_OVERLAP` (205–218), `chunkForSummary` (284–290), `RRF_K` and `searchBM25MultiQuery`, `estimateTokens`, `PassageChunk` / `chunkForPassages`, `SectionAnchor` / `SECTION_BODY_CLIP_CHARS` / `findNearestSection`, `parseTcStringToSeconds`, `verifyTimecodesInText`, `EvidenceCitation` / `extractCitationsWithEvidence`, `makeSectionContextualizer`. The moved code needs nothing outside bm25-core (it uses `RETRIEVAL_CHUNK_*`, `BM25_K1`, `BM25_B`, `tokenize`, `TimedTextSegment`, `TranscriptChunk`, `BM25Index`, all already there), so bm25-core stays import-free.

#### Files

1. **`server/src/plugins/yt-kb/server/src/services/bm25-core.ts` — becomes the source.**
   1. Delete the generated banner (the first 6 lines: `// GENERATED FILE — DO NOT EDIT.` through the blank line after `// bm25-core.sync.test.ts fails if this file drifts from the source.`).
   2. Replace the header comment that follows (14 lines, `// BM25 scoring and the on-disk index format — the one definition, shared` … `// copied verbatim into a package with a different tsconfig.`) with:

      ```ts
      // BM25 scoring, the on-disk index format, and the model-free transcript
      // pipeline around them (cleaning, retrieval chunking, timecode grounding) —
      // the one definition, shared by strapi-plugin-yt-kb and the client.
      //
      // This file is the source of truth. `client/src/lib/services/bm25-core.ts`
      // is a generated byte-for-byte copy (see `scripts/sync-bm25-core.mjs`), and
      // `bm25-core.sync.test.ts` fails if the two drift. The plugin owns it because
      // the plugin builds every transcript's search index and grounds saveSummary's
      // timecodes without the app. Before the copy existed, the server carried a
      // hand-written "mirror" of this math that was missing the min-IDF query gate,
      // the query-TF damping, the alpha-prefix expansion and the prototype guard —
      // so MCP's searchTranscript ranked the same stored index differently from
      // the in-app chat while claiming to be identical.
      //
      // Keep this module free of imports and of anything environment-specific:
      // no path aliases, no env, no DOM, no Strapi. That is what lets it be
      // copied verbatim into a package with a different tsconfig.
      ```

   3. At the end of the file, append a section header, then the moved blocks in the table's order (with the three `export` additions), then the new builder:

      ```ts
      // -----------------------------------------------------------------------------
      // Model-free transcript pipeline: cleaning, retrieval chunking and timecode
      // grounding. Moved here from the client's transcript.ts (which re-exports
      // them) so the plugin can build a transcript's search index and ground
      // saveSummary's sections without the app. The numbered headers below keep
      // their old numbers.
      // -----------------------------------------------------------------------------

      /* … the moved blocks, in table order … */

      // -----------------------------------------------------------------------------
      // Transcript search index — Transcript.searchIndex
      // -----------------------------------------------------------------------------
      //
      // The index the plugin stores on every transcript: the same cleaning and
      // retrieval chunks as the app's index, without the app's section
      // contextualizer (that needs a summary), so building it needs no model.
      // Built by fetchAndStore on every create/update and lazily by the search
      // tools (plugin services/search-index.ts). Readers prefer the app's
      // contextual Video.transcriptSegments when it is current.

      export function buildTranscriptSearchIndex(
        rawSegments: TimedTextSegment[] | null | undefined,
        durationSec: number | null | undefined,
      ): StoredTranscriptIndex | null {
        if (!Array.isArray(rawSegments) || rawSegments.length === 0) return null;
        const chunks = chunkForRetrieval(prepareSegmentedTranscript(rawSegments), durationSec ?? null);
        if (chunks.length === 0) return null;
        return makeStoredIndex(buildBM25Index(chunks), { rawSegments, durationSec: durationSec ?? null });
      }
      ```

2. **`scripts/sync-bm25-core.mjs` — replace the whole file** (direction flipped, plugin → client):

   ```js
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
   ```

   Then run `yarn sync:bm25` → prints `Wrote client/src/lib/services/bm25-core.ts`. Never edit the client copy by hand.

3. **`client/src/lib/services/bm25-core.sync.test.ts` — replace the whole file** (it stays in `client/`; M1 moved only the permissions guard). Still 2 tests, so the client total does not change:

   ```ts
   import { describe, expect, it } from 'vitest';
   import { readFileSync } from 'node:fs';
   import { join } from 'node:path';

   // The plugin and the client both score the same stored BM25 indexes and run
   // the same cleaning and chunking. They can't import from each other — the
   // two halves are independent by design (CLAUDE.md) — so the client carries a
   // generated copy of the plugin's core and this test keeps it honest.
   //
   // Before the copy, the server hand-mirrored the math and had silently
   // drifted: no min-IDF query gate, no query-TF damping, no alpha-prefix
   // expansion, no prototype guard.
   //
   // Regenerate with: yarn sync:bm25
   const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
   const SOURCE = join(REPO_ROOT, 'server', 'src', 'plugins', 'yt-kb', 'server', 'src', 'services', 'bm25-core.ts');
   const COPY = join(REPO_ROOT, 'client', 'src', 'lib', 'services', 'bm25-core.ts');

   export const GENERATED_BANNER = `// GENERATED FILE — DO NOT EDIT.
   //
   // Verbatim copy of server/src/plugins/yt-kb/server/src/services/bm25-core.ts,
   // produced by scripts/sync-bm25-core.mjs. Edit the source and run \`yarn sync:bm25\`.
   // bm25-core.sync.test.ts fails if this file drifts from the source.

   `;

   describe('bm25-core client copy', () => {
     it('is byte-for-byte the plugin source under the generated banner', () => {
       const source = readFileSync(SOURCE, 'utf8');
       const copy = readFileSync(COPY, 'utf8');
       expect(copy).toBe(GENERATED_BANNER + source);
     });

     it('stays free of imports, so it can be dropped into either package', () => {
       const source = readFileSync(SOURCE, 'utf8');
       // A path alias or an env read here would compile in one package and
       // break in the other, which has a different tsconfig.
       expect(source).not.toMatch(/^\s*import\s/m);
       expect(source).not.toMatch(/#\//);
       expect(source).not.toMatch(/process\.env/);
     });
   });
   ```

4. **`client/src/lib/services/transcript.ts` — edit.**
   - Delete the moved ranges (table above).
   - Replace the header comment (lines 1–13) with:

     ```ts
     // Transcript utilities used by the summary + chat pipelines.
     //
     // Cleaning, retrieval chunking, BM25 and timecode grounding come from
     // ./bm25-core — a generated copy of strapi-plugin-yt-kb's source — and are
     // re-exported below so every caller keeps importing from './transcript'.
     // This module adds what only the app needs: timecode annotation for
     // prompts, summary-sized chunks, multi-query fusion, passage chunks for
     // embeddings, citation verification and the section contextualizer for
     // Contextual Retrieval.
     ```

   - Replace the re-export and import blocks (lines 42–82) with:

     ```ts
     export {
       CURRENT_INDEX_PARAMS,
       STOPWORDS,
       STORED_INDEX_VERSION,
       TOKENIZER_VERSION,
       buildBM25Index,
       buildTranscriptSearchIndex,
       chunkForRetrieval,
       cleanTranscript,
       findEvidenceForQuote,
       groundSectionsToTranscript,
       isStoredIndex,
       loadStoredIndex,
       makeStoredIndex,
       prepareSegmentedTranscript,
       searchBM25,
       searchBM25Ranked,
       storedIndexStatus,
       tokenize,
     } from './bm25-core';
     export type {
       BM25Index,
       ScorableDoc,
       BM25IndexParams,
       Contextualizer,
       GroundableSection,
       GroundedSection,
       PreparedTranscript,
       RankedChunk,
       StoredIndexStatus,
       StoredTranscriptIndex,
       TimedTextSegment,
       TranscriptChunk,
       TranscriptEvidence,
     } from './bm25-core';

     import {
       annotateSpan,
       chunkBy,
       findEvidenceForQuote,
       formatMmss,
       searchBM25,
       type BM25Index,
       type Contextualizer,
       type PreparedTranscript,
       type TimedTextSegment,
       type TranscriptChunk,
     } from './bm25-core';
     ```

     (`BM25_B`, `BM25_K1`, `RETRIEVAL_CHUNK_OVERLAP`, `RETRIEVAL_CHUNK_WORDS` and `tokenize` leave the import list: after the move nothing left in this file uses them, and `noUnusedLocals` would fail.)
   - Line 542: `// (formatMmss is defined earlier in the file — reused here.)` → `// (formatMmss comes from ./bm25-core.)`
   - Importers are unchanged — every one imports from `./transcript` or `#/lib/services/transcript`: `content-signals.ts`, `learning.ts`, `notes.ts`, `reader.ts`, `transcript-index.ts`, `routes/api.notes.compose.tsx`, and the tests `learning.draft.test.ts`, `score-consistency.test.ts`, `transcript.test.ts` (`git grep -n "groundSectionsToTranscript\|findEvidenceForQuote\|chunkForRetrieval\|prepareSegmentedTranscript\|cleanTranscript" -- client/src`). `bm25-core.invalidation.test.ts` imports `./bm25-core` directly and still finds every name it uses.

5. **`server/src/plugins/yt-kb/server/src/content-types/transcript/schema.json` — edit:** add `"private": true` to the `searchIndex` attribute (M2 created it as `{ "type": "json", "description": … }` without `private`). Why: the index is ~40 KB for a 35-minute transcript and only the plugin reads it; private keeps it out of every content-API response (the app's `POST /transcripts/fetch` and `GET /transcripts`, `GET /yt-transcript/:videoId`, `copy-content.mjs` reads). The Document Service, which the plugin uses, still reads and writes it. A copied host rebuilds it lazily.

6. **`server/src/plugins/yt-kb/server/src/services/fetcher.ts` — edit** (M3's file):
   - Add `import { buildTranscriptSearchIndex } from './bm25-core';`
   - In `fetchAndStore`'s `data` object, after `rawText: result.fullTranscript,`, add `searchIndex: buildTranscriptSearchIndex(rawSegments, result.durationSec),`. Both the create and the update path write it.

7. **`server/src/plugins/yt-kb/server/src/services/search-index.ts` — new file:**

   ```ts
   import type { Core } from '@strapi/strapi';
   import {
     buildTranscriptSearchIndex,
     loadStoredIndex,
     type StoredTranscriptIndex,
     type TimedTextSegment,
   } from './bm25-core';

   // The transcript's model-free search index (Transcript.searchIndex), for the
   // tools that read it. fetchAndStore writes it on every fetch; a transcript
   // stored before that, or indexed by an older tokenizer/chunker, gets it here
   // on first use: built from rawSegments and saved.

   const TRANSCRIPT = 'plugin::yt-kb.transcript';

   /** A Transcript row as the tools load it. `rawSegments` may be left out of the
    *  query: it is read only when the index has to be built. */
   export type TranscriptIndexSource = {
     documentId: string;
     searchIndex?: unknown;
     rawSegments?: TimedTextSegment[] | null;
     durationSec?: number | null;
   };

   /** The current stored index, else one built from the segments and saved; null when there are no segments. */
   export async function ensureTranscriptSearchIndex(
     strapi: Core.Strapi,
     row: TranscriptIndexSource,
   ): Promise<StoredTranscriptIndex | null> {
     const stored = loadStoredIndex(row.searchIndex);
     if (stored) return stored;

     let rawSegments = row.rawSegments;
     let durationSec = row.durationSec;
     if (rawSegments === undefined) {
       const full = (await strapi.documents(TRANSCRIPT as never).findOne({
         documentId: row.documentId,
         fields: ['rawSegments', 'durationSec'],
       } as never)) as { rawSegments?: TimedTextSegment[] | null; durationSec?: number | null } | null;
       rawSegments = full?.rawSegments ?? null;
       durationSec = full?.durationSec ?? durationSec ?? null;
     }

     const built = buildTranscriptSearchIndex(rawSegments, durationSec);
     if (!built) return null;
     try {
       await strapi.documents(TRANSCRIPT as never).update({
         documentId: row.documentId,
         data: { searchIndex: built } as never,
       });
       strapi.log.info(`[yt-kb] built transcript search index for ${row.documentId} (${built.bm25.chunks.length} chunks)`);
     } catch (err) {
       // The search still runs on the index in hand; the next reader retries the save.
       const message = err instanceof Error ? err.message : String(err);
       strapi.log.warn(`[yt-kb] could not save transcript search index for ${row.documentId}: ${message}`, {
         documentId: row.documentId,
         message,
       });
     }
     return built;
   }
   ```

8. **`server/src/plugins/yt-kb/server/src/services/bm25-search.ts` — edit the header comment only** (lines 1–12) to:

   ```ts
   // BM25 search against a persisted index — the read side for the MCP
   // `searchTranscript` and `crossSearchTranscripts` tools. They read the app's
   // contextual index on `Video.transcriptSegments` when it is current, else the
   // transcript's own model-free index (`Transcript.searchIndex`, see
   // ./search-index.ts), rather than rebuilding one per query.
   //
   // The scoring lives in ./bm25-core, which this plugin owns; the client
   // carries a generated copy, so "results are identical to what the in-app
   // chat sees" is enforced by `bm25-core.sync.test.ts`. This file re-exports
   // what the tools need and adds the one helper they use that is not scoring.
   ```

9. **`server/src/plugins/yt-kb/server/src/mcp/tools/search-transcript.ts` — replace the whole file:**

   ```ts
   // BM25 search within a single transcript, in this order:
   //   1. the app's contextual index on Video.transcriptSegments, when current;
   //   2. the transcript's model-free index (Transcript.searchIndex), built and
   //      saved on first use — so a video added over MCP, or a transcript
   //      fetched without a Video row, is searchable too;
   //   3. substring scoring over the raw segments (reached only when the
   //      segments yield no index).

   import { z } from '@strapi/utils';
   import type { ToolDef } from '../registry';
   import { formatTimecode, loadStoredIndex, searchBM25, type TranscriptChunk } from '../../services/bm25-search';
   import { ensureTranscriptSearchIndex, type TranscriptIndexSource } from '../../services/search-index';

   const schema = z.object({
     videoId: z.string().min(1).describe('YouTube video id to search within.'),
     query: z
       .string()
       .min(2)
       .max(300)
       .describe('Natural-language search query. Multi-word phrases work; stopwords are ignored.'),
     k: z.number().int().min(1).max(25).default(8).describe('Top-k chunks to return. Default 8.'),
   });

   type TranscriptRow = TranscriptIndexSource & { title?: string | null };
   type VideoRow = {
     youtubeVideoId: string;
     videoTitle?: string | null;
     transcriptSegments?: unknown;
     transcript?: TranscriptRow | null;
   };

   const TRANSCRIPT_FIELDS = ['title', 'searchIndex', 'rawSegments', 'durationSec'];

   export const searchTranscriptTool: ToolDef<z.infer<typeof schema>> = {
     name: 'searchTranscript',
     description:
       'BM25 full-text search INSIDE a single already-known transcript. REQUIRES a videoId — do not call this when the user only gave you a title or description; use `searchVideos` first to find the videoId. Returns top-k passages with timecodes, ideal for answering fine-grained questions grounded in that video. Works for any stored transcript, summarized or not. Use `findTranscripts` for cross-video discovery, `searchVideos` for catalog-level title lookup.',
     schema,
     execute: async ({ videoId, query, k }, { strapi }) => {
       const video = (await strapi.documents('plugin::yt-kb.video').findFirst({
         filters: { youtubeVideoId: { $eq: videoId } },
         fields: ['youtubeVideoId', 'videoTitle', 'transcriptSegments'],
         populate: { transcript: { fields: TRANSCRIPT_FIELDS } },
       } as never)) as unknown as VideoRow | null;

       // 1. The app's contextual index.
       const videoIndex = loadStoredIndex(video?.transcriptSegments);
       if (video && videoIndex) {
         return {
           videoId,
           title: video.videoTitle ?? null,
           source: 'bm25',
           query,
           results: searchBM25(videoIndex.bm25, query, k).map((r) => formatResult(r.chunk, r.score)),
         };
       }

       const transcript =
         video?.transcript ??
         ((await strapi.documents('plugin::yt-kb.transcript').findFirst({
           filters: { youtubeVideoId: { $eq: videoId } },
           fields: TRANSCRIPT_FIELDS,
         } as never)) as unknown as TranscriptRow | null);
       if (!video && !transcript) {
         return { error: `No video or transcript found for videoId "${videoId}".` };
       }
       const title = video?.videoTitle ?? transcript?.title ?? null;

       // 2. The transcript's own index.
       const transcriptIndex = transcript ? await ensureTranscriptSearchIndex(strapi, transcript) : null;
       if (transcriptIndex) {
         return {
           videoId,
           title,
           source: 'bm25-transcript',
           query,
           results: searchBM25(transcriptIndex.bm25, query, k).map((r) => formatResult(r.chunk, r.score)),
         };
       }

       // 3. Substring fallback.
       const segments = transcript?.rawSegments ?? [];
       if (segments.length === 0) {
         return { error: `No searchable transcript for videoId "${videoId}". Call fetchTranscript to store one.` };
       }
       const q = query.toLowerCase();
       const hits = segments
         .map((seg, idx) => ({
           seg,
           idx,
           score: (seg.text.toLowerCase().match(new RegExp(escapeRegex(q), 'g')) ?? []).length,
         }))
         .filter((h) => h.score > 0)
         .sort((a, b) => b.score - a.score)
         .slice(0, k);

       return {
         videoId,
         title,
         source: 'substring',
         query,
         results: hits.map((h) => ({
           timecode: formatTimecode(Math.floor(h.seg.startMs / 1000)),
           timeSec: Math.floor(h.seg.startMs / 1000),
           text: h.seg.text,
           score: h.score,
         })),
       };
     },
   };

   function formatResult(chunk: TranscriptChunk, score: number) {
     return {
       timecode: formatTimecode(chunk.timeSec),
       timeSec: chunk.timeSec,
       text: chunk.text,
       score: Number(score.toFixed(4)),
     };
   }

   function escapeRegex(s: string): string {
     return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   }
   ```

10. **`server/src/plugins/yt-kb/server/src/mcp/tools/cross-search-transcripts.ts` — replace the whole file:**

    ```ts
    // BM25 search across many transcripts in one call: the top-k chunks per
    // video, videos ordered by their best hit. Each video is searched with the
    // app's contextual index (Video.transcriptSegments) when current, else its
    // transcript's model-free index (built and saved on first use). Every video
    // with a stored transcript is searched, summarized or not — a video added
    // over MCP is still `pending` and must not be invisible here. There is no
    // substring fallback: it needs the segments, and segments always yield an
    // index.
    //
    // Optional tag filter so the scope matches the user's framing ("what do my
    // rag videos say about chunking?" → tags: ['rag'], query: 'chunking').
    // Capped per video to keep the response small — call `searchTranscript`
    // on one video for more.

    import { z } from '@strapi/utils';
    import type { ToolDef } from '../registry';
    import { normalizeTagName } from '../../document-rules';
    import { formatTimecode, loadStoredIndex, searchBM25, type StoredTranscriptIndex } from '../../services/bm25-search';
    import { ensureTranscriptSearchIndex, type TranscriptIndexSource } from '../../services/search-index';

    const schema = z.object({
      query: z.string().min(2).max(300),
      tags: z
        .array(z.string().min(1).max(40))
        .max(10)
        .optional()
        .describe('Optional tag filter — limit the search to videos with any of these tags.'),
      perVideo: z.number().int().min(1).max(10).default(3).describe('Max chunks to return per video.'),
      maxVideos: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .describe('Max videos to scan, newest first. Videos with no stored transcript are skipped.'),
    });

    type VideoRow = {
      youtubeVideoId: string;
      videoTitle?: string | null;
      summaryTitle?: string | null;
      transcriptSegments?: unknown;
      tags?: Array<{ name: string }>;
      transcript?: TranscriptIndexSource | null;
    };

    export const crossSearchTranscriptsTool: ToolDef<z.infer<typeof schema>> = {
      name: 'crossSearchTranscripts',
      description:
        'BM25 search across multiple transcripts in a single call. Returns top-k passages per matching video with timecodes — ideal for "what do my `rag` videos say about chunking?" style questions. Optional tag filter scopes the search. Use `searchTranscript` instead when you already know the specific videoId.',
      schema,
      execute: async ({ query, tags, perVideo, maxVideos }, { strapi }) => {
        const filters: Record<string, unknown> = {};
        if (tags && tags.length > 0) {
          filters.tags = { name: { $in: tags.map(normalizeTagName) } };
        }

        const videos = (await strapi.documents('plugin::yt-kb.video').findMany({
          filters,
          limit: maxVideos,
          sort: 'createdAt:desc',
          fields: ['youtubeVideoId', 'videoTitle', 'summaryTitle', 'transcriptSegments'],
          populate: {
            tags: { fields: ['name'] },
            // rawSegments is left out: search-index.ts reads it only to build a missing index.
            transcript: { fields: ['searchIndex', 'durationSec'] },
          },
        } as never)) as unknown as VideoRow[];

        const perVideoResults: Array<{
          youtubeVideoId: string;
          videoTitle: string | null;
          tags: string[];
          indexSource: 'bm25' | 'bm25-transcript';
          topScore: number;
          passages: Array<{ timecode: string; timeSec: number; text: string; score: number }>;
        }> = [];

        for (const v of videos) {
          let index: StoredTranscriptIndex | null = loadStoredIndex(v.transcriptSegments);
          let indexSource: 'bm25' | 'bm25-transcript' = 'bm25';
          if (!index && v.transcript) {
            index = await ensureTranscriptSearchIndex(strapi, v.transcript);
            indexSource = 'bm25-transcript';
          }
          if (!index) continue;
          const ranked = searchBM25(index.bm25, query, perVideo);
          if (ranked.length === 0) continue;
          perVideoResults.push({
            youtubeVideoId: v.youtubeVideoId,
            videoTitle: v.videoTitle ?? v.summaryTitle ?? null,
            tags: (v.tags ?? []).map((t) => t.name),
            indexSource,
            topScore: ranked[0].score,
            passages: ranked.map((r) => ({
              timecode: formatTimecode(r.chunk.timeSec),
              timeSec: r.chunk.timeSec,
              text: r.chunk.text,
              score: Number(r.score.toFixed(4)),
            })),
          });
        }
        // Strongest matches first.
        perVideoResults.sort((a, b) => b.topScore - a.topScore);

        return {
          query,
          tags: tags ?? null,
          videosScanned: videos.length,
          videosWithHits: perVideoResults.length,
          results: perVideoResults,
          ...(perVideoResults.length === 0
            ? {
                hint: "No transcripts had passages matching that query. Try different terms, drop the tag filter, or call `listVideos` to see what's actually in the KB.",
              }
            : {}),
        };
      },
    };
    ```

    The `summaryStatus: 'generated'` filter is removed on purpose (M-11: a pending, MCP-added video must be searchable). These two tools are the only readers of `transcriptSegments` as an index in the plugin (`git grep -n "transcriptSegments" -- server/src/plugins/yt-kb/server/src`: `get-video.ts` strips it, `related-videos.ts` only mentions it in a comment).

11. **`server/src/plugins/yt-kb/server/src/mcp/tools/save-summary.ts` — replace the whole file:**

    ```ts
    // Persist a summary the calling agent generated (e.g. Claude) to an existing
    // Video row, in the shape the app's pipeline writes
    // (client/src/lib/services/learning.ts).
    //
    // Section timecodes are not taken from the caller — the input has none. As
    // in the app, each section's moment is found in the transcript: BM25 over
    // the transcript's model-free index (Transcript.searchIndex, built here if
    // missing) with "<heading>. <body>" as the query, through
    // findEvidenceForQuote with minimum score 1.0 — the same call the app's
    // summary pipeline makes (client/src/lib/services/learning.ts). A section
    // with no match at or above that score gets timeSec null. CLAUDE.md: never
    // trust a timecode a model produced.
    //
    // This tool does not build Video.transcriptSegments, the app's contextual
    // index; the search tools use the transcript's index when it is missing.

    import { z } from '@strapi/utils';
    import type { ToolDef } from '../registry';
    import { findEvidenceForQuote } from '../../services/bm25-core';
    import { ensureTranscriptSearchIndex, type TranscriptIndexSource } from '../../services/search-index';
    import { resolveByEitherId } from './video-access';

    const SectionSchema = z.object({
      heading: z.string().min(1).max(200),
      body: z.string().min(1).max(2000),
    });

    const TakeawaySchema = z.object({
      text: z.string().min(1).max(280),
    });

    const ActionStepSchema = z.object({
      title: z.string().min(1).max(120),
      body: z.string().min(1).max(600),
    });
    ```

    Then the `schema` object exactly as at 721f210 (lines 31-66, unchanged), then:

    ```ts
    type VideoForSummary = {
      documentId: string;
      youtubeVideoId: string;
      transcript?: TranscriptIndexSource | null;
    };

    export const saveSummaryTool: ToolDef<z.infer<typeof schema>> = {
      name: 'saveSummary',
      description:
        'Persist an AI-generated summary (title, description, overview, sections, key takeaways, action steps) to an existing Video. Do not send section timecodes: this tool finds each section in the transcript itself. Use this after generating a summary with a frontier model so it shows up in the app UI alongside locally-generated ones.',
      schema,
      execute: async (args, { strapi }) => {
        const video = await resolveByEitherId<VideoForSummary>(strapi, args.videoId, {
          populate: { transcript: { fields: ['searchIndex', 'durationSec'] } },
        });
        if (!video) {
          return { error: `No video found for "${args.videoId}". Call addVideo first.` };
        }

        // The linked transcript, else the stored one for this id.
        const transcript =
          video.transcript ??
          ((await strapi.documents('plugin::yt-kb.transcript').findFirst({
            filters: { youtubeVideoId: { $eq: video.youtubeVideoId } },
            fields: ['searchIndex', 'durationSec'],
          } as never)) as unknown as TranscriptIndexSource | null);
        const index = transcript ? await ensureTranscriptSearchIndex(strapi, transcript) : null;

        // Same query, function and threshold as the app (learning.ts).
        const SECTION_MIN_SCORE = 1.0;
        const sections = args.sections.map(({ heading, body }) => ({
          heading,
          body,
          timeSec: index
            ? (findEvidenceForQuote(`${heading}. ${body}`, index.bm25, SECTION_MIN_SCORE)?.timeSec ?? null)
            : null,
        }));

        const updated = await strapi.documents('plugin::yt-kb.video').update({
          documentId: video.documentId,
          data: {
            summaryStatus: 'generated',
            summaryTitle: args.summaryTitle,
            summaryDescription: args.summaryDescription,
            summaryOverview: args.summaryOverview,
            watchVerdict: args.watchVerdict,
            verdictSummary: args.verdictSummary,
            verdictReason: args.verdictReason,
            summaryGeneratedAt: new Date().toISOString(),
            aiModel: args.aiModel ?? null,
            keyTakeaways: args.keyTakeaways,
            sections,
            actionSteps: args.actionSteps,
          } as Record<string, unknown>,
        });

        return {
          videoDocumentId: (updated as { documentId: string }).documentId,
          youtubeVideoId: video.youtubeVideoId,
          summaryStatus: 'generated',
          sectionCount: sections.length,
          sectionsWithTimecode: sections.filter((s) => s.timeSec !== null).length,
          takeawayCount: args.keyTakeaways.length,
          actionStepCount: args.actionSteps.length,
        };
      },
    };
    ```

    A caller that still sends `sections[].timeSec` is not rejected: `z.object` strips unknown keys, so the value is dropped and the grounded one stored.

12. **`CLAUDE.md` — edit** ("Stored BM25 index invalidation"):
    - line 156: `` `CURRENT_INDEX_PARAMS` in `client/src/lib/services/bm25-core.ts` `` → `` `CURRENT_INDEX_PARAMS` in `server/src/plugins/yt-kb/server/src/services/bm25-core.ts` ``;
    - lines 169–172 → `The scorer, the cleaner, the retrieval chunker and the timecode grounding live in the plugin's \`server/src/plugins/yt-kb/server/src/services/bm25-core.ts\`, copied verbatim into \`client/src/lib/services/bm25-core.ts\` by \`yarn sync:bm25\`; the two halves stay identical because \`bm25-core.sync.test.ts\` fails if they drift. Edit the plugin copy, never the client one. The plugin also stores a model-free index on every transcript (\`Transcript.searchIndex\`, same \`CURRENT_INDEX_PARAMS\`), so the same bump makes those stale too; the search tools rebuild them on first use.`

13. **Plugin tests — new files** (vitest). Shared fixture **`server/src/plugins/yt-kb/server/src/__fixtures__/eight-topics.ts`** — not a `*.test.ts` file, so also add `"**/__fixtures__/**"` to the `exclude` array of `server/src/plugins/yt-kb/server/tsconfig.build.json` (it becomes `["**/*.test.ts", "**/__fixtures__/**"]`), which keeps it out of `dist/`; `test:ts:back` (`server/tsconfig.json`) still typechecks it:

    ```ts
    // Eight 260-word topics, one caption segment each, a minute apart. The
    // expected timecodes in the M4 tests were computed with bm25-core at 721f210,
    // grounding with findEvidenceForQuote(`${heading}. ${body}`, bm25, 1.0) as
    // the app does (recomputed 2026-11-08: top scores 13.267 and 16.584; the
    // third section matches no term).
    export const TOPICS = [
      ['kubernetes', 'scheduler', 'pods', 'nodes', 'cluster', 'autoscaling'],
      ['sourdough', 'bread', 'flour', 'yeast', 'starter', 'oven'],
      ['marathon', 'training', 'running', 'pace', 'mileage', 'tempo'],
      ['telescope', 'galaxy', 'nebula', 'orbit', 'planet', 'comet'],
      ['espresso', 'grinder', 'crema', 'roast', 'barista', 'portafilter'],
      ['violin', 'orchestra', 'symphony', 'conductor', 'rehearsal', 'concerto'],
      ['glacier', 'avalanche', 'summit', 'crampons', 'altitude', 'ridge'],
      ['compiler', 'parser', 'lexer', 'bytecode', 'optimizer', 'linker'],
    ];
    const words = (v: string[], n: number) => Array.from({ length: n }, (_, i) => v[i % v.length]).join(' ');
    export const RAW_SEGMENTS = TOPICS.map((v, i) => ({
      text: words(v, 260),
      startMs: i * 60_000,
      endMs: i * 60_000 + 59_000,
    }));
    export const DURATION_SEC = 480;
    export const SECTIONS = [
      { heading: 'Pulling an espresso shot', body: 'Grinder settings, crema and the portafilter.' },
      { heading: 'Marathon training plan', body: 'Weekly mileage, tempo runs and race pace.' },
      { heading: 'Quantum chromodynamics', body: 'Gluon confinement and asymptotic freedom.' },
    ];
    /** Grounded timeSec per SECTIONS entry. */
    export const EXPECTED_SECTION_TIMES = [240, 120, null];
    ```

    Facts the tests rely on (computed against 721f210's code): `chunkForRetrieval(prepareSegmentedTranscript(RAW_SEGMENTS), 480)` gives 16 chunks with `timeSec` `0,0,60,60,120,120,180,180,240,240,300,300,360,360,420,420`; `searchBM25Ranked(index, 'espresso crema', 1)[0].chunk.timeSec === 240`; an index built with the contextualizer `(c) => (c.id === 9 ? \`zebracontext ${c.text}\` : c.text)` returns chunk 9 (`timeSec` 240) for `'zebracontext'`, and the plain index returns no result for it.

    Fake Strapi used by 13b–13c: `documents(uid)` returns a per-uid object of `vi.fn`s (`findFirst`, `findOne`, `findMany`, `update`), `log: { info, warn, debug, error }`.

    | File | Case | Expect |
    |---|---|---|
    | 13a `services/search-index.test.ts` | `buildTranscriptSearchIndex(RAW_SEGMENTS, 480)` | `storedIndexStatus(result) === 'current'`, 16 chunks, `result.rawSegments` equals `RAW_SEGMENTS`, `result.durationSec === 480` |
    | | `buildTranscriptSearchIndex([], 480)` and `(null, null)` | `null` |
    | | `ensure…` with `searchIndex` = a current index | returns it; `update` and `findOne` not called |
    | | `ensure…` with `searchIndex: null`, `rawSegments: RAW_SEGMENTS` | `update` called once with `{ documentId, data: { searchIndex } }`, `storedIndexStatus(searchIndex) === 'current'` |
    | | `ensure…` with a stale index (`params.tokenizer: 1`) and segments | rebuilt and saved (as above) |
    | | `ensure…` with no `rawSegments` key | `findOne` called with `fields: ['rawSegments', 'durationSec']`, then `update` |
    | | `ensure…` with `rawSegments: null` | `null`; `update` not called |
    | | `update` rejects | still returns the built index; `log.warn` called once |
    | 13b `mcp/tools/search-tools.test.ts` | `searchTranscript` — video with a current contextual `transcriptSegments` (zebracontext build), query `'zebracontext'` | `source: 'bm25'`, `results[0].timeSec === 240`; transcript `update` not called |
    | | video with `transcriptSegments: null`, transcript `{ documentId: 't2', searchIndex: null, rawSegments: RAW_SEGMENTS, durationSec: 480 }`, query `'espresso crema'` | `source: 'bm25-transcript'`, `results[0].timeSec === 240`; transcript `update` called once |
    | | same, query `'zebracontext'` | `source: 'bm25-transcript'`, `results` `[]` |
    | | no video; transcript `findFirst` returns `{ documentId: 't5', title: 'T', rawSegments: RAW_SEGMENTS }` | `source: 'bm25-transcript'`, `title: 'T'` |
    | | no video, no transcript | `{ error: 'No video or transcript found for videoId "…".' }` |
    | | video, transcript with `rawSegments: [{ text: '[Music]', startMs: 0 }]` (cleans to nothing → no index), query `'music'` | `source: 'substring'` |
    | | `crossSearchTranscripts` — `findMany` returns [contextual video A, pending video B with transcript `{ documentId: 'tB', searchIndex: null }` (no `rawSegments` key), video C with `transcript: null`]; transcript `findOne` returns `{ rawSegments: RAW_SEGMENTS, durationSec: 480 }`; query `'espresso crema'` | `videosScanned: 3`; results contain A with `indexSource: 'bm25'` and B with `indexSource: 'bm25-transcript'`, not C; `findMany` was called without a `summaryStatus` filter |
    | 13c `mcp/tools/save-summary.test.ts` | video `findFirst` returns `{ documentId: 'v2', youtubeVideoId: 'm4LazyVid01', transcript: { documentId: 't2', searchIndex: null, rawSegments: RAW_SEGMENTS, durationSec: 480 } }`; `args = saveSummaryTool.schema.parse({ …, sections: [{ ...SECTIONS[0], timeSec: 999 }, SECTIONS[1], SECTIONS[2]] })` | video `update` called with `data.sections.map(s => s.timeSec)` equal to `EXPECTED_SECTION_TIMES` (`[240, 120, null]`) **and** equal to `SECTIONS.map(s => findEvidenceForQuote(\`${s.heading}. ${s.body}\`, buildTranscriptSearchIndex(RAW_SEGMENTS, 480)!.bm25, 1.0)?.timeSec ?? null)` — the app's grounding call on the same fixture; result `sectionsWithTimecode: 2`, `youtubeVideoId: 'm4LazyVid01'` |
    | | video with `transcript: null` and transcript `findFirst` → `null` | every stored `timeSec` is `null`; `sectionsWithTimecode: 0` |
    | | `saveSummaryTool.schema.parse(...)` with a section `timeSec: 5` | the parsed section has no `timeSec` key |
    | 13d extend `services/fetcher.test.ts` (M3) | the success case | `create` data has `searchIndex` with `storedIndexStatus === 'current'` and `bm25.chunks.length > 0` |

#### Data

No migration. Existing transcripts get `searchIndex` the first time a search tool or `saveSummary` reads them, or on their next fetch; every new fetch writes it. `Video.transcriptSegments` is not touched. The lazy write is tested on a copy of real data (Verify step 5).

#### Callers updated

- Moved functions: every importer goes through `transcript.ts`'s re-exports (list in step 4); `learning.ts` (`chunkForRetrieval`, `findEvidenceForQuote`, `prepareSegmentedTranscript`, `cleanTranscript`), `transcript-index.ts`, `notes.ts`, `reader.ts`, `content-signals.ts`, `api.notes.compose.tsx` need no edit.
- `bm25-core.ts` ownership: `scripts/sync-bm25-core.mjs`, `bm25-core.sync.test.ts`, both header comments, `bm25-search.ts`'s header, `CLAUDE.md`. Root `package.json` `sync:bm25` script is unchanged.
- `saveSummary` input (no `timeSec`): MCP clients only; the app never calls it (`git grep -n saveSummary -- client/src` lists nothing).
- `searchTranscript` output (`source` may now be `'bm25-transcript'`) and `crossSearchTranscripts` output (new `indexSource` per result, pending videos included): MCP clients only. M5 renames both tools and must keep these bodies.
- `searchIndex` private: content-API readers of transcripts — `client/src/lib/services/videos.ts` (`fetchTranscriptByVideoIdService`, `requestTranscriptFetchService`), `server/src/plugins/yt-kb/scripts/copy-content.mjs` — never read it.

#### Verify

1. Gates:
   - `yarn sync:bm25 --check` → exit 0 and `bm25-core copy is up to date.`
   - `head -1 client/src/lib/services/bm25-core.ts` → `// GENERATED FILE — DO NOT EDIT.`; `grep -c 'GENERATED FILE' server/src/plugins/yt-kb/server/src/services/bm25-core.ts` → `0`.
   - Index parameters unchanged: `node --experimental-strip-types -e "import('./client/src/lib/services/bm25-core.ts').then(m => console.log(JSON.stringify(m.CURRENT_INDEX_PARAMS)))" | jq -e '. == {"chunkWords":150,"chunkOverlap":20,"tokenizer":2}'`.
   - `yarn --cwd server/src/plugins/yt-kb test` → exit 0 (13a–13d). `yarn --cwd server/src/plugins/yt-kb test:ts:back`, `yarn --cwd server/src/plugins/yt-kb build`, `(cd client && npx tsc --noEmit)`, `(cd server && npx tsc --noEmit)` → exit 0.
   - `yarn test` → exit 0 with the same count as after M3 (no client test added; `transcript.test.ts`, `retrieval.equivalence.test.ts`, `bm25-core.invalidation.test.ts`, `learning.draft.test.ts` pass unchanged).
   - Negative — drift is caught: `printf '\n// drift\n' >> client/src/lib/services/bm25-core.ts && (yarn --cwd client test src/lib/services/bm25-core.sync.test.ts; echo "exit=$?")` → prints `exit=1`; then `yarn sync:bm25 --check` → exit 1; then restore with `yarn sync:bm25` and `git diff --exit-code client/src/lib/services/bm25-core.ts` → exit 0.

2. **Scratch fixtures** — a fresh DB `server/.tmp/e8-m4.db`, port 1341, dead proxy as in M3, the kit as extended in M3 Verify 2. In every shell: `K=server/.tmp/e8/e8.mjs; T=server/.tmp/e8/tokens.json; A=server/.tmp/e8/admin.json; DB=server/.tmp/e8-m4.db`. Ports 1340, 1341 and 3005 free (M1 precondition 1). Create `server/.tmp/e8/m4-fixtures.mjs` (Node runs the `.ts` import with type stripping — native from Node 22.18 / 23.6, the flag below covers older 22.x). It writes rows only, with Strapi stopped, through the Document Service (the stale fixture needs the private `searchIndex`); it creates no token:

   ```js
   // (cd server && env DATABASE_FILENAME=.tmp/e8-m4.db PROXY_URL=http://127.0.0.1:9 node --experimental-strip-types .tmp/e8/m4-fixtures.mjs)
   import { createRequire } from 'node:module';
   import { basename, dirname, join } from 'node:path';
   import { fileURLToPath, pathToFileURL } from 'node:url';

   const HERE = dirname(fileURLToPath(import.meta.url));
   const SERVER = join(HERE, '..', '..');
   const REPO = join(SERVER, '..');
   const require = createRequire(import.meta.url);
   if (basename(process.env.DATABASE_FILENAME ?? '') !== 'e8-m4.db') {
     console.error(JSON.stringify({ ok: false, error: 'refusing: DATABASE_FILENAME is not .tmp/e8-m4.db' }));
     process.exit(2);
   }
   const core = await import(pathToFileURL(join(REPO, 'client/src/lib/services/bm25-core.ts')).href);
   process.chdir(SERVER);
   const { createStrapi } = require(join(SERVER, 'node_modules/@strapi/strapi'));

   const app = await createStrapi({ appDir: SERVER, distDir: join(SERVER, 'dist') }).load();
   try {
     const TOPICS = [
       ['kubernetes', 'scheduler', 'pods', 'nodes', 'cluster', 'autoscaling'],
       ['sourdough', 'bread', 'flour', 'yeast', 'starter', 'oven'],
       ['marathon', 'training', 'running', 'pace', 'mileage', 'tempo'],
       ['telescope', 'galaxy', 'nebula', 'orbit', 'planet', 'comet'],
       ['espresso', 'grinder', 'crema', 'roast', 'barista', 'portafilter'],
       ['violin', 'orchestra', 'symphony', 'conductor', 'rehearsal', 'concerto'],
       ['glacier', 'avalanche', 'summit', 'crampons', 'altitude', 'ridge'],
       ['compiler', 'parser', 'lexer', 'bytecode', 'optimizer', 'linker'],
     ];
     const words = (v, n) => Array.from({ length: n }, (_, i) => v[i % v.length]).join(' ');
     const rawSegments = TOPICS.map((v, i) => ({ text: words(v, 260), startMs: i * 60000, endMs: i * 60000 + 59000 }));
     const rawText = rawSegments.map((s) => s.text).join(' ');
     const chunks = core.chunkForRetrieval(core.prepareSegmentedTranscript(rawSegments), 480);
     const contextual = core.makeStoredIndex(
       core.buildBM25Index(chunks, (c) => (c.id === 9 ? `zebracontext ${c.text}` : c.text)),
       { rawSegments, durationSec: 480 },
     );
     const stale = {
       ...core.makeStoredIndex(core.buildBM25Index(chunks), { rawSegments, durationSec: 480 }),
       params: { chunkWords: 150, chunkOverlap: 20, tokenizer: 1 },
     };
     const Tr = app.documents('plugin::yt-kb.transcript');
     const V = app.documents('plugin::yt-kb.video');
     const mkT = (id, extra = {}) => Tr.create({ data: { youtubeVideoId: id, title: `Fixture ${id}`, language: 'en', durationSec: 480, rawSegments, rawText, fetchedAt: new Date().toISOString(), ...extra } });
     const url = (id) => `https://www.youtube.com/watch?v=${id}`;
     const t1 = await mkT('m4CtxVideo1');
     await V.create({ data: { youtubeVideoId: 'm4CtxVideo1', url: url('m4CtxVideo1'), summaryStatus: 'generated', transcriptSegments: contextual, transcript: t1.documentId } });
     const t2 = await mkT('m4LazyVid01');
     await V.create({ data: { youtubeVideoId: 'm4LazyVid01', url: url('m4LazyVid01'), summaryStatus: 'pending', transcript: t2.documentId } });
     const t3 = await mkT('m4StaleVid1', { searchIndex: stale });
     await V.create({ data: { youtubeVideoId: 'm4StaleVid1', url: url('m4StaleVid1'), summaryStatus: 'generated', transcriptSegments: stale, transcript: t3.documentId } });
     await mkT('m4OnlyTrans');
     await V.create({ data: { youtubeVideoId: 'm4NoTrans01', url: url('m4NoTrans01'), summaryStatus: 'pending' } });
     console.log(JSON.stringify({ ok: true }));
   } finally {
     await app.destroy();
   }
   process.exit(0);
   ```

   Then:

   ```bash
   yarn --cwd server/src/plugins/yt-kb build && yarn --cwd server build
   rm -f server/.tmp/e8-m4.db*
   (cd server && DATABASE_FILENAME=.tmp/e8-m4.db yarn -s strapi admin:create-user --email="$(node -p 'require("./.tmp/e8/admin.json").email')" --password="$(node -p 'require("./.tmp/e8/admin.json").password')" --firstname=E8 --lastname=Check)
   (cd server && env DATABASE_FILENAME=.tmp/e8-m4.db PROXY_URL=http://127.0.0.1:9 node --experimental-strip-types .tmp/e8/m4-fixtures.mjs) | jq -e '.ok == true'
   (cd server && DATABASE_FILENAME=.tmp/e8-m4.db PROXY_URL=http://127.0.0.1:9 PORT=1341 HOST=127.0.0.1 nohup yarn develop > .tmp/e8/m4-strapi.log 2>&1 &)
   node $K wait http://127.0.0.1:1341/_health 300
   node $K admin-tokens http://127.0.0.1:1341 $A $T plugin::yt-kb.read,plugin::yt-kb.write
   node $K token $T $A app content-api plugin::yt-kb.transcript.find
   mcp() { node $K mcpx $T mcp tools/call "{\"name\":\"$1\",\"arguments\":$2}"; }
   tidx() { node $K sql $DB "select json_extract(search_index,'\$.version') v, json_extract(search_index,'\$.params.tokenizer') t, json_array_length(search_index,'\$.bm25.chunks') n, updated_at u from yt_kb_transcripts where youtube_video_id='$1'"; }
   ```

   → create-user exits 0 (it also creates the schema on the fresh file); fixtures `ok`; wait → 204; `admin-tokens` → `"ok": true`; `token` → `"ok": true`.

3. **Search order, through the MCP handlers** (each `mcp …` prints `{ initStatus, httpStatus, rpcError, result }`; `result.structuredContent` is the tool's result object):
   - Video index first: `mcp searchTranscript '{"videoId":"m4CtxVideo1","query":"zebracontext","k":3}' | jq -e '(.result.isError // false)==false and (.result.structuredContent | .source=="bm25" and .results[0].timeSec==240)'`; and no transcript index was built for it: `node $K sql $DB "select search_index is null as n from yt_kb_transcripts where youtube_video_id='m4CtxVideo1'" | jq -e '.rows[0].n==1'`.
   - Lazy build on a pending (MCP-style) video: `mcp searchTranscript '{"videoId":"m4LazyVid01","query":"espresso crema","k":3}' | jq -e '.result.structuredContent | .source=="bm25-transcript" and .results[0].timeSec==240'`; `tidx m4LazyVid01 | jq -e '.rows[0].v==2 and .rows[0].t==2 and .rows[0].n==16'`; record `U1=$(tidx m4LazyVid01 | jq -r '.rows[0].u')`.
   - Built once: run the same search again, then `[ "$(tidx m4LazyVid01 | jq -r '.rows[0].u')" = "$U1" ]`.
   - Negative — it really is the plain index: `mcp searchTranscript '{"videoId":"m4LazyVid01","query":"zebracontext"}' | jq -e '.result.structuredContent | .source=="bm25-transcript" and (.results|length)==0'`.
   - Stale indexes are not trusted: `mcp searchTranscript '{"videoId":"m4StaleVid1","query":"espresso crema"}' | jq -e '.result.structuredContent.source=="bm25-transcript"'`; `tidx m4StaleVid1 | jq -e '.rows[0].t==2'`.
   - Transcript with no Video row: `mcp searchTranscript '{"videoId":"m4OnlyTrans","query":"espresso crema"}' | jq -e '.result.structuredContent | .source=="bm25-transcript" and .title=="Fixture m4OnlyTrans"'`.
   - Negative — no transcript: `mcp searchTranscript '{"videoId":"m4NoTrans01","query":"espresso crema"}' | jq -e '.result.structuredContent.error|test("No searchable transcript")'`.
   - Cross search includes the pending video: `mcp crossSearchTranscripts '{"query":"espresso crema","perVideo":1,"maxVideos":10}' | jq -e '.result.structuredContent | .videosScanned==4 and ([.results[]|{id:.youtubeVideoId,src:.indexSource}] | contains([{id:"m4CtxVideo1",src:"bm25"},{id:"m4LazyVid01",src:"bm25-transcript"},{id:"m4StaleVid1",src:"bm25-transcript"}])) and ([.results[].youtubeVideoId]|index("m4NoTrans01")==null)'`.

4. **Grounding, through `saveSummary`:**
   - `mcp saveSummary '{"videoId":"m4LazyVid01","summaryTitle":"t","summaryDescription":"d","summaryOverview":"o","watchVerdict":"skim","verdictSummary":"v","verdictReason":"r","keyTakeaways":[{"text":"k"}],"sections":[{"heading":"Pulling an espresso shot","body":"Grinder settings, crema and the portafilter.","timeSec":999},{"heading":"Marathon training plan","body":"Weekly mileage, tempo runs and race pace."},{"heading":"Quantum chromodynamics","body":"Gluon confinement and asymptotic freedom."}],"actionSteps":[{"title":"a","body":"b"}]}' | jq -e '(.result.isError // false)==false and .result.structuredContent.sectionsWithTimecode==2'`.
   - `mcp getVideo '{"videoId":"m4LazyVid01"}' | jq -e '.result.structuredContent|[.sections[].timeSec]==[240,120,null]'` (negative: the caller's 999 was not stored).
   - No transcript → no timecodes: the same `saveSummary` call with `"videoId":"m4NoTrans01"` → `jq -e '.result.structuredContent.sectionsWithTimecode==0'`.
   - `searchIndex` stays out of the content API: `node $K rest $T GET '/api/yt-kb/transcripts?filters[youtubeVideoId][$eq]=m4LazyVid01' '' app | jq -e '.status==200 and (.body.data[0]|has("searchIndex")|not) and (.body.data[0].rawSegments|length)==8'`.
   - Stop Strapi on 1341 (`lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill`) and wait until M1's port check prints `"busy":false` for 1341.

5. **On a copy of real data** (the lazy write is the only data step). The kit's `backup` reads the owner's DB through SQLite's online backup, without writing to it:
   - `node $K backup server/.tmp/data.db server/.tmp/e8-m4-real.db` → `"integrity": "ok"`; `B4=$(node $K sql server/.tmp/e8-m4-real.db "select count(*) as n from yt_kb_videos where json_extract(transcript_segments,'\$.params.tokenizer')=2" | jq -r '.rows[0].n')`.
   - Admin and server: `(cd server && DATABASE_FILENAME=.tmp/e8-m4-real.db yarn -s strapi admin:create-user --email="$(node -p 'require("./.tmp/e8/admin.json").email')" --password="$(node -p 'require("./.tmp/e8/admin.json").password')" --firstname=E8 --lastname=Check)`; `(cd server && DATABASE_FILENAME=.tmp/e8-m4-real.db PROXY_URL=http://127.0.0.1:9 PORT=1341 HOST=127.0.0.1 nohup yarn develop > .tmp/e8/m4-real-strapi.log 2>&1 &)`; `node $K wait http://127.0.0.1:1341/_health 300`; `node $K admin-tokens http://127.0.0.1:1341 $A $T plugin::yt-kb.read,plugin::yt-kb.write` (rewrites `$T` for this DB; the tokens exist only in the copy).
   - A real app-built index is still current under M4's code: `RV=$(node $K sql server/.tmp/e8-m4-real.db "select youtube_video_id as v from yt_kb_videos where json_extract(transcript_segments,'\$.params.tokenizer')=2 limit 1" | jq -r '.rows[0].v')`; `mcp searchTranscript "{\"videoId\":\"$RV\",\"query\":\"what this video explains\",\"k\":1}" | jq -e '.result.structuredContent.source=="bm25"'`.
   - `mcp crossSearchTranscripts '{"query":"what this video explains","perVideo":1,"maxVideos":100}' | jq -e '(.result.isError // false)==false and .rpcError==null'`.
   - Every index it built is current: `node $K sql server/.tmp/e8-m4-real.db "select count(*) as n from yt_kb_transcripts where search_index is not null and json_extract(search_index,'\$.params.tokenizer') is not 2" | jq -e '.rows[0].n==0'`. The app's indexes were not touched: the `B4` query again → the same number.
   - Clean up: `lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill`; `rm -f server/.tmp/e8-m4*.db* server/.tmp/e8/m4-*`.

- **Done when:** `yarn sync:bm25 --check`, the plugin suite and `yarn test` pass; the drift check fails as expected and is restored; steps 3–5 pass.
- **Rollback:** `git revert` the M4 commit (the sync script and the generated client copy revert together). `Transcript.searchIndex` values written meanwhile stay in M2's column; the reverted code neither reads nor writes them, so no data step is needed. Summaries saved over MCP while M4 ran keep their grounded timecodes, which is the correct data.
- **Env / deploy:** no variable changes. Deploy the plugin (rebuild with `yarn --cwd server/src/plugins/yt-kb build`, restart Strapi); no migration runs.

### M5 — MCP tools, permissions, ai-tools, import gate, permission seeding, token script

- **Why:** M-1 (prefixed tool names, registration and execution logged, never thrown), B-4 (per-tool permissions replacing the three tiers — the fourth parity item), B-3 / G6 (`ai-tools` service so `strapi-plugin-tanstack-ai` picks up yt-kb's tools), M-7 (import off by default, 207 on partial failure), M-14 (yt-kb actions removed from Users & Permissions Public/Authenticated in `bootstrap()`; scoped custom tokens for the app and the site), M-9 (code side: **none** — M-9 is closed by the M8 docs rule "MCP tokens hold only `plugin::yt-kb.tool.*`, no Content Manager permissions on yt-kb types"; this milestone only adds a check that such a token sees no Content Manager tool), G8 (headless agents keep working under the new names).
- **Depends on:** M1 (Strapi 5.61.0, `@strapi/utils` 5.61 with zod 4.4.3, plugin vitest harness, the guard moved into the plugin), M3 (`TranscriptFetchError`, `fetcher.getOrFetch`, the content-api and admin `GET /yt-transcript/:videoId` routes, the plugin `bootstrap`), M4 (tool bodies' search changes). Nothing in M5 changes a schema.

#### Facts this milestone relies on (checked 2026-11-08)

Read in the installed `@strapi/*` **5.52.1** under `server/node_modules` (and 5.60.0 under `/Users/paul/work/plugin-dev/strapi-prod/node_modules`); 5.61.0 is not installed on this machine, so re-open the same files after M1's upgrade and STOP if any of these differs.

1. **Where grants live.** `admin::permission` (table `admin_permissions`) has `role` (manyToOne `admin::role`) and `apiToken` (manyToOne `admin::api-token`) relations (`@strapi/admin/dist/server/server/src/content-types/Permission.js`). Link tables: `admin_permissions_role_lnk(permission_id, role_id)` and `admin_permissions_api_token_lnk(permission_id, api_token_id)`, both `ON DELETE CASCADE`. `strapi_api_token_permissions` holds **Content API** token scopes (`admin::api-token-permission`), not admin grants. Admin tokens are rows of `strapi_api_tokens` with `kind = 'admin'`.
2. **Boot order.** Plugin `bootstrap()` runs **before** admin's bootstrap: `Strapi.bootstrap()` calls `runPluginsLifecycles(BOOTSTRAP)` then each provider's `bootstrap` (`@strapi/core/dist/Strapi.js:400-403`), and admin is a provider (`providers/admin.js`, `providers/index.js`). Admin's bootstrap then runs `resetSuperAdminPermissions()` (super-admin gets every registered action) and `cleanPermissionsInDatabase()` (deletes rows whose action is not registered) (`@strapi/admin/.../bootstrap.js:163-167`). So a plugin-bootstrap migration sees the legacy rows before any cleanup, and anything it deletes from the **super-admin** role is re-created by the reset on the same boot.
3. **MCP auth.** `/mcp` authenticates admin tokens only (`@strapi/core/dist/services/mcp/authentication.js`; `api-token.js` `authenticateAdminToken`, ability from the token's `adminPermissions`). `registerTool` throws synchronously on a duplicate name or on a call after the MCP server started (`services/mcp/index.js:46-50`, `internal/McpCapabilityDefinitionRegistry.js:18-21`). Strapi wraps a throwing handler as `Tool "<name>" execution failed: <message>`, `isError: true` (`services/mcp/tool-registry.js:82-91`).
4. **Admin routes accept admin tokens** (strategy `admin-token` registered in `@strapi/admin/.../register.js:14-15`), so M3's admin route can be checked with a script-minted admin token.
5. **Content API custom tokens.** `strapi.service('admin::api-token-content-api').create({ name, description, type: 'custom', lifespan, permissions: string[] })` adds `kind: 'content-api'`, rejects unknown action ids, returns `{ id, accessKey, permissions: string[] }` (`api-token.js:591-640`, `createTokenService` `:1009-1015`). Action ids for plugin routes are `plugin::yt-kb.<controller>.<action>`.
6. **Users & Permissions.** `plugin::users-permissions.permission` (table `up_permissions`) has `action` and `role` (manyToOne `plugin::users-permissions.role`); roles carry `type` (`public`, `authenticated`, …). `$startsWith` is a supported operator (`@strapi/database/dist/query/helpers/where.js:255`); `deleteMany` with ids is safe; SQLite runs with `foreign_keys = on` (`dialects/sqlite/index.js:34`), so link rows cascade.
7. **tanstack-ai contract** (`TS` = `strapi-plugin-tanstack-ai` 1.7.0, `dist/server/index.js`): it calls `strapi.plugin(name).service('ai-tools').getTools()` synchronously and requires an array (L1877-1883, L1921-1926); keeps a tool only if `name`, `execute` (function) and `schema` are set (L1885-1891) and `tool.action` is a registered admin action (L1870-1876, L1892-1905); names it `<pluginName>__<tool.name>` → `yt-kb__getVideo` (L1869, L1912); calls `tool.execute(args, strapi, {})` (L2010); converts the schema with `schema['~standard'].jsonSchema.input({ target: 'draft-07' })` and parses the arguments with it before `execute` (`@tanstack/ai` 0.52.3 `activities/chat/tools/schema-converter.js:40,163`, `tool-calls.js:176-177`), so zod defaults apply. `z` from `@strapi/utils` 5.60 exposes `~standard.jsonSchema.input` (checked with `node -e` in strapi-prod); 5.61 uses zod 4.4.3 (≥ 4.2), so the same holds.
8. **youtube-transcripts shapes copied here** (`YT` 2.6.2, `dist/server/index.js`): action uid `tool.<kebab>`, subCategory `AI tools`, displayName "first word capitalised, rest lower case" (L983-1001); MCP name `<source>__<snake_case>` and title `<Label>: <Each Word>` (L1033-1040); `ai-tools` returns the tool list with `action` added (L1468-1481). YT's descriptions refer to sibling tools by their bare camelCase names (e.g. "Use getTranscript", L964); yt-kb does the same and its descriptions stay unchanged.
9. **Local data (counts only, `server/.tmp/data.db`, 2026-11-08).** `plugin::yt-kb.read`, `.write`, `.maintenance` each have 2 rows: 1 linked to role `strapi-super-admin`, 1 linked to admin token `claude-mcp-1782487483515` (`kind = 'admin'`). No other role or token holds a yt-kb admin action; no `plugin::yt-kb.tool.*` row exists. Users & Permissions `public` and `authenticated` hold 0 `plugin::yt-kb.*` rows. Content API tokens `yt-kb-client` (full-access) and `yt-kb-site` (read-only) exist; `yt-kb-app` does not. One admin user, role `strapi-super-admin`. 195 transcripts. With the tier mapping below (read → 15, write → 4, maintenance → 2) the migration gives `claude-mcp-1782487483515` exactly **21** `plugin::yt-kb.tool.*` rows and 0 legacy rows; the super-admin role is left to Strapi's reset (it also ends with all 21).

#### Name and permission table

Every tool keeps its camelCase base name in `ToolDef.name` (the `ai-tools` name). MCP registers `yt_kb__<snake_case>`; the admin action is `plugin::yt-kb.tool.<kebab>`; the MCP title is `YT Knowledge Base: <Each Word>`; the action's displayName is `<First word capitalised, rest lower case>`. All are derived by `PSRC/mcp-official/names.ts` — nothing is typed per tool.

| # | Old MCP name (= `ai-tools` name) | New MCP name | Admin action | Legacy tier (`sideEffects`) |
|---|---|---|---|---|
| 1 | `libraryStats` | `yt_kb__library_stats` | `plugin::yt-kb.tool.library-stats` | read (`none`) |
| 2 | `listVideos` | `yt_kb__list_videos` | `plugin::yt-kb.tool.list-videos` | read |
| 3 | `searchVideos` | `yt_kb__search_videos` | `plugin::yt-kb.tool.search-videos` | read |
| 4 | `getVideo` | `yt_kb__get_video` | `plugin::yt-kb.tool.get-video` | read |
| 5 | `getTranscript` | `yt_kb__get_transcript` | `plugin::yt-kb.tool.get-transcript` | read |
| 6 | `searchTranscript` | `yt_kb__search_transcript` | `plugin::yt-kb.tool.search-transcript` | read |
| 7 | `findTranscripts` | `yt_kb__find_transcripts` | `plugin::yt-kb.tool.find-transcripts` | read |
| 8 | `crossSearchTranscripts` | `yt_kb__cross_search_transcripts` | `plugin::yt-kb.tool.cross-search-transcripts` | read |
| 9 | `listTranscripts` | `yt_kb__list_transcripts` | `plugin::yt-kb.tool.list-transcripts` | read |
| 10 | `aggregateByTag` | `yt_kb__aggregate_by_tag` | `plugin::yt-kb.tool.aggregate-by-tag` | read |
| 11 | `listUntagged` | `yt_kb__list_untagged` | `plugin::yt-kb.tool.list-untagged` | read |
| 12 | `listTags` | `yt_kb__list_tags` | `plugin::yt-kb.tool.list-tags` | read |
| 13 | `relatedVideos` | `yt_kb__related_videos` | `plugin::yt-kb.tool.related-videos` | read |
| 14 | `getReadableArticle` | `yt_kb__get_readable_article` | `plugin::yt-kb.tool.get-readable-article` | read |
| 15 | `generateDigest` | `yt_kb__generate_digest` | `plugin::yt-kb.tool.generate-digest` | read |
| 16 | `saveSummary` | `yt_kb__save_summary` | `plugin::yt-kb.tool.save-summary` | write (`write`) |
| 17 | `tagVideo` | `yt_kb__tag_video` | `plugin::yt-kb.tool.tag-video` | write |
| 18 | `untagVideo` | `yt_kb__untag_video` | `plugin::yt-kb.tool.untag-video` | write |
| 19 | `saveNote` | `yt_kb__save_note` | `plugin::yt-kb.tool.save-note` | write |
| 20 | `addVideo` | `yt_kb__add_video` | `plugin::yt-kb.tool.add-video` | maintenance (`external`) |
| 21 | `fetchTranscript` | `yt_kb__fetch_transcript` | `plugin::yt-kb.tool.fetch-transcript` | maintenance |

Examples of derived text: title `YT Knowledge Base: Cross Search Transcripts`; displayName `Get readable article`. The old hand-written titles (`'Library stats overview'`, …) are dropped.

**`sideEffects` stays** on each `DomainTool` entry, as metadata only: it no longer chooses the MCP action. It has exactly one consumer, the legacy-grant migration (`none` → `plugin::yt-kb.read`, `write` → `plugin::yt-kb.write`, `external` → `plugin::yt-kb.maintenance`), plus a unit test that pins the 15 / 4 / 2 split.

**Legacy tier actions** `plugin::yt-kb.read`, `.write`, `.maintenance` stay registered for one release (subCategory `MCP tools`), displayNames `Use read-only MCP tools (legacy — migrated at boot)`, `Use mutating MCP tools (legacy — migrated at boot)`, `Use maintenance MCP tools (hit YouTube) (legacy — migrated at boot)`. No tool references them. Removing them is a later release (non-goal here).

#### Files

All paths under `PSRC` = `server/src/plugins/yt-kb/server/src`.

- `PSRC/mcp-official/names.ts` — **new file**: the name derivations.

  ```ts
  // Names derived from a tool's camelCase base name (ToolDef.name), in
  // strapi-plugin-youtube-transcripts' shapes (MIT, same author):
  //   MCP tool name   yt_kb__<snake_case>             getVideo → yt_kb__get_video
  //   admin action    plugin::yt-kb.tool.<kebab>      getVideo → plugin::yt-kb.tool.get-video
  //   MCP title       YT Knowledge Base: <Each Word>  getVideo → YT Knowledge Base: Get Video
  //   action label    <First word capitalised>        getVideo → Get video
  // The prefix keeps yt-kb's names from clashing with any other plugin's on a
  // shared /mcp (M-1). ai-tools keeps the bare base name: tanstack-ai adds its
  // own `yt-kb__` prefix.
  export const PLUGIN_ID = 'yt-kb';
  export const MCP_TOOL_PREFIX = 'yt_kb__';
  export const MCP_TITLE_PREFIX = 'YT Knowledge Base: ';

  const toSnake = (name: string): string => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const toKebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  export const mcpToolName = (name: string): string => `${MCP_TOOL_PREFIX}${toSnake(name)}`;

  /** The action uid as registered (section 'plugins' adds `plugin::yt-kb.`). */
  export const toolActionUid = (name: string): string => `tool.${toKebab(name)}`;

  /** The full action id a token or role is granted. */
  export const toolActionId = (name: string): string => `plugin::${PLUGIN_ID}.${toolActionUid(name)}`;

  export const toolDisplayName = (name: string): string => {
    const words = toKebab(name).replace(/-/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  };

  export const toolTitle = (name: string): string => {
    const words = name.replace(/[A-Z]/g, (c) => ` ${c}`);
    return `${MCP_TITLE_PREFIX}${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  };
  ```

- `PSRC/mcp-official/adapter.ts` — **replace the whole file**:

  ```ts
  // Adapter: register a yt-knowledge-base domain ToolDef on the OFFICIAL Strapi
  // MCP server (strapi.ai.mcp.registerTool).
  //
  // FROM the tool: its camelCase base name, description, input schema (the zod
  // 4 API from `@strapi/utils`) and execute body. ADDED here: the prefixed MCP name,
  // the title and the per-tool admin action (all from ./names), the output
  // schema, the result-size backstop, and logging.
  //
  // Registration never throws: in "any Strapi app" another plugin may already
  // hold a name, and a throw here would stop the host booting (M-1). A failing
  // tool body is logged, then rethrown so Strapi reports it to the client as
  // `Tool "<name>" execution failed: <message>`.
  import { z } from '@strapi/utils';
  import type { Core } from '@strapi/strapi';
  import type { ToolDef } from '../mcp/registry';
  import { mcpToolName, toolActionId, toolTitle } from './names';

  type RegisterTool = Core.Strapi['ai']['mcp']['registerTool'];

  /** What a tool does to the world. Since the per-tool permissions it no longer
   *  picks the admin action (every tool has its own, plugin::yt-kb.tool.<kebab>).
   *  It is kept as metadata for one consumer: the boot-time migration of the
   *  three legacy tier grants (permission-seeding/legacy-grants.ts), which maps
   *  none → plugin::yt-kb.read, write → .write, external → .maintenance.
   *
   *  none     — queries only
   *  write    — mutates yt-kb data
   *  external — leaves the box (YouTube) */
  export type SideEffects = 'none' | 'write' | 'external';

  export type DomainTool = {
    /** The domain tool — supplies name, description, schema and execute body. */
    tool: ToolDef<any, any>;
    /** What the body does (legacy-tier mapping only; see SideEffects). */
    sideEffects: SideEffects;
    /**
     * Output schema. Defaults to a permissive object (any shape).
     * structuredContent is always normalized to an object so this validates.
     */
    output?: z.ZodObject<z.ZodRawShape>;
  };

  const LOOSE_OUTPUT = z.object({}).catchall(z.any());

  // MCP clients reject a tool result over 1 MB with an opaque "Tool result is
  // too large". The result rides the wire twice (content text +
  // structuredContent) plus a small envelope, so the doubled size is measured.
  const MAX_WIRE_BYTES = 950_000;

  /** Hints, by tool base name, for how to make an oversized result smaller. */
  function shrinkHint(baseName: string): string {
    switch (baseName) {
      case 'getTranscript':
        return 'Use mode:"chunked" with page/pageSize to page segments, mode:"timeRange" for a specific window, or mode:"full" with offset/maxChars.';
      case 'findTranscripts':
        return 'Set includeFullContent:false (the default) or lower `limit`.';
      case 'crossSearchTranscripts':
        return 'Lower `perVideo` and/or `maxVideos`.';
      case 'searchTranscript':
        return 'Lower `k`.';
      default:
        return 'Re-issue with pagination / a smaller page size, or request fewer fields.';
    }
  }

  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  /** Registers one tool. Returns false (and logs) instead of throwing. */
  export function registerDomainTool(
    registerTool: RegisterTool,
    strapi: Core.Strapi,
    def: DomainTool,
  ): boolean {
    const { tool } = def;
    const name = mcpToolName(tool.name);
    const output = def.output ?? LOOSE_OUTPUT;
    const input = tool.schema as z.ZodObject<z.ZodRawShape> | undefined;

    try {
      registerTool({
        name,
        title: toolTitle(tool.name),
        description: tool.description,
        ...(input ? { resolveInputSchema: () => input } : {}),
        resolveOutputSchema: () => output,
        auth: { policies: [{ action: toolActionId(tool.name) }] },
        createHandler: (s: Core.Strapi) => async ({ args }: { args?: unknown }) => {
          let rawResult: unknown;
          try {
            rawResult = await tool.execute(args ?? {}, { strapi: s });
          } catch (err) {
            const message = errorMessage(err);
            s.log.warn(`[yt-kb] MCP tool failed ${name}: ${message}`, { name, message });
            throw err;
          }

          const bytes = Buffer.byteLength(JSON.stringify(rawResult), 'utf8');
          const wireBytes = bytes * 2 + 2048;
          const result =
            wireBytes > MAX_WIRE_BYTES
              ? {
                  error: 'RESULT_TOO_LARGE',
                  tool: name,
                  bytes: wireBytes,
                  limitBytes: MAX_WIRE_BYTES,
                  message: `This ${name} result is ~${(wireBytes / 1_000_000).toFixed(2)} MB on the wire (sent twice), over the ~1 MB MCP response limit. ${shrinkHint(tool.name)}`,
                }
              : rawResult;

          // structuredContent must be an object (the schema is a ZodObject).
          const structuredContent =
            result && typeof result === 'object' && !Array.isArray(result)
              ? (result as Record<string, unknown>)
              : { result };
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent,
          };
        },
      });
      return true;
    } catch (err) {
      const message = errorMessage(err);
      strapi.log.warn(`[yt-kb] skipped MCP tool ${name}: ${message}`, { name, message });
      return false;
    }
  }
  ```

  If `tsc` rejects the `registerTool({...})` literal under 5.61's types, STOP and report the error — the object's shape is unchanged from the 721f210 file except `name`, `title`, `auth` values and the `try`.

- `PSRC/mcp-official/tools.ts` — **replace the whole file** (drops `title`; same order; `sideEffects` unchanged):

  ```ts
  // The yt-knowledge-base domain tools, registered on the official MCP server
  // (adapter.ts) and offered to strapi-plugin-tanstack-ai (services/ai-tools.ts).
  //
  // Each entry is metadata only: which body, and what that body does to the
  // world. Name, title and admin action are derived from tool.name
  // (names.ts); the input schema comes from the tool itself. `sideEffects`
  // only feeds the legacy tier-grant migration (see adapter.ts SideEffects).
  import type { DomainTool } from './adapter';

  import { libraryStatsTool } from '../mcp/tools/library-stats';
  import { listVideosTool } from '../mcp/tools/list-videos';
  import { searchVideosTool } from '../mcp/tools/search-videos';
  import { getVideoTool } from '../mcp/tools/get-video';
  import { getTranscriptTool } from '../mcp/tools/get-transcript';
  import { searchTranscriptTool } from '../mcp/tools/search-transcript';
  import { findTranscriptsTool } from '../mcp/tools/find-transcripts';
  import { crossSearchTranscriptsTool } from '../mcp/tools/cross-search-transcripts';
  import { listTranscriptsTool } from '../mcp/tools/list-transcripts';
  import { aggregateByTagTool } from '../mcp/tools/aggregate-by-tag';
  import { listUntaggedTool } from '../mcp/tools/list-untagged';
  import { listTagsTool, tagVideoTool, untagVideoTool } from '../mcp/tools/tags';
  import { relatedVideosTool } from '../mcp/tools/related-videos';
  import { getReadableArticleTool } from '../mcp/tools/get-readable-article';
  import { addVideoTool } from '../mcp/tools/add-video';
  import { saveSummaryTool } from '../mcp/tools/save-summary';
  import { saveNoteTool } from '../mcp/tools/save-note';
  import { fetchTranscriptTool } from '../mcp/tools/fetch-transcript';
  import { generateDigestTool } from '../mcp/tools/generate-digest';

  export const domainTools: DomainTool[] = [
    // ---- Queries (legacy tier plugin::yt-kb.read) ----
    { tool: libraryStatsTool, sideEffects: 'none' },
    { tool: listVideosTool, sideEffects: 'none' },
    { tool: searchVideosTool, sideEffects: 'none' },
    { tool: getVideoTool, sideEffects: 'none' },
    { tool: getTranscriptTool, sideEffects: 'none' },
    { tool: searchTranscriptTool, sideEffects: 'none' },
    { tool: findTranscriptsTool, sideEffects: 'none' },
    { tool: crossSearchTranscriptsTool, sideEffects: 'none' },
    { tool: listTranscriptsTool, sideEffects: 'none' },
    { tool: aggregateByTagTool, sideEffects: 'none' },
    { tool: listUntaggedTool, sideEffects: 'none' },
    { tool: listTagsTool, sideEffects: 'none' },
    { tool: relatedVideosTool, sideEffects: 'none' },
    { tool: getReadableArticleTool, sideEffects: 'none' },
    // Reads compiled summaries for the CALLER to synthesize — no LLM, no writes.
    { tool: generateDigestTool, sideEffects: 'none' },

    // ---- Mutations (legacy tier plugin::yt-kb.write) ----
    { tool: saveSummaryTool, sideEffects: 'write' },
    { tool: tagVideoTool, sideEffects: 'write' },
    { tool: untagVideoTool, sideEffects: 'write' },
    { tool: saveNoteTool, sideEffects: 'write' },

    // ---- Leaves the box (legacy tier plugin::yt-kb.maintenance) ----
    { tool: addVideoTool, sideEffects: 'external' },
    { tool: fetchTranscriptTool, sideEffects: 'external' },
  ];
  ```

- `PSRC/mcp-official/permissions.ts` — **replace the whole file**:

  ```ts
  // Admin permissions for this plugin's tools.
  //
  // One action per tool, plugin::yt-kb.tool.<kebab> (section 'plugins',
  // subCategory 'AI tools', youtube-transcripts' shape). The official MCP
  // server lists a tool only to a token holding its action; tanstack-ai offers
  // a tool only to an admin whose role holds it.
  //
  // The three tier actions of earlier versions stay registered for one release
  // so the boot-time migration (permission-seeding/legacy-grants.ts) can still
  // read their rows: Strapi deletes rows of unregistered actions at boot.
  //
  // registerMany is NOT wrapped in try/catch on purpose: if it failed and boot
  // went on, admin's cleanPermissionsInDatabase would delete every yt-kb grant.
  //
  // M3 registered plugin::yt-kb.tool.fetch-transcript by hand ahead of the
  // others; this file replaces that entry with the generated list, which
  // contains it exactly once (the action provider throws on a duplicate).
  import type { Core } from '@strapi/strapi';
  import { domainTools } from './tools';
  import { PLUGIN_ID, toolActionId, toolActionUid, toolDisplayName } from './names';

  /** Gates the admin route GET /yt-kb/yt-transcript/:videoId (routes/index.ts,
   *  M3) — the same action as the fetchTranscript tool. */
  export const FETCH_TRANSCRIPT_ACTION = toolActionId('fetchTranscript');

  export const LEGACY_ACTIONS = {
    READ: 'plugin::yt-kb.read',
    WRITE: 'plugin::yt-kb.write',
    MAINTENANCE: 'plugin::yt-kb.maintenance',
  } as const;

  const LEGACY_SUFFIX = ' (legacy — migrated at boot)';

  export const LEGACY_ACTION_DEFS = [
    {
      section: 'plugins',
      pluginName: PLUGIN_ID,
      subCategory: 'MCP tools',
      displayName: `Use read-only MCP tools${LEGACY_SUFFIX}`,
      uid: 'read',
    },
    {
      section: 'plugins',
      pluginName: PLUGIN_ID,
      subCategory: 'MCP tools',
      displayName: `Use mutating MCP tools${LEGACY_SUFFIX}`,
      uid: 'write',
    },
    {
      section: 'plugins',
      pluginName: PLUGIN_ID,
      subCategory: 'MCP tools',
      displayName: `Use maintenance MCP tools (hit YouTube)${LEGACY_SUFFIX}`,
      uid: 'maintenance',
    },
  ];

  export const buildToolActionDefs = () =>
    domainTools.map(({ tool }) => ({
      section: 'plugins',
      pluginName: PLUGIN_ID,
      subCategory: 'AI tools',
      displayName: toolDisplayName(tool.name),
      uid: toolActionUid(tool.name),
    }));

  export async function registerMcpAdminPermissions(strapi: Core.Strapi): Promise<void> {
    const toolDefs = buildToolActionDefs();
    await strapi
      .service('admin::permission')
      .actionProvider.registerMany([...toolDefs, ...LEGACY_ACTION_DEFS]);
    strapi.log.info(
      `[yt-kb] registered ${toolDefs.length} tool permission(s) and ${LEGACY_ACTION_DEFS.length} legacy tier permission(s)`,
    );
  }
  ```

- `PSRC/mcp-official/index.ts` — keep the file's header and the long comment above `registerMcpAdminPermissions(strapi)` as they are; replace only the loop and its log (from `for (const def of domainTools) {` to the end of the function) with:

  ```ts
    let registered = 0;
    for (const def of domainTools) {
      if (registerDomainTool(mcp.registerTool, strapi, def)) registered += 1;
    }
    strapi.log.info(
      `[yt-kb] registered ${registered} of ${domainTools.length} MCP tool(s) on the official MCP server`,
    );
  }
  ```

  The order `registerMcpAdminPermissions(strapi)` → `if (!toolsEnabled) … return;` → `isEnabled()` stays exactly as at 721f210 (the guard test checks it). `PSRC/register.ts` is unchanged: registration stays in `register()`.

- `PSRC/mcp/registry.ts` — replace the doc comment of `name` (line 24) with:

  ```ts
    /** camelCase base name. MCP registers it as yt_kb__<snake_case>
     *  (mcp-official/names.ts); ai-tools offers it as-is. */
  ```

- `PSRC/mcp/tools/fetch-transcript.ts` — **unchanged from M3** (schema checks `YOUTUBE_VIDEO_ID`, no `proxyUrl` argument; a `TranscriptFetchError` comes back as the result `{ videoId, error, reason }`, not a throw, so the agent can act on the reason and the adapter's failure log does not fire — `fetchAndStore` already logged it).

  All 21 tool bodies (as M2–M4 left them) and every description are **unchanged** in M5. Descriptions keep naming sibling tools by their base names (`getTranscript`, `searchVideos`, …), as youtube-transcripts does (Facts 8).

- `PSRC/services/ai-tools.ts` — **new file**, registered as service key `ai-tools`:

  ```ts
  // Tools for strapi-plugin-tanstack-ai's admin chat (goal G6), in the same
  // contract strapi-plugin-youtube-transcripts uses: tanstack-ai calls
  // strapi.plugin('yt-kb').service('ai-tools').getTools() synchronously, keeps
  // tools whose `action` is a registered admin action, names them
  // `yt-kb__<name>`, parses the arguments with `schema` (Standard JSON Schema:
  // zod ≥ 4.2, which @strapi/utils 5.61 ships) and calls
  // execute(args, strapi, {}). An admin sees a tool only if their role holds
  // its action (super admins hold all).
  import type { Core } from '@strapi/strapi';
  import { domainTools } from '../mcp-official/tools';
  import { toolActionId } from '../mcp-official/names';

  export type AiTool = {
    name: string;
    description: string;
    schema: unknown;
    execute: (args: unknown, strapi: Core.Strapi, ctx?: unknown) => Promise<unknown>;
    action: string;
  };

  export const AI_TOOLS_META = {
    label: 'YT Knowledge Base',
    description: 'Search, read and add to the YouTube knowledge base',
    keywords: ['/yt-kb', '/youtube', 'video', 'transcript'],
  };

  export default (_deps: { strapi: Core.Strapi }) => ({
    getTools(): AiTool[] {
      return domainTools.map(({ tool }) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        execute: (args: unknown, strapi: Core.Strapi, _ctx?: unknown) =>
          tool.execute((args ?? {}) as never, { strapi }),
        action: toolActionId(tool.name),
      }));
    },
    getMeta() {
      return { ...AI_TOOLS_META, keywords: [...AI_TOOLS_META.keywords] };
    },
  });
  ```

  No size guard and no extra logging in this path (tanstack-ai has no 1 MB limit; transcript-fetch failures are already logged inside `fetchAndStore`).

- `PSRC/services/index.ts` — add the import `import aiTools from './ai-tools';` and the entry `'ai-tools': aiTools,` after `fetcher,` in the default export. Keep every other entry M3/M4 added.

- `PSRC/permission-seeding/legacy-grants.ts` — **new file**: the bootstrap grant migration.

  ```ts
  // Boot-time migration of the three legacy tier grants to per-tool grants.
  //
  // For each admin_permissions row whose action is plugin::yt-kb.read /
  // .write / .maintenance and which belongs to an API token or a role, insert
  // the per-tool actions of that tier (read → 15 tools, write → 4,
  // maintenance → 2; from domainTools' sideEffects) for the same token or role
  // when absent, then delete the legacy row — one transaction per row.
  // Idempotent: a second run finds no legacy rows (or only skipped ones).
  //
  // Skipped on purpose:
  // - rows on the super-admin role: admin's bootstrap runs AFTER plugin
  //   bootstraps and resetSuperAdminPermissions() grants that role every
  //   registered action — the 21 tool actions, and the legacy ones again for
  //   as long as they stay registered. Deleting them here would churn every boot.
  // - rows with neither a role nor a token: admin's cleanPermissionsInDatabase
  //   deletes orphans on the same boot.
  //
  // The new rows copy the legacy row's `conditions`; `subject` is null and
  // `properties` {} (plugin actions have neither).
  import type { Core } from '@strapi/strapi';
  import { domainTools } from '../mcp-official/tools';
  import type { SideEffects } from '../mcp-official/adapter';
  import { toolActionId } from '../mcp-official/names';
  import { LEGACY_ACTIONS } from '../mcp-official/permissions';

  const SUPER_ADMIN_CODE = 'strapi-super-admin';

  const LEGACY_BY_SIDE_EFFECTS: Record<SideEffects, string> = {
    none: LEGACY_ACTIONS.READ,
    write: LEGACY_ACTIONS.WRITE,
    external: LEGACY_ACTIONS.MAINTENANCE,
  };

  /** The per-tool action ids a legacy tier action stood for. */
  export function perToolActionsForLegacy(legacyAction: string): string[] {
    return domainTools
      .filter((d) => LEGACY_BY_SIDE_EFFECTS[d.sideEffects] === legacyAction)
      .map((d) => toolActionId(d.tool.name));
  }

  type LegacyRow = {
    id: number;
    action: string;
    conditions?: unknown;
    role?: { id: number; code?: string } | null;
    apiToken?: { id: number } | null;
  };

  export type LegacyMigrationResult = {
    legacyRows: number;
    migratedRows: number;
    inserted: number;
    skippedSuperAdmin: number;
    skippedOrphans: number;
  };

  export async function migrateLegacyToolGrants(strapi: Core.Strapi): Promise<LegacyMigrationResult> {
    const permissions = strapi.db.query('admin::permission');
    const rows = (await permissions.findMany({
      where: { action: { $in: Object.values(LEGACY_ACTIONS) } },
      populate: ['role', 'apiToken'],
    })) as LegacyRow[];

    const result: LegacyMigrationResult = {
      legacyRows: rows.length,
      migratedRows: 0,
      inserted: 0,
      skippedSuperAdmin: 0,
      skippedOrphans: 0,
    };

    for (const row of rows) {
      if (row.role?.code === SUPER_ADMIN_CODE) {
        result.skippedSuperAdmin += 1;
        continue;
      }
      const tokenId = row.apiToken?.id ?? null;
      const roleId = row.role?.id ?? null;
      if (tokenId === null && roleId === null) {
        result.skippedOrphans += 1;
        continue;
      }
      const owner = tokenId !== null ? { apiToken: tokenId } : { role: roleId };
      const ownerWhere =
        tokenId !== null ? { apiToken: { id: tokenId } } : { role: { id: roleId } };
      const wanted = perToolActionsForLegacy(row.action);

      await strapi.db.transaction(async () => {
        const existing = (await permissions.findMany({
          where: { action: { $in: wanted }, ...ownerWhere },
          select: ['action'],
        })) as { action: string }[];
        const have = new Set(existing.map((p) => p.action));
        for (const action of wanted) {
          if (have.has(action)) continue;
          await permissions.create({
            data: {
              action,
              actionParameters: {},
              subject: null,
              properties: {},
              conditions: Array.isArray(row.conditions) ? row.conditions : [],
              ...owner,
            },
          });
          result.inserted += 1;
        }
        await permissions.delete({ where: { id: row.id } });
      });
      result.migratedRows += 1;
    }
    return result;
  }
  ```

- `PSRC/permission-seeding/users-permissions.ts` — **new file**:

  ```ts
  // M-14: yt-kb grants nothing to Users & Permissions' Public or Authenticated
  // roles — every caller uses its own token. A host whose owner ticked yt-kb
  // routes for those roles gets them removed at boot. A host without
  // Users & Permissions is left alone.
  import type { Core } from '@strapi/strapi';

  export const OPEN_ROLE_TYPES = ['public', 'authenticated'];

  /** Number of rows removed, or null when Users & Permissions is not installed. */
  export async function removeYtKbFromOpenRoles(strapi: Core.Strapi): Promise<number | null> {
    if (!strapi.plugin('users-permissions')) return null;
    const query = strapi.db.query('plugin::users-permissions.permission');
    const rows = (await query.findMany({
      where: {
        action: { $startsWith: 'plugin::yt-kb.' },
        role: { type: { $in: OPEN_ROLE_TYPES } },
      },
      select: ['id'],
    })) as { id: number }[];
    if (rows.length > 0) {
      await query.deleteMany({ where: { id: { $in: rows.map((r) => r.id) } } });
    }
    return rows.length;
  }
  ```

- `PSRC/permission-seeding/index.ts` — **new file**:

  ```ts
  import type { Core } from '@strapi/strapi';
  import { migrateLegacyToolGrants } from './legacy-grants';
  import { removeYtKbFromOpenRoles } from './users-permissions';

  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  /** Permission work done in code at boot (standard §5). Never throws. */
  export async function seedPermissions(strapi: Core.Strapi): Promise<void> {
    // Counts go in the message as well as the meta object: Strapi's default
    // console format prints only the message.
    try {
      const r = await migrateLegacyToolGrants(strapi);
      strapi.log.info(
        `[yt-kb] legacy MCP grant migration: ${r.legacyRows} legacy row(s), ${r.migratedRows} migrated, ${r.inserted} per-tool grant(s) added, ${r.skippedSuperAdmin} super-admin and ${r.skippedOrphans} orphan row(s) left to Strapi`,
        r,
      );
    } catch (err) {
      const message = errorMessage(err);
      strapi.log.warn(`[yt-kb] legacy MCP grant migration failed: ${message}`, { message });
    }
    try {
      const removed = await removeYtKbFromOpenRoles(strapi);
      if (removed === null) {
        strapi.log.info('[yt-kb] Users & Permissions not installed; no role permissions to check');
      } else {
        strapi.log.info(`[yt-kb] removed ${removed} yt-kb permission(s) from Public/Authenticated roles`, { count: removed });
      }
    } catch (err) {
      const message = errorMessage(err);
      strapi.log.warn(`[yt-kb] could not check Users & Permissions roles: ${message}`, { message });
    }
  }
  ```

- `PSRC/bootstrap.ts` (M3's file, wired as `bootstrap` in `PSRC/index.ts` since M3) — two edits, nothing else:
  1. after the line `import type { Core } from '@strapi/strapi';` add `import { seedPermissions } from './permission-seeding';`;
  2. replace the line `export default async ({ strapi }: { strapi: Core.Strapi }) => {` with
     ```ts
     export default async ({ strapi }: { strapi: Core.Strapi }) => {
       // Permission work in code (standard §5). Awaited: it must finish before
       // admin's bootstrap runs its cleanup (Facts 2). Never throws.
       await seedPermissions(strapi);
     ```
  so it runs before M3's proxy check and metadata backfill.

- `PSRC/index.ts` — **unchanged from M3**: it already wires `bootstrap` from `./bootstrap` and has the contract's `config` block (`mcp`, `proxyUrl`, `import`, `backfillMetadata`) that the import gate below reads. `server/config/plugins.ts` is **not** changed: the test host keeps `import` at its default `false`.

- `PSRC/controllers/importer.ts` — **replace the whole file** (gate + status codes; M2's transaction work lives in the service and is untouched):

  ```ts
  import type { Core } from '@strapi/strapi';
  import { IMPORT_TYPES, isImportType } from '../services/importer';

  export const IMPORT_DISABLED_MESSAGE =
    'Import is disabled. Set the yt-kb plugin config `import: true` to enable it.';

  // POST /api/yt-kb/import/:type  { data: [record, ...] }
  // Scope plugin::yt-kb.importer.importRecords — granted to no role, and the
  // route refuses (403) unless the plugin config sets `import: true` (M-7).
  // 200 when every record was written, 207 when any failed; the body is
  // { created, updated, failed[] } either way.
  export default ({ strapi }: { strapi: Core.Strapi }) => ({
    async importRecords(ctx: any) {
      if (strapi.plugin('yt-kb').config('import') !== true) {
        ctx.status = 403;
        ctx.body = {
          data: null,
          error: { status: 403, name: 'ForbiddenError', message: IMPORT_DISABLED_MESSAGE, details: {} },
        };
        return;
      }
      const { type } = ctx.params;
      if (!isImportType(type)) {
        return ctx.badRequest(`Unknown type "${type}". Expected one of: ${IMPORT_TYPES.join(', ')}`);
      }
      const records = ctx.request.body?.data;
      if (!Array.isArray(records)) {
        return ctx.badRequest('Body must be { "data": [ ...records ] }');
      }
      const result = await strapi.plugin('yt-kb').service('importer').importRecords(type, records);
      ctx.body = result;
      ctx.status = result.failed.length > 0 ? 207 : 200;
    },
  });
  ```

- `server/src/plugins/yt-kb/scripts/copy-content.mjs` — only what the new response codes require. M7 then adds one 413 line to `postImport` (it returns `{ tooLarge: true }`) and replaces `importAll` with a call to `importInBatches` from the new `scripts/import-batches.mjs`, which plans the batches and records a 413'd batch as failed; `postImport` stays the one function that POSTs a batch:
  1. In the header comment, replace the `DEST_TOKEN` line pair with:
     ```js
     //   DEST_TOKEN     API token with plugin::yt-kb.importer.importRecords
     //                  (and read access, for the check). The destination must
     //                  set the yt-kb plugin config `import: true` while copying.
     ```
  2. Add this function directly above `// POST in batches that stay well under Strapi's JSON body limit.`:
     ```js
     // POST one batch. 200 = every record written; 207 = some failed (listed in
     // `failed`, counted below); 403 with the plugin's "Import is disabled"
     // message = the destination's yt-kb config does not set `import: true`.
     async function postImport(type, batch) {
       const url = `${DEST_URL}/api/yt-kb/import/${type}`;
       const res = await fetch(url, {
         method: 'POST',
         headers: { Authorization: `Bearer ${DEST_TOKEN}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ data: batch }),
       });
       const text = await res.text();
       let body = null;
       try { body = JSON.parse(text); } catch { /* not JSON */ }
       if (res.status === 403 && body?.error?.message?.startsWith('Import is disabled')) {
         console.error(
           `Import is disabled on ${DEST_URL}. Set the yt-kb plugin config \`import: true\` there, restart it, run this again, then set it back to false.`,
         );
         process.exit(2);
       }
       if ((res.status !== 200 && res.status !== 207) || body === null) {
         throw new Error(`POST ${url} → ${res.status}: ${text.slice(0, 300)}`);
       }
       return body;
     }
     ```
  3. In `importAll`'s `flush`, replace the `const r = await request(…, { method: 'POST', body: JSON.stringify({ data: batch }) });` statement (lines 108-111) with `const r = await postImport(t.type, batch);`.

- `server/src/plugins/yt-kb/scripts/create-tokens.cjs` — **new file** (shipped: `files` in the plugin's `package.json` already includes `scripts`):

  ```js
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
  ```

  `fetcher.getOrFetch` is M3's controller action; `create` rejects unknown action ids, so the script fails loudly (exit 1) if M3 named it differently — STOP and ask in that case.

  `--rotate` uses the same service, `admin::api-token-content-api` (`@strapi/admin/dist/server/server/src/services/index.js:41`, `createTokenService('content-api')`): its `revoke(id)` (`services/api-token.js:806-849`, exposed at `:1070`) deletes the token row and any admin-permission rows linked to it, the same call the admin panel's Delete makes. Both `revoke` and `create` go through `strapi.db.query`, which joins the open `strapi.db.transaction` (M2 Facts), so a failed create rolls the revoke back. Re-check both line references on 5.61.0 after M1; if `revoke` is gone or renamed, STOP and ask.

- **Tests** (plugin vitest, M1 harness; co-located `*.test.ts`, already excluded from the plugin build by `server/src/plugins/yt-kb/server/tsconfig.build.json`):

  - `PSRC/mcp-official/names.test.ts` — **new**:

    ```ts
    import { describe, expect, it } from 'vitest';
    import { domainTools } from './tools';
    import { mcpToolName, toolActionId, toolActionUid, toolDisplayName, toolTitle } from './names';

    const BASE = [
      'libraryStats', 'listVideos', 'searchVideos', 'getVideo', 'getTranscript',
      'searchTranscript', 'findTranscripts', 'crossSearchTranscripts', 'listTranscripts',
      'aggregateByTag', 'listUntagged', 'listTags', 'relatedVideos', 'getReadableArticle',
      'generateDigest', 'saveSummary', 'tagVideo', 'untagVideo', 'saveNote', 'addVideo',
      'fetchTranscript',
    ];
    const MCP = [
      'yt_kb__library_stats', 'yt_kb__list_videos', 'yt_kb__search_videos', 'yt_kb__get_video',
      'yt_kb__get_transcript', 'yt_kb__search_transcript', 'yt_kb__find_transcripts',
      'yt_kb__cross_search_transcripts', 'yt_kb__list_transcripts', 'yt_kb__aggregate_by_tag',
      'yt_kb__list_untagged', 'yt_kb__list_tags', 'yt_kb__related_videos',
      'yt_kb__get_readable_article', 'yt_kb__generate_digest', 'yt_kb__save_summary',
      'yt_kb__tag_video', 'yt_kb__untag_video', 'yt_kb__save_note', 'yt_kb__add_video',
      'yt_kb__fetch_transcript',
    ];
    const ACTIONS = [
      'library-stats', 'list-videos', 'search-videos', 'get-video', 'get-transcript',
      'search-transcript', 'find-transcripts', 'cross-search-transcripts', 'list-transcripts',
      'aggregate-by-tag', 'list-untagged', 'list-tags', 'related-videos', 'get-readable-article',
      'generate-digest', 'save-summary', 'tag-video', 'untag-video', 'save-note', 'add-video',
      'fetch-transcript',
    ].map((k) => `plugin::yt-kb.tool.${k}`);

    describe('tool names', () => {
      it('keeps the 21 base names in order', () => {
        expect(domainTools.map((d) => d.tool.name)).toEqual(BASE);
      });
      it('maps every tool to its yt_kb__ MCP name', () => {
        expect(domainTools.map((d) => mcpToolName(d.tool.name))).toEqual(MCP);
      });
      it('maps every tool to its own admin action', () => {
        expect(domainTools.map((d) => toolActionId(d.tool.name))).toEqual(ACTIONS);
      });
      it('produces valid, unique MCP names', () => {
        expect(new Set(MCP).size).toBe(21);
        for (const n of MCP) expect(n).toMatch(/^[a-z0-9_]{1,64}$/);
      });
      it("derives titles and labels in youtube-transcripts' shape", () => {
        expect(toolTitle('crossSearchTranscripts')).toBe('YT Knowledge Base: Cross Search Transcripts');
        expect(toolTitle('getVideo')).toBe('YT Knowledge Base: Get Video');
        expect(toolDisplayName('getReadableArticle')).toBe('Get readable article');
        expect(toolActionUid('getVideo')).toBe('tool.get-video');
      });
      it('keeps the 15 / 4 / 2 side-effect split the legacy migration relies on', () => {
        const count = (s: string) => domainTools.filter((d) => d.sideEffects === s).length;
        expect([count('none'), count('write'), count('external')]).toEqual([15, 4, 2]);
      });
    });
    ```

  - `PSRC/mcp-official/adapter.test.ts` — **new**:

    ```ts
    import { describe, expect, it, vi } from 'vitest';
    import { z } from '@strapi/utils';
    import { registerDomainTool } from './adapter';
    import { registerOfficialMcpTools } from './index';

    const fakeStrapi = (registerTool: (def: any) => void) => {
      const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const registerMany = vi.fn(async () => {});
      const strapi = {
        log,
        service: vi.fn(() => ({ actionProvider: { registerMany } })),
        ai: { mcp: { isEnabled: () => true, registerTool } },
      };
      return { strapi: strapi as any, log, registerMany };
    };

    describe('MCP registration', () => {
      it('registers 21 prefixed tools, each gated by its own action', async () => {
        const defs: any[] = [];
        const { strapi, registerMany } = fakeStrapi((d) => defs.push(d));
        await registerOfficialMcpTools(strapi, { toolsEnabled: true });
        expect(defs).toHaveLength(21);
        for (const d of defs) {
          expect(d.name).toMatch(/^yt_kb__/);
          expect(d.title).toMatch(/^YT Knowledge Base: /);
          expect(d.auth.policies).toHaveLength(1);
          expect(d.auth.policies[0].action).toMatch(/^plugin::yt-kb\.tool\.[a-z-]+$/);
        }
        expect(defs.find((d) => d.name === 'yt_kb__get_video').auth.policies[0].action).toBe('plugin::yt-kb.tool.get-video');
        // 21 tool actions + 3 legacy tiers, in one call, no uid twice (the
        // provider throws on a duplicate — M3's hand-added fetch-transcript
        // entry is gone)
        const uids = (registerMany.mock.calls[0] as any)[0].map((d: any) => d.uid);
        expect(uids).toHaveLength(24);
        expect(new Set(uids).size).toBe(24);
        expect(uids.filter((u: string) => u === 'tool.fetch-transcript')).toHaveLength(1);
      });

      it('logs and skips a tool whose registration throws, and keeps going', async () => {
        const defs: any[] = [];
        const { strapi, log } = fakeStrapi((d) => {
          if (d.name === 'yt_kb__get_video') throw new Error('already registered');
          defs.push(d);
        });
        await expect(registerOfficialMcpTools(strapi, { toolsEnabled: true })).resolves.toBeUndefined();
        expect(defs).toHaveLength(20);
        expect(log.warn).toHaveBeenCalledWith(
          expect.stringMatching(/^\[yt-kb\] skipped MCP tool yt_kb__get_video: already registered/),
          { name: 'yt_kb__get_video', message: 'already registered' },
        );
      });

      it('registers permissions but no tools when mcp is off', async () => {
        const registerTool = vi.fn();
        const { strapi, registerMany } = fakeStrapi(registerTool);
        await registerOfficialMcpTools(strapi, { toolsEnabled: false });
        expect(registerMany).toHaveBeenCalledTimes(1);
        expect(registerTool).not.toHaveBeenCalled();
      });

      it('logs a failing tool body and rethrows', async () => {
        let def: any;
        const { strapi, log } = fakeStrapi((d) => { def = d; });
        const ok = registerDomainTool(strapi.ai.mcp.registerTool, strapi, {
          tool: { name: 'boomTool', description: 'x', schema: z.object({}), execute: async () => { throw new Error('boom'); } },
          sideEffects: 'none',
        });
        expect(ok).toBe(true);
        await expect(def.createHandler(strapi)({ args: {} })).rejects.toThrow('boom');
        expect(log.warn).toHaveBeenCalledWith(
          expect.stringMatching(/^\[yt-kb\] MCP tool failed yt_kb__boom_tool: boom/),
          { name: 'yt_kb__boom_tool', message: 'boom' },
        );
      });
    });
    ```

  - `PSRC/services/ai-tools.test.ts` — **new**:

    ```ts
    import { describe, expect, it, vi } from 'vitest';
    import aiToolsFactory, { AI_TOOLS_META } from './ai-tools';
    import { buildToolActionDefs } from '../mcp-official/permissions';
    import { listTagsTool } from '../mcp/tools/tags';

    const service = aiToolsFactory({ strapi: {} as never });

    describe('ai-tools (tanstack-ai contract)', () => {
      it('returns a plain array, synchronously', () => {
        const tools = service.getTools();
        expect(Array.isArray(tools)).toBe(true);
        expect((tools as unknown as { then?: unknown }).then).toBeUndefined();
        expect(tools).toHaveLength(21);
      });

      it('gives every tool the fields tanstack-ai keeps a tool for', () => {
        for (const t of service.getTools()) {
          expect(typeof t.name).toBe('string');
          expect(t.name).toMatch(/^[a-z][A-Za-z]+$/);
          expect(t.description.length).toBeGreaterThan(0);
          expect(t.schema).toBeTruthy();
          expect(typeof t.execute).toBe('function');
        }
      });

      it('declares only actions the plugin registers', () => {
        const registered = new Set(buildToolActionDefs().map((d) => `plugin::${d.pluginName}.${d.uid}`));
        for (const t of service.getTools()) expect(registered.has(t.action)).toBe(true);
        expect(service.getTools().find((t) => t.name === 'fetchTranscript')!.action).toBe('plugin::yt-kb.tool.fetch-transcript');
      });

      it('exposes a Standard JSON Schema converter on every schema', () => {
        for (const t of service.getTools()) {
          const std = (t.schema as any)['~standard'];
          expect(typeof std?.jsonSchema?.input).toBe('function');
          expect(() => std.jsonSchema.input({ target: 'draft-07' })).not.toThrow();
        }
      });

      it('calls the body with { strapi } and {} for missing args', async () => {
        const spy = vi.spyOn(listTagsTool, 'execute').mockResolvedValue({ ok: true } as never);
        const fake = { marker: 1 } as never;
        const t = service.getTools().find((x) => x.name === 'listTags')!;
        await expect(t.execute(undefined, fake, {})).resolves.toEqual({ ok: true });
        expect(spy).toHaveBeenCalledWith({}, { strapi: fake });
        spy.mockRestore();
      });

      it('describes the source', () => {
        expect(service.getMeta()).toEqual(AI_TOOLS_META);
        expect(AI_TOOLS_META).toEqual({
          label: 'YT Knowledge Base',
          description: 'Search, read and add to the YouTube knowledge base',
          keywords: ['/yt-kb', '/youtube', 'video', 'transcript'],
        });
      });
    });
    ```

  - `PSRC/permission-seeding/legacy-grants.test.ts` — **new** (fake db):

    ```ts
    import { describe, expect, it, vi } from 'vitest';
    import { migrateLegacyToolGrants, perToolActionsForLegacy } from './legacy-grants';

    type Row = { id: number; action: string; conditions: string[]; role: { id: number; code: string } | null; apiToken: { id: number } | null };
    const ROLES: Record<number, { id: number; code: string }> = {
      1: { id: 1, code: 'strapi-super-admin' },
      2: { id: 2, code: 'strapi-editor' },
    };
    const legacy = (id: number, action: string, owner: Partial<Row>): Row =>
      ({ id, action: `plugin::yt-kb.${action}`, conditions: [], role: null, apiToken: null, ...owner }) as Row;

    function fakeStrapi(rows: Row[]) {
      let nextId = 1000;
      const matches = (r: Row, where: any) =>
        (!where.action?.$in || where.action.$in.includes(r.action)) &&
        (!where.apiToken || r.apiToken?.id === where.apiToken.id) &&
        (!where.role || r.role?.id === where.role.id);
      const query = {
        findMany: vi.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r }))),
        create: vi.fn(async ({ data }: any) => {
          const row: Row = {
            id: nextId++, action: data.action, conditions: data.conditions,
            role: data.role ? ROLES[data.role] : null, apiToken: data.apiToken ? { id: data.apiToken } : null,
          };
          rows.push(row);
          return row;
        }),
        delete: vi.fn(async ({ where }: any) => rows.splice(rows.findIndex((r) => r.id === where.id), 1)[0]),
      };
      const strapi = {
        db: { query: vi.fn(() => query), transaction: vi.fn(async (cb: any) => cb({})) },
        log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      };
      return { strapi: strapi as any, rows, query };
    }

    const actionsOf = (rows: Row[], pred: (r: Row) => boolean) => rows.filter(pred).map((r) => r.action).sort();

    describe('legacy MCP grant migration', () => {
      it('maps the tiers to 15 / 4 / 2 per-tool actions', () => {
        expect(perToolActionsForLegacy('plugin::yt-kb.read')).toHaveLength(15);
        expect(perToolActionsForLegacy('plugin::yt-kb.write')).toEqual([
          'plugin::yt-kb.tool.save-summary', 'plugin::yt-kb.tool.tag-video',
          'plugin::yt-kb.tool.untag-video', 'plugin::yt-kb.tool.save-note',
        ]);
        expect(perToolActionsForLegacy('plugin::yt-kb.maintenance')).toEqual([
          'plugin::yt-kb.tool.add-video', 'plugin::yt-kb.tool.fetch-transcript',
        ]);
      });

      it('gives a token holding all three tiers the 21 tool actions and drops the tiers', async () => {
        const { strapi, rows } = fakeStrapi([
          legacy(1, 'read', { apiToken: { id: 4 } }),
          legacy(2, 'write', { apiToken: { id: 4 } }),
          legacy(3, 'maintenance', { apiToken: { id: 4 } }),
        ]);
        const r = await migrateLegacyToolGrants(strapi);
        expect(r).toEqual({ legacyRows: 3, migratedRows: 3, inserted: 21, skippedSuperAdmin: 0, skippedOrphans: 0 });
        const onToken = actionsOf(rows, (x) => x.apiToken?.id === 4);
        expect(onToken).toHaveLength(21);
        expect(onToken.every((a) => a.startsWith('plugin::yt-kb.tool.'))).toBe(true);
        expect(strapi.db.transaction).toHaveBeenCalledTimes(3);
      });

      it('migrates a non-super-admin role and keeps its conditions', async () => {
        const { strapi, rows } = fakeStrapi([{ ...legacy(1, 'write', { role: ROLES[2] }), conditions: ['admin::is-creator'] }]);
        await migrateLegacyToolGrants(strapi);
        const onRole = rows.filter((x) => x.role?.id === 2);
        expect(onRole).toHaveLength(4);
        expect(onRole.every((x) => x.conditions[0] === 'admin::is-creator')).toBe(true);
      });

      it('leaves super-admin and orphan rows to Strapi', async () => {
        const { strapi, rows } = fakeStrapi([legacy(1, 'read', { role: ROLES[1] }), legacy(2, 'read', {})]);
        const r = await migrateLegacyToolGrants(strapi);
        expect(r).toMatchObject({ legacyRows: 2, migratedRows: 0, inserted: 0, skippedSuperAdmin: 1, skippedOrphans: 1 });
        expect(rows.map((x) => x.id)).toEqual([1, 2]);
      });

      it('does not duplicate an action the owner already holds', async () => {
        const { strapi, rows } = fakeStrapi([
          { id: 9, action: 'plugin::yt-kb.tool.get-video', conditions: [], role: null, apiToken: { id: 4 } },
          legacy(1, 'read', { apiToken: { id: 4 } }),
        ]);
        const r = await migrateLegacyToolGrants(strapi);
        expect(r.inserted).toBe(14);
        expect(rows.filter((x) => x.action === 'plugin::yt-kb.tool.get-video')).toHaveLength(1);
      });

      it('is idempotent', async () => {
        const { strapi, rows } = fakeStrapi([legacy(1, 'read', { apiToken: { id: 4 } })]);
        await migrateLegacyToolGrants(strapi);
        const before = rows.length;
        const second = await migrateLegacyToolGrants(strapi);
        expect(second).toEqual({ legacyRows: 0, migratedRows: 0, inserted: 0, skippedSuperAdmin: 0, skippedOrphans: 0 });
        expect(rows.length).toBe(before);
      });
    });
    ```

  - `PSRC/permission-seeding/users-permissions.test.ts` — **new**:

    ```ts
    import { describe, expect, it, vi } from 'vitest';
    import { removeYtKbFromOpenRoles } from './users-permissions';

    const rowsFixture = () => [
      { id: 1, action: 'plugin::yt-kb.video.find', role: { type: 'public' } },
      { id: 2, action: 'plugin::yt-kb.importer.importRecords', role: { type: 'authenticated' } },
      { id: 3, action: 'plugin::yt-kb.video.find', role: { type: 'editor' } },
      { id: 4, action: 'api::article.article.find', role: { type: 'public' } },
    ];

    function fakeStrapi(installed: boolean) {
      let rows = rowsFixture();
      const query = {
        findMany: vi.fn(async ({ where }: any) =>
          rows.filter((r) => r.action.startsWith(where.action.$startsWith) && where.role.type.$in.includes(r.role.type))),
        deleteMany: vi.fn(async ({ where }: any) => {
          const before = rows.length;
          rows = rows.filter((r) => !where.id.$in.includes(r.id));
          return { count: before - rows.length };
        }),
      };
      const strapi = { plugin: vi.fn(() => (installed ? {} : undefined)), db: { query: vi.fn(() => query) } };
      return { strapi: strapi as any, query, rows: () => rows };
    }

    describe('Users & Permissions cleanup', () => {
      it('removes yt-kb actions from Public and Authenticated only', async () => {
        const f = fakeStrapi(true);
        expect(await removeYtKbFromOpenRoles(f.strapi)).toBe(2);
        expect(f.strapi.db.query).toHaveBeenCalledWith('plugin::users-permissions.permission');
        expect(f.rows().map((r) => r.id)).toEqual([3, 4]);
      });
      it('is a no-op the second time', async () => {
        const f = fakeStrapi(true);
        await removeYtKbFromOpenRoles(f.strapi);
        expect(await removeYtKbFromOpenRoles(f.strapi)).toBe(0);
        expect(f.query.deleteMany).toHaveBeenCalledTimes(1);
      });
      it('does nothing without Users & Permissions', async () => {
        const f = fakeStrapi(false);
        expect(await removeYtKbFromOpenRoles(f.strapi)).toBeNull();
        expect(f.strapi.db.query).not.toHaveBeenCalled();
      });
    });
    ```

  - `PSRC/controllers/importer.test.ts` — **new**:

    ```ts
    import { describe, expect, it, vi } from 'vitest';
    import controllerFactory, { IMPORT_DISABLED_MESSAGE } from './importer';

    const make = (importFlag: unknown, result?: unknown) => {
      const service = { importRecords: vi.fn(async () => result) };
      const strapi = {
        plugin: () => ({ config: (k: string) => (k === 'import' ? importFlag : undefined), service: () => service }),
      };
      return { controller: controllerFactory({ strapi } as never), service };
    };
    const ctx = () => ({ params: { type: 'tag' }, request: { body: { data: [] } }, status: 404, body: undefined as any, badRequest: vi.fn() });

    describe('import gate', () => {
      for (const flag of [undefined, false, 'true']) {
        it(`refuses with 403 when import is ${String(flag)}`, async () => {
          const { controller, service } = make(flag);
          const c = ctx();
          await controller.importRecords(c);
          expect(c.status).toBe(403);
          expect(c.body.error.message).toBe(IMPORT_DISABLED_MESSAGE);
          expect(service.importRecords).not.toHaveBeenCalled();
        });
      }
      it('returns 200 when every record was written', async () => {
        const { controller } = make(true, { created: 1, updated: 0, failed: [] });
        const c = ctx();
        await controller.importRecords(c);
        expect(c.status).toBe(200);
        expect(c.body).toEqual({ created: 1, updated: 0, failed: [] });
      });
      it('returns 207 with the same body when any record failed', async () => {
        const body = { created: 1, updated: 0, failed: [{ documentId: 'x', error: 'bad' }] };
        const { controller } = make(true, body);
        const c = ctx();
        await controller.importRecords(c);
        expect(c.status).toBe(207);
        expect(c.body).toEqual(body);
      });
    });
    ```

  - **The moved permissions guard** — `PSRC/mcp-official/permissions.guard.test.ts` (M1 moved it there from `client/src/lib/services/mcp-permissions.guard.test.ts`). Replace its content with the following; the path does not change. The first two checks are M1's unchanged; the third now covers the 21 tool actions and the 3 legacy ones.

    ```ts
    import { describe, expect, it } from 'vitest';
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { FETCH_TRANSCRIPT_ACTION, LEGACY_ACTION_DEFS, buildToolActionDefs } from './permissions';

    // Strapi admin's bootstrap deletes every admin::permission row whose action
    // is not registered — and an admin API token's grants are exactly those
    // rows. If yt-kb's actions registered behind an enabled check, one boot with
    // the flag off would delete every token's grants for good.
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');

    describe('MCP admin permission registration', () => {
      it('registers the permissions before the enabled check returns', () => {
        const register = source.indexOf('registerMcpAdminPermissions(strapi)');
        const gate = source.indexOf('isEnabled()');
        expect(register, 'registerMcpAdminPermissions call not found').toBeGreaterThan(-1);
        expect(gate, 'isEnabled() gate not found').toBeGreaterThan(-1);
        expect(register).toBeLessThan(gate);
      });

      it('does not return from the function before registering them', () => {
        const register = source.indexOf('registerMcpAdminPermissions(strapi)');
        const earlyReturn = source.indexOf('return;');
        expect(earlyReturn === -1 || earlyReturn > register).toBe(true);
      });

      // Renaming an action has the same effect as not registering it: its rows
      // no longer match and the next boot deletes them.
      it('registers the 21 per-tool actions and the 3 legacy tiers', () => {
        const tools = buildToolActionDefs();
        expect(tools).toHaveLength(21);
        for (const d of tools) {
          expect(d).toMatchObject({ section: 'plugins', pluginName: 'yt-kb', subCategory: 'AI tools' });
          expect(d.uid).toMatch(/^tool\.[a-z]+(-[a-z]+)*$/);
        }
        expect(new Set(tools.map((d) => d.uid)).size).toBe(21);
        // The admin route (routes/index.ts) is gated by the fetch tool's own action.
        expect(FETCH_TRANSCRIPT_ACTION).toBe('plugin::yt-kb.tool.fetch-transcript');
        expect(tools.filter((d) => `plugin::yt-kb.${d.uid}` === FETCH_TRANSCRIPT_ACTION)).toHaveLength(1);
        expect(LEGACY_ACTION_DEFS.map((d) => d.uid)).toEqual(['read', 'write', 'maintenance']);
        for (const d of LEGACY_ACTION_DEFS) {
          expect(d.pluginName).toBe('yt-kb');
          expect(d.displayName.endsWith(' (legacy — migrated at boot)')).toBe(true);
        }
      });
    });
    ```

  - `PSRC/bootstrap.test.ts` (M3's file) — **edit**, because the bootstrap now calls `seedPermissions` first and M3's fake Strapi has no `db`: add `vi.mock('./permission-seeding', () => ({ seedPermissions: vi.fn(async () => {}) }))` next to the two existing `vi.mock` calls and `import { seedPermissions } from './permission-seeding';` below them, and append one case to the table:

    | Case | Expect |
    |---|---|
    | `cfg = { proxyUrl: '' }` | `seedPermissions` called exactly once, with the fake `strapi`, and before the first `log.warn` call (compare `vi.mocked(seedPermissions).mock.invocationCallOrder[0]` with `log.warn.mock.invocationCallOrder[0]`) |

    M3's four cases stay as they are (with `seedPermissions` mocked, `log.warn` is still not called in the proxy case).

#### Data

- **Grant migration** — in code, at plugin bootstrap (`seedPermissions`), not in `database/migrations` (a plugin cannot add files to a host's `database/migrations`). On every host it runs on each boot; after the first boot it finds only super-admin rows and does nothing. Effect on this repo's DB (Facts 9): token `claude-mcp-1782487483515` 3 legacy rows → 21 `plugin::yt-kb.tool.*` rows.
- **Backup first (owner's DB, once, before the first boot of M5 code on it — Deployment step 2):** with Strapi stopped, `TS=$(date +%s); node server/.tmp/e8/e8.mjs backup server/.tmp/data.db server/.tmp/data.db.pre-m5-$TS` → `"integrity": "ok"`. On a Postgres host: `pg_dump` the database before deploying M5.
- **Users & Permissions cleanup** — in code, at plugin bootstrap; deletes only `plugin::yt-kb.*` rows on `public`/`authenticated` roles (0 rows locally).
- Tested on a copy of real data in Verify (scratch DB made with `.backup`).

#### Callers updated

- MCP clients: tool names change (table above). The owner's Claude config needs no file change (it names the server, not tools) but must reconnect/refresh its tool list. No repo file references the old names in a client config (`.claude/settings.local.json`, no `.mcp.json`).
- `client/`: none. The app does not call MCP or the importer. The guard moved to the plugin in M1 and is updated above.
- `server/src/plugins/yt-kb/scripts/copy-content.mjs`: updated above.
- `server/scripts/verify-mcp-tools.cjs`: unaffected (imports tool bodies by file, already broken since 698a887); removed in M6 (M-21).
- Tokens holding the legacy tiers: migrated at boot (no caller edit).
- **M8 (docs, Elephant):** `CLAUDE.md` (MCP section: tiers, "Adding a tool", `sideEffects`, token mint), `docs/mcp.md` (Authentication and mint command lines 35-77, Tools list, curl smoke test, Architecture notes lines 228-260), `README.md` (tool tree lines 168-169, mint command line 180), `docs/architecture.md:176, 714`, `docs/designs/yt-kb-plugin.md:23, 76`; plus the token-script usage, the `import: true` step for `copy-content.mjs`, and the M-9 rule.

#### Verify

Run from the repo root with M1's check conventions and the kit as extended in M3 Verify 2. Every check uses a **scratch copy** of the DB, `server/.tmp/e8-m5.db`, on port **1341**; the owner's `server/.tmp/data.db` is only read once, by the kit's online `backup`. No step prints a key: keys live in `server/.tmp/e8/tokens.json` and in the mode-0600 files `create-tokens.cjs` writes under `server/.tmp/e8/`, and reach the kit as a token key or `@<file>`. Run steps 2–9 in **one** shell session (they share `K`, `T`, `A`, `DB`, `SQL`, `TOKQ`, `OLDSITE`, `VID`, `TID`).

0. **Ports free:** M1 precondition 1's command → `"busy":false` for 1340, 1341 and 3005.

1. **Static gates**
   - `yarn --cwd server/src/plugins/yt-kb test` → exit 0 (the eight new/updated test files above pass: `names`, `adapter`, `ai-tools`, `legacy-grants`, `users-permissions`, `controllers/importer`, the guard, `bootstrap`).
   - `yarn --cwd server/src/plugins/yt-kb test:ts:back` → exit 0.
   - `yarn --cwd server/src/plugins/yt-kb build` → exit 0.
   - `yarn test` → exit 0 (client suite; no client file changed).

2. **Extend the check kit, and write the inspect helper** (scratch, never committed):
   - Add to `commands` in `server/.tmp/e8/e8.mjs`:
     ```js
     // Added in M5. Committed writes (one or more statements) on a scratch
     // DB only: refuses any file whose name does not start with "e8-".
     async exec(file, query) {
       if (!path.basename(file).startsWith('e8-')) die({ error: `refusing to write ${file}: not a scratch DB (e8-*)` });
       const db = new Database(file, { fileMustExist: true, timeout: 10000 });
       db.pragma('foreign_keys = ON');
       try { db.exec(query); } catch (e) { db.close(); die({ ok: false, code: e.code ?? null, message: e.message }); }
       db.close();
       print({ ok: true });
     },
     ```
     Check: `node $K exec server/.tmp/data.db 'SELECT 1'` → exits 1 with `refusing to write` (negative: the kit cannot write the owner's DB).
   - `server/.tmp/e8/m5-inspect.cjs` — loads Strapi in-process on the scratch DB (which runs the plugin bootstrap) and reports what only an in-process check can see: the registered actions and what `strapi-plugin-tanstack-ai` would accept from `ai-tools`. It mints nothing and prints no key. Run with cwd = `server/`.
     ```js
     'use strict';
     const path = require('node:path');
     const appDir = process.cwd();
     const { createStrapi } = require(require.resolve('@strapi/strapi', { paths: [appDir] }));
     (async () => {
       const app = createStrapi({ appDir, distDir: path.join(appDir, 'dist') });
       const db = path.basename(String(app.config.get('database.connection.connection.filename')));
       if (db !== 'e8-m5.db') { console.error(`refusing: database is ${db}, not e8-m5.db`); process.exit(2); }
       await app.load();
       try {
         const provider = app.service('admin::permission').actionProvider;
         const toolActions = provider.keys().filter((k) => k.startsWith('plugin::yt-kb.tool.'));
         const legacyDisplayNames = ['read', 'write', 'maintenance'].map((u) => provider.get(`plugin::yt-kb.${u}`)?.displayName ?? null);
         const svc = app.plugin('yt-kb').service('ai-tools');
         const tools = svc.getTools();
         // the checks tanstack-ai 1.7.0 applies (TS L1870-1905) plus its schema conversion
         const aiUsable = Array.isArray(tools) && tools.every((t) =>
           t.name && typeof t.execute === 'function' && t.schema && provider.get(t.action) &&
           (() => { try { t.schema['~standard'].jsonSchema.input({ target: 'draft-07' }); return true; } catch { return false; } })());
         console.log(JSON.stringify({ db, toolActions: toolActions.length, legacyDisplayNames, aiTools: tools.length, aiUsable, aiMeta: svc.getMeta().label }));
       } finally {
         await app.destroy();
       }
       process.exit(0);
     })().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
     ```

3. **Scratch set-up** (before anything boots M5 code on the copy):
   ```bash
   set -euo pipefail
   K=server/.tmp/e8/e8.mjs; T=server/.tmp/e8/tokens.json; A=server/.tmp/e8/admin.json; DB=server/.tmp/e8-m5.db
   SQL() { node $K sql $DB "$1" | jq -r '.rows[0].n'; }
   TOKQ="FROM admin_permissions p JOIN admin_permissions_api_token_lnk l ON l.permission_id=p.id JOIN strapi_api_tokens t ON t.id=l.api_token_id WHERE t.name='claude-mcp-1782487483515'"
   node $K backup server/.tmp/data.db $DB
   yarn --cwd server/src/plugins/yt-kb build && yarn --cwd server build
   test "$(SQL "SELECT COUNT(*) AS n $TOKQ AND p.action IN ('plugin::yt-kb.read','plugin::yt-kb.write','plugin::yt-kb.maintenance')")" = 3
   test "$(SQL "SELECT COUNT(*) AS n $TOKQ AND p.action LIKE 'plugin::yt-kb.tool.%'")" = 0
   # a Public-role yt-kb grant for the U&P cleanup to remove (scratch only)
   node $K exec $DB "INSERT INTO up_permissions (document_id, action, created_at, updated_at, published_at) VALUES ('m5verifyupperm0000000001','plugin::yt-kb.video.find',datetime('now'),datetime('now'),datetime('now')); INSERT INTO up_permissions_role_lnk (permission_id, role_id) SELECT last_insert_rowid(), id FROM up_roles WHERE type='public';"
   test "$(SQL "SELECT COUNT(*) AS n FROM up_permissions p JOIN up_permissions_role_lnk l ON l.permission_id=p.id JOIN up_roles r ON r.id=l.role_id WHERE r.type IN ('public','authenticated') AND p.action LIKE 'plugin::yt-kb.%'")" = 1
   # the copy holds the owner's read-only yt-kb-site (Facts 9); step 5 rotates it, as Deployment step 3 does
   OLDSITE=$(SQL "SELECT id AS n FROM strapi_api_tokens WHERE name='yt-kb-site' AND type='read-only'")
   test -n "$OLDSITE" && test "$OLDSITE" != null
   test "$(SQL "SELECT COUNT(*) AS n FROM strapi_api_tokens WHERE name='yt-kb-app'")" = 0
   ```

4. **First boots on the scratch DB (run the migration and the U&P cleanup), then inspect:**
   ```bash
   (cd server && DATABASE_FILENAME=.tmp/e8-m5.db yarn -s strapi admin:create-user --email="$(node -p 'require("./.tmp/e8/admin.json").email')" --password="$(node -p 'require("./.tmp/e8/admin.json").password')" --firstname=E8 --lastname=Check)
   (cd server && DATABASE_FILENAME=.tmp/e8-m5.db PORT=1341 HOST=127.0.0.1 node .tmp/e8/m5-inspect.cjs) > server/.tmp/e8/m5-inspect.json
   jq -e '.db=="e8-m5.db" and .toolActions==21 and .aiTools==21 and .aiUsable==true and .aiMeta=="YT Knowledge Base"' server/.tmp/e8/m5-inspect.json
   jq -e '.legacyDisplayNames | all(type=="string" and endswith(" (legacy — migrated at boot)"))' server/.tmp/e8/m5-inspect.json
   test "$(SQL "SELECT COUNT(DISTINCT p.action) AS n $TOKQ AND p.action LIKE 'plugin::yt-kb.tool.%'")" = 21
   test "$(SQL "SELECT COUNT(*) AS n $TOKQ AND p.action LIKE 'plugin::yt-kb.tool.%'")" = 21
   test "$(SQL "SELECT COUNT(*) AS n $TOKQ AND p.action IN ('plugin::yt-kb.read','plugin::yt-kb.write','plugin::yt-kb.maintenance')")" = 0
   test "$(SQL "SELECT COUNT(*) AS n FROM admin_permissions p JOIN admin_permissions_role_lnk l ON l.permission_id=p.id JOIN admin_roles r ON r.id=l.role_id WHERE r.code='strapi-super-admin' AND p.action LIKE 'plugin::yt-kb.tool.%'")" = 21
   test "$(SQL "SELECT COUNT(*) AS n FROM up_permissions p JOIN up_permissions_role_lnk l ON l.permission_id=p.id JOIN up_roles r ON r.id=l.role_id WHERE r.type IN ('public','authenticated') AND p.action LIKE 'plugin::yt-kb.%'")" = 0
   ```

5. **Token script** (scratch Strapi still stopped). The first run is the Deployment step 3 command on the copy: it creates `yt-kb-app` and rotates the existing read-only `yt-kb-site`:
   ```bash
   (cd server && DATABASE_FILENAME=.tmp/e8-m5.db PORT=1341 node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app .tmp/e8/m5-app.key --out-site .tmp/e8/m5-site.key --rotate yt-kb-site) > server/.tmp/e8/m5-create-tokens.log 2>&1
   node -e 'const fs=require("fs");const bad=process.argv.slice(1).filter(f=>(fs.statSync(f).mode&0o777)!==0o600);console.log(JSON.stringify({bad}));process.exit(bad.length?1:0)' server/.tmp/e8/m5-app.key server/.tmp/e8/m5-site.key
   test "$(node $K sql $DB "SELECT type AS n FROM strapi_api_tokens WHERE name='yt-kb-app'" | jq -r '.rows[0].n')" = custom
   # rotate: the old read-only row is gone, one custom yt-kb-site replaces it
   test "$(SQL "SELECT COUNT(*) AS n FROM strapi_api_tokens WHERE id=$OLDSITE")" = 0
   test "$(SQL "SELECT COUNT(*) AS n FROM strapi_api_tokens WHERE name='yt-kb-site' AND type='custom'")" = 1
   test "$(SQL "SELECT COUNT(*) AS n FROM strapi_api_tokens WHERE name='yt-kb-site'")" = 1
   node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8");const ok=l.includes("revoked yt-kb-site")&&l.includes("created yt-kb-site")&&l.includes("created yt-kb-app")&&!l.includes("revoked yt-kb-app");console.log(JSON.stringify({ok}));process.exit(ok?0:1)' server/.tmp/e8/m5-create-tokens.log
   test "$(SQL "SELECT COUNT(*) AS n FROM strapi_api_token_permissions p JOIN strapi_api_token_permissions_token_lnk l ON l.api_token_permission_id=p.id JOIN strapi_api_tokens t ON t.id=l.api_token_id WHERE t.name='yt-kb-app'")" = 24
   test "$(SQL "SELECT COUNT(*) AS n FROM strapi_api_token_permissions p JOIN strapi_api_token_permissions_token_lnk l ON l.api_token_permission_id=p.id JOIN strapi_api_tokens t ON t.id=l.api_token_id WHERE t.name='yt-kb-site'")" = 2
   # Negative: second run leaves both tokens alone and writes nothing; also boots with MCP off, which must not lose grants
   (cd server && DATABASE_FILENAME=.tmp/e8-m5.db PORT=1341 MCP_ENABLED=false node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app .tmp/e8/m5-app2.key --out-site .tmp/e8/m5-site2.key)
   test ! -e server/.tmp/e8/m5-app2.key && test ! -e server/.tmp/e8/m5-site2.key
   test "$(SQL "SELECT COUNT(*) AS n FROM strapi_api_tokens WHERE name IN ('yt-kb-app','yt-kb-site')")" = 2
   test "$(SQL "SELECT COUNT(*) AS n $TOKQ AND p.action LIKE 'plugin::yt-kb.tool.%'")" = 21
   # Negative: refuses an existing output file before loading Strapi
   rc=0; (cd server && DATABASE_FILENAME=.tmp/e8-m5.db PORT=1341 node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app .tmp/e8/m5-app.key --out-site .tmp/e8/m5-x.key) || rc=$?; test "$rc" -eq 2
   # Negative: --rotate accepts only the script's two names (never yt-kb-client), before loading Strapi
   rc=0; (cd server && DATABASE_FILENAME=.tmp/e8-m5.db PORT=1341 node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app .tmp/e8/m5-a4.key --out-site .tmp/e8/m5-s4.key --rotate yt-kb-client) || rc=$?; test "$rc" -eq 2
   test ! -e server/.tmp/e8/m5-a4.key && test ! -e server/.tmp/e8/m5-s4.key
   ```

6. **Start the scratch server, mint the check tokens:**
   ```bash
   (cd server && DATABASE_FILENAME=.tmp/e8-m5.db PORT=1341 HOST=127.0.0.1 nohup yarn develop > .tmp/e8/m5-strapi.log 2>&1 &)
   node $K wait http://127.0.0.1:1341/_health 300
   # Negative: the token script refuses while Strapi runs on SQLite
   rc=0; (cd server && DATABASE_FILENAME=.tmp/e8-m5.db PORT=1341 node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app .tmp/e8/m5-a3.key --out-site .tmp/e8/m5-s3.key) || rc=$?; test "$rc" -eq 2
   test ! -e server/.tmp/e8/m5-a3.key
   # Idempotent: the later boots changed nothing
   test "$(SQL "SELECT COUNT(*) AS n $TOKQ AND p.action LIKE 'plugin::yt-kb.tool.%'")" = 21
   TOOLS=$(node -e 'console.log("library-stats,list-videos,search-videos,get-video,get-transcript,search-transcript,find-transcripts,cross-search-transcripts,list-transcripts,aggregate-by-tag,list-untagged,list-tags,related-videos,get-readable-article,generate-digest,save-summary,tag-video,untag-video,save-note,add-video,fetch-transcript".split(",").map(k=>"plugin::yt-kb.tool."+k).join(","))')
   node $K admin-tokens http://127.0.0.1:1341 $A $T "$TOOLS" | jq -e '.ok==true and (.grantedActions|length)==21'
   node $K token $T $A one admin plugin::yt-kb.tool.get-video | jq -e '.ok==true'
   node $K token $T $A import content-api plugin::yt-kb.importer.importRecords | jq -e '.ok==true'
   APP=@server/.tmp/e8/m5-app.key; SITE=@server/.tmp/e8/m5-site.key
   VID=$(node $K sql $DB "SELECT youtube_video_id AS n FROM yt_kb_videos ORDER BY id LIMIT 1" | jq -r '.rows[0].n')
   TID=$(node $K sql $DB "SELECT youtube_video_id AS n FROM yt_kb_transcripts ORDER BY id LIMIT 1" | jq -r '.rows[0].n')
   ```
   The token keys are now: `mcp` (the 21 tool actions), `one` (`plugin::yt-kb.tool.get-video` only), `import` (Content API, `importer.importRecords` only), `rest` (full-access), and the files `$APP` / `$SITE` from `create-tokens.cjs`.

7. **MCP over `POST /mcp`:**
   ```bash
   EXPECTED='["yt_kb__add_video","yt_kb__aggregate_by_tag","yt_kb__cross_search_transcripts","yt_kb__fetch_transcript","yt_kb__find_transcripts","yt_kb__generate_digest","yt_kb__get_readable_article","yt_kb__get_transcript","yt_kb__get_video","yt_kb__library_stats","yt_kb__list_tags","yt_kb__list_transcripts","yt_kb__list_untagged","yt_kb__list_videos","yt_kb__related_videos","yt_kb__save_note","yt_kb__save_summary","yt_kb__search_transcript","yt_kb__search_videos","yt_kb__tag_video","yt_kb__untag_video"]'
   node $K mcpx $T mcp tools/list | jq -e --argjson want "$EXPECTED" '.httpStatus==200 and ([.result.tools[].name|select(startswith("yt_kb__"))]|sort)==$want'
   # no bare old names, and (M-9) a yt-kb-only token sees nothing but yt-kb's tools: every listed name is yt_kb__* or `log` (@strapi/core's own tool, services/mcp/tools/log.js, dev mode only)
   node $K mcpx $T mcp tools/list | jq -e '[.result.tools[].name] | (index("getVideo")==null) and (index("libraryStats")==null) and all(startswith("yt_kb__") or . == "log")'
   # fetch tool: no proxyUrl argument
   node $K mcpx $T mcp tools/list | jq -e '[.result.tools[]|select(.name=="yt_kb__fetch_transcript")|.inputSchema.properties|keys] == [["force","videoId"]]'
   # Negative: a token holding only plugin::yt-kb.tool.get-video sees exactly one yt-kb tool
   node $K mcpx $T one tools/list | jq -e '[.result.tools[].name|select(startswith("yt_kb__"))]==["yt_kb__get_video"]'
   # works, and is refused outside the grant
   node $K mcpx $T one tools/call "{\"name\":\"yt_kb__get_video\",\"arguments\":{\"videoId\":\"$VID\"}}" | jq -e '.rpcError==null and (.result.isError // false)==false'
   node $K mcpx $T one tools/call '{"name":"yt_kb__library_stats","arguments":{}}' | jq -e '.rpcError!=null or .result.isError==true'
   # Negative: the id check runs before any YouTube call
   node $K mcpx $T mcp tools/call '{"name":"yt_kb__fetch_transcript","arguments":{"videoId":"not-an-id"}}' | jq -e '.rpcError!=null or .result.isError==true'
   # Negative: a Content API token is not accepted on /mcp
   node $K mcpx $T "$APP" tools/list | jq -e '.initStatus==401'
   ```

8. **REST: token scopes, import gate, admin route** (B-5, M-14, M-7; these are the plugin's server handlers the app and site call):
   ```bash
   node $K rest $T GET '/api/yt-kb/videos?pagination[pageSize]=1&fields[0]=documentId' '' "$APP" | jq -e '.status==200'
   node $K rest $T GET '/api/yt-kb/transcripts?pagination[pageSize]=1&fields[0]=youtubeVideoId' '' "$APP" | jq -e '.status==200'
   node $K rest $T GET "/api/yt-kb/yt-transcript/$TID" '' "$APP" | jq -e --arg tid "$TID" '.status==200 and .body.data.youtubeVideoId==$tid'
   node $K rest $T POST /api/yt-kb/transcripts '{"data":{"youtubeVideoId":"aaaaaaaaaaa"}}' "$APP" | jq -e '.status==403'   # negative
   node $K rest $T GET /api/users '' "$APP" | jq -e '.status==403'                                                      # negative
   node $K rest $T POST /api/yt-kb/import/tag '{"data":[]}' "$APP" | jq -e '.status==403'                               # negative (no scope)
   node $K rest $T GET '/api/yt-kb/videos?pagination[pageSize]=1&fields[0]=documentId' '' "$SITE" | jq -e '.status==200'
   node $K rest $T GET '/api/yt-kb/tags?pagination[pageSize]=1' '' "$SITE" | jq -e '.status==200'
   node $K rest $T GET /api/yt-kb/notes '' "$SITE" | jq -e '.status==403'                                               # negative
   node $K rest $T GET /api/users '' "$SITE" | jq -e '.status==403'                                                     # negative
   node $K rest $T GET /api/yt-kb/videos '' none | jq -e '.status==403'                                                 # negative: Public
   # import gate: a token WITH the import scope is still refused while config import is false
   node $K rest $T POST /api/yt-kb/import/tag '{"data":[]}' import | jq -e '.status==403 and .body.error.message=="Import is disabled. Set the yt-kb plugin config `import: true` to enable it."'
   # M3's admin route is gated by plugin::yt-kb.tool.fetch-transcript, now from the generated list (stored id → no YouTube call)
   node $K rest $T GET "/yt-kb/yt-transcript/$TID" '' mcp | jq -e '.status==200'
   node $K rest $T GET "/yt-kb/yt-transcript/$TID" '' one | jq -e '.status==403'                                       # negative
   ```
   207 is covered by `importer.test.ts` (it needs `import: true`, which the test host does not set).

9. **Clean up:** `lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill; rm -f server/.tmp/e8-m5.db* server/.tmp/e8/m5-*`.

10. **Owner's DB:** not booted in E8. Its migration runs at Deployment step 2, which backs it up first (Data, above) and checks the resulting count.

- **Done when:** the plugin tests, typecheck and build pass, and every check in steps 4–8 exits 0 on the scratch copy: `tools/list` returns exactly the 21 `yt_kb__*` names for a token holding the 21 per-tool actions and only `yt_kb__get_video` for a token holding `plugin::yt-kb.tool.get-video`; the migrated `claude-mcp-1782487483515` holds 21 tool rows and 0 legacy rows; `create-tokens.cjs --rotate yt-kb-site` replaces the copy's read-only `yt-kb-site` with the custom one and a run without `--rotate` changes nothing; the import route returns 403 with the gate message under the default config.
- **Rollback:** revert the M5 commit **and** restore the DB from the backup: with Strapi stopped, `cp server/.tmp/data.db.pre-m5-<TS> server/.tmp/data.db` (Postgres host: restore the `pg_dump`). Reverting code alone is not enough: the migration deleted the tokens' legacy rows, and the reverted code does not register `plugin::yt-kb.tool.*`, so admin's cleanup would delete the per-tool rows on the next boot and leave `claude-mcp-1782487483515` with no grants. Without a backup, re-grant `plugin::yt-kb.read`, `.write`, `.maintenance` after the revert, with Strapi stopped, from `server/` (after `yarn plugin:build && yarn --cwd server build`, so the reverted plugin registers the three tier actions). `assignAdminPermissionsToToken(tokenId, permissions, ceilingUser)` (`@strapi/admin/dist/server/server/src/services/api-token.js:310`) replaces the token's grants with `permissions`, clamped to the ceiling user's — here the token's owner, loaded with its roles (`isSuperAdmin` reads `user.roles[].code`, `:39`):
  ```bash
  (cd server && node -e '
  const { createStrapi } = require("@strapi/strapi");
  (async () => {
    const app = createStrapi({ appDir: process.cwd(), distDir: require("path").join(process.cwd(), "dist") });
    await app.load();
    try {
      const token = await app.db.query("admin::api-token").findOne({
        where: { name: "claude-mcp-1782487483515", kind: "admin" },
        populate: { adminUserOwner: { populate: ["roles"] } },
      });
      if (!token || !token.adminUserOwner) throw new Error("token or its owner not found");
      const perms = ["read", "write", "maintenance"].map((t) => ({ action: `plugin::yt-kb.${t}`, subject: null, properties: {}, conditions: [] }));
      const now = await app.service("admin::api-token-admin").assignAdminPermissionsToToken(token.id, perms, token.adminUserOwner);
      console.log(JSON.stringify({ tokenId: token.id, actions: now.map((p) => p.action).sort() }));
    } finally {
      await app.destroy();
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });')
  ```
  → prints `actions` = `["plugin::yt-kb.maintenance","plugin::yt-kb.read","plugin::yt-kb.write"]` (no key is printed). Tokens created by `create-tokens.cjs` survive a revert; revoke them in Settings → API Tokens if unwanted. MCP clients get the old tool names back after reconnecting.

#### Environment and deployment (M5)

- No environment variable added, changed or removed (the plugin config key `import` defaults to `false`; `proxyUrl`/`PROXY_URL` belong to M3).
- Order on a host: back up the DB → deploy the plugin build → boot once (migration runs in plugin bootstrap, before admin's cleanup) → reconnect MCP clients (new names) → run `create-tokens.cjs` with Strapi stopped (SQLite) to mint `yt-kb-app` / `yt-kb-site` (`--rotate yt-kb-site` where an older `yt-kb-site` exists, as on this repo's DB). Putting the keys into `client/.env` and `site/.env` is an **owner action**: the agent writes the keys to 0600 files, gives the owner the two paths, and never opens or edits a `.env` (Deployment step 3; M6 and M7 rely on it).
- Strapi Cloud: the migration needs no shell. Strapi Cloud's managed database is not reachable from outside, so the tokens are created in the admin panel — the main path there: Settings → API Tokens → Create new API Token, type Custom, with exactly the scopes `create-tokens.cjs` lists for `yt-kb-app` and `yt-kb-site` (documented in M8). A self-hosted Postgres host whose database the operator can reach may run the script from a local checkout of the host app pointed at it.
- `strapi-plugin-tanstack-ai` hosts: super admins see the 21 tools at once (Strapi's reset grants them); other admin roles need the per-tool actions ticked under Settings → Roles → Plugins → YT Knowledge Base → AI tools (M8 documents it).

### M6 — App: security, network and UI states, backfills, dead weight

- **Why:** B-1, B-5, B-6 (owner-added: chat retrieval reads a stripped row), M-4 (app-side timeouts only; retry classification is M3), M-8, M-12 (app side: tag lookups normalised like the plugin), M-13 (backfills, counters and the AI re-rate's video list), M-15, M-21; and B-2's app side where it needs M3's `error.details` — the re-read check also matches the plugin's `details.code: 'YT_KB_UNIQUE'` (M2 already wrote the re-reads in `createVideoService`, tag create and `saveDigest`). M-20 was done in M1 and is not repeated here.
- **Depends on:** M1–M5 committed. M2 added the unique indexes and the tag-slug suffix rule; M3 made `strapiFetch`/`requestTranscriptFetchService` carry `reason`; M5 shipped `server/src/plugins/yt-kb/scripts/create-tokens.cjs`, which makes the `yt-kb-app` and `yt-kb-site` custom tokens. Line numbers below are at `721f210`; M1–M5 may have moved them, so each edit also names its function. Where M3 changed a function this milestone also edits, keep M3's lines and apply only the change described here.
- **Pre-checks (STOP and ask if one fails):**
  1. `git log --oneline -6` shows the M1–M5 commits on `egm/yt-kb-any-strapi`.
  2. `node -e "const s=require('./package.json').scripts; process.exit(/plugins\/yt-kb/.test(s['install:all']) ? 0 : 1)"` from the repo root exits 0 (M1 installs the plugin's own `node_modules`; step 6.10 depends on it).
  3. `test -f server/src/plugins/yt-kb/scripts/create-tokens.cjs` exits 0.

#### 6.0 Baseline (run before any M6 edit)

The payload check in V4 compares against this. It uses a scratch Strapi with a synthetic library — never `server/.tmp/data.db`, never the owner's tokens. Run **V-setup** steps S0–S4 below, then S6 with `STRAPI_URL=http://127.0.0.1:1341 STRAPI_API_TOKEN="$(cat "$SCRATCH/app.key")"` — this is still the M5 client, which listens on `localhost` (Vite's default), so wait with `node $K wait http://localhost:3005/about 120` instead of `127.0.0.1`. Then:

```bash
curl -s -o "$SCRATCH/feed-before.html" -w '%{size_download}\n' http://localhost:3005/feed > "$SCRATCH/feed-before.bytes"
node -e "const n=+require('fs').readFileSync(process.argv[1],'utf8'); console.log({feedBeforeBytes:n}); process.exit(n>2_000_000?0:1)" "$SCRATCH/feed-before.bytes"
```

Expected: exit 0 (the nine newest fixture rows carry ~3 MB of embeddings into the page). Then stop the app and the scratch Strapi (`lsof -ti tcp:3005 -sTCP:LISTEN | xargs kill; lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill`) but **keep** `$SCRATCH` (`server/.tmp/e8/m6`) and `server/.tmp/e8-m6.db`: Verify continues from them.

#### 6.1 B-1 — escape every Strapi path segment, validate every documentId

- `client/src/lib/services/strapi-client.ts` — add after `buildQueryParams` (≈ line 141):

  ```ts
  // -----------------------------------------------------------------------------
  // Path segments
  // -----------------------------------------------------------------------------

  /** Encode one Strapi path segment. Every value from input goes through this
   *  before it is put into a path (B-1): `fetch` resolves dot segments, so an
   *  unencoded `../../users/1` turns `/api/yt-kb/notes/<id>` into
   *  `/api/users/1`, sent with the app's token. encodeURIComponent turns `/`,
   *  `?` and `#` into %2F, %3F and %23. It leaves `.` alone, and a WHATWG URL
   *  resolves a whole `..` or `.` segment (and `%2e%2e`) even when encoded, so
   *  those — and the empty segment — are refused outright. */
  export function seg(value: string): string {
    if (value === '' || value === '.' || value === '..') {
      throw new Error(`Refusing to build a Strapi path from the segment "${value}"`);
    }
    return encodeURIComponent(value);
  }
  ```

  and replace the header comment's lines 7–8 (`// Used by \`videos.ts\`, \`notes.ts\`, \`digests.ts\`. Server-only — …`) with:

  ```ts
  // Used by every service that talks to Strapi (`videos.ts`, `notes.ts`,
  // `digests.ts`, `reader.ts`) and the Settings backfill server functions.
  // Server-only — pulls `STRAPI_URL` and `STRAPI_API_TOKEN` from the env layer.
  ```

- `client/src/lib/validations/post.ts` — add after the `CreateVideoInputSchema` block (after line 48):

  ```ts
  // =============================================================================
  // Identifiers that reach Strapi paths
  // =============================================================================

  /** A Strapi 5 documentId: 24 lowercase letters and digits (cuid2, as
   *  `@strapi/core` generates it). Every documentId a server function accepts
   *  is validated with this before it can reach a Strapi path (B-1). */
  export const DOCUMENT_ID = z.string().regex(/^[a-z0-9]{24}$/, 'Invalid documentId');

  /** An id that may be either a YouTube video id or a documentId — the digest
   *  and chat-to-note paths accept both and try the YouTube id first. Letters,
   *  digits, `_` and `-` only, so it can never carry a path separator or a dot
   *  segment. A documentId inside it is still checked with DOCUMENT_ID before
   *  it is used in a path. */
  export const VIDEO_REF = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid video id');
  ```

- Every Strapi path built from input, and its edit. In each line replace the bare interpolation with `seg(…)`, and add `seg` to the file's `./strapi-client` import:

  | File:line @721f210 | Function | Change |
  |---|---|---|
  | `client/src/lib/services/videos.ts:448` | `updateVideoIndexService` | `` `/api/yt-kb/videos/${seg(documentId)}` `` |
  | `videos.ts:468` | `fetchVideoByDocumentIdService` | `` `/api/yt-kb/videos/${seg(documentId)}` `` (and see 6.4) |
  | `videos.ts:522` | `fetchVideoByDocumentIdWithStatusService` | `` `/api/yt-kb/videos/${seg(documentId)}` `` |
  | `videos.ts:653` | `updateVideoSummaryService` | `` `/api/yt-kb/videos/${seg(documentId)}` `` |
  | `videos.ts:681` | `updateVideoEmbeddingService` | `` `/api/yt-kb/videos/${seg(input.documentId)}` `` |
  | `videos.ts:703` | `updateVideoPassagesService` | `` `/api/yt-kb/videos/${seg(input.documentId)}` `` |
  | `videos.ts:717` | `markSummaryFailedService` | `` `/api/yt-kb/videos/${seg(documentId)}` `` |
  | `videos.ts:744` | `updateVideoVerdictService` | `` `/api/yt-kb/videos/${seg(input.documentId)}` `` |
  | `videos.ts:776` | `updateVideoSignalScoresService` | `` `/api/yt-kb/videos/${seg(input.documentId)}` `` |
  | `videos.ts:807` | `updateVideoValueScoreService` | `` `/api/yt-kb/videos/${seg(input.documentId)}` `` |
  | `videos.ts:829` | `updateVideoFinalScoreService` | `` `/api/yt-kb/videos/${seg(input.documentId)}` `` |
  | `videos.ts:846` and `:864` | `updateSectionTimecodeService` (read and write) | `` `/api/yt-kb/videos/${seg(input.documentId)}` `` |
  | `videos.ts:877` | `markSummaryPendingService` | `` `/api/yt-kb/videos/${seg(documentId)}` `` |
  | `videos.ts:946` | `linkVideoToTranscriptService` | `` `/api/yt-kb/videos/${seg(videoDocumentId)}` `` |
  | `client/src/lib/services/digests.ts:252` | `fetchDigestByDocumentIdService` | `` `/api/yt-kb/digests/${seg(documentId)}` `` |
  | `digests.ts:279` | `updateDigestService` | `` `/api/yt-kb/digests/${seg(input.documentId)}` `` |
  | `digests.ts:305` | `deleteDigestService` | `` `/api/yt-kb/digests/${seg(documentId)}` `` |
  | `client/src/lib/services/notes.ts:117` | `updateNoteService` | `` `/api/yt-kb/notes/${seg(input.documentId)}` `` |
  | `notes.ts:128` | `deleteNoteService` | `` `/api/yt-kb/notes/${seg(documentId)}` `` |
  | `client/src/lib/services/reader.ts:351-381` | `persistArticle` | replace the whole function (raw `fetch` → `strapiFetch`, M-21) — below |

  No other file in `client/src` builds a Strapi path from input (`grep -rnE '/api/yt-kb/[a-z-]+/\$\{' client/src` lists exactly the rows above; every other call passes ids through `filters`, which `URLSearchParams` encodes). `transcripts/fetch` takes the id in its body.

  `reader.ts` — replace `persistArticle` (lines 351–381) with:

  ```ts
  async function persistArticle(
    documentId: string,
    article: string,
  ): Promise<ServiceResult<ReadableArticleResult>> {
    const now = new Date().toISOString();
    const result = await strapiFetch<unknown>('PUT', `/api/yt-kb/videos/${seg(documentId)}`, {
      body: {
        data: {
          readableArticle: article,
          readableArticleGeneratedAt: now,
          readableArticleModel: MODEL,
        },
      },
    });
    if (!result.ok) {
      // strapiFetch has already logged the status and body.
      return {
        success: false,
        error: `Strapi save failed: ${friendlyBackendError(result.status, result.error)}`,
      };
    }
    return { success: true, data: { article, generatedAt: now, model: MODEL } };
  }
  ```

  and add to its imports: `import { seg, strapiFetch } from '#/lib/services/strapi-client';` and `import { friendlyBackendError } from '#/lib/services/backend-errors';`.

- Server-function schemas. Every schema that takes a documentId uses `DOCUMENT_ID`; every schema whose ids may be either kind uses `VIDEO_REF`. Each schema below becomes `export const` (so the test in 6.11 can import it; TanStack Start keeps non-server-fn exports as-is). Add `DOCUMENT_ID` / `VIDEO_REF` to each file's import from `#/lib/validations/post`.

  | File:line @721f210 | Schema | New field definition |
  |---|---|---|
  | `client/src/data/server-functions/videos.ts:124` | `DocumentIdSchema` | `export const DocumentIdSchema = z.object({ documentId: DOCUMENT_ID });` |
  | `server-functions/videos.ts:289-293` | `UpdateSectionTimecodeSchema` | `documentId: DOCUMENT_ID,` (sectionId, timeSec unchanged) |
  | `server-functions/notes.ts:17-19` | `ListNotesSchema` | `videoDocumentId: DOCUMENT_ID,` |
  | `notes.ts:41-47` | `CreateNoteSchema` | `videoDocumentIds: z.array(DOCUMENT_ID).min(1).max(10),` |
  | `notes.ts:69-73` | `UpdateNoteSchema` | `documentId: DOCUMENT_ID,` |
  | `notes.ts:95-97` | `DeleteNoteSchema` | `documentId: DOCUMENT_ID,` |
  | `notes.ts:124-133` | `SummarizeToNoteSchema` | `videoIds: z.array(VIDEO_REF).min(1).max(10),` |
  | `server-functions/digests.ts:122-124` | `LoadDigestSchema` | `videoIds: z.array(VIDEO_REF).min(2).max(5),` |
  | `digests.ts:263-265` | `FetchSavedDigestSchema` | `documentId: DOCUMENT_ID,` |
  | `digests.ts:285-287` | `DeleteSavedDigestSchema` | `documentId: DOCUMENT_ID,` |
  | `server-functions/digest.ts:16-21` | `GenerateDigestSchema` | `videoIds: z.array(VIDEO_REF).min(DIGEST_MIN_VIDEOS).max(DIGEST_MAX_VIDEOS),` |

  Not changed, because their ids only reach `filters` or a body: `SaveDigestSchema.youtubeVideoIds`, `FetchSavedDigestByVideosSchema.youtubeVideoIds`, `VideoIdOnlySchema`, `RelatedVideosSchema`, `VideoIdSchema`, and the API routes `/api/chat`, `/api/digest-chat`, `/api/notes/compose`, `/api/ask` (they look videos up by `youtubeVideoId` filter only). `validations/post.ts:127-131` `ProfileUpdateInputSchema` has no caller and is left alone.

- The three resolvers that fall back from a YouTube id to a documentId call the documentId fetcher only for a well-formed documentId. `server-functions/notes.ts` and `server-functions/digests.ts` already import `DOCUMENT_ID` from `#/lib/validations/post` through the schema bullet above — use that one import and don't add a second (a duplicate import of the same name fails `tsc`). Only `client/src/lib/services/digest-videos.ts` gets a new line, `import { DOCUMENT_ID } from '#/lib/validations/post';` (it has no import from that module at `721f210`).
  - `client/src/data/server-functions/notes.ts:146-151` `resolveVideoById` — replace the body with:

    ```ts
    const byVid = await fetchVideoByVideoIdService(id).catch(() => null);
    if (byVid) return byVid;
    // Only a well-formed documentId may reach a Strapi path (B-1).
    if (!DOCUMENT_ID.safeParse(id).success) return null;
    return await fetchVideoByDocumentIdService(id).catch(() => null);
    ```
  - `client/src/data/server-functions/digests.ts:146-155` `resolveVideo` — insert before `const byDoc = …`:

    ```ts
    if (!DOCUMENT_ID.safeParse(id).success) return { kind: 'missing' };
    ```
  - `client/src/lib/services/digest-videos.ts:46` (inside `resolveDigestVideos`) — insert before `const byDoc = …`:

    ```ts
    if (!DOCUMENT_ID.safeParse(id).success) return { kind: 'missing', id };
    ```

#### 6.2 B-5 — loopback dev server, scoped token

- `client/vite.config.ts` — add the `server` key (Vite 8 `CommonServerOptions`: `host`, `port`, `strictPort`; confirmed in the installed `vite/dist/node/index.d.ts`; M1 pins vite 8.3.6, re-check the same file after M1's install):

  ```ts
  const config = defineConfig({
    resolve: { tsconfigPaths: true },
    // Loopback only (B-5). The app has no sign-in and acts with the
    // yt-kb-app token, so nothing but this machine may reach it.
    // strictPort: fail on a busy port instead of drifting to the next one.
    server: { host: '127.0.0.1', port: 3005, strictPort: true },
    plugins: [devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
  })
  ```

  `client/package.json`'s `"dev": "vite dev --port 3005"` stays (same port; the host comes from the config).
- `client/playwright.config.ts:21` — `baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3005',` (the server no longer listens on `::1`, which `localhost` may resolve to first; the variable lets V-setup run the specs against the verification port).
- `client/.env.example` — replace the whole file with:

  ```bash
  # The Strapi app that hosts strapi-plugin-yt-kb.
  STRAPI_URL=http://localhost:1340

  # Required. The `yt-kb-app` custom Content API token, scoped to yt-kb only:
  # find/findOne/create/update/delete on videos, tags, notes and digests;
  # find/findOne on transcripts; the transcript fetch routes. Create it with the
  # plugin's token script, run from the Strapi app root:
  #   node node_modules/strapi-plugin-yt-kb/scripts/create-tokens.cjs --out-app <file> --out-site <file>
  # (in this repo: cd server && node src/plugins/yt-kb/scripts/create-tokens.cjs …)
  # and paste the contents of the --out-app file here. Never use a Full-access
  # token: this app has no sign-in, so it acts with this token for anyone who
  # can reach it. The plugin grants the Public role nothing, so with this empty
  # every request fails with 403.
  STRAPI_API_TOKEN=

  # Transcripts are fetched from YouTube by Strapi (strapi-plugin-yt-kb), not by
  # this app. Their proxy is the plugin's `proxyUrl` setting (PROXY_URL in the
  # Strapi app's .env).

  # Ollama — local-first AI. Install: `brew install ollama` then
  # `ollama pull gemma4-kb:latest` (or any chat-capable model). Summary
  # generation goes through this, no API key, no credits, no rate limits.
  # Embedding invalidation keys. This app computes and writes every vector; the
  # Strapi plugin only reads them (the relatedVideos MCP tool) and judges
  # staleness with the same two values. A vector is trusted only when its stored
  # (model, version) match the reader's, so mirror any change in the Strapi
  # app's .env, or the side you didn't change treats every new vector as stale.
  #
  # Bump EMBEDDING_VERSION when the embedding text-builder changes; bump
  # PASSAGE_EMBEDDING_VERSION when the passage chunker or its context header
  # changes. Then backfill from /settings.
  EMBEDDING_VERSION=2
  PASSAGE_EMBEDDING_VERSION=3
  OLLAMA_EMBEDDING_MODEL=nomic-embed-text

  OLLAMA_BASE_URL=http://localhost:11434/v1
  OLLAMA_MODEL=gemma4-kb:latest
  # Optional — separate model for chat Q&A. Defaults to OLLAMA_MODEL when
  # unset OR left empty (e.g. `OLLAMA_CHAT_MODEL=`).
  OLLAMA_CHAT_MODEL=

  # Map-step concurrency for long-video summarization (map-reduce path).
  # Default 1 is safe on any hardware. Bump when you have RAM headroom:
  #   - 24GB M4 with Chrome/editor open → keep at 1 (else swaps, slower)
  #   - 48GB M4 Max / M4 Pro            → 2 is comfortable
  #   - 64GB+                           → 3 works
  # Must match `OLLAMA_NUM_PARALLEL` on the Ollama server (set via
  # `launchctl setenv OLLAMA_NUM_PARALLEL 2` and restart the Ollama app).
  # MAP_CONCURRENCY=1
  ```

  (This whole file replaces M3 step 18's one-line edit of line 10 too; the proxy sentence above keeps M3's meaning.)
- `client/src/lib/env.ts:112-124` — replace the `if (!env.STRAPI_API_TOKEN) { … }` block with:

  ```ts
  if (!env.STRAPI_API_TOKEN) {
    // An empty token means strapiFetch sends no Authorization header at all
    // (buildHeaders guards on truthiness), so every request lands as the
    // Public role — and strapi-plugin-yt-kb grants the Public role nothing,
    // so every read and write fails with 403.
    out.push(
      'STRAPI_API_TOKEN is empty — requests carry no Authorization header, act as the Public role ' +
        "and fail with 403. Set it in client/.env to the yt-kb-app token written by the plugin's " +
        'create-tokens.cjs (--out-app).',
    );
  }
  ```

  `env.warnings.test.ts` still passes unchanged (it matches `STRAPI_API_TOKEN` and `/403|Public role/`).

#### 6.3 M-4 — timeouts on every outbound call the app makes

- `client/src/lib/services/strapi-client.ts`:
  - `type FetchOpts` (line 64) gains `/** Abort after this many ms. Default STRAPI_TIMEOUT_MS. */ timeoutMs?: number;`, and add above it:

    ```ts
    /** Default deadline for one Strapi exchange, body included. */
    export const STRAPI_TIMEOUT_MS = 30_000;

    function networkErrorMessage(err: unknown, timeoutMs: number): string {
      if (err instanceof Error && err.name === 'TimeoutError') {
        return `Strapi did not respond within ${Math.round(timeoutMs / 1000)} s.`;
      }
      return err instanceof Error ? err.message : 'Network error';
    }
    ```
  - In `strapiFetch`: after `const hasBody = …` add `const timeoutMs = opts?.timeoutMs ?? STRAPI_TIMEOUT_MS;` and `const signal = AbortSignal.timeout(timeoutMs);`; pass `signal` in the `fetch(url, { method, headers, body, signal })` init; in the network `catch (err)` replace the message line with `const message = networkErrorMessage(err, timeoutMs);`. Replace the success-path `const text = await res.text();` (line 205) with:

    ```ts
    // AbortSignal.timeout also aborts a body that is still streaming, and
    // this helper must never throw.
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      const message = networkErrorMessage(err, timeoutMs);
      logFailure(method, url, 0, message);
      return { ok: false, status: 0, error: message };
    }
    ```

    The `!res.ok` branch keeps M3's version (its `res.text().catch(() => '')` already absorbs an abort).
  - How a timeout surfaces: `{ ok: false, status: 0, error: 'Strapi did not respond within 30 s.' }` (status 0 = network, so M3's `withRetry` treats it as retryable). The 30 s default may be short for whole-corpus reads with `passageEmbeddings` from a remote host (100 rows ≈ 44 MB per page); M-8 defers the corpus cache, so the default stays and E8 records any `Strapi did not respond within 30 s.` seen on `/search`.
- `client/src/lib/services/backend-errors.ts:15-17` — status 0 passes a timeout message through:

  ```ts
  if (status === 0) {
    if (raw.startsWith('Strapi did not respond')) return raw;
    return 'Backend unreachable. Check that Strapi is running on port 1340.';
  }
  ```
- `client/src/lib/services/videos.ts` `requestTranscriptFetchService` — add `export const TRANSCRIPT_FETCH_TIMEOUT_MS = 120_000;` above it, and `timeoutMs: TRANSCRIPT_FETCH_TIMEOUT_MS` to its `strapiFetch('POST', '/api/yt-kb/transcripts/fetch', { … })` options (the plugin's fetcher makes up to 3 attempts of 25 s with backoff, so the app waits longer than one attempt).
- `client/src/lib/services/learning.ts` `fetchYouTubeMeta` (line 188) — add `const OEMBED_TIMEOUT_MS = 5_000;` above it and change the call to `const res = await fetch(url, { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });`. A timeout lands in the existing `catch { return {}; }`: the share continues with no title/author and the `i.ytimg.com` thumbnail fallback.
- `client/src/lib/services/web-search.ts` `ddgSearch` (line 52) — add `const DDG_TIMEOUT_MS = 8_000;` at module level and `signal: AbortSignal.timeout(DDG_TIMEOUT_MS),` to the `fetch` init. A timeout throws `TimeoutError` ("…aborted due to timeout"), which `withRetry` retries once (its patterns match `aborted`/`timeout`); `webSearch` then logs and returns `[]`, so the chat answers without web results.

#### 6.4 M-8 — field allowlists; no embedding reaches the browser

All in `client/src/lib/services/videos.ts`.

- Add after `const SORT_BY` (line 244):

  ```ts
  // Fields a feed card renders (VideoCard, /feed, digest selection). `id` and
  // `documentId` always come back. Leaves out the summary bodies and the three
  // heavy JSON fields — about 9 MB of embeddings per page before M-8.
  const FEED_FIELDS = [
    'youtubeVideoId', 'videoTitle', 'videoAuthor', 'caption', 'createdAt',
    'summaryStatus', 'watchVerdict', 'verdictSummary', 'finalScore',
  ];
  ```

  and in `feedQuery`'s return object add `fields: FEED_FIELDS,` before `populate: ['tags'],`.
- Delete `detailQuery` at lines 312–316. In `CORPUS_BASE_FIELDS` (line 356) add `'createdAt',` as the first entry (semantic-mode feed cards render `VideoCard`, which shows "Added <time>" from it). Directly after `CORPUS_BASE_FIELDS`'s closing `];` (line 364) add — order matters, `detailQuery` reads `CORPUS_BASE_FIELDS`:

  ```ts
  // The Transcript fields the detail views read: TranscriptPane renders
  // rawSegments, /api/notes/compose quotes rawText. Leaves out the plugin's
  // searchIndex (M4) and the YouTube metadata nothing here renders.
  const TRANSCRIPT_DETAIL_FIELDS = [
    'youtubeVideoId', 'title', 'author', 'thumbnailUrl', 'language',
    'durationSec', 'rawSegments', 'rawText', 'fetchedAt',
  ];

  // Detail rows that cross to the browser (/learn, /video, digests, and the
  // chat and compose API routes): every light scalar, the components and the
  // transcript — never the embeddings or the stored BM25 index (M-8).
  const detailQuery: StrapiQuery = {
    fields: CORPUS_BASE_FIELDS,
    populate: {
      tags: true,
      keyTakeaways: true,
      sections: true,
      actionSteps: true,
      transcript: { fields: TRANSCRIPT_DETAIL_FIELDS },
    },
  };

  // Server-internal rows: every field, including transcriptSegments and both
  // embeddings, for chat evidence, related videos, embedding status and
  // generation. Never return one to the client without stripVideoForClient.
  const internalDetailQuery: StrapiQuery = {
    populate: ['tags', 'keyTakeaways', 'sections', 'actionSteps', 'transcript'],
  };
  ```
- `fetchVideoByDocumentIdService` (line 469) and `fetchVideoByVideoIdService` (line 479): `detailQuery` → `internalDetailQuery`. `fetchVideoByDocumentIdWithStatusService`, `fetchVideoByVideoIdWithStatusService` and `updateSectionTimecodeService` keep `detailQuery` (now the allowlisted one).
- `listAllVideosForEmbeddingService` — replace lines 398–401 (`for (const v of result.data ?? []) { const cleaned = stripVideoForClient(v); … }`) with:

  ```ts
  // No strip here: the corpus is server-internal (ranking, coverage) and the
  // caller asked for its embedding field by name. Callers that send rows to
  // the browser strip them.
  for (const v of result.data ?? []) all.push(v);
  ```

  and in its doc comment replace the paragraph at lines 373–374 with `` * `transcriptSegments` is never requested: no corpus caller reads it. ``
- `stripVideoForClient` (lines 498–515) — replace the comment and function with:

  ```ts
  // Null the three heavy server-only fields on any video about to cross the
  // server→client boundary: the stored BM25 index (`transcriptSegments`) and
  // both embeddings. The UI reads none of them (M-8); together they were ~9 MB
  // per feed page. The allowlisted queries above no longer fetch them, so this
  // is the backstop for rows that came from an internal query. seroval 1.6.2+
  // round-trips reserved-name keys (seroval-safety.test.ts), so this is
  // payload hygiene, not a crash workaround.
  export function stripVideoForClient(video: StrapiVideo | null): StrapiVideo | null {
    if (!video) return video;
    return { ...video, transcriptSegments: null, summaryEmbedding: null, passageEmbeddings: null };
  }
  ```
- `client/src/data/server-functions/videos.ts` `semanticSearchVideos` (≈ lines 1046–1058) — replace the hit's `video: { ...candidates[index], summaryEmbedding: null, transcriptSegments: null },` and its comment with `video: stripVideoForClient(candidates[index])!,`.
- `client/src/routes/learn.$videoId.tsx` `EmbeddingPanel` (lines 852–857): the vector no longer reaches the page, so the fallback (used only when `getEmbeddingStatus` failed) reads the timestamp written with it:

  ```ts
  const status: VideoEmbeddingStatus =
    remote && remote.status !== 'error'
      ? remote.status
      : video.embeddingGeneratedAt
        ? 'current'
        : 'missing';
  ```

  and its header comment (lines 825–827) becomes `// Topical embedding status + regenerate affordance. Reads embeddingModel / embeddingVersion / embeddingGeneratedAt from the loaded row; the vector itself never reaches the browser (M-8).`

#### 6.4a B-6 — the chat routes load the row with its stored index

`/api/chat` (`client/src/routes/api.chat.tsx:124` at 721f210) and `/api/digest-chat` (`api.digest-chat.tsx:107`) load the video with `fetchVideoByVideoIdWithStatusService`, which nulls `transcriptSegments` (`stripVideoForClient`) and, after 6.4, does not even request it. `getChatEvidenceForVideo` (`chat-retrieval.ts:132-141`, used by `prepareChatPrompt`) and `retrieveChunksForDigest` (`learning.ts:1481-1488`) then read `video.transcriptSegments`, find no index and retrieve nothing, so both chats answer without transcript passages. Both routes only use the row on the server (they stream the model's answer, never the row), so they get a non-stripping fetch:

- `client/src/lib/services/videos.ts` — add directly after `fetchVideoByVideoIdWithStatusService`:

  ```ts
  /** Server-only: the full row for a youtubeVideoId — the stored BM25 index
   *  (`transcriptSegments`) and the embeddings included — with the same
   *  "no such row" vs "backend down" split as
   *  fetchVideoByVideoIdWithStatusService (ADR-0007). For the chat API
   *  routes, which retrieve passages from the index and never send the row
   *  to the browser (B-6). Never return its row to a client without
   *  stripVideoForClient. */
  export async function fetchVideoByVideoIdForServerWithStatusService(
    videoId: string,
  ): Promise<VideoLookup> {
    const result = await strapiFetch<StrapiVideo[]>('GET', '/api/yt-kb/videos', {
      query: {
        ...internalDetailQuery,
        filters: { youtubeVideoId: { $eq: videoId } },
        pagination: { pageSize: 1 },
      },
    });
    if (result.ok) return { video: result.data?.[0] ?? null, error: null };
    // The list endpoint never 404s — an unknown id returns `data: []`.
    return { video: null, error: friendlyBackendError(result.status, result.error) };
  }
  ```

- `client/src/routes/api.chat.tsx` — line 4 `import { fetchVideoByVideoIdWithStatusService } from '#/lib/services/videos';` → `import { fetchVideoByVideoIdForServerWithStatusService } from '#/lib/services/videos';`; line 124 `const lookup = await fetchVideoByVideoIdWithStatusService(body.videoId);` → `const lookup = await fetchVideoByVideoIdForServerWithStatusService(body.videoId);`; and append to the comment above it (lines 119–122): `// The ForServer variant keeps transcriptSegments: retrieval reads it, and this route never returns the row (B-6).`
- `client/src/routes/api.digest-chat.tsx` — the same import change on line 4; line 107 `const lookup = await fetchVideoByVideoIdWithStatusService(id);` → `const lookup = await fetchVideoByVideoIdForServerWithStatusService(id);`.
- No other caller changes: `fetchVideoByVideoIdWithStatusService` keeps its stripped, allowlisted row for the loaders that ship it to the browser (`/learn`, `/video`, digests).

#### 6.5 B-2 (app side) and M-12 — the duplicate check reads the plugin's code; tag lookups normalise like the plugin

M2 already owns the app's race recovery and is not redone here: `isUniqueViolation(result)` in `strapi-client.ts`; the re-reads in `createVideoService`, `createTagService` and `upsertDigestService`; `saveDigest` through `upsertDigestService`; `shareVideo`'s old race block deleted; and a tag that cannot be stored stops the share with `Could not create tag "<name>": <error>` in the form's error box (M-12: no longer dropped silently). M6 adds what needs M3's `error.details` and M-12's lookups:

- `client/src/lib/services/strapi-client.ts` — replace M2's `isUniqueViolation` (its doc comment and the function) with:

  ```ts
  /** A duplicate on a unique key, so the caller re-reads before reporting an
   *  error: a 400 carrying strapi-plugin-yt-kb's `details.code: 'YT_KB_UNIQUE'`.
   *  Since M2 every duplicate on a yt-kb type has it: yt-kb's create rules
   *  ("… already exists …"), and everything the plugin's Document Service
   *  middleware rethrows as "This attribute must be unique" — a validator
   *  failure on one attribute or several (a lost tag race's "2 errors
   *  occurred"), and a raw unique-index error. The message test is the
   *  fallback for a 400 without details. A 500 is never read as a duplicate:
   *  since M2 a duplicate on a yt-kb type never reaches REST as one. */
  export function isUniqueViolation(result: StrapiResult<unknown>): boolean {
    if (result.ok || result.status !== 400) return false;
    if (result.details?.code === 'YT_KB_UNIQUE') return true;
    return /already exists|must be unique/i.test(result.error);
  }
  ```

  Its callers (`createVideoService`, `createTagService`, `createDigestService`, from M2) do not change.
- `client/src/lib/validations/post.ts` — add above `parseTagInput` and use it there:

  ```ts
  /** Same rule as the plugin's normalizeTagName (PSRC/document-rules.ts):
   *  trim, lowercase, collapse whitespace. Every tag lookup and create in the
   *  app goes through it, so a lookup finds what a create stored (M-12). */
  export function normalizeTagName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }
  ```

  In `parseTagInput` (line 95): `.map((s) => normalizeTagName(s))`.
- `client/src/lib/services/videos.ts` — add `import { normalizeTagName } from '#/lib/validations/post';` (the `./strapi-client` import becomes `import { isUniqueViolation, seg, strapiFetch, type StrapiQuery } from './strapi-client';` with 6.1's `seg`). `findTagByNameService` (line 957): `const name = normalizeTagName(rawName);`. `searchTagsService` (line 969): `const q = normalizeTagName(query);`.
- `client/src/lib/services/digests.ts` — the `./strapi-client` import gains `seg` (6.1) next to M2's `isUniqueViolation`; header line 1 `// Digest CRUD against \`api::digest.digest\`.` → `// Digest CRUD against \`plugin::yt-kb.digest\`.` (M-21 stale comment).
- `client/src/components/NewPostForm.tsx` (M-15: a thrown share used to leave the form with no message):
  - Import `type ShareVideoResult` with `shareVideo`.
  - Replace `onSubmit` (lines 38–65) with:

    ```tsx
    onSubmit: async ({ value }) => {
      setServerError(null);
      const parsed = ShareVideoFormSchema.safeParse(value);
      if (!parsed.success) {
        setServerError('Fix the highlighted fields and try again');
        return;
      }

      let result: ShareVideoResult;
      try {
        result = await shareVideo({
          data: {
            url: parsed.data.url,
            caption: parsed.data.caption || undefined,
            tags: parsed.data.tags || undefined,
            mode: parsed.data.mode,
          },
        });
      } catch (err) {
        // M-15: a thrown server fn (app server down, network) used to leave
        // the form with no message at all.
        setServerError(
          err instanceof Error && err.message
            ? `Couldn't share the video: ${err.message}`
            : "Couldn't share the video. Check that the app is running, then try again.",
        );
        return;
      }

      // Includes M2's "Could not create tag …" (M-12).
      if (result.status === 'error') {
        setServerError(result.error);
        return;
      }

      await router.invalidate();
      router.navigate({
        to: '/learn/$videoId',
        params: { videoId: result.video.youtubeVideoId },
      });
    },
    ```
  - The `serverError` paragraph (line 163) gets `role="alert"`.

#### 6.6 M-15 — route states, retry buttons, poll caps, no preloaded generation

- New `client/src/components/RouteStates.tsx`:

  ```tsx
  import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
  import { Button } from '#/components/ui/button';

  // Router-wide fallbacks (M-15), set in router.tsx. A route with its own
  // pendingComponent (/digest) keeps it.

  export function RouteError({ error }: ErrorComponentProps) {
    const router = useRouter();
    const message = error instanceof Error ? error.message : String(error);
    return (
      <main
        data-testid="route-error"
        className="page-wrap flex min-h-[60vh] items-center justify-center px-4 py-14"
      >
        <section
          role="alert"
          className="mx-auto max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 p-10 text-center"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-destructive">
            Something went wrong
          </p>
          <h1 className="display-title mt-2 text-3xl text-[var(--ink)]">
            This page couldn&apos;t load.
          </h1>
          <details className="mt-3 text-left text-xs text-[var(--ink-soft)]">
            <summary className="cursor-pointer">Details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{message.slice(0, 1000)}</pre>
          </details>
          <div className="mt-6 flex justify-center gap-2">
            <Button size="pill" onClick={() => void router.invalidate()}>
              Retry
            </Button>
            <Button asChild size="pill" variant="outline">
              <Link to="/feed">Back to feed</Link>
            </Button>
          </div>
        </section>
      </main>
    );
  }

  export function RoutePending() {
    return (
      <main
        data-testid="route-pending"
        aria-busy="true"
        className="flex min-h-[60vh] items-center justify-center px-6 py-14"
      >
        <div className="flex items-center gap-3 text-sm text-[var(--ink-muted)]">
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--ink)]"
          />
          Loading…
        </div>
      </main>
    );
  }
  ```
- `client/src/router.tsx` — import `{ RouteError, RoutePending } from '#/components/RouteStates'` and add to `createTanStackRouter({ … })` (both options exist in the installed `@tanstack/react-router` 1.170.41, `dist/esm/router.d.ts:20,27`):

  ```ts
    // M-15: every route without its own error/pending UI gets these.
    defaultErrorComponent: RouteError,
    defaultPendingComponent: RoutePending,
  ```
- `preload: false` — the route option exists in the installed `@tanstack/router-core` 1.171.34 (`dist/esm/route.d.ts:332`) and skips the loader on a preload (`dist/esm/load-client.js:341`, `preloadable = !preload || route.options.preload !== false`). Add, with the comment `// Loader starts Ollama work (generation trigger / digest synthesis): never on hover (M-15).`:
  - `client/src/routes/learn.$videoId.tsx`, in `createFileRoute('/learn/$videoId')({ … })` after `validateSearch`: `preload: false,`
  - `client/src/routes/digest.tsx`, in `createFileRoute('/digest')({ … })` after `validateSearch`: `preload: false,`
- New `client/src/lib/hooks/use-polling-invalidation.ts` (moved from the learn route and given a cap result):

  ```ts
  import { useEffect, useRef, useState } from 'react';
  import { useRouter } from '@tanstack/react-router';

  export const POLL_INTERVAL_MS = 3000;
  /** 200 × 3 s = 10 min — longer than a long map-reduce summary. */
  export const POLL_MAX_ATTEMPTS = 200;

  /** Re-run the route loaders every 3 s while `active`, at most 200 times.
   *  `capReached` turns true when polling stops so the page can say so (M-15);
   *  it resets when `active` goes false. `refreshOnFocus` also re-runs the
   *  loaders when the tab regains focus. */
  export function usePollingInvalidation(
    active: boolean,
    opts: { refreshOnFocus?: boolean } = {},
  ): { capReached: boolean } {
    const router = useRouter();
    const attemptsRef = useRef(0);
    const [capReached, setCapReached] = useState(false);
    const refreshOnFocus = opts.refreshOnFocus ?? false;

    useEffect(() => {
      if (!active) {
        attemptsRef.current = 0;
        setCapReached(false);
        return;
      }
      const id = window.setInterval(() => {
        attemptsRef.current += 1;
        if (attemptsRef.current > POLL_MAX_ATTEMPTS) {
          window.clearInterval(id);
          setCapReached(true);
          return;
        }
        void router.invalidate();
      }, POLL_INTERVAL_MS);
      if (!refreshOnFocus) return () => window.clearInterval(id);

      const onVisibility = () => {
        if (document.visibilityState === 'visible') void router.invalidate();
      };
      const onFocus = () => {
        void router.invalidate();
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', onFocus);
      return () => {
        window.clearInterval(id);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', onFocus);
      };
    }, [active, refreshOnFocus, router]);

    return { capReached };
  }
  ```
- New `client/src/lib/hooks/use-async-action.ts`:

  ```ts
  import { useCallback, useRef, useState } from 'react';

  /** Runs one async action at a time and always clears the busy flag, even
   *  when the action throws — the bug that left "Retrying…" stuck on /learn
   *  (M-15). A thrown message is kept in `error` for the button to show. */
  export function useAsyncAction(): {
    running: boolean;
    error: string | null;
    run: (action: () => Promise<void>) => Promise<void>;
  } {
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const busy = useRef(false);
    const run = useCallback(async (action: () => Promise<void>) => {
      if (busy.current) return;
      busy.current = true;
      setRunning(true);
      setError(null);
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.');
      } finally {
        busy.current = false;
        setRunning(false);
      }
    }, []);
    return { running, error, run };
  }
  ```
- `client/src/routes/learn.$videoId.tsx`:
  - React import becomes `import { useEffect, useState } from 'react';`; add `import { usePollingInvalidation } from '#/lib/hooks/use-polling-invalidation';` and `import { useAsyncAction } from '#/lib/hooks/use-async-action';`.
  - Delete the local `usePollingInvalidation` and its comment (lines 126–171).
  - `LearnPage`: `const { capReached } = usePollingInvalidation(data.status === 'pending', { refreshOnFocus: true });` replaces the old call; the pending branch renders `<PendingState videoId={videoId} progress={data.progress} pollStopped={capReached} />`.
  - `PendingState` (line 581): props gain `pollStopped: boolean` (in the `Readonly<{ … }>` type too). Replace `const [retrying, setRetrying] = useState(false);` and `handleForceRetry` with:

    ```tsx
    const retry = useAsyncAction();
    const handleForceRetry = () =>
      retry.run(async () => {
        await clearSummaryFailure({ data: { videoId } });
        await triggerSummaryGeneration({ data: { videoId, mode: retryMode } });
        await router.invalidate();
      });
    ```

    `retrying` → `retry.running` in the three places it is read (the select's `disabled`, the button's `disabled`, the button label). Insert before `<div className="mt-6 border-t border-[var(--line)] pt-4">`:

    ```tsx
    {pollStopped && (
      <p
        role="status"
        className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
      >
        Still generating after 10 minutes, so this page has stopped checking. Use
        Force retry below if the job is stuck, or reload the page to check again.
      </p>
    )}
    ```

    and after the `<GenerationModeSelect … />` element inside that div:

    ```tsx
    {retry.error && <p role="alert" className="mt-2 text-xs text-destructive">{retry.error}</p>}
    ```
  - `FailedState` (line 754): same pattern — `const retry = useAsyncAction();`, `const handleRetry = () => retry.run(async () => { /* keep the existing comment */ await regenerateSummary({ data: { videoId: video.youtubeVideoId } }); await router.invalidate(); });`, `retrying` → `retry.running`, and below the buttons' `div`: `{retry.error && <p role="alert" className="mt-3 text-xs text-destructive">{retry.error}</p>}`.
- `client/src/routes/feed.tsx`:
  - Import `usePollingInvalidation`; drop `useRouter` from the router import (line 2) and delete `const router = useRouter();` (line 134) — the polling effect was its only user.
  - Replace the polling `useEffect` and its comment (lines 195–207) with:

    ```tsx
    // Re-run the loader while any card is `pending`, capped like /learn
    // (M-15). Keyword mode only: semantic results are always generated.
    const anyPending =
      loaderData.kind === 'keyword' && videos.some((v) => v.summaryStatus === 'pending');
    const { capReached: pollStopped } = usePollingInvalidation(anyPending);
    ```
  - After the `degradedFrom` banner block (ends ≈ line 297) add:

    ```tsx
    {pollStopped && (
      <p
        role="status"
        className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
      >
        Some summaries are still generating. This page stopped refreshing itself
        after 10 minutes — reload it to check again.
      </p>
    )}
    ```

**What users see (core loop):**

| Page | Loading | No data | Error |
|---|---|---|---|
| `/new-post` | No loader, so nothing to wait for. While a share runs: fields disabled, button "Sharing…". | The empty form; "Share video" disabled until the URL is a YouTube URL. | Inline red `role="alert"` box: the server's message (a tag that can't be stored: `Could not create tag "<name>": …`, M2), or "Couldn't share the video: …" when the call throws; button re-enabled. |
| `/learn/$videoId` | `RoutePending` ("Loading…") on a client navigation slower than the router's default 1 s; never on hover (`preload: false`). While generating: the step list, polling every 3 s; after 10 min the amber "stopped checking" note. | "This video isn't in the knowledge base yet." (`UnsharedState`). | Strapi down/5xx: `BackendErrorPanel` ("Can't reach Strapi." + Retry). Loader throws (e.g. malformed id): `RouteError` with Retry / Back to feed. Generation failed: `FailedState` with Retry; a thrown retry shows its message under the button. |
| `/feed` | `RoutePending` on slow client navigations. Pending cards poll; after 10 min the amber "stopped refreshing" note. | `EmptyFeed` (unchanged). | `BackendErrorPanel`; semantic failure: the existing "keyword results" banner. |

#### 6.7 M-13 — backfills that finish, counters that report errors

- New `client/src/lib/services/backfill.ts`:

  ```ts
  // Settings backfills (M-13). Each one writes the field it filters on, so a
  // row it fixes drops out of the eligible set; paging page=2,3,… over a set
  // that shrinks underneath skipped rows. This re-reads from the front
  // instead, starting after the rows this run could not fix: they stay
  // eligible and, with a stable `id:asc` sort, sit before every row not yet
  // seen.
  import type { StrapiResult } from './strapi-client';
  import { friendlyBackendError } from './backend-errors';

  export type BackfillOutcome = 'updated' | 'skipped' | { failed: string };

  export type BackfillRunResult = {
    /** 'error' = the run stopped early; `error` says why. Counts cover what ran. */
    status: 'ok' | 'error';
    updated: number;
    /** Rows this backfill cannot fix (e.g. no cached transcript). */
    skipped: number;
    /** Rows whose write failed. */
    failed: number;
    /** Eligible rows when the run started. */
    total: number;
    /** The first five write failures, as `<documentId>: <message>`. */
    errors: string[];
    error?: string;
  };

  /** Upper bound on read passes: 200 × 100 rows covers 20,000 videos. */
  export const BACKFILL_MAX_PASSES = 200;

  export async function runBackfill<Row extends { documentId: string }>(opts: {
    pageSize: number;
    readPage: (start: number, limit: number) => Promise<StrapiResult<Row[]>>;
    process: (row: Row) => Promise<BackfillOutcome>;
    maxPasses?: number;
  }): Promise<BackfillRunResult> {
    const maxPasses = opts.maxPasses ?? BACKFILL_MAX_PASSES;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let total: number | null = null;
    const errors: string[] = [];
    const finish = (status: 'ok' | 'error', error?: string): BackfillRunResult => ({
      status,
      updated,
      skipped,
      failed,
      total: total ?? 0,
      errors,
      ...(error ? { error } : {}),
    });

    for (let pass = 0; pass < maxPasses; pass += 1) {
      const page = await opts.readPage(skipped + failed, opts.pageSize);
      if (!page.ok) return finish('error', friendlyBackendError(page.status, page.error));
      const rows = page.data ?? [];
      if (total === null) total = page.meta?.pagination?.total ?? rows.length;
      if (rows.length === 0) return finish('ok');
      for (const row of rows) {
        const outcome = await opts.process(row);
        if (outcome === 'updated') updated += 1;
        else if (outcome === 'skipped') skipped += 1;
        else {
          failed += 1;
          if (errors.length < 5) errors.push(`${row.documentId}: ${outcome.failed}`);
        }
      }
    }
    return finish('error', `Stopped after ${maxPasses} passes — run it again to continue.`);
  }
  ```
- `client/src/lib/services/strapi-client.ts` — offset pagination for `readPage`. `StrapiQuery.pagination` gains `/** Offset form; Strapi rejects mixing it with page/pageSize. */ start?: number; limit?: number;`, and `buildQueryParams`' pagination block becomes:

  ```ts
  if (query.pagination) {
    const { page, pageSize, start, limit, withCount } = query.pagination;
    if (page !== undefined) params.set('pagination[page]', String(page));
    if (pageSize !== undefined) params.set('pagination[pageSize]', String(pageSize));
    if (start !== undefined) params.set('pagination[start]', String(start));
    if (limit !== undefined) params.set('pagination[limit]', String(limit));
    if (withCount !== undefined) params.set('pagination[withCount]', String(withCount));
  }
  ```
- `client/src/data/server-functions/videos.ts` — add imports `import { runBackfill, type BackfillRunResult } from '#/lib/services/backfill';` and `import { friendlyBackendError } from '#/lib/services/backend-errors';`. Add once, above `countMissingValueScores`:

  ```ts
  /** A missing-row count, or why it couldn't be read. `missing` is 0 when
   *  `error` is set and must not be shown as "all done" (M-13). */
  export type MissingCount = { missing: number; error?: string };
  ```

  - The three result types become aliases: `export type BackfillValueScoresResult = BackfillRunResult;` (replaces lines 1422–1428), `export type BackfillSignalScoresResult = BackfillRunResult;` (replaces 1623–1628), `export type BackfillFinalScoresResult = BackfillRunResult;` (replaces 1768–1772).
  - Each counter — `countMissingValueScores` (1430), `countMissingSignalScores` (1607), `countMissingFinalScores` (1774) — returns `Promise<MissingCount>`, and its `if (!result.ok) return { missing: 0 };` becomes `if (!result.ok) return { missing: 0, error: friendlyBackendError(result.status, result.error) };`.
  - Replace `backfillValueScores` (1447–1485) with:

    ```ts
    export const backfillValueScores = createServerFn({ method: 'POST' })
      .handler(async (): Promise<BackfillRunResult> =>
        runBackfill<StrapiVideo>({
          pageSize: 100,
          readPage: (start, limit) =>
            strapiFetch<StrapiVideo[]>('GET', '/api/yt-kb/videos', {
              query: {
                filters: { watchVerdict: { $notNull: true }, valueScore: { $null: true } },
                // signalScore too: finalScore blends it (it was missing here, so
                // the backfilled finalScore ignored the signal score).
                fields: ['watchVerdict', 'signalScore'],
                sort: 'id:asc',
                pagination: { start, limit, withCount: true },
              },
            }),
          process: async (row) => {
            if (!row.watchVerdict) return 'skipped';
            const score = backfillScoreFromVerdict(row.watchVerdict);
            const finalScore = computeFinalScore(score, row.signalScore) ?? score;
            // 'derived' so UI surfaces can treat it as a placeholder.
            const write = await updateVideoValueScoreService({
              documentId: row.documentId,
              valueScore: score,
              valueScoreSource: 'derived',
              finalScore,
            });
            return write.success ? 'updated' : { failed: write.error };
          },
        }),
      );
    ```
  - Replace `backfillSignalScores` (1693–1753) with:

    ```ts
    export const backfillSignalScores = createServerFn({ method: 'POST' })
      .handler(async (): Promise<BackfillRunResult> =>
        runBackfill<StrapiVideoWithTranscript>({
          pageSize: 50,
          readPage: (start, limit) =>
            strapiFetch<StrapiVideoWithTranscript[]>('GET', '/api/yt-kb/videos', {
              query: {
                filters: { summaryStatus: { $eq: 'generated' }, signalScore: { $null: true } },
                fields: ['valueScore'],
                // Only the two transcript fields the signals need — not the
                // plugin's searchIndex (M4).
                populate: { transcript: { fields: ['rawText', 'durationSec'] } },
                sort: 'id:asc',
                pagination: { start, limit, withCount: true },
              },
            }),
          process: async (row) => {
            const rawText = row.transcript?.rawText;
            if (!rawText) return 'skipped';
            const durationSec =
              (row.transcript as { durationSec?: number | null } | null | undefined)
                ?.durationSec ?? null;
            const signalInput = signalInputForTranscript(rawText);
            const scores = computeSignalScores({
              rawText,
              cleanedText: signalInput.cleanedText,
              wordCount: signalInput.wordCount,
              durationSec,
            });
            const composite = aggregateSignalScore(scores);
            const finalScore = computeFinalScore(row.valueScore, composite) ?? composite;
            const write = await updateVideoSignalScoresService({
              documentId: row.documentId,
              signalScores: scores,
              signalScore: composite,
              finalScore,
            });
            return write.success ? 'updated' : { failed: write.error };
          },
        }),
      );
    ```
  - Replace `backfillFinalScores` (1794–1831) with:

    ```ts
    export const backfillFinalScores = createServerFn({ method: 'POST' })
      .handler(async (): Promise<BackfillRunResult> =>
        runBackfill<StrapiVideo>({
          pageSize: 100,
          readPage: (start, limit) =>
            strapiFetch<StrapiVideo[]>('GET', '/api/yt-kb/videos', {
              query: {
                filters: {
                  $or: [{ valueScore: { $notNull: true } }, { signalScore: { $notNull: true } }],
                  finalScore: { $null: true },
                },
                fields: ['valueScore', 'signalScore'],
                sort: 'id:asc',
                pagination: { start, limit, withCount: true },
              },
            }),
          process: async (row) => {
            const finalScore = computeFinalScore(row.valueScore, row.signalScore);
            if (finalScore === null) return 'skipped';
            const write = await updateVideoFinalScoreService({ documentId: row.documentId, finalScore });
            return write.success ? 'updated' : { failed: write.error };
          },
        }),
      );
    ```

    Keep each function's section comment, but drop the sentences about the 50-page cap.
- `client/src/components/ContentSignalsPanel.tsx` (the only UI caller; `backfillValueScores`/`countMissingValueScores` have no UI caller and are kept for parity):
  - Add `const [countError, setCountError] = useState<string | null>(null);`. Replace `refresh` (lines 61–69) with:

    ```tsx
    const refresh = async () => {
      setCountError(null);
      const [s, f] = await Promise.all([countMissingSignalScores(), countMissingFinalScores()]);
      const error = s.error ?? f.error ?? null;
      if (error) {
        // M-13: an unreadable library used to read as "All videos have current scores."
        setMissing(null);
        setCountError(error);
        return;
      }
      setMissing(s.missing + f.missing);
    };
    ```
  - Replace the `try` body of `handleRefresh` (lines 80–95) with:

    ```tsx
    const sig = await backfillSignalScores();
    const fin = await backfillFinalScores();
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
    const parts: string[] = [];
    if (sig.updated > 0) parts.push(`${sig.updated} ${plural(sig.updated, 'signal score', 'signal scores')}`);
    if (fin.updated > 0) parts.push(`${fin.updated} ${plural(fin.updated, 'final score', 'final scores')}`);
    const notes: string[] = [];
    if (sig.skipped > 0) {
      notes.push(
        `${sig.skipped} ${plural(sig.skipped, 'video', 'videos')} skipped — no cached transcript; run a full Regenerate on ${plural(sig.skipped, 'it', 'them')}.`,
      );
    }
    const failed = sig.failed + fin.failed;
    if (failed > 0) {
      notes.push(`${failed} ${plural(failed, 'write', 'writes')} failed (first: ${[...sig.errors, ...fin.errors][0]}).`);
    }
    if (sig.status === 'error') notes.push(`Signal scores stopped early: ${sig.error}`);
    if (fin.status === 'error') notes.push(`Final scores stopped early: ${fin.error}`);
    const head =
      parts.length > 0
        ? `Updated ${parts.join(' + ')}.`
        : notes.length > 0
          ? 'Nothing was updated.'
          : 'Nothing to update — every video already has scores.';
    setRefreshMessage([head, ...notes].join(' '));
    await refresh();
    await router.invalidate();
    ```
  - The "Checking library…" paragraph's condition becomes `missing === null && !countError`, and add after it:

    ```tsx
    {countError && (
      <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
        <span>Couldn&apos;t check the library: {countError}</span>
        <button type="button" onClick={() => void refresh()} className="underline underline-offset-2">
          Retry
        </button>
      </div>
    )}
    ```

    The Refresh button stays disabled while `missing === null` (which includes the error case).
- `client/src/data/server-functions/videos.ts` `listRegenerableVideos` (lines 1553–1586, the list the AI re-rate walks) — a failed page used to `break` and return the rows read so far as if they were the whole library (M-13). Replace `RegenerableVideo`'s neighbourhood and the function with:

  ```ts
  export type RegenerableVideo = {
    videoId: string;
    videoTitle: string | null;
  };

  /** Every generated video, or why the list could not be read. Never a
   *  partial list (M-13). */
  export type RegenerableVideosResult =
    | { status: 'ok'; videos: RegenerableVideo[] }
    | { status: 'error'; error: string };

  export const listRegenerableVideos = createServerFn({ method: 'GET' })
    .handler(async (): Promise<RegenerableVideosResult> => {
      const out: RegenerableVideo[] = [];
      const PAGE_SIZE = 100;
      for (let page = 1; page <= 50; page += 1) {
        const result = await strapiFetch<StrapiVideo[]>('GET', '/api/yt-kb/videos', {
          query: {
            filters: { summaryStatus: { $eq: 'generated' } },
            fields: ['youtubeVideoId', 'videoTitle'],
            sort: 'createdAt:desc',
            pagination: { page, pageSize: PAGE_SIZE, withCount: true },
          },
        });
        if (!result.ok) {
          return { status: 'error', error: friendlyBackendError(result.status, result.error) };
        }
        const rows = result.data ?? [];
        if (rows.length === 0) break;
        for (const row of rows) {
          if (row.youtubeVideoId) {
            out.push({ videoId: row.youtubeVideoId, videoTitle: row.videoTitle ?? null });
          }
        }
        const pageCount = result.meta?.pagination?.pageCount ?? 1;
        if (page >= pageCount) break;
      }
      return { status: 'ok', videos: out };
    });
  ```

  (`friendlyBackendError` is the import this section adds to the same file above, for the counters.)
- `client/src/components/ContentSignalsPanel.tsx` — its only caller:
  - the `aiState` union (lines 42–47) gains `| { kind: 'error'; message: string }`;
  - in `handleAiRegenerate`, replace `const videos = await listRegenerableVideos();` with
    ```tsx
    const listed = await listRegenerableVideos();
    if (listed.status === 'error') {
      // M-13: a failed read used to start a re-rate over part of the library.
      setAiState({ kind: 'error', message: listed.error });
      return;
    }
    const videos = listed.videos;
    ```
  - after the `aiState.kind === 'cancelled'` paragraph add
    ```tsx
    {aiState.kind === 'error' && (
      <p role="alert" className="mt-1 text-xs text-destructive">
        Couldn&apos;t list the videos to re-rate: {aiState.message}
      </p>
    )}
    ```
    The re-rate button stays enabled (`aiRunning` is false), so clicking it again retries.
- `client/src/components/ContentSignalsPanel.cancel.test.tsx` — its three `listRegenerableVideosMock.mockResolvedValue(videos(n))` calls (lines 47, 77, 104) become `listRegenerableVideosMock.mockResolvedValue({ status: 'ok', videos: videos(n) })`; nothing else changes.
- `client/src/components/EmbeddingCoveragePanel.tsx` — no change: its three coverage reads already return and render `error` (`CoverageUnavailable`), and its reindex results already carry `status: 'error'`.

#### 6.8 M-21 — stale comments

| File:lines @721f210 | Replace with |
|---|---|
| `server/.env.example:3-5` (HOST comment) | `# Loopback for local development. The yt-kb plugin grants the Public role` / `# nothing, but the admin panel and /mcp listen here too, so widen it only` / `# deliberately (a hosted container needs 0.0.0.0).` |
| `server/config/middlewares.ts:7-17` (the CORS comment up to "returned 204.") | `// Explicit origin list. A bare 'strapi::cors' inherits the installed` / `// defaults — origin '*' WITH credentials: true — and @strapi/core's` / `// matchOrigin() echoes the caller's own Origin back whenever the list` / `// contains '*', so any page the owner visited could make credentialed` / `// cross-origin requests to this Strapi (admin session included).` — lines 18–23 ("Nothing in this product calls Strapi from a browser …") stay. |
| `server/config/server.ts:10-12` | `// For local use, set HOST=127.0.0.1 in server/.env (.env.example does):` / `// the admin panel and /mcp should not listen on the LAN.` |
| `client/src/lib/services/notes.ts:3` | `api::note.note` → `plugin::yt-kb.note` |
| `client/src/lib/services/digests.ts:1` | (done in 6.5) |
| `client/src/lib/services/strapi-client.ts:7-8` | (done in 6.1) |
| `client/.env.example`, `client/src/lib/env.ts:112-124` | (done in 6.2) |

(The `/` marks a line break in the new comment.) The contract keeps the plugin's `mcp` config key, so M-21's "`mcp: false` setting" is not removed here. The `TRANSCRIPT_PROXY_URL` wording in `requestTranscriptFetchService`'s doc comment is M3's (the contract removes that variable everywhere).

#### 6.9 M-21 — dead files and dependencies

- `git rm server/scripts/seed.mjs server/scripts/verify-mcp-tools.cjs`; delete the `"verify:mcp"` line from `server/package.json` `scripts`.
- `git rm client/package-lock.json client/pnpm-lock.yaml`; delete the `"pnpm": { "onlyBuiltDependencies": [...] }` block from `client/package.json` (it only configures pnpm; yarn ignores it). `yarn --cwd client remove @strapi/client ky` (updates `client/package.json` and `client/yarn.lock`; neither package is imported anywhere in `client/`).
- `yarn --cwd server remove youtubei.js` — only after pre-check 2 passed: the plugin declares `youtubei.js` 17.2.0 itself and M1 installs the plugin's own `node_modules` in `setup` and `install:all`, so the plugin's `dist` resolves it from `server/src/plugins/yt-kb/node_modules`. Nothing else under `server/` imports it (`server/tsconfig.json` excludes `src/plugins/**`).

#### 6.10 Tests (client vitest; DOM tests start with `// @vitest-environment jsdom` and call `cleanup()` in `afterEach`)

- `client/src/lib/services/strapi-client.test.ts` — add:
  - `seg`: `seg('../../users/1') === '..%2F..%2Fusers%2F1'`; `seg('a/b?c#d') === 'a%2Fb%3Fc%23d'`; `seg('k3x9q2m8v7b6n5c4z1a0s2d3')` unchanged; `seg('..')`, `seg('.')`, `seg('')` each throw; and `new URL('http://h/api/yt-kb/notes/' + seg('../../users/1')).pathname === '/api/yt-kb/notes/..%2F..%2Fusers%2F1'`.
  - Timeouts: with `vi.spyOn(AbortSignal, 'timeout')`, a plain `strapiFetch('GET', '/api/videos')` calls it with `30000` and passes a `signal` in the fetch init; `{ timeoutMs: 5 }` calls it with `5`; a fetch rejected with `new DOMException('The operation was aborted due to timeout', 'TimeoutError')` returns `{ ok: false, status: 0, error: 'Strapi did not respond within 30 s.' }`; a 200 whose `text()` rejects returns `ok: false, status: 0` (build the Response with a `ReadableStream` that errors).
  - `buildQueryParams({ pagination: { start: 50, limit: 25, withCount: true } })` → `pagination[start]=50`, `pagination[limit]=25`, `pagination[withCount]=true`.
  - `isUniqueViolation` (6.5's version): true for `{ ok: false, status: 400, error: 'This attribute must be unique' }`, `{ ok: false, status: 400, error: 'A video for this id already exists. documentId=x' }` and `{ ok: false, status: 400, error: 'Duplicate', details: { code: 'YT_KB_UNIQUE' } }`; false for `{ ok: false, status: 500, error: 'Internal Server Error' }`, `{ ok: false, status: 400, error: 'Title is required' }`, `{ ok: false, status: 403, error: 'Forbidden' }`, `{ ok: false, status: 0, error: 'ECONNREFUSED' }` and `{ ok: true, data: null }`.
  - Negative (B-1): `deleteNoteService('../../users/1')` (import from `./notes`) sends exactly one request, and `new URL(fetchMock.mock.calls[0][0]).pathname === '/api/yt-kb/notes/..%2F..%2Fusers%2F1'` — no request to `/api/users`.
- New `client/src/lib/services/strapi-segments.guard.test.ts` (same file walker as `strapi-paths.guard.test.ts`): (a) no non-test file under `client/src` matches `` /\/api\/yt-kb\/[a-z-]+\/\$\{(?!seg\()/ ``; (b) only `lib/env.ts` and `lib/services/strapi-client.ts` mention `STRAPI_API_TOKEN` (no raw Strapi `fetch` left, M-21); (c) in `client/src/data/server-functions/*.ts`, every match of `` /\b(\w*[dD]ocumentIds?)\s*:\s*(z\.[^\n]*)/ `` has a value starting with `z.array(DOCUMENT_ID)` (a bare `documentId: z.string()` fails it).
- New `client/src/lib/validations/post.test.ts`: `DOCUMENT_ID` accepts `k3x9q2m8v7b6n5c4z1a0s2d3`, rejects `../../users/1`, `K3X9Q2M8V7B6N5C4Z1A0S2D3`, a 23-char and a 25-char id, `abc?def`; `VIDEO_REF` accepts `dQw4w9WgXcQ` and the documentId, rejects `../x`, `a/b`, `a.b`, `''`; `normalizeTagName('  C++   Tips ') === 'c++ tips'`; `parseTagInput('AI,  ai , Deep   Learning')` → `['ai', 'deep learning']`.
- New `client/src/data/server-functions/document-id.schemas.test.ts` (no mocks needed: the modules only define server fns at import; silence `console.warn` for the env warnings): for each exported schema in the 6.1 table, `safeParse` with the documentId field set to `'../../users/1'` fails with an issue on that field, and with `k3x9q2m8v7b6n5c4z1a0s2d3` passes (fill the schema's other required fields with valid values); `SummarizeToNoteSchema`, `LoadDigestSchema`, `GenerateDigestSchema` reject `['../../users/1', 'dQw4w9WgXcQ']` and accept `['dQw4w9WgXcQ', 'k3x9q2m8v7b6n5c4z1a0s2d3']`.
- `client/src/lib/services/digest-videos.test.ts` — the "falls back to documentId" test uses `'k3x9q2m8v7b6n5c4z1a0s2d3'` instead of `'xyz'`; add: `resolveDigestVideos(['../../users/1'])` returns `{ status: 'missing', missing: ['../../users/1'] }` and `byDocumentId` is never called.
- New `client/src/lib/services/videos.fields.test.ts` (fetch stubbed as in `videos.corpus-fields.test.ts`):
  - `fetchFeedService({})` URL has `fields[...]` for each `FEED_FIELDS` entry and none of `summaryEmbedding`, `passageEmbeddings`, `transcriptSegments`, `readableArticle`.
  - `fetchVideoByVideoIdWithStatusService('dQw4w9WgXcQ')` URL has `fields[...]=videoTitle` and `fields[...]=createdAt`, `populate[transcript][fields][...]=rawSegments`, and none of `summaryEmbedding`, `passageEmbeddings`, `transcriptSegments`, `searchIndex`.
  - `fetchVideoByVideoIdService('dQw4w9WgXcQ')` URL has no top-level `fields[` (internal callers still get the full row).
  - `stripVideoForClient` nulls `transcriptSegments`, `summaryEmbedding`, `passageEmbeddings` and keeps `videoTitle`.
  - `listAllVideosForEmbeddingService(['summaryEmbedding'])` returns rows whose `summaryEmbedding` is still `[1, 2]` when the stubbed page has it.
  - `findTagByNameService(' C++ ')` looks up `filters[name][$eq]=c++` (normalised with `normalizeTagName`).
  - `createVideoService` race where the 400 carries only the plugin's code: video GET → `[]`, video POST → 400 `{ error: { message: 'Duplicate', details: { code: 'YT_KB_UNIQUE' } } }`, video GET → `[row]` → `{ success: false, kind: 'exists' }` (M2's `unique-recovery.test.ts` covers the message-based cases).
  - `requestTranscriptFetchService('dQw4w9WgXcQ', { force: false })` calls `AbortSignal.timeout` with `120000`.
- New `client/src/lib/services/digests.test.ts`: `deleteDigestService('../../users/1')` requests `/api/yt-kb/digests/..%2F..%2Fusers%2F1`; `upsertDigestService` (M2) whose create gets a 400 `{ message: 'Duplicate', details: { code: 'YT_KB_UNIQUE' } }` re-reads by `videoSetKey` and updates the row it finds (`{ success: true, data: { documentId, created: false } }`, last request a `PUT`).
- New `client/src/lib/services/backfill.test.ts` (in-memory eligible set sorted by id; `readPage(start, limit)` slices it; `process` removes a row from the set on `'updated'`): drains 250 rows with `pageSize: 100` (`updated: 250, status: 'ok', total: 250`); with every third row `'skipped'` (left in the set) it still updates every other row and stops (`skipped` = the third rows, `status: 'ok'`); a read that fails with status 0 on the second pass returns `status: 'error'`, `error: 'Backend unreachable. Check that Strapi is running on port 1340.'` and the first pass's `updated`; failed writes count in `failed` and `errors` holds at most 5; a `process` that reports `'updated'` without removing the row stops after `maxPasses: 3` with `error: 'Stopped after 3 passes — run it again to continue.'`.
- New `client/src/lib/services/network-timeouts.test.ts`: `fetchYouTubeMeta('dQw4w9WgXcQ')` (from `./learning`) calls `AbortSignal.timeout` with `5000` and returns `{}` when fetch rejects with a `TimeoutError`; `webSearch('q')` (from `./web-search`) calls it with `8000` and returns `[]` when every fetch rejects with a `TimeoutError`.
- New `client/src/lib/hooks/use-polling-invalidation.test.tsx` (jsdom, `vi.useFakeTimers()`, `useRouter` mocked to `{ invalidate }`, `renderHook` from `@testing-library/react`): active → after 200 × 3000 ms `invalidate` has 200 calls and `capReached` is false; one more tick → `capReached` true; further ticks add no calls; rerender with `false` → `capReached` false. With `refreshOnFocus: true`, `window.dispatchEvent(new Event('focus'))` calls `invalidate`; without it, it does not.
- New `client/src/lib/hooks/use-async-action.test.tsx` (jsdom): an action that throws `new Error('boom')` leaves `running` false and `error` `'boom'`; a second `run` while the first is pending does not start the second action.
- New `client/src/components/RouteStates.test.tsx` (jsdom; mock `@tanstack/react-router` to `{ useRouter: () => ({ invalidate }), Link: ({ children }) => <a>{children}</a> }`): `RouteError` with `new Error('boom')` renders `role="alert"`, the text `boom`, and Retry calls `invalidate`; `RoutePending` renders "Loading…" with `aria-busy="true"`.
- New `client/src/components/NewPostForm.test.tsx` (jsdom; mock `#/data/server-functions/videos` to `{ shareVideo, suggestTagsForUrl: async () => ({ status: 'ok', suggestions: [] }) }`, `@tanstack/react-router` to `{ useRouter: () => ({ invalidate: async () => {}, navigate }) }`, `#/components/GenerationModeSelect` to `{ GenerationModeSelect: () => null }`; type `https://www.youtube.com/watch?v=zzzzzzzzzz0` into the "YouTube URL" field, wait for "Share video" to enable, click): a rejected `shareVideo` (`new Error('fetch failed')`) shows a `role="alert"` containing `Couldn't share the video: fetch failed`, the button is enabled again, `navigate` not called; `{ status: 'error', error: 'Could not create tag "c#": Internal Server Error' }` shows a `role="alert"` containing that text and does not navigate; `{ status: 'created', video: { youtubeVideoId: 'zzzzzzzzzz0' } }` navigates to `{ to: '/learn/$videoId', params: { videoId: 'zzzzzzzzzz0' } }`.
- New `client/src/components/ContentSignalsPanel.errors.test.tsx` (jsdom; mocks as in `ContentSignalsPanel.cancel.test.tsx`): a counter returning `{ missing: 0, error: 'Backend unreachable. Check that Strapi is running on port 1340.' }` renders a `role="alert"` with that text and no "All videos have current scores."; with counts `{ missing: 3 }`/`{ missing: 3 }`, signal `{ status: 'ok', updated: 0, skipped: 3, failed: 0, total: 3, errors: [] }` and final `{ status: 'error', updated: 1, skipped: 0, failed: 0, total: 3, errors: [], error: 'Backend unreachable. Check that Strapi is running on port 1340.' }`, clicking "Refresh scores" shows one message containing `Updated 1 final score.`, `3 videos skipped — no cached transcript` and `Final scores stopped early: Backend unreachable`.
- `client/src/components/ContentSignalsPanel.errors.test.tsx` (above) — one more case (M-13, `listRegenerableVideos`): with `listRegenerableVideos` resolving `{ status: 'error', error: 'Backend unreachable. Check that Strapi is running on port 1340.' }`, opening the advanced section and clicking the re-rate button renders a `role="alert"` containing `Couldn't list the videos to re-rate: Backend unreachable` and `regenerateVideoVerdict` is never called.
- New `client/src/lib/services/chat-index.test.ts` (B-6; node environment; `vi.mock('@tanstack/ai', () => ({ chat: vi.fn(async () => { throw new Error('ollama down'); }) }))` and `vi.mock('@tanstack/ai-ollama', () => ({ createOllamaChat: vi.fn(() => ({})) }))` as in `chat-retrieval.test.ts`, so query rewriting falls back to the plain query; `fetch` stubbed as in `videos.fields.test.ts`). Fixture: the eight 260-word topics of M4's `eight-topics.ts`, inlined (the client cannot import plugin files), indexed with `buildTranscriptSearchIndex(RAW_SEGMENTS, 480)` from `./transcript`; the stubbed Strapi answers the video list with one row `{ documentId: 'v1', youtubeVideoId: 'fxchat00001', summaryStatus: 'generated', videoTitle: 'Chat fixture', transcriptSegments: <that index> }`:
  - `fetchVideoByVideoIdForServerWithStatusService('fxchat00001')` returns `{ error: null }` and a `video` whose `transcriptSegments` is a stored index (`isStoredIndex` true); its request URL has no top-level `fields[` and has `filters[youtubeVideoId][$eq]=fxchat00001`;
  - `prepareChatPrompt(video, [{ role: 'user', content: 'espresso crema grinder' }])` with that video returns `retrievedCount >= 1` and a `system` prompt containing `espresso`;
  - negative: the same row through `fetchVideoByVideoIdWithStatusService` comes back with `transcriptSegments: null`, and `prepareChatPrompt` on it returns `retrievedCount: 0` — the behaviour B-6 fixes;
  - `fetchVideoByVideoIdForServerWithStatusService` on a 500 returns `{ video: null, error: <friendlyBackendError text> }`.
- New `client/src/lib/services/route-options.guard.test.ts` (reads source; route files cannot be imported outside the Start runtime): `routes/learn.$videoId.tsx` and `routes/digest.tsx` each contain `preload: false,` inside their `createFileRoute(` options; `router.tsx` contains `defaultErrorComponent: RouteError` and `defaultPendingComponent: RoutePending`; `routes/api.chat.tsx` and `routes/api.digest-chat.tsx` each call `fetchVideoByVideoIdForServerWithStatusService(` and neither contains `fetchVideoByVideoIdWithStatusService(` (B-6).
- New Playwright spec `client/e2e/core-loop-states.spec.ts` (runs in V-setup; the first three tests are safe against any stack):

  ```ts
  import { test, expect } from '@playwright/test';

  // Core-loop states and the B-1 path check (M6). The env-gated tests need the
  // recording stub, the fixture library or a stopped Strapi — see the M6 spec.

  test('a malformed documentId renders the route error instead of fetching', async ({ page }) => {
    await page.goto('/video/NOT-A-DOCUMENT-ID');
    await expect(page.getByTestId('route-error')).toBeVisible();
  });

  test('a traversal documentId never reaches Strapi', async ({ page }) => {
    await page.goto('/video/..%2F..%2Fusers%2F1');
    await expect(
      page.getByTestId('route-error').or(page.getByText("That video isn't here.")).first(),
    ).toBeVisible();
  });

  test('/learn for a video not in the library shows the unshared state', async ({ page }) => {
    await page.goto('/learn/zzzzzzzzzz0');
    await expect(page.getByText("This video isn't in the knowledge base yet.")).toBeVisible();
  });

  test('/new-post shows a failed share inline', async ({ page }) => {
    test.skip(process.env.E2E_STRAPI_WRITES_FAIL !== '1', 'needs the recording stub');
    test.setTimeout(60_000);
    await page.goto('/new-post');
    await page.getByLabel('YouTube URL').fill('https://www.youtube.com/watch?v=zzzzzzzzzz0');
    await page.getByRole('button', { name: 'Share video' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Not Found' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Share video' })).toBeEnabled();
  });

  test('/settings score refresh reports the rows it skipped', async ({ page }) => {
    test.skip(process.env.E2E_FIXTURES !== '1', 'needs the M6 fixture library');
    await page.goto('/settings');
    await expect(page.getByText(/6 videos need updating/)).toBeVisible();
    await page.getByRole('button', { name: 'Refresh scores' }).click();
    await expect(page.getByText(/Updated 3 final scores\./)).toBeVisible();
    await expect(page.getByText(/3 videos skipped — no cached transcript/)).toBeVisible();
  });

  test.describe('with Strapi down', () => {
    test.skip(process.env.E2E_STRAPI_DOWN !== '1', 'stop Strapi first');
    test('/learn shows the backend error panel', async ({ page }) => {
      await page.goto('/learn/zzzzzzzzzz0');
      await expect(page.getByText("Can't reach Strapi.")).toBeVisible();
    });
    test('/settings says the counts could not be read', async ({ page }) => {
      await page.goto('/settings');
      await expect(page.getByText(/Couldn.t check the library/)).toBeVisible();
    });
  });
  ```

- **Data:** none. No schema or row changes. (V-setup only creates a throwaway scratch database.)
- **Callers updated:** `isUniqueViolation` (new body, same signature) → M2's `createVideoService`, `createTagService`, `createDigestService`, unchanged; `ShareVideoResult` (unchanged) → `NewPostForm`; `fetchVideoByVideoIdForServerWithStatusService` (new) → `api.chat.tsx` and `api.digest-chat.tsx` only; `listRegenerableVideos` (new result shape) → `ContentSignalsPanel` and `ContentSignalsPanel.cancel.test.tsx`; the counter/backfill shapes → `ContentSignalsPanel` (+ its two tests); `stripVideoForClient` → every existing caller is a client-bound path except `listAllVideosForEmbeddingService`, which no longer calls it; `detailQuery`/`internalDetailQuery` → the five functions named in 6.4; `usePollingInvalidation` → `/learn`, `/feed`; `seg` → the 20 path sites in 6.1; `DOCUMENT_ID`/`VIDEO_REF` → the schemas and resolvers in 6.1; `client/playwright.config.ts` → both e2e specs. The env var `STRAPI_API_TOKEN` keeps its name; its required value changes (owner action, below). README/CLAUDE.md wording about the token, the test count and `verify:mcp` is M8's.
- **Owner action (not the agent — the agent never opens, prints or edits a `.env`):** after this milestone, `client/.env`'s `STRAPI_API_TOKEN` must hold the `yt-kb-app` key that M5's `create-tokens.cjs --out-app` wrote, and the app must be opened at `http://127.0.0.1:3005` or `http://localhost:3005`. The agent writes the key to a mode-0600 file in its scratchpad and gives the owner the path; the owner pastes it (Deployment step 3).

#### Verify (M6)

All checks run from the repo root (a `cd` is always inside a subshell) with M1's check conventions. Never print a token: keys are read with `$(cat …)` into a header or env var, never echoed, and no step uses `set -x`. Ports used: 1341 (scratch Strapi), 1399 (recording stub), 3005 (app). Kill only processes on these ports, and only ones these checks started.

**Static gates**

- `cd client && npx tsc --noEmit` → exit 0. `cd server && npx tsc --noEmit` → exit 0.
- `yarn test` → exit 0; the count rises by the new tests (record the number for M8).
- `yarn --cwd client build` → exit 0.
- M-21: `node -e "const p=require('./client/package.json'); const bad=['@strapi/client','ky'].filter(d=>(p.dependencies||{})[d]||(p.devDependencies||{})[d]); if(p.pnpm) bad.push('pnpm block'); const s=require('./server/package.json'); if(s.scripts['verify:mcp']) bad.push('verify:mcp'); if(s.dependencies['youtubei.js']) bad.push('host youtubei.js'); console.log({bad}); process.exit(bad.length?1:0)"` → `{ bad: [] }`, exit 0. `git ls-files client/package-lock.json client/pnpm-lock.yaml server/scripts` → no output. `(cd server/src/plugins/yt-kb && node -e "const p=require.resolve('youtubei.js'); console.log(p); process.exit(p.includes('plugins/yt-kb/node_modules')?0:1)")` → exit 0.

**V-setup — scratch stack (no real data, no owner tokens)**

S1, S2 and S4 ran in 6.0. In Verify set S1's variables again without its `rm` (`M=m6; K=…; SCRATCH=…`), run S0, then S3 on the existing scratch file (skip S3's empty-database check: the 16 fixtures are there), then S5/S6 as each V-step says. If 6.0's `$SCRATCH` or scratch file is gone, the baseline is gone too: STOP and ask (it can only be measured on the M5 code).

- S0 — ports free and builds current: M1 precondition 1's command for ports 1340 1341 1399 3005 → `"busy":false` for each (if one is busy, STOP — do not kill the owner's processes). `yarn --cwd server/src/plugins/yt-kb build && yarn --cwd server build` → exit 0.
- S1 — scratch folder and database name (M6 uses `M=m6`; M7 sets `M=m7`): `M=m6; K="$PWD/server/.tmp/e8/e8.mjs"; SCRATCH="$PWD/server/.tmp/e8/$M"; mkdir -p "$SCRATCH" && chmod 700 "$SCRATCH"`, and `rm -f server/.tmp/e8-$M.db server/.tmp/e8-$M.db-*` (a file only these checks create). The fresh scratch DB is `server/.tmp/e8-$M.db`.
- S2 — tokens, with Strapi stopped (M5's `create-tokens.cjs` refuses to run while a SQLite Strapi listens): `(cd server && DATABASE_FILENAME=.tmp/e8-$M.db node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app "$SCRATCH/app.key" --out-site "$SCRATCH/site.key")` → exit 0 (loading Strapi creates the schema in the fresh file); then `node -e "const fs=require('fs'); const bad=process.argv.slice(1).filter(f=>(fs.statSync(f).mode&0o777)!==0o600); console.log({bad}); process.exit(bad.length?1:0)" "$SCRATCH/app.key" "$SCRATCH/site.key"` → `{ bad: [] }` (both key files exist with mode 0600; their contents are never printed).
- S3 — scratch Strapi: `(cd server && HOST=127.0.0.1 PORT=1341 DATABASE_FILENAME=.tmp/e8-$M.db nohup yarn develop > "$SCRATCH/strapi.log" 2>&1 &)` then `node $K wait http://127.0.0.1:1341/_health 300` → `"status": 204`. Prove it is the empty scratch database: `curl -s -H "Authorization: Bearer $(cat "$SCRATCH/app.key")" 'http://127.0.0.1:1341/api/yt-kb/videos?pagination[pageSize]=1' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s).meta.pagination.total;console.log({total:t});process.exit(t===0?0:1)})"` → `{ total: 0 }`.
- S4 — synthetic library. Write `$SCRATCH/seed-fixtures.mjs`:

  ```js
  // Synthetic library for the M6/M7 checks. No real data.
  import { readFileSync } from 'node:fs';
  const [, , base, keyFile] = process.argv;
  const H = { Authorization: `Bearer ${readFileSync(keyFile, 'utf8').trim()}`, 'Content-Type': 'application/json' };
  async function post(path, data) {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: H, body: JSON.stringify({ data }) });
    if (!res.ok) throw new Error(`${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()).data;
  }
  const vec = (seed) => Array.from({ length: 768 }, (_, i) => Number(Math.sin(seed * 1000 + i).toFixed(6)));
  const passages = (seed, n) => ({
    model: 'nomic-embed-text', version: 3, generatedAt: '2026-11-01T00:00:00.000Z',
    chunks: Array.from({ length: n }, (_, c) => ({ text: `Fixture passage ${c}`, startSec: c * 30, endSec: c * 30 + 30, embedding: vec(seed * 1000 + c) })),
  });
  const tag = await post('/api/yt-kb/tags', { name: 'fixture' });
  for (let n = 1; n <= 16; n += 1) {
    const id = `fx${String(n).padStart(9, '0')}`;
    const full = n <= 12 || n === 16; // 13–15: no embeddings, no signal/final score, no transcript
    await post('/api/yt-kb/videos', {
      youtubeVideoId: id, url: `https://www.youtube.com/watch?v=${id}`,
      videoTitle: `Fixture video ${n}`, videoAuthor: 'Fixture channel', tags: [tag.documentId],
      summaryStatus: 'generated', summaryTitle: `Fixture summary ${n}`,
      summaryDescription: 'A synthetic video for verification.', summaryOverview: 'Overview text.',
      watchVerdict: 'skim', verdictSummary: 'Synthetic verdict.', verdictReason: 'Synthetic reason.',
      valueScore: 40, valueScoreSource: 'model',
      summaryGeneratedAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
      keyTakeaways: [{ text: 'A takeaway.' }], sections: [{ heading: 'Section', body: 'Body.', timeSec: 10 }],
      actionSteps: [{ title: 'Step', body: 'Do it.' }],
      ...(full ? {
        signalScore: 50, finalScore: 46, embeddingModel: 'nomic-embed-text', embeddingVersion: 2,
        embeddingGeneratedAt: '2026-11-01T00:00:00.000Z', summaryEmbedding: vec(n),
        passageEmbeddings: passages(n, n === 16 ? 200 : 40), transcriptSegments: { fixture: 'x'.repeat(100_000) },
      } : {}),
    });
  }
  console.log('seeded 16 videos');
  ```

  `node "$SCRATCH/seed-fixtures.mjs" http://127.0.0.1:1341 "$SCRATCH/app.key"` → prints `seeded 16 videos`. (Rows 1–12 carry ~380 KB of JSON each, row 16 ~1.4 MB; the test host's `jsonLimit` is 20 MB.)
- S5 — recording stub. Write `$SCRATCH/strapi-stub.mjs`:

  ```js
  // Records every request; collection reads are empty, everything else 404.
  import http from 'node:http';
  import { appendFileSync } from 'node:fs';
  const [, , port, logFile] = process.argv;
  const LIST = /^\/api\/yt-kb\/(videos|tags|notes|digests|transcripts)(\?|$)/;
  http.createServer((req, res) => {
    const auth = req.headers.authorization === 'Bearer stub-not-a-secret';
    appendFileSync(logFile, `${req.method} ${req.url} auth=${auth}\n`);
    req.resume();
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && LIST.test(req.url)) {
      res.end(JSON.stringify({ data: [], meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ data: null, error: { status: 404, name: 'NotFoundError', message: 'Not Found' } }));
  }).listen(Number(port), '127.0.0.1');
  ```
- S6 — the app on 3005 against a given Strapi (shell variables override `client/.env`; M6's own config pins the host to `127.0.0.1`; Ollama points at a closed port so no check runs a model): `(cd client && STRAPI_URL=<base> STRAPI_API_TOKEN=<token> OLLAMA_BASE_URL=http://127.0.0.1:9/v1 nohup yarn dev > "$SCRATCH/app.log" 2>&1 &)` then `node $K wait http://127.0.0.1:3005/about 120`. Stop with `lsof -ti tcp:3005 -sTCP:LISTEN | xargs kill`.
- S7 — cleanup at the end: `for p in 1341 1399 3005; do lsof -ti tcp:$p -sTCP:LISTEN | xargs kill; done`; `rm -f server/.tmp/e8-$M.db server/.tmp/e8-$M.db-*`; `rm -rf "$SCRATCH"` (M7 repeats S0–S6 with `M=m7` if it runs later).

**V1 — B-1, M-15 against the recording stub**

1. `: > "$SCRATCH/stub.log"; nohup node "$SCRATCH/strapi-stub.mjs" 1399 "$SCRATCH/stub.log" > /dev/null 2>&1 &`; S6 with `STRAPI_URL=http://127.0.0.1:1399 STRAPI_API_TOKEN=stub-not-a-secret`.
2. Wiring proof: `curl -s -o /dev/null http://127.0.0.1:3005/learn/zzzzzzzzzz0` then `node -e "const l=require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean); const ok=l.some(x=>x.startsWith('GET /api/yt-kb/videos?')) && l.every(x=>x.endsWith('auth=true')); console.log({lines:l.length, ok}); process.exit(ok?0:1)" "$SCRATCH/stub.log"` → `ok: true` (the app reads the stub with the stub token, not `client/.env`).
3. `(cd client && E2E_BASE_URL=http://127.0.0.1:3005 E2E_STRAPI_WRITES_FAIL=1 npx playwright test e2e/core-loop-states.spec.ts --reporter=json > "$SCRATCH/e2e-v1.json"); node -e "const s=require(process.argv[1]).stats; console.log(s); process.exit(s.unexpected===0&&s.expected===4?0:1)" "$SCRATCH/e2e-v1.json"` → `expected: 4, unexpected: 0` (3 skipped). If Playwright reports a missing browser, STOP and ask the owner (installing it downloads ~150 MB). Test 4 (`/new-post shows a failed share inline`) makes the app's own oEmbed request for `zzzzzzzzzz0` to youtube.com (unchanged `shareVideo` behaviour, now with M6's 5 s timeout) before the stub fails the write; its result does not affect the test, and it is accepted on the same terms as OQ-5.
4. **Negative test (B-1):** `node -e "const l=require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean); const bad=l.filter(x=>/\/api\/users/.test(x)||/\/api\/yt-kb\/videos\/(NOT-A-DOCUMENT-ID|\.\.)/.test(x)); console.log({requests:l.length, bad}); process.exit(l.length>0&&bad.length===0?0:1)" "$SCRATCH/stub.log"` → `bad: []`: a malformed or traversal documentId reached no Strapi path. (Before M6, `/video/NOT-A-DOCUMENT-ID` fetched `/api/yt-kb/videos/NOT-A-DOCUMENT-ID` and rendered "That video isn't here.".)
5. Stop the app and the stub (`for p in 3005 1399; do lsof -ti tcp:$p -sTCP:LISTEN | xargs kill; done`).

**V2 — B-5 against the scratch Strapi**

1. S6 with `STRAPI_URL=http://127.0.0.1:1341 STRAPI_API_TOKEN="$(cat "$SCRATCH/app.key")"`.
2. Listen address: `lsof -nP -iTCP:3005 -sTCP:LISTEN -Fn | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=s.split('\n').filter(x=>x.startsWith('n')).map(x=>x.slice(1));console.log(a);process.exit(a.length>0&&a.every(x=>x==='127.0.0.1:3005')?0:1)})"` → `[ '127.0.0.1:3005' ]` only (no `*:3005`, no `[::]:3005`).
3. Positive: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3005/about` → `200`.
4. **Negative test (LAN):** find the LAN address with `LAN=$(node -e "for (const a of Object.values(require('os').networkInterfaces()).flat()) if (a.family==='IPv4'&&!a.internal){console.log(a.address);process.exit(0)} process.exit(1)")`. If that exits 1 the machine has no LAN address: record "LAN check not runnable" in E8 and rely on step 2. Otherwise `curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 "http://$LAN:3005/about"; echo "curl exit $?"` → `000` and `curl exit 7` (connection refused).
5. **Negative test (token scope):** with the `yt-kb-app` key in the header, `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(cat "$SCRATCH/app.key")" <url>`: `http://127.0.0.1:1341/api/yt-kb/videos?pagination[pageSize]=1` → `200`; `http://127.0.0.1:1341/api/users` → `403`. The import route answers 403 for two reasons (the token lacks `importer.importRecords`, and M5's `import: false` gate), so check which: `curl -s -X POST -H "Authorization: Bearer $(cat "$SCRATCH/app.key")" -H 'Content-Type: application/json' -d '{"data":[]}' http://127.0.0.1:1341/api/yt-kb/import/video | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).error;console.log(e);process.exit(e.status===403&&e.message==='Forbidden'?0:1)})"` → `status: 403, message: 'Forbidden'` (refused by the token's scope, before the gate's "Import is disabled…").

**V3 — M-13 and the core-loop states against the fixture library** (app from V2 still running)

`(cd client && E2E_BASE_URL=http://127.0.0.1:3005 E2E_FIXTURES=1 npx playwright test e2e/core-loop-states.spec.ts --reporter=json > "$SCRATCH/e2e-v3.json"); node -e "const s=require(process.argv[1]).stats; console.log(s); process.exit(s.unexpected===0&&s.expected===4?0:1)" "$SCRATCH/e2e-v3.json"` → `expected: 4, unexpected: 0`. The settings test proves the signal backfill finishes with 3 rows it cannot fix (rows 13–15 have no transcript) instead of looping, and the final backfill fixes those 3. Confirm the effect in Strapi: `curl -s -H "Authorization: Bearer $(cat "$SCRATCH/app.key")" 'http://127.0.0.1:1341/api/yt-kb/videos?filters[finalScore][$null]=true&pagination[pageSize]=1' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s).meta.pagination.total;console.log({nullFinal:t});process.exit(t===0?0:1)})"` → `{ nullFinal: 0 }`.

**V4 — M-8 payload through the running app** (app from V2 still running)

`curl -s -o "$SCRATCH/feed-after.html" -w '%{size_download}\n' http://127.0.0.1:3005/feed > "$SCRATCH/feed-after.bytes"` then `node -e "const fs=require('fs'); const b=+fs.readFileSync(process.argv[1],'utf8'), a=+fs.readFileSync(process.argv[2],'utf8'), html=fs.readFileSync(process.argv[3],'utf8'); const ok=a<300_000 && a<b/4 && html.includes('Fixture video 16'); console.log({before:b, after:a, ok}); process.exit(ok?0:1)" "$SCRATCH/feed-before.bytes" "$SCRATCH/feed-after.bytes" "$SCRATCH/feed-after.html"` → `ok: true` (before > 2 MB from 6.0, after < 300 KB, and the newest fixture card is on the page).

**V4b — B-6: chat retrieval gets passages through the app** (app from V2 still running, with Ollama pointed at a closed port by S6, so the model call fails after retrieval and nothing runs a model; runs after V3/V4 because it adds a 17th video)

1. Write `$SCRATCH/chat-fixture.mjs` — one generated video whose `transcriptSegments` is a real stored index, built with the client's generated `bm25-core.ts` (the M4 fixture's eight topics):

   ```js
   // node --experimental-strip-types chat-fixture.mjs <base> <keyFile>
   import { readFileSync } from 'node:fs';
   import { dirname, join } from 'node:path';
   import { fileURLToPath, pathToFileURL } from 'node:url';
   const [, , base, keyFile] = process.argv;
   const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
   const core = await import(pathToFileURL(join(REPO, 'client/src/lib/services/bm25-core.ts')).href);
   const TOPICS = [
     ['kubernetes', 'scheduler', 'pods', 'nodes', 'cluster', 'autoscaling'],
     ['sourdough', 'bread', 'flour', 'yeast', 'starter', 'oven'],
     ['marathon', 'training', 'running', 'pace', 'mileage', 'tempo'],
     ['telescope', 'galaxy', 'nebula', 'orbit', 'planet', 'comet'],
     ['espresso', 'grinder', 'crema', 'roast', 'barista', 'portafilter'],
     ['violin', 'orchestra', 'symphony', 'conductor', 'rehearsal', 'concerto'],
     ['glacier', 'avalanche', 'summit', 'crampons', 'altitude', 'ridge'],
     ['compiler', 'parser', 'lexer', 'bytecode', 'optimizer', 'linker'],
   ];
   const words = (v, n) => Array.from({ length: n }, (_, i) => v[i % v.length]).join(' ');
   const rawSegments = TOPICS.map((v, i) => ({ text: words(v, 260), startMs: i * 60000, endMs: i * 60000 + 59000 }));
   const index = core.buildTranscriptSearchIndex(rawSegments, 480);
   const res = await fetch(`${base}/api/yt-kb/videos`, {
     method: 'POST',
     headers: { Authorization: `Bearer ${readFileSync(keyFile, 'utf8').trim()}`, 'Content-Type': 'application/json' },
     body: JSON.stringify({ data: {
       youtubeVideoId: 'fxchat00001', url: 'https://www.youtube.com/watch?v=fxchat00001',
       videoTitle: 'Chat fixture', summaryStatus: 'generated', summaryTitle: 'Chat fixture',
       summaryDescription: 'd', summaryOverview: 'o', watchVerdict: 'skim', verdictSummary: 'v', verdictReason: 'r',
       valueScore: 40, valueScoreSource: 'model', signalScore: 50, finalScore: 46,
       keyTakeaways: [{ text: 'k' }], sections: [{ heading: 'Espresso', body: 'Grinder and crema.', timeSec: 240 }],
       actionSteps: [{ title: 'a', body: 'b' }], transcriptSegments: index,
     } }),
   });
   console.log(JSON.stringify({ status: res.status, chunks: index.bm25.chunks.length }));
   process.exit(res.status === 201 ? 0 : 1);
   ```

   `node --experimental-strip-types "$SCRATCH/chat-fixture.mjs" http://127.0.0.1:1341 "$SCRATCH/app.key"` → `{"status":201,"chunks":16}`.
2. Per-video chat: record the log size, post one question, and read what the handler logged before it streamed (`api.chat.tsx` logs `retrievedChunks` from `prepareChatPrompt`; the log is the one place the handler reports it without a model — a plain-text check):
   ```bash
   chat_chunks() { tail -c +$(( $1 + 1 )) "$SCRATCH/app.log" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=/retrievedChunks: (\d+)/.exec(s);console.log(JSON.stringify({retrievedChunks:m?+m[1]:null}));process.exit(m?0:1)})"; }
   B=$(wc -c < "$SCRATCH/app.log"); curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"videoId":"fxchat00001","messages":[{"role":"user","content":"espresso crema grinder"}]}' http://127.0.0.1:3005/api/chat; chat_chunks $B | jq -e '.retrievedChunks >= 1'
   ```
   → `retrievedChunks` ≥ 1 (before B-6 it was always 0).
3. **Negative control:** the same question for `fx000000001` (its `transcriptSegments` is the S4 placeholder, not an index): `B=$(wc -c < "$SCRATCH/app.log"); curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"videoId":"fx000000001","messages":[{"role":"user","content":"espresso crema grinder"}]}' http://127.0.0.1:3005/api/chat; chat_chunks $B | jq -e '.retrievedChunks == 0'` — the check tells an index from no index.
4. Digest chat: `B=$(wc -c < "$SCRATCH/app.log"); curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"videoIds":["fxchat00001","fx000000001"],"messages":[{"role":"user","content":"espresso crema grinder"}]}' http://127.0.0.1:3005/api/digest-chat; chat_chunks $B | jq -e '.retrievedChunks >= 1'`.

**V5 — states with Strapi down**

`lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill` (scratch Strapi only), then `(cd client && E2E_BASE_URL=http://127.0.0.1:3005 E2E_STRAPI_DOWN=1 npx playwright test e2e/core-loop-states.spec.ts -g "with Strapi down" --reporter=json > "$SCRATCH/e2e-v5.json"); node -e "const s=require(process.argv[1]).stats; console.log(s); process.exit(s.unexpected===0&&s.expected===2?0:1)" "$SCRATCH/e2e-v5.json"` → `expected: 2, unexpected: 0`. Then S7.

- **Done when:** the static gates pass; V1 shows 4 passing e2e tests and `bad: []` in the stub log; V2 shows the dev server listening only on `127.0.0.1:3005`, the LAN request refused (or the LAN check recorded as not runnable), and the `yt-kb-app` token refused on `/api/users` and the import route; V3 passes 4 e2e tests with `nullFinal: 0`; V4 shows the feed page under 300 KB and under a quarter of the baseline; V4b shows `retrievedChunks` ≥ 1 for `/api/chat` and `/api/digest-chat` on the indexed fixture and 0 on the placeholder; V5 passes 2; one commit on `egm/yt-kb-any-strapi`.
- **Rollback:** `git revert` the M6 commit, then `yarn --cwd client install` and `yarn --cwd server install` to restore the removed packages and lockfiles. No data step. If the owner already put the `yt-kb-app` key in `client/.env`, it keeps working after a revert (the pre-M6 app only needs a token with these scopes).

### M7 — Site and scripts

- **Why:** M-10 (`publish-site.sh` could not publish; `site:deploy` shipped an old `dist/`), M-6 (`copy-content.mjs` batches above a stock host's 1 MB JSON body limit), M-14 (the site's token: document the `yt-kb-site` custom token).
- **Depends on:** M5 (the `yt-kb-site` token from `create-tokens.cjs`; the import route's 207/403 and `import: false` gate), M6 (nothing in the site, but V-setup is reused).

#### 7.1 M-10 — `publish-site.sh` and `site:deploy`

- `publish-site.sh` — replace the whole file with (the curl pre-checks, the `python3` count and the `GENERATED` comparison go; the loader in `site/src/lib/strapi.ts:73-143` already refuses an unreachable Strapi, an error status, a count mismatch and zero rows, and it reads `site/.env` for the base URL and token):

  ```bash
  #!/usr/bin/env bash
  # Rebuild the static site from the library and publish it.
  #
  #   yarn site:publish            build + deploy to the live URL
  #   yarn site:publish --draft    build + deploy to a preview URL instead
  #
  # The build reads Strapi with STRAPI_BASE_URL and the yt-kb-site token from
  # site/.env, so the Strapi host has to be running. The loader in
  # site/src/lib/strapi.ts fails the build when Strapi is unreachable, answers
  # with an error, returns fewer videos than it reports, or has no generated
  # summary, so this script does not check Strapi itself.

  set -euo pipefail

  cd "$(dirname "$0")"

  say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
  die() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

  # Reject anything unrecognised rather than falling through. A mistyped
  # --draft used to leave DRAFT=false and publish to the live URL, which is
  # the one mistake this script must not make quietly.
  DRAFT=false
  case "${1:-}" in
    "") ;;
    --draft) DRAFT=true ;;
    *) die "Unknown argument: $1
  Usage: publish-site.sh [--draft]
    (no argument)  publish to the live URL
    --draft        publish to a preview URL instead" ;;
  esac
  [[ $# -le 1 ]] || die "Too many arguments. Usage: publish-site.sh [--draft]"

  LIVE_URL="https://boisterous-lamington-cc0eed.netlify.app"

  [[ "${SITE_SKIP_STRAPI_FETCH:-}" == "1" ]] && {
    printf '\n\033[31m%s\033[0m\n' "SITE_SKIP_STRAPI_FETCH=1 is exported in this shell.
  That flag is for typechecking; a build with it set loads no videos.
  Unset it and run this again." >&2
    exit 1
  }

  # ── 1. Build. The loader fails the build on an unreachable Strapi, a short
  #       read or an empty library; the output guard fails it if any retrieval
  #       state reached the output. ────────────────────────────────────────────
  say "Building"
  yarn --cwd ./site build

  PAGES=$(find site/dist -name 'index.html' | wc -l | tr -d ' ')
  VIDEO_PAGES=$(find site/dist/v -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  INDEX_KB=$(( $(wc -c < site/dist/search-index.json) / 1024 ))
  echo "  ${PAGES} pages (${VIDEO_PAGES} videos) · search index ${INDEX_KB} KB"

  # ── 2. Publish. ──────────────────────────────────────────────────────────────
  #
  # The Netlify CLI reads the linked project from its WORKING DIRECTORY, not
  # from --prefix or --dir. Run from the repo root it finds no link and quietly
  # creates a brand new project instead of updating yours — which it did to me
  # once. So: cd into site/, which is where the link and netlify.toml live.
  [[ -f site/.netlify/state.json ]] || die "site/ is not linked to a Netlify project.
  Link it once:  cd site && npx netlify link
  Then run this again. (Without the link the CLI would create a new project
  rather than updating the existing one.)"

  if [[ "${DRAFT}" == true ]]; then
    say "Deploying a PREVIEW — the live site is NOT being updated"
    (cd site && npx netlify deploy --dir=dist)
    # A draft run used to end on "Done." next to a URL, which reads exactly
    # like a successful publish. It is not one, and the difference is a
    # whole day of stale content before anyone notices.
    printf '\n\033[33m%s\033[0m\n' "PREVIEW ONLY — the live site still shows the previous build.
  Open the draft URL above to check it, then publish for real with:
    yarn site:publish"
  else
    say "Deploying to the live URL"
    (cd site && npx netlify deploy --prod --dir=dist)
    printf '\n\033[32m%s\033[0m\n' "Published live: ${LIVE_URL}"
  fi
  ```

  (The heredoc-style continuation lines inside the `die`/`printf` strings start at column 0 in the real file, as they do today; the two-space indent above is only this Markdown block's.) Keep the file mode executable (`git diff --summary` shows no mode change).
- `site/package.json` `scripts.deploy` → `"deploy": "yarn build && npx netlify deploy --prod --dir=dist"` (the root `site:deploy` delegates to it, so it now builds first).

#### 7.2 M-14 — the site's token

- `site/.env.example` — replace the whole file with:

  ```bash
  # Strapi REST base, including the plugin prefix /api/yt-kb. The build
  # fetches this at build time; nothing is read at runtime.
  STRAPI_BASE_URL=http://localhost:1340/api/yt-kb

  # The `yt-kb-site` custom Content API token: find on videos and tags,
  # nothing else. Create it with the plugin's token script, run from the
  # Strapi app root:
  #   node node_modules/strapi-plugin-yt-kb/scripts/create-tokens.cjs --out-app <file> --out-site <file>
  # (in this repo: cd server && node src/plugins/yt-kb/scripts/create-tokens.cjs …)
  # and paste the contents of the --out-site file here. Don't use a Read-only
  # token: on a host with Users & Permissions it can also read /api/users. The
  # plugin grants the Public role nothing, so with this empty the build fails
  # with 403.
  STRAPI_API_TOKEN=

  # Public URL of the deployed site. Feeds Astro's `site` config.
  SITE_URL=http://localhost:4330
  ```
- `site/README.md`:
  - Lines 7–11 ("Per video: … No thumbnails — the allowlist carries only fields the pages actually render.") become:

    ```markdown
    Per video: title, author, verdict, content score and the reason behind it,
    overview, key takeaways, sections with timecoded links into the video,
    action steps, tags, and the readable article when one exists. Thumbnails
    come straight from YouTube (`i.ytimg.com/vi/<id>/hqdefault.jpg`, built from
    the video id in `src/lib/player.ts`), so the allowlist does not fetch
    `videoThumbnailUrl`.
    ```
  - The "Build" section (lines 18–29) becomes:

    ````markdown
    ## Build

    The build reads Strapi at `STRAPI_BASE_URL` (default
    `http://localhost:1340/api/yt-kb`, the plugin's REST prefix) with the token
    in `STRAPI_API_TOKEN`, both from `site/.env`, so the Strapi host must be
    running:

    ```bash
    yarn start        # from the repo root, in another terminal
    yarn site:build   # from the repo root
    ```

    `STRAPI_API_TOKEN` is the `yt-kb-site` custom token — find on videos and
    tags, nothing else. Create it once with the plugin's token script, from the
    Strapi app root (`server/` here):

    ```bash
    node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app <file> --out-site <file>
    ```

    (`node node_modules/strapi-plugin-yt-kb/scripts/create-tokens.cjs …` in an
    app that installed the plugin from npm), then paste the contents of the
    `--out-site` file into `site/.env`. If a `yt-kb-site` token already exists,
    add `--rotate yt-kb-site`: the script revokes it and creates it fresh
    (without that flag it skips an existing name). Don't use a Read-only
    token: on a host with Users & Permissions it can also read `/api/users`.

    The build fails if Strapi is unreachable, answers with an error (a missing
    or wrong token is a 403), returns fewer videos than it reports, or has no
    video with a generated summary — rather than publishing an empty or partial
    site.
    ````
  - "Publishing a content update" (lines 37–46) becomes:

    ````markdown
    ```bash
    yarn site:publish         # rebuild, deploy live
    yarn site:publish:draft   # same, but to a preview URL
    ```

    It refuses to publish rather than ship something wrong: the build stops on
    an unreachable Strapi, a short read or an empty library, and the script
    stops if `site/` is not linked to Netlify.

    `yarn site:deploy` also rebuilds and deploys live, without the draft option
    or the link check — prefer `yarn site:publish`.
    ````
  - Line 94: `yarn site:test              # 96 unit tests, no stack needed` → the count `yarn site:test` reports (107 at `721f210` per CLAUDE.md; M7 adds no site test).

#### 7.3 M-6 — `copy-content.mjs` batches under 1 MB

One place owns the batching and the 413 rule: the new `server/src/plugins/yt-kb/scripts/import-batches.mjs`. M5's `postImport` stays the one function that POSTs a batch; it only learns to report a 413.

- New `server/src/plugins/yt-kb/scripts/import-batches.mjs` (ships with the plugin: `package.json` `files` includes `scripts`):

  ```js
  // Plans and sends the POST bodies for /api/yt-kb/import/:type (copy-content.mjs).
  //
  // A stock Strapi accepts at most 1 MB of JSON per request (koa-body's
  // default, @strapi/core middlewares/body.js). Each body {"data":[...]} is
  // kept at or under MAX_BATCH_BYTES; a record that is bigger than that on its
  // own is sent alone, and if the destination still answers 413 the copy
  // records it as failed with TOO_LARGE and goes on (M-6).

  export const MAX_BATCH_BYTES = 900_000;
  export const TOO_LARGE = 'body too large — raise strapi::body jsonLimit on the destination';

  const ENVELOPE_BYTES = Buffer.byteLength('{"data":[]}');

  /** Split records, in order, into batches whose JSON body stays at or under
   *  maxBytes. A record that alone exceeds maxBytes gets a batch of its own. */
  export function planBatches(records, maxBytes = MAX_BATCH_BYTES) {
    const batches = [];
    let batch = [];
    let bytes = ENVELOPE_BYTES;
    for (const record of records) {
      const size = Buffer.byteLength(JSON.stringify(record));
      const added = batch.length === 0 ? size : size + 1; // +1 for the comma
      if (batch.length > 0 && bytes + added > maxBytes) {
        batches.push(batch);
        batch = [];
        bytes = ENVELOPE_BYTES;
      }
      bytes += batch.length === 0 ? size : size + 1;
      batch.push(record);
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
  }

  /** POST `records` in planned batches through `post(batch)` and total the
   *  importer's answers. `post` resolves the importer's
   *  `{ created, updated, failed[] }` body, or `{ tooLarge: true }` when the
   *  destination answered 413: that batch's records are recorded as failed
   *  with TOO_LARGE and the copy goes on. Anything `post` throws stops the run. */
  export async function importInBatches(records, post, maxBytes = MAX_BATCH_BYTES) {
    const totals = { created: 0, updated: 0, failed: [] };
    for (const batch of planBatches(records, maxBytes)) {
      const r = await post(batch);
      if (r.tooLarge) {
        totals.failed.push(...batch.map((rec) => ({ documentId: rec.documentId, error: TOO_LARGE })));
        continue;
      }
      totals.created += r.created;
      totals.updated += r.updated;
      totals.failed.push(...r.failed);
    }
    return totals;
  }
  ```
- `server/src/plugins/yt-kb/scripts/copy-content.mjs` (as M5 left it):
  - Header comment: after line 18 add

    ```js
    //
    // Records are POSTed in batches of at most 900 KB of JSON (import-batches.mjs),
    // under a stock Strapi's 1 MB body limit; a record bigger than that is sent on
    // its own. A 413 marks that batch's records as failed — raise strapi::body
    // jsonLimit on the destination (config/middlewares) and re-run; re-running is
    // safe.
    ```

    and after the header add `import { importInBatches } from './import-batches.mjs';`.
  - In M5's `postImport`, directly after `const text = await res.text();` add `if (res.status === 413) return { tooLarge: true };` and add `// 413 = the body was too large for the destination; importInBatches records it.` to its comment. Nothing else in `postImport` changes: 200/207 still return the body, the 403 gate still stops the run, anything else still throws.
  - Replace the `// POST in batches that stay well under Strapi's JSON body limit.` comment, `const MAX_BATCH_BYTES = 8 * 1024 * 1024;` and the whole `importAll` function (with M5's `postImport` call inside its `flush`) with:

    ```js
    // POST in planned batches under a stock Strapi's 1 MB body limit
    // (import-batches.mjs); a 413'd batch is recorded as failed and the copy goes on.
    const importAll = (t, records) => importInBatches(records, (batch) => postImport(t.type, batch));
    ```

    `request` is unchanged (reads only); its caller signature `importAll(t, records)` is unchanged.
- `server/src/plugins/yt-kb/vitest.config.mts` (M1's file) — `include: ['server/src/**/*.test.ts']` → `include: ['server/src/**/*.test.ts', 'tests/**/*.test.mjs']` (the scripts live outside `server/src`, and `tests/` is not in the package's `files`, so the test is not published).
- Test: new `server/src/plugins/yt-kb/tests/import-batches.test.mjs`:

  ```js
  import { describe, expect, it } from 'vitest';
  import { MAX_BATCH_BYTES, TOO_LARGE, importInBatches, planBatches } from '../scripts/import-batches.mjs';

  const rec = (id, pad) => ({ documentId: id, pad: 'x'.repeat(pad) });
  const bodyBytes = (batch) => Buffer.byteLength(JSON.stringify({ data: batch }));

  describe('planBatches', () => {
    it('keeps every multi-record body at or under MAX_BATCH_BYTES, in order', () => {
      const records = Array.from({ length: 50 }, (_, i) => rec(`r${i}`, 100_000 + i * 997));
      const batches = planBatches(records);
      for (const b of batches) if (b.length > 1) expect(bodyBytes(b)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
      expect(batches.flat()).toEqual(records);
    });
    it('only starts a new batch when the next record would not fit', () => {
      const records = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, 50_000 + i * 1_337));
      const batches = planBatches(records);
      for (let i = 0; i + 1 < batches.length; i += 1) {
        expect(bodyBytes([...batches[i], batches[i + 1][0]])).toBeGreaterThan(MAX_BATCH_BYTES);
      }
    });
    it('sends a record larger than the limit on its own', () => {
      const big = rec('big', MAX_BATCH_BYTES);
      const batches = planBatches([rec('a', 10), big, rec('b', 10)]);
      expect(batches.map((b) => b.map((r) => r.documentId))).toEqual([['a'], ['big'], ['b']]);
    });
    it('returns no batches for no records', () => {
      expect(planBatches([])).toEqual([]);
    });
    it('names the fix in the 413 message', () => {
      expect(TOO_LARGE).toBe('body too large — raise strapi::body jsonLimit on the destination');
    });
  });

  describe('importInBatches', () => {
    it('totals the answers and records a 413 batch as failed, then goes on', async () => {
      const big = rec('big', MAX_BATCH_BYTES);
      const sent = [];
      const post = async (batch) => {
        sent.push(batch.map((r) => r.documentId));
        if (batch.some((r) => r.documentId === 'big')) return { tooLarge: true };
        return { created: batch.length, updated: 0, failed: [] };
      };
      const totals = await importInBatches([rec('a', 10), big, rec('b', 10)], post);
      expect(sent).toEqual([['a'], ['big'], ['b']]);
      expect(totals).toEqual({ created: 2, updated: 0, failed: [{ documentId: 'big', error: TOO_LARGE }] });
    });
    it('passes the importer\'s own failures through and stops on a throw', async () => {
      const totals = await importInBatches([rec('a', 10)], async () => ({ created: 0, updated: 0, failed: [{ documentId: 'a', error: 'bad' }] }));
      expect(totals.failed).toEqual([{ documentId: 'a', error: 'bad' }]);
      await expect(importInBatches([rec('a', 10)], async () => { throw new Error('POST → 500'); })).rejects.toThrow('POST → 500');
    });
  });
  ```

- **Data:** none.
- **Callers updated:** `publish-site.sh` ← root `site:publish`/`site:publish:draft` (unchanged); `site/package.json` `deploy` ← root `site:deploy` (unchanged); `copy-content.mjs` has no in-repo caller (it is run by hand; CLAUDE.md:200 and `docs/designs/yt-kb-plugin.md:36` point to it and need no change). CLAUDE.md's rows for `yarn site:publish` ("Checks Strapi, rebuilds…") and `yarn site:deploy` ("without rebuilding") are M8's.

#### Verify (M7)

Repeat M6's V-setup S0–S4 with `M=m7` (S1 then gives `SCRATCH=$PWD/server/.tmp/e8/m7` and the fresh scratch DB `server/.tmp/e8-m7.db`; scratch Strapi on 1341 with the 16 fixture videos, both tokens). Add port 1398 to S0's port check. Back up the owner's site build first: `test -d site/dist && mv site/dist "$SCRATCH/site-dist-backup"`; restore it at the end (step 9). The builds below also rewrite `site/.astro/`, which the next real build replaces (`store.clear()` in `site/src/content.config.ts`).

1. Static: `bash -n publish-site.sh` → exit 0. `node -e "const t=require('fs').readFileSync('publish-site.sh','utf8'); const bad=['curl','python3','GENERATED','STRAPI_URL='].filter(w=>t.includes(w)); console.log({bad}); process.exit(bad.length?1:0)"` → `{ bad: [] }`. `node -e "const d=require('./site/package.json').scripts.deploy; process.exit(d==='yarn build && npx netlify deploy --prod --dir=dist'?0:1)"` → exit 0. `yarn site:test` → exit 0. `yarn --cwd server/src/plugins/yt-kb test` → exit 0, and its output lists `tests/import-batches.test.mjs` with 7 passing tests. `cd site && npx astro sync && npx tsc --noEmit` with `SITE_SKIP_STRAPI_FETCH=1` → exit 0.
2. **Site token scope (M-14), positive and negative:** `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(cat "$SCRATCH/site.key")" <url>` → `http://127.0.0.1:1341/api/yt-kb/videos?pagination[pageSize]=1` `200`; `http://127.0.0.1:1341/api/yt-kb/tags` `200`; `http://127.0.0.1:1341/api/users` `403`; `http://127.0.0.1:1341/api/yt-kb/notes` `403`; `http://127.0.0.1:1341/api/yt-kb/transcripts` `403`.
3. Site build with the `yt-kb-site` token (env vars override `site/.env`, `site/src/content.config.ts:9-16`): `STRAPI_BASE_URL=http://127.0.0.1:1341/api/yt-kb STRAPI_API_TOKEN="$(cat "$SCRATCH/site.key")" yarn site:build` → exit 0; `node -e "const n=require('fs').readdirSync('site/dist/v',{withFileTypes:true}).filter(d=>d.isDirectory()).length; console.log({videoPages:n}); process.exit(n===16?0:1)"` → `{ videoPages: 16 }`.
   **Negative:** `STRAPI_BASE_URL=http://127.0.0.1:1341/api/yt-kb STRAPI_API_TOKEN= yarn site:build` → non-zero exit, output contains `Strapi answered 403`.
4. `publish-site.sh` with a recording `npx` (nothing deploys). Create the stub:
   `mkdir -p "$SCRATCH/bin" && printf '#!/usr/bin/env bash\nprintf "%%s|%%s\\n" "$PWD" "$*" >> "$NPX_LOG"\n' > "$SCRATCH/bin/npx" && chmod +x "$SCRATCH/bin/npx"`, then `export NPX_LOG="$SCRATCH/npx.log"; : > "$NPX_LOG"`. Every run below uses `PATH="$SCRATCH/bin:$PATH" STRAPI_BASE_URL=http://127.0.0.1:1341/api/yt-kb STRAPI_API_TOKEN="$(cat "$SCRATCH/site.key")"` (and needs `site/.netlify/state.json`, which this checkout has; if it is missing, STOP — do not run `netlify link`). Check the log after each run with `node -e "const l=require('fs').readFileSync(process.env.NPX_LOG,'utf8').split('\n').filter(Boolean); console.log(l)"`.
   - `./publish-site.sh --draft` → exit 0, prints a count line containing `(16 videos)`, and the log gains exactly one line, `<repo>/site|netlify deploy --dir=dist` (`<repo>` = the absolute repo path).
   - `./publish-site.sh` → exit 0, log gains exactly `<repo>/site|netlify deploy --prod --dir=dist`.
   - `yarn site:deploy` → exit 0, `site/dist` rebuilt (mtime of `site/dist/index.html` newer than before the command), log gains `<repo>/site|netlify deploy --prod --dir=dist`.
   - **Negative:** `./publish-site.sh --drfat` → exit 1, "Unknown argument", no new log line. `SITE_SKIP_STRAPI_FETCH=1 ./publish-site.sh --draft` → exit 1, no new log line.
5. `copy-content.mjs --check` against the scratch Strapi as both source and destination: `cd server/src/plugins/yt-kb/scripts && SOURCE_URL=http://127.0.0.1:1341 DEST_URL=http://127.0.0.1:1341 SOURCE_TOKEN="$(cat "$SCRATCH/app.key")" DEST_TOKEN="$(cat "$SCRATCH/app.key")" node copy-content.mjs --check > "$SCRATCH/check.out" 2>&1; echo "exit $?"` → `exit 0`, and `node -e "const l=require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n'); process.exit(l.at(-1)==='ALL OK'?0:1)" "$SCRATCH/check.out"` → exit 0.
   **Negative (token scope):** the same command, `2>&1` included, with `DEST_TOKEN="$(cat "$SCRATCH/site.key")"` → non-zero exit, last line not `ALL OK`, output contains `→ 403` (the site token cannot read transcripts). The `→ 403` line is the uncaught error from `request`, which Node writes to stderr — without `2>&1` it never reaches `check.out`.
6. Batching and 413 against a recording destination. Write `$SCRATCH/import-stub.mjs`:

   ```js
   // Destination stand-in: records each import POST; 413 above LIMIT bytes,
   // like Strapi's body middleware; reads return an empty collection.
   import http from 'node:http';
   import { appendFileSync } from 'node:fs';
   const [, , port, logFile, limitArg] = process.argv;
   const LIMIT = Number(limitArg);
   http.createServer((req, res) => {
     const chunks = [];
     req.on('data', (c) => chunks.push(c));
     req.on('end', () => {
       const body = Buffer.concat(chunks);
       res.setHeader('content-type', 'application/json');
       if (req.method === 'POST' && req.url.startsWith('/api/yt-kb/import/')) {
         const records = JSON.parse(body.toString('utf8')).data.length;
         const status = body.length > LIMIT ? 413 : 200;
         appendFileSync(logFile, JSON.stringify({ type: req.url.split('/').pop(), bytes: body.length, records, status }) + '\n');
         res.statusCode = status;
         res.end(status === 413
           ? JSON.stringify({ data: null, error: { status: 413, name: 'PayloadTooLargeError', message: 'request entity too large' } })
           : JSON.stringify({ created: records, updated: 0, failed: [] }));
         return;
       }
       res.end(JSON.stringify({ data: [], meta: { pagination: { page: 1, pageSize: 100, pageCount: 1, total: 0 } } }));
     });
   }).listen(Number(port), '127.0.0.1');
   ```

   `: > "$SCRATCH/import.log"; nohup node "$SCRATCH/import-stub.mjs" 1398 "$SCRATCH/import.log" 1048576 > /dev/null 2>&1 &` (port 1398 was checked free in S0). Then `cd server/src/plugins/yt-kb/scripts && SOURCE_URL=http://127.0.0.1:1341 DEST_URL=http://127.0.0.1:1398 SOURCE_TOKEN="$(cat "$SCRATCH/app.key")" DEST_TOKEN=stub-not-a-secret node copy-content.mjs > "$SCRATCH/copy.out"; echo "exit $?"` → `exit 1` (the stub keeps nothing, so the check reports missing rows). Then:
   `node -e "const fs=require('fs'); const log=fs.readFileSync(process.argv[1],'utf8').trim().split('\n').map(JSON.parse); const out=fs.readFileSync(process.argv[2],'utf8'); const multiOver=log.filter(e=>e.records>1&&e.bytes>900000); const tooBig=log.filter(e=>e.status===413); const ok=multiOver.length===0 && tooBig.length===1 && tooBig[0].records===1 && tooBig[0].bytes>900000 && out.includes('body too large — raise strapi::body jsonLimit on the destination') && /videos: read 16, created 15, updated 0, failed 1/.test(out); console.log({posts:log.length, multiOver:multiOver.length, tooBig, ok}); process.exit(ok?0:1)" "$SCRATCH/import.log" "$SCRATCH/copy.out"` → `ok: true`: every multi-record body is at most 900 KB, the one ~1.4 MB fixture (row 16) went alone, got a 413 and is reported with the fix. (The `videos: read …` pattern is the script's summary line at `721f210`; M5 and M7 do not change it.) (Before M7, the script sent bodies up to 8 MB and stopped the whole run on the first 413.) Stop the stub: `lsof -ti tcp:1398 -sTCP:LISTEN | xargs kill`.
7. Strapi down (negative for M-10): `lsof -ti tcp:1341 -sTCP:LISTEN | xargs kill`, then `: > "$NPX_LOG"; PATH="$SCRATCH/bin:$PATH" STRAPI_BASE_URL=http://127.0.0.1:1341/api/yt-kb STRAPI_API_TOKEN="$(cat "$SCRATCH/site.key")" ./publish-site.sh --draft; echo "exit $?"` → non-zero, output contains `Cannot reach Strapi`, and the npx log is empty (nothing deployed).
8. M6's S7 cleanup (ports, scratch DB file).
9. Restore the owner's site build: `rm -rf site/dist && { test -d "$SCRATCH/site-dist-backup" && mv "$SCRATCH/site-dist-backup" site/dist || true; }`, then `rm -rf "$SCRATCH"`.

- **Done when:** `bash -n` passes and the script has no curl/python3/GENERATED; the site builds 16 pages with the `yt-kb-site` token and fails with 403 without one; the token reads videos and tags and gets 403 on `/api/users`, notes and transcripts; the recording `npx` sees exactly one deploy per `publish-site.sh`/`site:deploy` run with the right flags and none on a bad argument, the skip flag or a stopped Strapi; `copy-content.mjs --check` prints `ALL OK` against one Strapi and fails with the site token; against the recording destination no multi-record body exceeds 900 KB and the oversize record is reported with the jsonLimit message; one commit on `egm/yt-kb-any-strapi`.
- **Rollback:** `git revert` the M7 commit. No data step. The owner's `site/.env` needs no change on revert (the old script ignored it).

### M8 — Docs

- **Why:** G1, G7, M-9, M-6, M-1, M-5, M-11 (docs for every change above); keeps `CLAUDE.md` true.
- **Files:**
  - `server/src/plugins/yt-kb/README.md` — new file, the plugin's npm README. Sections, in this order:
    1. **What it is** — one paragraph: content types, REST under `/api/yt-kb`, MCP tools, transcript fetcher; Strapi `^5.61.0`. Then one sentence on databases: *Supports SQLite and PostgreSQL. MySQL and MariaDB are not supported* (the schema puts a unique index on the `text` column `digest.videoSetKey`, which MySQL cannot index without a prefix length — not run on MySQL).
    2. **Install** — `npm install strapi-plugin-yt-kb` (or `yarn add`), then in the host's `config/plugins.ts`:
       ```ts
       export default ({ env }) => ({
         'yt-kb': {
           enabled: true,
           config: {
             proxyUrl: env('PROXY_URL', ''), // residential proxy; needed on most cloud hosts
             mcp: true,                      // register MCP tools on /mcp
             import: false,                  // enable only while copying content in
             backfillMetadata: false,
           },
         },
       });
       ```
    3. **Configuration** — a table of the four keys with type, default and effect, exactly as in M3/M5.
    4. **Tokens** — run `node node_modules/strapi-plugin-yt-kb/scripts/create-tokens.cjs --out-app <file> --out-site <file>` with Strapi stopped; `--rotate yt-kb-app` / `--rotate yt-kb-site` revokes an existing token of that name and creates it fresh (without it an existing name is skipped); what each token can do (list the scopes from M5). On Strapi Cloud, whose managed database is not reachable from outside, the main path is the admin panel: Settings → API Tokens → Create new API Token, type **Custom**, ticking exactly the scopes listed for `yt-kb-app` and `yt-kb-site`; the script is for hosts whose database the operator can reach.
    5. **MCP** — the 21 tool names (table from M5), the per-tool permissions (`plugin::yt-kb.tool.<name>`), and the rule: *give MCP tokens only `plugin::yt-kb.tool.*` permissions; never grant Content Manager permissions on yt-kb types to a token used by an agent — Strapi's Content Manager and `tanstack-ai` expose generic create/update/delete tools for those types* (M-9).
    6. **tanstack-ai** — tools appear in its chat as `yt-kb__<name>` when the admin's role holds the tool's permission.
    7. **Copying content in** — `scripts/copy-content.mjs`, env vars, `import: true` while copying, and the body-limit note: hosts on the default `strapi::body` (1 MB JSON) copy one large record per request; a record over ~900 KB needs `jsonLimit` raised (M7).
    8. **Proxy** — when it's needed, the boot-time check log lines, `PROXY_URL`.
    9. **License** — GPL-3.0-or-later; the fetcher is adapted from `strapi-plugin-youtube-transcripts` (MIT) with its notice.
  - `CLAUDE.md` — update these sections to match M1–M7: test counts — every "319" (and the site's "107" if it moved) becomes the count the final `yarn test` reports after M7, and the new plugin suite (`yarn plugin:test`, i.e. `yarn --cwd server/src/plugins/yt-kb test`) is listed with the count its final run reports; "Unit tests are vitest, in `client/src/` only. The server has no test suite" becomes a description of both suites; the `yarn install:all` and `yarn setup` rows include the plugin; "Stored BM25 index invalidation" (the plugin copy is the source, `yarn sync:bm25` copies plugin → client, edit the plugin copy only); "yt-kb's Strapi code is a plugin" (install/build now in `yarn setup`; config keys; `import` gate); "MCP server lives in Strapi" (tool names `yt_kb__*`, per-tool permissions, legacy tiers migrated at boot, `ai-tools`, "Adding a tool" now also needs a per-tool action — follow M5's file); the gotcha "Tag slugs are generated server-side" (rule lives in `PSRC/document-rules.ts`, collisions get `-2`, `-3`); remove every `TRANSCRIPT_PROXY_URL` mention; fix the zod wording ("`@strapi/utils` exports zod 4's API").
  - `docs/mcp.md` — replace the tool table with the new names; replace the three-tier permission section with per-tool permissions and the legacy migration; replace the admin-token mint snippet's `adminPermissions` with the 21 per-tool actions (generate the list from M5's table); add the `ai-tools` / `tanstack-ai` section; proxy via `proxyUrl`.
  - `README.md` — env-var table: the `STRAPI_API_TOKEN` row (line 218 at `721f210`, "Optional bearer token for locked-down deployments") says it is required and must be the `yt-kb-app` custom token from M5's script (`README.md` has no `TRANSCRIPT_PROXY_URL` to remove); MCP mint snippet as in `docs/mcp.md`; the `yt_kb__` tool names wherever listed.
  - `docs/operations.md` line 85 ("**YouTube bot wall.** … Set `TRANSCRIPT_PROXY_URL` in `client/.env` …") — the fix becomes: set `PROXY_URL` in the Strapi host's `server/.env` (read by the plugin config `proxyUrl`) to a residential proxy, then restart Strapi; its boot log shows the proxy check. (Without this edit the `TRANSCRIPT_PROXY_URL` grep below fails.)
  - `docs/architecture.md` — §4.1 Fetch (hardened fetcher, failure reasons, `proxyUrl`); MCP paragraph (names, per-tool permissions).
- **Data:** none.
- **Callers updated:** none (docs only).
- **Verify:**
  - `grep -rn "TRANSCRIPT_PROXY_URL" --include='*.md' --include='*.ts' --include='*.mjs' --include='*.example' . | grep -v node_modules | grep -v "docs/designs/"` → no output.
  - `grep -rnE "\b(getVideo|libraryStats|listTags|searchVideos)\b" docs/mcp.md README.md` → only inside sentences that mention the `yt_kb__` name next to them, or no output.
  - `node -e "const s=require('fs').readFileSync('docs/mcp.md','utf8'); const n=(s.match(/plugin::yt-kb\.tool\.[a-z-]+/g)||[]); console.log(new Set(n).size)"` → `21`.
- **Done when:** the three greps above give the stated results and the plugin README has all nine sections.
- **Rollback:** revert the commit.

## Environment variables

| Variable | App | Change | Example value | Notes |
|---|---|---|---|---|
| `PROXY_URL` | Strapi host (`server/.env`) | add | `http://user:pass@proxy.example:8080` | Read through the plugin config `proxyUrl`. Server-only. Empty locally. |
| `TRANSCRIPT_PROXY_URL` | Strapi host (`server/.env`, `server/.env.example`) | remove | — | Replaced by `PROXY_URL`. Nothing reads it after M3. |
| `STRAPI_API_TOKEN` | TanStack app (`client/.env`) | change | `<yt-kb-app token>` | Must be the `yt-kb-app` custom token from M5's script. Server-only (no public prefix). Set by the owner from the key file (Deployment step 3). |
| `STRAPI_API_TOKEN` | Astro site (`site/.env`) | change | `<yt-kb-site token>` | Must be the `yt-kb-site` custom token; Deployment step 3 rotates the old read-only `yt-kb-site`, so the current value stops working there. Set by the owner from the key file. Used only at build time on the owner's Mac. |

No variable changes for any other environment: nothing is deployed by this spec.

## Deployment

Local only (the test host `server/`, the app and the site on the owner's Mac). Order:

1. Implement and verify M1–M8 on the branch against scratch databases.
2. **Owner's data:** stop Strapi. Back up with the check kit: `TS=$(date +%s); node server/.tmp/e8/e8.mjs backup server/.tmp/data.db server/.tmp/data.db.pre-yt-kb-any-strapi-$TS` → `"integrity": "ok"` (E8 never booted `data.db`, so M1's internal migrations, M2's schema sync and M5's grant migration all first run on it in this step; M1's and M2's earlier backups were taken too, and this is the backup M5's Data section asks for). Duplicate check: `node server/.tmp/e8/e8.mjs dupcheck server/.tmp/data.db` → `{"duplicates": []}` (if not, stop and ask). Start Strapi once (`yarn server`) so schema sync adds the new columns and unique indexes and the plugin bootstrap migrates the grants; confirm with `node server/.tmp/e8/e8.mjs sql server/.tmp/data.db "select name from sqlite_master where type='index' and name like 'yt_kb_%_uq' order by name"` → the five `_uq` indexes M2 lists, and `node server/.tmp/e8/e8.mjs sql server/.tmp/data.db "SELECT COUNT(*) AS n FROM admin_permissions p JOIN admin_permissions_api_token_lnk l ON l.permission_id=p.id JOIN strapi_api_tokens t ON t.id=l.api_token_id WHERE t.name='claude-mcp-1782487483515' AND p.action LIKE 'plugin::yt-kb.tool.%'"` → `n: 21`. The Strapi log shows `[yt-kb] legacy MCP grant migration: 6 legacy row(s), 3 migrated, 21 per-tool grant(s) added, 3 super-admin and 0 orphan row(s) left to Strapi` (M5 Facts 9). Rollback for this step: stop Strapi and `cp server/.tmp/data.db.pre-yt-kb-any-strapi-$TS server/.tmp/data.db`.
3. **Tokens:** stop Strapi. `data.db` already has a read-only `yt-kb-site` (M5 Facts 9), so the script rotates it; `yt-kb-app` does not exist yet and is created. `KEYS` is a new folder in the implementing session's scratchpad directory (the one its system prompt names, e.g. `/private/tmp/claude-501/-Users-paul-projects-yt-knowledge-base/<session>/scratchpad`), never inside the repo:
   ```bash
   KEYS="<scratchpad>/yt-kb-keys"; mkdir -p "$KEYS" && chmod 700 "$KEYS"
   (cd server && node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app "$KEYS/yt-kb-app.key" --out-site "$KEYS/yt-kb-site.key" --rotate yt-kb-site)
   node -e 'const fs=require("fs");const bad=process.argv.slice(1).filter(f=>(fs.statSync(f).mode&0o777)!==0o600);console.log(JSON.stringify({bad}));process.exit(bad.length?1:0)' "$KEYS/yt-kb-app.key" "$KEYS/yt-kb-site.key"
   ```
   → exit 0; the script logs `created yt-kb-app`, `revoked yt-kb-site` and `created yt-kb-site`; `bad: []`. Never pass `--rotate yt-kb-client` (the script refuses it anyway, exit 2): the old full-access `yt-kb-client` stays in place until the owner revokes it in the admin panel once the app works — say so in the final report; don't revoke it yourself. From here the site's old read-only key no longer works.
   Then **STOP and hand over to the owner** (the agent never opens, prints or edits a `.env`): tell the owner the two absolute file paths, `$KEYS/yt-kb-app.key` and `$KEYS/yt-kb-site.key`; the **owner** pastes the first file's contents into `client/.env` and the second's into `site/.env`, each as `STRAPI_API_TOKEN=<key>`, and says when it is done. Only then start Strapi and the app. After the owner confirms, offer to delete `$KEYS` (`rm -rf "$KEYS"`).
4. **MCP client:** the owner's MCP server `yt-knowledge-base` keeps using admin token `claude-mcp-1782487483515`; after step 2 it holds the 21 per-tool actions. Tool names change to `yt_kb__*`, so Claude sessions must reconnect.
5. Migrations: none in `database/migrations`; schema changes apply through Strapi's schema sync on first boot; the grant migration and the Public/Authenticated cleanup run in the plugin's `bootstrap()` on every boot (idempotent).

## Open questions

Only what is still open after the owner's and the Elephant's 2026-11-08 resolutions. Each needs an owner answer; until then the spec does what the item says.

Resolved by the Elephant on 2026-11-08 (recorded here so the implementer does not re-ask):

- **OQ-1 — `strapi-plugin verify` fails:** fix what it reports inside M1. If the fix needs a structural change to the plugin package (entry points, exports, folder layout), stop and ask.
- **OQ-2 — browser-level race check:** not added. Service-level tests plus live REST races are the check.
- **OQ-3 — `rawSegments` inside `searchIndex`:** kept, as the contract builds it (the field is private and stored once per transcript).
- **OQ-4 — tool descriptions:** unchanged. The same description is shown under two naming schemes (`yt_kb__get_transcript` on MCP, `yt-kb__getTranscript` in `tanstack-ai`), as in `strapi-plugin-youtube-transcripts`.
- **OQ-5 — one oEmbed request in M3 Verify step 8 (and one in M6 Verify V1 step 3, test 4):** acceptable; it is existing app behaviour.
- **OQ-6 — `groundSectionsToTranscript`:** moves into `bm25-core` as M4 says (pure, harmless).
- **OQ-7 — a socket error instead of a 413:** as M7's code and test do it: only a 413 answer is `{ tooLarge: true }` (that batch's records are recorded as failed with the `jsonLimit` message and the copy goes on). Anything else `postImport` throws — a socket reset, a non-413 error status — stops the run with that error (`importInBatches` does not catch it; M7's test "stops on a throw"). `copy-content.mjs` is idempotent (the importer upserts by `documentId`, keeping documentIds and dates), so the owner raises the destination's `strapi::body` `jsonLimit` and re-runs it.

Still open (owner):

- **OQ-8 — Netlify build hooks.** ⚠️ not in code — M7 assumes the owner's Netlify project has no build hook and is only published by hand (`yarn site:publish`). Is that right?
