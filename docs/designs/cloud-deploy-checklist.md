# Deploying Strapi to the cloud — what is done, what is blocked

Companion to `cloud-split-architecture.md` (on `egm/converge-transcripts-plugin`),
which holds the *why*. This is the running state of the *how*. Updated 2026-11-05.

Target: Strapi hosted, exposing `/mcp` and `/api`; the TanStack app and
Ollama stay on the laptop and keep every capability they have today.

## Done, on branch `feat/cloud-readiness`

| | What | Evidence |
|---|---|---|
| done | **Postgres driver** | `pg` pinned at 8.23.1. Booting with `DATABASE_CLIENT=postgres` against a dead port now fails with `connect ECONNREFUSED`, not `MODULE_NOT_FOUND`. |
| done | **`varchar(255)` landmines removed** | `videoTitle`, `verdictSummary`, `videoSetKey` are now `text`. Strapi drops `maxLength` when building columns, so each could hold a value its own column could not. **5 rows in `verdict_summary` already exceed 255 today** (longest 278) and would have failed on the first Postgres write. Verified on a scratch copy through the SQLite table rebuild: all rows intact. |
| done | **Corpus overfetch fixed** | `listAllVideosForEmbeddingService` named no `fields`, so all 11 call sites pulled every column — 50.01 MB per page of 100. Now 2.34 MB for related-videos and semantic search, 0.89 MB for coverage. This is what makes a remote database survivable. |
| done | **Missing-token warning** | The app said nothing when `STRAPI_API_TOKEN` was empty. It now names the consequence. |

`config/database.ts` already supported Postgres in full — `DATABASE_URL`,
host/port/user, SSL, schema, pool. Nothing needed there.

## Blocked on the owner

### 1. Create a Strapi API token — everything waits on this

`client/.env` has `STRAPI_API_TOKEN` present but **empty**. `buildHeaders`
(`strapi-client.ts:149`) guards on truthiness, so no `Authorization` header
is sent and **every write the app makes today lands as the anonymous Public
role**.

That is why M2 cannot land: the Public role's write grants are not a latent
risk, they are load-bearing. Revoking them now breaks sharing, generation,
notes, digests and tags immediately.

It is also why the app cannot be hosted as-is. An internet-facing Strapi
whose own client writes anonymously means anyone can write.

**To do:** Strapi admin -> Settings -> API Tokens -> Create new API Token.
Token type **Full access** (or Custom with create/update/delete on video,
tag, transcript, note, digest). Copy the value into `client/.env`:

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

1. **M2 — Public role: reads only.** Blocked on the token above. The role
   holds 11 write actions and 2 deletes with no credential. `bootstrap()`
   seeds but never revokes, so this needs an explicit revocation step, not
   just a shorter array.
2. **A real Postgres run.** Everything above is verified against SQLite plus
   a driver-load probe. **Nothing has actually run on Postgres.** Docker is
   installed on this machine but its daemon is not running; starting it makes
   a true end-to-end test possible before any cloud spend.
3. **Data migration to Postgres.** `strapi export` / `strapi import`, or a
   direct dump. Unproven either way.
4. **Plugin convergence, Tasks 3-6.** Transcripts onto the plugin.
5. **MCP tokens.** One admin token currently holds all three tiers. On a
   public host that is one credential for read, write and maintenance.
6. **Repoint `STRAPI_URL`.** One variable — the browser never calls Strapi
   directly, so no CORS change is needed and the empty-origin lockdown stays
   correct.

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
