# Checkpoint R — Reconstruction check

- **Targets:** `04-tech-decisions.md`, `05-tech-requirements.md`
- **Date:** 2026-10-31 · **EGM:** v0.1.0 (plugin `strapi-product-egm` 0.3.0)
- **Reviewers (dispatch option):** `egm:egm-codebase-details` (1), REVIEW mode, codebase as GoldfishContext
- **Standard:** `reviews/standards/as-built-standard.md`
- **Commit reviewed:** `8ac5ae3`
- **Totals:** 🔴 3 · 🟡 12 · 🟢 13

All 28 findings were independently re-verified against the code before any
fix was applied. **Every one held.** Per the existing-app-mode resolve rule
for R ("R's fixes correct facts, not decisions, so apply every PROPOSE FIX
directly"), all were applied; nothing was contested or declined.

The reviewer also verified a large set of claims as correct, which later
checkpoints need not re-check: every ADR quote in `04`; all BM25, embedding,
retrieval and signal constants; the client and site route tables; the four
API-route check lists and the POST-only claim; CI, `publish-site.sh`,
`netlify.toml`, `verify-output.mjs`, `VIDEO_FIELDS`/`FORBIDDEN_FIELDS`; the
21 seeded public-role actions; 15 bare factory files; 9 components.

## Findings

### 1. `Video` attribute count wrong — 🔴 Blocker
- **Scope:** `05` › §1 Data model
- **Finding:** Stated 38 attributes; the schema has 36.
- **Resolution:** PROPOSE FIX — applied. Corrected to 36; `required` and
  `unique` flags added.

### 2. "No unique constraint on `Video.youtubeVideoId`" — 🔴 Blocker
- **Scope:** `05` › §7 Operations › Uniqueness under concurrency
- **Finding:** Flatly false, and it is the schema statement a change spec
  would most rely on. `video/schema.json` declares `youtubeVideoId` as
  `required`, `unique`, maxLength 32. The same `unique: true` is on
  `transcript.youtubeVideoId`, `tag.name` and `digest.videoSetKey`. The row
  also omitted the Document Service pre-check (`server/src/index.ts:15-57`),
  whose own comment at `:37-39` says the DB constraint is the real gate and
  the middleware exists for cleaner errors and in-flight races.
- **Resolution:** PROPOSE FIX — applied. Row rewritten: unique at the DB
  level on all four keys, plus the application pre-check; the read-then-write
  shape of both the pre-check and `shareVideo` is now stated as the reason
  the DB constraint is what serialises concurrent creates. A new
  "Uniqueness in the schema" subsection was added to §1.
- **Note:** this error would have sent the change spec chasing a
  non-existent problem. It is the single most valuable find of this
  checkpoint.

### 3. All three MCP tool counts wrong — 🔴 Blocker
- **Scope:** `05` › §3 MCP tiers; `04` › Decision 8; `05` › §8
- **Finding:** Stated 14 / 4 / 4. `server/src/mcp-official/tools.ts:43-72`
  registers 22 tools: 15 `none`, 4 `write`, 3 `external`. The documents also
  said "20 tool bodies", which is the *file* count — `tags.ts` exports three
  tools, so 20 files yield 22 registered tools. The likely source of the
  error is the stale comment at `permissions.ts:37-45`, which still lists
  `generateDigest` under maintenance after `tools.ts:57-61` re-tiered it.
- **Resolution:** PROPOSE FIX — applied in both documents. 15/4/3, "22 tools
  from 20 files", and the stale comment recorded as stale.

### 4. Discovery and moment search described as pure cosine — 🟡 Major
- **Scope:** `04` › Decision 3; `05` › §7 Search
- **Finding:** Both layers are RRF hybrids. `retrieval.ts` fuses dense
  cosine with BM25 at `:274` (`rankPassages`), `:346`
  (`rankVideosByQuery`) and `:382` (`rankRelatedVideos`), over
  `buildVideoSearchText` (`:298`), plus tag and title boosts. Three tuning
  constants were undocumented: `TITLE_BOOST_PER_TOKEN`,
  `TITLE_TOKEN_MIN_IDF`, `RELATED_MAX_QUERY_TERMS`.
- **Resolution:** PROPOSE FIX — applied in both documents.

### 5. "Ollama: the client's server only" — Strapi calls it too — 🟡 Major
- **Scope:** `05` › §6 Outside services
- **Finding:** `server/src/mcp/utils/embeddings.ts:50` POSTs
  `${OLLAMA_HOST}/api/embeddings`, reached by the `reindexEmbeddings` MCP
  tool. That file also duplicates the client's embedding contract
  (`MAX_EMBED_CHARS`, the task prefixes, model/version defaults) with **no
  sync script and no test**, unlike `bm25-core.ts`.
- **Resolution:** PROPOSE FIX — applied. The caller is corrected, and the
  unguarded second duplication is now recorded in `04` Decision 3 beside the
  guarded one.

### 6. oEmbed caller incomplete — 🟡 Major
- **Scope:** `05` › §6
- **Finding:** Strapi also calls oEmbed —
  `server/src/services/youtube-transcript.ts:235-241`, reached by
  `server/src/mcp/tools/add-video.ts:81`.
- **Resolution:** PROPOSE FIX — applied.

### 7. "Netlify site name not in code" — it is — 🟡 Major
- **Scope:** `04` › Decision 15; `05` › §10
- **Finding:** `publish-site.sh:32` hardcodes
  `https://boisterous-lamington-cc0eed.netlify.app`, and `:82` requires
  `site/.netlify/state.json`.
- **Resolution:** PROPOSE FIX — applied. URL and `siteId` stated; the ⚠️
  narrowed to the Netlify UI settings, and widened to cover the
  `commandOrigin = "ui"` question (To confirm 1).

### 8. Document Service middleware named but not described — 🟡 Major
- **Scope:** `05` › §2
- **Finding:** The standard asks for middlewares *and* code that writes
  data. The three rules were not given; rule 2 silently rewrites
  `tag.name` through `normalizeTagName` and is the only server-side data
  transform in the repo.
- **Resolution:** PROPOSE FIX — applied as a three-row table.

### 9. Server env list was `.env.example`-only — 🟡 Major
- **Scope:** `05` › §11
- **Finding:** The standard asks for names from `.env.example` **and the
  code**. Thirteen were missing (11 database variables, `FLAG_NPS`,
  `FLAG_PROMOTE_EE`, `STRAPI_URL` in `seed.mjs`), plus
  `OLLAMA_KEEP_ALIVE` / `OLLAMA_NUM_PARALLEL` from `start.sh`.
- **Resolution:** PROPOSE FIX — applied as two new subsections.

### 10. Node engine never stated — 🟡 Major
- **Scope:** `04` › Repo shape; `05` › §11
- **Finding:** Standard §6 requires it, written as declared. Only "Node 22"
  appeared, which is the CI runner — a different fact.
- **Resolution:** PROPOSE FIX — applied in both: `server/package.json:37-40`
  declares `>=20.0.0 <=24.x.x`; `client/` and `site/` declare none.

### 11. Server-function count and validator claim wrong — 🟡 Major
- **Scope:** `05` › §4 Server-side handlers
- **Finding:** "~40 … zod `.inputValidator` on every one". There are 47
  definitions and 37 validators; ten zero-argument functions have none, and
  four of those write rows across the whole library.
- **Resolution:** PROPOSE FIX — applied with the ten named.

### 12. Three test counts wrong or unreproducible — 🟡 Major
- **Scope:** `05` › §12
- **Finding:** 34 files → 33; e2e "7 cases" → 4; "230 with both down" does
  not follow from the source.
- **Resolution:** PROPOSE FIX — applied. Counts corrected and the suite
  re-measured at this commit: **306 tests, 33 files, 305 passing, 1
  failing** (`videos.smoke.test.ts > public role can create a tag`,
  `expected 400 to be 200`, with Strapi live — the pre-existing `uid`
  failure `CLAUDE.md` documents). `CLAUDE.md`'s own 230 and 96 are now
  recorded as stale.

### 13. `server/scripts/seed.mjs` undocumented, and it writes data through auth endpoints — 🟡 Major
- **Scope:** `05` › §3, §6
- **Finding:** Stale cross-project code (profiles, posts, `heightCm`,
  `waistCm`) that POSTs `/api/auth/local/register` and `/api/auth/local`
  with three hardcoded passwords, against `process.env.STRAPI_URL`. Not
  wired to any script, but it contradicts "no sign-in anywhere in the
  product". The reviewer judged this arguably Blocker-level under standard
  §3.
- **Resolution:** PROPOSE FIX — applied, together with the matching dead
  client code (`client/src/lib/validations/post.ts:112-131`). **Carried
  forward to checkpoint B as a candidate finding**: dead auth-adjacent code
  with hardcoded credentials in a repo whose stated design has no auth.

### 14. `site/src/lib/strapi.ts` omitted — 🟡 Major
- **Scope:** `05` › §5
- **Finding:** The site's only data path. Missing: `NESTED_FIELDS`, the
  two-key sort tie-break, the paging, and the six refuse-to-build throws —
  the failure modes of the only route to the live site.
- **Resolution:** PROPOSE FIX — applied.

### 15. "The other four" content types too thin — 🟡 Major
- **Scope:** `05` › §1
- **Finding:** Transcript has 9 attributes (3 named); Tag, Note and Digest
  omitted required/unique keys, enum values and defaults;
  `draftAndPublish: false` is on all five, not only `video`; the
  users-permissions `user` extension was cited but never described.
- **Resolution:** PROPOSE FIX — applied in full; the extension is now
  described as the stock schema with no custom attribute.

### 16–28. Nits — 🟢
All applied. Off-by-N citations (`content.config.ts` ×2,
`web-search.ts:52→51`, and the two same-basename `videos.ts` files, now
disambiguated with a note); `koa-body` body-limit defaults marked
⚠️ framework behavior with the real values (`1mb`/`56kb`/`56kb`, so all
three were raised); `MAX_WIRE_BYTES` comparison (`bytes * 2 + 2048`) and
`RESULT_TOO_LARGE`; the Open Graph absence stated as fact rather than
marked unknown (no `og:`, `twitter:`, `canonical` or sitemap anywhere);
astro given as the lockfile-resolved 6.4.8; the stray `client/pnpm-lock.yaml`
and two `.yarnrc.yml`; `registry.ts`, `bm25-search.ts` and
`mcp/utils/embeddings.ts` now mentioned; the SSR claim marked
⚠️ framework behavior; `env.ts` "only module" scoped to non-test code;
Decision 11's "Considered" citation corrected (the design note treats Astro
as a given and never mentions TanStack SSG); `strapi::session` marked;
`MCP_ENABLED` default `true` and the transport defaults; the dead profile
validations; and `publish-site.sh`'s `python3`/`curl` and `start.sh`'s
macOS-only prerequisites.

## To confirm — for the owner

Facts outside the code. Items 1 and 2 are new; the rest were already marked.

1. **A Netlify UI build command may be configured.** `site/netlify.toml`
   sets `command = ""`, but the CLI's gitignored resolved-config cache
   `site/.netlify/netlify.toml` records `commandOrigin = "ui"`. If a command
   is set there, "Netlify never builds it" holds only because the repo is not
   connected to a git-triggered build.
2. **The live site identity** —
   `boisterous-lamington-cc0eed.netlify.app`, `siteId`
   `def3e509-9b64-4019-941a-8eb630c71051`. Still production? Any deploy or
   build hook?
3. **MCP token inventory** — one admin token holding all three tiers, or
   more? Blocker 3 changes what "all three" reaches.
4. **Database measurements** (`05` §1) — 191 videos, 139 MB,
   `passageEmbeddings` avg 439 KB / peak 3.99 MB, 115.7 MB retrieval state,
   read 2026-10-31 from `server/.tmp/data.db`. Note `site/netlify.toml:9`
   and `site/src/lib/strapi.ts:99` both say 172, consistent with 191 rows
   minus non-generated ones but a second number a reader may trip on.
5. **The stuck-`pending` rows** (`05` §7) — 4 rows plus `test-smoke-001`.
   Commit `01f76f2` is confirmed present, dated 2026-09-30.
6. **Strapi's default CORS** — resolved during this checkpoint by reading
   the installed source
   (`server/node_modules/@strapi/core/dist/middlewares/cors.js`):
   `origin: '*'`, `credentials: true`, and `matchOrigin` echoes the
   caller's own `Origin` when the list contains `*`. No longer open; carried
   to B as a design finding.
7. **Whether `STRAPI_API_TOKEN` is set on the live machine**, and
   admin-panel permission edits since the last boot.
