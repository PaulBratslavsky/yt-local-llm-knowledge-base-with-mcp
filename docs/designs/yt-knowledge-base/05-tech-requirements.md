# Technical Requirements

> As built — reconstructed from `yt-knowledge-base` @ `8ac5ae3` (branch
> `feat/visual-video-cards`), 2026-10-31. Describes the code, not intentions.

## 1. Data model

Five content types, all in `server/src/api/*/content-types/*/schema.json`.
`draftAndPublish: false` on `video`; no i18n configuration anywhere.

### Video — the central row

36 attributes. `youtubeVideoId` is `required` **and `unique`**, as are
`url` and `summaryStatus` (required only). Grouped by what writes them:

| Group | Attributes |
|---|---|
| Identity | `youtubeVideoId`, `url`, `videoTitle`, `videoAuthor`, `videoThumbnailUrl`, `caption` |
| Relations | `transcript` (to `api::transcript.transcript`), `tags`, `digests`, `notes` |
| Summary | `summaryStatus` (enum), `summaryTitle`, `summaryDescription`, `summaryOverview` (richtext), `summaryGeneratedAt`, `aiModel` |
| Reading mode | `readableArticle` (richtext), `readableArticleGeneratedAt`, `readableArticleModel` |
| Verdict | `watchVerdict` (enum), `verdictSummary`, `verdictReason` |
| Scores | `valueScore`, `valueScoreSource` (enum), `signalScores` (json), `signalScore`, `finalScore` |
| Retrieval state | `transcriptSegments` (json — the stored BM25 index), `summaryEmbedding` (json), `embeddingModel`, `embeddingVersion`, `embeddingGeneratedAt`, `passageEmbeddings` (json) |
| Components | `keyTakeaways`, `sections`, `actionSteps` (all repeatable) |

### Uniqueness in the schema

Four keys carry `unique: true` at the database level:
`video.youtubeVideoId`, `transcript.youtubeVideoId`, `tag.name` and
`digest.videoSetKey` (each type's `schema.json`). `tag.slug` is a `uid` with
`targetField: "name"`, required.

The four retrieval-state JSON columns dominate the row's size. Measured on
the owner's live database (`server/.tmp/data.db`, 191 videos, 139 MB total):
`passageEmbeddings` averages 439 KB per video and peaks at 3.99 MB;
`transcriptSegments` averages 181 KB. 115.7 MB of the 139 MB is retrieval
state. ⚠️ not in code — these are measurements of the owner's data, not
facts about the schema.

### The other four

All four set `draftAndPublish: false` and carry an empty `pluginOptions`,
same as `video`.

- **Transcript** (9 attributes) — `youtubeVideoId` (required, unique,
  maxLength 32), `title`, `author`, `thumbnailUrl`, `language` (default
  `"en"`), `durationSec`, `rawSegments` (json), `rawText` (richtext),
  `fetchedAt`.
- **Tag** (3) — `name` (required, unique), `slug` (uid, `targetField:
  "name"`, required), `videos` relation.
- **Note** (5) — `title`, `body` (richtext, required), `source` (enum
  `chat | digest-chat | mcp | manual`, required, default `manual`),
  `author`, `videos` relation.
- **Digest** (12) — `videoSetKey` (required, unique, maxLength 500), `title`
  (required), `description`, `overallTheme`, `bottomLine`, four components
  (`sharedThemes`, `uniqueInsights`, `contradictions`, `viewingOrder`),
  `articleMarkdown`, `videos` relation, `model`.

Paths: `server/src/api/{transcript,tag,note,digest}/content-types/*/schema.json`.

### Components and extensions

Nine components under `server/src/components/content/`: `action-step`,
`section`, `takeaway`, and six digest components
(`digest-contradiction`, `digest-contradiction-position`,
`digest-shared-theme`, `digest-unique-insight`, `digest-video-title`,
`digest-viewing-order`).

One plugin-type extension:
`server/src/extensions/users-permissions/content-types/user/schema.json`.
It is the **stock Users & Permissions `user` schema with no custom
attribute added** — `username`, `email`, `provider`, `password`,
`resetPasswordToken`, `confirmationToken`, `confirmed`, `blocked`, `role`,
all `configurable: false`. Nothing in the product reads or writes it.

## 2. Strapi API surface

**No custom routes and no controller overrides.** All five APIs are bare
factories (`server/src/api/*/routes/*.ts`, `controllers/*.ts`,
`services/*.ts`) — 15 files that each call `createCoreRouter` /
`createCoreController` / `createCoreService`.

**No policies and no middlewares.** `server/src/policies` and
`server/src/middlewares` do not exist; neither does any
`src/api/*/policies` or `src/api/*/middlewares`.

**One Document Service middleware**, registered in `server/src/index.ts`
`register()` (`:14-73`). It hooks **`create` only** — not `update`, not
`delete` — with three rules:

| Rule | Type | What it does |
|---|---|---|
| 1 (`:15-36`) | `api::video.video` | Throws `ApplicationError('youtubeVideoId is required')` when absent; `findFirst` on the id and throws ``A video for this id already exists. documentId=${existing.documentId}`` on a hit. The comment calls it "the authoritative gate" |
| 1b (`:37-57`) | `api::transcript.transcript` | Identical. Its comment notes the schema is already `unique: true` at the DB level and this "returns a cleaner error and handles races in-flight" |
| 2 (`:59-71`) | `api::tag.tag` | **Mutates `data.name`** through `normalizeTagName` (trim, lowercase, collapse whitespace). The only server-side data transform in the repo — it silently rewrites caller input |

**No lifecycle files.** No `src/api/*/content-types/*/lifecycles.*`.

**No cron.** `server/config/cron-tasks.ts` does not exist and
`server/config/server.ts` sets no `cron` key.

**No local plugins.** `server/src/plugins/` does not exist, and
`server/config/plugins.ts` exports an empty object.

**Three server modules outside the API folders:**
`server/src/services/bm25-core.ts` (the synced copy),
`server/src/services/bm25-search.ts` (its search wrapper, used by the
transcript-search MCP tools), and `server/src/mcp/registry.ts`, now **types
only** — its header records that the hand-rolled `Map` registry was deleted
along with the `/api/mcp` transport. `server/src/mcp/utils/embeddings.ts` is
covered in §6.

**REST defaults** (`server/config/api.ts`): `defaultLimit: 25`,
`maxLimit: 100`, `withCount: true`.

**Body limits** (`server/config/middlewares.ts`): `jsonLimit`, `formLimit`
and `textLimit` all raised to `20mb`. ⚠️ framework behavior — the installed
`koa-body` defaults are `jsonLimit: '1mb'`, `formLimit: '56kb'`,
`textLimit: '56kb'` (`server/node_modules/koa-body/lib/types.js:31,35,39`),
so all three are raised, not just the JSON one.

The MCP adapter carries its own `MAX_WIRE_BYTES = 950_000`, compared as
`bytes * 2 + 2048` (`server/src/mcp-official/adapter.ts:114-127`); an
over-budget result is replaced by a `RESULT_TOO_LARGE` object with per-tool
shrink hints (`:69-82`).

## 3. Auth and permissions

### No end-user auth

There is no sign-in anywhere in the product. No login route, no session, no
per-user data in any schema. `client/src/routes/about.tsx:30` states "Zero
auth".

### Session

**None.** There is no session to store, send, expire or check. A grep of
`client/src/` for `cookie|session|auth|jwt|login|bearer` returns only
comments, the Strapi bearer header, YouTube's `youtube-nocookie` embed host,
and `youtubei.js`'s `generate_session_locally`. `strapi::session` is present
in `server/config/middlewares.ts` as part of Strapi's stock stack and is used
by the admin panel. ⚠️ framework behavior — that the admin panel is what
consumes it is not visible in the repo.

Strapi's own admin panel has its own auth (`ADMIN_JWT_SECRET` in
`server/.env.example`). ⚠️ not in code — who holds admin accounts.

### Public role

`server/src/index.ts` `bootstrap()` seeds **21 public-role actions**
(`:105-132`), one at a time, each skipped if a row already exists
(`:146-160`):

| Type | Seeded actions |
|---|---|
| `video` | `find`, `findOne`, `create`, `update` |
| `tag` | `find`, `findOne`, `create` |
| `transcript` | `find`, `findOne`, `create`, `update` |
| `note` | `find`, `findOne`, `create`, `update`, **`delete`** |
| `digest` | `find`, `findOne`, `create`, `update`, **`delete`** |

The comment above the array states "Delete stays admin-only so we don't
accidentally nuke the knowledge base via the UI" (`:97-99`), and `note` and
`digest` are nonetheless granted `delete`. `video`, `tag` and `transcript`
are not.

⚠️ not in code — permissions changed in the admin panel since the last boot.
`bootstrap()` seeds but does not revoke, so a grant added by hand persists.

### MCP tiers

The only gated surface. Admin API tokens, tiered by three custom permissions
registered in `server/src/mcp-official/permissions.ts`:

**22 registered tools from 20 files** — `server/src/mcp/tools/tags.ts`
exports three (`listTagsTool`, `tagVideoTool`, `untagVideoTool`), so the file
count and the tool count differ.

| Permission | Tools | Meaning |
|---|---|---|
| `api::yt-kb-mcp.read` | 15 | `sideEffects: 'none'` |
| `api::yt-kb-mcp.write` | 4 | `sideEffects: 'write'` |
| `api::yt-kb-mcp.maintenance` | 3 | `sideEffects: 'external'` — `addVideo`, `fetchTranscript`, `reindexEmbeddings` |

Counted from `server/src/mcp-official/tools.ts:43-72`. The comment at
`server/src/mcp-official/permissions.ts:37-45` still lists `generateDigest`
under maintenance; `tools.ts:57-61` re-tiered it to `sideEffects: 'none'`
with a comment explaining why, so that comment is stale.

The tier is derived from each tool's declared `sideEffects` in
`server/src/mcp-official/tools.ts`, so it follows from what the body does. A
token sees only the tools its grants allow.

⚠️ not in code — which tokens exist and which tiers each holds. The owner's
instance has one admin token holding all three.

## 4. Client route tree (`client/src/routes/`)

TanStack Router, file-based. `routeTree.gen.ts` is generated.
Every route is public — there is no access control to describe. Nothing is
built ahead. ⚠️ framework behavior — `client/vite.config.ts` sets no `ssr` or
prerender option, so render mode is TanStack Start's default; route loaders
also run in the browser on client-side navigation. What is always server-side
is the `createServerFn` call inside a loader, not the loader itself.
**[CORE]** marks the core loop.

| Route | Loader / data | Credential | States |
|---|---|---|---|
| `__root.tsx` | none | — | One `QueryClient` in `useState`, `refetchOnWindowFocus: false`, `staleTime: 60_000` (`:33-45`). Renders `Header`, `ConditionalFooter`, `BottomNav`, `LibraryChat`. Inline theme-init script (`:16`). |
| `/` | `beforeLoad` redirects to `/feed` (`index.tsx:6-9`) | — | — |
| `/feed` **[CORE]** | Server-side loader (`feed.tsx:78-125`). Semantic mode: `semanticSearchVideos({limit: 90})`, min-score filtered client-side; on failure records `degradedFrom` and falls through. Then always `getFeed({pageSize: 9})` | `STRAPI_API_TOKEN`, server-side | Union `keyword \| semantic \| backend-error` (`:63-66`). `BackendErrorPanel` on backend error; degraded notice when semantic fails. Polls `router.invalidate()` every 3 s while any card is `pending`, keyword mode only (`:199-207`) |
| `/new-post` **[CORE]** | No loader. `NewPostForm` calls `shareVideo` / `suggestTagsForUrl` | server-side | Form-level |
| `/learn/$videoId` **[CORE]** | Server-side loader (`:90-108`): `getVideoByVideoId`; `lookup.error` → `backend-error`, no row → `unshared`, `generated` → `ready`, `failed` → `failed`, else triggers generation and returns `pending` | server-side | Four named states plus `FailedState`. While pending, invalidates every 3 s up to 200 attempts (10 min) and on `visibilitychange` / `focus` (`:143-169`) |
| `/video/$documentId` | `getVideoByDocumentId` (`:8-13`) | server-side | `BackendErrorPanel` via `*WithStatus` |
| `/search` | `searchLibraryPassages({limit: 30})` (`:33-46`) | server-side | `{status:'empty'}` for a blank query; errors piped through `friendlyOllamaError` (`:43`) |
| `/digest` | `loadDigest({videoIds})` (`:39-48`), cache-first; **runs an LLM synthesis in the loader on a miss** | server-side | Has `pendingComponent: DigestPending` (`:50`) |
| `/digests` | `listSavedDigests({pageSize: 9})` (`:19-25`) | server-side | List empty state |
| `/settings` | No loader. `ContentSignalsPanel` + `EmbeddingCoveragePanel` fetch on mount | server-side | Per-panel |
| `/about` | none | — | Static |

### Server-side handlers (client)

Every handler below runs on the client app's own server. There is no session
to check, because there is no auth; each acts with the app's own
`STRAPI_API_TOKEN` for any visitor who reaches it.

| Handler | Credential to Strapi | What it checks first |
|---|---|---|
| **47** `createServerFn` server functions in `client/src/data/server-functions/` (videos 33, digests 6, notes 5, digest 2, reader 1) | `STRAPI_API_TOKEN` via `strapiFetch` | 37 carry a zod `.inputValidator`. **Ten have none** — all zero-argument: `countMissingValueScores` (`videos.ts:1430`), `backfillValueScores` (`:1447`), `listRegenerableVideos` (`:1558`), `countMissingSignalScores` (`:1607`), `backfillSignalScores` (`:1693`), `countMissingFinalScores` (`:1774`), `backfillFinalScores` (`:1794`), plus the three coverage readers. Four of them write rows across the whole library. No caller check on any of the 47 |
| `POST /api/chat` (`routes/api.chat.tsx:101-184`) | same | JSON parses → 400; missing fields → 400; backend error → 503; no row → 404; `summaryStatus !== 'generated'` → 409 |
| `POST /api/ask` (`routes/api.ask.tsx:49-182`) | same | `question` required and ≤ 1000 chars → 400; retrieval throw → 500; zero passages → hand-built empty-citation SSE |
| `POST /api/digest-chat` (`routes/api.digest-chat.tsx:82-149`) | same | `videoIds` 2–5 → 400; `messages` required → 400; then 503/404/409 per video |
| `POST /api/notes/compose` (`routes/api.notes.compose.tsx:74-215`) | same | `prompt` required, ≤ 4000 chars → 400; 503/404/409; a skill without `composerPrompt` → 400 |

**No GET handler exists on any API route.** All four are POST-only.
`getGenerationProgress` is deliberately POST to avoid HTTP caching
(`client/src/data/server-functions/videos.ts:383-386`).

Visitor input does reach Strapi query construction, but only through zod
schemas that constrain type, length and enum — for example `VideoIdSchema`
is `1..32` matching `/^[\w-]+$/`
(`client/src/data/server-functions/videos.ts:116-122`). No handler passes
raw `filters`, `populate` or `fields` from a request through to Strapi.

## 5. Site route tree (`site/src/pages/`)

Astro 6, fully static. Every page is built ahead; there is no server and no
runtime call to Strapi. All pages are public.

| Route | Data | How it renders |
|---|---|---|
| `/` | `getCollection('videos')` (`index.astro:8`) | Static. Cards + `SearchBox` + tag list |
| `/v/[videoId]` | `getStaticPaths()` over the collection (`:14-15`) | One static page per video. Slug is the YouTube id |
| `/t/[tag]` | `getStaticPaths()` (`:7`) | One static page per tag |
| `/topics` | `getCollection` (`:6`) | Static tag index |
| `/articles` | `getCollection` (`:6`) | Static list of videos with a readable article |
| `/search-index.json` | `APIRoute` GET over the collection (`search-index.json.ts:7-8`) | Emitted as a static JSON file at build. Served with `Cache-Control: public, max-age=300` (`site/netlify.toml`) |
| `/404` | none | Static |

**The one data path is `site/src/lib/strapi.ts`.** Beyond `VIDEO_FIELDS` it
declares `NESTED_FIELDS` (`:6-11`), an allowlist for the populated
components: `keyTakeaways.text`, `sections.heading/body/timeSec`,
`actionSteps.title/body`, `tags.name`. It sorts on two keys —
`summaryGeneratedAt:desc` then `youtubeVideoId:asc` (`:31-34`) — because a
single sort key lets paging drop or repeat a row across pages. It pages at
`DEFAULT_PAGE_SIZE = 100` with a `pageCount` derived from
`meta.pagination` (`:114-123`).

It **refuses to build** rather than publish a partial library, on six
conditions: Strapi unreachable (`:71-77`), a non-OK status (`:79-81`), a
payload that is not a collection (`:88-92`), a missing
`meta.pagination.total` (`:96-108`), `rows.length !== expectedTotal`
(`:125-130`), and zero rows (`:132-137`). A row with no `youtubeVideoId`
throws from the loader itself (`site/src/content.config.ts:46-52`).

**Search runs in the browser** over the prebuilt index with MiniSearch
(`site/src/lib/search-engine.ts`, driven by
`site/src/components/search-client.ts`) — no per-keystroke round trip.

**How published content reaches the live site:** only a manual rebuild. There
is no webhook, no ISR and no scheduled build — `site/netlify.toml` sets an
**empty** build command, so Netlify never builds. The owner runs
`yarn site:publish` (`publish-site.sh`). A summary generated in the app does
not appear on the site until someone runs that script.

**What the site publishes** is constrained by an allowlist, not by omission.
`site/src/lib/video.ts` declares `VIDEO_FIELDS` (12 fields sent as Strapi
`fields[]`) and `FORBIDDEN_FIELDS` (`transcriptSegments`,
`summaryEmbedding`, `passageEmbeddings`, `rawText`, `rawSegments`).
`site/scripts/verify-output.mjs` fails the build if any forbidden field
reaches `dist/`, and `site/src/lib/strapi.test.ts` plus
`site/src/lib/output-guard.test.ts` cover both halves. **No transcript, no
embedding and no BM25 index is published.**

**Titles, descriptions and share images:** `site/src/layouts/BaseLayout.astro`
takes a title and description per page; `displayTitle`
(`site/src/lib/video.ts`) prefers `summaryTitle` over `videoTitle`.
`site/src/layouts/BaseLayout.astro` emits only `charset`, `viewport` and a
conditional `description` (`:19-22`) — **there is no `og:` or `twitter:` tag
on any page**, so a shared link carries no title, description or image of its
own beyond the `<title>`.

## 6. Outside services and other apps

| Service | What it does | Who calls it | Key / variable | On failure |
|---|---|---|---|---|
| **Ollama** (local) | Chat, summarisation, embeddings, synthesis | The client's server **and Strapi** — `server/src/mcp/utils/embeddings.ts:50` POSTs `${OLLAMA_HOST}/api/embeddings`, reached by the `reindexEmbeddings` MCP tool | No key. `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_CHAT_MODEL`, `OLLAMA_SYNTHESIS_MODEL`, `OLLAMA_EMBEDDING_MODEL` | `friendlyOllamaError` (`client/src/lib/services/ollama-errors.ts:32`) names the host or the missing model. Generation marks the row `failed` and caches the failure 5 min |
| **YouTube captions** via `youtubei.js` | Fetches transcripts | The client's server (`client/src/lib/services/youtube-transcript.ts`), and Strapi has its own copy (`server/src/services/youtube-transcript.ts`) | No key. Optional `TRANSCRIPT_PROXY_URL` | Throws a sign-in/`LOGIN_REQUIRED` hint pointing at `TRANSCRIPT_PROXY_URL` (`:234-236`) |
| **YouTube oEmbed** | Video title and author | The client's server (`client/src/lib/services/learning.ts:204-220`) **and Strapi** (`server/src/services/youtube-transcript.ts:235-241`, reached by `server/src/mcp/tools/add-video.ts:81`) | No key | **Swallows every error into `{}`** — a share proceeds with no title |
| **DuckDuckGo HTML** | The chat `webSearch` tool | The client's server (`client/src/lib/services/web-search.ts:51`) | No key | `withRetry({attempts: 2})`, then swallowed into `[]` (`:98-101`) |
| **YouTube** (`youtube-nocookie.com`) | The video player iframe | **The visitor's browser** — the only third party a visitor contacts, on both surfaces (`site/src/lib/player.ts`, `site/src/components/player-client.ts`, `client/src/components/VideoCard.tsx:245`) | No key | The iframe fails to load; nothing in either app detects it |
| **Netlify** | Hosts the static site | The owner's machine, via the Netlify CLI in `publish-site.sh` | CLI's own stored auth. ⚠️ not in code | `publish-site.sh` exits non-zero |

**No payments, email, storage, search or analytics service.** No cloud AI
provider — forbidden by `docs/adr/0001`.

**Test modes.** Ollama and Strapi are both local, and the two test families
that need them self-skip when unreachable
(`client/src/lib/services/embeddings.ranking.test.ts`,
`videos.smoke.test.ts`). The YouTube, oEmbed and DuckDuckGo calls have **no
test mode, no mock and no base-URL override** — they are called through a bare
`fetch` or the `youtubei.js` client with no injection point.

**How the owner finds out a service failed.** Ollama and Strapi failures
surface in the UI through the two translators. Transcript and oEmbed failures
surface as a `failed` row or a missing title. There is **no alerting, no
status page and no log aggregation**; `strapiFetch` logs failures to the
server console with the body truncated to 500 chars
(`client/src/lib/services/strapi-client.ts:161-164`).

**Other apps in the repo:** none beyond the three packages. No worker, no
second API, no shared package.

Scripts: `scripts/sync-bm25-core.mjs` (build-time copy), `copy-env.mjs`,
`start.sh`, `publish-site.sh`, and `server/scripts/verify-mcp-tools.cjs`.

**One more script writes data, and it is stale cross-project code.**
`server/scripts/seed.mjs` (dated 2026-05-03) POSTs
`/api/auth/local/register` and `/api/auth/local`, GETs
`/api/users/me?populate[profile]`, PUTs `/api/profiles/:documentId` and POSTs
`/api/posts`, against `process.env.STRAPI_URL`, with three hardcoded
passwords (`:13, :25, :36, :49, :66-67, :73, :80, :91, :100, :106`). Its
entities (`heightCm`, `bio`, `waistCm`, `profiles`, `posts`) match no content
type in this repo. **No script references it** — both `seed` scripts are
`strapi import` — so it never runs, but it is auth-adjacent code that writes
data and it contradicts §3's "no sign-in anywhere in the product".

Dead client code of the same kind:
`client/src/lib/validations/post.ts:112-131` exports
`ProfileEditFormSchema` and `ProfileUpdateInputSchema` (displayName, bio)
under a header reading "auth/display-name/bio only for this app". No profile
route, component or server function exists.

## 7. Operations (robustness sweep)

One line per sweep item.

| Item | As built |
|---|---|
| **Silent failures and a replay path** | Partly. Generation failures set `summaryStatus: 'failed'` and are cached 5 min (`generation-state.ts:75`); `/learn` renders `FailedState` with a retry. Embedding and passage-index writes after a summary are **best-effort and never fail the summary** (`learning.ts:1222-1291`), so a row can have a summary and no vector with nothing surfacing it; `/settings` coverage panels are the only place that shows it. The oEmbed and DuckDuckGo calls swallow errors by design. **No replay path for a row whose `summaryStatus` is wrong** — see below |
| **Uniqueness under concurrency** | Handled at the database level on all four natural keys (`video.youtubeVideoId`, `transcript.youtubeVideoId`, `tag.name`, `digest.videoSetKey` — each `unique: true`), plus an application-level pre-check in the Document Service middleware (`server/src/index.ts:15-57`) that throws naming the existing `documentId`. Both the middleware pre-check and `shareVideo` (`client/src/data/server-functions/videos.ts:193`) are read-then-write, so **the DB constraint is what actually serialises concurrent creates**; the middleware exists for a cleaner error, as its own comment at `:37-39` says. Digest upsert by `videoSetKey` has the same read-then-write shape (`client/src/lib/services/digests.ts:287`) backed by the same constraint |
| **Cron overlap guard and retry cap** | N/A — there is no cron. `server/config/server.ts` sets no `cron` key and `config/cron-tasks.ts` does not exist |
| **Transactional workflow steps** | Not handled. Generation writes the transcript, then the summary, then the embedding, then the passage index as four separate Strapi calls with no transaction (`learning.ts:915-1291`). A failure between them leaves the row half-written; the code marks `failed` at the two main seams (`:1317`, `:1339`) |
| **Session lifetime** | N/A — no end-user session exists |
| **User-data exposure** | The site's `fields[]` allowlist plus `verify-output.mjs` keep transcripts, embeddings and the BM25 index out of published output (`site/src/lib/video.ts`, `site/scripts/verify-output.mjs`). Inside the app, `stripVideoForClient` nulls `transcriptSegments` before a row crosses to the browser (`videos.ts:471-474`); `semanticSearchVideos` additionally nulls `summaryEmbedding` (`:1049-1053`) but **not** `passageEmbeddings` |
| **Metric definitions** | `finalScore` is defined once in `computeFinalScore` (`videos.ts:109`) with `FINAL_SCORE_WEIGHTS` (`:100`); the five signals are each a named function in `content-signals.ts`. `score-consistency.test.ts` asserts every writer scores a row identically |
| **Human correction loops** | `updateSectionTimecode` lets a section's timecode be corrected (`videos.ts:295`). Verdict, signal and embedding regeneration are per-row buttons on `/learn`. Tags are editable. **A wrong `summaryStatus` cannot be corrected from the UI** |
| **Versioning of computed results** | Both artifacts carry their params. Embeddings store `embeddingModel` + `embeddingVersion`, and a mismatch flags the row stale (`embeddings.ts:156`). The BM25 index stores `CURRENT_INDEX_PARAMS` (`bm25-core.ts:364`) and `loadStoredIndex` refuses a stale row rather than scoring against yesterday's arithmetic (`:464`). `/settings` reports current/stale/missing for both and rebuilds |
| **Cost guards** | N/A for money — inference is local and free. For time: `MAP_CONCURRENCY` (default 1), `embedBatch` 2, backfill `CONCURRENCY` 3, `SINGLE_PASS_TOKEN_BUDGET` 15_000, `MAX_EMBED_CHARS` 8000, `MAX_TRANSCRIPT_CHARS` 18_000 on the compose route. **No timeout or abort on any Ollama, Strapi, YouTube or DuckDuckGo request from the server side** — the only `AbortController` in the repo is browser-side in `client/src/lib/hooks/useLibraryChat.ts:190` |
| **Aging and SLA visibility** | Partly. `summaryGeneratedAt`, `embeddingGeneratedAt` and `readableArticleGeneratedAt` are stored. `/settings` shows embedding, passage and index coverage. **Nothing shows a row stuck in `pending`** |
| **Audit trail** | Not handled. No `createdBy` use, no change log, no event table. Strapi's `createdAt` / `updatedAt` are the only history |
| **Search** | Three layers, and two of them are **RRF hybrids, not pure cosine**. Per-video chat: multi-query BM25 over transcript chunks (`chat-retrieval.ts`). Cross-video discovery and `/feed` semantic mode: dense cosine fused with BM25 over `buildVideoSearchText` (`retrieval.ts:298`) via `fuseRRF` at `:346` (`rankVideosByQuery`) and `:382` (`rankRelatedVideos`), plus tag and title boosts. `/search` passages: the same fusion at `:274-284` (`rankPassages`). The site searches in the browser with MiniSearch over a prebuilt index |
| **Empty states** | `/feed` empty library, `/search` `{status:'empty'}` for a blank query, `/learn` `unshared`, `/digests` empty list. `BackendErrorPanel` distinguishes "no row" from "backend down" on the three routes that use the `*WithStatus` helpers |

### Rows the sweep's first and eleventh lines point at

The live database holds **4 videos with `summaryStatus: 'pending'`** that are
not pending: each has a transcript, an `aiModel` of `gemma4-kb:latest`, and a
300–370 byte `summaryOverview`, created 2026-04-18/19 and last touched
2026-04-20/22. Generation ran, wrote content, and never flipped the status.
Commit `01f76f2` ("stop leaving rows stuck pending", 2026-09-30) postdates
them and repairs nothing already written. A fifth row, `test-smoke-001`
(created 2026-05-06, no transcript), comes from
`client/src/lib/services/videos.smoke.test.ts`, which writes to whatever
Strapi `STRAPI_URL` names.

⚠️ not in code — all of this is the state of the owner's database, read at
2026-10-31.

## 8. Agent and bulk-processing surface

Relevant to `03`'s change goals, so recorded as built.

**MCP is the only agent surface.** 20 tool bodies under
`server/src/mcp/tools/`, registered through `server/src/mcp-official/`.
There is **no CLI** for library operations: every script in the root
`package.json` is dev, build, test, seed, export or deploy tooling.

**`addVideo` ingests one URL and does not generate.**
`server/src/mcp/tools/add-video.ts` creates the row; generation lives
entirely in the client's Ollama pipeline, off the server by design, so a row
created over MCP stays `pending` until the client picks it up through
`/learn/$videoId`'s loader.

**No batch infrastructure on the server.** No queue, no job table, no
worker, no cron. `summaryStatus` is a row state nothing polls server-side.

**Batch work that exists is client-side and serial.** The Settings bulk AI
re-rate processes strictly one video at a time through
`runCancellableBatch` (`client/src/lib/cancellable-batch.ts:47-63`,
driven from `client/src/components/ContentSignalsPanel.tsx:116-126`), each
item a full Ollama call. The backfills in
`client/src/data/server-functions/videos.ts` write one row per `await`
inside their page loops (`:1469-1482`, `:1720-1747`, `:1817-1826`), and
`reindexAllPassages` is serial across videos by design (`:1148-1150`).
`reindexAllEmbeddings` is the one with a worker pool, at `CONCURRENCY = 3`
(`:800`).

**Nothing accepts a list of videos.** `shareVideo` takes one `url`
(`videos.ts:159-164`); `addVideo` over MCP takes one URL. The only
multi-video inputs are digests, capped at 2–5
(`client/src/lib/services/digest.ts:19-20`).

## 9. Performance characteristics

Descriptive, from the code.

**Two files share the basename `videos.ts`.** Below,
`client/src/lib/services/videos.ts` is the service layer and
`client/src/data/server-functions/videos.ts` is the server-function layer;
each citation names its path.

**Loaders that read the whole library.** `listAllVideosForEmbeddingService`
(`client/src/lib/services/videos.ts:339-364`) pages every
`summaryStatus: 'generated'` row at `pageSize: 100`, up to 50 pages. It is
called from `client/src/data/server-functions/videos.ts` by `/feed` in
semantic mode (`:1007`), `/search` (`:1261`), `RelatedVideos` on every learn
page (`:902`), `suggestTagsForUrl` from the share form (`:1375`), and all
four coverage and reindex server functions.

**It issues no `fields` restriction** (`:343-349`), so each row arrives with
every scalar and JSON attribute — `summaryEmbedding`, `passageEmbeddings`,
`transcriptSegments`, `readableArticle` — plus
`populate: ['tags','keyTakeaways','sections']`. `stripVideoForClient` nulls
only `transcriptSegments` (`:471-474`).

`feedQuery` likewise sets no `fields`, only `populate: ['tags']`
(`:274-281`), so a 9-row feed page carries the same JSON columns;
`fetchFeedService` strips only `transcriptSegments` (`:297-299`).

`forEachVideoWithIndex` pages at 25 rather than 100, specifically because
the stored indexes are the heaviest field (`:367-387`).
`backfillSignalScores` pages at 50 with `populate: {transcript: true}`, so
each page pulls 50 full `rawText` transcripts
(`client/src/data/server-functions/videos.ts:1698-1715`).

**Polling.** `/learn/$videoId` invalidates its loader every 3 s for up to
200 ticks while pending, and each tick re-runs `getVideoByVideoId` +
`triggerSummaryGeneration` + `getGenerationProgress`
(`learn.$videoId.tsx:143-169`). `/feed` invalidates every 3 s while any card
is pending (`feed.tsx:199-207`).

**LLM work inside a route loader.** `/digest`'s loader runs a full synthesis
on a cache miss (`client/src/data/server-functions/digests.ts:194`).

**Unbounded prompt input.** `client/src/lib/services/notes.ts:184-193` feeds
the entire cleaned transcript into the chat→note summariser with no character
cap (used at `:255`, `:271-273`). The compose route caps its excerpt at
18_000 chars (`api.notes.compose.tsx:45`); the server function does not.

## 10. Hosting and environments

| App | Host | Environments |
|---|---|---|
| Client | The owner's machine, `yarn dev` / `start.sh`, port 3005 | Local only |
| Server (Strapi) | The owner's machine, `strapi develop`, port 1340, SQLite at `server/.tmp/data.db` | Local only |
| Site | **Netlify**, deployed as prebuilt output | Local (`astro dev`, 4330), Netlify draft (`--draft`), Netlify production |

There is **no Dockerfile, no `vercel.json`, no `wrangler.toml`** and no
deploy job in CI. The Strapi app ships Strapi's stock `deploy` script and
`@strapi/plugin-cloud` 5.52.1, and nothing in the repo invokes either.

Overriding the builder's Strapi Cloud default is explained by
`docs/adr/0001` and `docs/adr/0002`: inference is local, and SQLite was
chosen for zero-config local development.

The site's only Strapi contact is at build time, from the owner's machine
(`site/src/content.config.ts`). `SITE_URL` and `STRAPI_BASE_URL` are its two
variables (`site/.env.example`).

The live site is **`https://boisterous-lamington-cc0eed.netlify.app`**,
hardcoded as `LIVE_URL` in `publish-site.sh:32`; the script also requires
`site/.netlify/state.json` to exist as proof of the project link and dies
with instructions if it does not (`:82`). That file holds `siteId`
`def3e509-9b64-4019-941a-8eb630c71051`.

⚠️ not in code — **whether a build command is set in the Netlify UI.** The
in-repo `command = ""` is only half the answer: the CLI's gitignored
resolved-config cache `site/.netlify/netlify.toml` records
`commandOrigin = "ui"`, which means a command is configured there. If one is,
"Netlify never builds it" holds only because the repo is not connected to a
git-triggered build. Also unknown: the site's environment variables, whether
any deploy hook exists, and whether anything runs anywhere but the owner's
machine.

### CORS

`server/config/middlewares.ts` lists **bare `strapi::cors`** with no config
object, so the installed defaults apply. Read from the installed source at
`server/node_modules/@strapi/core/dist/middlewares/cors.js`:

```
origin: '*', credentials: true, maxAge: 31536000,
methods: GET POST PUT PATCH DELETE HEAD OPTIONS,
headers: Content-Type Authorization Origin Accept
```

`matchOrigin` in that file returns `requestOrigin` whenever the configured
list contains `'*'`, so the response echoes the caller's own `Origin` back
rather than a literal `*`, with `credentials: true` alongside it.

No browser calls Strapi directly in normal operation: the client calls it
from its own server through `strapiFetch`, and the site calls it only at
build time from a Node process. `HOST` defaults to `0.0.0.0`
(`server/config/server.ts`), so Strapi binds every interface. ⚠️ not in code
— whether the owner's machine is reachable from outside its own network.

### CI and deploys

`.github/workflows/ci.yml`, on push to `main` and every pull request, Node
22: `yarn install:all`, then `tsc --noEmit` for client, server and site
(the site preceded by `SITE_SKIP_STRAPI_FETCH=1 npx astro sync`), then
`yarn test`, `yarn site:test`, and `yarn build` in `client`.

**No deploy runs in CI.** The site deploys from the owner's machine through
`publish-site.sh`. Nothing deploys the client or the server.

Both shell entry points assume the owner's machine:
`publish-site.sh` shells out to `python3` to parse Strapi's JSON (`:53`) and
uses `curl` throughout; `start.sh` is macOS-only (`launchctl setenv`,
`open -a Ollama`, `lsof`) and kills whatever holds ports 1340 and 3005
(`:89-95`).

## 11. Environment variables

Names only, from `.env.example` files and `client/src/lib/env.ts`.

### Node engine

Declared only by the Strapi app: `server/package.json:37-40` has
`"engines": { "node": ">=20.0.0 <=24.x.x", "npm": ">=6.0.0" }`.
`client/package.json` and `site/package.json` declare no `engines` at all.
These are declarations, not tested support. CI runs Node 22
(`.github/workflows/ci.yml:26`), which is a different fact.

**Client** (`client/src/lib/env.ts` is the only **non-test** module reading
`process.env`, via `readEnv` at `:11-16`; `videos.smoke.test.ts:14` and
`playwright.config.ts:13` also read it): `STRAPI_URL`,
`STRAPI_API_TOKEN`, `TRANSCRIPT_PROXY_URL`, `OLLAMA_BASE_URL`,
`OLLAMA_MODEL`, `OLLAMA_CHAT_MODEL`, `OLLAMA_SYNTHESIS_MODEL`,
`OLLAMA_EMBEDDING_MODEL`, `EMBEDDING_VERSION`,
`PASSAGE_EMBEDDING_VERSION`, `MAP_CONCURRENCY`. `OLLAMA_HOST` is derived,
not read (`:34`).

`OLLAMA_SYNTHESIS_MODEL` is read at `client/src/lib/env.ts:43` but is **not
declared in `client/.env.example`** — documented only in the comment at
`:38-41`.

Startup validation **warns and never throws** on an empty `OLLAMA_MODEL`,
`OLLAMA_CHAT_MODEL` or `STRAPI_URL` (`client/src/lib/env.ts:90-105`).

**Server** (`server/.env.example`): `HOST`, `PORT`, `APP_KEYS`,
`API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`,
`ENCRYPTION_KEY`, `JWT_SECRET`, `DATABASE_CLIENT`, `DATABASE_FILENAME`,
`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`,
`DATABASE_PASSWORD`, `DATABASE_SSL`, `MCP_ENABLED`, `OLLAMA_HOST`,
`OLLAMA_EMBEDDING_MODEL`, `EMBEDDING_VERSION`, `TRANSCRIPT_PROXY_URL`.

**Server, read by code but absent from `.env.example`** —
`DATABASE_URL`, `DATABASE_SCHEMA`, `DATABASE_SSL_KEY`, `DATABASE_SSL_CERT`,
`DATABASE_SSL_CA`, `DATABASE_SSL_CAPATH`, `DATABASE_SSL_CIPHER`,
`DATABASE_SSL_REJECT_UNAUTHORIZED`, `DATABASE_POOL_MIN`,
`DATABASE_POOL_MAX`, `DATABASE_CONNECTION_TIMEOUT`
(`server/config/database.ts:16-21, 24, 28, 42, 44, 58`); `FLAG_NPS`,
`FLAG_PROMOTE_EE` (`server/config/admin.ts:19-20`); `STRAPI_URL`
(`server/scripts/seed.mjs:7`).

**Read by `start.sh` only** (never by the app): `OLLAMA_KEEP_ALIVE`,
`OLLAMA_NUM_PARALLEL` (`start.sh:18-19`).

**Site** (`site/.env.example`): `SITE_URL`, `STRAPI_BASE_URL`. Plus
`SITE_SKIP_STRAPI_FETCH`, read in `site/src/content.config.ts:30` and
refused by `site/scripts/verify-output.mjs` and `publish-site.sh`.

**No framework public prefix is used anywhere** — no `VITE_`, `PUBLIC_` or
`NEXT_PUBLIC_` variable exists, so no server token can reach a browser
bundle through one. Values are never read in this document.

## 12. Tests

**Client** — vitest, `client/vitest.config.ts`, deliberately plugin-free so
unit tests don't boot the Start/nitro/tailwind chain (`:3-5`).
`include: ['src/**/*.{test,spec}.{ts,tsx}']`, `exclude: ['e2e/**', …]`
(`:24-25`). Node environment by default with per-file
`// @vitest-environment jsdom` opt-in (`:11-18`); vitest globals off, so
`cleanup()` is called manually (`:19-21`).

**33 files** match the include glob. The largest:
`transcript.test.ts` (50 cases),
`content-signals.test.ts` (26), `strapi-client.test.ts` (23),
`chat-stream.test.ts` (15), `generation-state.test.ts` (15),
`score-consistency.test.ts` (15), `chat-retrieval.test.ts` (13),
`retrieval.test.ts` (11), `cancellable-batch.test.ts` (8).

Two self-skip when their live dependency is unreachable:
`embeddings.ranking.test.ts` (Ollama) and `videos.smoke.test.ts` (Strapi),
so the total is environment-dependent.

**Measured at `8ac5ae3` with Strapi live: 306 tests across 33 files, 305
passing and 1 failing** — `videos.smoke.test.ts > public role can create a
tag`, `expected 400 to be 200`. `CLAUDE.md` documents that failure as
pre-existing: Strapi core does not auto-populate `uid` fields outside the
admin UI, and `tag.slug` is a required `uid`. `CLAUDE.md` also still states
230 tests and 96 site tests, both stale against this commit.
`bm25-core.sync.test.ts` fails if `server/src/services/bm25-core.ts` drifts
from the client copy. `seroval-safety.test.ts` covers the server→client
serialisation boundary.

**Playwright** — `client/playwright.config.ts`: `testDir: './e2e'`,
`workers: 1`, `retries: 0`, `timeout: 30_000`, chromium only,
`baseURL: http://localhost:3005`. It **does not start the stack**
(`:1-29`). One spec, `e2e/seroval-surfaces.spec.ts`, **4 cases** in a single
`test.describe` (`:48, :66, :87, :123`).

**Site** — its own vitest config and **105 cases across 11 files**, all
passing at `8ac5ae3`, including
`strapi.test.ts`, `output-guard.test.ts`, `video.test.ts`,
`markdown.test.ts`, `search-engine.test.ts`. The root `yarn test` is the
client's suite and does not reach them; `yarn site:test` does, and CI runs
both.

**Server — no test suite.** `server/package.json` has a `verify:mcp`
script (`scripts/verify-mcp-tools.cjs`) that is not a CI step, and no
`*.test.ts` anywhere under `server/src/`. The server's only automated gate
is `tsc --noEmit`, and `server/tsconfig.json` has `strict: false`.
