# Technical Requirements

> As built — reconstructed from `yt-knowledge-base` @ `721f210` and
> `strapi-cloud-backend-main-site` @ `c3d0b74` (local checkout
> `~/work/plugin-dev/strapi-prod`, with installed `node_modules`),
> 2026-11-08. Describes the code, not intentions. main-site is read only as
> a reference install of the two plugins below; it is not a target (`03`).
> Revised after checkpoint R (`reviews/R-reconstruction-review.md`).
> `PSRC/` = `server/src/plugins/yt-kb/server/src/`. `MAIN/` = the main-site
> checkout.
> `YT/` = `MAIN/node_modules/strapi-plugin-youtube-transcripts/dist/server/index.js`
> (2.6.2). `TS/` = `MAIN/node_modules/strapi-plugin-tanstack-ai/dist/server/index.js`
> (1.7.0).

## Strapi content types

### yt-kb (`strapi-plugin-yt-kb`)

All five: `draftAndPublish: false`, visible in the Content Manager, hidden
from the Content-Type Builder; no attribute is `private`
(`PSRC/content-types/*/schema.json`).

#### `plugin::yt-kb.video` — collection, `yt_kb_videos`

| Group | Attributes |
|---|---|
| Identity | `youtubeVideoId` string required unique ≤32; `url` text required ≤2000 |
| YouTube metadata | `videoTitle` text ≤300; `videoAuthor` string ≤200; `videoThumbnailUrl` text ≤2000; `caption` text ≤500 |
| Relations | `transcript` oneToOne → transcript (unidirectional); `tags` manyToMany → tag (owning, `inversedBy: videos`); `digests`, `notes` manyToMany (`mappedBy`) |
| Summary | `summaryStatus` enum `pending/generated/failed` required default `pending`; `summaryTitle` ≤200; `summaryDescription` ≤500; `summaryOverview` richtext; `watchVerdict` enum `skip/skim/worth_it`; `verdictSummary` ≤280; `verdictReason` ≤1000; `summaryGeneratedAt`; `aiModel` ≤100; components `keyTakeaways` (`ytkb.takeaway`), `sections` (`ytkb.section`, has `timeSec`), `actionSteps` (`ytkb.action-step`) |
| Scores | `valueScore`, `signalScore`, `finalScore` integer 0–100; `valueScoreSource` enum `model/derived`; `signalScores` json |
| Retrieval | `transcriptSegments` json (stored BM25 index + `rawSegments` + `durationSec`); `summaryEmbedding` json, `embeddingModel`, `embeddingVersion`, `embeddingGeneratedAt`; `passageEmbeddings` json |
| Reader | `readableArticle` richtext, `readableArticleGeneratedAt`, `readableArticleModel` |

Source: `PSRC/content-types/video/schema.json`.

#### `plugin::yt-kb.transcript` — `yt_kb_transcripts`

`youtubeVideoId` string required unique ≤32; `title` ≤300; `author` ≤200;
`thumbnailUrl` text ≤2000; `language` ≤10 default `en`; `durationSec`
integer ≥0;
`rawSegments` json (`[{text, startMs, endMs}]`); `rawText` richtext;
`fetchedAt` datetime. No relation back to Video
(`PSRC/content-types/transcript/schema.json`).

#### `plugin::yt-kb.tag` — `yt_kb_tags`

`name` string required unique 1–40; `slug` uid (`targetField: name`)
required; `videos` manyToMany (`mappedBy: tags`). Description text still
reads "Free-form tag on a Post" (`PSRC/content-types/tag/schema.json`).

#### `plugin::yt-kb.note` — `yt_kb_notes`

`title` ≤200; `body` richtext required; `source` enum
`chat/digest-chat/mcp/manual` required, default `manual`; `author` ≤120; `videos`
manyToMany (owning) (`PSRC/content-types/note/schema.json`).

#### `plugin::yt-kb.digest` — `yt_kb_digests`

`videoSetKey` text required unique ≤500; `title` required ≤200;
`description` ≤400; `overallTheme` richtext; `bottomLine` ≤800; components `sharedThemes`,
`uniqueInsights`, `contradictions`, `viewingOrder`; `articleMarkdown`;
`videos` manyToMany (owning); `model` (`PSRC/content-types/digest/schema.json`).

### `strapi-plugin-youtube-transcripts` 2.6.2 (as installed on main-site)

`plugin::youtube-transcripts.transcript`, collection `youtube_transcripts`,
`draftAndPublish: false`, visible in the Content Manager and the
Content-Type Builder (`YT/` L1240-1321). Attributes (L1258-1307):

| Attribute | Type | yt-kb transcript equivalent |
|---|---|---|
| `videoId` | string, **not required, not unique** | `youtubeVideoId` (required, unique) |
| `title` | string | `title` |
| `fullTranscript` | richtext | `rawText` |
| `transcriptWithTimeCodes` | json `[{text, start, end, duration}]`, ms (L124-129) | `rawSegments` `[{text, startMs, endMs}]` |
| `author` | string | `author` |
| `thumbnailUrl` | string | `thumbnailUrl` |
| `durationSec` | integer | `durationSec` |
| `language` | string (track actually used) | `language` (always `'en'`, `PSRC/services/fetcher.ts:44`) |
| `fetchedAt` | datetime | `fetchedAt` |
| `channelId` | string | none |
| `thumbnails` | json (all sizes) | none |
| `viewCount` | biginteger | none |
| `description` | text | none |
| `keywords` | json | none |
| `category` | string | none |
| `videoPublishedAt` | string (display text, only from `getInfo`) | none |

### main-site's own types (reference)

main-site has its own `api::tag.tag` (table `tags`) among others
(`MAIN/src/api/*/content-types/*/schema.json`). yt-kb's tag is
`plugin::yt-kb.tag` at `/api/yt-kb/tags`, table `yt_kb_tags`, so an app's
`api::tag` does not clash with it. main-site's other types, routes and
middlewares are out of scope.

## Components

Nine, category `ytkb`, registered in `register()` through
`strapi.get('components').add(...)`, which the code's own comment calls an
undocumented API (`PSRC/register.ts:19-37`; ⚠️ framework behavior — that
the registry accepts them before schema sync, on 5.60 as on 5.52):
| Component | Attributes |
|---|---|
| `ytkb.takeaway` | `text` string required ≤280 |
| `ytkb.section` | `timeSec` integer ≥0; `heading` required ≤200; `body` required ≤2000 |
| `ytkb.action-step` | `title` required ≤120; `body` required ≤600 |
| `ytkb.digest-shared-theme` | `title` required ≤200; `body` required ≤1500; `videoTitles` repeatable `ytkb.digest-video-title` |
| `ytkb.digest-video-title` | `title` required ≤300 |
| `ytkb.digest-unique-insight` | `videoTitle` required ≤300; `insight` required ≤600 |
| `ytkb.digest-contradiction` | `topic` required ≤200; `positions` repeatable `ytkb.digest-contradiction-position`, min 2 |
| `ytkb.digest-contradiction-position` | `videoTitle` required ≤300; `stance` required ≤400 |
| `ytkb.digest-viewing-order` | `videoTitle` required ≤300; `why` required ≤300 |

Source: `PSRC/components/*.json`.

## Dynamic zones

None in yt-kb.

## API surface

### REST (auto-generated)

Plugin content-API routes under `/api/yt-kb` (`PSRC/routes/index.ts`):
`GET/GET/POST/PUT/DELETE` on `videos`, `tags`, `transcripts`, `notes`,
`digests`, each handled by an un-overridden core controller
(`PSRC/controllers/index.ts:7-14`). ⚠️ framework behavior — scope per route
is `plugin::yt-kb.<type>.<action>`.

### Default population strategy

None configured; each caller passes `populate`. `getFeed` (`client/src/data/server-functions/videos.ts:106`) builds its
query in `client/src/lib/services/videos.ts` with `populate` but no
`fields` (`videos.ts:246-282`), and
`stripVideoForClient` nulls only `transcriptSegments` (`videos.ts:512-515`).
⚠️ framework behavior — with no `fields`, Strapi returns every non-private
attribute, so `/feed` rows would carry `passageEmbeddings` (~442 KB) and
`summaryEmbedding` (~14.8 KB) per video to the browser (`videos.ts:342-344`).

### Custom routes

| Route | Handler | Does |
|---|---|---|
| `POST /api/yt-kb/transcripts/fetch` `{data:{videoId, force?}}` | `fetcher.fetchTranscript` (`PSRC/controllers/fetcher.ts`) | 400 unless `videoId` matches `/^[A-Za-z0-9_-]{11}$/` and `force` is boolean/absent; calls `fetcher.fetchAndStore`; any throw becomes 502 `TranscriptFetchError` with the thrown message and a `warn` log line — YouTube refusals, and also the Document Service's duplicate-transcript error if two creates race (`PSRC/document-rules.ts:44-57`); else `{data: <sanitized transcript>, meta:{action: created/updated/skipped}}` |
| `POST /api/yt-kb/import/:type` `{data:[...]}` | `importer.importRecords` (`PSRC/controllers/importer.ts`) | 400 on unknown type or non-array. The body goes to the Document Service without content-API input sanitization (`controllers/importer.ts:17`, `services/importer.ts:105-112`); upserts by `documentId` (the create rules apply), then writes `created_at`/`updated_at` with knex (`services/importer.ts:89-137`). Answers 200 with `{created, updated, failed[]}`; failures are per record. Types must be imported in the order of `IMPORT_TYPES` (tag, transcript, video, note, digest) so relations resolve (`services/importer.ts:13-15`) |

`youtube-transcripts` adds `GET /api/youtube-transcripts/yt-transcript/:videoId`
(content API) and `GET /youtube-transcripts/yt-transcript/:videoId` (admin,
policy `admin::hasPermissions` with `plugin::youtube-transcripts.tool.fetch-transcript`).
Both return the stored row or fetch, save and return one. An invalid id
answers 200 `{error, data: null}`; a fetch that returns an error object
answers 400; thrown errors map to 404 (unavailable, captions disabled) or
502 (`YT/` L1322-1412).

### GraphQL (if applicable)

Not installed.

## MCP server (if enabled in stage 4)

### yt-kb's 21 tools

Registered in `register()` by `registerOfficialMcpTools` when plugin config
`mcp !== false` and `strapi.ai.mcp.isEnabled()` (`PSRC/register.ts:42-43`,
`PSRC/mcp-official/index.ts:28-49`). Name = the bare tool name; admin action
derived from `sideEffects` (`none`→`read`, `write`→`write`,
`external`→`maintenance`) (`PSRC/mcp-official/adapter.ts:31-35, 84-141`).
Input schemas are zod from `@strapi/utils` (peer), which loads `zod/v4`
on both 5.52.1 and 5.60 (`server/node_modules/@strapi/utils/dist/index.js:46`;
`MAIN/node_modules/@strapi/utils/dist/index.js:47`). In this repo that is
the zod 4 API shipped inside the `zod` 3.25.76 package; on 5.60 it is
`zod` 4.4.3. The adapter's and `CLAUDE.md`'s comments calling it zod 3
are wrong (`PSRC/mcp-official/adapter.ts:10, 45, 93`, `tools.ts:7, 12`). Results over 950,000
estimated wire bytes become `RESULT_TOO_LARGE` with a per-tool hint
(`adapter.ts:66, 114-127`). No tool calls Ollama (grep of `PSRC/`).

| Tier (action) | Tools |
|---|---|
| `plugin::yt-kb.read` (15) | `libraryStats`, `listVideos`, `searchVideos`, `getVideo` (strips `transcriptSegments`, `passageEmbeddings`, `summaryEmbedding`), `getTranscript` (modes `full` / `chunked` / `timeRange`), `searchTranscript` (stored BM25, else substring over `rawSegments`), `findTranscripts`, `crossSearchTranscripts` (BM25 over `generated` videos with a current index), `listTranscripts`, `aggregateByTag`, `listUntagged`, `listTags`, `relatedVideos` (needs a current `summaryEmbedding`), `getReadableArticle`, `generateDigest` (returns material and guidance; writes nothing, calls no model) |
| `plugin::yt-kb.write` (4) | `saveSummary`, `tagVideo`, `untagVideo`, `saveNote` |
| `plugin::yt-kb.maintenance` (2) | `addVideo`, `fetchTranscript` |

Source: `PSRC/mcp-official/tools.ts:40-71`, `PSRC/mcp/tools/*.ts`.
yt-kb registers in `register()`; `youtube-transcripts` and `tanstack-ai`
register in `bootstrap()` (`YT/` L1123-1125, `TS/` L1377-1393). The MCP
`fetchTranscript` checks `videoId` only with `min(1)`, accepts a
caller-supplied `proxyUrl`, and logs nothing on failure
(`PSRC/mcp/tools/fetch-transcript.ts:11-25`). Strapi wraps a tool that
throws as `Tool "<name>" execution failed: <message>` with `isError: true`
(`server/node_modules/@strapi/core/dist/services/mcp/tool-registry.js:82-91`).
yt-kb registers in `register()` with no try/catch around its loop
(`PSRC/mcp-official/index.ts:47-49`); see `04`, "MCP server", for what a
duplicate name does.

### Content Manager's tools for yt-kb's types

Strapi's Content Manager registers `list_`, `get_`, `create_`, `update_`
and `delete_` tools for every displayed type, yt-kb's five included
(`content-manager.visible: true` in each schema). Names use the slug
`plugin-yt-kb_<type>` (for example `create_plugin-yt-kb_video`) and each is
gated by the Content Manager permission for that type, not by
`plugin::yt-kb.*`
(`server/node_modules/@strapi/content-manager/dist/server/mcp/register-content-manager-mcp-tools.js:22-31`,
`utils.js:11-17`). They can create, change and delete yt-kb rows,
bypassing yt-kb's tiers but going through the Document Service (so the
create rules apply). ⚠️ framework behavior — the exact per-tool permission
checks.

### Tools on main-site's `/mcp` (reference)

- `youtube-transcripts`: `youtube_transcripts__fetch_transcript`,
  `__list_transcripts`, `__get_transcript`, `__search_transcript`,
  `__find_transcripts`, each gated by
  `plugin::youtube-transcripts.tool.<kebab>`; a name clash is logged and
  skipped (`YT/` L974-1102).
- `tanstack-ai`: `list_content_types`, `search_content`,
  `aggregate_content`, `find_one_content`, `create_content`,
  `update_content`, `upload_media`, `send_email`, optional prefix
  `mcp.toolPrefix` (default `""`), clash logged and skipped (`TS/`
  L1273-1286, L1377-1401).
- content-manager per-type tools (`list_article`, …); no try/catch on clash
  (`MAIN/node_modules/@strapi/content-manager/dist/server/mcp/register-content-manager-mcp-tools.js:29-31`).
- core: `log` (`MAIN/node_modules/@strapi/core/dist/services/mcp/index.js:96`).
- ⚠️ framework behavior — duplicate names throw; first registration wins
  (`McpCapabilityDefinitionRegistry.js:18-21`). None of yt-kb's 21 names
  equals any name above.
- ⚠️ not in code — the MCP server named `strapi-prod` in the owner's Claude
  shows `youtube_transcripts__*` and `tanstack-ai`'s tools, which suggests
  it points at the host; its URL was not checked.

### `tanstack-ai`'s admin chat: how it finds other plugins' tools

Per chat request, for every plugin except itself: `strapi.plugin(name).service('ai-tools')`;
`getTools()` must be synchronous and return an array of
`{name, description, schema, execute(args, strapi, ctx), action?, internal?}`;
optional `getMeta()` gives `{label, description, keywords}`. A tool's
`action` (or derived `plugin::<plugin>.tool.<slug>`) must already be
registered with the admin action provider, or the tool is dropped with a
warning. Tools are named `<plugin>__<name>` and kept only when
`ability.can(action)` for the admin using the chat; when no ability is
passed, every tool is offered (`TS/` L1869-2024, L2022).
`chat.toolSources` (host service UIDs) is the other way in; the host sets
none (`MAIN/config/plugins.ts:2-15`). `@tanstack/ai` 0.52.3 converts a
tool's `schema` through Standard JSON Schema, which zod 4.2+ provides; the
host's `@strapi/utils` 5.60 builds `z` on zod 4.4.3; this repo's
`server/node_modules/zod` is 3.25.76 (`MAIN/node_modules/@tanstack/ai/dist/esm/activities/chat/tools/schema-converter.js:161-241`).
yt-kb has no `ai-tools` service (grep of `PSRC/`).

## Auth

No end-user auth in the app or the site (see 04). Callers of Strapi:

| Caller | Credential | Where it lives |
|---|---|---|
| TanStack app | Content API token (⚠️ not in code — kind; `yt-kb-client` is full access per `docs/designs/yt-kb-plugin.md`) | `STRAPI_API_TOKEN` in `client/.env` (`client/.env.example:7`) |
| Astro site build | Content API token, read-only per the comment | `STRAPI_API_TOKEN` in `site/.env` (`site/.env.example:5-7`) |
| MCP clients | Admin API token holding `plugin::yt-kb.*` | the client's MCP config (⚠️ not in code) |
| `copy-content.mjs` | Content API tokens: source read; destination `importer.importRecords` plus read for the check | `SOURCE_TOKEN`, `DEST_TOKEN` (`server/src/plugins/yt-kb/scripts/copy-content.mjs:8-11`) |
| Strapi admin panel user | admin JWT (`ADMIN_JWT_SECRET`, `server/config/admin.ts:4-6`); Content Manager permissions decide what they can do to yt-kb rows, which are all visible there (`PSRC/content-types/*/schema.json`) | the browser (⚠️ framework behavior) |
| A signed-in Users & Permissions user | JWT from `/api/auth/local` | the caller; ⚠️ not in code — whether registration is open and what the Authenticated role holds |

Users & Permissions is installed in this repo's Strapi
(`server/package.json:22`) with a stock user extension
(`server/src/extensions/users-permissions/content-types/user/schema.json`);
nothing in the product signs in through it. `server/scripts/seed.mjs`
(not wired to a script) registers users (`seed.mjs:63-77`) and writes to
`/api/posts` and `/api/profiles` (`:91-106`), which do not exist here. ⚠️ not in code — which tokens
exist in each Strapi and what they hold.

## Session

- **The app and the site:** none (no sign-in). The app's token is
  server-side only (⚠️ framework behavior — TanStack Start keeps server-fn
  code out of the browser bundle).
- **Strapi admin panel:** ⚠️ framework behavior — Strapi's own admin
  session: admin JWT from `/admin/login`, held by the browser, sent on
  each admin request, checked by Strapi's admin auth, expiry per Strapi's
  defaults. This repo configures only `ADMIN_JWT_SECRET`
  (`server/config/admin.ts:4-6`).

## Permissions & roles

### End-user roles (content API)

The plugin grants nothing to Public (`PSRC/routes/index.ts:5-8`). Comments
in `server/.env.example` (the `HOST` variable's comment),
`server/config/middlewares.ts:11-14`, `server/config/server.ts:11` and
`client/src/lib/env.ts:116` describe older Public grants that the code no
longer makes. ⚠️ not in code — the Public role's rows in each database.

### Admin roles (Strapi admin panel, `/admin`)

- yt-kb registers `plugin::yt-kb.read`, `.write`, `.maintenance`
  (section `plugins`, subCategory `MCP tools`), always, before the MCP
  checks (`PSRC/mcp-official/permissions.ts:19-51`, `index.ts:28`; guarded
  by `client/src/lib/services/mcp-permissions.guard.test.ts`).
- `youtube-transcripts` registers five `plugin::youtube-transcripts.tool.*`
  actions (subCategory `AI tools`) (`YT/` L993-1021).
- `tanstack-ai` registers eight `plugin::tanstack-ai.tool.*` actions for
  its own tools, in `register()` (`TS/` L80-95, L1426-1438).
- ⚠️ framework behavior — Strapi deletes admin permission rows whose action
  is no longer registered at boot (stated in
  `MAIN/database/migrations/2026.10.22T00.00.00.carry-ai-chat-tool-grants-to-tanstack-ai.js:5-13`,
  which renames grants before that cleanup).

## Server-side handlers

The TanStack app has no auth; any caller that reaches port 3005 can call
every handler, and all use the one `STRAPI_API_TOKEN`
(`client/src/lib/services/strapi-client.ts:147-152`). Server fns validate
input with zod `.validator`; API routes check by hand
(`client/src/data/server-functions/*.ts`, `client/src/routes/api.*.tsx`).
"Checks first" lists what runs before any write, beyond input validation.

**Writes or deletes**

| Handler | Checks first | Writes |
|---|---|---|
| `shareVideo` (`videos.ts:193`) | URL → 11-char id; not already stored (checked twice) | Tags, Video; starts generation and ignores the start result (`:185-191`). Takes a `mode` (`auto/single/mapreduce`, `:159-164`), as do `triggerSummaryGeneration` and `regenerateSummary` (`:257-259, 320-330`) |
| `triggerSummaryGeneration` (`:261`) | row not `generated`; recent-failure window | via generation |
| `regenerateSummary` (`:332`) | row exists | `summaryStatus: pending`, then generation |
| `regenerateVideoVerdict` (`:1511`) | row exists; transcript ≥50 chars | verdict fields, `valueScore`, `finalScore` |
| `regenerateVideoSignals` (`:1639`) | row exists (does not check `generated`) | `signalScores`, `signalScore`, `finalScore` |
| `regenerateVideoEmbedding` (`:523`) | row is `generated` | embedding fields |
| `updateSectionTimecode` (`:295`) | ids valid; GET then PUT | `sections` |
| `reindexAllTranscriptIndexes` (`:695`), `reindexAllEmbeddings` (`:777`), `reindexAllPassages` (`:1126`) | refuse on a partial corpus read | `transcriptSegments`, embedding fields, `passageEmbeddings` |
| `backfillSignalScores` (`:1693`), `backfillFinalScores` (`:1794`), `backfillValueScores` (`:1447`, no UI caller) | none; a failed page stops the loop and still returns `ok`; 50-page cap (`:1454-1465, 1699-1716`) | score fields |
| `createNote`, `updateNote`, `deleteNote` (404 = success), `summarizeToNote` (`notes.ts:53-153`) | ids valid | Note |
| `saveDigest` (`digests.ts:52`) | 2–5 ids resolve; check-then-write by `videoSetKey` | Digest |
| `deleteSavedDigest` (`digests.ts:289-301`, no UI caller) | `documentId` present | **deletes** a Digest |
| `generateReadableArticle` (`reader.ts:28`) | own in-process Set; cached unless forced | `readableArticle*`, by raw `fetch` (`services/reader.ts:351-381`) |

**Read only (may call Ollama)**

| Handler | Calls Ollama | Notes |
|---|---|---|
| `getFeed`, `getVideoByVideoId`, `getVideoByDocumentId`, `listNotesForVideo`, `listSavedDigests`, `fetchSavedDigest*`, `listRegenerableVideos`, `getEmbeddingStatus`, `get*Coverage`, `count*` | no | `count*` return `{missing: 0}` on a Strapi error (`videos.ts:1443, 1619, 1790`) |
| `getGenerationProgress`, `clearSummaryFailure` | no | in-memory state only |
| `relatedVideos`, `getChatResponseEvidence`, `searchTags` | no | |
| `semanticSearchVideos`, `searchLibraryPassages`, `suggestTagsForUrl` | embeddings | `suggestTagsForUrl` also calls oEmbed |
| `askAboutVideo` (no UI caller), `loadDigest` (synthesizes on a cache miss, in a GET loader), `generateDigest` (no UI caller), `generateDigestArticle` | chat | ⚠️ framework behavior — `loadDigest` can run on hover preload |
| `POST /api/chat`, `/api/digest-chat`, `/api/notes/compose` | chat | 503/404/409 unless the video is reachable and `generated` |
| `POST /api/ask` | embeddings + chat | question 1–1000 chars |

## Lifecycles / policies / middlewares

- yt-kb Document Service middleware, **create only**
  (`PSRC/document-rules.ts:25`): video requires `youtubeVideoId` and
  rejects a duplicate (L29-41); transcript the same (L44-57); tag
  normalizes `name` (trim, lower-case, collapse spaces) and fills `slug`
  from it when absent (L63-68). No rule on update.
- No policies, route middlewares or lifecycle files in yt-kb or this
  repo's `server/`. The host has its own route middlewares for its types
  (`MAIN/src/api/*/routes`, `MAIN/src/middlewares/global-page-populate.ts`).
- `youtube-transcripts` has no lifecycle hooks; its `register()` renames an
  old `transcript` table to `youtube_transcripts` and rewrites
  `plugin::ai-sdk-yt-transcripts.` grants (`YT/` L1156-1202).

## Pages & components (frontend)

### TanStack app (`client/src/routes/`)

Who can open any route: anyone who can reach port 3005 (no auth). Every
loader fetches through server fns with `STRAPI_API_TOKEN`. Router preloads
on intent (`client/src/router.tsx`: `defaultPreload: 'intent'`,
`defaultPreloadStaleTime: 0`).

| Route | Fetches | Renders / caches | Core loop |
|---|---|---|---|
| `/new-post` | none; submit → `shareVideo` | share form | **Yes** (entry) |
| `/learn/$videoId` | `getVideoByVideoId`; if `pending` → `triggerSummaryGeneration` + `getGenerationProgress` | 5 states; polls every 3 s while pending, 200 tries (`learn.$videoId.tsx:90-171`) | **Yes** |
| `POST /api/chat` | Video row, stored BM25 index, Ollama | SSE | **Yes** |
| `/feed` | `getFeed` or `semanticSearchVideos` | card grid; polls every 3 s while a card is pending, with no cap (`feed.tsx:199-207`) | lists results |
| `/search` | `searchLibraryPassages` (Ollama + `passageEmbeddings`) | passage hits | No |
| `/digest`, `/digests` | `loadDigest` (saved row first), `listSavedDigests` | digest report / list | No |
| `/settings` | coverage + backfill server fns | panels | No |
| `/video/$documentId` | `getVideoByDocumentId` (`video.$documentId.tsx:8-13`) | one card | No |
| `/about`, `/` (redirect to `/feed`) | — | — | No |
| `POST /api/ask`, `/api/digest-chat`, `/api/notes/compose` | Ollama + Strapi reads | SSE | No |

Source: `client/src/routes/*.tsx`.

### Astro site (`site/src/pages/`)

Static, public, no credentials in the output. Data comes at build time from
`${STRAPI_BASE_URL}/videos` (default `http://localhost:1340/api/yt-kb`) with
`STRAPI_API_TOKEN`, filter `summaryStatus = generated`, 12 named fields plus
4 nested, 100 per page (`site/src/content.config.ts:9-15`,
`site/src/lib/strapi.ts`, `site/src/lib/video.ts:21`).

| Route | Renders |
|---|---|
| `/` | search box, recent, highest scoring, topics |
| `/v/<youtubeVideoId>` | summary, verdict, sections that seek the embed, readable article |
| `/t/<tagSlug>`, `/topics`, `/articles` | tag pages, tag list, videos with a `readableArticle` |
| `/search-index.json` | MiniSearch source, built at build time; `Cache-Control: max-age=300` (`site/netlify.toml:15-18`) |
| `/404` | "Nothing here" and search (`site/src/pages/404.astro`) |

Never published: `transcriptSegments`, `summaryEmbedding`,
`passageEmbeddings`, `rawText`, `rawSegments` (`site/src/lib/video.ts:7`),
checked by `site/scripts/verify-output.mjs`.

## State management

React Query (`client/src/routes/__root.tsx:35-45`) and router loaders.
Generation progress and dedupe are process memory
(`client/src/lib/services/generation-state.ts:77-79`).

## Background jobs

- **Summary generation**, fire-and-forget in the app's server process,
  deduped by an in-memory `inflight` Set shared by `shareVideo`,
  `triggerSummaryGeneration`, `regenerateSummary`
  (`generation-state.ts:85-150`). A failure blocks a restart of the same
  video for 5 minutes (`recentFailures`, `generation-state.ts:75, 93-96`);
  `/learn` shows it as failed meanwhile (`learn.$videoId.tsx:102-105`). The readable-article generator has its
  own Set (`client/src/data/server-functions/reader.ts`). Verdict re-rate,
  digests and backfills have none.
- No cron in either Strapi (no `config/cron-tasks.*`). `youtube-transcripts`
  can run a metadata backfill at boot when
  `backfillMetadata: true` (default false, `YT/` L1146-1152, L367-438).

## Media & uploads

None in yt-kb. This repo's Strapi uses the default local upload provider
and `server/public/uploads/` holds files (⚠️ not in code — what they are);
nothing in yt-kb references them.

## Outside services and other apps

| Service | Side that calls it | Key / env var | If it fails | How the team finds out |
|---|---|---|---|---|
| YouTube Innertube + caption XML | Strapi (yt-kb plugin), `PSRC/services/youtube-transcript.ts` | `TRANSCRIPT_PROXY_URL` (optional proxy), `PSRC/services/fetcher.ts:35` | REST returns 502 with YouTube's reason; the app makes up to 3 attempts in total (`learning.ts:118`, `client/src/lib/retry.ts:13`) when the message matches a transient pattern — `/fetch failed/` (`client/src/lib/retry.ts:39`) also matches the plugin's `timedtext fetch failed: <status>`, so a YouTube 429 or 403 is retried (`learning.ts:111-126`) — then marks the video `failed`; an MCP call returns Strapi's `execution failed` error (`tool-registry.js:82-91`). The stored `language` is always `'en'`, even when the fetcher falls back to another language's track (`youtube-transcript.ts:211-214`, `fetcher.ts:44`) | the failed state on `/learn`; a `warn` line in Strapi's log for the REST path only |
| YouTube oEmbed | the app (`learning.ts:188-204`) and Strapi (`youtube-transcript.ts:244`, not through the proxy) | none | returns `{}`; title/author left empty | not surfaced |
| Ollama | the app only (`learning.ts`, `embeddings.ts`, chat routes) | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_CHAT_MODEL`, `OLLAMA_SYNTHESIS_MODEL`, `OLLAMA_EMBEDDING_MODEL`, `EMBEDDING_VERSION`, `PASSAGE_EMBEDDING_VERSION`, `MAP_CONCURRENCY` (`client/src/lib/env.ts`) | generation → row `failed`; embedding passes skipped and logged; errors shown through `friendlyOllamaError` at listed call sites | UI messages; `[summary <id>]` log lines |
| DuckDuckGo HTML | the app (`web-search.ts`) | none | 2 tries, then `[]` | log line |
| `i.ytimg.com` thumbnails, YouTube nocookie embed | the browser (app: `server-functions/videos.ts:224-225` fallback; site: `site/src/lib/player.ts:64-66`) | none | broken image / empty player | visible on the page |
| Strapi | the app, the site build, MCP clients, `copy-content.mjs` | `STRAPI_URL` + `STRAPI_API_TOKEN` (client), `STRAPI_BASE_URL` + `STRAPI_API_TOKEN` (site) | app: `friendlyBackendError`, `BackendErrorPanel`; site: build throws | UI panel; failed build |
| Netlify | `publish-site.sh`, `site:deploy` | Netlify CLI login, `site/.netlify/state.json` | script exits | terminal |
| Anthropic | the host's `tanstack-ai` only | `ANTHROPIC_API_KEY` (host `config/plugins.ts`) | — | — |

**Other apps:** any Strapi app that installs the plugin (none yet besides
this repo's `server/`); `tanstack-ai`'s chat in a host that has it; the
owner's Claude over MCP, which uses `youtube-transcripts`' tools on
main-site today (owner, 2026-11-08).

## Hosting & environments

| Part | Environment | Config |
|---|---|---|
| App | owner's Mac only | `client/.env` (names in `client/.env.example`) |
| This repo's Strapi | owner's Mac, test bed for the plugin | `server/.env` |
| Site | built locally, Netlify | `site/.env`; `site/netlify.toml`; `publish-site.sh` |
| A host Strapi | not chosen (`03`) | the host's own config |

`publish-site.sh:31` defaults `STRAPI_URL` to `http://localhost:1340/api`
and its two `curl` checks (lines 44, 51) send no token; the site's own
loader uses `/api/yt-kb` with a token. ⚠️ framework behavior — an
unauthenticated `GET /api/videos` gets 403 or 404 at `721f210`, so the
script's first check would stop before building (not run).

## Operations (robustness sweep)

| Item | What the code does |
|---|---|
| Backups | Not handled in code. Local backups are manual copies of `server/.tmp/data.db`; the owner has backups (owner, 2026-11-08). |
| Copying data between Strapis | `server/src/plugins/yt-kb/scripts/copy-content.mjs` (env `SOURCE_URL`, `SOURCE_PREFIX`, `SOURCE_TOKEN`, `DEST_URL`, `DEST_TOKEN`; upsert by documentId, keeps dates, `--check` compares; never deletes; batches ≤8 MB, line 101) |
| Importing rows from `youtube-transcripts` into yt-kb | Not handled. |
| Carrying `plugin::youtube-transcripts.*` grants to yt-kb | Not handled. Precedent seen on main-site: a `.js` migration that renames `admin_permissions.action` before Strapi's cleanup (`MAIN/database/migrations/2026.10.22…js`). |
| Rate limits / retries on YouTube | App side: `withRetry`, up to 3 attempts, around the Strapi call, which also retries YouTube 429/403 (see Outside services). Plugin side: none. `youtube-transcripts` retries the caption download 3×, 25 s timeout, 429/403 backoff with `Retry-After`, fresh session (`YT/` L166-339). |
| Proxy health | Not handled in yt-kb. `youtube-transcripts` tests the proxy against httpbin at boot and warns when none is set (`YT/` L1104-1145). |
| Generation that dies mid-run | Row is marked `failed`; a crash leaves it `pending` and the next `/learn` load restarts it (`generation-state.ts`, `learn.$videoId.tsx:98-102`). |
| Concurrency | Single process; nothing coordinates the app with MCP's `addVideo`/`fetchTranscript` beyond the shared Transcript row (`generation-state.ts`). |
| Monitoring / alerts | None. |
| Rollback | Not handled in code. |

## Flows and what they write

### App: share a video (`/new-post` → `shareVideo` → `generateVideoSummary`)

1. The app reads oEmbed for title, author and thumbnail
   (`server-functions/videos.ts:215`).
2. Creates missing tags: `GET/POST /api/yt-kb/tags`
   (`createVideoService`, `client/src/lib/services/videos.ts:569-607`).
3. `POST /api/yt-kb/videos` with `youtubeVideoId, url, caption, videoTitle,
   videoAuthor, videoThumbnailUrl, tags, summaryStatus: 'pending'`.
4. In the background (`generateVideoSummary`, `learning.ts:1241-1290`,
   which runs `resolveGenerationInputs`, `buildSummaryDraft` and
   `persistSummaryDraft`, `learning.ts:807-1230`):
   - **Transcript:** the linked Transcript; else one found by
     `youtubeVideoId`, then link it (`PUT /api/yt-kb/videos/:id
     {transcript}`); else `POST /api/yt-kb/transcripts/fetch` (force when
     a stored row has no segments), then link it.
   - **Summary** with Ollama (single pass up to ~15K tokens, else
     map-reduce at `MAP_CONCURRENCY`, clamped to 1–4, `client/src/lib/env.ts:80-84`); section `timeSec` recovered by BM25
     against the transcript; signal and final scores computed.
   - **Save** `PUT /api/yt-kb/videos/:id` with the summary fields, the three
     scores and `signalScores`, `valueScoreSource: 'model'`, `aiModel`,
     `transcriptSegments`, components, `summaryStatus: 'generated'`,
     `summaryGeneratedAt`.
   - **Best-effort:** summary embedding (`summaryEmbedding`,
     `embeddingModel`, `embeddingVersion`, `embeddingGeneratedAt`) and
     passage embeddings (`passageEmbeddings`, ~60 s chunks).
   - Any failure in fetch or summary → `PUT {summaryStatus: 'failed'}`.

### App: Regenerate

- Full: `PUT {summaryStatus: 'pending'}`, then step 4 above using the stored
  transcript (`server-functions/videos.ts:332-374`). `forceRefetch: true`
  sends `force: true` to the fetch route; no UI sends it (grep).
- Verdict only: Ollama on the stored `rawText`; writes `watchVerdict,
  verdictSummary, verdictReason, valueScore, valueScoreSource, finalScore`
  (`videos.ts:730-759`).
- Signals only: no model; writes `signalScores, signalScore, finalScore`
  (`videos.ts:764-788`).
- Embedding only: the four embedding fields.

### App: opening `/learn/<videoId>` for a `pending` video created elsewhere

The loader calls `triggerSummaryGeneration`, which runs step 4 above; a
stored transcript is reused and linked (`learn.$videoId.tsx:98-102`,
`server-functions/videos.ts:265-283`). ⚠️ framework behavior — with
`defaultPreload: 'intent'`, hovering a link to that page may also start it.

### MCP: `addVideo`

If the video exists, returns `exists` and writes nothing. Else
`fetcher.fetchAndStore` (creates the Transcript or reuses one), creates
missing tags, then creates the Video with `youtubeVideoId, url, videoTitle,
videoAuthor, videoThumbnailUrl` (from the transcript row), `caption`,
`summaryStatus: 'pending'`, `transcript`, `tags`. A fetch failure aborts
before the Video is created (`PSRC/mcp/tools/add-video.ts`).

### MCP: `fetchTranscript`

`fetcher.fetchAndStore(videoId, {force, proxyUrl})`: creates or overwrites
the Transcript row; returns `skipped` when stored and not forced. Touches no
Video and links nothing (`PSRC/mcp/tools/fetch-transcript.ts`,
`PSRC/services/fetcher.ts`).

### MCP: `saveSummary`

`PUT` on the Video: `summaryStatus: 'generated'`, `summaryTitle`,
`summaryDescription`, `summaryOverview`, `watchVerdict`, `verdictSummary`,
`verdictReason`, `summaryGeneratedAt`, `aiModel`, `keyTakeaways`,
`sections` (with whatever `timeSec` the caller sends), `actionSteps`
(`PSRC/mcp/tools/save-summary.ts:19, 80-96`).

### MCP: `tagVideo`, `untagVideo`, `saveNote`

- `tagVideo`: for each name, trim and lower-case, find the Tag, create it
  with an explicit `slug` when missing, then set the Video's `tags` to the
  union (`PSRC/mcp/tools/tags.ts:56-97`). The lookup does not collapse
  inner whitespace (`tags.ts:68`, also `add-video.ts:87`) while the create
  rule does (`PSRC/document-rules.ts:13`), so a name with a double space
  misses the stored row and its create hits the unique `name`.
- `untagVideo`: sets `tags` to the current set minus the given names
  (lower-case match); Tag rows are never deleted (`tags.ts:105-128`).
- `saveNote`: creates a Note with `source: 'mcp'`, `author` defaulting to
  `'mcp'`, linked to one Video (`PSRC/mcp/tools/save-note.ts:36-58`).

### Site build (`yarn site:build`)

Reads `generated` videos only; writes nothing to Strapi; fails the build on
any fetch problem or zero rows; the output guard fails on forbidden fields
(`site/src/lib/strapi.ts`, `site/scripts/verify-output.mjs`).

### What a video added only through MCP lacks

| Missing on the Video | Filled by (app only) | Effect |
|---|---|---|
| `valueScore`, `valueScoreSource`, `signalScores`, `signalScore`, `finalScore` | `updateVideoSummaryService` (`client/src/lib/services/videos.ts:647-666`) | no Content score; sorts as 0 on the site |
| `transcriptSegments` | the summary save | `searchTranscript` falls back to substring; `crossSearchTranscripts` skips it |
| `summaryEmbedding` and fields | `updateVideoEmbeddingService` (`videos.ts:672-694`) | absent from Related videos and semantic search; `relatedVideos` errors on it |
| `passageEmbeddings` | `updateVideoPassagesService` (`videos.ts:697-707`) | absent from moment search and `/api/ask` |
| `readableArticle` | app reader | not on the site's `/articles` |
| BM25-grounded `timeSec` | the summary pipeline | `saveSummary` stores the caller's values |

Until `saveSummary` runs, the video is `pending` and absent from the site.
Opening it in the app (`/learn/<videoId>`) runs the full pipeline. After
`saveSummary` it is `generated`, so the app does not regenerate it unless
Regenerate is clicked (`server-functions/videos.ts:265-283`).

## Environment variables

### Strapi backend

- This repo's `server/.env.example`: `HOST`, `PORT`, `MCP_ENABLED`,
  `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`,
  `ENCRYPTION_KEY`, `DATABASE_*`, `JWT_SECRET`, `OLLAMA_EMBEDDING_MODEL`,
  `EMBEDDING_VERSION` (read by the plugin only to judge staleness,
  `PSRC/mcp/utils/embeddings.ts:14-20`), `TRANSCRIPT_PROXY_URL`. Read in
  code but not listed: `FLAG_NPS`, `FLAG_PROMOTE_EE` (default true,
  `server/config/admin.ts:19-20`), `DATABASE_URL`, `DATABASE_SCHEMA`,
  `DATABASE_SSL_*`, `DATABASE_POOL_*`, `DATABASE_CONNECTION_TIMEOUT`.
- Scripts: `copy-content.mjs` (`SOURCE_URL`, `SOURCE_PREFIX`,
  `SOURCE_TOKEN`, `DEST_URL`, `DEST_TOKEN`); `server/scripts/seed.mjs`
  (`STRAPI_URL`); `start.sh` (`OLLAMA_KEEP_ALIVE`, `OLLAMA_NUM_PARALLEL`);
  `publish-site.sh` (`STRAPI_BASE_URL`, `SITE_SKIP_STRAPI_FETCH`);
  `client/playwright.config.ts:13` (`CI`).
- `youtube-transcripts` reads its proxy from plugin config `proxyUrl`,
  default `env("PROXY_URL")` (`YT/` L1203-1239).

### Frontend

- `client/.env.example`: `STRAPI_URL`, `STRAPI_API_TOKEN`, `OLLAMA_*`,
  `EMBEDDING_VERSION`, `PASSAGE_EMBEDDING_VERSION`, `MAP_CONCURRENCY`.
  `@strapi/client` and `ky` are declared in `client/package.json` and
  imported nowhere in `client/src`. `.env.example` line 16 mentions an MCP `reindexEmbeddings` tool that does not exist.
  `client/.env.example` and `README.md:218` call the token optional;
  `client/src/lib/env.ts:103-124` warns when it is empty.
- `site/.env.example`: `STRAPI_BASE_URL`, `STRAPI_API_TOKEN`, `SITE_URL`;
  code also reads `SITE_SKIP_STRAPI_FETCH`.

## Tests

- Client (vitest, `client/vitest.config.ts`): services, generation pipeline,
  BM25, retrieval, scores, digests, errors, serialization, components, and
  four guards that read or fence plugin code — `bm25-core.sync.test.ts`,
  `mcp-permissions.guard.test.ts`, `strapi-paths.guard.test.ts`,
  `youtube-fetch.guard.test.ts`. Two suites need live services and return
  early when they are down, still counting as passed:
  `videos.smoke.test.ts` (the only test that checks the Public role is
  refused, lines 50-108) and `embeddings.ranking.test.ts`
  (`.github/workflows/ci.yml:2-4`). Not covered: the `api.*` route handlers,
  `prepareChatPrompt`, `prepareDigestChatPrompt`, `reader.ts`, notes
  services, backfills. E2E: `client/e2e/seroval-surfaces.spec.ts`; the
  Playwright config does not start the stack (`client/playwright.config.ts:3-8`).
- Site: 11 files under `site/src/**` (`yarn site:test`).
- `server/` and the plugin: no tests. `yarn --cwd server verify:mcp`
  (`server/scripts/verify-mcp-tools.cjs:12-16, 33, 56-63`) needs `dotenv`
  and a stopped dev server, and loads `dist/src/mcp/tools/*` and
  `api::video.video`, both removed in `698a887`.
