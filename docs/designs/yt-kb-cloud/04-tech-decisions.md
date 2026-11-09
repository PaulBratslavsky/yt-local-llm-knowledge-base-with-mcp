# Tech Decisions

> As built at `yt-knowledge-base` `93672f3` (`main`) and
> `strapi-cloud-backend-main-site` `a32c8a0` (`main`; local checkout
> `~/work/plugin-dev/strapi-prod`, with its installed `node_modules`),
> 2026-11-09, after the change in `06-change-spec.md`. Describes the code,
> not intentions. "This repo" means `yt-knowledge-base`; "main-site" means
> `strapi-cloud-backend-main-site`, the production host of
> `strapi-plugin-yt-kb` 0.1.1, with `strapi-plugin-tanstack-ai` 1.7.0
> beside it. `PSRC/` is `server/src/plugins/yt-kb/server/src/` in this repo;
> `MAIN/` is the main-site checkout. History: first reconstructed at
> `721f210` / `c3d0b74` (2026-11-08) and revised after checkpoint R
> (`reviews/R-reconstruction-review.md`).

## Reference architecture (binding conventions)

Four parts, in two repos:

| Part | Root | Runs where (as built) |
|---|---|---|
| TanStack app | `client/` | The owner's Mac, `vite dev --port 3005` (`client/package.json:9`), bound to `127.0.0.1` with `strictPort` (`client/vite.config.ts:12-15`) |
| `strapi-plugin-yt-kb` | `server/src/plugins/yt-kb/` | Loaded by this repo's `server/` from source via `resolve` (`server/config/plugins.ts:6-13`). Installed on main-site from npm, `0.1.1` exact (`MAIN/package.json:31`, `MAIN/yarn.lock:15590-15592`). ⚠️ not in code — npm lists `0.0.0-stage`, `0.1.0`, `0.1.1`, `latest` = `0.1.1` (`npm view`, 2026-11-09). |
| Test host Strapi | `server/` | The owner's Mac, port 1340 (`server/config/server.ts:13`), `HOST` default `0.0.0.0` with `127.0.0.1` in `.env.example` (`server/config/server.ts:4-12`, `server/.env.example`), SQLite `server/.tmp/data.db` (`server/config/database.ts:46-51`) |
| Astro site | `site/` | Built on the owner's Mac, deployed to Netlify (`site/netlify.toml`, `publish-site.sh`) |
| main-site (production host) | `~/work/plugin-dev/strapi-prod` (other repo) | Strapi Cloud, `https://deserving-harmony-9f5ca04daf.strapiapp.com` (`MAIN/config/env/production/server.ts:5`) |

- The client never imports from `server/`; it calls Strapi over REST through
  `strapiFetch` (`client/src/lib/services/strapi-client.ts:217-285`), with a
  30 s default timeout (`strapi-client.ts:84`). No call bypasses it:
  `reader.ts` now writes through `strapiFetch`
  (`client/src/lib/services/reader.ts:358`), and the only other
  `STRAPI_URL` use builds asset URLs (`client/src/lib/services/videos.ts:1100`).
  Paths are `/api/yt-kb/...` with each segment passed through `seg()`
  (`strapi-client.ts:187-192`), guarded by `strapi-paths.guard.test.ts` and
  `strapi-segments.guard.test.ts` (`client/src/lib/services/`).
- All yt-kb Strapi code lives in the plugin; `server/src/index.ts` has empty
  `register`/`bootstrap` (lines 5-8). main-site's `src/index.ts` is empty too.
- The app talks to YouTube only for oEmbed metadata
  (`client/src/lib/services/learning.ts:210-228`). Captions are fetched by
  the plugin (`PSRC/services/fetcher.ts`), guarded by
  `client/src/lib/services/youtube-fetch.guard.test.ts` (fails on a
  `youtubei.js` or `undici` import in `client/src`).

## Defaults applied (this skill is opinionated — confirm or override)

Not applicable: pre-existing product. Departures from the builder's
defaults, as built: the database client comes from `DATABASE_CLIENT`
with SQLite as the default (`server/config/database.ts:4-61`); Users &
Permissions is installed but no part of the product signs users in (see
Auth); a Strapi plugin rather than `src/api/<name>` modules
(`server/config/plugins.ts`).

## Backend / CMS

- **Chosen:** Strapi 5. This repo's `server/`: `@strapi/strapi`,
  `@strapi/plugin-users-permissions` and `@strapi/plugin-cloud` 5.61.0,
  exact (`server/package.json:20-22`, `server/yarn.lock:3060`). Strapi
  telemetry is off (`"strapi": {"uuid": false}`, `server/package.json:40-42`).
  main-site: the same three at 5.61.0 (`MAIN/package.json:18-20`,
  `MAIN/yarn.lock:5161`). ⚠️ not in code — `@strapi/strapi` 5.61.1 was
  published 2026-11-09 (`npm view`); neither repo uses it, and the plugin's
  peer range admits it.
- **The plugin:** `strapi-plugin-yt-kb` 0.1.2 in source (`package.json`;
  not yet published, main-site runs 0.1.1), GPL-3.0-or-later, with a
  `LICENSE` file (GPL v3 text, `server/src/plugins/yt-kb/LICENSE`); peer
  `@strapi/strapi ^5.61.0` and `@strapi/utils ^5.61.0`; deps exact,
  `undici 6.29.1`, `youtubei.js 17.2.0`; built with `@strapi/sdk-plugin
  6.1.1`; tests with `vitest 3.2.6` (`server/src/plugins/yt-kb/package.json`).
  No admin bundle (no `./strapi-admin` export). No `engines` field. `files`
  ships `dist` and `scripts` (`copy-content.mjs`, `import-batches.mjs`,
  `create-tokens.cjs`) to npm.
- **Plugin config keys** (defaults `PSRC/index.ts:19-28`): `mcp` (`true`),
  `proxyUrl` (`env('PROXY_URL', '')`), `import` (`false`),
  `backfillMetadata` (`false`). The validator throws at load on a
  non-boolean `mcp` / `import` / `backfillMetadata` or a non-string
  `proxyUrl` (`PSRC/index.ts:29-38`). This repo sets only `mcp: true`
  (`server/config/plugins.ts:9-12`); main-site sets all four, `import` from
  `YT_KB_IMPORT` (`MAIN/config/plugins.ts:16-24`,
  `MAIN/config/env/production/plugins.ts:16-24`).
- **Services the plugin exposes:** core services for the five types, plus
  `importer`, `fetcher` and `ai-tools` (`PSRC/services/index.ts:8-17`).
  `ai-tools.getTools()` returns the 21 domain tools by bare camelCase name,
  each with its per-tool action, for `strapi-plugin-tanstack-ai`
  (`PSRC/services/ai-tools.ts:27-41`), which looks up every plugin's
  `ai-tools` service and names the tools `yt-kb__<name>`
  (`MAIN/node_modules/strapi-plugin-tanstack-ai/dist/server/index.js:1869,
  1877-1884, 1906-1941`), offering only tools whose action is registered.
- **How it is built and loaded:** Strapi loads `dist/server/index.js`
  (`package.json` `exports`); `dist/` is gitignored
  (`server/src/plugins/yt-kb/.gitignore:2`). The plugin has its own
  dependencies and lockfile (`package.json`, `yarn.lock` in the plugin
  folder); `yarn setup` installs and builds it (`setup:plugin`, root
  `package.json:13-14`), `yarn install:all` installs it (`package.json:24`),
  and `yarn plugin:build` rebuilds it (`package.json:21`). The build leaves
  `@strapi/utils`, `youtubei.js`, `undici` and `@strapi/strapi` external
  (`dist/server/index.js:3-6`). In this repo the plugin declares no
  `@strapi/*` dependency of its own, so its build and tests resolve them
  from `server/node_modules` (`.github/workflows/ci.yml:11-12`); `server/`
  no longer lists `youtubei.js` (`server/package.json:19-29`).
- **Node engines (declared, not verified):** this repo's `server/`
  `>=22.0.0 <=24.x.x` (`server/package.json:36-39`); main-site
  `>=22.0.0 <=22.x.x` (`MAIN/package.json:40-43`); the plugin, `client/` and
  `site/` declare none. CI runs Node 22 (`.github/workflows/ci.yml:27-29`).
- **Considered / Why:** unknown (pre-existing).

## Database

- This repo: client from `DATABASE_CLIENT` (default `sqlite`), with
  mysql, postgres (`DATABASE_URL`, `DATABASE_SCHEMA`) and sqlite branches
  (`server/config/database.ts:5-52`). Installed drivers: `better-sqlite3`
  12.8.0 and `pg` 8.23.1, no `mysql2` (`server/package.json:23-24`). SQLite
  file from `DATABASE_FILENAME` (default `.tmp/data.db`).
- main-site: the same pattern (`MAIN/config/database.ts`); its only driver
  dependency is `better-sqlite3` 11.3.0 (`MAIN/package.json:21`; no `pg`
  in `MAIN/yarn.lock`). ⚠️ not in code — the database Strapi Cloud runs it
  on and where its driver comes from; `MAIN` commit `a32c8a0`'s message and
  `PSRC/schema-limits.test.ts:5-9` both say PostgreSQL.
- **Supported databases:** SQLite and PostgreSQL. MySQL/MariaDB are not
  supported: `digest.videoSetKey` is a unique `text` column
  (`PSRC/content-types/digest/schema.json:22-27`), which MySQL cannot index
  without a prefix length (plugin `README.md:20-23`).
  `PSRC/services/db-errors.ts:15-25` recognises SQLite and pg unique
  violations (and mysql2's only for completeness).
- **Unique keys:** `video.youtubeVideoId`, `transcript.youtubeVideoId`,
  `tag.name`, `tag.slug`, `digest.videoSetKey`, each `unique: true` with
  `column: { unique: true }` (`PSRC/content-types/*/schema.json`). ⚠️
  framework behavior — that `column.unique` creates the database index
  (the change spec's check queries them by name, `06-change-spec.md:8238`).
- **String length:** a `string` attribute allowing more than 255
  characters fails `PSRC/schema-limits.test.ts:17-28`, because ⚠️ framework
  behavior — PostgreSQL stores a Strapi `string` as `varchar(255)`. Longer
  fields are `text` (e.g. `videoThumbnailUrl`,
  `PSRC/content-types/video/schema.json:47-49`).
- yt-kb tables are prefixed `yt_kb_` and `components_ytkb_`
  (`PSRC/content-types/*/schema.json`, `PSRC/components/*.json`); main-site's
  generated types list them next to its own types
  (`MAIN/types/generated/contentTypes.d.ts:1979-2144`). A host type would
  collide only if it used the `yt_kb_` table prefix, or a host component the
  `ytkb` category (yt-kb adds its components with `components.add`,
  `PSRC/register.ts:22-37`). main-site has its own `api::tag.tag` (table
  `tags`, `MAIN/src/api/tag/content-types/tag/schema.json:3`), which is why
  the REST prefix stays (`PSRC/routes/index.ts:3-5`).

## Backend hosting

- This repo's `server/` runs locally. It carries `@strapi/plugin-cloud` and
  `"deploy": "strapi deploy"` (`server/package.json:9,20`), and its
  `config/server.ts:4-11` comments on Strapi Cloud's `HOST` handling; ⚠️ not
  in code — whether it has ever been deployed.
- The plugin's hosts are not fixed (`03`). main-site on Strapi Cloud is the
  production one: `config/env/production/` overrides `server.ts`
  (`url` from `PUBLIC_URL`, `proxy: true`, lines 5-6), `middlewares.ts` and
  `plugins.ts`. main-site has no CI workflow (no `.github/workflows`). ⚠️ not
  in code — how Cloud deploys it, and its env values.
- ⚠️ not in code — recorded 2026-11-08/09: the owner's library (17 tags,
  195 transcripts, 195 videos, 11 notes, 6 digests) was copied from the
  local Strapi to Strapi Cloud with `copy-content.mjs`; its check reported
  ALL OK.

## Frontend framework

- **TanStack app:** `@tanstack/react-start` 1.168.60, `@tanstack/react-router`
  1.170.41, React 19.2.5, Vite 8.3.6, Nitro 3.0.260311-beta, `@tanstack/ai`
  0.47.1 with `@tanstack/ai-ollama` 0.9.3 (both exact), zod 4.3.6
  (`client/package.json`, installed `client/node_modules`). One lockfile,
  `client/yarn.lock`. Pre-1.0 dependencies are exact-pinned (ADR 0010,
  `docs/adr/0010-exact-pins-for-pre-1.0-dependencies.md`). **Chosen by:**
  pre-existing.
- **Astro site:** Astro 6.4.8 (declared `^6.1.3`), MiniSearch 7.2.0, marked
  15.0.12, Tailwind 4.3.3, no adapter, static output (`site/package.json`,
  `site/astro.config.mjs`). **Chosen by:** pre-existing
  (`docs/superpowers/specs/2026-10-11-static-knowledge-site-design.md`).
- **The plugin's schemas** use the zod 4 API that `@strapi/utils` exports
  (`PSRC/mcp-official/adapter.ts:4-5,13`); `@strapi/utils` 5.61.0 ships
  zod 4.4.3 (`server/node_modules/@strapi/utils/package.json:61`), which
  tanstack-ai needs (Standard JSON Schema, zod ≥ 4.2,
  `PSRC/services/ai-tools.ts:5-6`).

## Frontend hosting

- TanStack app: not hosted; `vite dev` on the owner's Mac, loopback only
  (`client/vite.config.ts:12-15`).
- Astro site: Netlify, built locally and uploaded with `npx netlify deploy`
  (`site/netlify.toml` sets `command = ""`, `pretty_urls = false`;
  `publish-site.sh:67` draft, `:76` `--prod`; `site/package.json:11`
  `deploy`). Live URL `https://boisterous-lamington-cc0eed.netlify.app`
  (`publish-site.sh:34`). Strapi is read at build time only, from
  `STRAPI_BASE_URL` with `STRAPI_API_TOKEN` (`site/src/content.config.ts:9-16`).

## Auth

- No end-user sign-in anywhere in this repo
  (`client/src`: no sign-in, cookie or middleware code;
  `docs/architecture.md:68` "no auth, single user").
- Every caller of yt-kb's Content API routes uses a token. The plugin's
  routes set no `auth` config (`PSRC/routes/index.ts:11-35`), so ⚠️
  framework behavior — each needs an API token holding the route's scope
  (`plugin::yt-kb.<type>.<action>`, `routes/index.ts:7-8`), or a Users &
  Permissions JWT whose role holds it. At every boot the plugin deletes any
  `plugin::yt-kb.*` permission from the Public and Authenticated roles
  (`PSRC/permission-seeding/users-permissions.ts:7-24`, called from
  `PSRC/bootstrap.ts:11`); ⚠️ not in code — whether any custom role grants one.
- **Content API tokens** come from `create-tokens.cjs`
  (`server/src/plugins/yt-kb/scripts/create-tokens.cjs:3-34`, type
  `custom`, lifespan `null`, lines 133-140): `yt-kb-app` (CRUD on video, tag,
  note, digest; `find`/`findOne` on transcript; `fetcher.fetchTranscript`,
  `fetcher.getOrFetch` — 24 scopes) and `yt-kb-site` (`video.find`,
  `tag.find`). `--rotate` replaces one of those two names only.
- **Import:** `POST /api/yt-kb/import/:type` answers 403 unless the plugin
  config sets `import: true` (`PSRC/controllers/importer.ts:14-18`), and also
  needs the scope `plugin::yt-kb.importer.importRecords`, which neither
  script token holds.
- **Admin panel users** sign in to `/admin` (admin JWT signed with
  `ADMIN_JWT_SECRET`, `server/config/admin.ts:4-6`). All five yt-kb types
  are visible in the Content Manager (`"visible": true`,
  `PSRC/content-types/*/schema.json:13-16`), so an admin can read, create,
  change and delete every yt-kb row there, gated by Content Manager
  permissions, not by `plugin::yt-kb.*` or API tokens. The admin route
  `GET /yt-kb/yt-transcript/:videoId` requires
  `plugin::yt-kb.tool.fetch-transcript` (`PSRC/routes/index.ts:37-51`,
  `PSRC/mcp-official/permissions.ts:24`). This repo's `server/src/index.ts`
  seeds no permissions.
- **Users & Permissions** is installed in both Strapis
  (`server/package.json:21`, `MAIN/package.json:19`); this repo has a stock
  `user` extension
  (`server/src/extensions/users-permissions/content-types/user/schema.json`)
  and `JWT_SECRET` (`server/.env.example`). No part of the product signs in
  through it. ⚠️ not in code — registration settings.
- **MCP callers** use admin API tokens. Each of the 21 tools has its own
  admin action `plugin::yt-kb.tool.<kebab-case>` (subCategory `AI tools`,
  `PSRC/mcp-official/names.ts:19-23`, `permissions.ts:58-65`), declared as
  the tool's `auth.policies` (`PSRC/mcp-official/adapter.ts:86`); a token sees
  only the tools it holds. The old tiers `plugin::yt-kb.read` / `.write` /
  `.maintenance` stay registered (`permissions.ts:26-56`) so that every boot
  can migrate their token and role grants to per-tool grants (read → 15
  tools, write → 4, maintenance → 2) and delete the tier rows, skipping the
  super-admin role and orphan rows
  (`PSRC/permission-seeding/legacy-grants.ts:1-60`, `index.ts:11-20`). The
  same actions gate the tools in tanstack-ai's admin chat
  (`PSRC/services/ai-tools.ts:7-8,35`). Strapi's Content Manager also
  registers MCP tools for every displayed type, yt-kb's included, gated by
  Content Manager permissions (see MCP server).
- ⚠️ not in code — the tokens and grants that exist in each Strapi's
  database. Recorded 2026-11-08/09: Strapi Cloud has Content API custom
  tokens `yt-kb-app` (the app) and `yt-kb-site` (the site, `video.find` /
  `tag.find`), plus a temporary `yt-kb-import` token the owner is to delete,
  and env `YT_KB_IMPORT` the owner is to remove; the owner's MCP server
  `strapi-prod` points at Cloud `/mcp` with an admin token and lists the 21
  `yt_kb__*` tools; the local admin token `claude-mcp-1782487483515` holds
  the 21 per-tool grants. For the local Strapi the change spec had
  `yt-kb-app` created, `yt-kb-site` rotated, and the old full-access
  `yt-kb-client` left for the owner to revoke (`06-change-spec.md:8247`).

## Session topology

- **Admin panel:** ⚠️ framework behavior — Strapi's admin session (admin
  JWT; storage, refresh and expiry are Strapi's defaults; this repo
  configures only `ADMIN_JWT_SECRET`, `server/config/admin.ts:4-6`).
- **The app:** no user session exists (`client/src`, see Auth). The only
  credential is the server-side `STRAPI_API_TOKEN`
  (`client/src/lib/env.ts:27`), added to each Strapi call when it is set;
  when it is empty no `Authorization` header is sent and the call runs as
  Public (`client/src/lib/services/strapi-client.ts:198-203`), which the
  plugin grants nothing, so it fails with 403. The app warns about an empty
  token at startup, on the server only (`client/src/lib/env.ts:112-145`).

## Environments

- This repo: local only. `client/.env`, `server/.env`, `site/.env`
  (names in each `.env.example`). `STRAPI_URL` defaults to
  `http://localhost:1340` (`client/src/lib/env.ts:26`). The embedding keys
  `OLLAMA_EMBEDDING_MODEL` and `EMBEDDING_VERSION` are read on both sides and
  must match (`server/.env.example`, `client/.env.example`;
  `PSRC/mcp/utils/embeddings.ts:15,19`).
- This repo's Strapi middlewares: `strapi::cors` with `origin: []`,
  `credentials: false`; `strapi::body` with 20 MB JSON/form/text limits
  (`server/config/middlewares.ts:18, 21-28`). REST paging:
  `defaultLimit 25`, `maxLimit 100`, `withCount: true`
  (`server/config/api.ts:4-8`); main-site has the same (`MAIN/config/api.ts`).
  The site pages 100 at a time and relies on the count
  (`site/src/lib/strapi.ts:13-14, 101-113`). The app pages whole-library
  reads 100 at a time (20 when passage embeddings are included) with a
  120 s timeout (`client/src/lib/services/videos.ts:401`).
- main-site: `strapi::body` `jsonLimit: "10mb"` in both the base and the
  production middlewares (`MAIN/config/middlewares.ts:28-33`,
  `MAIN/config/env/production/middlewares.ts:25-30`). CORS: base
  `origin` is the Cloud URL (`MAIN/config/middlewares.ts:18-25`);
  production `origin: "*"` with no `credentials` setting
  (`MAIN/config/env/production/middlewares.ts:15-22`) — ⚠️ framework
  behavior — the default is `credentials: true`, per the comment at
  `server/config/middlewares.ts:7-11`.
- `copy-content.mjs` sends batches of at most 900 KB of JSON
  (`server/src/plugins/yt-kb/scripts/import-batches.mjs:9`,
  `copy-content.mjs:23-27`), a record bigger than that alone; a 413 fails
  that batch. It requires `SOURCE_URL` and `DEST_URL` and refuses two equal
  ones (`copy-content.mjs:34-59`).

## Media / file storage

No media fields in yt-kb's types (`PSRC/content-types/*/schema.json`).
Thumbnails are YouTube URLs stored as text (`videoThumbnailUrl`,
`PSRC/content-types/video/schema.json:47-49`) or built from the id
(`site/src/lib/player.ts:66`).

## CI/CD

- This repo: one GitHub Actions job, Node 22 — install all five packages,
  typecheck client and server, typecheck, build, verify and test the plugin,
  typecheck the site, run client tests, run site tests, build the client
  (`.github/workflows/ci.yml:22-97`). Opt-in pre-push hook runs the client
  build (`.githooks/pre-push`, `CLAUDE.md`).
- **Test suites:** client (`yarn test`), site (`yarn site:test`), and the
  plugin's own (`yarn plugin:test`, root `package.json:22`;
  `server/src/plugins/yt-kb/vitest.config.mts`: `server/src/**/*.test.ts`,
  `tests/**/*.test.mjs`, Node environment, never boots Strapi). The plugin
  has 23 test files; `yarn plugin:test`: 141/141
  passed (2026-11-09).
- Root scripts (`package.json:8-31`): `dev` runs Strapi and, after
  `wait-on http://localhost:1340`, the client; `start` runs `start.sh`,
  which sets `OLLAMA_KEEP_ALIVE` and `OLLAMA_NUM_PARALLEL` with
  `launchctl` (`start.sh:46-47`), starts Ollama if needed and `kill -9`s
  whatever holds ports 1340 and 3005 (`start.sh:89-95`); `seed` / `export`
  run `strapi import` / `strapi export` on `server/seed-data/seed.tar.gz`,
  which is gitignored (`server/.gitignore:43`, `*.gz`); `sync:bm25` copies
  `PSRC/services/bm25-core.ts` into `client/src/lib/services/bm25-core.ts`
  (`scripts/sync-bm25-core.mjs:26-27`), and
  `client/src/lib/services/bm25-core.sync.test.ts` fails on drift.
  `copy-env.mjs` copies a `.env.example` only when `.env` is absent
  (`copy-env.mjs:21-31`). The Strapi codemod is `strapi:upgrade`
  (`server/package.json:16`).
- main-site: no CI (no `.github/workflows`).

## Email / notifications

None in yt-kb. main-site's `tanstack-ai` has a `send_email` MCP tool
(`MAIN/node_modules/strapi-plugin-tanstack-ai/dist/server/index.js:884-890`);
out of scope.

## Payments

None.

## Outside services (required or optional)

| Service | Called by | Required? |
|---|---|---|
| Ollama (chat + embeddings) | The TanStack app only (`client/src/lib/services/learning.ts`, `embeddings.ts`) | Required for summaries, chat, embeddings |
| YouTube Innertube + caption XML | The plugin (`PSRC/services/youtube-transcript.ts`, `youtubei.js`) | Required to fetch a transcript |
| YouTube oEmbed | The app (`learning.ts:210-228`) and the plugin, through the proxy (`youtube-transcript.ts:554`, `PSRC/services/fetcher.ts:119-121`) | Optional (falls back to no title) |
| DuckDuckGo HTML | The app's `web_search` chat tool (`client/src/lib/services/web-search.ts:53`) | Optional |
| Residential proxy | The plugin, from config `proxyUrl` (default env `PROXY_URL`, `PSRC/index.ts:23`; read at `PSRC/services/fetcher.ts:118`). The old `TRANSCRIPT_PROXY_URL` is not read; boot warns when it is set and no proxy is (`PSRC/bootstrap.ts:30-36`). main-site: `proxyUrl: env("PROXY_URL", "")` (`MAIN/config/plugins.ts:19`) | Optional locally; ⚠️ not in code — whether `PROXY_URL` is set on Cloud and whether YouTube blocks Cloud's IPs |
| httpbin.org | The plugin's boot-time proxy check, only when a proxy is set (`PSRC/bootstrap.ts:15-25`, `youtube-transcript.ts:570`) | Optional; failure only logs |
| Netlify | `publish-site.sh` | Required to publish the site |
| Anthropic | main-site's `tanstack-ai` chat (`ANTHROPIC_API_KEY`, `MAIN/config/plugins.ts:2-15`) | Host only; not called by yt-kb |

## Analytics & monitoring

None in this repo; Strapi telemetry is off (`server/package.json:40-42`).
main-site's `package.json:44-47` carries a telemetry `uuid` (⚠️ framework
behavior — telemetry on unless disabled by env). Logs only: the app logs
`[summary <id>]` phases to its terminal (`learning.ts:62` `logPhase`); the
plugin logs fetch failures at `warn` (`PSRC/services/fetcher.ts:94`), failed
MCP tool bodies and skipped tool registrations at `warn`
(`PSRC/mcp-official/adapter.ts:93,124`), and boot counts for permissions,
tools and the grant migration (`permissions.ts:72-74`,
`mcp-official/index.ts:51-53`, `permission-seeding/index.ts:13-16`).

## MCP server (AI agent access)

- Strapi's official MCP server at `/mcp`, enabled by `MCP_ENABLED`
  (default true) in both Strapis (`server/config/server.ts:21`;
  `MAIN/config/server.ts:10-12`).
- yt-kb's 21 tools (15 query, 4 write, 2 that reach YouTube, by
  `sideEffects`, `PSRC/mcp-official/tools.ts:30-58`), named
  `yt_kb__<snake_case>` with title `YT Knowledge Base: <Words>`
  (`PSRC/mcp-official/names.ts:1-33`). Registered in `register()`
  (`PSRC/register.ts:41-43`): the 21 + 3 admin actions first, unconditionally
  and deliberately unwrapped (`mcp-official/index.ts:14-28`,
  `permissions.ts:12-13, 67-75`); then the tools, unless the config sets
  `mcp: false` or the MCP server is off (`mcp-official/index.ts:33-45`). Each
  `registerTool` call is wrapped: a clash is logged and that tool skipped,
  never thrown (`adapter.ts:9-12, 79-126`). Results over ~950 KB on the wire
  are replaced by a `RESULT_TOO_LARGE` object (`adapter.ts:45-48, 97-108`).
  ⚠️ framework behavior — `registerTool` throws after the server has
  started, on a duplicate name, and on a definition with no `auth`
  policies (`server/node_modules/@strapi/core/dist/services/mcp/index.js:46-50`,
  `internal/McpCapabilityDefinitionRegistry.js:18-27`).
- Also on both Strapis: core's `log` tool
  (`@strapi/core/dist/services/mcp/index.js:96`), and Content Manager's
  `list_` / `get_` / `create_` / `update_` / `delete_` tools for every
  displayed type (no publish tools: yt-kb types have `draftAndPublish:
  false`), yt-kb's five included, named with the slug `plugin-yt-kb_<type>`
  and gated by Content Manager permissions, not by `plugin::yt-kb.*`
  (`@strapi/content-manager/dist/server/bootstrap.js:19-21`,
  `mcp/register-content-manager-mcp-tools.js:24-31`, `mcp/utils.js:11-18`,
  5.61.0). Content Manager registers in `bootstrap()`, after yt-kb, with no
  try/catch.
- On main-site: `tanstack-ai`'s 8 unprefixed tools, registered in
  `bootstrap()`, each in a try/catch
  (`MAIN/node_modules/strapi-plugin-tanstack-ai/dist/server/index.js:1273-1282,
  1377-1400`); its `create_content` / `update_content` write any Content
  Manager–displayed type the caller's Content Manager permissions allow,
  yt-kb's included (`index.js:130-133, 455-467, 508-534`). The yt-kb tools
  also reach tanstack-ai's admin chat as `yt-kb__<camelCase>` (see
  Backend / CMS). `strapi-plugin-youtube-transcripts` is no longer installed
  (`MAIN/package.json:17-33`; removed in `MAIN` `484b1d3`). main-site also
  runs a second MCP endpoint from `ocyris-strapi-builder-mcp` 1.0.4
  (`MAIN/config/plugins.ts:36-38`); out of scope.
  `MAIN/config/server.ts:7-9` says yt-kb registers in `register()` and
  tanstack-ai and content-manager in `bootstrap()`.
- **Adding a tool** pins counts on purpose: `mcp-official/names.test.ts`,
  `permissions.guard.test.ts` and `adapter.test.ts` (`CLAUDE.md`, MCP
  section), because a renamed action loses its grants at the next boot
  (`permissions.ts:8-10`).
- **Chosen by:** pre-existing (`docs/adr/0008-official-strapi-mcp-over-hand-rolled.md`);
  per-tool actions and the `yt_kb__` prefix by the change in
  `06-change-spec.md` (M5, commit `0a4a1b5`).

## Styling

Tailwind 4 in both frontends (`client/package.json`, `site/package.json`).
