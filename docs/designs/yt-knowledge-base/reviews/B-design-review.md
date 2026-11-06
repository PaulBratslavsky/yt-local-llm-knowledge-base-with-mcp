# Checkpoint B — Design review of the existing app

- **Targets:** `04-tech-decisions.md`, `05-tech-requirements.md`, and the code in `client/`, `server/`, `site/`
- **Date:** 2026-10-31 · **EGM:** v0.1.0 (plugin `strapi-product-egm` 0.3.0)
- **Commit reviewed:** `8ac5ae3`
- **Reviewers (dispatch option 1, all five in parallel):**
  `egm:egm-design` · `egm:egm-zoom-out` · `strapi-product-egm:strapi-code-auditor` ·
  `strapi-product-egm:frontend-auditor` · `strapi-product-egm:strapi-fact-checker`
- **Standard:** `reviews/standards/strapi-design-standard.md` (zoom-out applied its own)
- **Totals after merge:** 🔴 5 · 🟡 14 · 🟢 11

All five reviews completed; no reviewer reported an unreadable target. Findings
below are merged — where two or more lenses found the same thing, all are named
and the higher severity kept. **Agreement across lenses is a strong signal and
is called out.**

Claims marked **✅ verified** were re-checked against the code or a primary
source by the main agent before this report was written, per the skill's
"check before you claim" rule. Nothing in this report rests on a reviewer's
assertion alone where it was cheap to confirm.

## Root causes

Most findings roll up into five causes. Fixing a cause is smaller than
patching its symptoms.

- **RC-A — Inference and retrieval live in the client; the agent surface lives
  in Strapi.** So every capability both halves need is built twice: BM25
  (synced + drift-tested), embeddings (unguarded), transcript fetch, oEmbed,
  tag slugification, video ingest, related-videos ranking, cross-video search.
  This is also why goals 2 and 3 *look* like they need new machinery.
- **RC-B — Derived caches are JSON columns on the content row, and nothing
  projects `fields`.** 115.7 MB of a 139 MB database is derived state, and it
  travels on the core loop.
- **RC-C — No durable job concept; `summaryStatus` is a status nobody owns.**
  Six overlapping coordination mechanisms, none durable. Four permanently
  stuck rows in the live database prove it.
- **RC-D — Library-walking helpers swallow backend failures and return
  success.** The same class as the owner's own recent `4c2ace3` and `ecebf27`
  fixes, re-introduced in five more places.
- **RC-E — The security posture was never decided.** A bare middleware entry,
  a default host, and a grant list that contradicts its own comment. `04`
  Decision 14's "Considered" is `unknown`, which is accurate — and the point.

---

## 🔴 Blockers

### 1. CORS echoes any origin with credentials, in front of a Public role that can write and delete
- **Lenses:** frontend-auditor (Blocker), code-auditor (Blocker), `egm:egm-design` (Blocker), fact-checker (Blocker), zoom-out (Major) — **five of five**
- **Scope:** `server/config/middlewares.ts:7` · `server/config/server.ts:4` · `server/src/index.ts:105-132` · `server/node_modules/@strapi/core/dist/middlewares/cors.js:9-12,59-63`
- **Finding:** Four facts compose. `strapi::cors` is a bare entry, so installed defaults apply (`origin: '*'`, `credentials: true`). `matchOrigin` returns the *caller's* `Origin` when the list contains `'*'`, so the response echoes it rather than a literal `*` — which is what makes a browser permit the read. The Public role holds `find`/`findOne`/`create`/`update` on video, transcript and tag, plus **`delete` on note and digest**, with no credential. `HOST` defaults to `0.0.0.0`.
- **✅ verified live** against the running instance:
  ```
  $ curl -i -H "Origin: https://evil.example.com" http://localhost:1340/api/videos
  HTTP/1.1 200 OK
  Access-Control-Allow-Origin: https://evil.example.com
  Access-Control-Allow-Credentials: true

  $ curl -X OPTIONS -H "Origin: https://evil.example.com" \
         -H "Access-Control-Request-Method: DELETE" http://localhost:1340/api/notes/1
  HTTP/1.1 204 No Content
  Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS
  ```
  The DELETE itself was **not** executed — the read proof plus the seeded grant is sufficient, and destroying data to confirm an inference is not warranted.
- **Effect:** while the stack runs, any page the owner opens in any tab can read the entire library — transcripts, embeddings, BM25 index — and create, overwrite or delete notes and digests. `HOST=0.0.0.0` extends the same to every device on the network.
- **The fact-checker adds:** this exact shape is **GHSA-9329-mxxw-qwf8 / CVE-2025-53092** (High, 7.5), whose description matches verbatim. The advisory lists `@strapi/core` < 5.20.0 as affected and 5.20.0 as patched, yet installed **5.52.1 still produces the reflecting default for a bare entry**. It also notes the admin panel *is* a browser app on that origin with an httpOnly refresh cookie, so "no browser calls Strapi directly" does not fully mitigate.
- **Recommendation:** `{ name: 'strapi::cors', config: { origin: [], credentials: false } }` and default `HOST` to `127.0.0.1`. Nothing in the product needs permissive CORS — the client calls Strapi from its own server, the site only at build time. Then decide the Public `create`/`update`/`delete` grants deliberately.
- **Resolution:** _pending E5_

### 2. Installed TanStack Start is inside a critical published advisory
- **Lens:** fact-checker (Blocker) — one lens, **independently confirmed**
- **Scope:** `client/package.json:28` · `client/yarn.lock:2213-2215, 2343-2345`
- **Finding:** **CVE-2026-102989 / GHSA-qx66-fv34-fjm8** — critical, **CVSS 9.3**, unauthenticated reflected XSS in TanStack Start **server-function responses**. A crafted URL makes the app return attacker-controlled HTML from its own origin.
- **✅ verified** against the primary GitHub advisory and the installed tree: affected `@tanstack/react-start` `>= 1.143.12, < 1.168.60` (patched **1.168.60**); affected `@tanstack/start-server-core` `>= 1.143.12, < 1.169.39` (patched **1.169.39**). Installed: **1.168.48** and **1.169.30** — both affected. Published 2026-09-30.
- **Why it bites here specifically:** `05` §4 documents 47 `createServerFn` server functions plus four POST API routes — exactly the transport the advisory describes — and `05` §3 documents no auth, so every one is reachable unauthenticated. The precondition is only that a victim opens a crafted link.
- **Recommendation:** bump to ≥ 1.168.60, which pulls `start-server-core` ≥ 1.169.39. **The router family moves together** — downstream reports indicate `react-start` 1.169.x requires `react-router` ≥ 1.170.45 and that `router-core` dropped an API the current version uses, so this is a coordinated bump plus a clean reinstall and rebuild, not a lockfile edit. The advisory's interim mitigations (a WAF rule on `/_serverFn/*`, a restrictive CSP) are explicitly "not a complete fix", and the header they key on is client-controlled.
- **Resolution:** _pending E5_

### 3. Tag creation from the app is broken, and the failure is silent
- **Lenses:** zoom-out (Blocker), `egm:egm-design` (Blocker), code-auditor (Blocker) — **three of five**
- **Scope:** `server/src/api/tag/content-types/tag/schema.json:22-26` · `server/src/index.ts:59-70` · `client/src/lib/services/videos.ts:952-957, 544-545, 267`
- **Finding:** `tag.slug` is a `uid` with `targetField: "name"`, **required**. Strapi fills `uid` fields only in the admin panel, so `POST /api/tags { data: { name } }` is rejected 400. The Document Service middleware's tag rule normalises `data.name` and sets nothing else.
- **✅ verified** — both halves. The 400 is the test failure I watched in this session (`videos.smoke.test.ts > public role can create a tag`, `expected 400 to be 200`). The swallow is in the code: `createTagService` returns `result.ok ? result.data : null`, and the caller is `const created = await createTagService(raw); if (created) tagDocumentIds.push(created.documentId);` — no error path.
- **Effect:** **a user typing a new tag on `/new-post` gets a video created with that tag silently dropped.** No error, no toast. Only pre-existing tags attach. `suggestTagsForUrl` suggests tags that cannot be created. The feed filters on the slug (`videos.ts:267`), which is §3's named failure mode exactly.
- **Why it has hidden:** `CLAUDE.md` records the failing test as a "pre-existing bug… not something this repo's changes caused", which frames it as a test-environment quirk. It is a broken user-facing feature. The MCP path works only because `add-video.ts:123-127` and `tags.ts:78` hand-roll `slugifyTagName`.
- **Recommendation:** one line in the middleware that already intercepts this create (`server/src/index.ts:59-70`), reusing the existing `slugifyTagName` from `server/src/mcp/tools/tag-utils.ts`. That fixes the UI, both MCP tools, the admin API and the smoke test at once, and lets the two hand-rolled `slug:` arguments be deleted. Then drop the note from `CLAUDE.md`.
- **Resolution:** _pending E5_

### 4. MCP `saveSummary` trusts model-supplied timecodes and publishes scoreless rows
- **Lens:** `egm:egm-design` (Blocker) — one lens, **independently confirmed**
- **Scope:** `server/src/mcp/tools/save-summary.ts:16-20, 80-96`
- **Finding:** `SectionSchema` declares `timeSec: z.number().int().min(0).optional()` and the write passes `sections: args.sections` straight to the row. The server has `bm25-core.ts` and `bm25-search.ts` available and does not use them.
- **✅ verified** by reading both the schema and the write.
- **Why this is a Blocker:** it contradicts ADR-0004 and the repo's own standing instruction. `CLAUDE.md`: *"Do not add a code path that trusts a timecode the model produced."* This is that code path, on the main "agent does real work" route — squarely on change goal 2.
- **Second half:** the same call writes `summaryStatus: 'generated'` while writing **no** `valueScore`, `signalScore`, `finalScore`, `summaryEmbedding` or `transcriptSegments`. Consequences invisible to the calling agent: the row publishes to the live site with a null score, is excluded from semantic search and Related videos (`semanticSearchVideos` keeps only rows where `embeddingStatus(v) === 'current'`), vanishes under any `minScore` filter, and gives in-app chat no BM25 anchors. `05` §7's claim that "`score-consistency.test.ts` asserts every writer scores a row identically" covers only the client writers — the server has no test suite.
- **Recommendation:** ground `timeSec` server-side with the synced BM25 core (ignore or validate what the agent sends), compute the scores from the cached transcript, and queue the embedding. Minimally, return an explicit `incomplete: [...]` payload and keep the row out of the published set until a follow-up fills it.
- **Resolution:** _pending E5_

### 5. Passage vectors travel to the browser, and no client query projects `fields`
- **Lenses:** frontend-auditor (Major), zoom-out (Blocker), `egm:egm-design` (Major), code-auditor (Major ×3) — **four of five**
- **Scope:** `client/src/lib/services/videos.ts:339-365` (`listAllVideosForEmbeddingService`), `:274-281` (`feedQuery`), `:314-316` (`detailQuery`), `:471-474` (`stripVideoForClient`) · `client/src/data/server-functions/videos.ts:1049-1053` · `client/src/routes/feed.tsx:86-88`
- **Finding:** No client query sets `fields`, so every row arrives with all four heavy JSON columns. `stripVideoForClient` nulls **only** `transcriptSegments`; `semanticSearchVideos` additionally nulls `summaryEmbedding` but **not** `passageEmbeddings`, the largest of them.
- **Measured:** `passageEmbeddings` averages 439 KB and peaks at 3.99 MB. So a 9-card feed page carries several MB of dehydrated loader JSON; `/feed?mode=semantic` returns up to **90** such rows. `listAllVideosForEmbeddingService` holds ~185 unprojected rows (~80 MB) in the client's server process — and runs on **every learn page** (`RelatedVideos`), on `/search`, on `/feed` semantic, and on **every URL paste in the share form** (`suggestTagsForUrl`, which pulls 80 MB to read `title` and `tags` off five neighbours).
- **The browser never reads it:** a grep of `client/src/components` and `client/src/routes` for `passageEmbeddings` returns no match. `summaryEmbedding` is read once, for presence only (`learn.$videoId.tsx:855`), behind a server-computed status.
- **Two comments contradict their code:** `listAllVideosForEmbeddingService`'s header says it pulls "the fields needed… nothing else"; the strip comment at `:1045-1048` claims to remove "server-only heavy fields" and misses the heaviest.
- **The fix already exists in this repo, with the reason written out.** `server/src/mcp/tools/reindex-embeddings.ts:43-69`: *"The unprojected version loaded transcriptSegments and readableArticle for the whole library on every run."* The MCP tools all project; the client is the outlier.
- **Also:** `/learn/$videoId`'s pending poll re-runs `detailQuery` — which populates `transcript`, so `rawText` + `rawSegments` too — every 3 s for up to 200 ticks, competing for SQLite with the generation it is waiting on.
- **Recommendation:** add `fields` to the three queries, null all four JSON columns in `stripVideoForClient`, and give the pending poll a status-only query. Structurally, §6 asks for route middleware with list and detail population profiles (`server/src/api/video/middlewares/`) so this is enforced server-side once instead of in ~50 call sites.
- **Resolution:** _pending E5_

---

## 🟡 Majors

### 6. Three score backfills page over a set they mutate, skipping about half the library
- **Lens:** `egm:egm-design` — **✅ verified**
- **Scope:** `client/src/data/server-functions/videos.ts:1454-1485`, `:1699-1750`, `:1799-1829`
- **Finding:** each loop filters on exactly the field it is about to write (`valueScore: {$null:true}`, `signalScore: {$null:true}`, `finalScore: {$null:true}`) and then increments `page`. After page 1 is written those rows leave the result set, so requesting page 2 returns what were rows 201–300 — rows 101–200 are never visited. The shrinking `pageCount` also ends the loop early. It returns `{status:'ok', updated}`, which reads as success.
- **Why it matters now:** `05` §8 records these as the existing bulk primitives, so goal 3 would build on a broken pager.
- **Recommendation:** re-request page 1 until the set is empty (the filter is self-advancing), or page by a stable cursor. Add a test that drains a shrinking set.

### 7. `backfillValueScores` computes `finalScore` from a field it never fetched
- **Lens:** `egm:egm-design` — **✅ verified**
- **Scope:** `client/src/data/server-functions/videos.ts:1461` vs `:1472` · `client/src/lib/services/videos.ts:109-121`
- **Finding:** the query asks for `fields: ['documentId', 'watchVerdict']`, then line 1472 reads `row.signalScore` — always `undefined`. `computeFinalScore` treats a non-number as `null` and returns the other component alone, so the write sets `finalScore = valueScore`, **discarding the 0.6/0.4 blend** for any row that already had a `signalScore`. Silent metric corruption, in the one place `05` §7 claims consistency.
- **Recommendation:** add `signalScore` to `fields`, and extend `score-consistency.test.ts` to cover the backfills and MCP `saveSummary`.

### 8. No timeout or abort on any server-side outbound call
- **Lenses:** all five — **unanimous**
- **Scope:** `client/src/lib/services/strapi-client.ts:176` · `embeddings.ts:70` · `learning.ts:209` · `web-search.ts:51` · `server/src/mcp/utils/embeddings.ts:50`
- **Finding:** no `signal` on any of them. The only `AbortController` in the repo is browser-side (`useLibraryChat.ts:190`). A request that never returns never fails, so §10's "what do users see when a service fails" answers "nothing, forever": `/learn` polls 200 ticks and stops silently with the row still `pending`; `/digest`'s loader hangs indefinitely with `DigestPending` spinning. A hung call also holds its `videoId` in the inflight `Set` forever — **this is the mechanism behind the four stuck rows**.
- **For goal 2 specifically:** the MCP transport budget is 60 s, while `reindexEmbeddings` is serial over up to 1000 rows and `fetchTranscript` is a network call — so the agent's call times out while the server keeps writing, and it cannot distinguish success from failure.
- **Recommendation:** `AbortSignal.timeout(ms)` on all five, generous for Ollama and short for the rest. `friendlyOllamaError`'s `TIMEOUT_PATTERNS` already exist and currently match nothing real. The repo already does this in shell: `publish-site.sh` uses `curl --max-time`.

### 9. Five library walks report success on partial failure
- **Lens:** zoom-out (Major), RC-D
- **Scope:** `client/src/data/server-functions/videos.ts:1447, 1558, 1693, 1794` and the three `countMissing*` at `:1443, 1619, 1790`
- **Finding:** the walks `break` on `!result.ok` and then `return { status: 'ok', … }` — a Strapi failure on page 3 of 20 reads as success with partial counts. The counters are worse: `if (!result.ok) return { missing: 0 }`, so a dead backend reports "nothing to do". `listAllVideosForEmbeddingService`'s own comment (`:333-338`) cites ADR-0007 and says "don't swallow errors into empty data"; five functions written after it do exactly that.
- **Recommendation:** route all five through `forEachVideoWithIndex` (`client/src/lib/services/videos.ts:374-399`), which already returns `{ visited, error }` so a partial walk cannot read as complete. Deletes four hand-written page loops, four arbitrary page sizes, and the four `break` bugs — roughly 250 lines, nine server functions down to two.

### 10. Nothing can trigger generation except a browser, and bulk has no global budget
- **Lenses:** zoom-out (Major), `egm:egm-design` (Major), code-auditor (Major) — **three of five**; RC-C
- **Scope:** `server/src/mcp/tools/add-video.ts:9-12, 140` · `client/src/lib/services/generation-state.ts:85-150` · `client/src/routes/learn.$videoId.tsx:102` · `client/src/lib/env.ts:81-85`
- **Finding:** `addVideo` creates a `pending` row and deliberately does not generate. No cron, no worker, nothing server-side polls `summaryStatus`. The only trigger in the product is a human opening `/learn/$videoId`. **An agent handed 10 URLs can ingest them and must then ask a person to open 10 tabs.**
- **And when they do:** `ensureGenerationRunning` dedupes per `videoId` only, so 10 jobs run concurrently, each spawning `MAP_CONCURRENCY` Ollama calls, with state in a plain in-memory `Set` — a restart mid-run leaves rows `pending` forever, which is the four stuck rows again.
- **This is the one genuinely missing capability**, and it is the whole of goals 2 and 3.
- **Recommendation (zoom-out's, and the smallest):** no queue, no job table, no cron, no CLI. One HTTP route on the client app exposing the existing `triggerSummaryGeneration`, following the four POST routes already there; `urls: string[]` on `ShareVideoInputSchema`; `runCancellableBatch` for the UI (the Settings bulk re-rate is already that exact UI); and **one counting semaphore in `generation-state.ts`**, where `inflight` already lives, replacing the four independent concurrency budgets (`MAP_CONCURRENCY` 1, `embedBatch` 2, backfill pool 3, per-job cap). A CLI would be a third ingest path with a third copy of id extraction.

### 11. The duplicated embedding contract has no sync script and no drift test
- **Lenses:** zoom-out, `egm:egm-design`, code-auditor — **three of five**
- **Scope:** `server/src/mcp/utils/embeddings.ts:13-50` vs `client/src/lib/services/embeddings.ts`
- **Finding:** BM25 is protected by `scripts/sync-bm25-core.mjs` plus a byte-for-byte drift test. The embedding contract — model, version, `MAX_EMBED_CHARS`, the `search_query:`/`search_document:` prefixes — is a free-hand second copy reading its own env, with neither. If the two `.env` files disagree, `reindexEmbeddings` writes vectors the client classifies stale, and semantic search and Related videos silently return nothing. The two `.env.example` warnings are the only guard.
- **Also:** `server/src/mcp/tools/generate-digest.ts:7-11` states the design "keeps the server off the inference path (the whole point of MCP)" — but `reindexEmbeddings` POSTs to Ollama from Strapi, which is precisely why this duplication exists.
- **Recommendation:** extend the sync script and add the drift test, or stop writing vectors from Strapi — `reindexEmbeddings` is the only reason that file exists, and the client already has `reindexAllEmbeddings` with a worker pool.

### 12. Eight more capabilities implemented twice, three of them diverging
- **Lens:** zoom-out (Major); RC-A
- **Finding:** beyond BM25 and embeddings — transcript fetch, oEmbed, tag slugification, video ingest (**different id-extraction code, and only the client half triggers generation**), related videos (**client: RRF of dense + BM25 + boosts; MCP: pure cosine, floor 0.5**), cross-video moment search (**client: dense + BM25 over `passageEmbeddings`; MCP: BM25 over `transcriptSegments`**), and map-reduce summarisation (`reader.ts:35,269` is a third copy of the pool and of `SINGLE_PASS_TOKEN_BUDGET`).
- **Why the divergences matter:** the MCP tool and the app give **different answers about the same library**. An agent and the owner looking at "what's related to this" see different lists.
- **Recommendation:** one home per capability, not one sync script per capability. Delete the MCP `relatedVideos` tool or have it call the app; export one `mapReduce({ chunks, concurrency, map, reduce })` for both pipelines.

### 13. `passageEmbeddings` may be a whole layer that can be deleted
- **Lens:** zoom-out (Blocker, folded here as the deletion proposal behind finding 5)
- **Finding:** it is the largest artifact in the product (~80 MB of the 115.7 MB of retrieval state) and carries its own version axis (`PASSAGE_EMBEDDING_VERSION`), chunker, staleness rule, coverage panel and reindex path — while the product **already ships a BM25-only cross-video moment search that does the same job**: `server/src/mcp/tools/cross-search-transcripts.ts`, over the already-stored `transcriptSegments`, with a tag filter, a `fields` projection and a `maxVideos` cap. ADR-0003's own reasoning ("embeddings hide signal that BM25 surfaces") argues for BM25 here too.
- **Recommendation:** evaluate dropping the dense passage layer. It would delete a content column, a version constant, a chunker, a coverage panel, a reindex path and 80 MB per query, and leave `/search` doing what the MCP tool already does. **This is a scope decision for the owner, not a defect.**

### 14. A vitest file writes rows into the live database
- **Lenses:** frontend-auditor, `egm:egm-design`, code-auditor — **three of five**
- **Scope:** `client/src/lib/services/videos.smoke.test.ts:14, 52, 90`
- **Finding:** `STRAPI_URL` defaults to `http://localhost:1340` — the owner's real library. Line 52 POSTs a video; line 90 POSTs a tag named `smoke-${Date.now()}`, **a new row every run**, never cleaned up. It is in the default include glob, so plain `yarn test` runs it, and it self-skips only when Strapi is *unreachable* — so it runs precisely when the live database is up. `test-smoke-001` is sitting in the library as a result.
- **Recommendation:** require an opt-in variable the live stack never sets, or point it at a throwaway Strapi. Deleting the stray rows is separate cleanup.

### 15. `/digest` treats a backend failure as a cache miss
- **Lens:** code-auditor — **✅ verified**
- **Scope:** `client/src/data/server-functions/digests.ts:165-195`
- **Finding:** the branch is `if (lookup.success && lookup.data)`, and the comment below reads *"Cache miss (or lookup failure): generate fresh."* So a momentarily unreachable Strapi is indistinguishable from a genuine miss and triggers a **minutes-long regeneration of a digest that already exists** — with no timeout (finding 8) and no cancellation, inside a GET loader, so a reload or a prefetch re-enters it. `findDigestByVideoSetKeyService` already returns `success: false` with the reason; the caller discards it. The same codebase treats this distinction as load-bearing everywhere else (ADR-0007, `BackendErrorPanel`, the `*WithStatus` helpers).
- **Recommendation:** return `{ status: 'error' }` on `success === false` so only a real miss generates, and move generation out of the loader into an explicit action.

### 16. No transaction anywhere, including the one place Strapi offers one
- **Lenses:** code-auditor (Major), `egm:egm-design` (Major), zoom-out (sweep)
- **Scope:** `server/src/mcp/tools/add-video.ts:93-144` · `client/src/lib/services/learning.ts:1196-1291`
- **Finding:** `add-video.ts` runs *inside* Strapi with `strapi.db.transaction` available and does not use it: transcript create, then N tag creates, then the video create as four-plus independent writes. A throw partway leaves an orphan transcript and orphan tags with no video. **Ten partial failures from a bulk ingest are ten orphans to clean by hand.** The client pipeline's four-call sequence cannot be transactional across REST, which `05` grades "not handled".
- **Recommendation:** wrap `add-video.ts:93-144` in `strapi.db.transaction` and re-check the dedupe inside it. For the client pipeline, the honest fix is a compensating repair pass (the same mechanism finding 18 needs), not a transaction.

### 17. SQLite is the bulk bottleneck, and neither document says so
- **Lens:** `egm:egm-design`
- **Scope:** `server/config/database.ts:46-51, 58`
- **Finding:** the sqlite connection sets only `filename` and `useNullAsDefault` — no pool, no `busy_timeout` — with a 60 s `acquireConnectionTimeout`. Ten concurrent jobs each rewriting 400 KB–4 MB JSON columns, while `/feed` and `RelatedVideos` read the whole library through the same single writer, serialises on one connection. The visible failure is a 60 s "Timeout acquiring a connection" or `SQLITE_BUSY`, mid-write.
- **Recommendation:** record the concurrency ceiling SQLite imposes in `04` Decision 2 as a constraint on goal 3 (and the Postgres trigger point), set a `busy_timeout`, and keep bulk write concurrency at 1–2.

### 18. No video delete, and no way to repair a wrong `summaryStatus`
- **Lenses:** `egm:egm-design`, code-auditor
- **Scope:** `server/src/index.ts:105-132` (no `api::video.video.delete`); no delete tool in `server/src/mcp-official/tools.ts`
- **Finding:** a mistaken bulk add of 10 videos can only be undone row-by-row in the admin panel. The four rows stuck in `pending` — which have content — cannot be repaired from the UI or over MCP. Both are prerequisites for shipping bulk ingest, and `05` §7 names only half of it.
- **Recommendation:** a `removeVideo` path (UI confirm + MCP write tool, cascading the transcript) and a `repairVideoStatus` action that flips rows whose content and status disagree.

### 19. No failure visibility, which becomes the primary UX under bulk
- **Lenses:** `egm:egm-design`, code-auditor, zoom-out
- **Finding:** no alerting, no status page, no log aggregation; `strapiFetch` logs to a console nobody watches; nothing shows a row stuck in `pending`. With 10 jobs running, some failing silently, this *is* the interface.
- **Recommendation:** one library-health view exposed twice — a `/settings` panel and a read-tier MCP tool — listing counts and ids for stuck-pending, failed, missing/stale embedding, missing/stale index, and summaries with no score. It doubles as the bulk progress report and as goal 2's "how does the agent know what to fix".

### 20. Externally sourced strings use `string` with `maxLength` above the physical column
- **Lenses:** code-auditor (Major), `egm:egm-design` (Nit)
- **Scope:** `server/src/api/video/content-types/video/schema.json:31-38, 96-99` · `server/src/api/digest/.../schema.json:15-21` · `server/node_modules/@strapi/database/dist/schema/schema.js:144-149`
- **Finding:** two problems. `videoTitle` and `videoAuthor` come from YouTube's oEmbed and `youtubei.js`, so §3 wants `text`, not `string` (`url` and `videoThumbnailUrl` in the same schema already get this right). And the declared `maxLength` values — 300, 200, 280, 500 — sit **above the 255-char column `string` actually maps to**, because `maxLength` is not forwarded to knex. SQLite ignores varchar lengths, which is why the live library has not noticed; on Postgres a 260-char title becomes an ingest failure with a raw driver error, and the row is marked `failed` for a reason nobody can read.
- **Recommendation:** make `videoTitle`, `videoAuthor`, `verdictSummary` `text` keeping the validators; drop `videoSetKey` to 255 or `text`.

### 21. Unbounded transcript in the chat-to-note prompt
- **Lenses:** frontend-auditor, code-auditor, zoom-out
- **Scope:** `client/src/lib/services/notes.ts:184-193`, used at `:255, :271-273`
- **Finding:** `loadTranscriptText` applies no cap. A three-hour video is 200k+ characters, well past any local context window, so Ollama silently truncates — and the prompt's own "the transcript wins" instruction quietly stops holding — or the call runs for minutes with no timeout. The sibling route caps at 18 000 chars; this path is the outlier.
- **Recommendation:** share one exported constant between the two paths.

### 22. No server test suite, `strict: false`, and no test mode for three outside services
- **Lenses:** `egm:egm-design`, frontend-auditor, zoom-out
- **Finding:** the server holds 22 MCP tools, the Document Service middleware, the permission registration whose misordering already destroyed every token's grants, and second copies of BM25 and embedding code — gated only by `tsc --noEmit` under `strict: false`, with `verify:mcp` not in CI. YouTube/`youtubei.js`, oEmbed and DuckDuckGo have no mock, stub or base-URL seam, so no test can exercise the share path offline. **Every change for goals 2 and 3 lands in exactly this untested half.**
- **The pattern to copy is in-repo:** `fetchGeneratedVideos({ baseUrl, fetchImpl = fetch })` (`site/src/lib/strapi.ts:54-57`) is why `site/src/lib/strapi.test.ts` covers all six refuse-to-build branches.
- **Recommendation:** a server vitest suite in CI covering each tool's schema and output contract, the `sideEffects` tiering, and the create middleware; thread `fetchImpl` through the three services; turn on `strict` for `server/`.

### 23. Four zero-argument POST endpoints rewrite the whole library
- **Lenses:** `egm:egm-design` (Blocker), zoom-out (Major, graded down), frontend-auditor (Nit, risk accepted)
- **Scope:** `client/src/data/server-functions/videos.ts:777, 1447, 1693, 1794`
- **Finding:** zero-argument `createServerFn({method:'POST'})` RPC endpoints that page the whole library and write per row, acting with `STRAPI_API_TOKEN` for anyone who reaches port 3005, with no `inputValidator` and no caller check. §9 normally rates an API-token write without a prior check a Blocker; the mitigating facts are that there is no user to check, the Public role grants the same writes anonymously anyway, and the dev server binds localhost. **Lenses disagreed on severity** — recorded at Major so the owner accepts it explicitly rather than by omission. It grows with goal 3: bulk endpoints will be the most destructive handlers in the product.
- **Recommendation:** record the localhost binding in `05` §10 as the access control it actually is, and give the three score backfills one `{ what: 'value' | 'signal' | 'final' }` input (finding 9 already collapses their bodies). Gate behind a shared secret only if anything ever faces a network.

### 24. Node floor is below Strapi 5.52.1's documented minimum
- **Lens:** fact-checker
- **Scope:** `server/package.json:37-40`
- **Finding:** `>=20.0.0 <=24.x.x` is declared, but Strapi's requirements table gives **minimum 22.x, recommended 24.x for 5.48.1 and up**. So the declaration permits a Node version Strapi no longer supports. CI's Node 22 is inside the range; a local Node 20 would not be.
- **Recommendation:** raise the floor to 22 and note it in both documents.

---

## 🟢 Nits

**25.** `server/src/index.ts:97-99` says "Delete stays admin-only" and `:125`/`:132` grant `note.delete` and `digest.delete`. Fix the comment to name the exceptions and why. *(all five lenses)*

**26.** `server/src/mcp-official/permissions.ts:37-45` still lists `generateDigest` under maintenance after `tools.ts:57-61` re-tiered it. A reader deciding what a browse token reaches gets the wrong answer. *(three lenses)*

**27.** Delete `server/scripts/seed.mjs` (hits `/api/auth/local/register`, three hardcoded passwords, entities from another product, defaults to the live instance) and `client/src/lib/validations/post.ts:112-131`. They are the only code implying a sign-in exists. *(all five lenses — unanimous)*

**28.** Delete `server/src/extensions/users-permissions/content-types/user/schema.json`. It reproduces the stock schema verbatim, and the extension loader *replaces* `attributes` wholesale, so any attribute a future Strapi adds to the base user type is silently dropped on upgrade. Nothing reads or writes the type.

**29.** No `og:`/`twitter:`/canonical tags on any site page (`site/src/layouts/BaseLayout.astro:19-22`). 03 does not ask for search traffic, but it *does* require that pasted links keep resolving — and a pasted `/v/<id>` renders as a bare URL everywhere. `displayTitle`, the summary description and `videoThumbnailUrl` are all already on hand. Four lines. *(four lenses)*

**30.** `site/src/pages/index.astro:11-15` links only 16 of 191 video pages (recent 8 + top 8); the rest are reachable only via in-page search or a tag page. `search-index.json` also grows unboundedly with no size guard.

**31.** Per-query diagnostic logging ships in the hot path: the top 10 from each retriever on every `/search` (`client/src/data/server-functions/videos.ts:1276-1297`), and every poll tick of `getGenerationProgress` (`:394-397`) at 3 s intervals per pending video. If a log is the only monitoring, it should be finding 19's stuck-row line, not an RRF dump.

**32.** `STRAPI_API_TOKEN` is optional and its absence is never reported (`client/src/lib/env.ts:27, 91-104`). A missing token silently downgrades the app from "acts with a token" to "acts anonymously as the Public role" — which works, because of the 21 grants, which is why those grants can never be tightened. Add it to `validateOnce` naming the consequence.

**33.** Three model variables (`OLLAMA_MODEL` → `OLLAMA_CHAT_MODEL` → `OLLAMA_SYNTHESIS_MODEL`) all resolve to `gemma4-kb:latest` in practice, and the third is not declared in `.env.example`. Speculative configuration for a single-user app. Either declare it or drop it.

**34.** `server/src/mcp-official/index.ts:29` uses `strapi.ai?.mcp`; an upgrade that moves that namespace produces a boot logging "MCP server disabled" indistinguishably from `MCP_ENABLED=false`. Warn when `MCP_ENABLED` is true but the namespace is absent.

**35.** Stated MCP floor is "5.47+" (`server/config/server.ts:12`, `04` Decision 8) — the official docs say 5.47.0, the standard says 5.49. Installed 5.52.1, so no live risk. The fact-checker adds a forward note: **from Strapi 5.53.0 the built-in MCP server moves to MCP SDK v2** (JSON Schema 2020-12 instead of draft-07), and the installed tree is on `@modelcontextprotocol/sdk@1.30.0` — so the 20 hand-written tools meet that change on the next minor upgrade.

---

## Dependency findings (fact-checker), beyond Blocker 2

**Open, no fix published.** Three CVEs dated 2026-10-27 list Strapi up to 5.51.0 as affected and name **no fixed version**: CVE-2026-118172 (SSRF in the Webhook Dispatcher) and CVE-2026-118170 / CVE-2026-118171 (Missing Authorization, High). Installed 5.52.1 is newer than 5.51.0 but the reviewer could not confirm it is patched, and these do not yet appear in Strapi's own advisory list. Since 118172 is webhook SSRF, whether any webhook is configured is worth recording — currently unknown.

**Cleared** (verified patched below 5.52.1): the 2026-05-13 cluster — GHSA-rjg2-95x7-8qmx (relational-filter data leak, critical, 5.37.0), GHSA-3xcq-8mjw-h6mx (Content-Type Builder SQL injection, critical, 5.33.2), GHSA-pcw7-5633-82vv (upload MIME bypass, 5.33.2), CVE-2026-90561 (Content Manager stored XSS, 5.48.1). Astro 6.4.8 is above every 2026 Astro 6.x advisory found. React 19.2.5 is unaffected by CVE-2026-23870 (which hits `react-server-dom-*`, none installed).

**Low-risk staleness.** `better-sqlite3` 12.8.0 bundles SQLite 3.51.3; CVE-2026-11822 (FTS5 heap overflow) is fixed in 3.53.2, shipped in `better-sqlite3` 12.11.1. Nothing here uses FTS5 and the database is never handed an untrusted file. `js-yaml` resolves to 4.1.1 (client) and 4.3.1 (server), both below the 4.3.2 fix for CVE-2026-84375; build tooling only, parsing repo-local YAML.

**Partially unverified.** The TanStack npm supply-chain compromise (CVE-2026-45321, 84 malicious versions across 42 packages) showed no hit on the three ranges the reviewer could check (`router-core`, `history`, `router-utils` all installed above the malicious windows), but it could not read the full package list — treat as partially cleared, not clear.

**`04` Decision 10's caret exceptions, re-checked.** Three of four sit on their current release (`class-variance-authority` 0.7.1, `next-themes` 0.4.6, `tiptap-markdown` 0.9.0). `@tailwindcss/typography` resolves to 0.5.19 against a current 0.5.20 — a patch *inside* its caret, so ordinary lockfile staleness, not the ADR's "dead minor line" failure; `site/package.json` already pins 0.5.20 exactly, so the two packages disagree about the same plugin. The genuine instance of the ADR's concern is `tiptap-markdown`: the caret is fine but **upstream is frozen** — the maintainer states no v1 and no further fixes, and Tiptap now ships its own `@tiptap/markdown`.

---

## Corrections to `04`/`05` from this checkpoint

Per existing-app mode, PROPOSE FIX here means "change the app" — `04` and `05` stay as-built until E9. These are the places the reviewers found the documents themselves wrong or incomplete, to apply at E9:

1. `05` §3's "Session" should say **nothing in this app consumes `strapi::session`** — the fact-checker verified that `@strapi/admin` has zero `ctx.session` hits and uses its own `ctx.state.session`; the only installed consumer is the Users & Permissions OAuth flow, and no provider is configured. My "used by the admin panel" was wrong.
2. `05` §4's SSR locator is wrong: `ssr` is a **per-route** option and the global default is `defaultSsr` on `createStart` — neither lives in `vite.config.ts`. The conclusion (default SSR; loaders also run in the browser on client navigation) is confirmed correct.
3. `05` §10's CORS paragraph should name GHSA-9329-mxxw-qwf8 and add the one omitted detail: with **no** `Origin` header at all, `matchOrigin` returns a literal `'*'`.
4. `05` §1 should be a per-type field table with Strapi types, validations and relation cardinalities (§3), plus "who authors it" per type and one line on why `richtext` over `blocks`.
5. `05` §6's service table needs a **Required?** column (§1).
6. `05` §3 should state "Authenticated role: no grants, unused" so a reader doesn't read its absence as a gap.
7. Both documents should record the Node floor against Strapi's own minimum (finding 24).

## To confirm — unchanged from R, plus one

The R list stands. One addition: **is any Strapi webhook configured?** It bears on the open CVE-2026-118172 (webhook SSRF) and neither document records it.
