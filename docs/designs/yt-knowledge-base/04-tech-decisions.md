# Technical Decisions

> As built — reconstructed from `yt-knowledge-base` @ `8ac5ae3` (branch
> `feat/visual-video-cards`), 2026-10-31. Describes the code, not intentions.

Unusually for an as-built reconstruction, ten of these decisions have a
recorded rationale: `docs/adr/0001`–`0010`. Where an ADR exists, "Considered"
and "Why" are quoted from it rather than marked unknown. Where none exists,
"Considered" is `unknown (pre-existing)`.

## Repo shape

Three packages, no workspace and no hoisting. Each has its own
`package.json`, `yarn.lock` and `node_modules`; `client/` additionally
carries a stray `pnpm-lock.yaml`, and `client/` and `server/` each carry a
`.yarnrc.yml`.

| App | Root | What it is | Version |
|---|---|---|---|
| Client | `client/` | TanStack Start app, port 3005 | `@tanstack/react-start` 1.168.48, `@tanstack/react-router` 1.170.31, React 19 (`client/package.json`) |
| Server | `server/` | Strapi 5, SQLite, port 1340 | `@strapi/strapi` 5.52.1 (`server/package.json`) |
| Site | `site/` | Astro static build, port 4330 | `astro` declared `^6.1.3`, resolved **6.4.8** (`site/yarn.lock:1076-1078`) |

Node engines are declared only by the Strapi app:
`"node": ">=20.0.0 <=24.x.x"` (`server/package.json:37-40`), a declaration
rather than tested support. `client/` and `site/` declare none.

`package.json` at the root is a script shell with three dependencies
(`concurrently`, `typescript`, `wait-on`) and no `src/`. `packageManager` is
`yarn@1.22.22`.

The absence of a workspace is deliberate per `.github/workflows/ci.yml`:
"Keeping Strapi's React 18 unreachable from the React 19 client is
deliberate: sharing a root lets the two majors meet, which breaks SSR."
Strapi depends on `react` ^18 (`server/package.json`); the client on React 19.

## Decision 1 — Local inference only, no cloud AI

**Decision.** All inference and embeddings go to a local Ollama. No cloud
AI SDK is a dependency of any package.

**Considered** (`docs/adr/0001-local-first-no-cloud-ai.md`): cloud LLM and
embedding APIs; local Ollama; a hybrid with cloud opt-in.

**Why** (same ADR): the app stores a personal viewing history — transcripts,
summaries, chat, notes — and the cloud option means "every transcript leaves
the laptop". The hybrid "adds a per-call decision and a config surface".

**As built.** Host resolution in `client/src/lib/env.ts:31-45`:
`OLLAMA_BASE_URL` defaults to `http://localhost:11434/v1`; `OLLAMA_HOST` is
that with `/v1` stripped. Four model variables with a fallback chain —
`OLLAMA_MODEL` (default `gemma4-kb:latest`), `OLLAMA_CHAT_MODEL` falling back
to it, `OLLAMA_SYNTHESIS_MODEL` falling back to that, and
`OLLAMA_EMBEDDING_MODEL` (default `nomic-embed-text`).

## Decision 2 — Strapi 5 over a custom backend

**Decision.** Strapi 5.52.1, SQLite in development
(`server/config/database.ts`, `server/.env.example` declaring
`DATABASE_CLIENT` / `DATABASE_FILENAME` alongside Postgres variables).

**Considered** (`docs/adr/0002-strapi-over-custom-backend.md`): a custom
Express/Fastify + Prisma backend with a hand-rolled admin; a headless CMS
(Strapi, Directus, Payload).

**Why** (same ADR): "Schema as data, admin UI free, REST/GraphQL free, auth +
tokens free. Trade some control for surface area." SQLite for zero-config
local development, Postgres-ready for a future hosted deployment.

**As built.** Five content types — `video`, `transcript`, `tag`, `digest`,
`note` (`server/src/api/*/content-types/*/schema.json`) — nine components
under `server/src/components/content/`, and one plugin-type extension,
`server/src/extensions/users-permissions/content-types/user/schema.json`.

All five APIs ship bare factory routes, controllers and services
(`server/src/api/*/routes/*.ts` and siblings): no controller override and no
custom route. There are no files under `server/src/policies` or
`server/src/middlewares`, and no `src/api/*/policies` or
`src/api/*/middlewares` directory exists.

## Decision 3 — BM25 for chat, embeddings for discovery

**Decision.** Two retrieval layers against one Ollama with different models.
Per-video chat uses multi-query BM25 over transcript chunks. Cross-video
discovery stores one embedding per video and scans it in memory — but ranks
by **RRF fusion of dense cosine with BM25**, not cosine alone
(`client/src/lib/services/retrieval.ts:346`, `:382`, and `:274` for
passages).

**Considered** (`docs/adr/0003-bm25-for-chat-embeddings-for-discovery.md`):
embeddings for both.

**Why** (same ADR): the two needs "differ in shape" — one transcript already
fits a single context window, and "embeddings hide signal that BM25
surfaces".

**As built.** The scorer is `client/src/lib/services/bm25-core.ts`:
`RETRIEVAL_CHUNK_WORDS = 150`, `RETRIEVAL_CHUNK_OVERLAP = 20`
(`:50-51`), `TOKENIZER_VERSION = 2` (`:56`), `BM25_K1 = 1.2`, `BM25_B = 0.75`
(`:58-59`), `STORED_INDEX_VERSION = 2` (`:370`). Embeddings and cosine live
in `client/src/lib/services/embeddings.ts` (`cosineSimilarity` at `:95`,
`MAX_EMBED_CHARS = 8000` at `:36`, task prefixes `search_query: ` /
`search_document: ` at `:57`). Fusion policy is
`client/src/lib/services/retrieval.ts`: `RRF_K = 60` (`:26`),
`BM25_WEIGHT = 2.5` (`:31`), `TAG_BOOST_PER_TAG = 0.06` (`:36`),
`TITLE_BOOST_PER_TOKEN = 0.015` (`:40`), `TITLE_TOKEN_MIN_IDF = 1.5`
(`:43`), `RELATED_MAX_QUERY_TERMS = 15` (`:47`), `PER_VIDEO_CAP = 2`
(`:51`). The text each video is scored against is built by
`buildVideoSearchText` (`:298`).

**The scorer is duplicated by a script.** `server/src/services/bm25-core.ts`
is a verbatim copy produced by `scripts/sync-bm25-core.mjs`
(`yarn sync:bm25`), and `client/src/lib/services/bm25-core.sync.test.ts`
fails if the two drift.

**A second duplication exists with no sync script and no test.**
`server/src/mcp/utils/embeddings.ts` re-implements the client's embedding
contract — `MAX_EMBED_CHARS = 8000` (`:31`), the
`search_query: ` / `search_document: ` prefixes (`:38-41`), the model and
version defaults (`:13-29`) — and calls Ollama directly at `:50`. Nothing
keeps it in step with `client/src/lib/services/embeddings.ts`.
`server/.env.example:28-38` and `client/.env.example:18-22` both warn that
the two halves must agree.

## Decision 4 — Timecodes are deterministic, never model-written

**Decision.** The model is instructed not to emit timecodes. Each summary
section's `timeSec` is recovered after generation by BM25 against transcript
chunks.

**Considered** (`docs/adr/0004-deterministic-timecodes-not-llm-generated.md`):
asking the model, including giving it a timecoded transcript.

**Why** (same ADR): local 4B–8B models "will hallucinate timecodes… round,
drift, or fabricate", and the caption segments already encode the answer
deterministically.

**As built.** `client/src/lib/services/learning.ts:1113-1127` — per section,
`findEvidenceForQuote(heading + body, bm25, 1.0)` supplies `timeSec`. Chat
chips run through `verifyTimecodesInText`
(`client/src/lib/services/transcript.ts:550`) and
`extractCitationsWithEvidence` (`:629`).

## Decision 5 — Hybrid content score

**Decision.** Three score fields per video: `valueScore` (model),
`signalScore` (programmatic), `finalScore` (weighted composite, the
user-visible one).

**Considered** (`docs/adr/0005-hybrid-content-score-llm-plus-programmatic.md`):
a single LLM `valueScore`, which shipped first and was superseded.

**Why** (same ADR): the 4B model "clusters scores around a small set of
mental anchors (≈25 / 50 / 72 / 85)", while programmatic signals capture
production quality but not topical worth.

**As built.** Five deterministic signals in
`client/src/lib/services/content-signals.ts` — filler density (`:107`),
lexical density (`:132`), gzip compression ratio (`:154`), speaking pace
(`:175`), sponsor presence (`:208`) — composited by `aggregateSignalScore`
(`:244`) with `SIGNAL_WEIGHTS` (`:86`). `computeFinalScore` and
`FINAL_SCORE_WEIGHTS` are in `client/src/lib/services/videos.ts:100-109`,
`VERDICT_THRESHOLD` at `:79`.

Writers of these fields: `updateVideoSummaryService` (`videos.ts:606`),
`updateVideoVerdictService` (`:689`), `updateVideoSignalScoresService`
(`:723`), `updateVideoValueScoreService` (`:754`),
`updateVideoFinalScoreService` (`:782`). One shared cleaning helper,
`signalInputForTranscript` (`content-signals.ts:59`), keeps them scoring a
row identically; `client/src/lib/services/score-consistency.test.ts` asserts
that.

## Decision 6 — Digest identity is the video set

**Decision.** A digest is keyed by `videoSetKey = sort(youtubeVideoIds).join(',')`.
Re-saving the same selection upserts in place.

**Considered** (`docs/adr/0006-digest-upsert-by-video-set-key.md`): a serial
id per save.

**Why** (same ADR): two saves of the same selection would produce rows
"that look identical from the outside" with different non-deterministic LLM
output.

**As built.** `makeVideoSetKey` at `client/src/lib/services/digests.ts:164`;
`findDigestByVideoSetKeyService` at `:287` queries with `pageSize: 1`. The
`/digest` loader reads the key first and can run a full LLM synthesis on a
cache miss (`client/src/data/server-functions/digests.ts:194`).

## Decision 7 — Boundary-layer error translation

**Decision.** Two translators convert dependency failures into user text.

**Considered**: unknown (pre-existing).

**Why** (`docs/adr/0007-error-translation-strapi-ollama.md`): without them,
Strapi being unreachable on `/feed` rendered the same empty state as a
genuinely empty library, and on `/learn/$videoId` the same "you haven't
shared this video" prompt as a missing row.

**As built.** `client/src/lib/services/strapi-client.ts` returns a
discriminated union `StrapiResult<T>` (`:49-51`) and never throws on an HTTP
error; status `0` means the network throw (`:181-185`).
`friendlyBackendError(status, raw)` is at
`client/src/lib/services/backend-errors.ts:14`, and
`friendlyOllamaError(raw)` — a pure string→string match on
host-unreachable / model-not-found / timeout — at
`client/src/lib/services/ollama-errors.ts:32`.

## Decision 8 — The official Strapi MCP server

**Decision.** Strapi's built-in MCP server at `/mcp` (Streamable HTTP),
gated by **admin** API tokens. The previous hand-rolled `/api/mcp` server was
removed.

**Considered** (`docs/adr/0008-official-strapi-mcp-over-hand-rolled.md`):
keeping the hand-rolled transport in
`server/src/api/mcp/` + `server/src/mcp/server.ts` + `transport.ts`.

**Why** (same ADR): maintaining transport, session and auth code "that a
dependency now provides", and staying on an old Strapi minor to avoid
disturbing it.

**As built.** Enabled through `server.mcp` in `server/config/server.ts:13`
as `env.bool('MCP_ENABLED', true)` — **on unless explicitly disabled**. The
same file's comment records the transport defaults: connect 5 s, request
60 s.

23 files under `server/src/mcp/tools/` (20 tool bodies plus
`query-helpers.ts`, `tag-utils.ts`, `video-access.ts`) yield **22 registered
tools**, because `tags.ts` exports three (`listTagsTool`, `tagVideoTool`,
`untagVideoTool`). They register through
`server/src/mcp-official/` — `index.ts`, `adapter.ts`, `permissions.ts`,
`tools.ts`. Three custom admin permissions tier them, derived from each tool's declared
`sideEffects` in `server/src/mcp-official/tools.ts:43-72`:
**15** `read` (`none`), **4** `write`, **3** `maintenance` (`external` —
`addVideo`, `fetchTranscript`, `reindexEmbeddings`). A token sees only the
tools its grants allow. The comment at
`server/src/mcp-official/permissions.ts:37-45` still lists `generateDigest`
under maintenance and is stale; `tools.ts:57-61` re-tiered it to `none`.

`registerMcpAdminPermissions(strapi)` runs **before** the `isEnabled()` gate
in `server/src/mcp-official/index.ts` — a boot with MCP disabled previously
deleted every token's grants, because Strapi's
`cleanPermissionsInDatabase()` removes permission rows whose action is not
registered (fixed in `72c1290`; guarded by
`client/src/lib/services/mcp-permissions.guard.test.ts`).

## Decision 9 — CI and static gates

**Decision.** One GitHub Actions job: four installs, three typechecks, two
test suites, one real build. No lint.

**Considered** (`docs/adr/0009-ci-and-static-gates.md`): provisioning Ollama
and Strapi in the runner so the live-dependency test families could run.

**Why** (same ADR): that is "real infrastructure for a personal-scale
project", and the smoke test shows live Strapi "isn't even a strictly
stronger check — it surfaces a different, unrelated bug".

**As built.** `.github/workflows/ci.yml`, on push to `main` and on every
pull request: Node 22; `yarn install:all`; `npx tsc --noEmit` in `client`,
then `server`, then `SITE_SKIP_STRAPI_FETCH=1 npx astro sync && npx tsc
--noEmit` in `site`; `yarn test` (the client's vitest suite); `yarn
site:test`; `yarn build` in `client`.

The site typecheck needs the flag because `astro sync` runs the content
loader and no Strapi exists in the runner
(`site/src/content.config.ts:27-33`); `site/scripts/verify-output.mjs`
refuses a build with the flag set, so it cannot reach published output.

A pre-push hook in `.githooks/` runs the client build locally; it is opt-in
per clone (`git config core.hooksPath .githooks`) and skippable with
`--no-verify`, which is why CI runs the build too (same ADR).

**There is no server test suite.** `server/package.json` has a
`verify:mcp` script (`scripts/verify-mcp-tools.cjs`) and it is **not** a CI
step.

## Decision 10 — Exact pins for pre-1.0 dependencies

**Decision.** `0.x` dependencies are pinned exactly, without a caret.

**Considered** (`docs/adr/0010-exact-pins-for-pre-1.0-dependencies.md`):
carets, which is what the AI family had.

**Why** (same ADR): on a `0.x` package `^0.10.3` resolves to
`>=0.10.3 <0.11.0`, so it "pins the package to one dead minor line forever"
with no error, no warning and no staleness signal. The TanStack AI family
had drifted 37 minors behind on a caret while the exact-pinned router family
was 2 behind.

**As built.** `@tanstack/ai` 0.47.1 and `@tanstack/ai-ollama` 0.9.3, exact
(`client/package.json`). Four pre-existing carets remain and the ADR records
them as known exceptions: `class-variance-authority`, `next-themes`,
`tiptap-markdown`, `@tailwindcss/typography`.

## Decision 11 — The static site is built locally and deployed as output

**Decision.** Astro 6 static build, run on the owner's machine against a
live Strapi, deployed to Netlify as finished files. Netlify never builds it.

**Considered**: TanStack Start's own SSG. ⚠️ not in code — nothing records
this comparison. The design note
`docs/superpowers/specs/2026-10-11-static-knowledge-site-design.md` treats
Astro and Netlify as givens (`:37-38`) and never mentions TanStack Start SSG
or prerendering, so it does not document the choice.

**Why** (`site/netlify.toml`): "Strapi is not reachable from their runners."

**As built.** `site/netlify.toml` sets `publish = "dist"` and an **empty**
`command`. `pretty_urls = false` under `[build.processing.html]`, because
Netlify's pretty-URL pass lowercases every path and YouTube ids are
case-sensitive — the id is the permanent slug. `/search-index.json` is
served with `Cache-Control: public, max-age=300`.

The content layer is an inline Astro `Loader` in
`site/src/content.config.ts`, hand-rolled rather than using
`strapi-community-astro-loader`, whose "latest release pins `engines.node` to
a single Node minor this repo is past" (comment at `:13-19`).

## Decision 12 — Generation is background, deduped and cached

**Decision.** Summary generation is fire-and-forget after a share or a
regenerate, deduped by an in-process `Set`, with the transcript cached in
Strapi so a regenerate re-runs only the AI step.

**Considered**: unknown (pre-existing). No ADR.

**As built.** `client/src/lib/services/generation-state.ts`: an inflight
`Set` with an atomic check-and-add (`:90-97`), a progress map, and a 5-minute
failure cache (`FAILURE_TTL_MS` at `:75`). `ensureGenerationRunning` at
`:85`; `setStep` is a no-op for ids not inflight (`:160`).
`generateVideoSummary` at `client/src/lib/services/learning.ts:1304`
documents at `:1300-1301` that it must run inside `ensureGenerationRunning`
or every progress write is dropped.

Status lives on the Strapi row as
`summaryStatus: 'pending' | 'generated' | 'failed'`
(`server/src/api/video/content-types/video/schema.json`).

**Single-node only.** The inflight set is in process memory; nothing shares
it. `client/src/lib/services/learning.ts` and the generation-state module
carry no distributed lock.

## Decision 13 — Map-reduce past a token budget

**Decision.** Single-pass summarisation for short transcripts, map-reduce for
long ones, chosen by an estimated token count.

**Considered**: unknown (pre-existing). No ADR.

**As built.** `generateSummaryWithAI`
(`client/src/lib/services/learning.ts:761`) routes by `mode`: `'auto'` takes
single-pass when `estimateTokens(transcript) <= SINGLE_PASS_TOKEN_BUDGET`,
15_000 (`:430`), else map-reduce. The map step is a worker pool of exactly
`MAP_CONCURRENCY` workers over a shared cursor (`:667-674`), results written
by index so order stays chronological (`:654`). The reading-mode article
pipeline repeats the structure with its own copy of the same constant
(`client/src/lib/services/reader.ts:35`, pool at `:269`).

`MAP_CONCURRENCY` is read at `client/src/lib/env.ts:81-85`, clamped to
`[1,4]`, **default 1**.

**Nothing in the app reads `OLLAMA_NUM_PARALLEL`.** `client/.env.example`
documents that `MAP_CONCURRENCY` must match it on the Ollama server; the
variable appears only in `start.sh`, the README and comments, so a mismatch
is undetectable from inside the app. There are three independent concurrency
budgets besides: `embedBatch` defaults to 2
(`client/src/lib/services/embeddings.ts:295-298`), the embedding backfill
uses `CONCURRENCY = 3`
(`client/src/data/server-functions/videos.ts:800`), and the cap is per
generation job — `ensureGenerationRunning` dedupes by `videoId`, so sharing N
videos spawns N jobs each running `MAP_CONCURRENCY` calls.

## Decision 14 — No auth in the app

**Decision.** No login, no session, no per-user data. The Strapi Public role
is granted read, create and update on every content type at boot; delete is
left admin-only.

**Considered**: unknown (pre-existing). No ADR.

**As built.** `server/src/index.ts` `bootstrap()` seeds 21 public-role
actions (`:105-132`). No cookie, session or JWT handling exists in
`client/src/` — a grep
for `cookie|session|auth|jwt|login|bearer` returns only comments, the Strapi
token header, YouTube's `youtube-nocookie` embed host, and `youtubei.js`'s
`generate_session_locally`. `client/src/routes/about.tsx:30` describes the
app as "Zero auth"; `client/src/routes/index.tsx:3` as "Local-first,
single-user".

The only credential to Strapi is an optional
`Authorization: Bearer ${STRAPI_API_TOKEN}`, added by `buildHeaders`
(`client/src/lib/services/strapi-client.ts:147-152`) when the variable is
non-empty, plus one hand-rolled copy at
`client/src/lib/services/reader.ts:357-358`.

⚠️ not in code — whether the live instance actually sets
`STRAPI_API_TOKEN`, and which permissions have been changed in the admin
panel since the last boot, cannot be read from the repo.

## Decision 15 — Deployment and hosting

**Decision.** Nothing is containerised and nothing deploys the app. Only the
static site is published.

**As built.** No `Dockerfile` anywhere in the repo. No `vercel.json`,
`wrangler.toml` or `fly.toml`. The one host config is `site/netlify.toml`.
`.github/workflows/ci.yml` has no deploy job. `server/package.json` carries
Strapi's stock `deploy` script (`strapi deploy`, Strapi Cloud) and
`@strapi/plugin-cloud` 5.52.1 is a dependency; nothing in the repo invokes
either.

Publishing the site is a local shell script, `publish-site.sh`
(`yarn site:publish`, `--draft` for a preview): it checks Strapi is up,
refuses `SITE_SKIP_STRAPI_FETCH=1`, rebuilds, counts `dist/v/` directories
against the generated-summary count, `cd`s into `site/` before invoking the
Netlify CLI, and prints `PREVIEW ONLY` or `Published live:`.

The live URL is hardcoded as `LIVE_URL` in `publish-site.sh:32`:
`https://boisterous-lamington-cc0eed.netlify.app`. ⚠️ not in code — the
site's environment variables, any deploy hooks, whether a build command is
set in the Netlify UI (see `05` §10), and whether the client or Strapi runs
anywhere but the owner's machine.
