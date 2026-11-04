# Change Spec — yt-knowledge-base

> Written 2026-10-31 against `8ac5ae3`, plus the two fixes already landed on
> branch `egm/security-hotfix` (`23d5943`, `c4722eb`). Reviewed at EGM
> checkpoint C before implementation.

## How to use this spec

**Deviation protocol.** If the code makes a step wrong or impossible, **stop
and ask**. Do not improvise an alternative. A step whose paths or symbols
don't match the code is a defect in this spec, not a puzzle to solve.

**Docs lookup.** Strapi: the `strapi-docs` MCP server, or
https://docs.strapi.io. TanStack Start and Router:
https://tanstack.com/start/latest and https://tanstack.com/router/latest.
Astro: https://docs.astro.build.

**Safety.**
- Work on a branch. **Never push.**
- Never point anything at production data or credentials.
- Every verification step that writes runs against a **scratch database**:
  `DATABASE_CLIENT=sqlite DATABASE_FILENAME=.tmp/scratch.db`, set on the
  command line of every command that loads env files (install, build, start,
  seed, import) — Strapi reads its own `.env`, so omitting a variable does
  not unset it.
- Fill the scratch database with `yarn --cwd server strapi import --file
  ./seed-data/seed.tar.gz --force`, with the scratch variables set. **Strapi
  must be stopped for an import** — SQLite needs exclusive write access.
- The owner's live database is `server/.tmp/data.db`. Nothing in this spec
  writes to it.

**Environment.** This spec was written before anything ran, so runtime
versions are **to be confirmed in the E8 baseline** and recorded in
`reviews/E8-implementation-log.md`. `server/package.json` declares
`"node": ">=20.0.0 <=24.x.x"`; that is a declaration, not tested support.
Strapi's own requirements table gives Node 22 as the minimum for 5.48.1+
(finding B-24), so use the Node the owner already has and record it.

**Preconditions the owner must confirm before M2.** Blocking:

1. **`STRAPI_API_TOKEN` is set and non-empty in `client/.env`.** M2 removes
   the Public role's write grants, after which every write depends on that
   token. The agent must not read `.env`; the owner runs this themselves and
   reports the result:
   ```bash
   grep -c '^STRAPI_API_TOKEN=.\+' client/.env
   ```
   `1` means set. `0` means **stop** — M2 would break every write in the app.
   If it is `0`, the owner creates a full-access API token in the Strapi
   admin panel (Settings → API Tokens) and adds it before M2 runs.
2. **`HOST` in `server/.env`.** The already-landed `c4722eb` changed the
   *default* to `127.0.0.1`, but the live instance still binds `*:1340`,
   which means `server/.env` sets `HOST` explicitly. The owner edits that one
   line to `HOST=127.0.0.1` (or confirms they want the LAN bind, in which
   case M2 is load-bearing rather than defence-in-depth).

---

## Scope

### Goals

Each traces to an owner change goal from `03-requirements.md` and/or an
accepted finding ID from `reviews/B-design-review.md`.

| # | Goal | Traces to |
|---|---|---|
| G1 | Tags typed in the app actually attach to the video | B-3 (Blocker) |
| G2 | Writes require a credential; reads stay public | B-1 (Blocker, remainder after `c4722eb`) |
| G3 | The core loop stops shipping retrieval state to the browser | B-5 (Blocker), owner goal 1 (performance) |
| G4 | MCP `saveSummary` stops trusting model timecodes and stops publishing scoreless rows | B-4 (Blocker), ADR-0004, ADR-0005 |
| G5 | No server-side request can hang forever | B-8 (Major) |
| G6 | Library walks are correct and report failure honestly | B-6, B-7, B-9, B-23 (Majors) |
| G7 | An agent can trigger generation, and bulk ingest is bounded | B-10 (Major), owner goals 2 and 3 |
| G8 | The owner can see and repair a broken library | B-18, B-19 (Majors) |
| G9 | The duplicated embedding contract cannot drift silently | B-11 (Major) |
| G10 | Multi-row writes inside Strapi are transactional | B-16 (Major) |
| G11 | The server half is testable and type-checked strictly | B-22 (Major) |
| G12 | Schema field types survive a move to Postgres | B-20 (Major) |
| G13 | Prompt input is bounded | B-21 (Major) |
| G14 | A backend failure is never mistaken for a cache miss | B-15 (Major) |
| G15 | Tests stop writing to the live library | B-14 (Major) |
| G16 | SQLite doesn't fail opaquely under bulk | B-17 (Major) |
| G17 | Documents and comments stop contradicting the code | B-24, B-25, B-26, B-32, Nits |
| G18 | Dead and contradictory code is deleted | B-27, B-28 (Nits) |

### Non-goals — deferred findings

Recorded here so a reader knows they were considered and set aside. Not to be
implemented in this round.

- **Deleting the dense passage layer** (B-13). The owner chose to fix the
  payload now (G3) and judge deletion separately, because it changes
  `/search` result quality in ways only they can assess. **The evidence is
  preserved in B-13 for that decision.** G3 recovers the page weight either
  way.
- **Route middleware for population profiles** (B-17 in the design review,
  §6 of the standard). G3 fixes the payload at the call sites and at the
  client boundary. A `sanitize-list` route middleware would enforce it
  server-side for every caller including direct API calls; deferred as a
  structural follow-up, and noted because it would subsume part of G3.
- **Consolidating the eight other duplicated capabilities** (B-12), beyond
  the embedding drift test in G9. Includes the two user-visible divergences
  (MCP `relatedVideos` is pure cosine where the app uses RRF; MCP
  cross-video search is BM25 where `/search` is dense+BM25). Worth its own
  round.
- **`og:`/`twitter:` tags on the site** (B-29) and the 16-of-191 index page
  (B-30). Real, but no finding in this round touches `site/`, and the owner
  did not raise sharing.
- **`tiptap-markdown` is abandoned upstream**, superseded by
  `@tiptap/markdown` (B fact-check). A dependency migration, not a fix.
- **`better-sqlite3` / `js-yaml` staleness** (B fact-check Nits 6, 7). Low
  real risk; fold into the next routine dependency pass.
- **The three reported Strapi CVEs dated 2026-10-27** with no published fix
  (CVE-2026-118170/118171/118172). Nothing to apply. ⚠️ **Per third-party
  aggregators only — not in Strapi's own GitHub advisories or docs**, so
  treat this triage as unconfirmed rather than authoritative. Re-check at the
  next Strapi upgrade; `04` Decision 2 records them.
- **`passageEmbeddings` returned by `semanticSearchVideos`** is covered by
  G3; the broader question of whether MCP tools should return it at all is
  part of B-12, deferred.

---

## Milestones

Ordered: data and schema before the code that needs them, backend before the
frontend that calls it. Each milestone leaves the app bootable and is
committed on its own, with the milestone title as the commit message.

### M1 — Generate `tag.slug` server-side (G1)

**Why first:** it is a Blocker, it is three lines, and it makes an existing
failing test pass, which is the cleanest possible verification.

**Data state — checked, no backfill needed.** All 16 existing tags already
carry a slug (verified against the live library on 2026-10-31 via
`GET /api/tags?fields[0]=name&fields[1]=slug`, 16 of 16 populated). Re-check
on the scratch database before editing; if any row has an empty slug,
**stop and ask** — a backfill step would need adding.

**Files:**
- Modify: `server/src/index.ts` (the `api::tag.tag` create rule, currently
  lines 59–70)
- Modify: `server/src/mcp/tools/tag-utils.ts` (header comment only)
- Modify: `client/src/lib/services/videos.smoke.test.ts` (the tag test's
  expectation — see "callers")

**Edit 1 — `server/src/index.ts`.** The rule currently normalises the name
and sets nothing else. Add the slug. Import `slugifyTagName` at the top of
the file, beside the existing imports:

```ts
import { slugifyTagName } from './mcp/tools/tag-utils';
```

Then replace the body of Rule 2 (the `api::tag.tag` create block) so it reads:

```ts
      // Rule 2: tag.create — normalize name, and generate the slug.
      //
      // `slug` is a required `uid`, and Strapi fills uid fields only in the
      // admin panel — not through the content API or the Document Service.
      // Without this, POST /api/tags { data: { name } } is rejected 400 and
      // the client's createTagService swallows it, so a new tag typed in the
      // share form is silently dropped (review finding B-3).
      if (
        context.uid === 'api::tag.tag' &&
        context.action === 'create'
      ) {
        const data = (context.params as WithData).data ?? {};
        const raw = data.name as string | undefined;
        if (typeof raw === 'string') {
          data.name = normalizeTagName(raw);
        }
        if (!data.slug && typeof data.name === 'string') {
          data.slug = slugifyTagName(data.name);
        }
        (context.params as WithData).data = data;
      }
```

Note the order: `normalizeTagName` runs first, so the slug derives from the
normalised name and UI-created tags line up with MCP-created ones.

**Edit 2 — `server/src/mcp/tools/tag-utils.ts`.** Its header says the helper
exists because `create()` does not auto-generate uid fields "so we compute a
slug here and pass it explicitly". That is now done centrally. Replace the
header comment with one saying the canonical `name → slug` transform lives
here and is applied by the Document Service middleware in `src/index.ts` for
every create path; callers no longer need to pass `slug`. **Do not change
`slugifyTagName` itself** — its output is what the 16 existing rows already
contain.

**Callers (§4) — all of them:**
- `client/src/lib/services/videos.ts:952-957` (`createTagService`) — **no
  change needed**; it already POSTs `{ data: { name } }`, which now succeeds.
  Leave it alone.
- `server/src/mcp/tools/add-video.ts:126` and
  `server/src/mcp/tools/tags.ts:78` pass `slug:` explicitly. The new rule
  only fills an **absent** slug, so both keep working unchanged. Leave them
  for M1; removing the now-redundant arguments is a Nit folded into M11.
- `client/src/lib/services/videos.smoke.test.ts:87-98` asserts the public
  role can create a tag and currently fails with `expected 400 to be 200`.
  **Its expectation is wrong in both directions and must be corrected to
  `201`** — a correction, not a weakening, because Strapi's `create` has
  always returned 201.
- **The video-create test at `:47-73` is currently passing vacuously.** It
  branches on `if (res.status === 400)` and asserts `toBe(200)` only in the
  `else`. `test-smoke-001` already exists in the live library, so the dedupe
  middleware throws 400, the test takes the first branch, and the `200`
  assertion is never evaluated. Against a clean database it would fail.
  **Correct it to `201` here**, so M10's test-isolation work does not surface
  it as a new failure. (M2 changes this file again, for a different reason.)
- `CLAUDE.md`'s gotcha list claims this failure is "a pre-existing bug… not
  something this repo's changes caused". Delete that sentence and the
  surrounding claim in the same commit.

**Verification:**
1. `cd server && npx tsc --noEmit` → exits 0.
2. Restart Strapi against the scratch database. **Strapi 5 auto-reload does
   not reliably pick up new files** — confirm the new code is live before
   trusting a result.
3. Negative-to-positive test, the one that matters:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     http://localhost:1340/api/tags \
     -H 'Content-Type: application/json' \
     --data '{"data":{"name":"EGM Check Tag"}}'
   ```
   Expect **`201`** (was `400`). Strapi's core-api `create` sets
   `ctx.status = 201`
   (`server/node_modules/@strapi/core/dist/core-api/controller/collection-type.js:50`),
   and `server/src/api/tag/controllers/tag.ts` is a bare factory that does not
   override it. Then confirm the slug was generated, parsing JSON rather than
   grepping text:
   ```bash
   curl -s 'http://localhost:1340/api/tags?filters[name][$eq]=egm%20check%20tag&fields[0]=name&fields[1]=slug' \
     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).data?.[0];console.log(r?.name,"|",r?.slug);})'
   ```
   Expect `egm check tag | egm-check-tag`.
4. `yarn test` → the tag smoke test now passes. Record the new total.
5. **Through the frontend** (§7): with the stack up, share a video on
   `/new-post` with a tag that does not exist yet, then confirm the tag
   appears on the resulting card and that `/feed?tag=<slug>` returns it.
   This is the user-visible bug; verifying only the API would miss the
   `createTagService` → `createVideoService` path that drops the tag.

**Done when:** `POST /api/tags` with only a name returns **201** with a
generated slug; the tag smoke test passes; a new tag typed on `/new-post`
is attached to the created video and filterable on `/feed`.

**Rollback:** revert the commit. No data step to undo — the rule only fills
a field that was previously rejected, so no existing row changed.

### M2 — Public role: reads only (G2)

**Depends on M1** (so the tag path works before writes need a token) and on
**both owner preconditions above**. If precondition 1 reports `0`, stop.

**The seeding array is not enough.** `bootstrap()` seeds but never revokes
(`server/src/index.ts:146-160` skips any action whose row already exists), so
deleting entries from the array leaves the already-granted rows in the
database. This milestone needs an explicit revocation step.

**Files:**
- Modify: `server/src/index.ts` (the `actions` array and the seeding loop)
- Modify: `client/src/lib/services/videos.smoke.test.ts`
- Modify: `client/src/lib/env.ts` (startup validation)

**Edit 1 — the grant list.** Reduce the `actions` array to reads only:

```ts
    const actions = [
      'api::video.video.find',
      'api::video.video.findOne',
      'api::tag.tag.find',
      'api::tag.tag.findOne',
      'api::transcript.transcript.find',
      'api::transcript.transcript.findOne',
      'api::note.note.find',
      'api::note.note.findOne',
      'api::digest.digest.find',
      'api::digest.digest.findOne',
    ];
```

and replace the comment above it (currently "Public role gets full read +
create + update on every content type. Delete stays admin-only…", which was
already false for note and digest — finding B-25) with one stating: the
Public role is read-only; every write goes through the client's server with
`STRAPI_API_TOKEN`; the site reads at build time only.

**Edit 2 — revoke what was seeded.** After the seeding loop, delete any
Public-role permission row whose action is **not** in `actions` and whose
action belongs to this app's own APIs. Scope the delete to `api::` actions so
no plugin permission is touched:

```ts
      // bootstrap() seeds but never revokes, so narrowing `actions` above
      // would otherwise leave previously granted write rows in place
      // (review finding B-1). Remove any api:: grant this role should no
      // longer hold. Scoped to api:: so plugin permissions are untouched.
      const stale: Array<{ id: number; action: string }> = await strapi
        .db.query('plugin::users-permissions.permission')
        .findMany({ where: { role: publicRole.id } });
      let revoked = 0;
      for (const row of stale) {
        if (!row.action.startsWith('api::')) continue;
        if (actions.includes(row.action)) continue;
        await strapi
          .db.query('plugin::users-permissions.permission')
          .delete({ where: { id: row.id } });
        revoked += 1;
      }
```

Log `revoked` alongside the existing `granted` / `existing` counts.

**Edit 3 — fail loudly on a missing token.** `client/src/lib/env.ts:90-105`
warns about `OLLAMA_MODEL`, `OLLAMA_CHAT_MODEL` and `STRAPI_URL` and says
nothing about the token (finding B-32). Add `STRAPI_API_TOKEN` to
`validateOnce` with a warning that names the consequence: without it the app
acts as the Public role, which after this milestone can only read, so every
write will fail with 403. Keep it a warning, not a throw — consistent with
the existing local-first choice in that function.

**Callers (§4):**
- Every write in the client goes through `strapiFetch`
  (`client/src/lib/services/strapi-client.ts:147-152`), which attaches the
  bearer token when set. No call-site change.
- **Except one:** `client/src/lib/services/reader.ts:356-370` hand-rolls its
  own `PUT` with its own header. It reads the same `STRAPI_API_TOKEN`, so it
  keeps working — but it is the one write that would not pick up a future
  auth change. Fold its migration to `strapiFetch` into M4 (B-9 in the
  frontend audit), and leave it here.
- `client/src/lib/services/videos.smoke.test.ts` — its three write
  assertions (`:47` create a video, `:87` create a tag, and the feed-query
  test that depends on the created row) now describe a posture the app no
  longer has. **Rewrite them to assert the new contract**, which is a
  stronger test than deleting them: an anonymous `POST /api/videos` returns
  **403**, and the same `POST` with `Authorization: Bearer
  ${process.env.STRAPI_API_TOKEN}` returns **201**. Keep the existing
  auto-skip when Strapi is unreachable. If the token is absent from the
  environment, skip the positive half with a message rather than failing.
  (M7 changes this file again for isolation — G15.)
- The site reads only (`site/src/lib/strapi.ts`), at build time, with no
  credential. Unaffected — but verify, because a broken site build is a
  silent content outage.

**Verification:**
1. `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit`.
2. Boot Strapi against the **scratch** database and read the bootstrap log:
   it must report the revocation count, non-zero on the first boot.
3. **Negative test (§7 requires one):**
   ```bash
   curl -s -o /dev/null -w 'anon POST: %{http_code}\n' -X POST \
     http://localhost:1340/api/videos -H 'Content-Type: application/json' \
     --data '{"data":{"youtubeVideoId":"egmcheck001","url":"https://y.t/x","summaryStatus":"pending"}}'
   ```
   Expect `403`. Then the same request with
   `-H "Authorization: Bearer $STRAPI_API_TOKEN"` → expect **`201`** (create
   sets 201; see M1). Reads are 200, `update` is 200, `delete` is 204.
   Also confirm reads still work anonymously: `GET /api/videos` → `200`.
   And confirm the delete grants are gone:
   `curl -X DELETE .../api/notes/<id>` anonymously → `403`.
4. `yarn test` — the rewritten smoke assertions pass.
5. **Through the frontend:** share a video on `/new-post` end to end. It must
   succeed. If it 403s, `STRAPI_API_TOKEN` is not reaching the server
   function — stop and ask rather than restoring the public grants.
6. `yarn site:build` against the scratch Strapi → still produces pages.

**Done when:** anonymous writes return 403, tokened creates return 201,
anonymous reads return 200, sharing a video through the UI works, and the
site builds.

**Rollback:** revert the commit **and** re-run `bootstrap()` to re-seed the
write grants (booting the reverted code does that automatically, because the
seeding loop re-adds any missing action). Note the asymmetry: the revocation
is data, so a code revert alone restores the grants only on the next boot.

### M3 — Stop shipping retrieval state (G3)

**The one trap in this milestone, read first.** `listAllVideosForEmbeddingService`
currently maps every row through `stripVideoForClient`
(`client/src/lib/services/videos.ts:360-363`). That corpus is what the
rankers score, and **ranking needs `summaryEmbedding`**. So widening
`stripVideoForClient` to null the embedding columns *without* removing that
call from the corpus reader would silently break semantic search, Related
videos and `/search` — every cosine score would become zero, with no error.
The two concerns must be separated in the same commit:

- **`stripVideoForClient` = the browser boundary.** Nulls all four heavy
  columns. Applied only where rows actually cross to the client.
- **`listAllVideosForEmbeddingService` = a server-internal corpus.** Strips
  nothing, and instead restricts `fields` to what the consumers read.

**Baseline to beat, measured on the live app at `c4722eb`:**
`GET http://localhost:3005/feed` returned **5,484,641 bytes**, with
`passageEmbeddings` serialized nine times (once per card) as
`{model:"nomic-embed-text",version:3,chunks:[…]}` — vectors and verbatim
transcript chunk text, in the page source of a listing page. Re-measure
before and after; the number is the verification.

**Files:**
- Modify: `client/src/lib/services/videos.ts` (`feedQuery`, `detailQuery`,
  `listAllVideosForEmbeddingService`, `stripVideoForClient`, plus a new
  `pollQuery`)
- Modify: `client/src/data/server-functions/videos.ts`
  (`semanticSearchVideos`, `relatedVideos`, `searchLibraryPassages`,
  `getPassageCoverage`, `reindexAllPassages`)
- Modify: `client/src/routes/learn.$videoId.tsx` (use the light query while
  pending)

**Edit 1 — the field lists.** Add these two exported constants to
`client/src/lib/services/videos.ts`, above `feedQuery`. They are derived from
what the consumers actually read: `buildEmbeddingText`
(`client/src/lib/services/embeddings.ts:123-144`), `buildVideoSearchText`
(`client/src/lib/services/retrieval.ts:298-318`), `embeddingStatus`
(`embeddings.ts:156`), and the feed card component.

```ts
// Scalars every list surface needs: the card, the rankers' text builders,
// and the embedding staleness check. Deliberately excludes the four heavy
// JSON columns — passageEmbeddings alone averages 439KB per row and a feed
// page carried nine of them (review finding B-5).
export const LIST_FIELDS = [
  'documentId',
  'youtubeVideoId',
  'url',
  'videoTitle',
  'videoAuthor',
  'videoThumbnailUrl',
  'caption',
  'summaryStatus',
  'summaryTitle',
  'summaryDescription',
  'summaryOverview',
  'watchVerdict',
  'verdictSummary',
  'valueScore',
  'signalScore',
  'finalScore',
  'summaryGeneratedAt',
  'aiModel',
] as const;

// The corpus the rankers score. LIST_FIELDS plus the per-video vector and
// its provenance, which cosine ranking and embeddingStatus() both read.
// Still excludes passageEmbeddings, transcriptSegments and readableArticle.
export const CORPUS_FIELDS = [
  ...LIST_FIELDS,
  'summaryEmbedding',
  'embeddingModel',
  'embeddingVersion',
  'embeddingGeneratedAt',
] as const;
```

**Edit 2 — `feedQuery`.** Add `fields: [...LIST_FIELDS]` to the returned
object, keeping `populate: ['tags']` as is. Its comment already claims to
"keep the feed payload light"; it now does.

**Edit 3 — `listAllVideosForEmbeddingService`.** Two changes:
- Add `fields: [...CORPUS_FIELDS]` to the query, keeping
  `populate: ['tags', 'keyTakeaways', 'sections']`.
- **Remove the `stripVideoForClient` call** in the collection loop. Push the
  row directly. Replace the loop body with `all.push(...(result.data ?? []))`
  and add a comment: this is a server-internal corpus, stripping happens at
  the boundary where rows reach the browser, and the embedding must survive
  for ranking.
- Give it an options parameter for the passage callers:
  ```ts
  export async function listAllVideosForEmbeddingService(
    opts: { includePassages?: boolean } = {},
  ): Promise<EmbeddingCorpus> {
  ```
  and build the field list as
  `const fields = opts.includePassages ? [...CORPUS_FIELDS, 'passageEmbeddings'] : [...CORPUS_FIELDS];`
  Its header comment currently says it pulls "the fields needed… nothing
  else" while pulling everything; that sentence becomes true — leave it.

**Edit 4 — `stripVideoForClient`.** Null all four heavy columns:

```ts
export function stripVideoForClient(video: StrapiVideo | null): StrapiVideo | null {
  if (!video) return video;
  return {
    ...video,
    transcriptSegments: null,
    summaryEmbedding: null,
    passageEmbeddings: null,
    readableArticle: null,
  };
}
```

**`readableArticle` needs care:** `/learn/$videoId`'s reading mode renders
it, so the detail path must **not** use this helper for that field. Check
every caller of `stripVideoForClient` before applying, and if the detail
lookup strips `readableArticle` the reading tab breaks. If that is the case,
**stop and ask** — the two options are a separate `stripVideoForList` or a
`keepArticle` flag, and that is a design choice, not an implementation
detail.

**Edit 5 — the three server functions that return rows to the browser.**
Each now gets rows that still carry their vectors, so each must strip at its
own boundary:
- `semanticSearchVideos` (`client/src/data/server-functions/videos.ts:1041-1055`):
  replace the hand-rolled
  `{ ...candidates[index], summaryEmbedding: null, transcriptSegments: null }`
  with `stripVideoForClient(candidates[index])`. That is what the comment at
  `:1045-1048` already claims to do, and it is the line that was missing
  `passageEmbeddings`.
- `relatedVideos` (`:886`) and `searchLibraryPassages` (`:1246`): confirm each
  result row passes through `stripVideoForClient` before being returned, and
  add it where missing.

**Edit 6 — the three passage callers pass the flag.**
`searchLibraryPassages` (`:1261`), `getPassageCoverage` (`:1077`) and
`reindexAllPassages` (`:1132`) call
`listAllVideosForEmbeddingService({ includePassages: true })`. **Every other
caller leaves the argument off** — `relatedVideos` (`:902`),
`semanticSearchVideos` (`:1007`), `suggestTagsForUrl` (`:1375`),
`getEmbeddingCoverage` (`:581`), `reindexAllEmbeddings` (`:783`), and the
two in `client/src/lib/services/ask-library.ts:62` and
`client/src/lib/services/library-tools.ts:217`. Check each of the eight call
sites listed; a missed one that needs passages returns empty results.

**Edit 7 — the pending poll.** `detailQuery` populates `transcript`, so every
poll tick drags `rawText` and `rawSegments` across, every 3 s for up to 200
ticks. Add beside `detailQuery`:

```ts
// The pending poll runs every 3s for up to 200 ticks and only needs to know
// whether generation finished. detailQuery populates the transcript, so the
// poll was re-fetching rawText + rawSegments 200 times (finding B-5).
const pollQuery: StrapiQuery = {
  fields: ['documentId', 'youtubeVideoId', 'summaryStatus', 'summaryTitle'],
};
```

Expose it through a `fetchVideoStatusByVideoIdService` and a
`getVideoStatus` server function, and have `learn.$videoId.tsx`'s polling
effect call that instead of re-running the full loader. **The loader itself
keeps `detailQuery`** for the `generated` branch. If wiring the poll to a
separate server function requires changing the route's state machine beyond
swapping the query, **stop and ask**.

**Callers (§4):** every consumer of a stripped row. The risk is a component
reading a field no longer in `LIST_FIELDS`. Before committing, grep the
components and routes for each heavy field and for any scalar not in the
list:
```bash
grep -rn "passageEmbeddings\|summaryEmbedding\|readableArticle\|transcriptSegments" \
  client/src/components client/src/routes
```
At `c4722eb` this returns `summaryEmbedding` once
(`learn.$videoId.tsx:855`, a presence check behind `getEmbeddingStatus`) and
`readableArticle` in the reading tab. Replace the `summaryEmbedding` check
with the server-computed status already fetched above it.

**Verification:**
1. `cd client && npx tsc --noEmit` → exits 0.
2. `yarn test` — **`retrieval.equivalence.test.ts` and
   `embeddings.ranking.test.ts` are the guards that matter here.** The
   equivalence test exists to prove retrieval extraction is
   behaviour-preserving; if it fails, the field list is wrong. The ranking
   test needs Ollama up — **run it with Ollama running**, because with
   Ollama down it self-skips and would hide exactly the regression this
   milestone risks.
3. **The measurement, before and after:**
   ```bash
   curl -s http://localhost:3005/feed | wc -c
   curl -s http://localhost:3005/feed | grep -ac passageEmbeddings
   ```
   Note `grep -a`: the response contains non-text bytes, so without it grep
   treats the stream as binary and silently reports nothing. Expect the byte
   count to fall from ~5.48 MB to well under 1 MB, and the
   `passageEmbeddings` count to reach **0**.
4. **Through the frontend**, all three retrieval surfaces, because this
   milestone can break them silently rather than loudly:
   - `/feed` renders nine cards with scores and verdicts.
   - `/feed?mode=semantic&q=<a query you know matches>` returns sensible,
     ordered results — **compare the top three against the same query before
     the change**. All-zero cosine scores means the embedding was stripped
     from the corpus.
   - `/learn/<id>` → Related videos is non-empty.
   - `/search?q=<query>` returns passage hits with timecodes.
   - `/learn/<id>` reading tab still renders the article.
   - `/new-post`: paste a URL, confirm tag suggestions still appear.
5. Core-loop page states (§7): while `/feed` loads, with an empty library,
   and with Strapi down — the existing `BackendErrorPanel` and empty states
   must still render. Stop Strapi and reload `/feed` to confirm.

**Done when:** `/feed` is under 1 MB with zero `passageEmbeddings`
occurrences, the equivalence and ranking tests pass with Ollama up, and all
five surfaces above behave as before.

**Rollback:** revert the commit. No data changed.

### M4 — Timeouts on every server-side call (G5)

**Files:**
- Modify: `client/src/lib/services/strapi-client.ts` (~`:176`)
- Modify: `client/src/lib/services/embeddings.ts` (`:70`)
- Modify: `client/src/lib/services/learning.ts` (`:209`, oEmbed)
- Modify: `client/src/lib/services/web-search.ts` (`:51`)
- Modify: `server/src/mcp/utils/embeddings.ts` (`:50`)
- Modify: `client/src/lib/services/reader.ts` (`:356-370`) — fold in finding
  B-9: replace the hand-rolled `PUT` with `strapiFetch`, which then inherits
  the timeout and the error shape. This is the one Strapi write that bypasses
  the wrapper.

**Edit.** Add `signal: AbortSignal.timeout(ms)` to each `fetch`. Budgets,
stated so the implementer does not choose:

| Call | Budget | Why |
|---|---|---|
| Strapi (`strapi-client.ts`) | 15_000 | Local SQLite; a 15 s read is already pathological |
| Ollama embeddings (both copies) | 120_000 | A cold model load is legitimately slow |
| YouTube oEmbed | 10_000 | Already degrades to `{}` on failure |
| DuckDuckGo | 10_000 | Already degrades to `[]` |

The Ollama **chat** paths go through `@tanstack/ai`'s `chat()` rather than a
bare `fetch`, and **it does take an abort handle** — `abortController` on the
options object (`client/node_modules/@tanstack/ai/dist/esm/activities/chat/index.d.ts:111`),
documented with a `setTimeout(() => abortController.abort(), …)` example at
`types.d.ts:806-807`, and consumed by the activity at
`activities/chat/index.js:199-200`. Pass one, with `abort()` scheduled on the
Ollama budget (120_000).

**State the limit honestly in the implementation log:**
`@tanstack/ai-ollama`'s text adapter never references the signal — `grep abort`
over `client/node_modules/@tanstack/ai-ollama/dist/esm/adapters/text.js`
returns nothing, and its options expose only `model` and `host`. So the abort
ends the activity and the agent loop, but does **not** cancel the in-flight
HTTP request to Ollama. That still converts an unbounded hang into a bounded
failure, which is what G5 asks for; it does not free the Ollama worker.

**The error classifier needs a precedence fix, not new patterns.** Node's
`AbortSignal.timeout` rejects with a `TimeoutError` `DOMException` whose
message is "The operation was aborted due to timeout", which already matches
`/timeout/i`, the first entry of `TIMEOUT_PATTERNS`
(`client/src/lib/services/ollama-errors.ts:30`). The problem is order:
`friendlyOllamaError` tests `HOST_PATTERNS` **first** (`:36-38`), and that
list contains `/fetch failed/i` and `/11434/` (`:13-21`). So any timeout
whose message got wrapped as "fetch failed" — which undici commonly does —
or that carries the Ollama URL is reported as **"AI server unreachable. Is
Ollama running on port 11434?"**: a confident recovery hint for the wrong
cause, sending the owner to restart a service that is running fine.

Fix the precedence: detect the timeout first, ideally on the error's `name`
(`TimeoutError`) rather than its message, before the host patterns run. Add
unit tests for both shapes — the bare `DOMException` and a
`fetch failed`-wrapped message carrying `11434` — and **watch the second one
fail first**, because it is the one that is broken today.

**Verification:**
1. Typecheck both packages; `yarn test`.
2. **Negative test, scripted:** point Strapi at a port with nothing on it and
   confirm the failure is fast and classified, not a hang:
   ```bash
   STRAPI_URL=http://127.0.0.1:9 yarn --cwd client test -t "strapiFetch"
   ```
   Then add a unit test asserting a timed-out fetch produces
   `{ ok: false, status: 0 }` with a message `friendlyBackendError` maps to
   the network case. Write the test first and watch it fail.
3. For Ollama, the failure path needs no model: stop Ollama and load
   `/search`. Expect the Ollama-unreachable copy within the budget, not a
   spinner. **No production keys are involved anywhere in this milestone** —
   every dependency here is local or keyless.

**Done when:** every `fetch` in the six files carries a signal, a unit test
covers the timeout path, and `/search` with Ollama down shows the
recoverable error rather than hanging.

**Rollback:** revert the commit.

### M5 — Correct the library walks (G6)

Three defects in one family, all verified against the code: a self-advancing
pager, a field read that was never fetched, and failure reported as success.

**Defect 1 — the pager skips about half the library.** Each of
`backfillValueScores` (`:1454-1485`), `backfillSignalScores` (`:1699-1750`)
and `backfillFinalScores` (`:1799-1829`) filters on exactly the field it is
about to write (`valueScore: {$null:true}`, etc.) and then increments `page`.
After page 1 is written those rows leave the result set, so page 2 returns
what were rows 201–300; rows 101–200 are never visited. The shrinking
`pageCount` also ends the loop early.

**Defect 2 — `backfillValueScores` reads a field it did not fetch.** Its
query asks `fields: ['documentId', 'watchVerdict']` (`:1461`) and line 1472
reads `row.signalScore`, always `undefined`. `computeFinalScore`
(`client/src/lib/services/videos.ts:109-121`) treats a non-number as `null`
and returns the other component alone, so the write sets
`finalScore = valueScore`, **discarding the 60/40 blend** on any row that
already had a `signalScore`.

**Defect 3 — `break` then `status: 'ok'`.** All four walks `break` on
`!result.ok` and return success with partial counts. The three `countMissing*`
functions (`:1443`, `:1619`, `:1790`) return `{ missing: 0 }` on failure, so a
dead backend reports "nothing to do".

**Files:**
- Modify: `client/src/lib/services/videos.ts` (`forEachVideoWithIndex`)
- Modify: `client/src/data/server-functions/videos.ts` (the four walks and
  three counters)
- Modify: `client/src/components/ContentSignalsPanel.tsx` and
  `client/src/components/EmbeddingCoveragePanel.tsx` (callers of the
  collapsed functions)
- Create: `client/src/lib/services/library-walk.test.ts`

**Edit 1 — generalise the correct walker.** `forEachVideoWithIndex`
(`client/src/lib/services/videos.ts:374-399`) is already the honest shape:
page-by-page, `{ visited, error }` so a partial walk cannot read as
complete. It hardcodes `populate: ['sections']` and the `generated` filter.
Give it an options parameter, keeping today's values as defaults so existing
callers are unaffected:

```ts
export async function forEachVideoWithIndex(
  visit: (video: StrapiVideo) => Promise<void> | void,
  opts: {
    filters?: Record<string, unknown>;
    fields?: readonly string[];
    populate?: readonly string[];
    pageSize?: number;
  } = {},
): Promise<{ visited: number; error?: string }> {
```

**It must re-request page 1 when the visit mutates the filter.** Add an
`advancing: boolean` option (default `false`): when `true`, the loop requests
page 1 every iteration and stops when a page comes back empty, instead of
incrementing. Document why in a comment naming the three backfills. Cap the
iterations at the existing 200 so a visit that fails to mutate cannot spin
forever — and if the cap is hit, **return an `error`**, because that means
the walk did not finish.

**Edit 2 — collapse the three score backfills into one.** Replace them with
a single server function taking the input B-23 asks for:

```ts
const BackfillScoresSchema = z.object({
  what: z.enum(['value', 'signal', 'final']),
});
```

Its handler walks with `advancing: true`, the filter for the chosen `what`,
and a `fields` list that includes **every field the write reads** — for
`'value'` that is `['documentId', 'watchVerdict', 'signalScore']`, which is
defect 2's fix. Return `{ status: 'ok' | 'partial', updated, total, error? }`
— `'partial'` whenever the walk returned an `error`, so a half-finished run
can never read as a complete one.

**Edit 3 — the counters.** Change the three `countMissing*` to return
`{ missing: number } | { error: string }` and have the panels render the
error. Do **not** leave `{ missing: 0 }` on failure.

**Callers (§4):** `ContentSignalsPanel.tsx` and `EmbeddingCoveragePanel.tsx`
call the three backfills and the three counters. Update every call site and
every rendered state. While in `ContentSignalsPanel.tsx`, fix the
fetch-on-mount with no error path at `:61-73` (finding B-15 in the frontend
audit): wrap `refresh()` the way `handleRefresh` at `:96-98` already does.

**Verification — TDD, and the test comes first.**
1. Write `library-walk.test.ts` before the implementation. The decisive case:
   a fake Strapi whose result set **shrinks as rows are written** — seed 250
   matching rows, have `visit` remove the row from the matching set, and
   assert all 250 are visited exactly once. Against today's code this fails
   at ~125. Watch it fail, then implement.
2. Second test: a page that returns `ok: false` mid-walk produces
   `status: 'partial'` with an `error`, never `'ok'`.
3. Third test: the `'value'` backfill preserves a 60/40 blend. Seed a row
   with `signalScore: 80` and no `valueScore`, run it, assert the written
   `finalScore` is the blend of the derived value score and 80 — not the
   derived value alone. This is defect 2 and it fails today.
4. `yarn test` — whole suite green.
5. **Through the frontend:** on `/settings`, run each backfill against the
   **scratch** database seeded from the archive, and confirm the reported
   count matches the number of rows that actually changed:
   ```bash
   curl -s 'http://localhost:1340/api/videos?filters[finalScore][$null]=true&pagination[pageSize]=1&pagination[withCount]=true' \
     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).meta.pagination.total))'
   ```
   Run before and after; the delta must equal the reported `updated`.
   **Never run a backfill against `server/.tmp/data.db`.**
6. Stop Strapi mid-run (second terminal) and confirm the result is
   `'partial'` with an error, and that `/settings` shows it.

**Done when:** the shrinking-set test passes, a mid-walk failure reports
`partial`, the blend is preserved, and `/settings` reports counts that match
reality on the scratch database.

**Rollback:** revert the commit. If a backfill ran against the scratch
database, discard the scratch file. If one ran against real data by mistake,
`finalScore` is recomputable — re-run the `'final'` backfill after the
revert.

### M6 — `saveSummary` grounds its own timecodes (G4)

**Why it is a Blocker:** `server/src/mcp/tools/save-summary.ts:16-20`
declares `timeSec: z.number().int().min(0).optional()` and `:80-96` writes
`sections: args.sections` straight to the row. ADR-0004 and `CLAUDE.md` both
forbid exactly this — *"Do not add a code path that trusts a timecode the
model produced."* The server already has `bm25-core.ts` and `bm25-search.ts`.

Second half: the same write sets `summaryStatus: 'generated'` while writing
no `valueScore`, `signalScore`, `finalScore`, `summaryEmbedding` or
`transcriptSegments`. The row then publishes to the live site with a null
score, is excluded from semantic search and Related videos, and vanishes
under any `minScore` filter — none of it visible to the calling agent.

**Files:**
- Modify: `server/src/mcp/tools/save-summary.ts`
- Modify: `server/src/mcp-official/tools.ts` (only if the tier changes — see
  below)

**Edit 1 — drop the agent's timecodes and ground them.** Remove `timeSec`
from `SectionSchema` entirely, so the tool's schema no longer advertises it.
After resolving the video, load its cached `transcript.rawSegments`, build a
BM25 index with `server/src/services/bm25-core.ts`, and recover each
section's `timeSec` from `heading + body` the way
`client/src/lib/services/learning.ts:1113-1127` does. If the row has no
cached segments, write the sections **without** `timeSec` rather than
guessing.

**Do not reimplement the grounding math.** If `server/src/services/bm25-search.ts`
does not already expose a usable "best matching segment start for this text"
helper, **stop and ask** — porting `findEvidenceForQuote` is a second
duplication (finding B-12) and needs a decision about where it lives, not an
improvisation.

**Edit 2 — stop publishing an incomplete row.** Two options; **take the
second**, because the first needs inference the server cannot do without
Ollama, and ADR-0001 keeps the server off the inference path:
- ~~compute the scores and the embedding server-side~~ — rejected: requires
  Ollama from Strapi, which is the thing finding B-11 is about.
- **Write the summary fields but leave `summaryStatus` as it was**, and
  return an explicit completion report so the agent knows what remains:
  ```ts
  return {
    videoDocumentId: …,
    youtubeVideoId: args.videoId,
    summaryStatus: <unchanged value>,
    incomplete: ['signalScore', 'finalScore', 'summaryEmbedding', 'transcriptSegments'],
    note: 'Summary text saved. Scores, the embedding and the BM25 index are produced by the app pipeline; this row will not appear in semantic search or on the published site until that runs. Trigger it with the generation endpoint (see M7) or open /learn/<youtubeVideoId>.',
  };
  ```
  Update the tool's description so an agent reads this before calling.

**This changes the tool's contract.** Any agent prompt or `docs/mcp.md`
passage that says `saveSummary` publishes a video must be updated in the same
commit. Check `docs/mcp.md` for a `saveSummary` section and amend it.

**Tier check:** `saveSummary` is currently `sideEffects: 'write'`. It still
writes, so the tier does not change. Confirm, and leave
`server/src/mcp-official/tools.ts` alone if so.

**Verification:**
1. `cd server && npx tsc --noEmit`.
2. `yarn --cwd server verify:mcp` — the integration script exists and is not
   in CI; M9 wires it up. Run it by hand here.
3. **Negative test:** call `saveSummary` over MCP with a section carrying a
   deliberately absurd `timeSec` (for example 99999) and confirm the schema
   now **rejects the unknown field** or ignores it, and that the stored
   `timeSec` is a real caption-segment start from the transcript — not 99999.
   Verify by reading the row back and checking the value appears in
   `transcript.rawSegments`.
4. Confirm a row saved this way does **not** become `generated`, and
   therefore does not appear in `yarn site:build` output nor in
   `/feed?mode=semantic`.

**Done when:** the tool's schema has no `timeSec`, stored timecodes trace to
real segments, and an incomplete row is reported as incomplete instead of
being published.

**Rollback:** revert the commit. Rows written by the old path keep whatever
`timeSec` the agent supplied — M8's health view is what finds them.

### M7 — Agent-triggerable generation, bounded bulk (G7)

**This is the only genuinely missing capability**, and it is the whole of the
owner's goals 2 and 3. Everything else an agent needs already exists twice
over. Deliberately **no queue, no cron, no job table, no CLI** — a CLI would
be a third ingest path beside `shareVideo` and `addVideo`, with a third copy
of ID extraction.

**Files:**
- Create: `client/src/routes/api.generate.tsx`
- Modify: `client/src/lib/services/generation-state.ts` (the semaphore)
- Modify: `client/src/data/server-functions/videos.ts`
  (`ShareVideoInputSchema`, `shareVideo`)
- Modify: `client/src/components/NewPostForm.tsx` (bulk paste)
- Modify: `server/src/mcp/tools/add-video.ts` (description only)
- Create: `client/src/lib/services/generation-state.semaphore.test.ts`

**Edit 1 — one global Ollama budget.** Four independent budgets exist today:
`MAP_CONCURRENCY` (default 1), `embedBatch`'s 2
(`client/src/lib/services/embeddings.ts:295-298`), the embedding backfill's
`CONCURRENCY = 3` (`client/src/data/server-functions/videos.ts:800`), and
the per-job cap — against one local Ollama whose own parallelism the app
never reads. Ten shares at once is ten jobs each running `MAP_CONCURRENCY`
calls.

Add a counting semaphore to `generation-state.ts`, where `inflight` already
lives, and gate generation jobs on it. Read the limit from a new
`OLLAMA_MAX_CONCURRENCY` in `client/src/lib/env.ts`, clamped `[1, 8]`,
**default 2**. Keep `ensureGenerationRunning`'s atomic check-and-add exactly
as it is (`:90-97`) — the semaphore is an additional gate, acquired after
the slot is reserved and released in `runInBackground`'s `finally`.

**The release must be in a `finally`.** A job that throws without releasing
leaks a permit, and after `OLLAMA_MAX_CONCURRENCY` such throws generation
stops accepting work with no error anywhere. This is the single highest-risk
line in the milestone.

**Do not change `MAP_CONCURRENCY`, `embedBatch` or the backfill pool in this
milestone.** Collapsing all four into one budget is the right end state, but
it changes throughput characteristics the owner tuned; record it as a
follow-up. The semaphore bounds the new bulk path, which is what goal 3
needs.

**Edit 2 — the generation endpoint.** `client/src/routes/api.generate.tsx`,
`POST /api/generate`, following the shape of the four existing POST routes
(`api.chat.tsx` is the closest model). Body `{ videoIds: string[] }`, 1–25
entries, each matching the existing `VideoIdSchema` constraints
(`client/src/data/server-functions/videos.ts:116-122`: 1–32 chars,
`/^[\w-]+$/`). For each id call the existing `triggerSummaryGeneration`
(`:261`) and return a per-id result array of
`'started' | 'already_running' | 'recently_failed' | 'found' | 'error'`
— the statuses that function already returns. **No new generation logic.**

Validate as the other routes do: unparseable JSON → 400, missing or
malformed `videoIds` → 400, more than 25 → 400.

**Edit 3 — bulk share.** Change `ShareVideoInputSchema.url` from
`z.string().url()` to accept either form, so no existing caller breaks:

```ts
const ShareVideoInputSchema = z.object({
  url: z.string().url().optional(),
  urls: z.array(z.string().url()).min(1).max(25).optional(),
  caption: z.string().max(500).optional(),
  tags: z.string().max(240).optional(),
  mode: GenerationModeSchema.optional(),
}).refine((v) => Boolean(v.url) !== Boolean(v.urls), {
  message: 'Pass either url or urls, not both',
});
```

`shareVideo` loops over the resolved list and returns an array of the
existing per-URL `ShareVideoResult`. **`kickoffSummaryGeneration` is already
fire-and-forget and `ensureGenerationRunning` already dedupes by `videoId`,
so bulk needs no new coordination** — only the semaphore from Edit 1.

**Callers (§4):** `shareVideo`'s return type changes from a single result to
an array. Every caller must be updated in this commit —
`client/src/components/NewPostForm.tsx` is the one in the repo; grep for
`shareVideo(` to confirm there are no others. If keeping the single-result
return for the single-URL case is simpler, that is acceptable **only** if the
type discriminates clearly; do not return a union the caller has to sniff.

**Edit 4 — the UI.** `NewPostForm` accepts newline- or comma-separated URLs
and drives them with `runCancellableBatch`
(`client/src/lib/cancellable-batch.ts:33-66`), which already provides
one-at-a-time progress, a working cancel, and "one bad video does not
abandon the rest". **The Settings bulk re-rate
(`client/src/components/ContentSignalsPanel.tsx:116-126`) is the existing
precedent — match its interaction and its states**, including what the user
sees per item and on failure. Do not invent a new progress pattern.

**Edit 5 — tell the agent.** `server/src/mcp/tools/add-video.ts`'s
description must say that the row is created `pending` and that generation is
triggered by `POST /api/generate` on the client app (with its URL), not by
this tool. Same in `docs/mcp.md`. This is the sentence that closes goal 2.

**Verification:**
1. Typecheck; `yarn test`.
2. **Semaphore test first, and it must be able to fail.** Write
   `generation-state.semaphore.test.ts` before the code: with the limit at 2,
   start 5 jobs whose `run` blocks on a deferred promise, and assert exactly
   2 are running. Then resolve one and assert a third starts. Then make a job
   **throw** and assert the permit is released — that is the leak case.
   Watch all three fail first.
3. `POST /api/generate` with 3 ids, at least one already generated:
   ```bash
   curl -s -X POST http://localhost:3005/api/generate \
     -H 'Content-Type: application/json' \
     --data '{"videoIds":["<pending-id>","<generated-id>","nonexistent1"]}' \
     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,1)))'
   ```
   Expect per-id statuses, and a 400 for a 26-entry body and for `{}`.
4. **Through the frontend:** paste 3 URLs into `/new-post`, confirm three
   rows are created, that progress reports per item, that **Cancel actually
   stops it** (the bug `04` records as fixed in `cancellable-batch.ts` —
   do not regress it), and that one bad URL does not abandon the rest.
5. With the limit at 2 and 5 videos queued, confirm via `/settings` or the
   generation progress endpoint that at most 2 run at once.
6. **Ollama needs to be up for 4 and 5.** With it down, the expected result
   is the friendly Ollama error per video, not a hang — M4 is what makes that
   true, which is why M4 precedes this.

**Done when:** `POST /api/generate` drives generation for a list of ids, a
bulk paste works end to end with working cancellation, at most
`OLLAMA_MAX_CONCURRENCY` jobs run at once, and a throwing job does not leak
a permit.

**Rollback:** revert the commit. Rows already created by a bulk share stay —
they are ordinary pending rows, and M8's view is how they get drained.

**Deployment note:** adds `OLLAMA_MAX_CONCURRENCY` (see Deployment).

### M8 — Library health: see it, then repair it (G8)

**Depends on M7**, because bulk ingest without this is ten jobs failing
silently. The live database already proves the need: four rows have
`summaryStatus: 'pending'` with a transcript, an `aiModel` and a 300–370 byte
`summaryOverview` — generation ran, wrote content, and never flipped the
status. They date from April 2026; the fix that prevents new ones (`01f76f2`,
2026-09-30) postdates them and repairs nothing. A fifth row,
`test-smoke-001`, is test pollution (M10 stops that recurring).

**Files:**
- Create: `client/src/data/server-functions/library-health.ts`
- Create: `client/src/components/LibraryHealthPanel.tsx`
- Modify: `client/src/routes/settings.tsx`
- Create: `server/src/mcp/tools/library-health.ts`
- Modify: `server/src/mcp-official/tools.ts`
- Modify: `server/src/mcp/tools/save-note.ts` — **no**; see "do not" below

**Edit 1 — one health query, two surfaces.** A `getLibraryHealth` server
function returning counts **and ids** for each category:

| Category | Definition |
|---|---|
| `stuckPending` | `summaryStatus: 'pending'` **and** `summaryOverview` is not null — content exists, status disagrees |
| `pendingFresh` | `summaryStatus: 'pending'` and no `summaryOverview`, created within 24h — legitimately in flight |
| `pendingStale` | as above but older than 24h — generation never ran or died |
| `failed` | `summaryStatus: 'failed'` |
| `noScore` | `summaryStatus: 'generated'` and `finalScore` is null |
| `embeddingMissing` / `embeddingStale` | from the existing `embeddingStatus` |
| `indexMissing` / `indexStale` | from the existing `videoIndexStatus` |

The last four already exist in `getEmbeddingCoverage` (`:579`) and
`getIndexCoverage` (`:637`). **Reuse them — do not reimplement.** Compose
the new function from those plus the four status queries.

**Edit 2 — `repairVideoStatus`.** A POST server function taking a
`videoId`, which recomputes what the row should be and writes it:
`generated` when `summaryOverview` and `summaryTitle` are both present,
otherwise `failed`. It must **not** invent scores — a repaired row with a
null `finalScore` shows up under `noScore`, and the existing signal/verdict
regeneration buttons handle that. Add a "repair all" that walks
`stuckPending` through `runCancellableBatch`.

**Edit 3 — delete a video.** The Public role has no `video.delete`
(correct), and M2 moves writes behind the token, so a `deleteVideo` server
function calling `strapiFetch('DELETE', …)` works with the app's token. It
must cascade: delete the linked `transcript` row too, or it is orphaned.
**Check whether the Strapi relation already cascades before writing the
second delete** — if `transcript` is `oneToOne` with no cascade, the spec's
two-step delete is right; if Strapi cascades it, a second delete 404s.
**If the behaviour is unclear from the schema, stop and ask** rather than
guessing, because a wrong guess here orphans or double-deletes.

The UI needs a confirmation step naming the video title. A bulk add of ten
wrong videos is the scenario this exists for.

**Edit 4 — the MCP read tool.** `server/src/mcp/tools/library-health.ts`
exposing the same counts and ids, registered in
`server/src/mcp-official/tools.ts` with `sideEffects: 'none'` so it lands in
the **read** tier. This is goal 2's "how does the agent know what to fix".
Project `fields` — the existing tools do this correctly
(`list-videos.ts:43-55`), and a health tool that returns whole rows would
reintroduce B-5 on the MCP surface.

**Do not** add an MCP *repair* or *delete* tool in this milestone. Those are
`write`/`maintenance` tier and the owner has not asked for an agent that
mutates status or removes rows; leave them to the UI.

**Verification:**
1. Typecheck both; `yarn test`.
2. Against the **scratch** database seeded from the archive, confirm
   `getLibraryHealth` finds the four known stuck rows. Their shape is
   documented above, so this is a real assertion, not a tautology:
   ```bash
   curl -s 'http://localhost:1340/api/videos?filters[summaryStatus][$eq]=pending&filters[summaryOverview][$notNull]=true&fields[0]=youtubeVideoId&pagination[withCount]=true' \
     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("stuckPending:",j.meta.pagination.total,j.data.map(r=>r.youtubeVideoId));})'
   ```
3. Repair one on the scratch database, then re-run the query and confirm the
   count drops by exactly one and the row reads `generated`.
4. Negative test for the delete: confirm an anonymous
   `DELETE /api/videos/<documentId>` returns **403** (M2's posture), while
   the server function succeeds.
5. **Through the frontend:** `/settings` shows the panel with non-zero
   `stuckPending` on the scratch data; repair-all drains it; the delete
   confirmation names the right title and the row is gone from `/feed`.
6. Call the MCP tool through the official endpoint with a **read-tier**
   token and confirm it is visible; confirm `verify:mcp` still passes.

**Done when:** `/settings` reports the four stuck rows, repair-all clears
them on the scratch database, a video can be deleted with confirmation, and a
read-tier MCP token can see the health tool.

**Rollback:** revert the commit. Repairs already written are status
corrections to rows whose content was already there — they do not need
undoing, and re-running the old code will not re-break them.

### M9 — Make the server half testable (G9, G10, G11, G16)

The server holds 22 MCP tools, the Document Service middleware, the
permission registration whose misordering once destroyed every token's
grants, and second copies of the BM25 and embedding code — gated only by
`tsc --noEmit` under `strict: false`, with `verify:mcp` not in CI. Every
change in M1, M2, M6 and M8 landed in exactly this half.

**Files:**
- Modify: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/**/*.test.ts` (see below)
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json` (root — a `server:test` script)
- Modify: `scripts/sync-bm25-core.mjs` **or** create
  `client/src/lib/services/embeddings.sync.test.ts`
- Modify: `server/src/mcp/tools/add-video.ts` (transaction)
- Modify: `server/config/database.ts` (`busy_timeout`)

**Edit 1 — a server test suite.** `server/vitest.config.ts` mirroring the
client's deliberate plugin-free shape
(`client/vitest.config.ts:3-5`, `:24-25`), node environment, globals off.
Minimum coverage, chosen because each one guards a change this spec makes:
- the tag create middleware generates a slug and normalises the name (M1);
- the public-role action list contains no write action, and the revocation
  loop targets only `api::` actions (M2);
- each MCP tool's input schema accepts a known-good payload and rejects a
  known-bad one;
- the `sideEffects` → permission tier derivation in
  `server/src/mcp-official/tools.ts`, including that the new health tool is
  `none` (M8);
- `saveSummary` writes no `timeSec` it was not given a transcript for (M6).

**Edit 2 — `strict: true` in `server/tsconfig.json`.** This will surface
errors. **Fix them in this commit; do not widen types to `any` to silence
them.** If the count is large enough that fixing them would dominate the
milestone, **stop and ask** — the honest alternatives are a staged
`strict` (e.g. `strictNullChecks` first) or a separate milestone, and that is
the owner's call.

**Edit 3 — CI.** Add two steps to `.github/workflows/ci.yml` after the
existing server typecheck: `yarn --cwd server test` and
`yarn --cwd server verify:mcp`. The workflow's own comment explains why the
site test step exists ("Without this step its tests would never run in CI")
— the same reasoning applies here and the comment should say so.
**`verify:mcp` must not need a live Strapi or Ollama**; if it does, it
cannot go in CI as-is — mark it and run it only locally, rather than making
CI depend on services ADR-0009 deliberately keeps out.

**Edit 4 — guard the embedding duplication (G9).**
`server/src/mcp/utils/embeddings.ts` free-hands the client's contract —
`MAX_EMBED_CHARS`, the `search_query:`/`search_document:` prefixes, the
model and version defaults — with no sync script and no test, unlike
`bm25-core.ts` which has both. If they drift, `reindexEmbeddings` writes
vectors the client classifies stale and semantic search silently returns
nothing. Take the cheaper of the two paths and **state which in the commit
message**: either extend `scripts/sync-bm25-core.mjs` to copy the shared
constants, or add a drift test modelled exactly on
`client/src/lib/services/bm25-core.sync.test.ts` asserting the four values
match across the two files. A test is sufficient; a sync script is better.

**Edit 5 — transaction in `add-video` (G10).**
`server/src/mcp/tools/add-video.ts:93-144` creates a transcript, then N tags,
then the video, as separate Document Service writes. A throw partway leaves
an orphan transcript and orphan tags. It runs inside Strapi, so
`strapi.db.transaction` is available and is the right API — confirmed in the
installed typings (`@strapi/database/dist/index.d.ts:54-55`). Wrap the whole
write set and re-check the dedupe `findFirst` (`:67-69`) **inside** the
transaction. Ten partial failures from a bulk ingest are ten orphans
otherwise.

Two things to know before writing it. **Strapi's docs mark database
transactions experimental and "subject to change in future versions"** —
note that in the commit message so a future upgrade knows to re-check. And
**every Document Service repository method is already individually wrapped**
in its own transaction (`@strapi/core/dist/services/document-service/repository.js:565-576`),
with nested transactions joining the outer one via AsyncLocalStorage — which
is exactly why wrapping works here, and why you **do not** pass a `trx`
handle to the inner calls. Writing them as ordinary Document Service calls
inside the block is correct.

**Edit 6 — bound and surface write contention (G16). The original
`busy_timeout` plan was wrong twice over; this is the corrected version.**

Two facts from the installed source changed this edit:

1. **`busy_timeout` is already 5000 ms.** `better-sqlite3` 12.8.0 defaults it
   (`server/node_modules/better-sqlite3/lib/database.js:34`:
   `'timeout' in options ? options.timeout : 5000`), applied as
   `sqlite3_busy_timeout`. Setting 5000 would be a no-op, and a verification
   asserting "non-zero" could never fail — which this spec's own rule
   forbids ("A guard you have not watched fail is not a guard").
2. **It addresses the wrong layer.** knex pins the SQLite pool to a single
   connection (`server/node_modules/knex/lib/dialects/sqlite3/index.js:215-217`:
   `{ min: 1, max: 1 }`), and Strapi's own code notes "sqlite does not support
   connection pooling" (`@strapi/database/dist/index.js:40-42`). So two
   in-process writers **queue in the knex pool**, governed by
   `acquireConnectionTimeout` — the 60 s already configured — not by SQLite's
   busy handler. `busy_timeout` only helps against another OS **process**
   holding the write lock: the admin panel, a `strapi import`, or this spec's
   own scratch/live split.

Also: the "driver's connection options" path does not exist. knex's
better-sqlite3 dialect forwards only `{ nativeBinding, readonly }` to the
constructor (`knex/lib/dialects/better-sqlite3/index.js:11-18`) and drops
`timeout`, so config written there is silently ignored. **Only
`pool.afterCreate` works** — `@strapi/database/dist/connection.js:26-42`
chains a user hook after Strapi's own, and the `conn` it receives is the
native better-sqlite3 `Database` (Strapi uses it for
`pragma foreign_keys = on`), so `conn.pragma('busy_timeout = <ms>')` is valid.

**So do this instead.** The real failure under M7's bulk is a 60 s queue wait
reported as an opaque connection-acquisition timeout:
- Lower `acquireConnectionTimeout` in `server/config/database.ts` to something
  a human reads as "contention", not "hung" — **20_000**.
- Keep M7's semaphore as the actual bound on write concurrency; it is the
  lever that prevents the queue from forming.
- **Optionally** raise `busy_timeout` above the default via `pool.afterCreate`
  as separately-justified defence against the cross-process case (the admin
  panel or an import running while the app writes). If you do, pick a value
  that differs from 5000 — **20_000** — and verify by reading back **that**
  number, so the check can fail.

Record in the implementation log that single-process `SQLITE_BUSY` is **not
reproducible** here, so this edit is bounding and surfacing contention rather
than fixing a bug anyone has seen.

**Verification:**
1. `yarn --cwd server test` passes; `cd server && npx tsc --noEmit` passes
   under `strict: true`.
2. CI: push nothing — run the same commands locally in the order the workflow
   does, including `yarn install:all`.
3. Drift guard: deliberately change `MAX_EMBED_CHARS` in one of the two
   embedding files and confirm the test or script **fails**. Revert. A guard
   you have not watched fail is not a guard.
4. Transaction: in the scratch database, force a failure between the
   transcript create and the video create (temporarily throw — a
   **temporary stub, reverted before commit, and `git diff` confirmed clean
   of it**), then confirm no orphan transcript row remains.
5. Contention settings, by query rather than inspection, through
   `yarn --cwd server strapi console` against the **scratch** database:
   `acquireConnectionTimeout` reads back 20_000 from the resolved config, and
   — only if you took the optional `pool.afterCreate` step —
   `PRAGMA busy_timeout;` returns **20000**, not the 5000 default. Asserting
   "non-zero" here proves nothing, because 5000 is the shipped default.

**Done when:** the server suite runs in CI, `strict: true` compiles, the
drift guard fails when the files disagree, a mid-transaction failure leaves
no orphan, and the contention settings read back the values above — not the
shipped defaults.

**Rollback:** revert the commit. No data step.

### M10 — Correctness odds and ends (G12, G13, G14, G15)

Four independent fixes, grouped because each is small and none depends on the
others. Commit separately if any one grows.

**Edit 1 — field types that survive Postgres (G12).** `string` maps to a
length-less `varchar(255)` in Strapi's knex layer
(`server/node_modules/@strapi/database/dist/schema/schema.js:144-149` —
`maxLength` is not forwarded), so these declared bounds exceed the column:
`video.videoTitle` `string`/300, `video.videoAuthor` `string`/200,
`video.verdictSummary` `string`/280, `digest.videoSetKey` `string`/500.
SQLite ignores varchar lengths, which is why nothing has failed yet; on
Postgres a long title becomes an ingest failure with a raw driver error and
the row is marked `failed` for a reason nobody can read. `videoTitle` and
`videoAuthor` also come from YouTube, which §3 says belongs in `text` —
`url` and `videoThumbnailUrl` in the same schema already get this right.

Change all four to `"type": "text"`, keeping the `maxLength` validators.
**This is a schema change, so say what happens to existing rows.** No
*values* change and no backfill is needed — `string` and `text` both map to
a knex text-ish column, and Strapi applies the change itself on boot (its
schema diff flags the changed type and issues `.alter()`; `sync()` runs on
every boot with no production guard).

**But on SQLite, knex implements `.alter()` as a table rebuild** —
create-copy-drop-rename, not a true `ALTER`. So while the data is preserved,
the table is recreated, which is a materially bigger operation than
"widening" suggests. That makes the next sentence non-negotiable rather than
precautionary: **back up `server/.tmp/data.db` first, then verify on the
copy** by booting Strapi against it and confirming all 191 rows read back
intact, with `videoTitle` populated, before this change goes anywhere near
the real file.

**Edit 2 — cap the note prompt (G13).**
`client/src/lib/services/notes.ts:184-193` (`loadTranscriptText`) applies no
character cap, and the whole cleaned transcript is interpolated at `:271-273`.
The sibling route caps at 18_000 (`client/src/routes/api.notes.compose.tsx:45`).
Export that constant from one place and use it in both. A three-hour
transcript is 200k+ characters: the model silently truncates, so the prompt's
own "the transcript wins" instruction stops holding.

**Edit 3 — a failed lookup is not a cache miss (G14).**
`client/src/data/server-functions/digests.ts:165-195` branches on
`if (lookup.success && lookup.data)`, and the comment below it says
*"Cache miss (or lookup failure): generate fresh."* So a momentarily
unreachable Strapi triggers a minutes-long regeneration of a digest that
already exists. `findDigestByVideoSetKeyService` already returns
`success: false` with the reason; the caller discards it. Return
`{ status: 'error', error: lookup.error }` when `success === false`, so only
a genuine miss generates.

**Do not** move digest generation out of the loader in this milestone, though
B-18 recommends it — that changes `/digest`'s interaction model and belongs
with the owner's UX judgement.

**Edit 4 — tests stop writing to the live library (G15).**
`client/src/lib/services/videos.smoke.test.ts:14` defaults `STRAPI_URL` to
`http://localhost:1340` — the real library — and `:90` POSTs a tag named
`smoke-${Date.now()}`, a new row every run, never cleaned up. It is in the
default include glob so plain `yarn test` runs it, and it self-skips only
when Strapi is *unreachable*, so it runs precisely when the live database is
up. Require an explicit opt-in that the live stack never sets:

```ts
const LIVE_WRITES_ALLOWED = process.env.YTKB_ALLOW_LIVE_WRITES === '1';
```

Skip the writing tests unless it is `1`, keeping the existing
unreachable-skip as well. Add the variable to `client/.env.example`
commented out, with a line saying it writes rows to whatever `STRAPI_URL`
names. Then delete the stray rows: `test-smoke-001` and any `smoke-*` tag,
**on the live database, by the owner, after confirming each id** — list them
first, delete second, and do not script a blind delete.

**Verification:**
1. Typecheck; `yarn test` — confirm the smoke writes now **skip** by
   default, and run with `YTKB_ALLOW_LIVE_WRITES=1` against the scratch
   Strapi to confirm they still pass when enabled.
2. Schema change: boot against a **copy** of the live database; confirm
   `GET /api/videos?pagination[pageSize]=1` returns a row with its
   `videoTitle` intact, and that the count is still 191.
3. Notes cap: generate a note from a long video and confirm the prompt is
   bounded — assert in a unit test that `loadTranscriptText` output is
   ≤ the constant.
4. Digest: stop Strapi, request a `/digest` URL for a digest known to be
   cached, and confirm the page shows a **backend error** rather than
   starting a generation. Restart Strapi and confirm the cached digest loads
   with `cached: true`.

**Done when:** the four fixes are in, the smoke writes skip by default, and a
cached digest is not regenerated when Strapi is down.

**Rollback:** revert the commit. The schema change is a widening, so
reverting it is only safe if no row has since exceeded 255 characters —
check before reverting, and if any has, leave the schema as `text`.

### M11 — Delete what contradicts the code (G17, G18)

Last, because nothing depends on it and it touches many files.

**Deletions:**
- `server/scripts/seed.mjs` — stale cross-project code with three hardcoded
  passwords, POSTing `/api/auth/local/register` and writing `profiles` and
  `posts`, entities in no schema here, defaulting to the live instance. No
  script references it. It is the only credential-bearing script in the repo
  and the only code implying a sign-in exists.
- `client/src/lib/validations/post.ts:112-131` — `ProfileEditFormSchema` and
  `ProfileUpdateInputSchema`, with no profile route, component or server
  function. Delete the two exports; **check nothing imports them first**.
- `server/src/extensions/users-permissions/content-types/user/schema.json` —
  reproduces the stock schema verbatim, and the extension loader *replaces*
  `attributes` wholesale, so any attribute a future Strapi adds to the base
  user type is silently dropped on upgrade. Nothing reads or writes the type.
  **Boot Strapi after deleting and confirm the admin panel still loads and
  the users collection is intact** — this is the one deletion with a
  framework interaction.
- `client/pnpm-lock.yaml` — stray, alongside `yarn.lock`, with
  `packageManager: yarn@1.22.22`.
- The three unused runtime dependencies in `client/package.json`:
  `@strapi/client`, `ky`, `shadcn` — **confirm with a grep of `client/src`
  that each has no import** before removing, then reinstall and rebuild.

**Comment and doc corrections:**
- `server/src/index.ts:97-99` — the "Delete stays admin-only" comment. M2
  already rewrites this; confirm it is accurate after M2 and fix if not.
- `server/src/mcp-official/permissions.ts:37-45` — still lists
  `generateDigest` under maintenance after `tools.ts:57-61` re-tiered it to
  `none`. A reader deciding what a browse token reaches gets the wrong
  answer.
- `server/src/mcp-official/index.ts:29` — `strapi.ai?.mcp`. An upgrade that
  moves that namespace logs "MCP server disabled" indistinguishably from
  `MCP_ENABLED=false`. Log at `warn` when `MCP_ENABLED` is true but the
  namespace is absent.
- `server/config/server.ts:13` and `04` Decision 8 — **confirm** the MCP
  floor reads 5.47.0 (the official docs' number; installed is 5.52.1). The
  comment already says "(5.47+)", so this is a check, not an edit; line 12 is
  just `},`. Add the forward note: from Strapi 5.53.0 the built-in MCP server
  moves to MCP TypeScript SDK v2, under the **renamed** packages
  `@modelcontextprotocol/server@2.0.0` and `@modelcontextprotocol/node@2.0.0`
  (not `sdk@2.x`), with schemas serialized as JSON Schema 2020-12. The
  installed tree is on
  `@modelcontextprotocol/sdk@1.30.0`. Note **22** registered tools, not 20 —
  20 files, but `tags.ts` exports three
  (`server/src/mcp-official/tools.ts:41-73`). The exposure is narrower than
  it sounds: `grep @modelcontextprotocol server/src` returns nothing, because
  this app imports no SDK symbol and passes zod schemas through Strapi's
  registry. The one thing to re-verify after that upgrade is that each tool's
  advertised schema still compiles as JSON Schema 2020-12.
- `server/package.json` engines — set to **`">=22.0.0 <=26.x.x"`**. Raising
  only the floor would leave `<=24.x.x`, which is now *narrower* than Strapi
  supports: Strapi's own `engines` are `>=22.0.0 <=26.x.x` and its docs list
  Node 22, 24 and 26. Floor 22 matches 5.52.1's documented minimum
  (G17 / B-24).
- `server/package.json` — `@types/node` is `^20` while the engine floor
  becomes 22. Raise it to `^22` **in the same commit as M9's
  `strict: true`**, or Node 22+ APIs will be under-typed exactly when strict
  checking starts caring.
- `client/.env.example` — add the commented `OLLAMA_SYNTHESIS_MODEL`, which
  is read at `client/src/lib/env.ts:43` and undeclared.
- `CLAUDE.md` — the stale numbers: it says 230 tests and 96 site tests;
  measured at `8ac5ae3` they are 306 (33 files) and 105 (11 files). Also
  remove the tag-failure gotcha (M1 fixes it) and update the test counts
  after all milestones land.
- Reduce the per-query diagnostic logging in
  `client/src/data/server-functions/videos.ts:1276-1297` (top-10 from each
  retriever on every `/search`) and `:394-397` (every poll tick) to a
  `DEBUG_RETRIEVAL` env flag, default off.

**Verification:** typecheck both packages; `yarn test`; `yarn --cwd client
build`; boot the full stack and walk the core loop once (share → read →
chat); `yarn site:build`. Confirm `git diff` contains no leftover stub from
any earlier milestone.

**Done when:** everything above is deleted or corrected, all gates pass, and
the core loop works.

**Rollback:** revert the commit. If the users-permissions extension deletion
caused any admin issue, restore that one file first and re-check.

---

## Deployment

**Environment variables.**

| Variable | Change | Where |
|---|---|---|
| `HOST` | **Owner action, already needed** — `server/.env` sets it explicitly and still binds `*:1340`; set to `127.0.0.1`. The default in code and `.env.example` is already changed (`c4722eb`) | server |
| `STRAPI_API_TOKEN` | **Becomes required** at M2, not optional. Must be set and non-empty in `client/.env` before M2 | client |
| `OLLAMA_MAX_CONCURRENCY` | **New** at M7. Clamped `[1,8]`, default 2. Add to `client/.env.example` | client |
| `YTKB_ALLOW_LIVE_WRITES` | **New** at M10. Unset everywhere except a deliberate live-write test run. Add commented to `client/.env.example` | client |
| `OLLAMA_SYNTHESIS_MODEL` | Already read, now **declared** in `client/.env.example` (M11) | client |
| `DEBUG_RETRIEVAL` | **New** at M11, default off | client |

**Deploy order.** The server before the client at M1, M2, M6, M8 and M9,
because the client depends on the new middleware behaviour, the new
permission posture and the new MCP tool. M3, M4, M5, M7 and M10 are
client-only except where noted.

**Migrations.** None. No `database/migrations` entry is added. M10's
`string` → `text` is a widening Strapi applies on boot; the data step is
"verify on a copy", not "migrate".

**Host-specific steps.** None. Nothing is containerised, nothing deploys the
client or the server, and only `site/` publishes — through
`publish-site.sh` from the owner's machine. **No milestone requires a site
republish**, since none changes `site/`. If the owner wants the published
site to reflect repaired rows from M8, that is a normal
`yarn site:publish` afterwards.

**One-time owner actions, collected.**
1. Set `HOST=127.0.0.1` in `server/.env`.
2. Confirm `STRAPI_API_TOKEN` is set in `client/.env` before M2.
3. After M10, delete the stray test rows (`test-smoke-001`, `smoke-*` tags)
   from the live library, having listed them first.
