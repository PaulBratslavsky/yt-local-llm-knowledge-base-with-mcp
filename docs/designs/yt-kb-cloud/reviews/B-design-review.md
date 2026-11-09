# Checkpoint B — design review of the existing app

- **Date:** 2026-11-08
- **Targets:** `04-tech-decisions.md`, `05-tech-requirements.md` (as built, after checkpoint R) and the code
- **Standard:** `reviews/standards/strapi-design-standard.md`
- **Background:** `03-requirements.md`
- **Reviewers** (all dispatch option 1, fresh subagents, in parallel):
  `egm:egm-design` (4 Blockers / 21 Majors / 5 Nits), `egm:egm-zoom-out`
  (1 / 9 / 2), `strapi-product-egm:strapi-code-auditor` (2 / 6 / 3),
  `strapi-product-egm:frontend-auditor` (2 / 5 / 3),
  `strapi-product-egm:strapi-fact-checker` (0 / 4 / 4; 23 claims checked,
  21 confirmed). The first fact-checker run stopped without checking anything
  because its prompt listed three lockfiles to read in full; it was re-run with
  the lockfiles as "search as needed".

Duplicates are merged below. In existing-app mode **PROPOSE FIX means
"change the app"**; `04`/`05` stay as built until E9 (factual corrections
the reviewers proved — zod, body limit — were applied to 05 directly).
Elephant checks are marked ✔.

## Blockers

| ID | Finding | From | Label |
|---|---|---|---|
| B-1 | **Path traversal with the app's token.** `documentId` values from the browser go into Strapi paths unescaped (`client/src/lib/services/notes.ts:128`, `digests.ts:252,279,305`, `videos.ts:448,468,522`, `reader.ts:360`); validation is only `min(1)`/`max(64)`. `fetch` collapses dot segments, so `../../users/1` turns `deleteNote` into `DELETE /api/users/1`, sent with the full-access `yt-kb-client` token. ✔ `new URL()` resolves `…/videos/../../users?` to `/api/users?` | frontend 1, code 2 | PROPOSE FIX — strict id pattern, `encodeURIComponent` per segment, scoped token (B-5) |
| B-2 | **Uniqueness is not enforced by the database.** `unique: true` creates no index; only `column.unique` does (`@strapi/database/dist/schema/schema.js:29,94`). ✔ local SQLite has no unique index on `youtube_video_id`, tag `name` or `video_set_key`. Check-then-insert in `document-rules.ts` and the callers races (app + MCP, double submit). The code comment at `document-rules.ts:43-44` is wrong | design B1, code 1 | PROPOSE FIX — `column: { unique: true }` on the four keys after removing duplicates; catch the violation and re-read |
| B-3 | **Goal 6 has nothing behind it:** no `ai-tools` service, so `tanstack-ai` cannot pick up yt-kb's tools | zoom 1, design B2 | PROPOSE FIX — `ai-tools` service mapping the existing `domainTools`, with the tier actions as `action` (same shape as `youtube-transcripts`) |
| B-4 | **No parity plan for goal 5, and goal 7 is contradicted:** 7 metadata fields missing, `language` always `'en'`, no fetch retry/timeout/backoff, no proxy check at boot, no REST fetch-or-return route, no import from `youtube_transcripts`; proxy read from `TRANSCRIPT_PROXY_URL`, not a `proxyUrl` plugin setting defaulting to `PROXY_URL` | design B4, zoom 2, 3 | ESCALATE (which parity items) + PROPOSE FIX (proxy shape, language, hardening) |
| B-5 | **Unauthenticated app writes with a full-access token.** Only Vite's localhost default stands in the way (✔ fact-checker: Vite 8 default host is `localhost`); no stated reason, no CSRF analysis; full access also covers the importer and Users & Permissions routes | design B3, frontend 2 | ESCALATE (accept "localhost, single user" as the reason) + PROPOSE FIX — scoped custom token, pin `server.host: '127.0.0.1'` |

## Majors

| ID | Finding | From | Label |
|---|---|---|---|
| M-1 | Bare MCP tool names (`getVideo`, `listTags`, …) registered in `register()` with no try/catch: in "any Strapi app" a clash stops the host booting; tool failures are not logged | zoom 7, design M5 | ESCALATE (renaming changes the names Claude uses) + PROPOSE FIX (catch and log) |
| M-2 | Test host on 5.52.1, behind the 5.53.0 security release; goal is 5.61.0; peer floor `^5.47.0` admits versions below the MCP floor and below the 5.48.1 XSS fix | fact 2, design M6, zoom 4, code 8 | PROPOSE FIX — upgrade `server/` to 5.61.0, peer `^5.61.0` |
| M-3 | `undici` 6.28.0 has a High advisory (GHSA-xjj6-f33q-929c, fixed 6.29.1) and is the plugin's YouTube HTTP client | fact 3 | PROPOSE FIX — pin ≥6.29.1 |
| M-4 | Fetch hardening in the wrong layer: the plugin has no retry/timeout/backoff; the app regex-retries YouTube 403/429; the MCP path skips the id check, logs nothing, and takes a caller `proxyUrl` (outbound connection to any host); no timeouts on the app's oEmbed, DDG and Strapi calls | zoom 3, design M3/M15/M18, frontend 6, code 10 | PROPOSE FIX — port `youtube-transcripts`' fetcher logic into `fetchAndStore`, machine-readable failure reason, drop per-call `proxyUrl`, timeouts in the app |
| M-5 | The plugin is not installed, built, verified or tested by setup or CI; its guards live in the client package; no publish path | zoom 4, design M7 | PROPOSE FIX |
| M-6 | Default hosts have a 1 MB JSON body limit (✔ fact-checker: koa-body default, `@strapi/core/dist/middlewares/body.js:13-16`); `copy-content.mjs` sends up to 8 MB | fact 4, design M1, zoom 8 | PROPOSE FIX — batches under 1 MB, one-record fallback, report oversize rows |
| M-7 | The import route is a permanent content-API endpoint for a one-off copy: no input sanitization, any full-access token can rewrite any row and its dates, 200 on partial failure | zoom 8, design M9 | PROPOSE FIX — off by default behind plugin config `import: false`; 207/4xx on failures |
| M-8 | `/feed` and detail queries have no `fields`: ~9 MB of embeddings per 20-row feed page reach the browser; whole-corpus reads (~80 MB) per search once Strapi is remote | zoom 5, design M2, code 5, frontend 5 | PROPOSE FIX — `fields` allowlists (reuse `CORPUS_BASE_FIELDS`), strip embeddings in `stripVideoForClient`; corpus cache deferred |
| M-9 | Content Manager's MCP CRUD tools and `tanstack-ai`'s `create_content`/`update_content` can write yt-kb rows outside yt-kb's tiers (✔ fact-checker: `TS/` L455-537) | zoom 9, design M4 | PROPOSE FIX — documented rule plus README: MCP tokens hold only `plugin::yt-kb.*`, no Content Manager permissions on yt-kb types |
| M-10 | `publish-site.sh` cannot publish: old `/api` path, no token, does not read `site/.env`; `site:deploy` ships an old `dist/` | zoom 10, design M12, frontend 3 | PROPOSE FIX — drop its pre-checks (the loader already fails loudly) or fix path + token; make `site:deploy` build |
| M-11 | BM25 code is owned by the app and copied into the plugin; the index is built only by the app and stored on the Video, so MCP-added videos have none | zoom 6 | ESCALATE (architecture) |
| M-12 | Tag slugs collide (`c++` and `c#` → `c`; non-Latin → `tag`); the second tag is silently dropped in the app and throws in MCP; tag lookups do not collapse spaces like the create rule | code 4, zoom 11 | PROPOSE FIX — suffix on collision, one `normalizeTagName` helper, surface failures |
| M-13 | Settings backfills skip rows (filter on the field they write while paging), return `ok` after a failed page; counters return `{missing: 0}` on error | code 7, design M13 | PROPOSE FIX |
| M-14 | No permission seeding or check in code; token scopes undocumented for a new host; the site's read-only token can also read `/api/users` | code 3, design M10/M11, frontend 7/8 | PROPOSE FIX — `bootstrap()` removes yt-kb actions from Public/Authenticated; documented custom-token scopes for app and site |
| M-15 | Core-loop states: no error/pending component on any route but `/digest`; `/new-post` submit has no try/catch; retry button can stick; `/learn` poll cap ends silently; `/feed` polls with no cap; GET loaders start Ollama work on hover preload | frontend 4, design M16/M17 | PROPOSE FIX |
| M-16 | MCP-only videos: no scores, index or embeddings; `saveSummary` stores model-supplied `timeSec` (against the repo's timecode rule); `pending` rows nothing surfaces | design M13, docs | ESCALATE (what an MCP-only video should get) |
| M-17 | `string` (varchar 255) on YouTube-sourced `videoAuthor`, transcript `title` and `author`; Postgres hosts reject longer values inside `fetchAndStore` | code 6, design N2 | PROPOSE FIX — `text` |
| M-18 | Multi-record writes are not transactional (`addVideo`, `tagVideo`, `shareVideo`, importer) | design M8, code 9 | PROPOSE FIX — `strapi.db.transaction`, YouTube fetch outside it |
| M-19 | Robustness sweep incomplete; no test mode for YouTube/Ollama; live suites count as passed when skipped | design M13/M19 | PROPOSE FIX — plugin tests with a stubbed fetcher; sweep lines in 06 and E9 |
| M-20 | Vite 8.0.8 advisories (exploitable only with `--host`); `seroval` 1.5.2 Critical advisory via `solid-js` (not on the server-fn path) | fact 5, 6 | PROPOSE FIX — vite ≥8.1.6, resolution seroval ≥1.5.3 |
| M-21 | Dead weight: `seed.mjs`, `verify:mcp`, unused `@strapi/client` and `ky`, three client lockfiles, `reader.ts` raw `fetch`, the `mcp: false` setting, stale comments | zoom 12, design M21, code 11 | PROPOSE FIX (remove); Users & Permissions stays — stock on the local test host, nothing in the plugin depends on it — DECLINE |

## Nits

PROPOSE FIX unless noted: wrong "zod 3" comments in the adapter and `CLAUDE.md`; prefer `telemetryDisabled: true` over `uuid: false`; record why `richtext` not `blocks`; `start.sh` kills any process on its ports; chat routes accept cross-site simple POSTs (Content-Type check, message cap); stale `.env.example` and tag-schema text. CVE-2026-118171 (content-manager preview URL) — DECLINE: unverifiable, and resolved by M-2's upgrade.

## Escalations

1. **B-5** — Accept "the app is local and single-user" as the reason it has no sign-in? Recommendation: yes, and still scope the token and pin the app to 127.0.0.1.
2. **M-1** — Rename yt-kb's MCP tools with a prefix (breaking for Claude's existing tool names)?
3. **B-4** — Which `youtube-transcripts` features does parity include?
4. **M-11 / M-16** — What should a video added only through MCP get without the app?
