# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Three-package monorepo with an unversioned root:

- `client/` — TanStack Start (Vite + React 19) app on port **3005**. Server functions and Nitro API routes live alongside the React routes.
- `server/` — Strapi 5 (SQLite for dev) on port **1340**. Hosts the data model, REST API, the official Strapi MCP server at `/mcp`, and the `seed-data/` archive.
- `site/` — Astro 6 static build of the summary layer on port **4330**, searchable in the browser, deployed to Netlify. Reads Strapi at build time only; publishes no transcripts, embeddings or BM25 index. See `site/README.md` and `docs/superpowers/specs/2026-10-11-static-knowledge-site-design.md`.
- `docs/` — design notes, planning docs, and architecture deep-dive (`architecture.md`).
- Root `package.json` is a shell that delegates to the three packages via `yarn` workspaces-style scripts. **Do not run app code from the root** — it has no `src/`.

The two halves are independent: the client never imports from `server/` and vice versa. They communicate over Strapi's REST API and (for write-side internal services) authenticated REST calls in `client/src/lib/services/strapi-client.ts`.

## Common commands

All run from the **repo root** unless noted.

| Command | What it does |
|---|---|
| `yarn setup` | Install every package — root, `server/`, the plugin (`server/src/plugins/yt-kb/`, which it also builds), `client/`, `site/` — + copy `.env.example` files. Run once after cloning. |
| `yarn start` | Full stack: tunes Ollama env (`OLLAMA_KEEP_ALIVE=15m`, `OLLAMA_NUM_PARALLEL=1`), launches Ollama if needed, kills orphans on :1340 / :3005, then `yarn dev`. |
| `yarn start:fresh` | Same as `start` but `pkill -9 ollama` first — required after changing `OLLAMA_NUM_PARALLEL`. |
| `yarn dev` | Strapi + client only, no Ollama setup. Uses `concurrently` + `wait-on http://localhost:1340`. |
| `yarn server` | Strapi only (`strapi develop`). |
| `yarn client` | Client only (assumes Strapi is up). |
| `yarn seed` | Imports `server/seed-data/seed.tar.gz`. **Run before starting Strapi** — needs exclusive write to SQLite. |
| `yarn export` | Exports current Strapi DB to `server/seed-data/seed.tar.gz`. |
| `yarn test` | Full vitest suite via `client/`, 436 tests: 434 pass, 2 skip (Strapi + Ollama down). Also runs as CI's `Test` step. |
| `yarn site` | Astro dev server on **4330** (not 4321 — another project on this machine holds it). Needs Strapi up. |
| `yarn site:build` | Static build + output guard. Fails loudly if Strapi is unreachable or returns nothing. |
| `yarn site:test` | The site's 107 vitest tests. **Not** covered by `yarn test`, which is the client's suite. |
| `yarn site:publish` | **The one to use for a content update.** Rebuilds (the build itself fails on an unreachable Strapi, a short read or an empty library), prints the page and video counts, checks that `site/` is linked to Netlify, deploys live. `yarn site:publish:draft` for a preview URL first. |
| `yarn site:deploy` | `yarn build`, then `netlify deploy --prod --dir=dist` from `site/` — rebuilds first, but has no draft option and no link check. Prefer `site:publish`. |
| `yarn install:all` | `yarn install --frozen-lockfile` for the root, `server/`, the plugin, `client/` and `site/` package.json's. What CI runs to install everything. |
| `yarn plugin:build` | Builds strapi-plugin-yt-kb to its gitignored `dist/` (`strapi-plugin build`). Restart Strapi afterwards. |
| `yarn plugin:test` | The plugin's 141 vitest tests (`yarn --cwd server/src/plugins/yt-kb test`). **Not** covered by `yarn test`. |
| `yarn sync:bm25` | Copies the plugin's `bm25-core.ts` into the client; `--check` exits 1 if the copy is out of date. |

Strapi's own upgrade codemod is run from `server/`, not the root:
`yarn --cwd server upgrade:dry` (review the diff first), then
`yarn --cwd server strapi:upgrade`. **It is named `strapi:upgrade`, not
`upgrade`** — `yarn upgrade` is a Yarn Classic built-in that would silently
bulk-upgrade every dependency in `server/package.json` instead of running
the Strapi codemod. Do not rename it back.

### Tests

```bash
yarn test                                      # from repo root — full vitest suite, 436 tests (2 skipped)
yarn --cwd client test                         # same suite, run from client/
yarn --cwd client test path/to/file.test.ts    # single file
yarn --cwd client test -t "name fragment"      # filter by test name
yarn --cwd client test:e2e                     # Playwright smoke (needs stack up)
yarn plugin:test                               # strapi-plugin-yt-kb's suite, 141 tests
yarn site:test                                 # the site's suite, 107 tests
```

Unit tests are vitest, in two suites besides the site's. The client's lives
in `client/src/` (`yarn test`). strapi-plugin-yt-kb's lives in
`server/src/plugins/yt-kb/server/src/**/*.test.ts` and
`server/src/plugins/yt-kb/tests/*.test.mjs` (`yarn plugin:test`, config
`server/src/plugins/yt-kb/vitest.config.mts`): it never boots Strapi — the
tests use hand-written fake `strapi` objects, a mocked `youtubei.js` and
`fetch`, and one real in-memory SQLite — and it includes the plugin's
guards (permission registration order, tool names). The host app in
`server/` has no tests of its own.

Tests run in the **node** environment by default. A test that renders a
component opts into a DOM with a docblock on its first line:

```ts
// @vitest-environment jsdom
```

Per-file rather than a global environment, so the service-level majority of
the suite doesn't pay jsdom's setup cost (and rather than
`environmentMatchGlobs`, which vitest 3 deprecates). Call `cleanup()` in an
`afterEach` — RTL's auto-cleanup only fires with vitest globals enabled, and
they aren't. `jsdom` and `@testing-library/react` are already devDependencies.
The root `yarn test` script just delegates to `yarn --cwd client test` — it
exists as one obvious entry point and for CI symmetry with `yarn install:all`
(also at the repo root, `yarn install --frozen-lockfile` for each of the
five `package.json`s — root, `server/`, the plugin, `client/`, `site/`).

**436 (434 passed + 2 skipped) is measured with Strapi and Ollama both
down — and is the same with them up.** `videos.smoke.test.ts` and
`embeddings.ranking.test.ts` skip by returning early inside each `it` rather
than failing, so their tests still count as passed and the total doesn't
move with the environment. The 2 skipped are `unique-recovery.live.test.ts`,
a live race check that runs only when `E8_STRAPI_URL` and `E8_TOKEN_FILE`
point it at a scratch Strapi. What moves is pass/fail — see the gotcha
below before trusting a run against a live stack.

Playwright e2e specs live in `client/e2e/*.spec.ts` and assume the full
stack is already running (`yarn dev`/`yarn start` from the repo root) —
they do not boot it. They guard the seroval server→client boundary on the
video-shipping surfaces (`/feed`, semantic feed, `/learn`, `/search`);
`core-loop-states.spec.ts` checks the route error and empty states, and
its env-gated tests skip unless their flags are set.
Test config lives in `client/vitest.config.ts` (not `vite.config.ts` —
they're separate files; vitest prefers its own config when present), which
excludes `e2e/**` so vitest's default glob doesn't try to run browser specs.

**One-time setup:** run `git config core.hooksPath .githooks` once per
clone to enable the pre-push hook (runs the client build before every
push — see `docs/adr/0009-ci-and-static-gates.md`).

### Typecheck

```bash
cd client && npx tsc --noEmit                  # client typecheck (no project-wide script)
cd site && npx astro sync && npx tsc --noEmit  # site typecheck
cd server/src/plugins/yt-kb && yarn test:ts:back  # plugin typecheck
```

`astro sync` generates `.astro/types.d.ts`, which `tsconfig.json` includes
and `.gitignore` excludes — without it a clean checkout cannot typecheck.
The site also needs `src/astro-shims.d.ts`: Astro types `.astro`
imports inside `.astro` files, but not a `.ts` file importing one, and the
component tests do exactly that. `astro check` would cover it but its
integration does not support Astro 6 yet.

There is no lint command — TypeScript and tests are the only static gates. The server has its own `tsconfig.json` and is built by Strapi when it boots; it excludes `src/plugins/`. The plugin is typechecked by `test:ts:back`, built by `yarn plugin:build` and checked by `yarn --cwd server/src/plugins/yt-kb verify` (`strapi-plugin verify`); CI runs all three, then its tests.

## Architecture (the parts that span files)

The README at the repo root has the overview and `docs/architecture.md` has the deep dive. Read those for a full picture; the items below are the load-bearing ideas you'll trip over editing the code.

### Two retrieval layers, one app

- **Per-video chat** uses **BM25 over transcript chunks** (`client/src/lib/services/transcript.ts` for the index, `chat-retrieval.ts` for query rewriting + RRF fusion). One transcript fits in a single Ollama context, so dense embeddings would be operational overhead with no payoff.
- **Cross-video discovery** (Related videos, semantic search on `/feed`) uses **embeddings**, one per video, stored as JSON on the Strapi Video row. In-memory cosine scan in `client/src/lib/services/embeddings.ts` — no pgvector, no vector DB. Personal-KB scale (<1000 videos) is ~1–2ms.
- Both layers hit the same Ollama instance with **different models** (`OLLAMA_MODEL` for chat, `OLLAMA_EMBEDDING_MODEL` for vectors, `OLLAMA_SYNTHESIS_MODEL` optional for `/api/ask`).

### Generation is background + dedup'd + cached

`generateVideoSummary` in `client/src/lib/services/learning.ts` runs as fire-and-forget after a share/regenerate. A single in-process `Set` (`generationInflight` in `client/src/lib/services/generation-state.ts`) dedupes concurrent triggers. **The transcript is cached in Strapi** — once fetched from YouTube, regeneration only re-runs the AI step, never re-hits YouTube unless you pass `forceRefetch`. **The app never talks to YouTube**: it asks Strapi (`POST /api/yt-kb/transcripts/fetch`), and the plugin fetches and stores the row (`services/fetcher.ts`, shared with the `yt_kb__fetch_transcript` and `yt_kb__add_video` MCP tools). `youtube-fetch.guard.test.ts` fails if a YouTube client comes back into `client/`. That assumption is single-node-only; horizontal scaling would need a shared inflight store.

### Hybrid Content score (LLM + programmatic)

Each video carries three score fields:
- `valueScore` (0–100) — LLM judgment, set during summary generation.
- `signalScore` (0–100) — programmatic composite from filler density, lexical density, gzip compression ratio, speaking pace, sponsor presence (`client/src/lib/services/content-signals.ts`).
- `finalScore` (0–100) — `computeFinalScore(valueScore, signalScore)` in `client/src/lib/services/videos.ts`. Default weights: 60% signal, 40% value (`FINAL_SCORE_WEIGHTS`). **`finalScore` is the canonical user-visible "Content score"**; the other two are the inputs.

Three writers update these (summary save, verdict-only AI re-rate, signal-only recompute), and there's a Settings backfill for older rows missing `signalScore` / `finalScore`. If you change scoring math, check that all three writers stay consistent.

### Timecodes are deterministic

The model is **explicitly instructed not to emit timecodes** in summary output. After generation, each section runs through BM25 against transcript chunks and the top-match's real caption-segment start becomes the section's `timeSec`. Same pattern grounds every `[mm:ss]` chip the model emits in chat — drift is flagged in the Sources accordion. **Do not add a code path that trusts a timecode the model produced.**

### Strapi client wraps every backend call

`client/src/lib/services/strapi-client.ts` exposes `strapiFetch<T>` returning a discriminated union `StrapiResult<T> = { ok: true; data; meta? } | { ok: false; status; error }`. Every Strapi call goes through it; status `0` means network unreachable. Two route loaders (`/feed`, `/learn/$videoId`, `/video/$documentId`) use error-aware `*WithStatus` service helpers that distinguish "row doesn't exist" from "backend down" and render the shared `BackendErrorPanel` component.

### Ollama errors get translated for users

`client/src/lib/services/ollama-errors.ts` exports `friendlyOllamaError(raw)` that pattern-matches host-unreachable / model-not-found / timeout strings and returns a recovery hint. **Always pipe Ollama-related caught errors through it before surfacing to users** — chat hooks, generation FailedState, etc.

### Digest identity = video set

A digest is identified by `videoSetKey = sort(youtubeVideoIds).join(',')`, not a serial id. Re-saving the same selection upserts in place. The loader checks this key first to render cached structured data without re-running the LLM. Logic lives in `client/src/lib/services/digests.ts` and the `/digest` route loader.

### Embedding invalidation

Stored vectors carry `embeddingModel` + `embeddingVersion`. Mismatch with current env flags the row stale; `/settings` offers backfill (missing / stale / all). Bumping the env-level `EMBEDDING_VERSION` alongside changing the text-builder in `client/src/lib/services/embeddings.ts` is the protocol — without it, old vectors silently keep being trusted.

### Stored BM25 index invalidation

The BM25 index cached on `Video.transcriptSegments` records the params that
built it — `CURRENT_INDEX_PARAMS` in `server/src/plugins/yt-kb/server/src/services/bm25-core.ts`
(chunk words, chunk overlap, `TOKENIZER_VERSION`). A mismatch makes the row
**stale**, and `loadStoredIndex` refuses to return it rather than scoring
today's queries against yesterday's arithmetic. `/settings` reports
current/stale/missing and rebuilds from the caption segments cached on the
index itself — no Ollama, no YouTube (~6s for 171 videos).

**Bump `TOKENIZER_VERSION` when changing `tokenize`, and the chunk
constants when changing the chunker.** Same protocol as `EMBEDDING_VERSION`,
and the same failure mode if you skip it: stale artifacts silently keep
being trusted. Rows with no cached `rawSegments` (pre-cache era) can't be
backfilled and are reported separately — they need a full Regenerate.

The scorer, the cleaner, the retrieval chunker and the timecode grounding live in the plugin's `server/src/plugins/yt-kb/server/src/services/bm25-core.ts`, copied verbatim into `client/src/lib/services/bm25-core.ts` by `yarn sync:bm25`; the two halves stay identical because `bm25-core.sync.test.ts` fails if they drift. Edit the plugin copy, never the client one. The plugin also stores a model-free index on every transcript (`Transcript.searchIndex`, same `CURRENT_INDEX_PARAMS`), so the same bump makes those stale too; the search tools rebuild them on first use.

### Map-reduce kicks in past ~15K tokens

Single-pass for short transcripts; long ones split into 2500-word windows (50-word overlap), parallel map-step at `MAP_CONCURRENCY` (which should match `OLLAMA_NUM_PARALLEL`), then a final reduce. Code in `client/src/lib/services/learning.ts`.

**Nothing enforces that pairing.** The app never reads `OLLAMA_NUM_PARALLEL` — it appears only in `start.sh`, the README and comments — so a mismatch is undetectable. The cap is also per generation job: `ensureGenerationRunning` dedupes by `videoId`, so sharing N videos at once spawns N jobs each running `MAP_CONCURRENCY` calls, and `embedBatch` hardcodes its own concurrency of 2 besides. Issue #20 proposes one process-wide Ollama budget read from a single value.

### yt-kb's Strapi code is a plugin: strapi-plugin-yt-kb

Content types, routes, Document Service rules, the transcript fetcher and
MCP tools live in `server/src/plugins/yt-kb/` (npm `strapi-plugin-yt-kb`,
peer `@strapi/strapi` `^5.61.0`; SQLite and PostgreSQL only, MySQL/MariaDB
unsupported), loaded via `resolve` in `server/config/plugins.ts`. Its own
README (`server/src/plugins/yt-kb/README.md`) is the host-owner guide:
install, config, tokens, MCP, copying content. Plan and status:
`docs/designs/yt-kb-plugin.md` and `docs/designs/yt-kb-cloud/`.

- **UIDs** are `plugin::yt-kb.<type>`; **REST paths** are
  `/api/yt-kb/<plural>` (`/api/yt-kb/videos`, …). The client and site use
  only these; `strapi-paths.guard.test.ts` fails on an unprefixed path.
  The host app has no content types, components or MCP code of its own;
  `server/src/index.ts` is empty. The old `api::` types were removed in
  plan step 7, and Strapi dropped their tables.
- **No Public grants.** The app reads and writes with `STRAPI_API_TOKEN`
  (`client/.env`), the `yt-kb-app` custom token; the Astro site reads with
  its own `STRAPI_API_TOKEN` (`site/.env`), the `yt-kb-site` custom token
  (`video.find`, `tag.find`). Both are created by
  `server/src/plugins/yt-kb/scripts/create-tokens.cjs` (run from `server/`
  with Strapi stopped; `--rotate yt-kb-app|yt-kb-site` replaces one).
  Anonymous calls get 403, and every boot removes any yt-kb permission from
  the Users & Permissions Public and Authenticated roles.
- **Config keys** (`server/config/plugins.ts`, defaults in the plugin's
  `server/src/index.ts`): `proxyUrl` (default `env('PROXY_URL', '')`),
  `mcp` (`true`), `import` (`false`), `backfillMetadata` (`false`).
- **The plugin installs and builds in `yarn setup`** (`setup:plugin`), and
  `yarn install:all` installs it; CI builds, verifies and tests it. It
  still rebuilds separately: after editing plugin source, run
  `yarn plugin:build` and restart Strapi — `strapi develop` does not reload
  on a rebuilt plugin `dist/`.
- **Copying content** between Strapis (keeps documentIds and dates):
  `server/src/plugins/yt-kb/scripts/copy-content.mjs`. `POST
  /api/yt-kb/import/:type` answers 403 unless the destination's plugin
  config sets `import: true` (and the token holds
  `plugin::yt-kb.importer.importRecords`, which neither token above has);
  it answers 207 when some records failed. The script batches under 900 KB
  per request, for a stock 1 MB body limit.

### MCP server lives in Strapi

The **official Strapi MCP server** (built into Strapi 5.47+, enabled via `server.mcp.enabled` in `config/server.ts`) serves Streamable HTTP at `/mcp`, gated by **admin** API tokens. yt-kb's 21 domain tools are registered by the plugin (`server/src/plugins/yt-kb/server/src/mcp-official/`, plugin config `mcp: true`), reusing the tool bodies in the plugin's `mcp/tools/`. Tools are named `yt_kb__<snake_case>` (`yt_kb__get_video`, …), and each has its own admin permission, `plugin::yt-kb.tool.<kebab-case>`; an admin token sees only the tools it holds. Grants of the old three tiers (`plugin::yt-kb.read` / `.write` / `.maintenance`) are migrated to per-tool grants at every boot (`permission-seeding/legacy-grants.ts`). The same tools reach `strapi-plugin-tanstack-ai` as `yt-kb__<camelCase>` through the plugin's `ai-tools` service. Never give an agent's token Content Manager permissions on yt-kb types. Strapi computes no embeddings — the app does, next to Ollama. The in-app Ollama chat does not use MCP. Every YouTube fetch — the app's and the MCP tools' — runs inside Strapi (the plugin's `services/fetcher.ts` and `services/youtube-transcript.ts`, `youtubei.js`), through the plugin setting `proxyUrl` (default `PROXY_URL` in `server/.env`) when set — needed on cloud hosts, whose IPs YouTube tends to block. See `docs/mcp.md`.

**Adding a tool:** author a `ToolDef` in the plugin's `mcp/tools/` — schema included, with the zod 4 API that `@strapi/utils` exports — then add a one-line entry to the plugin's `mcp-official/tools.ts` giving the tool and its `sideEffects` (`none` | `write` | `external`). Its MCP name, title and per-tool admin action are derived from the tool's name (`mcp-official/names.ts`, registered by `mcp-official/permissions.ts`); `sideEffects` now only feeds the legacy-tier migration. Then add it to the expected lists in `mcp-official/names.test.ts` and bump the counts in `permissions.guard.test.ts` and `adapter.test.ts`, which pin them on purpose: a renamed action loses every grant of the old one at the next boot.

## Routing and aliases

- Client uses TanStack Router with **file-based routes** in `client/src/routes/`. `routeTree.gen.ts` is generated — never edit by hand.
- Path alias `#/*` → `./src/*` (defined in `client/package.json`'s `imports` field). Use it instead of relative `../../../` paths.
- API endpoints are file routes prefixed `api.*` (e.g. `routes/api.ask.tsx` → `POST /api/ask`).

## Conventions worth knowing

- **Server functions** (TanStack Start `createServerFn`) live in `client/src/data/server-functions/` and are the boundary between React loaders and the service layer in `client/src/lib/services/`. Put zod input validation on the server fn, business logic in the service, Strapi I/O in `strapi-client.ts`.
- **Background generation** writes to a Strapi field `summaryStatus: 'pending' | 'generated' | 'failed'`. The route loader reads this; the polling hook in `learn.$videoId.tsx` invalidates every 3s while pending.
- **Selection state** (digest mode, etc.) is page-local React state — it survives loader re-runs but resets on route change.

## Don't / Gotchas

- **Don't bypass `strapiFetch`.** It's the one place that handles auth, error shape, query param flattening, and logging. Inline `fetch('/api/...')` to Strapi has been removed; don't reintroduce it.
- **Don't trust LLM-generated timecodes.** See above. They get post-processed against the transcript every time.
- **Don't introduce cloud AI adapters.** Local-first is a design constraint — Ollama only for inference + embeddings. Frontier models are reachable via MCP from Claude Desktop / Code, not via in-app cloud SDKs.
- **`yarn seed` requires Strapi stopped.** SQLite needs exclusive write access for the import; running it against a live Strapi corrupts the DB.
- **Bump `EMBEDDING_VERSION` when changing the text-builder.** Otherwise old vectors silently survive a meaning-changing edit.
- **Orphan node on :1340 or :3005** breaks `yarn dev` with cryptic `[strapi] fetch failed` spam from the client. `start.sh` kills these pre-flight; if you're running `yarn dev` directly, do it yourself with `lsof -ti :1340 -ti :3005 | xargs kill -9`.
- **Pin pre-1.0 dependencies exactly.** On a `0.x` package a caret is a silent ceiling — `^0.10.3` means `<0.11.0`. `@tanstack/ai` sat 37 minors behind on a caret while the exact-pinned router family stayed current. The rule holds repo-wide: every `0.x` dependency in `client/package.json` and `server/package.json` is exact-pinned, and no caret or tilde `0.x` range is left. The four carets ADR 0010 recorded as pending exceptions (`class-variance-authority`, `next-themes`, `tiptap-markdown`, `@tailwindcss/typography`) were pinned in the follow-up pass. A new `0.x` dep added with `^` or `~` should be corrected before merge. See ADR 0010.
- **Tag slugs are generated server-side.** `slug` is a required `uid`, and Strapi fills uid fields only in the admin panel. The Document Service rule in the plugin's `server/src/plugins/yt-kb/server/src/document-rules.ts` normalizes the name (`normalizeTagName`: trim, lower-case, collapse spaces) and derives the slug with `slugifyTagName` for every create path; a slug already taken gets `-2`, `-3`, … (`freeTagSlug`), so `c++` and `c#` don't collide. Remove that and every new tag from the app or MCP fails `400 "slug must be defined"`. The app's tag lookups use the same `normalizeTagName`, and a tag that fails to create stops the share with an error.
