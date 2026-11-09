# Checkpoint C — change readiness

- **Date:** 2026-11-08
- **Target:** `06-change-spec.md` (~7,950 lines, M1–M8), with the codebase at `721f210`
- **Standard:** `reviews/standards/strapi-change-spec-standard.md`
- **Reviewers** (dispatch option 1, fresh, in parallel): `egm:egm-implementation-readiness` (2 Blockers / 4 Majors / 6 Nits), `egm:egm-codebase-details` (1 / 2 / 6), `strapi-product-egm:strapi-fact-checker` (0 / 3 / 1; 28 claims checked, 24 confirmed; sources: strapi-docs MCP, docs.strapi.io, v5.61.0 release notes, npm registry, GitHub Advisory API, installed source)
- **How the spec was written:** the Elephant fixed every cross-milestone decision in a contract, four helpers drafted M1–M7 in parallel against it, the Elephant wrote the header, M8, env vars and deployment, and an integration pass applied 15 resolutions. Recorded so the lesson in the review log can be checked.

PROPOSE FIX edits `06`. Duplicates merged.

## Blockers

| ID | Finding | From | Label |
|---|---|---|---|
| C-1 | M2 step 17 `document-rules.test.ts` reads `ctx.params.data.slug` on a literal typed `{ name: string }` → TS2339; the plugin typecheck (`test:ts:back`, which includes tests) fails, breaking M2 Verify 2 and M1's CI step | readiness 1, codebase 1 | PROPOSE FIX — type the contexts as `Record<string, unknown>` data |
| C-2 | `yt-kb-site` already exists in `data.db`; `create-tokens.cjs` skips existing names, so Deployment step 3 writes no site key and the site keeps its read-only token (M-14 stays open) | readiness 2 | PROPOSE FIX — `--rotate <name>` in the script (revoke + recreate); Deployment step 3 rotates `yt-kb-site` |

## Majors

| ID | Finding | From | Label |
|---|---|---|---|
| C-3 | A lost tag race fails both unique checks (`name`, uid `slug`) → yup "2 errors occurred"; the middleware rethrows it unchanged and the client check misses it; M2 Verify 6 would fail | readiness 3 | PROPOSE FIX — rethrow any `ValidationError` whose `details.errors[]` carries the unique message as the `YT_KB_UNIQUE` error; two-attribute unit test |
| C-4 | OQ-7's "resolved" text contradicts M7's code and test (a throw stops the run) | readiness 4, codebase 2 | PROPOSE FIX — OQ-7 follows the code: the run stops; the copy is idempotent, so re-run after raising `jsonLimit` |
| C-5 | Deployment step 3 has the agent edit `.env`; M3 and M6 forbid it | readiness 5, codebase 3 | PROPOSE FIX — owner action everywhere: the agent writes keys to 0600 files and gives the paths |
| C-6 | M1 doesn't state the zod 3.25 → 4.4.3 change under `@strapi/utils`, and has no stop rule | readiness 6, codebase 5 | PROPOSE FIX — add to Facts with a STOP rule; fix the stale zod-3 comments in `registry.ts`, `adapter.ts`, `tools.ts` |
| C-7 | `seroval` floor 1.5.3 still has advisories through 1.6.7 | fact 1 | PROPOSE FIX — `^1.7.6`; gate rejects <1.6.8 |
| C-8 | `vitest` 3.2.4 has a critical advisory fixed in 3.2.6 (UI server only) | fact 2 | PROPOSE FIX — 3.2.6 in the plugin and the client |
| C-9 | Strapi 5.61.0 drops Node 20; vite 8.3.6 needs ≥22.12; no gate; plugin `@types/node ^20` | fact 3 | PROPOSE FIX — stop-and-ask Node ≥22.12 precondition; `@types/node ^22`. Owner's machine: Node 24.16.0 (checked) |

## Nits

All PROPOSE FIX: Strapi Cloud managed DB — tokens via the admin panel as the main path there, `psql` duplicate check only where the database is reachable (fact 4); one import of `DOCUMENT_ID` in `notes.ts`/`digests.ts` server fns (codebase 4); three line ranges (codebase 6); M8's README bullet about `TRANSCRIPT_PROXY_URL` (not in README) (codebase 7); M7 Verify 5 needs `2>&1`; M5 Verify 7's M-9 check asserts every listed name is `yt_kb__*` or `log`; port probe checks `::1` too (`lsof -iTCP:<p> -sTCP:LISTEN`); M6 V1 test 4's oEmbed request disclosed like OQ-5; M5 rollback's exact re-grant call. Recorded deviation: race paths for `shareVideo`/`saveDigest` are verified at the service level, not through the frontend (§7) — accepted in OQ-2.

## Escalations

None.
