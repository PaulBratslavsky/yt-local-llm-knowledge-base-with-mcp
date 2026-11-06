# Checkpoint C — Change readiness

- **Targets:** `06-change-spec.md` (milestones M1–M11)
- **Date:** 2026-10-31 · **EGM:** v0.1.0 (plugin `strapi-product-egm` 0.3.0)
- **Reviewers (dispatch option 1, in parallel):** `egm:egm-implementation-readiness` · `egm:egm-codebase-details` · `strapi-product-egm:strapi-fact-checker`
- **Standard:** `reviews/standards/strapi-change-spec-standard.md`
- **Totals after merge:** 🔴 8 · 🟡 21 · 🟢 18
- **Verdict: not implementation-ready.** Two of three reviewers said so explicitly.

Unlike greenfield C, these reviewers had the codebase — the agent that
implements will too. Findings marked **✅ verified** were re-checked against
the code by the main agent. **Convergence is noted**: four Blockers were found
independently by two or three reviewers, which is the strongest signal in this
report.

The spec's line citations held up well (one reviewer checked ~60 and listed
them as exact, with six off-by-one drifts). The failures are concentrated in
four places: field lists that starve a working surface, three "stop and ask"
guards that were **guaranteed** to fire — meaning a decision was deferred, not
made — verification steps that cannot run, and a completion path that destroys
the data it was meant to protect.

## 🔴 Blockers

### C-1. `/api/ask` would go silently dead — PROPOSE FIX, applied
**Lenses:** implementation-readiness, codebase-details (**two**) · ✅ verified
M3 Edit 6 lists `client/src/lib/services/ask-library.ts:62` among the callers
that leave `includePassages` off, but `retrievePassagesForQuery` calls
`flattenPassages(all)` at `:68`, which reads `video.passageEmbeddings`
(`retrieval.ts:214-217`). With `CORPUS_FIELDS` excluding it,
`flat.length === 0` → `[]` → `/api/ask` and the `search_library` tool answer
"nothing in your library covers that". The comment directly above that call
exists to prevent exactly this outcome by another route. **There are four
passage callers, not three.** Also: the spec says "the eight call sites listed"
and lists ten; ten is correct.

### C-2. `createdAt` omitted; every feed card renders "NaNy ago" — PROPOSE FIX, applied
**Lenses:** implementation-readiness, codebase-details (**two**) · ✅ verified
`VideoCard.tsx:266` renders `Added {relativeTime(video.createdAt)}`;
`relativeTime` does `new Date(iso).getTime()`, and with `createdAt` undefined
every branch is false and it falls through to `NaNy ago`. Strapi omits
timestamps when `fields` is set — corroborated inside this repo, where
`server/src/mcp/tools/list-videos.ts:43-55` lists `'createdAt'` explicitly to
get it. `StrapiVideo.createdAt` is typed non-optional, so `tsc` stays green,
and the spec's own caller grep only searched the four heavy fields. Affects
`/feed` and the semantic feed.

### C-3. Create returns 201, not 200 — PROPOSE FIX, applied
**Lenses:** fact-checker, codebase-details (**two**) · ✅ verified
`@strapi/core/dist/core-api/controller/collection-type.js:50` sets
`ctx.status = 201`, and the tag controller is a bare factory. So M1's gate
("Expect 200") could not pass, and the claim that the tag smoke test "passes
unchanged — do not weaken it" was false.
**Found while verifying:** the *video*-create smoke test passes **vacuously**.
It branches on `if (res.status === 400)` and asserts `toBe(200)` only in the
`else`; `test-smoke-001` exists, so the dedupe throws 400, the first branch
runs, and the wrong assertion is never evaluated.

### C-4. `stripVideoForClient` is the detail path; the `readableArticle` guard was certain to fire — ESCALATE → decided below
**Lenses:** implementation-readiness, codebase-details (**two**) · ✅ verified
The helper is applied at `videos.ts:485` and `:502` — the two `*WithStatus`
loaders the learn and video routes use — and `ReadablePane.tsx:16,100` renders
`video.readableArticle`. The spec's "if the detail lookup strips it… stop and
ask" was not a contingency but the certain outcome, i.e. an unmade decision
inside a milestone (standard §1).
Two mitigating facts to fold in: `reader.ts:392` uses the **non**-stripping
fetcher, so the article cache check is safe; and no `*WithStatus` consumer
reads `passageEmbeddings`, so that column is safe to null everywhere.

### C-5. M6's grounding helper does not exist, and the deeper gap is a missing chunker — ESCALATE
**Lenses:** implementation-readiness, codebase-details (**two**) · ✅ verified
`server/src/services/bm25-search.ts` is 34 lines: re-exports of `bm25-core`
plus `formatTimecode`. There is no "best matching segment start" helper, so
the spec's own stop-and-ask fires. **The gap the spec did not anticipate:**
the server's `bm25-core` has `buildBM25Index` but **no chunker** —
`chunkForRetrieval` lives only in `client/src/lib/services/transcript.ts:277`
and is not in the synced copy. So "build an index from `rawSegments`" needs a
third copy of the chunker: the exact duplication this round is about.
**And the consequence that undermines the milestone:** `save-summary.ts`'s own
header says it never builds `transcriptSegments`, and `addVideo` does not
either — so for a purely MCP-authored row there is **no stored index**, and
sections would *always* land with no `timeSec`. M6 as scoped achieves nothing
for the actual MCP flow.

### C-6. M6's recommended completion path destroys the summary it just saved — ESCALATE
**Lens:** codebase-details · ✅ verified
M6 Edit 2's `note:` tells the agent to "trigger it with the generation
endpoint or open `/learn/<youtubeVideoId>`". The `/learn` loader
(`learn.$videoId.tsx:95-107`) auto-calls `triggerSummaryGeneration` for **any**
row that is not `generated` or `failed`. M6 deliberately leaves the row
non-`generated`. So **merely viewing the page runs the local Ollama pipeline,
which writes every summary field and overwrites the frontier model's output.**
The spec's own remedy destroys what the milestone exists to protect.
The existing `regenerateVideoSignals` and `regenerateVideoEmbedding` server
functions complete scores and the embedding **without touching summary text**
— that is the correct completion path.

### C-7. No tokened verification step can run on a scratch database — PROPOSE FIX, applied
**Lens:** implementation-readiness · ✅ verified
Strapi API tokens are hashed rows in the database, not `.env` values, so
`client/.env`'s `STRAPI_API_TOKEN` is valid only against the owner's live
`data.db`. I inspected `server/seed-data/seed.tar.gz`: it carries
`admin::session` rows but **no `admin::api-token` entities at all**. Every
"tokened write returns 201" check in M2, M5, M7 and M8 would return **401**
against scratch, indistinguishable from a real defect (standard §7: "an agent
can run every check", "every expected result can actually happen").
A scripted token-creation step is required.

### C-8. `yarn --cwd server test` cannot run — PROPOSE FIX, applied
**Lens:** implementation-readiness · ✅ verified
`server/package.json` has no `test` script and no `vitest` devDependency. M9's
Files list names `server/vitest.config.ts`, the CI workflow and the root
`package.json`, but never `server/package.json`. M9 verification step 1 and CI
Edit 3 both fail at the first command.

## 🟡 Majors (condensed; all applied unless marked)

**C-9. M7's five per-id statuses are unreturnable** (implementation-readiness,
codebase-details — **two**). `TriggerResult` is `found | started | error`; the
handler swallows `already_running` into `started` and maps `recently_failed`
to `error`. `EnsureResult`'s richer vocabulary never escapes. ESCALATE →
decided below.

**C-10. M3 Edit 5 is unactionable for two of three targets** (both code
reviewers). `relatedVideos` returns `RelatedVideo` and `searchLibraryPassages`
returns `LibraryPassageHit` — both already 5-scalar projections, so
`stripVideoForClient` is type-invalid there. Only `semanticSearchVideos`
returns whole rows, and the spec's instruction for *that* one is correct.

**C-11. M3 Edit 7's poll rework needs a state-machine change** (both). The
poll is `router.invalidate()`, and the loader also calls
`triggerSummaryGeneration` (the nudge) and `getGenerationProgress` (what the
pending UI renders) every tick. Swapping the query is not possible.
**Re-scoped** to the one-line version: the loader uses `pollQuery` on the
pending branch and `detailQuery` on the generated branch. No state-machine
effect.

**C-12. M5's options object does not compile** (codebase-details).
`StrapiQuery.fields?: string[]` and `populate?: '*' | string[] | {…}`;
`readonly string[]` (what `as const` produces) is not assignable. Spread at
the call site.

**C-13. `advancing: true` cannot terminate** (both). `backfillSignalScores`
skips rows with no `transcript.rawText` and writes nothing, so those rows keep
matching the filter: page 1 stays non-empty, the loop burns all 200
iterations, and by the spec's own rule returns `error` → `'partial'` on every
otherwise-complete run. Needs a third termination condition.

**C-14. M5's unified backfill is underspecified in five ways**
(both): no name; `'signal'` needs `populate: { transcript: true }` not
`fields`; `'final'` needs its own list; the proposed result type drops
`skipped`, which `BackfillSignalScoresResult` carries and the panel renders;
and the "fourth walk" is never named — it is `listRegenerableVideos:1558`.

**C-15. `backfillValueScores` has no caller anywhere** (both, verified by
grep). So defect 2 — the discarded 60/40 blend — **is unreachable in
production today**, which changes its severity, and M5's verification "run
each backfill on `/settings`" cannot run the `'value'` variant.
ESCALATE → decided below.

**C-16. M5's caller list is wrong in both directions** (both).
`EmbeddingCoveragePanel` imports **none** of the backfills or counters;
`ContentSignalsPanel` imports four by name; and
`ContentSignalsPanel.cancel.test.tsx:12-15` mocks all four and breaks on the
collapse.

**C-17. M6 ↔ M8 contradict each other** (implementation-readiness). M6
creates rows that are `pending` with an overview; M8 defines `stuckPending` as
exactly that shape and "repair all" flips them to `generated` — publishing the
scoreless rows M6 exists to withhold.

**C-18. M8's "counts and ids" cannot come by reuse** (codebase-details).
`EmbeddingCoverage` and `IndexCoverage` are counts-only, and
`getIndexCoverage` discards the rows it walks. "Reuse them — do not
reimplement" conflicts with requiring ids.

**C-19. M7's semaphore placement is ambiguous and one reading hangs the
request** (both). "Acquired after the slot is reserved" reads as inside
`ensureGenerationRunning`, which would block `POST /api/generate` for the
duration of a queued job. Correct placement: inside `runInBackground`,
immediately before `await run()`, released in the existing `finally`.
Also undefined: `getLiveState` reports `running` with `step: null` for a
queued job, so queued is indistinguishable from running in the UI.

**C-20. M8's MCP health tool needs a third copy of the staleness contract**
(codebase-details). `embeddingStatus` / `videoIndexStatus` and both coverage
functions are client-side, keyed off the client's `EMBEDDING_VERSION`.

**C-21. M9's `verify:mcp` in CI fails for unconsidered reasons**
(implementation-readiness). It needs `server/dist` (a build step CI lacks) and
an `.env` with `APP_KEYS`. It also `dotenv`-loads `server/.env` and opens
**that** database, so running it "by hand" in M6 would hit the live library,
contradicting the spec's own scratch rule. And it does not exercise
`saveSummary` at all, so M6's verification step 2 proves nothing.

**C-22. Ordering: both defences against bulk writes land after the bulk path**
(implementation-readiness). M9's transaction and contention edits are
justified by M7 but run two milestones later, and M7's own verification runs
3–5 concurrent generations against SQLite without them.

**C-23. `strict: true` won't cover the new tests** (both).
`server/tsconfig.json:39` excludes `**/*.test.*`, so M9's test files are never
typechecked. It also includes `./` and `./**/*.ts`, so strict lights up config
files too — which affects the "is the count large enough to stop and ask"
judgement the spec leaves open.

**C-24. M10's `digest.videoSetKey` is `unique: true`** (both). Retyping an
indexed column rebuilds the index — on SQLite, a table copy. The data-safety
note covers only the three plain `video` columns, and verification should
prove the unique constraint still rejects a duplicate.

**C-25. M4 misses a hangable server-side fetch**
(implementation-readiness). `server/src/services/youtube-transcript.ts:244`
(`fetchYouTubeMeta`, the Strapi-side oEmbed copy used by `addVideo`) has no
signal and is not among the six files.

**C-26 … C-29.** M2's smoke-test rewrite needs the scratch token from C-7;
M8's stuck-row assertions are live-only facts (the archive has **3** of that
shape and 107 videos, against 191 live — ✅ verified by inspecting the
archive); M3's `/feed` byte baseline is likewise live-only; M15's bulk-share
contract left the single-vs-array return to the implementer and omitted
`client/src/lib/validations/post.ts` (`ShareVideoFormSchema`) and the
post-share navigation.

## 🟢 Nits (applied)

Six off-by-one line drifts (corpus strip `:357-360`, bootstrap loop
`:145-159`, corpus call sites `:903/:1008/:1262/:1376`, `web-search.ts:52`,
the MCP comment at `server/config/server.ts:13`, tag smoke test `:87-99`);
tool count 22 not 20 in M11; `incomplete:` omits `valueScore`;
`DEBUG_RETRIEVAL` also needs `relatedVideos:925-945` and
`semanticSearchVideos:1023-1039`; `post.ts:112-131` holds **three** exports
plus a section header; M1 and M11 both delete the same `CLAUDE.md` gotcha;
M1's Files list contradicts its own Callers note; M8's Files list contains a
"— **no**; see below" line that should just be deleted; `LIST_FIELDS`' comment
claims coverage it deliberately excludes; M10 Edit 2 never names the constant
(`MAX_TRANSCRIPT_CHARS`) or its home; `repairVideoStatus` could flip a
genuinely in-flight row to `failed` (gate on `getLiveState`); the delete
cascade **is** determinate from the schema (`video.transcript` is a
unidirectional `oneToOne`, no cascade) so the two-step delete is right and the
spec should say so rather than making the agent judge; engines `>=22.0.0`
should be conditioned on the E8 baseline, and raised to `<=26.x.x` with
`@types/node` to `^22`; plus `client/package.json:74-79` has a stray `"pnpm"`
block to delete alongside `pnpm-lock.yaml`.

### C-N6. M1 does not fix every tag — accepted limitation, stated
**Lens:** codebase-details · ✅ verified
`slug` is a `uid` (unique) and `slugifyTagName` is lossy: `node.js` and
`node js` both produce `node-js`; `c`, `c#` and `c++` all collapse to `c`. For
a name whose slug collides with an existing one, `POST /api/tags` still 400s
and `createTagService` still swallows it — **so B-3 stays open for that input
class.** M1 now states this and adds a de-duplicating suffix.

## What all three reviewers verified as correct

Recorded so a later pass does not re-litigate it. All four claimed bugs in M5
are real exactly as described. M3's headline trap is correctly diagnosed:
`listAllVideosForEmbeddingService` really does strip the corpus, and
`rankVideosByQuery` / `rankRelatedVideos` really do read `v.summaryEmbedding`,
so widening the helper without separating the two concerns would zero every
cosine score. `CORPUS_FIELDS` covers every field the four consumers read apart
from `createdAt`. **M1's mechanism is sound** — a Document Service middleware
mutating `params.data` runs before `entries.create` validation in 5.52.1, and
there is no uid auto-generation anywhere in the installed document service, so
filling `data.slug` in the middleware is the right fix. M2's revocation loop
matches existing `strapi.db.query` usage and its `api::` scoping is the right
fence. `runCancellableBatch`, `ensureGenerationRunning`'s atomic check-and-add
and `runInBackground`'s `finally` are all as the spec describes.
`site/src/lib/strapi.ts` reads with no auth header, so M2's "site unaffected"
and M6's "a non-generated row won't appear in `site:build`" both hold. And the
Public role really does hold `note.delete` / `digest.delete`, so M2's "the
comment was already false" is right.
