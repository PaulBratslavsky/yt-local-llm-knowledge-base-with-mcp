# E8 implementation log — yt-kb change spec (`06-change-spec.md`)

One section per milestone. Branch `egm/yt-kb-any-strapi`.

## M1

**Milestone:** M1 — Platform: Strapi 5.61.0, pinned dependencies, the plugin in setup, CI and tests. Started from HEAD `3931a68`, clean working tree. The commit hash is reported in the hand-off, not written here: the hash changes if the log is amended.

### Baseline and runtime versions

| Item | Value |
|---|---|
| `node --version` | v24.16.0 (precondition 4 check → exit 0) |
| `yarn --version` | 1.22.22 |
| `jq --version` | jq-1.7.1-apple (`/usr/bin/jq`) |
| `CLIENT_BASELINE` (`yarn test`, before any edit) | **321** tests, 37 files, all passed. CLAUDE.md still says 319, so it is out of date (M8 rewrites it). Ollama was up on 127.0.0.1:11434 (the owner's process), and Strapi was down. |
| `yarn site:test` baseline | 107 tests, 11 files, all passed |
| Strapi after the upgrade | `@strapi/strapi`, `@strapi/core`, `@strapi/database`, `@strapi/utils`, `@strapi/plugin-cloud`, `@strapi/plugin-users-permissions`: all 5.61.0 |
| `zod` under `@strapi/utils` (`zodForUtils`) | **4.4.3**, inside the accepted `>=4.2.0 <5` range |
| Plugin `undici` / plugin `vitest` | 6.29.1 / 3.2.6 |
| Client `vite` / client `vitest` | 8.3.6 / 3.2.6 |
| Client `seroval` | one copy, 1.7.10. The lockfile entry `seroval@^1.6.2, seroval@^1.6.7, seroval@^1.7.6, seroval@~1.5.0` resolves to 1.7.10. |

Preconditions:

1. Ports 1340, 1341 and 3005 were all free (`"busy":false` ×3).
2. `npm view @strapi/strapi@5.61.0 version` printed `5.61.0`. `npx @strapi/upgrade --help` lists `to [options] <target>`.
3. The baseline is recorded above.
4. Node is ≥ 22.12 (exit 0).

**Owner DB backup (step 2):** `server/.tmp/data.db.pre-m1-1794192413`, `"integrity": "ok"`. No Strapi was booted on `server/.tmp/data.db`. The only access to it was the kit's read-only online backup, used for this file and for the scratch copy.

### Steps

- **Step 1, check kit:** I extracted `server/.tmp/e8/e8.mjs` verbatim from the spec, and it passes `node --check`. It is gitignored (`git check-ignore` confirms). The scratch admin credentials are in `server/.tmp/e8/admin.json` (mode 0600) and were never printed.
- **Step 3, upgrade:**
  - Dry run: `npx @strapi/upgrade to 5.61.0 --dry --yes` printed `Upgrading from v5.52.1 to v5.61.0` and **listed no codemods**. The dry-run output does not itemise the planned dependency versions; it prints only "(3/4) Upgrading Strapi dependencies...". The spec's "three deps planned at 5.61.0" therefore could not be read from the dry run. The real run confirmed it (3.3 below). None of the step's STOP conditions was hit.
  - Real run: exit 0, `yarn install` in `server/`.
  - `git diff --stat -- server/` listed only `server/package.json` and `server/yarn.lock`. The three `@strapi/*` dependencies read `5.61.0`, and no other line changed.
- **Steps 4–9 and 11:** applied as written in the spec. Steps 4–6 and 8–9 are file contents copied verbatim from the spec. Step 7 is three edits to `client/package.json`. Step 11's comment replacements match the spec text exactly, and `grep -rn "zod 3" server/src/plugins/yt-kb/server/src` finds nothing.
- **Step 10, generated types:** Strapi rewrote `server/types/generated/components.d.ts` and `contentTypes.d.ts` on the first 5.61.0 boot (new mtime), but the content is byte-identical. Git shows no change, so there is nothing to commit for step 10.

### Verify results

| # | Check | Result | What it proved / did not prove |
|---|---|---|---|
| 1 | Installed versions | exit 0, `zodForUtils` 4.4.3. Both lockfiles pass `--frozen-lockfile` (client and plugin, exit 0). `git diff --name-only -- client/yarn.lock` lists `client/yarn.lock`. | Proves the resolved versions in `node_modules` and that the lockfiles match their `package.json`s. It does not prove that the advisories are actually fixed in those versions. That is taken from the spec. |
| 2 | seroval ≥ 1.6.8 | exit 0, `versions: ["1.7.10"]`, `low: []` | Proves that only one `seroval` is in the tree. Not checked: the `seroval-plugins` copies that remain at 1.5.2, 1.6.2 and 1.7.6 (`client/yarn.lock`). The spec does not cover them, and I did not compare them against advisories. |
| 3 | Plugin static gates | `test:ts:back` exit 0. `yarn plugin:build` exit 0, and `dist/server/index.js` resolves. `verify` exit 0 ("Verified package.json", exports check passed). Plugin tests: `{"passed":3,"failed":0}`. Negative test: `{"failed":1}` with the mutation applied; the file was restored and `git diff --exit-code` returned 0. | Proves the plugin typechecks, builds, verifies and tests on 5.61.0 + zod 4.4.3, and that the moved guard catches the ordering bug. The guard reads source text only, so it does not prove runtime behaviour. |
| 4 | Boot on a scratch copy | Backup `integrity: ok`, `admin:create-user` exit 0, `/_health` → 204 on 127.0.0.1:1341 (`DATABASE_FILENAME=.tmp/e8-m1.db`) | Proves that 5.61.0 boots with the plugin on a copy of real data. |
| 5 | Tokens | `ok: true`, `grantedActions` = `["plugin::yt-kb.maintenance","plugin::yt-kb.read","plugin::yt-kb.write"]` | Proves the 5.61 admin login, api-tokens and admin-tokens endpoints still match the kit's 5.52.1 shape, and that the three plugin actions register. |
| 6 | MCP tools | `missing: []`, `toolCount: 22`, protocol `2025-06-18`. `libraryStats` returned `mcpVideos` 195 = `dbVideos` 195. Negative tests: no token → `step: initialize`, HTTP 401, exit 1; the Content API (`rest`) token → the same. | All 21 yt-kb tools are listed and one executes end to end with zod 4.4.3. **The 22nd tool is `log`, Strapi core's own built-in MCP tool** (`@strapi/core/dist/services/mcp/tools/log.js`). It is not a yt-kb tool. I did not check whether it was already present on 5.52.1. Only `libraryStats` was called; the other 20 were listed but not executed. |
| 7 | Components | GET with `populate[sections]` → 200, `sections: 3`. Anonymous GET → 403 `ForbiddenError`. | Proves that the `strapi.get('components').add` path still works on 5.61 and that Public has no grants. |
| 8 | Data survived the first boot | `same: true`. `newInternalMigrations: ["upload::unsign-richtext-and-blocks-urls"]`. | Row counts on every yt-kb table, plus tag names and slugs, are unchanged. **The owner's `data.db` runs internal migration `upload::unsign-richtext-and-blocks-urls` at its next boot.** The check did not compare column contents beyond the counts and the tag slugs. |
| 9 | seroval boundary e2e | Playwright against the client on :3005 (`STRAPI_URL=http://127.0.0.1:1341`): `expected: 4, unexpected: 0, flaky: 0, skipped: 0`. The client log has no reference to `1340` and no `fetch failed` / `ECONNREFUSED`. | Proves that `/feed`, the semantic feed, `/learn` and `/search` serialise across the server→client boundary with seroval 1.7.10 + vite 8.3.6. The semantic feed used the owner's running Ollama for query embeddings; it was not stubbed. The Playwright Chromium was already installed, so nothing was downloaded. |
| 10 | Stop scratch processes | Killed the listeners on 1341 and 3005 (both started in this step). Afterwards 1340, 1341 and 3005 are all free, and no `strapi develop` or `vite dev` process remains. | — |
| 11 | Client / server gates | Client `tsc --noEmit` exit 0, client build exit 0, server `tsc --noEmit` exit 0. Client suite `{"total":318,"failed":0}` = 321 − 3. `yarn site:test` exit 0, 107 tests (= baseline). | **New client total for M8: 318.** |
| 12 | CI on a fresh clone | run after the commit; see "Verify 12" below | — |

Scratch DB `server/.tmp/e8-m1.db*` was removed after Verify 11 (`rm -f server/.tmp/e8-m1*.db*`). Kit outputs are in `server/.tmp/e8/m1-*` (not committed).

### Verify 12

I ran this on a fresh `git clone` of the M1 commit `52ce941`, in `$TMPDIR/yt-kb-e8-clone`. The command sequence is exactly the spec's.

- **Result:** `{"ciExit":0}`.
  - Plugin tests: 3/3 passed.
  - Client suite: 318/318 passed (36 files).
  - Site suite: 107/107 passed.
  - Client build: exit 0.
- **`setup:plugin` on the same clone:** I deleted the plugin's `node_modules` and `dist`, then ran `yarn setup:plugin`. Result: `{"setupBuildsPlugin":true}`.
- **Cleanup:** the clone was removed afterwards.

What it proved: everything CI runs passes on a clean checkout of `52ce941`. That covers `install:all` with all five frozen lockfiles, the three typechecks, the plugin's build, verify and test, the site sync and typecheck, both test suites, and the client build. `setup:plugin` alone rebuilds a bootable plugin `dist/`.

What it did not prove:

- That GitHub Actions passes. This was run locally on Node 24.16.0 and macOS. CI uses Node 22 on ubuntu-latest.
- The clone's client suite ran with the owner's Ollama up on 127.0.0.1:11434, and Strapi was down.

Afterwards this log was amended into the M1 commit, which changed its hash. Only this file changed in the amend; the code tree is identical to the one the clone tested.

### Stubs and mocks

None. Every check ran against a real Strapi 5.61.0 on a scratch copy of the owner's data. The e2e used the real client dev server and the owner's already-running Ollama. The plugin's three tests are source-reading guards: they do not boot Strapi and stub nothing.

### Pre-existing problems found (not fixed)

- CLAUDE.md's client test count (319) is stale. The measured baseline is 321. M8 rewrites these counts anyway.
- The `yarn install` in `server/` reports unmet peer dependencies: `@strapi/admin@^5.0.0` for `@strapi/plugin-cloud` and `@strapi/plugin-users-permissions`, `koa` for `@strapi/email`, `esbuild` for `esbuild-register`, plus codemirror peers. Some of these may predate the upgrade; I did not compare against a 5.52.1 install.
- The client keeps `seroval-plugins` 1.5.2 and 1.6.2 (via `solid-js` and others) next to the single `seroval` 1.7.10. This is outside the spec; I did not check it against advisories.
- Strapi 5.61.0 boots with two new notices: "The Media Library has been redesigned and is now the default" (`useLegacyMediaLibrary` in `config/features`), and an advisory about the `sendmail` email provider. Both are informational; I changed nothing.

### Spec discrepancies

- **Commit message.** The spec's header says to commit "with the milestone title as the message". M1's **Commit** bullet gives a different string: `M1: Strapi 5.61.0, pinned undici/vite/vitest/seroval, plugin in setup, CI and tests`. The implementing agent's instructions say to use the `### M1 — …` title text, so the commit's first line is `M1 — Platform: Strapi 5.61.0, pinned dependencies, the plugin in setup, CI and tests`.
- **Commit file list.** M1's **Commit** bullet does not list this log. It is included in the M1 commit, as instructed.
- **Generated types.** The commit list includes `server/types/generated/*` and step 10 says "commit whatever the boot writes". The boot changed no content, so there was nothing to stage. This is not an error; there was simply nothing to commit.
- **Dry-run output.** Step 3.1 expects the dry run to show the three dependencies "planned at 5.61.0". The 5.61.0 dry-run output does not itemise them. The real run's `package.json` diff confirmed them instead. No STOP condition applied.

## M2

**Milestone:** M2 — Data model and integrity: unique keys, wider columns, new transcript attributes, race-safe writes. Started from HEAD `f9e2347` (M1), clean working tree. Ports 1340, 1341 and 3005 were free before the checks and after them. As with M1, the commit hash is reported in the hand-off, not written here.

### Steps

- **Step 0, facts on 5.61.0:** `@strapi/database` is 5.61.0. The dialect grep shows only `case 19` (SQLite) and `case '23502'` (Postgres). `database/dist/errors/` holds `database`, `index`, `invalid-date`, `invalid-datetime`, `invalid-relation`, `invalid-time` and `not-null`. `This attribute must be unique` occurs once in `validators.js`. `databaseErrorsToTransform` lists the four time/date/relation errors. `notNestedTransaction` and `forceMigration: true` are both present. `getUniqueIndexName(['yt_kb_tags','slug'])` returns `"yt_kb_tags_slug_uq"`. Every fact matches the spec, so no STOP condition applied.
- **Step 1, pre-step:** `dupcheck server/.tmp/data.db` (the kit opens it read-only) → `{"duplicates": []}`, exit 0. **Owner DB backup:** `server/.tmp/data.db.pre-m2-1794193565`, `"integrity": "ok"`. No Strapi was booted on `server/.tmp/data.db`. Note that an older, unrelated `server/.tmp/data.db.pre-m2-1793939987` (5 Nov, from an earlier run) is also in that folder. A rollback must restore `…-1794193565`.
- **Steps 2–16, 17, 18, 18a:** the code blocks were copied verbatim from the spec. A script extracted each fenced block by line number and dedented it, and every splice asserted its anchor lines first. Step 8's grep (`trim().toLowerCase()` under `mcp/tools/`) prints nothing at all.
- **Step 19:** the first boot on the new schema rewrote `server/types/generated/contentTypes.d.ts` with the transcript's eight new attributes and `title`/`author`/`videoAuthor` as `Text`. That file is committed.

### Verify results

| # | Check | Result | What it proved / did not prove |
|---|---|---|---|
| 1 | Facts on 5.61.0 | as in step 0 | Proves that the error shapes, index naming and transaction nesting that `isUniqueViolation` and the checks rely on are unchanged on 5.61.0. |
| 2 | Gates | `test:ts:back` 0, `yarn plugin:build` 0, `verify` 0, client `tsc --noEmit` 0, client build 0 (server `tsc --noEmit` 0 too). Plugin tests `{"passed":28,"failed":0}`. Client suite `{"total":326,"passed":324,"failed":0,"pending":2}` = M1's 318 + 8, with pending = M1's 0 + 2. | Proves that all five new test files run and pass and that nothing typechecks or builds worse. The plugin tests stub Strapi entirely, except db-errors' real in-memory better-sqlite3. |
| 3 | Schema sync on a copy | dupcheck `[]`; `/_health` 204; `{"tables":true,"tagSlugs":true}`; `{"uniqueIndexes":5,"retypedToText":true,"newColumns":true}`. Extra (not in spec): SHA-256 of `video_author`, transcript `title`/`author` and `yt_kb_videos_tags_lnk`, compared between `data.db` (read-only) and the synced copy → all equal. | Proves the five indexes are created over real data, the SQLite table rebuilds keep every row, link and component count and every retyped value, and the eight new columns exist. Does not prove anything for Postgres. The copy also ran internal migration `upload::unsign-richtext-and-blocks-urls`, as M1 found. |
| 4 | DB enforces uniqueness on its own | five `SQLITE_CONSTRAINT_UNIQUE`, `controlOk: true`; afterwards 0 `e8raw*` rows | Proves each index rejects a duplicate without Strapi, and that `trysql` rolled back. |
| 5 | Tokens | `ok: true`, the three `plugin::yt-kb.*` actions granted | — |
| 6 | REST races, 5 at once | all four `true`; statuses `[201,400,400,400,400]` each; counts `{"v":1,"t":1,"g":1,"d":1}`; no 5xx in the Strapi log (status tally 200/201/400 only). Losers: video/transcript `A … already exists. documentId=…`, tag/digest `This attribute must be unique`. | Proves one row per key and 400 for every loser, never 500, and never `2 errors occurred`. **Did not prove live** that a raw unique-index error is rethrown as the 400. On SQLite (pool `max 1`) the five writes are serialised, so every loser was stopped by the create rule or the validator, not by the index. That path is covered only by `document-rules.test.ts` (unit) plus Verify 4 (the index itself). |
| 7 | Slugs (M-12) | `[[201,"e8 c++","e8-c"],[201,"e8 c#","e8-c-2"],[201,"日本語","tag"],[201,"中文","tag-2"]]`; the spaced repeat → 400 `This attribute must be unique` | Proves that a taken slug gets a suffix and that names are normalised (collapsed spaces, lower case) before the unique check. |
| 8 | MCP tagVideo/untagVideo | exit 0: first `tagsAdded ["e8 mcp c++","e8 mcp c#"]`, `totalTags` 3; second call `[]`, 3; untag removed `["e8 mcp c++"]`, remaining 2; slugs `e8-mcp-c`, `e8-mcp-c-2`. Tool list `missing: []`, `toolCount` 22 (21 yt-kb + core `log`, as in M1). | Proves normalisation, suffixing and idempotence through the real MCP path with `strapi.db.transaction`. It does not observe the transaction boundary itself; `writes.test.ts` checks that against a fake. |
| 9 | Not run (spec) | `addVideo`/`fetchTranscript` (YouTube) and the `shareVideo`/`saveDigest` handlers were not driven. | As the spec says (OQ-2). |
| 10 | Live services | `{"passed":2,"failed":0,"skipped":0}`; counts `{"v":1,"g":1,"d":1}` → `true`; negative run without the variables `{"passed":0,"skipped":2}`. Strapi on 1341 stopped; 1340/1341/3005 free; no `strapi develop` process left. | Proves `createVideoService` (5 concurrent shares → 1 created + 4 `exists`, one documentId) and `upsertDigestService` (5 concurrent saves → 5 ok, 1 created, one documentId) through the real `strapiFetch`. |

Scratch DB `server/.tmp/e8-m2.db*` was removed after Verify 10. Kit outputs are in `server/.tmp/e8/m2-*` (not committed).

### Stubs and mocks

- Plugin tests: `document-rules.test.ts`, `services/tags.test.ts` and `mcp/tools/writes.test.ts` use hand-written fake `strapi` objects (`writes.test.ts` stubs the fetcher, so no YouTube). `db-errors.test.ts` uses a real in-memory better-sqlite3.
- Client `unique-recovery.test.ts` mocks `fetch` at the HTTP boundary. `unique-recovery.live.test.ts` mocks nothing.
- Every Verify step from 3 on ran against a real Strapi 5.61.0 on a scratch copy of the owner's data.
- **Environment beyond the spec's commands:** `admin:create-user` and `yarn develop` were started with `PROXY_URL=http://127.0.0.1:9` (per the implementing agent's instructions) and also `TRANSCRIPT_PROXY_URL=http://127.0.0.1:9`, which the M2-era fetcher reads. Nothing in M2's checks fetches from YouTube; the dead proxies only guarantee that nothing could.

### Pre-existing problems found (not fixed)

- `yt_kb_videos_transcript_lnk` has 194 rows for 195 videos and 195 transcripts, so one video has no transcript link. The count is unchanged by M2.
- `mcp/tools/add-video.ts`: the header comment (lines 5–7, "this tool surfaces the resulting error") and the tool description ("Ingesting a video that already exists throws a duplicate-key error") are stale. The tool returns `action: 'exists'` both on the pre-check and now on a race. The spec leaves both unchanged; `docs/mcp.md` is M8's.
- `client/src/lib/services/digests.ts` line 1 still says `api::digest.digest`. The tag schema's description says "Free-form tag on a Post".

### Spec discrepancies

- **Commit message:** the **Commit** bullet gives `M2: unique keys in the database, text columns, transcript attributes, race-safe writes`. As instructed, the commit's first line is the `### M2 — …` title instead. The bullet also does not list this log; it is included as instructed.
- **Step 9 wording:** the literal replacement leaves `tag-utils.ts` reading "…applies this function, then freeTagSlug adds -2, -3, … when the slug is taken, to / every tag create that arrives without a slug…". The grammar is awkward, but I applied it as written. It is a comment, so behaviour is unaffected.
- **Verify 3 order:** `strapi admin:create-user` loads Strapi, so it runs the schema sync, before `yarn develop` does. The comparison is still valid because `counts-before` is taken before `create-user`. But the "first boot on the new schema" is `create-user`, not `develop`.

## M3

**Milestone:** M3 — Fetcher parity and REST routes. Started from HEAD `acf9dd6` (M2), clean working tree. Ports 1340, 1341 and 3005 were free before the checks and after them. As with M1 and M2, the commit hash is reported in the hand-off, not written here.

### Pre-check on 5.61.0

All four facts hold on the installed 5.61.0:

- A plugin's admin routers get the `/<pluginName>` prefix (`@strapi/core/dist/services/server/register-routes.js`, now around lines 76–86).
- `admin-token.js` is registered for the `admin` auth scope (`@strapi/admin/dist/server/server/src/register.js:22`).
- `hasPermissions` reads `ctx.state.userAbility` (`policies/hasPermissions.js:37`).
- `config.default` may be a function, called with `{ env }` (`@strapi/core/dist/loaders/plugins/index.js`, `applyUserConfig`).
- `/_health` is routed (`services/server/index.js:37`) and answered 204 (Verify 3).

No STOP condition applied.

### Steps

- **Steps 1–7 and 10, the whole-file code blocks:** a script copied them verbatim from the spec, taking each fenced block from a given line number to its closing fence and dedenting it. The files are:
  - `PSRC/services/fetch-errors.ts`
  - `services/youtube-transcript.ts`
  - `services/fetcher.ts`
  - `services/metadata-backfill.ts`
  - `bootstrap.ts`
  - `index.ts`
  - `controllers/fetcher.ts`
  - `mcp/tools/fetch-transcript.ts`
- **Step 5, one approved change:** `bootstrap.ts` line 15 is `if (result.success === true) {` instead of `if (result.success) {`. See "Spec discrepancies".
- **Steps 8, 9, 11 and 13–15, the edits:** each splice asserted its anchor first. In step 14 the spec's block (the reason type, the reason set, the new doc comment and the function) replaced everything from the old doc comment to the end of the function. The `TranscriptFetchAction` line was kept.
- **Step 12, the plugin tests:** I wrote these from the spec's tables. 12a's preamble is verbatim.
  - `services/fetcher.test.ts`: 11 tests, the 10 table cases plus `maskProxyUrl`.
  - `controllers/fetcher.test.ts`: 12 tests. The six reasons are an `it.each`.
  - `bootstrap.test.ts`: 4 tests.
  - `services/metadata-backfill.test.ts`: 2 tests.
  - `mcp/tools/fetch-transcript.test.ts`: 4 tests.
- **Steps 16 and 17, the client tests:** step 16 edits the existing case and appends the spec's verbatim `describe` (4 tests). Step 17 adds 4 tests to `videos.test.ts` and 1 to `strapi-client.test.ts`, the last inside the existing `describe('strapiFetch')`.
- **Step 18, the proxy variable:**
  - `server/.env.example`'s last block was replaced verbatim.
  - The one-line replacements went into `client/.env.example`, `CLAUDE.md`, `docs/architecture.md` and `docs/operations.md`.
  - No `.env` file was opened. **Owner step:** if `server/.env` has a value for `TRANSCRIPT_PROXY_URL`, rename that key to `PROXY_URL` and keep the value. Nothing reads the old name any more.
- **Generated types:** the boot changed nothing in `server/types/generated/` (M3 has no schema change).

### Verify results

| # | Check | Result | What it proved / did not prove |
|---|---|---|---|
| 0 | Ports | 1340, 1341 and 3005 all `"busy":false` | — |
| 1 | Gates | Plugin vitest `{"passed":61,"failed":0,"missing":[]}`, so all 10 named files ran and passed (61 > 28, written to `server/.tmp/e8/plugin-passed-m3.txt`). `test:ts:back` 0, plugin build 0, client `tsc --noEmit` 0, server `tsc --noEmit` 0. Client suite `{"total":335,"passed":333,"failed":0,"pending":2}` = 326 + 9. `git grep -n TRANSCRIPT_PROXY_URL -- . ':!docs/designs'` printed nothing (exit 1). | Proves the new code typechecks, builds and passes its unit tests. The plugin tests stub YouTube and undici entirely (see "Stubs and mocks"). The client suite was run as `npx vitest run --reporter=json` in `client/`, which is what `yarn test` runs. Ollama was up (the owner's process) and the owner's Strapi was down. |
| 2 | Kit | `token`, `mcpx`, `tokenOf` and the new `race` were spliced in verbatim. `node --check` passes. With no command, the kit exits 1 and lists `token` and `mcpx`. | — |
| 3 | Scratch Strapi | backup `integrity: ok`; `create-user` 0; `/_health` 204; `grantedActions` = `["plugin::yt-kb.maintenance","plugin::yt-kb.tool.fetch-transcript"]`; tokens `app`, `noscope` and `admread` each `ok: true`, with the granted scopes as requested; both fixture POSTs 201 | Proves the new admin action registers and can be granted, and that the new content-API scope `plugin::yt-kb.fetcher.getOrFetch` exists. |
| 4 | Boot log | `Proxy configured: http://127.0.0.1:9` ×1, `Proxy connection FAILED` ×1, `registered 4 MCP admin permission` ×1 | Proves the `proxyUrl` default comes from `PROXY_URL` and the boot check runs without blocking boot. `strapi admin:create-user` also runs bootstrap: its own log, `m3-create-user.log`, shows the same failed proxy check. |
| 5 | REST, content API | all 16 checks passed: by id; by `watch?v=…&t=10s`, `youtu.be` and `live` URLs; `fetching m3StoredAAA` count 0; invalid id 400 `invalid_id`, logged once; missing id 502 `network`, logged once; anonymous 403; token without the scope 403; POST skipped, bad id 400 `invalid_id`, `force:"yes"` 400 (not a TranscriptFetchError), `force:true` 502 `network`; the stored row is untouched (`de`, `M3 stored`) | Proves the route, the URL parsing, the status mapping and the single log line against real Strapi. It only exercised `network` and `invalid_id`; the other four reasons are covered by the unit tests alone. |
| 6 | Admin route | `mcp` token 200; `admread` 403; no token 401 | Proves `admin::hasPermissions` gates the route with `plugin::yt-kb.tool.fetch-transcript` for an admin API token. An admin browser session was not tried. |
| 7 | MCP | `fetchTranscript`'s inputSchema has no `proxyUrl`; the call for `m3MissingAA` returns `structuredContent.reason == "network"` with `isError` false; `videoId:"bad"` is rejected (`rpcError` or `isError`). The tool list for the `mcp` token: `log`, `addVideo`, `fetchTranscript`. | Proves the tool returns the reason as a result. `addVideo` was listed but not called. |
| 8 | Through the app | `/learn/m3PendingAA` 200; `summaryStatus` became `failed` within about 2 s; fetch-failed log lines N=5 → 8 (N+3); `Generation failed` appears once in the rendered HTML | Proves the app retries the plugin's `network` reason three times and shows the failed state. **Tool note:** in this agent's shell, `grep` is a wrapper function. It prints nothing for this HTML because the page contains NUL bytes (TanStack Router's serialized match ids use `\u0000` separators). `/usr/bin/grep -c 'Generation failed'` on the same `curl` output prints `1`, and a Node count agrees. The spec's command is correct; only the agent's wrapper differed. The app's one oEmbed request for `m3PendingAA` went to youtube.com, as the spec discloses; nothing else did. |
| 9 | Clean up | killed the listeners on 1341 and 3005 (both started here); `rm -f server/.tmp/e8-m3.db*`; 1340, 1341 and 3005 free; no `strapi develop` or `vite dev` left | — |

Kit outputs are in `server/.tmp/e8/m3-*` (not committed). The kit's pre-M3 copy is `server/.tmp/e8/e8.mjs.pre-m3`.

### Stubs and mocks

- **Plugin tests:**
  - `youtubei.js` is mocked with `vi.mock`.
  - Caption and oEmbed requests go to a stubbed global `fetch`.
  - `undici` is mocked in `bootstrap.test.ts`.
  - `fetchYouTubeMetadata` is mocked in `metadata-backfill.test.ts`.
  - Strapi, `ctx` and the fetcher service are hand-written fakes.
  - Nothing touches the network.
- **Client tests:** `fetch` is mocked at the HTTP boundary (`videos.test.ts`, `strapi-client.test.ts`). The `./videos` services are mocked in `learning.persistence.test.ts`.
- **Verify 3–8:** these ran against a real Strapi 5.61.0 on a scratch copy of the owner's data, with `PROXY_URL=http://127.0.0.1:9`. The instructions also asked for `TRANSCRIPT_PROXY_URL=http://127.0.0.1:9`, so I set it as well; the M3 code no longer reads it.

### Pre-existing problems found (not fixed)

- **Duplicated failure message:** Strapi's console log prints the failure message twice, for example `transcript fetch failed: m3PendingAA (network): Could not reach YouTube: fetch failed Could not reach YouTube: fetch failed`. The spec's comment in `fetcher.ts` says the default console format prints only the message. On 5.61.0 it also appends the meta object's `message` field. The output is cosmetic and every check still passes. This is new behaviour from M3's code, not pre-existing, but I did not change it because the spec fixes the text.
- **Stale `add-video.ts` text:** its header comment and description still mention a duplicate-key error (as already noted for M2).

### Spec discrepancies

- **Step 5, `bootstrap.ts`: the spec's code did not typecheck.** The verbatim `if (result.success) { … } else { …result.error… }` fails `test:ts:back` with `TS2339: Property 'error' does not exist on type '{ success: true; ip: string; } | { success: false; error: string; }'`. The plugin's tsconfig extends `@strapi/typescript-utils/tsconfigs/server`, which sets `"strict": false`. Without `strictNullChecks`, a truthiness check does not narrow a union on a boolean discriminant. A scratch compile under the same base config showed that `=== true`, `=== false` and `'error' in` all narrow. I stopped and asked. **Ruling:** explicit `=== true` comparison. The plugin's strict:false tsconfig doesn't narrow a boolean discriminant on truthiness; behaviour is identical. Applied at `bootstrap.ts` line 15. The tsc error itself was reported at line 18, where `result.error` is used. No other occurrence of the pattern exists in M3's plugin code; afterwards `test:ts:back` is clean.
- **Commit message:** as instructed, the first line is the `### M3 — …` title. The spec's milestone has no separate **Commit** bullet.
- **Verify 8's text check:** the spec's command is correct. It only failed under this agent's `grep` wrapper (see Verify 8).

## M4

**R-E8-2 (before M4, its own commit `fix(plugin): don't repeat the message in yt-kb log meta`):** a yt-kb log line's meta object never contains a `message` key.
- `fetcher.ts`'s fail line keeps `{ videoId, reason }`, and its comment is updated.
- `bootstrap.ts`'s backfill warn is called with the text only.
- `fetcher.test.ts` asserts `not.toHaveProperty('message')` once.
- Result: plugin 61/61, `test:ts:back` 0.
- M4's new warn in `services/search-index.ts` follows the rule: its meta is `{ documentId }`, not the spec's `{ documentId, message }`.

**Milestone:** M4 — Search ownership and grounding. Started from HEAD `e5321b3` (R-E8-2 on top of M3), clean working tree. Ports 1340, 1341 and 3005 were free before the checks and after them. The first run stopped at Verify 3 (R-E8-3 below); it resumed after the ruling. As with M1–M3, the commit hash is reported in the hand-off.

### Steps

- **Steps 1–11 and 13's fixture:** a script copied every fenced block verbatim from the spec. It took each block from a given line number to its closing fence and dedented it, asserting every anchor first. The moved `transcript.ts` ranges were checked line by line against the table (the file is unchanged since 721f210). The three `export` additions were applied. `save-summary.ts` takes the schema from 721f210 lines 31–66.
- **Changes from the spec text (rulings):**
  - `search-index.ts`'s warn meta drops `message` (R-E8-2).
  - R-E8-3 changed how steps 9–11 load the private `searchIndex`; see "R-E8-3" below.
- **Step 12, `CLAUDE.md`:** both edits applied. The new paragraph is asserted equal to the spec's text.
- **Step 13, tests:**
  - 13a `services/search-index.test.ts`: 11 tests. These are the spec's 8 plus 3 for R-E8-3's loaders: single `findOne`; batched `findMany` with segments only for the rows that need a build, after which `ensure…` reads nothing more; no query for no ids.
  - 13b `mcp/tools/search-tools.test.ts`: 8 tests. The spec's cases, plus "a current stored transcript index is used without rebuilding". The fake's transcript `findOne`/`findFirst`/`findMany` return only the requested fields.
    - Every case asserts that no video query's `populate` contains `searchIndex`. A mutation check (putting `searchIndex` back into cross-search's populate) fails 1 of 8.
    - The cross-search case asserts there is no per-video `findOne`, and exactly two transcript `findMany` calls: indexes (`$in` of the two videos without an app index, `limit: 2`), then segments.
  - 13c `mcp/tools/save-summary.test.ts`: 3 tests. The spec's cases, plus: the populate has no `searchIndex`, and the index is read with `findOne({ documentId: 't2', fields: ['searchIndex', 'durationSec'] })`.
  - 13d: `fetcher.test.ts`'s success case takes `searchIndex` out of its exact `toEqual` and asserts it is current with chunks.
  - `tsconfig.build.json` excludes `**/__fixtures__/**`, and `dist/` has no fixture.
- **Step 14:** the first boot rewrote `server/types/generated/contentTypes.d.ts` (`searchIndex: Schema.Attribute.JSON & Schema.Attribute.Private`). That is its only change, and it is committed.

### R-E8-3: the private `searchIndex` is never named inside a populate

- **The problem (first run, Verify 3):** every `searchTranscript` and `crossSearchTranscripts` call returned `isError: true`, `Invalid key searchIndex`.
- **Cause, in Strapi 5.61.0:**
  - `@strapi/core/dist/services/document-service/repository.js` `validateParams` checks root `fields` with `['scalarAttributes']` only.
  - It passes populate includes as `{ sort, field, filters, populate }`, with the key `field`.
  - `@strapi/utils/dist/validate/validators.js` `validatePopulate` reads `includes?.fields || FIELDS_TRAVERSALS`, which is `['scalarAttributes','privateFields','passwordFields']`.
  - So a `fields` list inside a populate is checked with `throwPrivate`, and a root one is not.
- **Probe:** a script called those validators with yt-kb's schemas and the Document Service's includes:
  - root `fields: ['title','searchIndex']` → ok;
  - `populate: { transcript: { fields: ['searchIndex','durationSec'] } }` → `Invalid key searchIndex`;
  - the same with `private` removed → ok;
  - `populate: { transcript: true }` → ok.
- **Ruling R-E8-3, option (B), batched:** keep step 5's `"private": true`, and never name `searchIndex` inside a populate. Applied:
  - `services/search-index.ts` gains:
    - `loadTranscriptSearchIndex(strapi, documentId)`: one root-level `findOne` with `fields: ['searchIndex', 'durationSec']`.
    - `loadTranscriptSearchIndexes(strapi, ids)`: one root-level `findMany({ filters: { documentId: { $in } }, fields: ['documentId','searchIndex','durationSec'], limit })`. Then, only for rows whose index is missing or stale, one more `findMany` for `rawSegments`/`durationSec`; a missing row's `rawSegments` is set to `null`, so `ensure…` never reads per row.
    - A header paragraph saying why.
  - `search-transcript.ts`: the video's populate uses `POPULATED_TRANSCRIPT_FIELDS = ['documentId','title','rawSegments','durationSec']`, then `loadTranscriptSearchIndex` for the linked transcript. The no-Video fallback stays a root-level `findFirst` with `TRANSCRIPT_FIELDS`, which is allowed.
  - `save-summary.ts`: populate `fields: ['documentId','durationSec']`, then `loadTranscriptSearchIndex`. The no-link fallback stays root-level.
  - `cross-search-transcripts.ts`: populate `transcript: { fields: ['documentId'] }`, then one `loadTranscriptSearchIndexes` call for the videos without a current app index. So it adds one query in total, two when some need a build.
  - `git grep searchIndex` in the plugin's tools: no populate names it.

### Verify results

| # | Check | Result | What it proved / did not prove |
|---|---|---|---|
| 1 | Gates (re-run after R-E8-3) | `sync:bm25 --check` 0, `up to date`. The client copy's line 1 is the banner; the plugin source has 0. `CURRENT_INDEX_PARAMS` = `{150,20,2}`. Plugin `{"passed":83,"failed":0,"floor":61,"missing":[]}`, written to `plugin-passed-m4.txt` (83). `test:ts:back` 0, plugin build 0, client and server `tsc --noEmit` 0. Client `{"total":335,"passed":333,"failed":0,"pending":2}`, the same as M3. `yarn test` 0. Drift: sync test `exit=1`, `--check` 1, restore, `git diff --exit-code` 0, `--check` 0. | Proves the move, the copy direction (plugin → client), the unchanged index params, and the unit behaviour. The plugin's fakes do not run Strapi's query validation; Verify 3 covers that live. |
| 2 | Scratch fixtures | builds 0. Fresh `e8-m4.db`. `create-user` 0. The fixture script exits 0 and prints `{"ok":true}`. `/_health` 204. `admin-tokens` ok (read, write). `token app` ok (`plugin::yt-kb.transcript.find`). | Fixture check parsed with `jq -R 'fromjson?'` (see "Spec discrepancies"). |
| 3 | Search order via MCP | all 12 spec checks pass. contextual first (240, no transcript index built); lazy build on the pending video (v2, t2, 16 chunks); built once (`updated_at` unchanged on the second search); plain index (`zebracontext` → `[]`); stale not trusted and rebuilt (t2); transcript with no Video (`title` from the transcript); no transcript → `No searchable transcript`; cross search `videosScanned` 4, with Ctx `bm25` and Lazy and Stale `bm25-transcript`, no NoTrans. **R-E8-3 REST check:** `GET /api/yt-kb/transcripts?pagination[pageSize]=1` with the `app` token → 200, one row, `rawSegments` present, **no `searchIndex`**. The Strapi log has no `Invalid key` and no tool error. | Proves the search order, the lazy write and the batched reads against real Strapi 5.61 query validation, and that private keeps the index out of the content API. |
| 4 | Grounding via `saveSummary` | `sectionsWithTimecode` 2. `getVideo` sections `[240,120,null]`, so the caller's 999 was not stored. NoTrans → 0. `GET …?filters[youtubeVideoId][$eq]=m4LazyVid01` (`app`) → no `searchIndex`, 8 `rawSegments`. 1341 stopped and free. | Proves grounding with the app's query, function and threshold through the real MCP path. |
| 5 | Copy of real data | backup `integrity: ok`, B4 = 190. `create-user` 0, `/_health` 204, tokens ok. A real app index is still `bm25`. Cross search (100 newest) has no error: 100 scanned, 58 hits, all `bm25`. Built indexes not current: 0. B4 again 190. | **The spec's checks did not exercise the lazy write on real data:** the 100 newest videos all have current app indexes, so nothing was built, and "every built index is current" held with nothing built. **Extra check (not in spec):** `searchTranscript` on `gvZIUEL6Ruc`, one of the 4 real videos with a transcript but no app index → `bm25-transcript`, one result. The row's `search_index` became version 2, tokenizer 2, 59 chunks ("built transcript search index … (59 chunks)" logged once). Not-current count still 0, B4 still 190. |
| — | Clean up | 1341 killed (started here). `server/.tmp/e8-m4.db` and `e8-m4-real.db` removed, plus 17 `server/.tmp/e8/m4-*` files. 1340, 1341 and 3005 free; no `strapi develop` left. `plugin-passed-m4.txt` kept for M5. | — |

### Stubs and mocks

- **Plugin tests:** hand-written fake Strapis.
  - `documents(uid)` → `vi.fn`s.
  - In 13b and 13c, the transcript reads come from a store and return only the requested fields.
  - None of them run Strapi's query validation; the populate guard assertions stand in for it.
  - The fetcher test mocks `youtubei.js` and `fetch` (M3's setup).
- **Verify 2–5:** real Strapi 5.61.0 with `PROXY_URL=http://127.0.0.1:9`. Verify 2–4 used a fresh scratch DB. Verify 5 used an online-backup copy of `data.db`, and nothing was booted on `data.db`.

### Pre-existing problems found (not fixed)

- **Strapi 5.61.0 query validation:** the populate check reads `includes.fields`, but the Document Service passes the key `field` (above). Private attributes are refused inside a populate's `fields` but accepted at the root. This looks like an upstream inconsistency; I did not look for an issue.
- **Real data:** `test-smoke-001` is a Video with no transcript and no app index. Possibly a test leftover in the owner's library.

### Spec discrepancies

- **R-E8-3 (spec error):** steps 5 and 9–11 together are impossible on 5.61.0. Strapi rejects the private `searchIndex` inside a populate's `fields` (probe above). Ruled option (B), batched, as applied above, plus a live REST check in Verify 3.
- **Verify 2 (spec error):** `… m4-fixtures.mjs) | jq -e '.ok == true'` cannot parse the output, because `createStrapi().load()` also logs to stdout. I parsed the same stdout with `jq -R 'fromjson? | select(type=="object" and has("ok"))' | jq -s -e 'length==1 and .[0].ok==true'` → true.
- **Verify 1 drift check (spec error):** `git diff --exit-code client/src/lib/services/bm25-core.ts` compares against the index, and the regenerated copy is new in M4. Run before staging, it returns 1 even after a correct restore. I staged the regenerated copy first and then ran the whole drift sequence.
- **13d:** the existing success case's exact `toEqual` must take `searchIndex` out before it can assert on it.
- **Commit message:** the spec's **Commit** bullet says `M4: Search ownership and grounding`. As instructed, the first line is the `### M4 — …` title. The bullet does not list this log; it is included as instructed.
- **Tool note:** in this agent's zsh, `rm -f server/.tmp/e8-m4.db*` aborts when the glob matches nothing (`no matches found`). The DB was then removed with `find … -delete`.

## M5

**Milestone:** M5 — MCP tools, permissions, ai-tools, import gate, permission seeding, token script. Started from HEAD `5a208c3` (M4), clean working tree. Ports 1340, 1341 and 3005 were free before the checks and after them. As with M1–M4, the commit hash is reported in the hand-off, not written here.

### Facts on 5.61.0

I re-opened the files behind Facts 1–6 in the installed 5.61.0, and all of them hold:

- `Permission.js` has the `role` and `apiToken` manyToOne relations.
- `Strapi.js`: `runPluginsLifecycles(BOOTSTRAP)` (line 412) runs before the providers' `bootstrap` (line 414).
- Admin's `bootstrap.js` runs `resetSuperAdminPermissions` (line 168), then `cleanPermissionsInDatabase` (line 170).
- MCP authentication uses `authenticateAdminToken`.
- A duplicate name throws in `McpCapabilityDefinitionRegistry.js:21`. So does a registration after start, in `services/mcp/index.js:48`.
- `tool-registry.js` wraps a throwing handler as `Tool "<name>" execution failed`.
- The `admin-token` strategy is registered (`register.js:22`).
- `api-token-content-api` exists (`services/index.js:42`). Its `create` validates action ids against the content-API action provider, and it exposes `revoke(id)` (`api-token.js:861`, used at `:1180`). That `revoke` deletes the linked admin permissions and then the token row.
- `$startsWith` is supported (`where.js:259`), and SQLite sets `pragma foreign_keys = on`.

Fact 7 (tanstack-ai 1.7.0) is in another repo, and M1 did not change it. Its zod part is covered by `ai-tools.test.ts` and by Verify 4's `aiUsable`. Fact 9 holds on the scratch copy: 6 legacy rows, 3 on `strapi-super-admin` and 3 on `claude-mcp-1782487483515`. There are no `plugin::yt-kb.tool.*` rows. The read-only `yt-kb-site` is there and `yt-kb-app` is not. No STOP condition applied.

### Steps

- **Whole-file blocks:** a script copied every block verbatim from the spec. It took each fenced block from a given line number to its closing fence and dedented it. The files are:
  - `names.ts`, `adapter.ts`, `tools.ts`, `permissions.ts`
  - `services/ai-tools.ts`
  - `permission-seeding/{legacy-grants,users-permissions,index}.ts`
  - `controllers/importer.ts`
  - `scripts/create-tokens.cjs`
  - the 7 test files
- **Edits:** each splice asserted its anchor first. They are:
  - `mcp-official/index.ts`: the loop and its log only. The order `registerMcpAdminPermissions(strapi)` → `toolsEnabled` → `isEnabled()` is unchanged.
  - `mcp/registry.ts`: the `name` doc comment.
  - `services/index.ts`: `'ai-tools': aiTools` after `fetcher`.
  - `bootstrap.ts`: the import, plus `await seedPermissions(strapi)` first.
  - `copy-content.mjs`: the header pair, `postImport` above the batching comment, and `flush` calling `postImport`.
  - `bootstrap.test.ts`: the third `vi.mock`, its import, `mockClear` in `beforeEach`, and one new `it` for the spec's table row. The row checks that `seedPermissions` is called once, with the fake `strapi`, and before the first `log.warn` (by `invocationCallOrder`).
- **Unchanged, as the spec says:** all 21 tool bodies and descriptions, `fetch-transcript.ts`, `PSRC/index.ts`, `register.ts`, `routes/index.ts` (it imports `FETCH_TRANSCRIPT_ACTION`, which is now derived) and `server/config/plugins.ts`. The `mcp/tools/` files and their R-E8-3 root-level `searchIndex` loads were not touched.
- **R-E8-1:** not needed. `test:ts:back` passed on the first run. The `registerTool({...})` literal also typechecks under 5.61's types.
- **R-E8-2, applied in 3 places:**
  - The adapter's two warn lines, `skipped MCP tool …` and `MCP tool failed …`, have the meta `{ name }`, not `{ name, message }`.
  - `seedPermissions`' two warn lines, `legacy MCP grant migration failed` and `could not check Users & Permissions roles`, are called with the text only (their meta was `{ message }` alone).
  - `adapter.test.ts`'s two `toHaveBeenCalledWith` expectations were changed to `{ name: … }` to match.
  - The two info lines keep their meta objects, the migration result `r` and `{ count }`. Neither has a `message` key, and the boot log showed no duplicated text.
- **R-E8-3:** no M5 code names `searchIndex` in a populate. No tool file changed.
- **Generated types:** no schema change, and `server/types/generated/` is unchanged.

### Verify results

| # | Check | Result | What it proved / did not prove |
|---|---|---|---|
| 0 | Ports | 1340, 1341 and 3005 all `"busy":false` | — |
| 1 | Static gates | Plugin `{"passed":114,"failed":0,"floor":83,"missing":[]}` (19 files; the M5 files are names 6, adapter 4, ai-tools 6, legacy-grants 6, users-permissions 3, importer 5, guard 3, and bootstrap 5, one of them new). `test:ts:back` 0, plugin build 0, server `tsc --noEmit` 0. `yarn test` 0: client `{"total":335,"passed":333,"failed":0,"pending":2}`, the same as M4. **Extra:** a mutation that registers `tool.fetch-transcript` twice fails `adapter.test.ts` (25 ≠ 24); the file was restored and the test passes again. `server/.tmp/e8/plugin-passed-m5.txt` = 114 (scratch, for M6, which the spec does not require). | Proves the new code typechecks, builds and passes its unit tests. The tests use hand-written fakes (see "Stubs and mocks"). |
| 2 | Kit | `exec` was spliced in verbatim from the spec, and `node --check` passes. `exec server/.tmp/data.db 'SELECT 1'` → `refusing to write … not a scratch DB`, exit 1. `m5-inspect.cjs` was written verbatim. | Proves the kit cannot write the owner's DB. |
| 3 | Scratch set-up | Script exit 0. Backup `integrity: ok`. Plugin build and `yarn --cwd server build` 0. The token has 3 legacy rows and 0 tool rows. One Public `plugin::yt-kb.video.find` grant was inserted, and the open-role count is 1. `OLDSITE` was recorded, and there are 0 `yt-kb-app` rows. | The owner's `data.db` was read once, by the kit's online backup. Nothing else touched it. |
| 4 | First boots, migration, inspect | The script's checks all pass, but see "Spec discrepancies" for the `jq` parse of `m5-inspect.json`. Inspect: `{"db":"e8-m5.db","toolActions":21,"legacyDisplayNames":[3 × "… (legacy — migrated at boot)"],"aiTools":21,"aiUsable":true,"aiMeta":"YT Knowledge Base"}`. The token has 21 distinct tool actions in 21 rows and 0 legacy rows. Super-admin has 21 tool rows. Public/Authenticated have 0 yt-kb rows. **Migration counts on the copy:** the first load (`admin:create-user`) logged `6 legacy row(s), 3 migrated, 21 per-tool grant(s) added, 3 super-admin and 0 orphan row(s) left to Strapi` and `removed 1 yt-kb permission(s) from Public/Authenticated roles`. Every later load (inspect, both token-script runs, `yarn develop`) logged `3 legacy row(s), 0 migrated, 0 … added, 3 super-admin` and `removed 0`. | Proves the migration on real grant rows: token 3 → 21. It is idempotent across boots. The super-admin role is left to Strapi's reset, which gives it the 21 tool actions and re-creates the 3 legacy ones each boot, as the legacy-grants header says. The U&P cleanup works on a real `up_permissions` row. **The ai-tools contract check** is `aiUsable: true`. It ran inside the real Strapi: `getTools()` returns an array synchronously, and every tool has `name`, an `execute` function and a `schema`. Every `action` is a registered admin action, and every schema converts with `~standard.jsonSchema.input({ target: 'draft-07' })` on zod 4.4.3. These are tanstack-ai 1.7.0's checks as the spec transcribes them. tanstack-ai itself was not installed or run. |
| 5 | Token script | Script exit 0. Both key files are mode 0600 (`{"bad":[]}`). `yt-kb-app` is type `custom` with 24 permissions. The old read-only `yt-kb-site` (id 7) was revoked, and one custom `yt-kb-site` (id 9) with 2 permissions replaces it. The log check passed (`{"ok":true}`). The second run, without `--rotate` and with `MCP_ENABLED=false`, left both tokens alone ("already exists … not written"). It wrote no file, and the token still has 21 tool rows. An existing output file → exit 2. `--rotate yt-kb-client` → exit 2, and no file is written. | Proves create, rotate, idempotence, the file guards, and that a boot with MCP off keeps the per-tool grants. The rotate rollback when a create fails was not exercised. |
| 6 | Scratch server, check tokens | Script exit 0. `/_health` 204. While Strapi ran on SQLite, the token script refused (exit 2, "something is listening on port 1341"), and no file was written. The token still has 21 tool rows. `admin-tokens` with the 21 actions: ok, `grantedActions` 21. Tokens `one` and `import` are ok. | — |
| 7 | MCP | Script exit 0, all 8 checks. **The 21 names in tools/list** (`mcp` token): `yt_kb__library_stats`, `yt_kb__list_videos`, `yt_kb__search_videos`, `yt_kb__get_video`, `yt_kb__get_transcript`, `yt_kb__search_transcript`, `yt_kb__find_transcripts`, `yt_kb__cross_search_transcripts`, `yt_kb__list_transcripts`, `yt_kb__aggregate_by_tag`, `yt_kb__list_untagged`, `yt_kb__list_tags`, `yt_kb__related_videos`, `yt_kb__get_readable_article`, `yt_kb__generate_digest`, `yt_kb__save_summary`, `yt_kb__tag_video`, `yt_kb__untag_video`, `yt_kb__save_note`, `yt_kb__add_video`, `yt_kb__fetch_transcript`. The list also has core's `log`. No bare names appear. Title example: `YT Knowledge Base: Get Video`. `yt_kb__fetch_transcript` takes `["force","videoId"]`. The `one` token lists `log` and `yt_kb__get_video`. Its `get_video` call works. Its `library_stats` call gets rpcError `-32602 Tool yt_kb__library_stats disabled`. `fetch_transcript` with `not-an-id` → `isError`, "videoId must be an 11-character YouTube video id". The `yt-kb-app` key on `/mcp` → initStatus 401. | Proves per-tool gating and the prefixed names through the real `/mcp`. It also proves the M-9 check: a yt-kb-only token sees no Content Manager tool. Only `get_video` and the refused calls were executed. The other tools were listed, not called. |
| 8 | REST | Script exit 0, all 14 checks. `yt-kb-app` can read videos and transcripts and use the content-API `yt-transcript` route. It gets 403 on a transcript POST, on `/api/users` and on the import route. `yt-kb-site` can read videos and tags, and gets 403 on notes and `/api/users`. Public gets 403. The `import` token gets 403 with the exact gate message. The admin route returns 200 for `mcp` and 403 for `one`. | Proves the scopes the token script grants, the import gate under the default config, and that M3's admin route is gated by the derived `FETCH_TRANSCRIPT_ACTION`. 207 is covered only by `importer.test.ts`. The Strapi log had no 5xx (status tally 200 ×33, 201 ×4, 204, 401, 403 ×8). Its only `error` lines are the expected dead-proxy check. |
| 9 | Clean up | Killed the 1341 listener (PID 64587, started in step 6). Ran `rm -f server/.tmp/e8-m5.db* server/.tmp/e8/m5-* server/.tmp/e8/m5.env` (in bash). 1340, 1341 and 3005 are free, and no `strapi develop` or `vite dev` is left. | The two key files went with `m5-*`. `tokens.json` still holds scratch keys for the deleted DB, and the next milestone rewrites it. The kit's pre-M5 copy is `server/.tmp/e8/e8.mjs.pre-m5`. |
| 10 | Owner's DB | Not booted. The kit's online backup read it once (step 3). | Deployment step 2 runs its migration; the expected result is the token's 3 → 21. |

### Stubs and mocks

- **Plugin tests:** hand-written fakes.
  - `adapter.test.ts`: a fake `strapi` with `registerTool` and `actionProvider.registerMany` stubs.
  - `legacy-grants.test.ts`: an in-memory fake `db.query`/`transaction`.
  - `users-permissions.test.ts`: a fake query over a row fixture.
  - `importer.test.ts`: a fake plugin config and service.
  - `ai-tools.test.ts`: `vi.spyOn(listTagsTool, 'execute')` in one case. The other cases use the real tool list and the real zod 4.4.3 schemas.
  - `bootstrap.test.ts`: mocks `./permission-seeding` as well as M3's mocks.
- **Verify 3–8:** a real Strapi 5.61.0 on an online-backup copy of the owner's data. Every load and start had `PROXY_URL=http://127.0.0.1:9`. Nothing reached YouTube: the only YouTube-bound call, `fetch_transcript` with a bad id, failed input validation before any fetch.

### Pre-existing problems found (not fixed)

- Admin token `claude-mcp-1782487483515` has `kind = 'admin'` and also a legacy `type = 'read-only'` in `strapi_api_tokens`. It is harmless, but 5.61's `assertAdminKindFields` would refuse that combination on create.
- `docs/mcp.md`, `CLAUDE.md`, `README.md` and `docs/architecture.md` still give the bare tool names and the three tiers. M8 updates them, as the spec plans.
- `add-video.ts`'s stale duplicate-key text, as noted in M2 and M3.

### Spec discrepancies

- **Verify 4 (spec error, as in M4 Verify 2):** `m5-inspect.cjs`'s stdout also carries Strapi's logs from `createStrapi().load()`, so `jq -e … server/.tmp/e8/m5-inspect.json` exited 5 (parse error). The script stopped after the inspect had run. `admin:create-user` had already succeeded, and running it again would fail on the existing user. So I extracted the result line with `jq -R -c 'fromjson? | select(type=="object" and has("toolActions"))'` into `m5-inspect.obj.json`. Then I ran the rest of step 4's script verbatim against that file: both `jq -e` checks and all seven SQL tests. Exit 0.
- **R-E8-2 test change:** the spec's `adapter.test.ts` expects `{ name, message }` as the meta. That is changed to `{ name }`, as above.
- **`bootstrap.test.ts`:** the spec gives the new case as a table row. It is written as one `it` with exactly the row's assertions, plus `expect(log.warn).toHaveBeenCalled()` so the call-order comparison has a value to compare.
- **Verify 9:** the spec gives the cleanup as a zsh-unsafe glob (see M4's tool note). I ran it in `bash -c`.
- **Commit message:** as instructed, the first line is the `### M5 — …` title. The spec has no **Commit** bullet for M5. This log is included.

### Owner actions (Deployment, not done here)

These are Deployment steps 2–3; the agent did not run them:

1. Back up `server/.tmp/data.db` (`data.db.pre-m5-<TS>`).
2. Boot once. Expect `legacy MCP grant migration: 6 legacy row(s), 3 migrated, 21 per-tool grant(s) added …`.
3. Reconnect MCP clients, so they pick up the `yt_kb__*` names.
4. With Strapi stopped, run `create-tokens.cjs --out-app … --out-site … --rotate yt-kb-site`.
5. Put the two keys into `client/.env` and `site/.env`.

## M6

**Milestone:** M6 — App: security, network and UI states, backfills, dead weight. Started from HEAD `0a4a1b5` (M5), clean working tree. As with M1–M5, the commit hash is reported in the hand-off, not written here.

**Run history:** the first run stopped at Verify V1.3, because the spec's e2e test 4 raced hydration. After rulings R-E8-4 and the accompanying rulings (below), the run continued from V1.3. Every V-step passed, and S7 cleaned up. Ports 1340, 1341, 1399 and 3005 were free before the checks and after them. No `strapi develop`, `vite dev` or stub process is left.

### Rulings in this milestone

- **R-E8-4 (test 4 of `client/e2e/core-loop-states.spec.ts`):** fix the test, not the app. The ruling's first choice was `await page.waitForLoadState('networkidle')`. On the dev server it **never resolves**: TanStack devtools (`devtools()` in `vite.config.ts`) keep an SSE request open at `/__tsd/console-pipe/sse`. All three runs timed out in "Wait for load state networkidle" (60 s), and test 4 sent nothing to the stub. Keeping it would fail every run, so the smallest wait that works replaces it: `page.waitForFunction` until the `input#url` element carries React's `__reactProps…` key, which means React has hydrated the form. The ruling's example check ("type, blur, no `?url=`") cannot detect hydration, because typing never reloads the page; only a click submits the form. With the new wait, test 4 passed 3 runs in a row. No other test in the spec fills or clicks right after `goto`. The settings test clicks only after "6 videos need updating" appears, which is rendered by a client effect, so the page has hydrated by then.
- **oEmbed disclosure (spec error 2, accepted):** test 4 makes **two** oEmbed requests for `zzzzzzzzzz0` per run, not one. `SuggestedTagsRow` calls `suggestTagsForUrl`, and so `fetchYouTubeMeta`, 600 ms after the URL is typed; `shareVideo` makes the second call. The three passing runs made at most six requests to youtube.com, all for `zzzzzzzzzz0`. The first run's three failing attempts made none (no hydration); the second run's three `networkidle` attempts made none (they timed out before `fill`). No other request left the machine.
- **`curl -g` (spec error 3, accepted):** used for every bracketed URL: S3, V2.5 and V3.
- **Pre-hydration native GET submit on `/new-post`:** deferred as a pre-existing problem. `NewPostForm` is not changed for it.
- **Spec errors 4–6:** accepted as handled.
- **Earlier rulings:**
  - R-E8-3: no client field list names `searchIndex`, and `videos.fields.test.ts` asserts that.
  - R-E8-1 and R-E8-2: not needed. No plugin code changed, and the client is `strict`.

### Pre-checks

| # | Check | Result |
|---|---|---|
| 1 | `git log --oneline -6` | M1–M5 present (`f9e2347`, `acf9dd6`, `a6750e6`, `e5321b3`, `5a208c3`, `0a4a1b5`) |
| 2 | `install:all` installs the plugin | exit 0 |
| 3 | `create-tokens.cjs` exists | exit 0 |
| 4 | documentId shapes on the owner DB | all five tables `n: 0`, `jq -e` true. Read with the kit's `sql`, which opens the file `readonly: true`. Nothing was booted on `data.db`. |

### 6.0 Baseline (before any edit)

- S0: ports 1340, 1341, 1399 and 3005 were free. Plugin build and server build exit 0.
- S1: `M=m6`, `SCRATCH=server/.tmp/e8/m6` (mode 700), a fresh `e8-m6.db`.
- S2: `create-tokens.cjs` exit 0. It wrote `yt-kb-app` and `yt-kb-site`. Both key files are mode 0600 (`{ bad: [] }`).
- S3: `/_health` 204, `{ total: 0 }` (with `curl -g`).
- S4: `seeded 16 videos`.
- S6: the M5 client, `wait http://localhost:3005/about` → 200. It listened on `[::1]:3005` only.
- **Baseline: `feedBeforeBytes: 3033238`, exit 0.**

### Steps

- **6.1 B-1:**
  - `seg()` was added after `buildQueryParams`, and the header comment was replaced.
  - `DOCUMENT_ID` and `VIDEO_REF` were added to `validations/post.ts`.
  - All 20 path sites were wrapped in `seg(…)`: 15 in `videos.ts`, 3 in `digests.ts` and 2 in `notes.ts`. Each function was checked against the table; only the line numbers had drifted.
  - `reader.ts` `persistArticle` was replaced verbatim. It now goes through `strapiFetch`, so `reader.ts` no longer reads `STRAPI_URL` or `STRAPI_API_TOKEN`.
  - The 11 schemas are exported and use `DOCUMENT_ID` or `VIDEO_REF`.
  - The three resolvers were guarded.
  - `server-functions/notes.ts` and `digest.ts` had no import from `#/lib/validations/post`, so one was added to each.
- **6.2 B-5:**
  - `vite.config.ts` gets `server: { host: '127.0.0.1', port: 3005, strictPort: true }`. Vite 8.3.6's `CommonServerOptions` has `host`, `port` and `strictPort` (`vite/dist/node/index.d.ts`).
  - The Playwright `baseURL` was changed as specified.
  - `client/.env.example` was replaced verbatim (whole file).
  - The `env.ts` warning was replaced.
  - No `.env` file was opened.
- **6.3 M-4:**
  - `strapiFetch` uses `AbortSignal.timeout`, catches body-read failures and has `networkErrorMessage`.
  - `backend-errors.ts` passes a timeout message through.
  - `TRANSCRIPT_FETCH_TIMEOUT_MS = 120_000` sits above `requestTranscriptFetchService`'s doc comment, so the comment still documents the function.
  - oEmbed has a 5 s timeout and DuckDuckGo an 8 s one.
- **6.4 M-8:**
  - `FEED_FIELDS` was added.
  - `detailQuery` is now the allowlist; it includes `createdAt` and the transcript `fields`, and never names `searchIndex`.
  - `internalDetailQuery` was added for the two non-status fetchers.
  - The corpus no longer strips its rows.
  - The new `stripVideoForClient` nulls all three heavy fields, and `semanticSearchVideos` uses it.
  - The `EmbeddingPanel` fallback reads `embeddingGeneratedAt`.
- **6.4a B-6:**
  - `fetchVideoByVideoIdForServerWithStatusService` was added.
  - `api.chat.tsx` and `api.digest-chat.tsx` switched to it.
- **6.5:**
  - New `isUniqueViolation` (`details.code === 'YT_KB_UNIQUE'` first).
  - `normalizeTagName` is used in `parseTagInput`, `findTagByNameService` and `searchTagsService`.
  - The `digests.ts` and `notes.ts` header comments now name `plugin::yt-kb.*`.
  - `NewPostForm`: try/catch around `shareVideo`, and `role="alert"`.
- **6.6 M-15:**
  - `RouteStates.tsx` and both hooks were copied verbatim from the spec.
  - `router.tsx` gets the two defaults.
  - `preload: false` was added on `/learn/$videoId` and `/digest`.
  - On `/learn`: the local poller was removed, `PendingState`/`FailedState` use `useAsyncAction`, and the `pollStopped` note was added.
  - On `/feed`: the capped poller and its note; `useRouter` was dropped.
- **6.7 M-13:**
  - `backfill.ts` was copied verbatim.
  - Offset pagination was added.
  - `MissingCount`, the three result aliases, the counters, the three backfills and `listRegenerableVideos` are spliced verbatim from the spec blocks.
  - `ContentSignalsPanel` edits.
  - The cancel test's three mocks were updated.
- **6.8:** the `server/.env.example` HOST comment, the CORS comment in `middlewares.ts`, the `server.ts` comment and the `notes.ts` header.
- **6.9 M-21:**
  - `git rm` of `server/scripts/seed.mjs`, `server/scripts/verify-mcp-tools.cjs`, `client/package-lock.json` and `client/pnpm-lock.yaml`.
  - The `verify:mcp` script and the `pnpm` block were removed.
  - `yarn --cwd client remove @strapi/client ky` and `yarn --cwd server remove youtubei.js` (both exit 0, with Strapi stopped).
- **6.10 Tests:** every listed file was written, plus `e2e/core-loop-states.spec.ts` verbatim with R-E8-4's change.

### Verify results

| # | Check | Result | What it proved / did not prove |
|---|---|---|---|
| Static | `client tsc` 0, `server tsc` 0, `yarn test` 0, client build 0. Client tsc and `yarn test` were re-run after the R-E8-4 edit. | **Client 430 = 428 passed + 2 skipped** (52 files; was 335 = 333 + 2). **Plugin 114/114**, unchanged. | **Extra mutation check:** unwrapping one `seg(` in `notes.ts` and loosening `videoDocumentIds` to `z.array(z.string())` made `strapi-segments.guard.test.ts` fail 2 of 3. Restored afterwards. |
| M-21 | `{ bad: [] }` exit 0; `git ls-files` lists nothing; `youtubei.js` resolves from `plugins/yt-kb/node_modules` | pass | — |
| S0/S3 | ports free; both builds 0; Strapi on the existing scratch DB, `/_health` 204, total 16 | pass | S0's builds were run in the first Verify pass. No plugin or server source changed before the resume, which only restarted Strapi (S3). |
| V1.2 | wiring proof | `{ lines: 1, ok: true }` (both passes) | The app read the stub with the stub token, not `client/.env`. |
| V1.3 | e2e against the stub | **3 runs in a row: `expected: 4, unexpected: 0, skipped: 3`** (4.8 s, 4.4 s, 3.9 s) | Proves the four states: malformed id → route error; traversal id → route error or 404; unknown `/learn` → unshared state; a failed write → inline `Not Found` alert with the button enabled again. Earlier attempts: 2 runs without a wait (test 4 clicked before hydration and submitted the form natively), then 3 runs with `networkidle` (timed out); see R-E8-4. |
| **V1.4** | **B-1 negative test** on the stub log covering the 3 passing runs | `{ requests: 12, bad: [] }` exit 0 = 9 × `GET /api/yt-kb/videos` + 3 × `POST /api/yt-kb/videos`, all `auth=true` | No request reached `/api/users` or `/api/yt-kb/videos/<malformed or ..>`. The `/video/…` tests made no Strapi request at all, because the documentId is refused before a path is built. |
| **V2.2** | **listen address** | `[ '127.0.0.1:3005' ]` exit 0 | The 127.0.0.1 pin works: the M5 baseline listened on `[::1]:3005`, M6 only on `127.0.0.1:3005`. |
| V2.3 | positive | `200` | — |
| V2.4 | LAN (negative) | the machine has a LAN IPv4 address (not recorded); `000`, `curl exit 7` | The dev server refuses connections from the LAN address. |
| V2.5 | token scope (negative) | videos `200`, `/api/users` `403`, import `{ status: 403, message: 'Forbidden' }` exit 0 | `yt-kb-app` is refused outside yt-kb, and by its scope before the import gate. |
| V3 | e2e on the fixture library + `nullFinal` | `expected: 4, unexpected: 0, skipped: 3`; `{ nullFinal: 0 }` | The signal backfill finishes, skipping the 3 rows without a transcript, and the final backfill fixes them, through the real Settings UI and Strapi with offset pagination. |
| **V4** | **feed payload** | `{ before: 3033238, after: 68670, ok: true }` (2.3% of the baseline). The page has `Fixture video 16`. | **Extra:** in `feed-after.html`, `summaryEmbedding`, `passageEmbeddings` and `transcriptSegments` each appear 9 times, always as `null`, and none of the fixture `transcriptSegments` placeholder is in the page. |
| **V4b** | **B-6 chat retrieval** | fixture `{"status":201,"chunks":16}`; `/api/chat` on `fxchat00001` → `retrievedChunks: 3`; on `fx000000001` (placeholder) → `0`; `/api/digest-chat` on both → `3`. All `jq -e` true. | Both chat routes now retrieve transcript passages from the stored index through the running app, and the check distinguishes an index from no index. The model call then failed against the closed Ollama port, as intended, so no model ran. |
| V5 | Strapi down | `expected: 2, unexpected: 0` | `/learn` shows "Can't reach Strapi."; `/settings` shows "Couldn't check the library". |
| S7 | cleanup | 1341, 1399 and 3005 stopped (all started here); `e8-m6.db*` and `server/.tmp/e8/m6/` removed; `client/test-results/` (Playwright artifacts from these runs, gitignored) removed. 1340/1341/1399/3005 free. | The app log had no `Strapi did not respond within 30 s.` (`/search` was not exercised). A status tally over the Strapi log matched no lines, probably because of the log's ANSI colour codes, and the log has since been deleted, so the absence of 5xx is **not** established by it. |

### Stubs and mocks

- **Client unit tests:** `fetch` is stubbed at the HTTP boundary (`strapi-client`, `videos.fields`, `digests`, `network-timeouts`, `chat-index`).
  - `chat-index` mocks `@tanstack/ai` (`chat` throws) and `@tanstack/ai-ollama`.
  - The jsdom tests mock `@tanstack/react-router`, the server-function modules and `GenerationModeSelect`, as the spec lists.
  - `document-id.schemas.test.ts` imports the real server-function modules and silences `console.warn` only.
  - `backfill.test.ts` uses an in-memory eligible set.
- **V1:** the spec's recording stub on 1399.
- **V2–V5:** a real Strapi 5.61.0 on `e8-m6.db` (synthetic fixtures only), `PROXY_URL=http://127.0.0.1:9`.
- **The app:** started with `OLLAMA_BASE_URL=http://127.0.0.1:9/v1`. No model ran.

### Pre-existing problems found (not fixed)

- **Deferred (ruling): `NewPostForm` before hydration.** A click on "Share video" does a native `GET` form submission, which puts the pasted URL into the query string (`/new-post?url=…&tags=`).
- **`FeedPage` (`routes/feed.tsx`):** it returns early for `backend-error` before its `useState`/`useEffect` calls, which breaks React's rules of hooks. M6's `usePollingInvalidation` sits where the old effect was. This was already the case at `0a4a1b5`.
- **Unit tests and the env warning:** vitest does not load `client/.env` into `process.env`, so tests that import `env.ts` print the `STRAPI_API_TOKEN is empty` warning. Harmless.
- **Leftover directory:** `client/src/lib/hooks/__tmp__/` is an empty untracked directory from 22 Aug 2026. This run did not create it, so it is left alone.
- **`networkidle` on the dev server:** it never settles while TanStack devtools are on (the open SSE request). Any future e2e test should not rely on it.

### Spec errors / discrepancies

1. **V1.3 test 4:** it filled and clicked before the client hydrated on the dev server. Fixed per R-E8-4 with a hydration wait. `networkidle`, the ruling's first choice, never resolves here.
2. **V1.3, the disclosure:** test 4 makes two oEmbed requests per run, not one (accepted).
3. **`curl` globbing:** a bracketed URL needs `curl -g` (S3, V2.5, V3). Without it curl prints nothing and exits 3 (accepted).
4. **Section reference:** 6.1 refers to "the test in 6.11"; the tests are in 6.10.
5. **Imports:** `server-functions/notes.ts` and `digest.ts` had no import from `#/lib/validations/post` to extend; one was added to each.
6. **zsh glob:** `rm -f …db-*` aborts under zsh when nothing matches, as in M4. S7 ran in `bash`.
7. **Commit message:** as instructed, the first line is the `### M6 — …` title. This log is included in the commit.

### Owner action (Deployment step 3, not done here)

`client/.env`'s `STRAPI_API_TOKEN` must hold the `yt-kb-app` key written by M5's `create-tokens.cjs --out-app` against the owner's Strapi. Open the app at `http://127.0.0.1:3005` (or `localhost:3005`). The agent opened no `.env` file.

## M7

**Milestone:** M7 — Site and scripts. Started from HEAD `b92be6a` (M6), clean working tree. Ports 1340, 1341, 1398, 1399, 3005 and 4330 were free before the checks and after them. As with M1–M6, the commit hash is reported in the hand-off, not written here.

### Steps

- **7.1 `publish-site.sh`:** the whole file was written from the spec's block by a script that took the fenced block by line number and removed the Markdown block's two-space indent, so the continuation lines inside the `die`/`printf` strings start at column 0 as before. `git diff --summary publish-site.sh` shows no mode change (still `100755`). `site/package.json` `scripts.deploy` is now `yarn build && npx netlify deploy --prod --dir=dist`.
- **7.2:** `site/.env.example` was replaced verbatim. In `site/README.md`, the four edits were applied after asserting each anchor line: lines 7–11, the Build section (18–29), the publishing block (37–46) and line 94 (`96` → `107`, the count `yarn site:test` reports). The README's claim that thumbnails come from `i.ytimg.com/vi/<id>/hqdefault.jpg` in `src/lib/player.ts` was checked (`player.ts:66`). No `.env` file was opened.
- **7.3:** `scripts/import-batches.mjs` and `tests/import-batches.test.mjs` were copied verbatim. In `copy-content.mjs`, every splice asserted its anchors first: the header paragraph, then the `import { importInBatches } …` line (after the header, with a blank line either side); the `413` comment line and `if (res.status === 413) return { tooLarge: true };` in `postImport`; and the old comment, `MAX_BATCH_BYTES` and `importAll` replaced by the one-line `importAll`. `node --check` passes. In `vitest.config.mts`, `include` gains `tests/**/*.test.mjs`. `npm pack --dry-run` in the plugin lists `scripts/import-batches.mjs` and no `tests/` file.
- **Rulings:** R-E8-1, R-E8-2 and R-E8-3 were not needed. M7 adds no plugin TypeScript, no log line and no populate. Precedents used: `curl -g` for every bracketed URL (Verify 2); `rm` globs run under `bash -c` (S1, step 8); output-pollution handling (Verify 4's stub assertion, see "Spec discrepancies" 2).

### Verify results

| # | Check | Result | What it proved / did not prove |
|---|---|---|---|
| S0–S4 | Scratch stack, `M=m7` | Ports 1340/1341/1398/1399/3005 (and 4330) free. Plugin build 0, server build 0. `SCRATCH=server/.tmp/e8/m7` (mode 700) and a fresh `e8-m7.db`. `create-tokens.cjs` exit 0: `created yt-kb-app (24 permissions)` and `created yt-kb-site (2 permissions)`, both key files mode 0600 (`{ bad: [] }`). `/_health` 204 and `{ total: 0 }`. `seeded 16 videos`. The fixture and stub scripts were extracted from the spec by line number. | The owner's `site/dist` was moved to `$SCRATCH/site-dist-backup` before any build. **Extra:** `site/.astro` was also copied to `$SCRATCH/site-astro-backup` (see "Spec discrepancies" 4). |
| 1 | Static | `bash -n` 0. `{ bad: [] }` (no `curl`, `python3`, `GENERATED`, `STRAPI_URL=`). The deploy-script check exits 0. `yarn site:test` 0, **107/107**. Plugin `yarn test` 0, **121/121** (20 files), and the list includes `tests/import-batches.test.mjs (7 tests)`; all 7 named cases pass in the verbose run. `astro sync` and `tsc --noEmit` with `SITE_SKIP_STRAPI_FETCH=1` both 0. **Extra:** plugin `verify` 0 and `test:ts:back` 0. | Proves the script is syntactically valid and has no Strapi pre-checks left, and that the batching logic passes its unit tests. The unit tests run `planBatches` and `importInBatches` against fakes; Verify 6 covers the real script. |
| 2 | Site token scope (M-14) | videos `200`, tags `200`, `/api/users` `403`, notes `403`, transcripts `403` | The `yt-kb-site` token from `create-tokens.cjs` is limited to find on videos and tags. |
| 3 | Site build with `yt-kb-site` | `yarn site:build` exit 0 (21 pages built, output guard `clean (26 files checked)`), `{ videoPages: 16 }`. **Negative:** with `STRAPI_API_TOKEN=` it exits 1 and the output contains `Strapi answered 403`. | Proves the site builds from the plugin with the custom token, and that an empty token fails the build with 403 (env vars override `site/.env`; an empty string is not nullish, so the build did not fall back to the `.env` value). |
| 4 | `publish-site.sh` / `site:deploy` with a recording `npx` | **Stub assertion:** the spec's literal command printed three lines, because yarn 1 writes its `yarn exec v1.22.22` / `Done in …` banner to stdout. The middle line was exactly `$SCRATCH/bin/npx`. The same command with `yarn --silent` printed exactly `$SCRATCH/bin/npx` → pass (see "Spec discrepancies" 2). `site/.netlify/state.json` present. Every run had the stub first on `PATH`, `NETLIFY_AUTH_TOKEN=invalid` and `NETLIFY_SITE_ID=00000000-0000-0000-0000-000000000000`. `./publish-site.sh --draft` → 0, `20 pages (16 videos)`, the log gains `<repo>/site\|netlify deploy --dir=dist`. `./publish-site.sh` → 0, the log gains `<repo>/site\|netlify deploy --prod --dir=dist`. `yarn site:deploy` → 0, `site/dist/index.html` mtime 1794199914 → 1794199941 (rebuilt), the log gains `<repo>/site\|netlify deploy --prod --dir=dist`. **Negatives:** `--drfat` → exit 1, `Unknown argument`; `SITE_SKIP_STRAPI_FETCH=1 … --draft` → exit 1. Log line count 3 → 3 → 3. | Each publishing path calls `npx netlify deploy` exactly once, from `site/`, with the right flags, and only after a fresh build. A bad argument and the skip flag reach no deploy. Nothing contacted Netlify. The stub only records the call; the real Netlify CLI was not run, so the CLI's own behaviour with these flags is not proved. |
| 5 | `copy-content.mjs --check` | exit 0, last line `ALL OK` (tags 1, videos 16, others 0, all OK). **Negative:** with `DEST_TOKEN` = the site key → exit 1, the last line is not `ALL OK`, and the output contains `→ 403` (`GET …/transcripts … → 403`). | The check reads both sides with the app token, and the site token cannot read transcripts. |
| 6 | Batching and 413 (recording destination on 1398, limit 1 MiB) | `copy-content.mjs` exit 1 (the stub keeps nothing, as expected). `{ posts: 8, multiOver: 0, tooBig: [{ type: 'video', bytes: 1564558, records: 1, status: 413 }], ok: true }`. The output contains `videos: read 16, created 15, updated 0, failed 1` and `failed <documentId>: body too large — raise strapi::body jsonLimit on the destination`. Video bodies: 5 × 2 records (~799 KB), 1 × 5 records (803 KB), then row 16 alone. The stub was stopped and 1398 is free. | Real script, real source Strapi: every multi-record body is ≤ 900 KB, the oversize record goes alone, its 413 is recorded with the fix, and the copy goes on (notes and digests were still processed). Not proved: a real Strapi's `strapi::body` 413 (the stub stands in for it), or a socket reset (OQ-7: a reset stops the run, by design). |
| 7 | Strapi down | The listener on 1341 (PID 91207, the `strapi develop` started in S3) was killed and 1341 is free. `./publish-site.sh --draft` → exit 1, the output contains `Cannot reach Strapi at http://127.0.0.1:1341/api/yt-kb — is the stack running? (fetch failed)`, and the npx log is `[]`. | With no Strapi, the loader fails the build before any deploy. |
| — | Extra: scratch Strapi log | With ANSI codes stripped: HTTP statuses 200 ×32, 201 ×17, 204 ×1, 403 ×5, and no 5xx. The 5 × 403 are Verify 2's three, Verify 3's negative and Verify 5's negative. The only `error` lines are the dead-proxy check. | Fixes M6's unestablished 5xx tally for this milestone. |
| — | Extra: client suite | `yarn test` 0: **430 = 428 passed + 2 skipped** (52 files), the same as M6. | M7 touches no client code. |
| 8 | Cleanup (M6's S7) | No listener on 1341, 1398, 1399 or 3005 (nothing to kill). `e8-m7.db*` removed (in `bash`). | — |
| 9 | Restore the owner's site build | `site/dist` removed, then the backup moved back: `index.html` has its original mtime (8 Nov 10:39), 190 video folders, 6.8 MB. `site/.astro` restored from its backup. `$SCRATCH` removed, which removed both key files. Afterwards all six ports are free, and no `strapi develop`, stub or astro process of mine is left. | — |

### Stubs and mocks

- **Recording `npx`** (`$SCRATCH/bin/npx`): it appends `$PWD|$*` to `$NPX_LOG`, stands in for the Netlify CLI in every `publish-site.sh` / `site:deploy` run, and exits 0. **Backstops:** unusable `NETLIFY_AUTH_TOKEN` / `NETLIFY_SITE_ID` values. **Checked:** yarn 1.22.22's `yarn run` (`executeLifecycleScript` → `makeEnv`, `cli.js:34316`) and `yarn exec` (`cli.js:84253`) build `PATH` with the same `makeEnv`. Nothing it prepends contains an `npx`: the `node_modules/.bin` folders, `~/.yarn/bin` (create-astro and create-next-app only), the node/yarn wrapper temp folder, and `node-gyp-bin`.
- **Recording import destination** (`import-stub.mjs` on 1398): the spec's script. It answers 413 above 1 MiB and returns empty collections for reads.
- **Plugin unit test:** `importInBatches` with hand-written `post` fakes.
- **Everything else:** a real Strapi 5.61.0 on a fresh scratch DB (`e8-m7.db`, 16 synthetic fixtures only), with `PROXY_URL=http://127.0.0.1:9` on `create-tokens.cjs` and `yarn develop`. No real data and no owner token. `server/.tmp/data.db` was not opened.

### Pre-existing problems found (not fixed)

- **Stale "Search" section in `site/README.md`:** it still gives `380 KB raw, 133 KB gzipped for 172 videos`. The library has 190+ videos, and M7's spec does not touch the section.
- **"Published live:" on any exit 0:** `publish-site.sh` prints `Published live: <URL>` whenever `npx netlify deploy --prod` exits 0. It printed it under the stub as well, which is by design (the script trusts the CLI's exit code). It is noted here only because the line appears in the Verify 4 output although nothing was published.
- **CLAUDE.md:** its rows for `yarn site:publish` ("Checks Strapi, rebuilds…") and `yarn site:deploy` ("without rebuilding") are now wrong. They are M8's, as the spec says.

### Spec discrepancies

1. **`copy-content.mjs` "after line 18":** line 18 is 721f210's numbering, where the header ends. M5 added one header line, so in the file "as M5 left it" line 18 is mid-sentence and the header ends at line 19. The paragraph was added after line 19, at the end of the header comment. This is the same kind of line-number drift as in M6; the text is the spec's.
2. **Verify 4, the stub assertion:** "must print exactly `$SCRATCH/bin/npx`" cannot hold literally, because yarn 1 prints its banner (`yarn exec v1.22.22`, `Done in …`) on stdout. I treated it like the stdout-pollution precedent. The only non-banner line was the stub path, and the same command with `yarn --silent` (a stricter form of it) printed exactly the stub path. I also confirmed from yarn's source that `yarn run` gets the same `PATH`, and the four runs themselves are recorded by the stub. No run reached the real CLI, and the Netlify backstops were in place.
3. **Row 16 fixture size:** row 16's body is 1,564,558 bytes, not "~1.4 MB". The check only needs it to be over 900 KB, which it is.
4. **`site/.astro`:** the spec leaves it rewritten by the scratch builds, for the next real build to replace. I backed it up before Verify 1's `astro sync` and restored it in step 9, so the owner's checkout is exactly as it was. This is an extra safety step; it is not in the spec.
5. **Commit message:** as instructed, the first line is the `### M7 — …` title. This log is included in the commit.

### Open (owner)

- **OQ-8 (Netlify build hooks)** is still open. M7 assumes the Netlify project is only published by hand.
