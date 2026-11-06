# Deploying Strapi to the cloud — what is done, what is blocked

Companion to `cloud-split-architecture.md` (on `egm/converge-transcripts-plugin`),
which holds the *why*. This is the running state of the *how*. Updated 2026-11-05.

Target: Strapi hosted, exposing `/mcp` and `/api`; the TanStack app and
Ollama stay on the laptop and keep every capability they have today.

## Security fixes: merged and built (2026-11-05)

`egm/security-hotfix` is merged into this branch (`60088c6`). Before the
merge this branch still had the reflect-any-origin CORS default, `HOST`
defaulting to `0.0.0.0`, and `@tanstack/react-start` 1.168.48 inside
CVE-2026-102989's range. An earlier version of this file, and
`cloud-split-architecture.md`, wrongly said the CORS lockdown had "already
landed" when it was only committed on the unmerged branch.

Verified after the merge, not assumed:

| Check | Result |
|---|---|
| `yarn install:all` (frozen lockfiles) | pass — the auto-merged `client/yarn.lock` is consistent |
| Installed TanStack | react-start 1.168.60, start-server-core 1.169.39, router-core 1.171.34 |
| client `tsc` + `vite build` | pass — browser, SSR and server bundles, no MISSING_EXPORT (the ADR 0009 failure mode) |
| server `tsc` + `strapi build` | pass, admin panel included |
| tests | client 318, site 105 |
| `yarn site:build` | pass, output guard clean (209 files) |
| CORS at runtime | `Origin: https://evil.example` gets no `Access-Control-Allow-*` headers |
| M2 at runtime | anonymous write 403, anonymous read 200 |
| app pages | `/feed`, `/learn/<id>`, `/settings`, `/search` all 200 |

The merge also brought the EGM design docs and the site's visual video cards
(`8ac5ae3`), which were already on that branch; the cards account for the
site suite going from 102 to 105 tests.

## Done, on branch `feat/cloud-readiness`

| | What | Evidence |
|---|---|---|
| done | **Postgres driver** | `pg` pinned at 8.23.1. Booting with `DATABASE_CLIENT=postgres` against a dead port now fails with `connect ECONNREFUSED`, not `MODULE_NOT_FOUND`. |
| done | **`varchar(255)` landmines removed** | `videoTitle`, `verdictSummary`, `videoSetKey` are now `text`. Strapi drops `maxLength` when building columns, so each could hold a value its own column could not. **5 rows in `verdict_summary` already exceed 255 today** (longest 278) and would have failed on the first Postgres write. Verified on a scratch copy through the SQLite table rebuild: all rows intact. |
| done | **Corpus overfetch fixed** | `listAllVideosForEmbeddingService` named no `fields`, so all 11 call sites pulled every column — 50.01 MB per page of 100. Now 2.34 MB for related-videos and semantic search, 0.89 MB for coverage. This is what makes a remote database survivable. |
| done | **M2 — Public role is read-only** | The role held 11 writes with no credential. Demonstrated on a scratch copy with bare `curl`: anonymous `POST /api/videos` 201, `DELETE /api/notes/<id>` 204. After M2: anonymous writes 403, reads 200, token-authenticated write 201. `bootstrap()` now revokes as well as seeds (`revoked=11`). **Not yet run against `data.db`** — see the token section. |
| done | **Missing-token warning** | The app said nothing when `STRAPI_API_TOKEN` was empty. It now names the consequence. |

`config/database.ts` already supported Postgres in full — `DATABASE_URL`,
host/port/user, SSL, schema, pool. Nothing needed there.

## Blocked on the owner

### 1. Create a Strapi API token — everything waits on this

`client/.env` has `STRAPI_API_TOKEN` present but **empty**. `buildHeaders`
(`strapi-client.ts:149`) guards on truthiness, so no `Authorization` header
is sent and **every write the app makes today lands as the anonymous Public
role**.

M2 is committed on this branch, but must not be RUN against the live database
until the token is set: `bootstrap()` revokes on every boot, and the Public
role's write grants are load-bearing today. Booting this branch against
`data.db` without the token breaks sharing, generation, notes, digests and
tags immediately.

It is also why the app cannot be hosted as-is. An internet-facing Strapi
whose own client writes anonymously means anyone can write.

**This is NOT the MCP token.** Strapi has two kinds, in one table
(`strapi_api_tokens`, `kind: 'content-api' | 'admin'`), and the docs are
explicit: *"API tokens and Admin tokens are strictly separated: a Content API
token is rejected on admin routes, and an admin token is rejected on Content
API routes."* The content-api strategy rejects anything whose `kind` is not
`content-api`; `/mcp` authenticates through `authenticateAdminToken()`.

| | Content API token | Admin token |
|---|---|---|
| Admin path | Settings > Global settings > API Tokens | Settings > Administration Panel > Admin Tokens |
| Authenticates | `/api/*` | `/mcp` and admin routes |
| Used by | the TanStack app (`STRAPI_API_TOKEN`) | Claude Desktop / Claude Code |
| State here | **empty — the blocker** | already working |

MCP already works for this project — an Admin token carrying the three custom
permissions (`api::yt-kb-mcp.read` / `.write` / `.maintenance`) exists and the
tools connect. Creating the Content API token does not touch it, and the
existing MCP token cannot stand in for it.

**To do:** Strapi admin -> **Settings > Global settings > API Tokens** ->
Create new API Token. Token type **Full access** (or Custom with
create/update/delete on video, tag, transcript, note, digest). Token duration
**Unlimited**. Copy the value into `client/.env`:

```
STRAPI_API_TOKEN=<the token>
```

Restart the client; the `[env]` warning should stop. Then M2 can land.

### 2. Confirm A or B

`cloud-split-architecture.md` has the fork. A (cloud is the source of truth)
is chosen; recorded here only because it is the owner's to confirm.

### 3. Publish the transcripts plugin

`strapi-plugin-youtube-transcripts` needs a release carrying the `videoId`
required+unique constraint (committed on its `feat/videoid-required-unique`
branch). The migration script **refuses to run** without it, by design.

## Remaining work, in order

1. ~~Merge `egm/security-hotfix` and build~~ — done, see above.
2. ~~Set the Content API token and boot against `data.db`~~ — done.
   `yt-kb-client` (full access) is in `client/.env`; the live Public role
   now holds 10 reads and no writes.
3. **A real Postgres run.** Everything above is verified against SQLite plus
   a driver-load probe. **Nothing has actually run on Postgres.** Docker is
   installed on this machine but its daemon is not running; starting it makes
   a true end-to-end test possible before any cloud spend.
4. **Data migration to Postgres.** `strapi export` / `strapi import`, or a
   direct dump. Unproven either way.
5. **Plugin convergence, Tasks 3-6.** Transcripts onto the plugin.
6. **MCP tokens.** One admin token currently holds all three tiers. On a
   public host that is one credential for read, write and maintenance.
7. **Repoint `STRAPI_URL` and `STRAPI_API_TOKEN`** at the deployed instance
   and a token created in *its* admin. That is the acceptance test for the
   whole architecture. Two variables — the browser never calls Strapi
   directly, so the empty-origin CORS lockdown (once merged) stays correct.

## Verified against the Strapi docs (2026-11-05)

Checked with the `strapi-docs` MCP rather than inferred. The EGM skill ships
`strapi-product-egm:strapi-fact-checker` for exactly this and it was not used
before the earlier claims in this file.

- **`pg` must be a project dependency.** `packages/core/database/src/connection.ts`
  maps `postgres -> pg`, and `create-strapi-app`'s `addDatabaseDependencies`
  writes `pg` into the project's own `package.json` when Postgres is chosen.
  Nothing in the Cloud docs says the platform supplies drivers.
  **Correction to an earlier claim in this file:** "Strapi Cloud would fail at
  boot with MODULE_NOT_FOUND" was stated as fact. It is a well-grounded
  inference, not something the docs state. The locally verified part — the
  boot failure changing from MODULE_NOT_FOUND to ECONNREFUSED once `pg` is
  installed — stands.
- **Minimum driver for Node 24 is `pg@8.x`.** 8.23.1 satisfies it.
- **Do NOT set `DATABASE_*` variables in Strapi Cloud** when using the managed
  database. From the Cloud docs: *"Any environment variable added to your
  project that starts with `DATABASE_` will cause Strapi Cloud to assume that
  you will be using an external database and all Strapi Cloud specific
  database variables will not be injected."* Setting `DATABASE_CLIENT=postgres`
  — the obvious move — would disable the managed database. `config/database.ts`
  already reads whatever Cloud injects, so it needs no change.
- **Node floor is 22**, not 20, for Strapi 5.48.1+. `server/package.json`
  declared `>=20.0.0`; corrected to `>=22.0.0 <=24.x.x`.
- **PostgreSQL 14.0 minimum, 17.0 recommended.**
- **yarn is supported.** The Cloud CLI "works with both the `yarn` and `npm`
  package managers", and Strapi 5 detects the package manager in use. Yarn
  1.22 with the committed `yarn.lock` is not a deployment blocker.

## Known gaps not yet addressed

- **`reader.ts:360` bypasses `strapiFetch`** with a raw `fetch` `PUT` to
  `/api/videos/<id>` (pre-existing, since 2026-04-21). It attaches the token
  with the same truthiness check, so M2 does not break it — but it makes
  CLAUDE.md's "inline fetch to Strapi has been removed" false.

- **Generation dedupe is single-node.** `inflight` is an in-process `Set`
  (`generation-state.ts`). The laptop plus an agent writing over MCP can
  duplicate work. Issue #20.
- **The passage-search path is still 34.7 MB** per corpus walk. It genuinely
  needs the passages; an in-process cache is the fix, and it matters far more
  over a network than over localhost.
- **`npx tsc --noEmit`**, the typecheck command `CLAUDE.md` documents, exits
  0 while printing "This is not the tsc command you are looking for" on a
  checkout with no `node_modules` — `npx` fetches a decoy package from the
  registry. Use `./node_modules/.bin/tsc`.
