# Tech Decisions

> As built — reconstructed from `yt-knowledge-base` @ `721f210` (branch
> `feat/yt-kb-plugin`) and `strapi-cloud-backend-main-site` @ `c3d0b74`
> (local checkout `~/work/plugin-dev/strapi-prod`, branch
> `chore/strapi-5.60.0`, with its installed `node_modules`), 2026-11-08.
> Describes the code, not intentions. "This repo" means `yt-knowledge-base`;
> "main-site" means `strapi-cloud-backend-main-site`, read only as a
> reference install of `strapi-plugin-youtube-transcripts` 2.6.2 and
> `strapi-plugin-tanstack-ai` 1.7.0 (out of scope as a target, `03`).
> `PSRC/` is `server/src/plugins/yt-kb/server/src/` in this repo.
> Revised after checkpoint R (`reviews/R-reconstruction-review.md`).

## Reference architecture (binding conventions)

Four parts, in two repos:

| Part | Root | Runs where (as built) |
|---|---|---|
| TanStack app | `client/` | The owner's Mac, `vite dev --port 3005` (`client/package.json`) |
| `strapi-plugin-yt-kb` | `server/src/plugins/yt-kb/` | Loaded by this repo's `server/` via `resolve` (`server/config/plugins.ts:6-13`). Not yet published or installed on the host. |
| Test host Strapi | `server/` | The owner's Mac, port 1340 (`server/config/server.ts:14`), SQLite `server/.tmp/data.db` (`server/config/database.ts:46-51`) |
| Astro site | `site/` | Built on the owner's Mac, deployed to Netlify (`site/netlify.toml`, `publish-site.sh`) |
| main-site (reference only) | `~/work/plugin-dev/strapi-prod` (other repo) | Strapi Cloud, `https://deserving-harmony-9f5ca04daf.strapiapp.com` (`config/env/production/server.ts:5` there) |

- The client never imports from `server/`; it calls Strapi over REST through
  `strapiFetch` (`client/src/lib/services/strapi-client.ts:166-217`). One
  exception: `client/src/lib/services/reader.ts:351-381` builds its own
  `fetch` PUT.
- All yt-kb Strapi code lives in the plugin; `server/src/index.ts` has empty
  `register`/`bootstrap` (lines 5-8).
- The app talks to YouTube only for oEmbed metadata
  (`client/src/lib/services/learning.ts:188-204`). Captions are fetched by
  the plugin (`PSRC/services/fetcher.ts`), guarded by
  `client/src/lib/services/youtube-fetch.guard.test.ts`.

## Defaults applied (this skill is opinionated — confirm or override)

Not applicable: pre-existing product. Departures from the builder's
defaults, as built: the database client comes from `DATABASE_CLIENT`
with SQLite as the default (`server/config/database.ts:5-52`); Users &
Permissions is installed but no part of the product signs users in (see
Auth); a Strapi plugin rather than `src/api/<name>` modules
(`server/config/plugins.ts`).

## Backend / CMS

- **Chosen:** Strapi 5. This repo's `server/`: `@strapi/strapi` 5.52.1,
  exact, with `@strapi/plugin-users-permissions` and `@strapi/plugin-cloud`
  5.52.1 (`server/package.json:21-23`, `server/yarn.lock`). Strapi telemetry
  is off (`"strapi": {"uuid": false}`, `server/package.json:42-44`). main-site: 5.60.0
  on its checked-out branch (`package.json` L20, `yarn.lock` L5013 there).
  ⚠️ not in code — the latest published Strapi is 5.61.0 (2026-11-04),
  per `npm view @strapi/strapi` on 2026-11-08; nothing in either repo uses
  it yet.
- **The plugin:** `strapi-plugin-yt-kb` 0.1.0, GPL-3.0-or-later,
  peer `@strapi/strapi ^5.47.0` and `@strapi/utils ^5.47.0`, deps
  `undici 6.28.0`, `youtubei.js 17.2.0`, built with
  `@strapi/sdk-plugin 6.1.1` (`server/src/plugins/yt-kb/package.json`).
  No admin bundle (no `./strapi-admin` export). No `engines` field. `files`
  ships `dist` and `scripts` to npm. A non-boolean `mcp` config value
  throws at load (`PSRC/index.ts:15-19`).
- **How it is built and loaded:** Strapi loads `dist/server/index.js`
  (`package.json` `exports`); `dist/` is gitignored
  (`server/src/plugins/yt-kb/.gitignore:2`). The plugin has its own
  dependencies and lockfile (`package.json`, `yarn.lock` in the plugin
  folder), and no setup or CI script installs or builds them; by hand it is
  `yarn --cwd server/src/plugins/yt-kb install` then `… build` (`CLAUDE.md`,
  plugin section). On a fresh clone `yarn setup && yarn dev` therefore has
  no `dist/` to load. The build leaves `@strapi/utils`, `@strapi/strapi`,
  `youtubei.js` and `undici` external (`dist/server/index.js:3-6`); ⚠️
  framework behavior — with the plugin's own `node_modules` absent they
  resolve from `server/node_modules`, which is why `server/package.json:30`
  lists `youtubei.js ^17.0.1` though no host code imports it.
- **Node engines (declared, not verified):** this repo's `server/`
  `>=22.0.0 <=24.x.x` (`server/package.json:39`); the host
  `>=22.0.0 <=22.x.x` (host `package.json`); `client/` and `site/` declare
  none (`client/package.json`, `site/package.json`).
- **Considered / Why:** unknown (pre-existing).

## Database

- This repo: client from `DATABASE_CLIENT` (default `sqlite`), with
  mysql, postgres (`DATABASE_URL`, `DATABASE_SCHEMA`) and sqlite branches
  (`server/config/database.ts:5-52`). Installed drivers: `better-sqlite3`
  12.8.0 and `pg` 8.23.1, no `mysql2` (`server/package.json`). SQLite file
  from `DATABASE_FILENAME` (default `.tmp/data.db`).
- main-site: the same pattern (`config/database.ts` there).
- yt-kb tables are prefixed `yt_kb_` and `components_ytkb_`
  (`PSRC/content-types/*/schema.json`, `PSRC/components/*.json`); the
  `youtube-transcripts` uses `youtube_transcripts` (main-site
  `types/generated/contentTypes.d.ts:1978-2027`). A host type would collide
  only if it used the `yt_kb_` table prefix, or a host component the
  `ytkb` category (yt-kb adds its components with `components.add`,
  `PSRC/register.ts:24-36`).

## Backend hosting

- This repo's `server/` runs locally. It carries `@strapi/plugin-cloud` and
  `"deploy": "strapi deploy"` (`server/package.json:10,21`), and its
  `config/server.ts:4-10` comments on Strapi Cloud's `HOST` handling; ⚠️ not
  in code — whether it has ever been deployed.
- The plugin's hosts are not fixed (`03`). main-site is one Strapi Cloud
  example; ⚠️ not in code — any host's deploy settings.

## Frontend framework

- **TanStack app:** `@tanstack/react-start` 1.168.60, `@tanstack/react-router`
  1.170.41, React 19.2.5, Vite 8.0.8, Nitro 3.0.260311-beta, `@tanstack/ai`
  0.47.1 with `@tanstack/ai-ollama` 0.9.3, zod 4 (`client/package.json`,
  `client/yarn.lock`). Three lockfiles exist in `client/` (`yarn.lock`,
  `package-lock.json`, `pnpm-lock.yaml`). **Chosen by:** pre-existing.
- **Astro site:** Astro 6.4.8 (declared `^6.1.3`), MiniSearch 7.2.0, marked
  15.0.12, Tailwind 4.3.3, no adapter, static output (`site/package.json`,
  `site/astro.config.mjs`). **Chosen by:** pre-existing
  (`docs/superpowers/specs/2026-10-11-static-knowledge-site-design.md`).

## Frontend hosting

- TanStack app: not hosted; `vite dev` on the owner's Mac. ⚠️ framework
  behavior — Vite binds to `localhost` unless `--host` is given; no
  `server.host` in `client/vite.config.ts`.
- Astro site: Netlify, built locally and uploaded with `npx netlify deploy`
  (`site/netlify.toml` sets `command = ""`, `pretty_urls = false`;
  `publish-site.sh:89,98`). Live URL `https://boisterous-lamington-cc0eed.netlify.app`
  (`publish-site.sh:32`).

## Auth

- No end-user sign-in anywhere in this repo
  (`client/src`: no session, cookie or middleware code;
  `docs/architecture.md:68` "no auth, single user").
- Every caller of yt-kb's Strapi routes uses an API token. The plugin's
  routes set no `auth` config (`PSRC/routes/index.ts`), so ⚠️ framework
  behavior — each needs an API token holding the route's scope, or a Users
  & Permissions JWT whose role holds it.
- **Admin panel users** sign in to `/admin` (admin JWT signed with
  `ADMIN_JWT_SECRET`, `server/config/admin.ts:4-6`). All five yt-kb types
  are visible in the Content Manager (`PSRC/content-types/*/schema.json`),
  so an admin can read, create, change and delete every yt-kb row there,
  gated by Content Manager permissions, not by `plugin::yt-kb.*` or API
  tokens. The plugin grants
  nothing to the Public role (`PSRC/routes/index.ts:5-8`); this repo's
  `server/src/index.ts` seeds no permissions.
- **Users & Permissions** is installed in this repo's Strapi
  (`server/package.json:22`) with a stock `user` extension
  (`server/src/extensions/users-permissions/content-types/user/schema.json`)
  and `JWT_SECRET` (`server/.env.example`). No part of the product signs in
  through it. `server/scripts/seed.mjs:63-77` (not wired to any script)
  registers users through `/api/auth/local/register` and writes to
  `/api/posts` and `/api/profiles`, types that do not exist in this repo.
  ⚠️ not in code — registration settings and the Authenticated role's
  grants.
- MCP callers use admin API tokens holding `plugin::yt-kb.read`,
  `.write`, `.maintenance` (`PSRC/mcp-official/permissions.ts:19-51`).
  Strapi's Content Manager also registers MCP tools for every displayed
  type, yt-kb's included, gated by Content Manager permissions (see MCP
  server).
- ⚠️ not in code — the tokens and grants that exist in each Strapi's
  database. (For this repo's local Strapi, the session that built the
  plugin recorded: Content API token `yt-kb-client` (full access, in
  `client/.env`, `docs/designs/cloud-deploy-checklist.md:112`), `yt-kb-site`
  (read-only, in `site/.env`) and admin token `claude-mcp-1782487483515`
  (the three yt-kb actions) (`docs/designs/yt-kb-plugin.md` step 6).)

## Session topology

- **Admin panel:** ⚠️ framework behavior — Strapi's admin session (admin
  JWT; storage, refresh and expiry are Strapi's defaults; this repo
  configures only `ADMIN_JWT_SECRET`, `server/config/admin.ts:4-6`).
- **The app:** no user session exists (`client/src`, see Auth). The only credential
is the server-side `STRAPI_API_TOKEN`, added to each Strapi call when it is
set; when it is empty no `Authorization` header is sent and the call runs
as Public (`client/src/lib/services/strapi-client.ts:147-152`,
`client/src/lib/env.ts:103-124`).

## Environments

- This repo: local only. `client/.env`, `server/.env`, `site/.env`
  (names in each `.env.example`).
- This repo's Strapi middlewares: `strapi::cors` with `origin: []`,
  `credentials: false`; `strapi::body` with 20 MB JSON/form/text limits
  (`server/config/middlewares.ts:24, 27-34`). REST paging:
  `defaultLimit 25`, `maxLimit 100`, `withCount: true`
  (`server/config/api.ts`); the site pages 100 at a time and relies on the
  count (`site/src/lib/strapi.ts:13-14, 100-112`).
- A host's body limit and CORS are its own. main-site uses the default
  `strapi::body` (⚠️ framework behavior — default size limit) while
  `copy-content.mjs` sends batches up to 8 MB
  (`server/src/plugins/yt-kb/scripts/copy-content.mjs:101`).

## Media / file storage

No media fields in yt-kb's types (`PSRC/content-types/*/schema.json`).
Thumbnails are YouTube URLs stored as text (`videoThumbnailUrl`) or built
from the id (`site/src/lib/player.ts`).

## CI/CD

- This repo: one GitHub Actions job — install all, typecheck client, server
  and site, run client tests, run site tests, build the client
  (`.github/workflows/ci.yml`). Opt-in pre-push hook runs the client build
  (`.githooks/`, `CLAUDE.md`). The plugin is not built, installed or tested
  by `yarn setup`, `yarn install:all` or CI (root `package.json`,
  `.github/workflows/ci.yml`).
- Root scripts (`package.json:11-21`): `dev` runs Strapi and, after
  `wait-on http://localhost:1340`, the client; `start` runs `start.sh`,
  which sets `OLLAMA_KEEP_ALIVE` and `OLLAMA_NUM_PARALLEL` with
  `launchctl` (`start.sh:18-19`), starts Ollama if needed and `kill -9`s
  whatever holds ports 1340 and 3005 (`start.sh:89-95`); `seed` / `export` run `strapi import` /
  `strapi export` on `server/seed-data/seed.tar.gz`, which is gitignored
  (`server/.gitignore:43`); `sync:bm25` copies
  `client/src/lib/services/bm25-core.ts` into `PSRC/services/bm25-core.ts`
  (`scripts/sync-bm25-core.mjs:24-25`). `copy-env.mjs` copies a
  `.env.example` only when `.env` is absent (`copy-env.mjs:21-31`).
- `yarn --cwd server verify:mcp` (`server/scripts/verify-mcp-tools.cjs:12-16,
  33, 56-63`) needs `dotenv` and a stopped dev server, and loads
  `dist/src/mcp/tools/*` and `api::video.video`, both removed in `698a887`.

## Email / notifications

None in yt-kb. The host's `tanstack-ai` has a `send_email` tool (host
`node_modules/strapi-plugin-tanstack-ai/dist/server/index.js:1273-1282`);
out of scope.

## Payments

None.

## Outside services (required or optional)

| Service | Called by | Required? |
|---|---|---|
| Ollama (chat + embeddings) | The TanStack app only (`client/src/lib/services/learning.ts`, `embeddings.ts`) | Required for summaries, chat, embeddings |
| YouTube Innertube + caption XML | The plugin (`PSRC/services/youtube-transcript.ts`) | Required to fetch a transcript |
| YouTube oEmbed | The app (`learning.ts:188-204`) and the plugin (`youtube-transcript.ts:244`) | Optional (falls back to no title) |
| DuckDuckGo HTML | The app's `web_search` chat tool (`client/src/lib/services/web-search.ts`) | Optional |
| Residential proxy | The plugin, from `TRANSCRIPT_PROXY_URL` (`PSRC/services/fetcher.ts:35`) | Optional locally; ⚠️ not in code — whether YouTube blocks Strapi Cloud's IPs |
| Netlify | `publish-site.sh` | Required to publish the site |
| Anthropic | The host's `tanstack-ai` chat (`ANTHROPIC_API_KEY`, host `config/plugins.ts:2-15`) | Host only; not called by yt-kb |

## Analytics & monitoring

None in this repo; Strapi telemetry is off (`server/package.json:42-44`).
Logs only: the app logs `[summary <id>]` phases to its
terminal (`learning.ts` `logPhase`); the plugin logs fetch failures at
`warn` (`PSRC/controllers/fetcher.ts`).

## MCP server (AI agent access)

- Strapi's official MCP server at `/mcp`, enabled by `MCP_ENABLED`
  (default true) in both Strapis (`server/config/server.ts:22`; host
  `config/server.ts:10-12`).
- On this repo's Strapi:
  - yt-kb's 21 tools (15 read, 4 write, 2 maintenance), registered in
    `register()` (`PSRC/register.ts:42-43`, `PSRC/mcp-official/tools.ts:40-71`),
    in a loop with no try/catch (`PSRC/mcp-official/index.ts:47-49`,
    `adapter.ts:98-140`). ⚠️ framework behavior — `registerTool` throws on a
    duplicate name and after the server has started
    (`server/node_modules/@strapi/core/dist/services/mcp/index.js:46-50`,
    `internal/McpCapabilityDefinitionRegistry.js:18-21`), so a clash with a
    tool another plugin registered earlier in `register()` would escape
    yt-kb's `register()`. Plugins that register in `bootstrap()` (Content
    Manager on both 5.52 and 5.60, `@strapi/content-manager/dist/server/bootstrap.js:17`;
    `youtube-transcripts`; `tanstack-ai`) come after yt-kb;
  - core's `log` (`server/node_modules/@strapi/core/dist/services/mcp/index.js:96`);
  - Content Manager's `list_` / `get_` / `create_` / `update_` / `delete_`
    tools for every displayed type, yt-kb's five included, named with the
    slug `plugin-yt-kb_<type>` and gated by Content Manager permissions,
    not by `plugin::yt-kb.*`
    (`server/node_modules/@strapi/content-manager/dist/server/mcp/register-content-manager-mcp-tools.js:22-31`,
    `utils.js:11-17`).
- On main-site (reference): `youtube-transcripts`' 5 tools named
  `youtube_transcripts__*` and `tanstack-ai`'s 8 unprefixed tools, both
  registered in `bootstrap()`, plus Content Manager's
  (`node_modules/strapi-plugin-youtube-transcripts/dist/server/index.js:1022-1029, 1123-1125`,
  `node_modules/strapi-plugin-tanstack-ai/dist/server/index.js:1273-1286, 1377-1393`
  there). main-site also runs a second MCP endpoint from
  `ocyris-strapi-builder-mcp` (`config/plugins.ts:37-39` there); out of
  scope.
- ⚠️ framework behavior — whether `tanstack-ai`'s `create_content` /
  `update_content` can write `plugin::yt-kb.*` types.
- ⚠️ framework behavior — two registrations with the same tool name: the
  second throws and the first stays (host
  `node_modules/@strapi/core/dist/services/mcp/internal/McpCapabilityDefinitionRegistry.js:18-21`).
- **Chosen by:** pre-existing (`docs/adr/0008-official-strapi-mcp-over-hand-rolled.md`).

## Styling

Tailwind 4 in both frontends (`client/package.json`, `site/package.json`).
