# Checkpoint R — reconstruction check

- **Date:** 2026-11-08
- **Targets:** `04-tech-decisions.md`, `05-tech-requirements.md`
- **Standard:** `reviews/standards/as-built-standard.md`
- **Reviewer:** `egm:egm-codebase-details`, REVIEW mode (dispatch option 1), fresh subagent
- **Codebase given:** `yt-knowledge-base` @ `721f210`; host `strapi-prod` @ `c3d0b74` with its installed `strapi-plugin-youtube-transcripts`, `strapi-plugin-tanstack-ai`, `@strapi/core`
- **Verdict:** does not pass — 4 Blockers, 21 Majors, 10 Nits

Labels follow `resolve-protocol.md`. R's fixes correct facts, so PROPOSE FIX is applied directly to 04/05. Items marked **SCOPE** depend on the owner's pending answer about whether the host (`strapi-cloud-backend-main-site`) is still a target this round; they are applied or recorded as out of scope once that is answered.

## Blockers

| ID | Finding | Label | Note |
|---|---|---|---|
| R-1 | Users & Permissions is installed in this repo's Strapi (`server/package.json:22`, user extension, `JWT_SECRET`); user JWTs are a second way onto content-API routes; `server/scripts/seed.mjs` registers users and writes to `/api/posts`, `/api/profiles` (types that do not exist) | PROPOSE FIX | Document U&P as installed, unused by the app; mark registration settings and Authenticated-role grants `⚠️ not in code`; record seed.mjs as stale |
| R-2 | Content Manager registers MCP tools (`list_/get_/create_/update_/delete_`) for every displayed type, including yt-kb's five, gated by Content Manager permissions, not `plugin::yt-kb.*` | PROPOSE FIX | Verified by the Elephant: `server/node_modules/@strapi/content-manager/dist/server/mcp/register-content-manager-mcp-tools.js:22` (`findDisplayedContentTypes`), `utils.js:11-17` (slug `plugin-yt-kb_<type>`). Also record whether `tanstack-ai`'s `create_content` / `update_content` reach `plugin::yt-kb.*` (`⚠️ framework behavior` until checked) |
| R-3 | `deleteSavedDigest` (deletes a Digest after a length check) and many read/Ollama handlers are missing from 05's handler table | PROPOSE FIX | List every handler |
| R-4 | The host's `/mcp` also accepts OAuth sign-in (`strapi-oauth-mcp-manager`) and the host runs a second MCP endpoint (`ocyris-strapi-builder-mcp`) | DECLINE | main-site is out of scope (03); the owner: the OAuth plugin "is an add on to Strapi to expose MCP via OAuth and has nothing to do with your plugin" (2026-11-08) |

## Majors

| ID | Finding | Label |
|---|---|---|
| R-5 | This repo's CORS (`origin: []`) and 20 MB body limit undocumented; the host uses the default body limit while `copy-content.mjs` sends 8 MB batches | PROPOSE FIX |
| R-6 | `config/api.ts` (`defaultLimit 25`, `maxLimit 100`, `withCount`) undocumented; the site's paging depends on it | PROPOSE FIX |
| R-7 | Wrong citations: token header `strapi-client.ts:147-152` (and sent only when set); `copy-content.mjs` path; `yt-kb-client` source; core `log` cited from the host | PROPOSE FIX |
| R-8 | `/video/$documentId` does fetch (`getVideoByDocumentId`) | PROPOSE FIX |
| R-9 | Embedding sizes swapped (passageEmbeddings 442 KB, summaryEmbedding 14.8 KB); the `/feed` payload claim is framework behavior | PROPOSE FIX |
| R-10 | Database not SQLite-only (`DATABASE_CLIENT` with mysql/postgres branches) | PROPOSE FIX |
| R-11 | `server/` has `deploy: strapi deploy` and `@strapi/plugin-cloud` | PROPOSE FIX |
| R-12 | Root scripts undocumented: `start.sh`, `copy-env.mjs` (copies `.env.example` → `.env`), `sync-bm25-core.mjs`, `dev`, `seed`, `export` | PROPOSE FIX |
| R-13 | Strapi loads the plugin from gitignored `dist/`; no setup or CI step builds it | PROPOSE FIX |
| R-14 | Env vars missing: `FLAG_NPS`, `FLAG_PROMOTE_EE`, `SOURCE_URL`, `SOURCE_PREFIX`, `DEST_URL`, `STRAPI_URL` (seed.mjs), `OLLAMA_KEEP_ALIVE`, `OLLAMA_NUM_PARALLEL`, `STRAPI_BASE_URL` in `publish-site.sh`, `CI` | PROPOSE FIX |
| R-15 | Fetch edge cases: app retries a YouTube 429/403 because `/fetch failed/` matches `timedtext fetch failed`; any throw becomes 502 incl. the duplicate-create race; MCP path logs no warn; MCP `fetchTranscript` accepts any `videoId` and a caller `proxyUrl` | PROPOSE FIX |
| R-16 | Importer: raw body to the Document Service without input sanitization; 200 with per-record failures; rules apply on create; import order | PROPOSE FIX |
| R-17 | Generation: 5-minute recent-failure window; `shareVideo` ignores `ensureGenerationRunning`'s result | PROPOSE FIX |
| R-18 | Settings backfills stop on a failed page yet return `ok`; `count*` return `{missing: 0}` on error; 50-page cap | PROPOSE FIX |
| R-19 | Tests: two live suites skip when services are down; `videos.smoke.test.ts` is the only Public-refusal test; Playwright needs the stack | PROPOSE FIX |
| R-20 | `tanstack-ai`'s 8 admin actions missing; youtube-transcripts and tanstack-ai register MCP tools in `bootstrap`, yt-kb in `register` (order matters for first-wins) | PROPOSE FIX |
| R-21 | yt-kb's adapter and `CLAUDE.md:206` assume `@strapi/utils` is zod 3; on 5.60 it is zod 4.4.3 | PROPOSE FIX |
| R-22 | Site: `/404`, `Cache-Control` on `/search-index.json`, browser-side `i.ytimg.com` and the YouTube embed | PROPOSE FIX |
| R-23 | Host: comment custom routes, `is-owner` middleware, U&P and form-kit, production `frame-ancestors: *` | PROPOSE FIX · SCOPE |
| R-24 | Data model details: Note `source` required; Transcript `thumbnailUrl` ≤2000, `durationSec` ≥0; Digest `description` ≤400, `bottomLine` ≤800; digest component attributes | PROPOSE FIX |
| R-25 | `verify-mcp-tools.cjs` also needs `dotenv` and a stopped dev server | PROPOSE FIX |

## Nits

All PROPOSE FIX: the "HOST" word clash in 05; non-standard markers ("not verified — not run", "not verified from code"); intention wording ("will load the plugin"); `strapiFetch` line range 166-217; unused client deps `@strapi/client`, `ky`, and host `youtubei.js`; `regenerateVideoSignals` does not check `generated`; `/feed` polling has no cap and `loadDigest` runs Ollama in a GET loader (preload); tanstack-ai offers all tools when no ability is passed; youtube-transcripts' invalid-id 200 and 400 responses; local upload provider and `server/public/uploads/`; stale comments in `client/.env.example:16` and `client/src/lib/env.ts:116`.

## Escalations

None from R. The SCOPE items wait on the owner's answer to the goals question (2026-11-08).

---

## Re-run (2026-11-08) — after the first round of fixes

- **Reviewer:** `egm:egm-codebase-details`, REVIEW mode, fresh subagent (the one re-run R allows)
- **Verdict:** does not pass — 1 Blocker, 6 Majors, ~12 Nits. All applied directly to 04/05 except where noted; no third run.

| ID | Finding | Label | Note |
|---|---|---|---|
| R2-B1 | Admin panel sign-in (admin JWT, Content Manager can edit every yt-kb row) missing from Auth and Session | PROPOSE FIX | Added to 04 Auth/Session topology and 05 Auth/Session |
| R2-M1 | `start.sh` port-kill cited at 18-19; it is 89-95 | PROPOSE FIX | Verified by the Elephant |
| R2-M2 | OAuth re-connect claim is an inference | DECLINE | The bullet was removed: the owner says that plugin is unrelated to yt-kb |
| R2-M3 | yt-kb registers MCP tools in a loop with no try/catch; a duplicate name or a late call throws out of `register()` | PROPOSE FIX | Verified (`PSRC/mcp-official/index.ts:47-49`). The reviewer's claim that Content Manager registers in `register()` on 5.52 is **CONTESTED**: both 5.52.1 and 5.60.0 call it from `@strapi/content-manager/dist/server/bootstrap.js:17`; only the code comment differs |
| R2-M4 | `tagVideo`, `untagVideo`, `saveNote` writes not described; whitespace mismatch between tag lookup and create rule | PROPOSE FIX | Added to 05 Flows |
| R2-M5 | Plugin install/build and external-dependency resolution incomplete | PROPOSE FIX | Added to 04 Backend/CMS |
| R2-M6 | Uncited or unmarked claims (token rows, 5.61.0, builder MCP endpoint, MCP error shape, a non-standard marker) | PROPOSE FIX | Builder endpoint dropped with the rest of main-site scope |
| R2-Nits | Line-number corrections, `getFeed` location, `copy-env.mjs` behavior, attempts vs retries, `MAP_CONCURRENCY` clamp, plugin `engines`/`files`/validator, `sync:bm25`, unused deps, telemetry off, `ytkb` component collision, `language: 'en'`, `mode` param, `DEST_TOKEN` read, garbled sentence | PROPOSE FIX | Applied |
