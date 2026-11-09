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
