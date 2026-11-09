# Technical Requirements

> As built at `yt-knowledge-base` `93672f3` (`main`) and
> `strapi-cloud-backend-main-site` `a32c8a0` (`main`, local checkout
> `~/work/plugin-dev/strapi-prod`, with installed `node_modules`),
> 2026-11-09, after the change in `06-change-spec.md`. Describes the code,
> not intentions. main-site runs `strapi-plugin-yt-kb` 0.1.1 on Strapi
> 5.61.0 (`MAIN/package.json`); it is read here as installed.
> `PSRC/` = `server/src/plugins/yt-kb/server/src/`. `MAIN/` = the main-site
> checkout. `TS/` = `MAIN/node_modules/strapi-plugin-tanstack-ai/dist/server/index.js`
> (1.7.0). The installed 0.1.1 `dist` matches `PSRC/` at `93672f3` on the
> points checked below (tool names, `createVideoCard`, `MAX_WIRE_BYTES`,
> `ai-tools`, takeaway `text` type;
> `MAIN/node_modules/strapi-plugin-yt-kb/dist/server/index.js`).

## Strapi content types

### yt-kb (`strapi-plugin-yt-kb`)

All five: collection types, `draftAndPublish: false`, visible in the
Content Manager, hidden from the Content-Type Builder. The only `private`
attribute is the transcript's `searchIndex`
(`PSRC/content-types/transcript/schema.json:85-89`). Every `unique` key also
sets `column: { unique: true }` (video `:32`, transcript `:27`, tag `:28,
:34`, digest `:27`); ⚠️ framework behavior — that this makes Strapi's schema
sync create a database unique index. No `string` attribute allows more than
255 characters, enforced by `PSRC/schema-limits.test.ts:17-27` (PostgreSQL
stores a `string` as varchar(255), `:5-9`). Source:
`PSRC/content-types/*/schema.json`.

#### `plugin::yt-kb.video` — `yt_kb_videos`

| Group | Attributes |
|---|---|
| Identity | `youtubeVideoId` string required unique ≤32; `url` text required ≤2000 |
| YouTube metadata | `videoTitle` text ≤300; `videoAuthor` text ≤200; `videoThumbnailUrl` text ≤2000; `caption` text ≤500 |
| Relations | `transcript` oneToOne → transcript (unidirectional); `tags` manyToMany → tag (owning, `inversedBy: videos`); `digests`, `notes` manyToMany (`mappedBy: videos`) |
| Summary | `summaryStatus` enum `pending/generated/failed` required default `pending`; `summaryTitle` string ≤200; `summaryDescription` text ≤500; `summaryOverview` richtext; `watchVerdict` enum `skip/skim/worth_it`; `verdictSummary` text ≤280; `verdictReason` text ≤1000; `summaryGeneratedAt` datetime; `aiModel` string ≤100; repeatable components `keyTakeaways` (`ytkb.takeaway`), `sections` (`ytkb.section`, has `timeSec`), `actionSteps` (`ytkb.action-step`) |
| Scores | `valueScore`, `signalScore`, `finalScore` integer 0–100; `valueScoreSource` enum `model/derived`; `signalScores` json |
| Retrieval | `transcriptSegments` json (the app's stored BM25 index + `rawSegments` + `durationSec`); `summaryEmbedding` json, `embeddingModel` string ≤100, `embeddingVersion` integer, `embeddingGeneratedAt` datetime; `passageEmbeddings` json |
| Reader | `readableArticle` richtext, `readableArticleGeneratedAt` datetime, `readableArticleModel` string ≤100 |

Source: `PSRC/content-types/video/schema.json`.

#### `plugin::yt-kb.transcript` — `yt_kb_transcripts`

| Group | Attributes |
|---|---|
| Identity | `youtubeVideoId` string required unique ≤32 |
| Captions | `rawSegments` json (`[{text, startMs, endMs}]`); `rawText` richtext; `language` string ≤10 default `en` (the track actually used, `PSRC/services/youtube-transcript.ts:529-530`); `durationSec` integer ≥0; `fetchedAt` datetime |
| Metadata | `title` text ≤300; `author` text ≤200; `thumbnailUrl` text ≤2000; `channelId` string ≤64; `thumbnails` json; `viewCount` biginteger; `description` text; `keywords` json; `category` string ≤100; `videoPublishedAt` string ≤100 (YouTube's display text, not a datetime) |
| Search | `searchIndex` json, **private** — model-free BM25 index over `rawSegments`, built by `fetchAndStore` (`PSRC/services/fetcher.ts:133`) and lazily by the search tools (`PSRC/services/search-index.ts:32-66`) |

No relation back to Video. The fetcher clips metadata to these limits
before writing (`PSRC/services/fetcher.ts:43-61, 128-130`). Source:
`PSRC/content-types/transcript/schema.json`.

#### `plugin::yt-kb.tag` — `yt_kb_tags`

`name` string required unique 1–40; `slug` uid (`targetField: name`)
required unique; `videos` manyToMany (`mappedBy: tags`). The create rule
fills `slug` with the first free `<slug>`, `<slug>-2`, … (`freeTagSlug`,
`PSRC/document-rules.ts:22-32, 73-80`). Description text still reads
"Free-form tag on a Post" (`PSRC/content-types/tag/schema.json:8`).

#### `plugin::yt-kb.note` — `yt_kb_notes`

`title` string ≤200; `body` richtext required; `source` enum
`chat/digest-chat/mcp/manual` required, default `manual`; `author` string
≤120; `videos` manyToMany (owning, `inversedBy: notes`)
(`PSRC/content-types/note/schema.json`).

#### `plugin::yt-kb.digest` — `yt_kb_digests`

`videoSetKey` text required unique ≤500; `title` string required ≤200;
`description` text ≤400; `overallTheme` richtext; `bottomLine` text ≤800;
repeatable components `sharedThemes`, `uniqueInsights`, `contradictions`,
`viewingOrder`; `articleMarkdown` richtext; `videos` manyToMany (owning,
`inversedBy: digests`); `model` string ≤100
(`PSRC/content-types/digest/schema.json`).

### `strapi-plugin-youtube-transcripts` — removed from main-site

Removed in main-site `484b1d3` ("Replace youtube-transcripts with
strapi-plugin-yt-kb 0.1.0, upgrade Strapi to 5.61.0"); its config block
became yt-kb's (`MAIN/config/plugins.ts:16-24`,
`MAIN/config/env/production/plugins.ts:16-24`) and it is not in
`MAIN/package.json` or `MAIN/node_modules`. What yt-kb now covers from it:

| youtube-transcripts | yt-kb at `93672f3` |
|---|---|
| `videoId` (not required, not unique) | `youtubeVideoId` required unique |
| `title`, `author`, `thumbnailUrl`, `durationSec`, `fetchedAt` | same names |
| `fullTranscript` | `rawText` |
| `transcriptWithTimeCodes` | `rawSegments` `[{text, startMs, endMs}]` |
| `language` (track used) | `language`, the track used (`youtube-transcript.ts:529-530`) |
| `channelId`, `thumbnails`, `viewCount`, `description`, `keywords`, `category`, `videoPublishedAt` | same names, added in M2 (`transcript/schema.json:60-84`) |
| `GET /api/youtube-transcripts/yt-transcript/:videoId` and the admin route | `GET /api/yt-kb/yt-transcript/:videoId` and admin `GET /yt-kb/yt-transcript/:videoId` (`PSRC/routes/index.ts:30-32, 39-50`) |
| plugin config `proxyUrl`, default `PROXY_URL` | same (`PSRC/index.ts:23`) |
| proxy check against httpbin at boot; warning when none is set | `PSRC/bootstrap.ts:15-37`, `youtube-transcript.ts:566-570` |
| `backfillMetadata` at boot (default false) | same key and default (`PSRC/index.ts:27`, `bootstrap.ts:39-45`, `services/metadata-backfill.ts`) |
| caption download: 3 attempts, 25 s timeout, 429/403 backoff with `Retry-After`; English-first track | ported (`youtube-transcript.ts:76-80, 316, 356-391, 449-450`) |
| URL forms (watch, youtu.be, shorts, embed, live) | `extractYouTubeId` (`PSRC/services/fetcher.ts:21-41`) |
| tool names `youtube_transcripts__<snake>`, actions `plugin::youtube-transcripts.tool.<kebab>` | same shapes under `yt_kb__` / `plugin::yt-kb.tool.` (`PSRC/mcp-official/names.ts:1-23`) |

Not carried over by any code in either repo (grep of `MAIN/src`,
`MAIN/database`, `MAIN/config`, `PSRC/`): the `youtube_transcripts` rows
(`06-change-spec.md:57` puts importing them out of scope) and the
`plugin::youtube-transcripts.*` admin grants. ⚠️ framework behavior —
Strapi deletes grants of unregistered actions at boot (see `PSRC/mcp-official/index.ts:14-22`),
so those grants are gone after main-site's first boot without the plugin;
⚠️ not in code — whether the `youtube_transcripts` table still exists in
main-site's database.

### main-site's own types (reference)

main-site has its own `api::tag.tag` (table `tags`) among `article`,
`author`, `comment`, `global`, `landing-page`, `page`
(`MAIN/src/api/*/content-types/*/schema.json`). yt-kb's tag is
`plugin::yt-kb.tag` at `/api/yt-kb/tags`, table `yt_kb_tags`, so it does
not clash (`PSRC/routes/index.ts:3-5`). main-site's other types, routes and
middlewares are out of scope.

## Components

Nine, category `ytkb`, registered in `register()` through
`strapi.get('components').add(...)`, which the code's own comment calls not
a documented plugin API, proven by a spike on 5.52 (`PSRC/register.ts:9-37`).
⚠️ framework behavior — that the registry accepts them before schema sync on
5.61.0, which both this repo and main-site run (`server/package.json:22`,
`MAIN/package.json`).

| Component | Attributes |
|---|---|
| `ytkb.takeaway` | `text` text required ≤280 |
| `ytkb.section` | `timeSec` integer ≥0; `heading` string required ≤200; `body` text required ≤2000 |
| `ytkb.action-step` | `title` string required ≤120; `body` text required ≤600 |
| `ytkb.digest-shared-theme` | `title` string required ≤200; `body` text required ≤1500; `videoTitles` repeatable `ytkb.digest-video-title` |
| `ytkb.digest-video-title` | `title` text required ≤300 |
| `ytkb.digest-unique-insight` | `videoTitle` text required ≤300; `insight` text required ≤600 |
| `ytkb.digest-contradiction` | `topic` string required ≤200; `positions` repeatable `ytkb.digest-contradiction-position`, min 2 |
| `ytkb.digest-contradiction-position` | `videoTitle` text required ≤300; `stance` text required ≤400 |
| `ytkb.digest-viewing-order` | `videoTitle` text required ≤300; `why` text required ≤300 |

The five `≤280`/`≤300` fields above were `string` until 0.1.1 (`64f70f9`),
when PostgreSQL's varchar(255) failed copies to main-site. Source:
`PSRC/components/*.json`.

## Dynamic zones

None in yt-kb.

## API surface

### REST (auto-generated)

Plugin content-API routes under `/api/yt-kb` (`PSRC/routes/index.ts:11-27`):
`GET/GET/POST/PUT/DELETE` on `videos`, `tags`, `transcripts`, `notes`,
`digests`, each handled by an un-overridden core controller
(`PSRC/controllers/index.ts:7-14`). Scope per route is
`plugin::yt-kb.<type>.<action>` (comment, `routes/index.ts:7-10`; ⚠️
framework behavior). Nothing is granted to Public, and every boot deletes
any `plugin::yt-kb.*` Users & Permissions grant on the Public and
Authenticated roles (`PSRC/permission-seeding/users-permissions.ts:10-24`,
called from `PSRC/bootstrap.ts:11`). ⚠️ framework behavior — the private
`searchIndex` is removed from REST output.

### Default population strategy

None configured in the plugin; each caller passes `fields` and `populate`.

- App feed (`getFeed`, `client/src/data/server-functions/videos.ts:109`):
  `fields` = nine card fields, `populate: ['tags']`
  (`client/src/lib/services/videos.ts:250-253, 283-285`).
- App detail rows that reach the browser: every light scalar
  (`CORPUS_BASE_FIELDS`, `videos.ts:360-368`), the three components, tags
  and the transcript limited to nine fields, without `searchIndex` or the
  YouTube metadata (`videos.ts:374-391`).
- App internal rows: no `fields`, all relations and components
  (`videos.ts:396-398`); `stripVideoForClient` nulls `transcriptSegments`,
  `summaryEmbedding` and `passageEmbeddings` before a row crosses to the
  browser (`videos.ts:545-548`).
- Site build: `VIDEO_FIELDS` plus per-relation `populate[...][fields]`
  (`site/src/lib/video.ts:21`, `site/src/lib/strapi.ts:6, 24-27`).

### Custom routes

| Route | Handler | Does |
|---|---|---|
| `POST /api/yt-kb/transcripts/fetch` `{data:{videoId, force?}}` | `fetcher.fetchTranscript` (`PSRC/controllers/fetcher.ts:34-47`) | 400 when `force` is present and not boolean; calls `fetcher.fetchAndStore`, which rejects anything but an 11-character id as `invalid_id` (`PSRC/services/fetcher.ts:105-113`; a URL is not accepted here). Answers `{data: <sanitized transcript>, meta:{action: created/updated/skipped}}`. A `TranscriptFetchError` answers 400 (`invalid_id`), 404 (`unavailable`, `no_captions`) or 502 (`blocked`, `rate_limited`, `network`) with `{data: null, error:{status, name: 'TranscriptFetchError', message, details:{reason}}}` (`PSRC/services/fetch-errors.ts:5-46`); any other error goes to Strapi's error middleware (`controllers/fetcher.ts:26-31`). `fetchAndStore` logs one `warn` line per failure (`fetcher.ts:83-99`). A create that loses a race to another fetch of the same id returns the stored row as `skipped` (`fetcher.ts:145-163`) |
| `GET /api/yt-kb/yt-transcript/:videoId` (content API) and `GET /yt-kb/yt-transcript/:videoId` (admin, policy `admin::hasPermissions` with `plugin::yt-kb.tool.fetch-transcript`) | `fetcher.getOrFetch` (`controllers/fetcher.ts:49-63`, `PSRC/routes/index.ts:32, 39-50`) | Accepts an id or a watch / youtu.be / shorts / embed / live URL (`extractYouTubeId`); returns the stored row as `{data}` with no YouTube call, else fetches, stores and returns `{data, meta:{action: 'created'}}`; never forces. Errors as above |
| `POST /api/yt-kb/import/:type` `{data:[...]}` | `importer.importRecords` (`PSRC/controllers/importer.ts:12-33`) | 403 `ForbiddenError` unless plugin config `import === true` (default `false`, `PSRC/index.ts:25`; main-site reads `YT_KB_IMPORT`, `MAIN/config/plugins.ts:21`); 400 on an unknown type or a non-array body. Keeps only schema attributes, drops `mappedBy` relations, turns populated relations into documentIds and strips component ids (`PSRC/services/importer.ts:41-81`); there is no content-API input sanitization. Upserts by `documentId` through the Document Service (so the create rules apply), then stamps `created_at`/`updated_at` with the transaction's knex, write and stamp in one transaction (`importer.ts:99-131`). Answers `{created, updated, failed[]}` with 200, or 207 when any record failed (`controllers/importer.ts:30-32`). Types must be imported in `IMPORT_TYPES` order (tag, transcript, video, note, digest) so relations resolve (`importer.ts:13-15`) |

Content-API scopes of the custom handlers: `plugin::yt-kb.fetcher.fetchTranscript`,
`plugin::yt-kb.fetcher.getOrFetch`, `plugin::yt-kb.importer.importRecords`
(comments, `controllers/fetcher.ts:5-8`, `controllers/importer.ts:8`; ⚠️
framework behavior). `copy-content.mjs` sends at most 900,000 bytes per
import request (`server/src/plugins/yt-kb/scripts/import-batches.mjs:9`);
main-site raised its JSON body limit to 10 MB (`MAIN/config/middlewares.ts:32`,
`a32c8a0`).

### GraphQL (if applicable)

Not installed in either Strapi (no `graphql` in `server/package.json` or
`MAIN/package.json`).

## MCP server (if enabled in stage 4)

### yt-kb's 21 tools

Registered in `register()` (`PSRC/register.ts:41-43`) by
`registerOfficialMcpTools` (`PSRC/mcp-official/index.ts:10-54`), in this
order:

1. Admin actions, always, before any check: one per tool,
   `plugin::yt-kb.tool.<kebab>` (section `plugins`, subCategory `AI tools`),
   plus the three legacy tiers `plugin::yt-kb.read`, `.write`,
   `.maintenance` (subCategory `MCP tools`, labelled "legacy — migrated at
   boot") — 24 in one `registerMany`, not wrapped in try/catch
   (`PSRC/mcp-official/permissions.ts:12-13, 26-75`; `index.ts:14-28`).
2. Plugin config `mcp === false` → stop, logged (`index.ts:33-36`).
3. `strapi.ai.mcp.isEnabled()` false → stop, logged (`index.ts:38-45`).
4. Each tool registered by `registerDomainTool`, which catches a throwing
   `registerTool` (a duplicate name, for example), logs `skipped MCP tool
   <name>` and goes on; the count is logged (`PSRC/mcp-official/adapter.ts:68-127`,
   `index.ts:47-53`).

Names (`PSRC/mcp-official/names.ts:14-33`): MCP name `yt_kb__<snake_case>`
(`getVideo` → `yt_kb__get_video`), title `YT Knowledge Base: <Words>`,
action `plugin::yt-kb.tool.<kebab>`. Each tool's only auth policy is its own
action (`adapter.ts:86`). ⚠️ framework behavior — a token without the action
does not see the tool listed; a call answers `Tool "<name>" is not available
in this request` (`MAIN/node_modules/@strapi/core/dist/services/mcp/tool-registry.js:60-83`).
Input schemas are the zod 4 API from `@strapi/utils`, which loads `zod/v4`
(`server/node_modules/@strapi/utils/dist/index.js:47`); both Strapis have
`zod` 4.4.3 (`server/node_modules/zod`, `MAIN/node_modules/zod`). ⚠️
framework behavior — the MCP SDK validates arguments against that schema.
Results over 950,000 estimated wire bytes (JSON size × 2 + 2048) become
`{error: 'RESULT_TOO_LARGE', tool, bytes, limitBytes, message}` with a
per-tool hint (`adapter.ts:45-64, 97-108`). A tool body that throws is
logged (`MCP tool failed <name>`) and rethrown (`adapter.ts:88-95`); Strapi
answers `Tool "<name>" execution failed: <message>` with `isError: true`
(`tool-registry.js:106-117`). No tool calls Ollama: the plugin's only
outbound HTTP is YouTube (`PSRC/services/youtube-transcript.ts:41, 229`) and
httpbin (`:570`); "Ollama" appears in `PSRC/` only in comments and
messages.

| `sideEffects` (legacy tier) | Tools (base names) |
|---|---|
| `none` → `plugin::yt-kb.read` (15) | `libraryStats`, `listVideos`, `searchVideos` (every token must match), `getVideo` (strips `transcriptSegments`, `passageEmbeddings`, `summaryEmbedding`), `getTranscript` (modes `full` with `offset`/`maxChars` ≤400,000 default 120,000; `chunked` with `page`/`pageSize` ≤500 default 200; `timeRange`), `searchTranscript` (the Video's current `transcriptSegments` index, else the Transcript's `searchIndex` built on first use, else substring over `rawSegments`), `findTranscripts` (every token must match; 244-char previews), `crossSearchTranscripts` (every video with a transcript, summarized or not; same two indexes, no substring fallback), `listTranscripts`, `aggregateByTag`, `listUntagged`, `listTags`, `relatedVideos` (needs a current `summaryEmbedding`), `getReadableArticle`, `generateDigest` (2–5 `generated` videos; returns material, writes nothing) |
| `write` → `plugin::yt-kb.write` (4) | `saveSummary` (section `timeSec` from BM25 over the transcript's index, else null), `tagVideo` (tags and Video in one transaction, retried once on a unique violation), `untagVideo`, `saveNote` |
| `external` → `plugin::yt-kb.maintenance` (2) | `addVideo`, `fetchTranscript` |

Source: `PSRC/mcp-official/tools.ts:30-58`, `PSRC/mcp/tools/*.ts`
(`get-video.ts:27-46`, `get-transcript.ts:12-61`, `search-transcript.ts:1-115`,
`find-transcripts.ts:15, 56-67`, `cross-search-transcripts.ts:1-100`,
`related-videos.ts:59-64`, `generate-digest.ts:17-23, 78`,
`save-summary.ts:5-15, 113-114`, `tags.ts:61-87`). `sideEffects` now feeds
only the legacy-grant migration (`adapter.ts:20-29`): at every boot, before
admin's cleanup, each `plugin::yt-kb.read/.write/.maintenance` row of an API
token or a non-super-admin role becomes that tier's per-tool rows (15 / 4 /
2), copying `conditions`, and the legacy row is deleted, one transaction
per row; super-admin and orphan rows are skipped; failures are logged, never
thrown (`PSRC/permission-seeding/legacy-grants.ts:1-113`,
`permission-seeding/index.ts:8-20`, `PSRC/bootstrap.ts:9-11`).

`fetchTranscript` input: `videoId` must match `/^[A-Za-z0-9_-]{11}$/`,
`force` boolean default false; there is no `proxyUrl` input — the proxy is
the plugin's `proxyUrl` only (`PSRC/mcp/tools/fetch-transcript.ts:18-27`,
`PSRC/services/fetcher.ts:15-16, 118`). It calls `fetchAndStore`, then adds
a `pending` Video linked to the transcript when none exists
(`createVideoCard`, `PSRC/services/video-card.ts:23-59`), and returns
`videoAction: created/exists` and `videoDocumentId` with the transcript
result (`fetch-transcript.ts:43-70`). `addVideo` takes `url` (zod `.url()`,
then `extractYouTubeId`), `caption` ≤500, `tags` ≤20 × 1–40 chars, returns
`exists` without fetching when the Video is stored, and uses the same
`createVideoCard` (`PSRC/mcp/tools/add-video.ts:21-90`). For both, a
`TranscriptFetchError` is returned as a result `{videoId, error, reason}`,
not thrown, and is logged once by `fetchAndStore`; other errors are thrown
(`fetch-transcript.ts:36-42`, `add-video.ts:64-70`).

Guards: `PSRC/mcp-official/permissions.guard.test.ts:12-45` (permissions
registered before the `isEnabled()` check and before any `return;`; 21
unique tool actions + 3 legacy), `names.test.ts:29-53` (the 21 names in
order, `yt_kb__` names, the 15 / 4 / 2 split), `adapter.test.ts:17-75` (21
prefixed tools, 24 action uids in one call, skip-and-continue on a throwing
registration, permissions but no tools when `mcp` is off). These run in
`yarn plugin:test`, not in the client suite.

### Content Manager's tools for yt-kb's types

Strapi's Content Manager registers, in its bootstrap, `list_`, `get_`,
`create_`, `update_` and `delete_` tools for every displayed collection
type, yt-kb's five included (`content-manager.visible: true` in each
schema); none of yt-kb's types has draft & publish, so no `publish_` /
`unpublish_` / `discard_` tools for them. Names use the slug
`plugin-yt-kb_<type>` (for example `create_plugin-yt-kb_video`), and each
tool's policy is the Content Manager action
(`plugin::content-manager.explorer.read/create/update/delete`) on that type,
not `plugin::yt-kb.*`
(`MAIN/node_modules/@strapi/content-manager/dist/server/mcp/register-content-manager-mcp-tools.js:6-31`,
`utils.js:11-18`, `derive-content-type-mcp-tools.js:100-215`,
`services/permission-checker.js:8-15`). They can create, change and delete
yt-kb rows outside yt-kb's per-tool actions. ⚠️ framework behavior — that
their handlers go through the Document Service (so yt-kb's rules apply) and
the exact per-field permission checks.

### Tools on main-site's `/mcp` (reference)

`/mcp` is on unless `MCP_ENABLED` is false (`MAIN/config/server.ts:10-12`).

- yt-kb 0.1.1: the 21 `yt_kb__*` tools above, registered in `register()`;
  `mcp: true` (`MAIN/config/plugins.ts:16-24`;
  `MAIN/node_modules/strapi-plugin-yt-kb/dist/server/index.js:2343`).
- `tanstack-ai` 1.7.0: `list_content_types`, `search_content`,
  `aggregate_content`, `find_one_content`, `create_content`,
  `update_content`, `upload_media`, `send_email`, registered in
  `bootstrap()`; optional prefix `mcp.toolPrefix` (default `""`), each
  gated by `plugin::tanstack-ai.tool.<kebab>`, a throwing registration
  logged and skipped (`TS/` L80-82, L1273-1300, L1377-1401, L1440-1448).
- content-manager per-type tools, for main-site's own types
  (`list_article`, …), plugin types such as `strapi-plugin-music-manager`'s,
  and yt-kb's five; no try/catch around `registerTool`
  (`register-content-manager-mcp-tools.js:29-31`).
- core: `log` (`MAIN/node_modules/@strapi/core/dist/services/mcp/index.js:96`).
- The other installed plugins (`ocyris-strapi-builder-mcp` 1.0.4,
  `strapi-oauth-mcp-manager` 1.0.0, `strapi-plugin-lms` 0.0.2,
  `strapi-plugin-music-manager` 0.2.2, `strapi-plugin-form-kit` 0.4.1)
  contain no `registerTool`, `ai.mcp` or `ai-tools` (grep of their `dist`).
- Registration throws on a duplicate name, on a definition without auth
  policies, and after the server has started; the first registration of a
  name wins (`MAIN/node_modules/@strapi/core/dist/services/mcp/index.js:46-51`,
  `internal/McpCapabilityDefinitionRegistry.js:18-27`). yt-kb's prefixed
  names cannot equal any unprefixed name above. ⚠️ framework behavior —
  every plugin's `register()` runs before any `bootstrap()`, so yt-kb's
  tools register first.
- ⚠️ not in code — Recorded 2026-11-08: a direct `tools/list` call to Cloud `/mcp` with the
  owner's `STRAPI_PROD` admin token listed 62 tools, all 21 `yt_kb__*`
  among them and no `youtube_transcripts__*`. A Claude Code session that
  connected to `strapi-prod` before the deploy keeps its old tool list
  until it reconnects.

### `tanstack-ai`'s admin chat: how it finds other plugins' tools

Per chat request, for every plugin except itself:
`strapi.plugin(name).service('ai-tools')`; `getTools()` must be synchronous
and return an array of `{name, description, schema, execute}`, each with an
optional `action`; optional `getMeta()` gives `{label, description}`. The
`action` (or a derived `plugin::<plugin>.tool.<slug>`) must already be
registered with the admin action provider, or the tool is dropped with a
warning. Tools are named `<plugin>__<name>`, described `[<label>]
<description>`, and kept only when `ability.can(action)` for the admin using
the chat; when no ability is passed, every tool is offered. `execute` is
called as `execute(args, strapi, {})` (`TS/` L1869-2028, L2361-2388; the
chat controller passes `ctx.state.userAbility`, L1583-1587).
`chat.toolSources` (host service UIDs) is the other way in; main-site sets
none (`MAIN/config/plugins.ts:2-15`). `@tanstack/ai` 0.52.3 converts a
tool's `schema` through Standard JSON Schema (zod 4.2+)
(`MAIN/node_modules/@tanstack/ai/dist/esm/activities/chat/tools/schema-converter.js:157-169`)
and parses the arguments with it before calling the tool (`tool-calls.js:176-177, 451-452`).

yt-kb's `ai-tools` service (`PSRC/services/ai-tools.ts`, registered in
`PSRC/services/index.ts:16`): `getTools()` returns the same 21
`domainTools` with the bare base name (so the chat sees `yt-kb__getVideo`),
the tool's description and zod schema, `action: plugin::yt-kb.tool.<kebab>`,
and an `execute` that calls the tool body with `{strapi}` and `{}` for
missing args (`ai-tools.ts:27-37`). `getMeta()` returns label `YT Knowledge
Base` and keywords `/yt-kb`, `/youtube`, `video`, `transcript`
(`ai-tools.ts:21-25, 38-40`). It does not depend on the `mcp` config or on
`/mcp` being enabled: the actions it names are registered unconditionally
(see above). Unlike the MCP path, it has no result-size cap and no
`MCP tool failed` log line (`ai-tools.ts:33-34`); a failed YouTube fetch is
still logged once by `fetchAndStore`. Guarded by
`PSRC/services/ai-tools.test.ts:9-55` (synchronous array, registered
actions only, Standard JSON Schema on every schema).
## Auth

No end-user auth in the app or the site (see 04). Callers of Strapi:

| Caller | Credential | Where it lives |
|---|---|---|
| TanStack app | `yt-kb-app`, a custom Content API token, no expiry, 24 scopes: `find/findOne/create/update/delete` on video, tag, note, digest; `find/findOne` on transcript; `fetcher.fetchTranscript`, `fetcher.getOrFetch` (`server/src/plugins/yt-kb/scripts/create-tokens.cjs:26-33, 37-42, 134-141`) | `STRAPI_API_TOKEN` in `client/.env` (`client/.env.example:4-13`); sent as `Bearer` by `strapiFetch` (`client/src/lib/services/strapi-client.ts:198-200`) |
| Astro site build | `yt-kb-site`, custom Content API token: `video.find`, `tag.find` (`create-tokens.cjs:34, 43-48`) | `STRAPI_API_TOKEN` in `site/.env` (`site/.env.example:5-14`); sent by `site/src/lib/strapi.ts:62` |
| MCP clients | Admin API token holding `plugin::yt-kb.tool.<kebab>` per tool (see Permissions) | the client's MCP config (⚠️ not in code). Recorded by the session: local admin token `claude-mcp-1782487483515` holds the 21 per-tool grants; the owner's MCP server `strapi-prod` uses an admin token on Cloud |
| `tanstack-ai` admin chat (main-site) | the admin's session; yt-kb tools offered only when the admin's role holds the tool's action (`PSRC/services/ai-tools.ts:1-8, 28-37`) | the browser |
| `copy-content.mjs` | Content API tokens: source read; destination `plugin::yt-kb.importer.importRecords` plus read for the check, and the destination's plugin config `import: true` (`server/src/plugins/yt-kb/scripts/copy-content.mjs:5-14`, `PSRC/controllers/importer.ts:14-21`). Neither token above holds `importRecords` | `SOURCE_TOKEN`, `DEST_TOKEN`. Recorded by the session: Cloud has a temporary `yt-kb-import` token the owner is to delete |
| Strapi admin panel user | admin JWT (`ADMIN_JWT_SECRET`, `server/config/admin.ts:4-6`); Content Manager permissions decide what they can do to yt-kb rows, which are all visible there (`PSRC/content-types/*/schema.json`) | the browser (⚠️ framework behavior) |
| A signed-in Users & Permissions user | JWT from `/api/auth/local` | the caller; gets no yt-kb route: every boot removes yt-kb permissions from the Public and Authenticated roles (see Permissions) |

`create-tokens.cjs` runs from a Strapi app root with Strapi stopped on
SQLite (`:126-128`), writes each key to a 0600 file and never prints it
(`:100-103`), leaves an existing token alone unless `--rotate <name>`
(`:144-147`), and rotates only a Content API token, revoke + create in
one transaction (`:149-163`). Tokens on Cloud, recorded by the session:
`yt-kb-app`, `yt-kb-site`, `yt-kb-import` (temporary). ⚠️ not in code —
their scopes as stored.

Users & Permissions is installed in this repo's Strapi
(`server/package.json:21`) with a stock user extension
(`server/src/extensions/users-permissions/content-types/user/schema.json`)
and on main-site (`MAIN/package.json:19`); nothing in the product signs in
through it. `server/scripts/seed.mjs` is gone (removed in `b92be6a`).

## Session

- **The app and the site:** none (no sign-in). The app's token is
  server-side only (⚠️ framework behavior — TanStack Start keeps server-fn
  code out of the browser bundle). `client/src/lib/env.ts` is also bundled
  into the browser, where `STRAPI_API_TOKEN` is absent, so its startup
  warnings run on the server only (`env.ts:126-145`, `93672f3`).
- **Strapi admin panel:** ⚠️ framework behavior — Strapi's own admin
  session: admin JWT from `/admin/login`, held by the browser, sent on
  each admin request, checked by Strapi's admin auth, expiry per Strapi's
  defaults. This repo configures only `ADMIN_JWT_SECRET`
  (`server/config/admin.ts:4-6`).

## Permissions & roles

### End-user roles (content API)

- The plugin grants nothing to Public (`PSRC/routes/index.ts:7-10`).
- Every boot, `seedPermissions` (awaited first in `bootstrap`,
  `PSRC/bootstrap.ts:11`) deletes every `plugin::users-permissions.permission`
  row whose action starts with `plugin::yt-kb.` on a role of type `public`
  or `authenticated`; no-op without Users & Permissions; logs the count;
  never throws (`PSRC/permission-seeding/users-permissions.ts:7-24`,
  `index.ts:22-33`).
- The host comments now match: `server/.env.example` (`HOST`),
  `server/config/server.ts:10-11`, `server/src/index.ts:1-4`,
  `client/src/lib/env.ts:111-121`, and the site-token comments name
  `yt-kb-site` (`PSRC/routes/index.ts:9-10`, `site/src/content.config.ts:14`,
  `site/src/lib/strapi.ts:45`, `site/.env.example:7-13`).

### Admin roles (Strapi admin panel, `/admin`)

- yt-kb registers 21 per-tool actions `plugin::yt-kb.tool.<kebab>`
  (section `plugins`, subCategory `AI tools`, label from the tool name)
  plus the three legacy tiers `plugin::yt-kb.read` / `.write` /
  `.maintenance` (subCategory `MCP tools`, "(legacy — migrated at boot)"),
  in `register()`, before the MCP enabled checks, not in try/catch
  (`PSRC/mcp-official/permissions.ts:26-75`, `names.ts:17-28`,
  `index.ts:14-28`). Pinned by `PSRC/mcp-official/permissions.guard.test.ts:13-43`
  (the client's `mcp-permissions.guard.test.ts` was removed).
- Each MCP tool is named `yt_kb__<snake>` and declares
  `auth.policies: [{action: plugin::yt-kb.tool.<kebab>}]`
  (`PSRC/mcp-official/adapter.ts:75, 86`); ⚠️ framework behavior — the
  official MCP server lists a tool only to a token holding it. The
  `ai-tools` service gives `tanstack-ai` the same 21 tools with the same
  actions (`PSRC/services/ai-tools.ts:28-37`). `plugin::yt-kb.tool.fetch-transcript`
  also gates the admin route `GET /yt-kb/yt-transcript/:videoId`
  (`PSRC/routes/index.ts:38-52`, `permissions.ts:22-24`).
- **Legacy-tier migration**, every boot: each `admin::permission` row on a
  legacy tier that belongs to a token or a non-super-admin role gets that
  tier's per-tool actions inserted (read → the 15 `sideEffects: 'none'`
  tools, write → 4, maintenance → 2), copying `conditions`, then the legacy
  row is deleted, one transaction per row. Super-admin and orphan rows are
  skipped; idempotent; logged; a failure is a `warn`, not a crash
  (`PSRC/permission-seeding/legacy-grants.ts:1-117`, `index.ts:11-21`).
- `tanstack-ai` registers eight `plugin::tanstack-ai.tool.*` actions for
  its own tools, in `register()` (`TS/` L80-95, L1426-1438).
- `youtube-transcripts` is removed from main-site (`MAIN/package.json`
  has no entry; `484b1d3`). No migration carries its
  `plugin::youtube-transcripts.tool.*` grants (`MAIN/database/migrations/`
  holds three older files); ⚠️ framework behavior — Strapi deletes them at
  the next boot.
- Content Manager's per-type permissions gate the Content Manager's own
  MCP tools on yt-kb types, not `plugin::yt-kb.*` (see "MCP server").
- ⚠️ framework behavior — Strapi deletes admin permission rows whose action
  is no longer registered at boot (stated in `PSRC/mcp-official/permissions.ts:8-13`
  and `MAIN/database/migrations/2026.10.22T00.00.00.carry-ai-chat-tool-grants-to-tanstack-ai.js:5-13`).

## Server-side handlers

The TanStack app has no auth; the dev server listens on `127.0.0.1:3005`
only (`client/vite.config.ts:12-15`; started by `yarn dev`,
`client/package.json:9`), so only this machine can call a handler. There
is no Host or Origin check in app code (grep of `client/src`). All
handlers use the one `STRAPI_API_TOKEN` (`strapi-client.ts:198-200`),
with a 30 s default timeout (`:84, 224-225`; transcript fetch 120 s,
`client/src/lib/services/videos.ts:989`). Every input-derived path
segment goes through `seg()` (`strapi-client.ts:187-192`). Server fns
validate with zod `.validator`; documentIds must match
`/^[a-z0-9]{24}$/` (`DOCUMENT_ID`) and digest / chat-to-note ids
`/^[A-Za-z0-9_-]{1,64}$/` (`VIDEO_REF`) (`client/src/lib/validations/post.ts:57-64`);
API routes check by hand. "Checks first" lists what runs before any
write, beyond input validation. Line numbers are in
`client/src/data/server-functions/videos.ts` unless named.

**Writes or deletes**

| Handler | Checks first | Writes |
|---|---|---|
| `shareVideo` (`:196`) | URL → 11-char id; not already stored (`:206`, again in `createVideoService`, `services/videos.ts:630`); a race on the unique key re-reads and answers `exists` (`services/videos.ts:663-667`); a tag that fails to create stops the share (`:644`) | Tags, Video; starts generation and ignores the start result (`:188-194`). Takes a `mode` (`auto/single/mapreduce`, `:162-167`), as do `triggerSummaryGeneration` and `regenerateSummary` (`:251-253, 314-324`) |
| `triggerSummaryGeneration` (`:255`) | row not `generated` (else clears the failure and returns it); recent-failure window | via generation |
| `regenerateSummary` (`:326`) | row exists; clears the failure window; skips when already running | `summaryStatus: pending` only when a job starts (`beforeStart`, `:351-354`), then generation. `forceRefetch` (`:322`) has no UI sender |
| `regenerateVideoVerdict` (`:1484`) | row exists; cleaned transcript ≥50 chars (`services/learning.ts:1630, 1641`) | verdict fields, `valueScore`, `finalScore` |
| `regenerateVideoSignals` (`:1612`) | row and its `transcript.rawText` exist (does not check `generated`) | `signalScores`, `signalScore`, `finalScore` |
| `regenerateVideoEmbedding` (`:517`) | row is `generated` | embedding fields |
| `updateSectionTimecode` (`:289`) | section id on the row; GET then PUT of the whole `sections` array, no version check (`services/videos.ts:902-932`) | `sections` |
| `reindexAllTranscriptIndexes` (`:689`), `reindexAllEmbeddings` (`:771`), `reindexAllPassages` (`:1112`) | refuse on a partial corpus read | `transcriptSegments`, embedding fields, `passageEmbeddings` |
| `backfillSignalScores` (`:1666`), `backfillFinalScores` (`:1744`), `backfillValueScores` (`:1431`, no UI caller) | none; `runBackfill` re-reads from the front past rows it could not fix, `id:asc`, up to 200 passes; a failed read or the pass cap returns `status: 'error'` with the counts so far (`client/src/lib/services/backfill.ts:1-69`) | score fields |
| `createNote`, `updateNote`, `deleteNote` (404 = success, `services/notes.ts:125-133`), `summarizeToNote` (`notes.ts:54, 76, 100, 155`) | ids valid; `summarizeToNote` resolves every id or stops | Note |
| `saveDigest` (`digests.ts:52`) | 2–5 ids resolve, a backend error is not read as "not found"; find by `videoSetKey`, else create, and a duplicate re-reads and updates (`services/digests.ts:316-355`) | Digest |
| `deleteSavedDigest` (`digests.ts:264`, no UI caller) | valid `documentId`; 404 = success (`services/digests.ts:357-368`) | **deletes** a Digest |
| `generateReadableArticle` (`reader.ts:28`) | own in-process Set (`reader.ts:26`); cached unless forced | `readableArticle*`, through `strapiFetch` (`services/reader.ts:353-375`) |

**Read only (may call Ollama)**

| Handler | Calls Ollama | Notes |
|---|---|---|
| `getFeed`, `getVideoByVideoId`, `getVideoByDocumentId`, `listNotesForVideo`, `listSavedDigests`, `fetchSavedDigest`, `fetchSavedDigestByVideoIds` (no UI caller), `listRegenerableVideos`, `getEmbeddingStatus`, `get*Coverage`, `count*` | no | `count*` return `{missing: 0, error}` on a Strapi error (`:1427, 1597, 1740`); `listRegenerableVideos` returns an error, never a partial list, 50-page cap (`:1537-1564`) |
| `getGenerationProgress`, `clearSummaryFailure` | no | in-memory state only |
| `relatedVideos`, `getChatResponseEvidence`, `searchTags` (no UI caller) | no | |
| `semanticSearchVideos`, `searchLibraryPassages`, `suggestTagsForUrl` | embeddings | `suggestTagsForUrl` also calls oEmbed |
| `askAboutVideo` (no UI caller), `loadDigest` (synthesizes on a cache miss, in a GET loader), `generateDigest` (no UI caller), `generateDigestArticle` | chat | `/digest` sets `preload: false` (`client/src/routes/digest.tsx:39`) |
| `POST /api/chat`, `/api/digest-chat` (2–5 ids), `/api/notes/compose` (prompt ≤4000) | chat | 400 on bad JSON or missing fields; 503 when Strapi errors, 404 no row, 409 unless `generated` (`api.chat.tsx:110-135`, `api.digest-chat.tsx:92-118`, `api.notes.compose.tsx:84-101`). Chat and digest-chat load the row with its index via `fetchVideoByVideoIdForServerWithStatusService` and never return it (`services/videos.ts:583-602`, guarded by `route-options.guard.test.ts:39-46`) |
| `POST /api/ask` | embeddings + chat | question 1–1000 chars; 500 on retrieval failure (`api.ask.tsx:52-80`) |

## Lifecycles / policies / middlewares

- yt-kb Document Service middleware, on **create and update** of yt-kb's
  five UIDs only, registered in `register()` (`PSRC/document-rules.ts:109-129`,
  `PSRC/register.ts:39`):
  - create: video and transcript require `youtubeVideoId` and reject a
    duplicate with a 400 naming the existing `documentId` (`:38-67`); tag
    normalizes `name` (`normalizeTagName`: trim, lower-case, collapse
    whitespace, `:16-18`) and, when `slug` is absent, fills the first free
    `slugifyTagName` slug (`base`, `base-2`, …, `:22-32, 73-80`).
  - update: a tag `name` is normalized; the slug is kept (`:83-90`).
  - any other unique violation on a yt-kb write (validator or raw index
    error) is rethrown as a 400 `ValidationError` with
    `details.code === UNIQUE_CODE` (`:117-127`, `PSRC/services/db-errors.ts`).
- One policy: `admin::hasPermissions` with
  `plugin::yt-kb.tool.fetch-transcript` on the admin route
  `GET /yt-kb/yt-transcript/:videoId` (`PSRC/routes/index.ts:38-52`). The
  import route's `import: true` gate is in the controller, 403 otherwise;
  200, or 207 when any record failed (`PSRC/controllers/importer.ts:12-33`).
- No lifecycle files in yt-kb or this repo's `server/`; `server/src/middlewares/`
  is empty. This repo's global middlewares: `strapi::cors` with
  `origin: []`, `credentials: false`; `strapi::body` 20 MB
  (`server/config/middlewares.ts:7-28`).
- main-site: CORS for one origin with the MCP headers, CSP
  `frame-ancestors`, `strapi::body` `jsonLimit: 10mb` for
  `copy-content.mjs` (`MAIN/config/middlewares.ts:4-33`, also
  `MAIN/config/env/production/middlewares.ts`, `a32c8a0`); its own route
  middlewares for its types (`MAIN/src/api/*/routes`,
  `MAIN/src/middlewares/global-page-populate.ts`, `is-owner.ts`).

## Pages & components (frontend)

### TanStack app (`client/src/routes/`)

Who can open any route: anyone who can reach `127.0.0.1:3005` (no auth).
Every loader fetches through server fns with `STRAPI_API_TOKEN`. Router
preloads on intent and has a default error component (Retry =
`router.invalidate()`) and pending component (`client/src/router.tsx:6-14`,
`client/src/components/RouteStates.tsx:7-42`). Polling is
`usePollingInvalidation`: `router.invalidate()` every 3 s, at most 200
times (10 min), then `capReached` (`client/src/lib/hooks/use-polling-invalidation.ts:4-53`).

| Route | Fetches | Renders / caches | Core loop |
|---|---|---|---|
| `/new-post` | none; submit → `shareVideo`; URL → `suggestTagsForUrl` | share form; a thrown server fn shows an error (`components/NewPostForm.tsx:47-67`) | **Yes** (entry) |
| `/learn/$videoId` | `getVideoByVideoId`; if `pending` → `triggerSummaryGeneration` + `getGenerationProgress`; `preload: false` | 5 states (backend-error, unshared, pending, failed, ready); polls while pending, also on tab focus, says so when the cap is hit (`learn.$videoId.tsx:90-147`) | **Yes** |
| `POST /api/chat` | Video row, stored BM25 index, Ollama | SSE | **Yes** |
| `/feed` | `getFeed`, or `semanticSearchVideos` (90 hits, falls back to keyword and says why) (`feed.tsx:79-125`) | card grid; a `pending` card shows `PendingSummary` with a "Generate summary" link to `/learn` (`components/PendingSummary.tsx:7-23`, `VideoCard.tsx:32-38`); polls while a keyword-mode card is pending, capped (`feed.tsx:195-199`) | lists results |
| `/search` | `searchLibraryPassages` (Ollama + `passageEmbeddings`) | passage hits; errors through `friendlyOllamaError` (`search.tsx:33-46`) | No |
| `/digest`, `/digests` | `loadDigest` (saved row first; `preload: false`), `listSavedDigests` | digest report / list | No |
| `/settings` | `ContentSignalsPanel`, `EmbeddingCoveragePanel` (`settings.tsx`) | panels | No |
| `/video/$documentId` | `getVideoByDocumentId` (`video.$documentId.tsx:7-13`) | one card | No |
| `/about`, `/` (redirect to `/feed`) | — | — | No |
| `POST /api/ask`, `/api/digest-chat`, `/api/notes/compose` | Ollama + Strapi reads | SSE | No |

Source: `client/src/routes/*.tsx`; `preload: false` on the two
Ollama-starting loaders is pinned by
`client/src/lib/services/route-options.guard.test.ts:29-31`.

### Astro site (`site/src/pages/`)

Static, public, no credentials in the output. Data comes at build time from
`${STRAPI_BASE_URL}/videos` (default `http://localhost:1340/api/yt-kb`) with
`STRAPI_API_TOKEN` (`yt-kb-site`), filter `summaryStatus = generated`, 12
named fields plus `keyTakeaways`, `sections`, `actionSteps`, `tags.name`,
100 per page (`site/src/content.config.ts:9-16`,
`site/src/lib/strapi.ts:6-36`, `site/src/lib/video.ts:21-34`). Tag slugs
are derived from the name on the site (`site/src/lib/tags.ts:15`), not read
from Strapi.

| Route | Renders |
|---|---|
| `/` | search box, recent, highest scoring, topics |
| `/v/<youtubeVideoId>` | summary, verdict, sections that seek the embed, readable article |
| `/t/<tagSlug>`, `/topics`, `/articles` | tag pages, tag list, videos with a `readableArticle` |
| `/search-index.json` | MiniSearch source, built at build time; `Cache-Control: max-age=300` (`site/netlify.toml:15-18`) |
| `/404` | "Nothing here" and search (`site/src/pages/404.astro`) |

Never published: `transcriptSegments`, `summaryEmbedding`,
`passageEmbeddings`, `rawText`, `rawSegments` (`site/src/lib/video.ts:7-17`),
checked by `site/scripts/verify-output.mjs:14-20`.

## State management

React Query (`client/src/routes/__root.tsx:37-44`: no refetch on focus,
60 s stale) and router loaders. Generation progress and dedupe are process
memory (`client/src/lib/services/generation-state.ts:75-79`).

## Background jobs

- **Summary generation**, fire-and-forget in the app's server process,
  deduped by an in-memory `inflight` Set shared by `shareVideo`,
  `triggerSummaryGeneration`, `regenerateSummary`
  (`generation-state.ts:77, 85-150`). A failure blocks a restart of the
  same video for 5 minutes (`recentFailures`, `:75, 93-96, 209-218`);
  `/learn` shows it as failed meanwhile (`learn.$videoId.tsx:106-109`). An
  uncaught throw marks the row `failed` through `onTerminalThrow`
  (`generation-state.ts:129-145`, `server-functions/videos.ts:179-194`).
  The readable-article generator has its own Set
  (`server-functions/reader.ts:26`). Verdict re-rate, digests and
  backfills have none.
- **Settings bulk verdict re-rate** is a browser loop, one
  `regenerateVideoVerdict` call at a time, cancellable
  (`client/src/components/ContentSignalsPanel.tsx:12, 135-160`).
- **Pending cards from MCP** (`addVideo`, `fetchTranscript` in 0.1.1) are
  not generated by anything until `/learn/<id>` is opened
  (`PendingSummary.tsx:3-6`).
- **yt-kb boot work** (`PSRC/bootstrap.ts`): permission seeding, awaited
  (`:11`); the proxy test against httpbin when `proxyUrl` is set, not
  awaited (`:15-25`), else a `warn`, plus one if the old
  `TRANSCRIPT_PROXY_URL` is set (`:26-37`); with `backfillMetadata: true`
  (default false, `PSRC/index.ts:26-27`), a metadata backfill in the
  background: up to 500 transcripts with no `thumbnails`, paged by id,
  1.5 s pause per YouTube call, one failure never stops it, `language`
  and captions left alone (`PSRC/services/metadata-backfill.ts`,
  `bootstrap.ts:39-45`). main-site sets `backfillMetadata: false`
  (`MAIN/config/plugins.ts:22`, `MAIN/config/env/production/plugins.ts:22`).
- **Transcript search index**, lazy, not a job: a tool that finds a
  transcript with no current `searchIndex` builds it from `rawSegments`
  and saves it (`PSRC/services/search-index.ts:9-12, 32-53`).
- No cron in either Strapi (no `config/cron-tasks.*`; `MAIN/config/` and
  `server/config/` listed).

## Media & uploads

None in yt-kb (no media attribute, `PSRC/content-types/*/schema.json`).
This repo's Strapi uses the default local upload provider and
`server/public/uploads/` holds 15 files (⚠️ not in code — what they are);
nothing in yt-kb references them. main-site configures no upload provider
in its repo (`MAIN/config/plugins.ts`, `MAIN/config/env/production/plugins.ts`);
⚠️ framework behavior — Strapi Cloud's default applies.

## Outside services and other apps

| Service | Side that calls it | Key / env var | If it fails | How the team finds out |
|---|---|---|---|---|
| YouTube Innertube + caption XML | Strapi only (yt-kb plugin), `PSRC/services/youtube-transcript.ts` (ported from `youtube-transcripts` 2.6.2, header L4-38), from `fetcher.fetchAndStore` (`PSRC/services/fetcher.ts:104-164`) for the REST fetch routes, `addVideo`, `fetchTranscript` and the `ai-tools` copies of those tools. The app has no YouTube client (`client/src/lib/services/youtube-fetch.guard.test.ts`) | plugin config `proxyUrl`, default `env('PROXY_URL', '')` (`PSRC/index.ts:23`), read only in `fetcher.ts:118` and `bootstrap.ts:13`; no caller can pass one (`fetcher.ts:15-16`, `PSRC/mcp/tools/fetch-transcript.ts:18-27`) | Every failure is a `TranscriptFetchError` with a `reason` (`invalid_id`, `unavailable`, `no_captions`, `blocked`, `rate_limited`, `network`); REST answers 400 / 404 / 502 by reason with `details.reason` (`PSRC/services/fetch-errors.ts:5-46`, `PSRC/controllers/fetcher.ts:26-31`). The plugin makes up to 3 caption downloads, 25 s each, backoff 1 s / 3 s, or 2 s / 6 s on 429/403 raised to `Retry-After` (capped 15 s) with a fresh session (`youtube-transcript.ts:76-81, 316-392, 503-519`). Every Innertube request (session, `getInfo`, `getBasicInfo`) aborts after 20 s, as a `network` failure (`withRequestTimeout`, `INNERTUBE_TIMEOUT_MS`, `youtube-transcript.ts`; source 0.1.2, not yet on main-site). The app adds 120 s per request (`client/src/lib/services/videos.ts:989, 1009-1012`) and retries (3 attempts in total) only when Strapi was unreachable (status 0) or `reason` is `network` (`client/src/lib/services/learning.ts:114-146`), then marks the video `failed`. MCP `fetchTranscript` / `addVideo` return `{videoId, error, reason}` as a result, not a throw (`fetch-transcript.ts:36-42`, `add-video.ts:64-70`). Stored `language` is the caption track actually used, `'und'` when YouTube gives none (`youtube-transcript.ts:529-536`), clipped to 10 (`fetcher.ts:59`); rows stored earlier keep `'en'` until a forced re-fetch (`PSRC/services/metadata-backfill.ts:13-16`) | the failed state on `/learn` with the plugin's message (`videos.ts:1022-1031`); one `warn` line in Strapi's log per failure, whichever path asked (`fetcher.ts:83-99`) |
| YouTube oEmbed | the app (`fetchYouTubeMeta`, `learning.ts:212-228`, 5 s timeout) at share (`client/src/data/server-functions/videos.ts:218`) and again during generation (`learning.ts:906-909`); Strapi (`fetchOEmbedMeta`, `youtube-transcript.ts:548-563`, through the proxy, 5 s) as a fallback for title / author / thumbnail (`fetcher.ts:119-130`) | none | returns `{}`; fields left empty, or Innertube's | not surfaced |
| Proxy check | Strapi at boot: `GET https://httpbin.org/ip` through the proxy, 10 s (`youtube-transcript.ts:82, 565-580`) | `proxyUrl` | `error` log lines; boot goes on (`PSRC/bootstrap.ts:15-25`) | Strapi's log |
| Ollama | the app only (`learning.ts`, `embeddings.ts`, chat routes); no plugin code calls it (grep of `PSRC/`) | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_CHAT_MODEL`, `OLLAMA_SYNTHESIS_MODEL`, `OLLAMA_EMBEDDING_MODEL`, `EMBEDDING_VERSION`, `PASSAGE_EMBEDDING_VERSION`, `MAP_CONCURRENCY` (`client/src/lib/env.ts:26-84`) | generation → row `failed`; embedding passes skipped and logged (`learning.ts:1176-1252`); errors shown through `friendlyOllamaError` at listed call sites | UI messages; `[summary <id>]` log lines |
| DuckDuckGo HTML | the app (`client/src/lib/services/web-search.ts:53`) | none | 8 s timeout, 2 tries, then `[]` (`web-search.ts:47, 61, 96-103`) | log line |
| `i.ytimg.com` thumbnails, YouTube nocookie embed | the browser (app: `server-functions/videos.ts:228` fallback; site: `site/src/lib/player.ts:8, 66`) | none | broken image / empty player | visible on the page |
| Strapi | the app, the site build, MCP clients, `tanstack-ai`'s chat, `copy-content.mjs` | `STRAPI_URL` + `STRAPI_API_TOKEN` (client), `STRAPI_BASE_URL` + `STRAPI_API_TOKEN` (site) | app: 30 s default timeout (`client/src/lib/services/strapi-client.ts:84, 224-225`), `friendlyBackendError`, `BackendErrorPanel`; site: build throws (`site/src/lib/strapi.ts`) | UI panel; failed build |
| Netlify | `publish-site.sh`, `site:deploy` (`site/package.json:11`) | Netlify CLI login, `site/.netlify/state.json` (`publish-site.sh:60`) | script exits | terminal |
| Anthropic | main-site's `tanstack-ai` chat only | `ANTHROPIC_API_KEY` (`MAIN/config/plugins.ts:7`) | — | — |

**Other apps:** main-site (`strapi-cloud-backend-main-site`) installs the plugin from npm, `strapi-plugin-yt-kb` 0.1.1 (`MAIN/package.json:31`); `youtube-transcripts` is gone from it (`MAIN` commit `484b1d3`; not in `MAIN/package.json` or `MAIN/node_modules`). Its `tanstack-ai` chat reaches yt-kb's tools through the plugin's `ai-tools` service (`PSRC/services/ai-tools.ts:1-8`). The owner's Claude reaches them over `/mcp` (MCP server `strapi-prod`). ⚠️ not in code — Recorded 2026-11-08: a direct `tools/list` call to Cloud `/mcp` with the owner's `STRAPI_PROD` admin token listed 62 tools, all 21 `yt_kb__*` among them and no `youtube_transcripts__*`. A Claude Code session that connected to `strapi-prod` before the deploy keeps its old tool list until it reconnects.

## Hosting & environments

| Part | Environment | Config |
|---|---|---|
| App | owner's Mac only | `client/.env` (names in `client/.env.example`); `STRAPI_URL` picks the Strapi (`client/src/lib/env.ts:26`). ⚠️ not in code — being pointed at main-site on Strapi Cloud with the `yt-kb-app` token (recorded 2026-11-09) |
| This repo's Strapi | owner's Mac, test bed for the plugin, which it loads from source (`server/config/plugins.ts:6-13`) | `server/.env` |
| main-site | Strapi Cloud, `https://deserving-harmony-9f5ca04daf.strapiapp.com` (`MAIN/config/env/production/server.ts:5`); Strapi 5.61.0, `tanstack-ai` ^1.7.0, yt-kb 0.1.1 (`MAIN/package.json:20, 30-31`); database by `DATABASE_CLIENT` (`MAIN/config/database.ts:4`; ⚠️ framework behavior — Postgres on Strapi Cloud) | yt-kb config `proxyUrl: env("PROXY_URL", "")`, `mcp: true`, `import: env.bool("YT_KB_IMPORT", false)`, `backfillMetadata: false` (`MAIN/config/plugins.ts:16-24`, same in `MAIN/config/env/production/plugins.ts:16-24`); `strapi::body` `jsonLimit: "10mb"` (`MAIN/config/middlewares.ts:31-32`, `MAIN/config/env/production/middlewares.ts:28-29`) |
| Site | built locally, deployed to Netlify, `LIVE_URL` `https://boisterous-lamington-cc0eed.netlify.app` (`publish-site.sh:34`) | `site/.env`; `site/netlify.toml`; `publish-site.sh` |

`publish-site.sh` no longer checks Strapi itself: the build's loader fails on an unreachable Strapi, an error answer, a short read or no generated video (`publish-site.sh:7-11, 43-47`; `site/src/lib/strapi.ts:49-140`). It refuses an exported `SITE_SKIP_STRAPI_FETCH=1` (`:36-41`), an unknown argument (`:23-32`) and an unlinked `site/` (`:60-63`), prints page and video counts (`:49-52`), and with `--draft` deploys a preview only (`:65-73`).

⚠️ not in code — recorded 2026-11-08/09: the library (17 tags, 195 transcripts, 195 videos, 11 notes, 6 digests) was copied local → main-site with `copy-content.mjs`, check `ALL OK`. A first attempt failed for 144 videos (`varchar(255)` columns on Postgres, and the body limit); fixed by plugin 0.1.1 ("text for long fields", commit `64f70f9`) and the 10 MB `jsonLimit` (`MAIN` commit `a32c8a0`). The owner is to unset `YT_KB_IMPORT` and delete the `yt-kb-import` token on Cloud.

## Operations (robustness sweep)

| Item | What the code does |
|---|---|
| Backups | Not handled in code. Local backups are manual copies of `server/.tmp/data.db`; the owner has backups (owner, 2026-11-08). ⚠️ framework behavior — what Strapi Cloud backs up. |
| Copying data between Strapis | `server/src/plugins/yt-kb/scripts/copy-content.mjs`: `SOURCE_URL` and `DEST_URL` required, must differ, exit 2 otherwise (`:30-61`); `SOURCE_PREFIX` default `/api/yt-kb` (`:62`); `SOURCE_TOKEN`, `DEST_TOKEN` required (`:63-68`). Reads tag, transcript, video, note, digest in that order (`:74-104`); POSTs batches of ≤900 KB JSON (`scripts/import-batches.mjs:9, 16-33`), a bigger record alone; a 413 marks that batch failed and goes on (`import-batches.mjs:40-53`); 403 "Import is disabled" stops with exit 2 (`copy-content.mjs:155-160`); 207 counts per-record failures (`:144-167`). Upsert by documentId, keeps dates, `--check` compares field by field, never deletes; ends `ALL OK` / `PROBLEMS FOUND` (`:199-237`). The destination needs plugin config `import: true` (`PSRC/controllers/importer.ts:14-21`, 200 / 207 at `:31-32`) and a token with `plugin::yt-kb.importer.importRecords`. |
| Creating tokens | `scripts/create-tokens.cjs`, run from the host root with Strapi stopped on SQLite: `yt-kb-app` (CRUD on video, tag, note, digest; find/findOne on transcript; `fetcher.fetchTranscript`, `fetcher.getOrFetch`) and `yt-kb-site` (`video.find`, `tag.find`); keys written to `--out-app` / `--out-site` files, mode 0600, never printed; an existing token is left alone unless `--rotate <name>` (`create-tokens.cjs:3-48`). |
| Importing rows from `youtube-transcripts` into yt-kb | Not handled. main-site dropped the plugin with no migration (`MAIN` commit `484b1d3`, config, package and generated types only). ⚠️ not in code — what became of its `youtube_transcripts` table. |
| Carrying `plugin::youtube-transcripts.*` grants to yt-kb | Not handled. yt-kb migrates only its own old tiers (`plugin::yt-kb.read` / `.write` / `.maintenance`) to per-tool grants (`PSRC/permission-seeding/legacy-grants.ts`). |
| Rate limits / retries on YouTube | Plugin: 3 caption attempts with backoff, `Retry-After` and a fresh session on 429/403 (see Outside services). App: `withRetry` around the Strapi call, only for status 0 or `reason: network` (`learning.ts:114-146`). |
| Proxy health | At boot: logs the masked proxy, tests it against httpbin and logs the outbound IP or an error; with no proxy, warns, and warns again if the old `TRANSCRIPT_PROXY_URL` is set (presence only) (`PSRC/bootstrap.ts:13-37`). Never blocks boot. |
| Metadata backfill | Plugin config `backfillMetadata: true` refetches metadata (no captions) for transcripts whose `thumbnails` is null, in the background at boot; `language` left alone (`bootstrap.ts:39-44`, `PSRC/services/metadata-backfill.ts:1-16, 61, 82-85`). Off in both hosts (`server/config/plugins.ts:9-12` by default, `MAIN/config/plugins.ts:22`). |
| Generation that dies mid-run | A failed fetch, model call or save marks the row `failed` (`learning.ts:1167, 1278, 1300`); a throw runs `markVideoFailedHook` (`server-functions/videos.ts:179-194`). A process crash leaves it `pending`; the next `/learn` load restarts it (`client/src/routes/learn.$videoId.tsx:99-112`). |
| Concurrency | Generation dedupe is one process's `inflight` Set (`client/src/lib/services/generation-state.ts:77`). App and MCP writers share rows through unique keys: a duplicate create re-reads the winner (transcript `fetcher.ts:150-162`; video card `PSRC/services/video-card.ts:50-58`; tag `PSRC/services/tags.ts:33-41`; app video and tag `client/src/lib/services/videos.ts:662-667, 1076-1091`). |
| Monitoring / alerts | None. |
| Rollback | Not handled in code. |

## Flows and what they write

### App: share a video (`/new-post` → `shareVideo` → `generateVideoSummary`)

1. `shareVideo` returns `exists` if the row is stored (`server-functions/videos.ts:206-209`), then reads oEmbed for title, author and thumbnail (`:218`, thumbnail falls back to `i.ytimg.com`, `:228`).
2. `createVideoService` checks again, then finds each tag by `normalizeTagName` or `POST /api/yt-kb/tags {name}`; a tag that cannot be stored stops the share with an error (`client/src/lib/services/videos.ts:624-647, 1052-1091`).
3. `POST /api/yt-kb/videos` with `youtubeVideoId, url, caption, videoTitle,
   videoAuthor, videoThumbnailUrl, tags, summaryStatus: 'pending'`
   (`videos.ts:649-668`).
4. In the background (`generateVideoSummary`, `learning.ts:1265-1319`,
   which runs `resolveGenerationInputs`, `buildSummaryDraft` and
   `persistSummaryDraft`, `learning.ts:831-1254`):
   - **Transcript:** the linked Transcript; else one found by
     `youtubeVideoId`, then link it (`PUT /api/yt-kb/videos/:id
     {transcript}`); else `POST /api/yt-kb/transcripts/fetch` (force when
     a stored row has no segments, or with `forceRefetch`), then link it
     (`learning.ts:858-909`). oEmbed is read again in parallel.
   - **Summary** with Ollama (single pass up to 15,000 tokens, `learning.ts:438, 785`, else
     map-reduce at `MAP_CONCURRENCY`, clamped to 1–4, `client/src/lib/env.ts:80-84`); a contextual BM25 index over the cleaned transcript; each section's `timeSec` from `findEvidenceForQuote("<heading>. <body>", bm25, 1.0)`, none below that score; signal and final scores computed (`learning.ts:979-1122`).
   - **Save** `PUT /api/yt-kb/videos/:id` with the summary fields, the three
     scores and `signalScores`, `valueScoreSource: 'model'`, `aiModel`,
     `transcriptSegments` (index + `rawSegments` + `durationSec`), components, `summaryStatus: 'generated'`,
     `summaryGeneratedAt` (`learning.ts:1137-1156`, `videos.ts:711-730`).
   - **Best-effort:** summary embedding (`summaryEmbedding`,
     `embeddingModel`, `embeddingVersion`, `embeddingGeneratedAt`) and
     passage embeddings (`passageEmbeddings`, ~60 s chunks,
     `client/src/lib/services/transcript.ts:164`) (`learning.ts:1176-1252`).
   - A failure in fetch, model or save → `PUT {summaryStatus: 'failed'}`.

### App: Regenerate

- Full: `regenerateSummary` clears the recent-failure window, `PUT {summaryStatus: 'pending'}` as `beforeStart`, then step 4 above using the stored
  transcript (`server-functions/videos.ts:326-368`). `forceRefetch: true`
  skips the stored rows and sends `force: true` to the fetch route; no UI sends it (grep of `client/src/**/*.tsx`).
- Verdict only (`regenerateVideoVerdict`, `server-functions/videos.ts:1484`): Ollama on the stored `rawText`, ≥50 chars after cleaning (`learning.ts:1626-1645`); writes `watchVerdict,
  verdictSummary, verdictReason, valueScore, valueScoreSource, finalScore`
  (`videos.ts:794-823`).
- Signals only (`regenerateVideoSignals`, `:1612`): no model; writes `signalScores, signalScore, finalScore`
  (`videos.ts:828-852`).
- Embedding only (`regenerateVideoEmbedding`, `:517`): the four embedding fields.

### App: opening `/learn/<videoId>` for a `pending` video created elsewhere

The loader calls `triggerSummaryGeneration`, which runs step 4 above; a
linked or stored transcript is reused (`learn.$videoId.tsx:99-112`,
`server-functions/videos.ts:255-277`). The route sets `preload: false`, so hovering a link does not start it (`learn.$videoId.tsx:92-93`). `/feed` polls while a card is pending but starts nothing (`client/src/routes/feed.tsx:195-199`; no other caller of `triggerSummaryGeneration`, grep).

### MCP: `addVideo`

If the video exists, returns `exists` and writes nothing (`PSRC/mcp/tools/add-video.ts:49-59`). Else
`fetcher.fetchAndStore` without force (creates the Transcript or reuses one); a fetch failure returns `{videoId, error, reason}` before any Video is written (`:61-70`). Then `createVideoCard`: in one transaction, find-or-create each tag (`normalizeTagName`, `PSRC/services/tags.ts:20-42`) and create the Video with `youtubeVideoId, url, videoTitle,
videoAuthor, videoThumbnailUrl` (from the transcript row), `caption`,
`summaryStatus: 'pending'`, `transcript`, `tags`; retried once on a unique violation, and a video created meanwhile by another caller comes back as `exists` (`PSRC/services/video-card.ts:23-59`, `PSRC/services/db-errors.ts:43-50`).

### MCP: `fetchTranscript`

`videoId` must match `/^[A-Za-z0-9_-]{11}$/`; no proxy argument (`PSRC/mcp/tools/fetch-transcript.ts:18-27`). `fetcher.fetchAndStore(videoId, {force})`: creates or overwrites the Transcript row (with its model-free `searchIndex`, `fetcher.ts:133`); returns `skipped` when stored and not forced. Then, if no Video has that id, creates a pending card linked to the transcript with `url` `https://www.youtube.com/watch?v=<id>`, no caption, no tags (`fetch-transcript.ts:45-48`, `video-card.ts:23-48`). An existing Video is not touched or relinked. The result carries `videoAction` (`created` / `exists`) and `videoDocumentId` (`:50-70`). A fetch failure returns `{videoId, error, reason}` and writes nothing (`:36-42`).

### MCP: `saveSummary`

Finds the Video by `youtubeVideoId` or documentId (`PSRC/mcp/tools/video-access.ts:30`), then its linked Transcript, else the one stored for the id; builds and saves `Transcript.searchIndex` if missing (`PSRC/services/search-index.ts:32-67`). The input has no timecodes: each section's `timeSec` is `findEvidenceForQuote("<heading>. <body>", index.bm25, 1.0)`, else null — the app's query and threshold, over the transcript's model-free index rather than the app's contextual one (`PSRC/mcp/tools/save-summary.ts:1-15, 99-116`). `PUT` on the Video: `summaryStatus: 'generated'`, `summaryTitle`,
`summaryDescription`, `summaryOverview`, `watchVerdict`, `verdictSummary`,
`verdictReason`, `summaryGeneratedAt`, `aiModel` (or null), `keyTakeaways`,
`sections`, `actionSteps` (`save-summary.ts:118-134`). Writes no scores and no `transcriptSegments`.

### MCP: `tagVideo`, `untagVideo`, `saveNote`

- `tagVideo`: in one transaction, find-or-create each tag with `normalizeTagName` (the create rule's normalizer; the slug comes from the Document Service rule), then set the Video's `tags` to the union; retried once on a unique violation (`PSRC/mcp/tools/tags.ts:56-87`, `PSRC/services/tags.ts:20-42`, `PSRC/document-rules.ts:16`).
- `untagVideo`: sets `tags` to the current set minus the given names,
  normalized the same way; Tag rows are never deleted (`tags.ts:95-119`).
- `saveNote`: creates a Note with `source: 'mcp'`, `author` defaulting to
  `'mcp'`, linked to one Video (`PSRC/mcp/tools/save-note.ts:31-58`).

### Site build (`yarn site:build`)

Reads `generated` videos only (`site/src/lib/strapi.ts:30`); writes nothing to Strapi; fails the build on
any fetch problem, a short read or zero rows (`strapi.ts:49-140`); the output guard fails on `transcriptSegments`, `summaryEmbedding`, `passageEmbeddings`, `rawText`, `rawSegments` (`site/scripts/verify-output.mjs:14-20`, `site/src/lib/video.ts:7-16`).

### What a video added only through MCP lacks

`addVideo` and `fetchTranscript` both leave a `pending` card linked to its transcript.

| Missing on the Video | Filled by (app only) | Effect |
|---|---|---|
| `valueScore`, `valueScoreSource`, `signalScores`, `signalScore`, `finalScore` | `updateVideoSummaryService` (`client/src/lib/services/videos.ts:711-730`) | no Content score; sorts as 0 on the site (`site/src/pages/index.astro:15`, `site/src/lib/search-docs.ts:36`) |
| `transcriptSegments` | the summary save | `searchTranscript` and `crossSearchTranscripts` use `Transcript.searchIndex` instead, built on first use; `crossSearchTranscripts` searches every video with a transcript, summarized or not (`PSRC/mcp/tools/search-transcript.ts:1-7`, `cross-search-transcripts.ts:1-8`) |
| `summaryEmbedding` and fields | `updateVideoEmbeddingService` (`videos.ts:736-758`) | absent from Related videos and semantic search; `relatedVideos` returns an error for it (`PSRC/mcp/tools/related-videos.ts:59-64`) |
| `passageEmbeddings` | `updateVideoPassagesService` (`videos.ts:761-771`) | absent from moment search and `/api/ask` |
| `readableArticle` | app reader | not on the site's `/articles` |

Until `saveSummary` runs, the video is `pending` and absent from the site.
Opening it in the app (`/learn/<videoId>`) runs the full pipeline with the linked transcript. After
`saveSummary` it is `generated`, so the app does not regenerate it unless
Regenerate is clicked (`server-functions/videos.ts:261-264`); its section timecodes are grounded, but against the transcript's index, not the contextual one.

## Environment variables

### Strapi backend

- This repo's `server/.env.example`: `HOST`, `PORT`, `MCP_ENABLED`,
  `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`,
  `ENCRYPTION_KEY`, `DATABASE_CLIENT`, `_HOST`, `_PORT`, `_NAME`, `_USERNAME`, `_PASSWORD`, `_SSL`, `_FILENAME`, `JWT_SECRET` (no `env()` read in `server/config`; ⚠️ framework behavior — Users & Permissions reads it), `OLLAMA_EMBEDDING_MODEL`,
  `EMBEDDING_VERSION` (read by the plugin only to judge staleness,
  `PSRC/mcp/utils/embeddings.ts:14-20`), `PROXY_URL` (`server/.env.example:43-51`; the plugin's `proxyUrl` default, `PSRC/index.ts:23`). Read in
  code but not listed: `FLAG_NPS`, `FLAG_PROMOTE_EE` (default true,
  `server/config/admin.ts:19-20`), `DATABASE_URL`, `DATABASE_SCHEMA`,
  `DATABASE_SSL_*`, `DATABASE_POOL_*`, `DATABASE_CONNECTION_TIMEOUT`
  (`server/config/database.ts`). The plugin checks only the presence of the old `TRANSCRIPT_PROXY_URL`, to warn that it is no longer read (`PSRC/bootstrap.ts:30-36`).
- main-site adds `YT_KB_IMPORT` (`MAIN/config/plugins.ts:21`) and its own `ANTHROPIC_*`, `AI_SYSTEM_PROMPT`, `OAUTH_MCP_LOCAL_PATH`, `PUBLIC_URL` (`MAIN/config/plugins.ts:7-12, 48`, `MAIN/config/env/production/server.ts:5`).
- Scripts: `copy-content.mjs` (`SOURCE_URL`, `DEST_URL` required;
  `SOURCE_PREFIX`; `SOURCE_TOKEN`, `DEST_TOKEN` required); `create-tokens.cjs` reads none (flags only, `create-tokens.cjs:56-106`); `start.sh` (`OLLAMA_KEEP_ALIVE`, `OLLAMA_NUM_PARALLEL`, `start.sh:18-19`);
  `publish-site.sh` (`SITE_SKIP_STRAPI_FETCH`, refused, `:36`). `server/scripts/seed.mjs` and `verify-mcp-tools.cjs` were deleted (`git diff 721f210..HEAD`).

### Frontend

- `client/.env.example`: `STRAPI_URL`, `STRAPI_API_TOKEN` (required, the `yt-kb-app` token; "never use a Full-access token", `:4-14`), `EMBEDDING_VERSION`,
  `PASSAGE_EMBEDDING_VERSION`, `OLLAMA_EMBEDDING_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_CHAT_MODEL`, `OLLAMA_SYNTHESIS_MODEL`, `MAP_CONCURRENCY` (commented out). An empty token warns once, on the server only (`env.ts:112-121, 137-145`). `@strapi/client` and `ky` are no longer in `client/package.json`.
- Tests and e2e: `CI`, `E2E_BASE_URL` (`client/playwright.config.ts:13, 20`), `E2E_FIXTURES`, `E2E_STRAPI_DOWN`, `E2E_STRAPI_WRITES_FAIL` (`client/e2e/core-loop-states.spec.ts`), `E8_STRAPI_URL`, `E8_TOKEN_FILE` (`client/src/lib/services/unique-recovery.live.test.ts:7-11`).
- `site/.env.example`: `STRAPI_BASE_URL` (includes `/api/yt-kb`), `STRAPI_API_TOKEN` (the `yt-kb-site` token), `SITE_URL`;
  code also reads `SITE_SKIP_STRAPI_FETCH` (`site/src/content.config.ts:32`, `site/scripts/verify-output.mjs:36`).

## Tests

Counts from runs on 2026-11-09 (`yarn --cwd client test`, `yarn plugin:test`, `yarn site:test`).

- Client (vitest, `client/vitest.config.ts`): 53 files, 436 tests — 434 passed, 2 skipped (`unique-recovery.live.test.ts`, which needs `E8_STRAPI_URL` and `E8_TOKEN_FILE`). Services, generation pipeline, BM25, retrieval, scores, backfills (`backfill.test.ts`), digests, errors, timeouts, serialization, components, and source-reading guards: `bm25-core.sync.test.ts` (the only one that reads plugin code), `strapi-paths.guard.test.ts`, `strapi-segments.guard.test.ts`, `route-options.guard.test.ts`, `youtube-fetch.guard.test.ts`. Two suites need live services and return
  early when they are down, still counting as passed:
  `videos.smoke.test.ts` (the only live check that the Public role is
  refused, lines 50-108) and `embeddings.ranking.test.ts`
  (`.github/workflows/ci.yml:3-5`). Not covered: the `api.*` route handlers' behavior (`route-options.guard.test.ts` only reads their source),
  `prepareDigestChatPrompt`, `services/reader.ts`, the notes
  services. E2E: `client/e2e/seroval-surfaces.spec.ts`, `core-loop-states.spec.ts`; the
  Playwright config does not start the stack (`client/playwright.config.ts:3-8`).
- Plugin (vitest, `server/src/plugins/yt-kb/vitest.config.mts`, `server/src/**/*.test.ts` and `tests/*.test.mjs`): 23 files, 141 tests, all passed. Never boots Strapi; fake `strapi` objects, one in-memory SQLite (`server/src/services/db-errors.test.ts`). Covers the fetcher and its controller, boot proxy check, document rules, importer controller, MCP tools (`fetch-transcript`, `save-summary`, search, writes), `ai-tools`, the Innertube request timeout, tags, search index, metadata backfill, permission seeding, `copy-content.mjs` and `import-batches.mjs`, and guards pinning tool names, permission registration and schema limits (`mcp-official/names.test.ts`, `permissions.guard.test.ts`, `adapter.test.ts`, `schema-limits.test.ts`).
- Site: 11 files, 107 tests, under `site/src/**` (`yarn site:test`).
- `server/` (the host app): no tests. `verify:mcp` and its script are gone (`server/package.json`).
- CI runs, in order: install, typecheck client / server / plugin, build, verify and test the plugin, typecheck site, `yarn test`, `yarn site:test`, build client (`.github/workflows/ci.yml:38-97`).
