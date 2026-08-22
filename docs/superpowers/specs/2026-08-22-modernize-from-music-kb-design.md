# Modernize yt-knowledge-base using patterns proven in music-kb

**Status:** Approved — 2026-08-22. Ready for an implementation plan.
**Scope:** `client/`, `server/`, repo root, `docs/`. One branch, phased commits.
**Sibling repo:** `/Users/paul/projects/music-kb` (branch `feat/strapi-lessons`).

## Why

music-kb and yt-knowledge-base are siblings — same stack (TanStack Start +
Strapi + local Ollama), same architecture, overlapping ADR set (`0001`–`0007`
are the same seven decisions in both repos). They have **different product
goals**: music-kb is music-tutorial-specific with a shared theory package and a
companion SPA; yt-kb is general-purpose YouTube knowledge capture. Nothing in
this spec ports music domain code.

What transfers is engineering practice. music-kb has already paid down the
debt yt-kb still carries, and left the receipts: a completed TanStack AI
upgrade plan, a CI workflow, a pre-push gate, and ADRs recording decisions
yt-kb *made but never wrote down*.

### The dependency gap

| Package | yt-kb | music-kb | npm latest | Target |
|---|---|---|---|---|
| `@tanstack/ai` | `^0.10.3` | `0.45.1` | 0.47.1 | **0.47.1** |
| `@tanstack/ai-ollama` | `^0.6.6` | `0.9.1` | 0.9.3 | **0.9.3** |
| `@tanstack/react-router` | `1.168.18` | `1.170.31` | 1.170.31 | 1.170.31 |
| `@tanstack/react-start` | `1.167.32` | `1.168.48` | 1.168.48 | 1.168.48 |
| `@tanstack/router-core` | `1.168.14` | `1.171.26` | 1.171.26 | 1.171.26 |
| `@tanstack/router-plugin` | `1.167.18` | `1.168.34` | 1.168.34 | 1.168.34 |
| `@tanstack/react-router-ssr-query` | `1.166.11` | `1.167.1` | 1.167.1 | 1.167.1 |
| `@tanstack/react-router-devtools` | `1.166.13` | `1.167.1` | 1.167.1 | 1.167.1 |
| `@strapi/*` | `5.49.0` | `5.52.1` | 5.52.1 | 5.52.1 |

### Root cause of the drift

The two families were pinned differently, and it decided their fate.

The router family is **exact-pinned** (`1.168.18`, no caret) and drifted two
minors — it only moves when someone bumps it deliberately, and someone did.

The AI family carries `^0.10.3` and drifted **thirty-seven** minors. On a `0.x`
package, `^0.10.3` resolves to `>=0.10.3 <0.11.0`: the caret *looks* permissive
but caps you at a dead minor line. It produced neither automatic updates nor
the visible staleness that prompts a manual bump. This is the failure mode the
pinning policy in Phase 1 exists to prevent — the lesson is not "pin
everything" but "on `0.x`, a caret is a silent ceiling, so pin exactly and bump
on a deliberate cadence."

## What this is not

Out of scope, explicitly:

- `packages/music`, `web/`, `tonal`, `music-extraction.ts` — music-kb domain.
- The Postgres/Neon production path, `db:dump`/`db:load`, backup automation.
- Vercel deployment.
- music-kb's install-isolation refactor. **It does not apply.** That work fixed
  an SSR fallback caused by two React instances meeting under a Yarn workspace
  root (`music-kb/docs/ssr-client-fallback.md`). Verified on yt-kb: there is no
  React at the repo root and exactly one copy under `client/node_modules`. yt-kb
  already installs per package and has never had the bug.

## Architecture of the work

One branch, `feat/modernize-from-music-kb`, with one commit per phase. The
single-branch shape is a deliberate choice to get one merge and one review;
phase-per-commit is what keeps a late failure bisectable inside it.

Phases are ordered so the safety net exists before the risky change lands:

```
Phase 0  diagnose the red baseline      (gate for Phase 3)
Phase 1  CI + gates                     (safety net)
Phase 2  routine bumps                  (verified by Phase 1)
Phase 3  TanStack AI 0.10.3 -> 0.47.1   (the hard one)
Phase 4  docs + ADRs                    (records 0-3)
```

---

## Phase 0 — Diagnose the failing ranking test

### Current state

`yarn --cwd client test` is **169 passed, 1 failed**:

```
FAIL  src/lib/services/embeddings.ranking.test.ts
  › semantic query "running AI on laptop" — dense ranks correctly
  AssertionError: expected [ 'kimi', 'rust' ] to include 'gemma'
```

The assertion requires the Gemma passage — which mentions "local inference",
"consumer hardware", "Ollama" — to land in the dense-retrieval top two for the
query "running AI models on my laptop locally". It ranks third or lower.

### This is not a CI problem

The test **already carries** the self-skip guard music-kb uses
(`if (!ollamaUp) return;`, with an `isOllamaUp()` probe at the top of the file).
It failed locally because Ollama genuinely is up. In CI, absent Ollama, it
skips. So Phase 1 is not blocked by this, and no CI-topology change fixes it.

It is a real signal from the cross-video discovery layer, and it gets diagnosed.

### Approach

Runs under `superpowers:systematic-debugging`. The test file's own header names
the candidate causes, and they are the hypotheses, in order:

1. **Task prefix dropped from `embedText`** — a code regression. `nomic-embed-text`
   requires `search_query:` / `search_document:` prefixes; losing them degrades
   exactly this kind of conceptual-bridge query while leaving literal-overlap
   queries looking fine. Most likely, and the only one that is a live bug.
2. **`EMBEDDING_VERSION` mismatch** between stored vectors and current code —
   the invalidation protocol in `CLAUDE.md` failing in practice.
3. **Model drift** in the local `nomic-embed-text` pull.

Note that the two proper-noun tests still pass. A hypothesis is only viable if
it explains why semantic ranking degraded while lexical-overlap ranking did
not — which is itself evidence for (1).

### Outcomes

Either a **real bug fix** — valuable independent of this whole effort, since it
would mean semantic search and Related-videos have been quietly degraded — or,
if the code is correct and the model simply ranks this corpus differently, a
threshold change with the evidence recorded in the test file.

The assertion is not deleted or loosened without a diagnosis that explains it.

### Gate

Phase 3 does not begin until the suite is green, or this failure is understood
and explicitly accepted in writing. Upgrading on a red suite makes every later
failure ambiguous.

---

## Phase 1 — CI and static gates

yt-kb has a GitHub remote (`PaulBratslavsky/yt-local-llm-knowledge-base-with-mcp`)
and **zero CI**. Everything below is modelled on music-kb's, minus the packages
yt-kb does not have.

### `.github/workflows/ci.yml`

One job. Node 22. Cache keyed on `yarn.lock`, `client/yarn.lock`,
`server/yarn.lock` so a change in any package busts it. Steps:

1. `yarn install:all` (frozen, all three packages)
2. `npx tsc --noEmit` in `client/`
3. `npx tsc --noEmit` in `server/` — thinner coverage, but it catches Strapi API
   drift across upgrades, which Phase 2 will exercise
4. `yarn test` from the **root**

Live-backend tests self-skip headless already (`embeddings.ranking.test.ts`
probes Ollama; the videos smoke test probes Strapi), so CI needs no services.

### Root `package.json`

- Add the missing `test` script. The root currently has none — `yarn test` at
  the root fails outright today. Note the rationale differs from music-kb's:
  there, the root script exists because tests live in *three* packages and a
  bare `yarn --cwd client test` silently skips 199 of them. yt-kb has exactly
  one test package (`client/`, 11 files), so the root script is for CI symmetry
  and a single obvious entry point, not to prevent silent under-coverage. If a
  second test package ever appears, this script is already the right shape.
- Add `install:all` running `yarn install --frozen-lockfile` at the root and in
  each of `client/`, `server/`. Reproducible installs; also what CI calls.

### `.githooks/pre-push`

Runs `yarn --cwd client build` before every push, with `set -e`. Documented as
requiring `git config core.hooksPath .githooks` once per clone, and skippable
with `--no-verify`.

The **build**, not `tsc --noEmit`: music-kb recorded `--noEmit` passing twice
while the real build failed on genuine type errors. yt-kb's client build is
`vite build`, which is the honest gate for a TanStack Start app.

### `client/vitest.config.ts`

Split the `test` block out of `vite.config.ts` (currently lines 16–19) into a
dedicated, plugin-free `vitest.config.ts`, which vitest prefers. Carries the
existing `include` / `exclude` unchanged, keeping vitest out of `e2e/`. Removes
plugin interference from the test run.

### Pinning policy

Move `@tanstack/ai` and `@tanstack/ai-ollama` to exact pins when Phase 3 lands
them. Record the `0.x`-caret trap in `CLAUDE.md` so the next pre-1.0 dependency
does not repeat it.

---

## Phase 2 — Routine version bumps

Mechanical, and the first real exercise of Phase 1's net.

**TanStack router/Start family** — the six packages in the table, all already
exact-pinned, all moving 1–3 minors on a stable `1.x` line.

**Strapi 5.49.0 → 5.52.1** — all three `@strapi/*` packages, via the codemod:

```
yarn --cwd server upgrade:dry     # review first
yarn --cwd server upgrade
```

The dry run's diff is reviewed before the real run, because the codemod can
touch content-type schema files, and yt-kb's schemas carry the MCP tool surface
and the scoring fields.

**Verification:** typecheck both packages, `yarn test`, boot the full stack, and
run the Playwright e2e smoke (`yarn --cwd client test:e2e`) — which guards the
seroval server→client boundary that a Start upgrade is most likely to disturb.

---

## Phase 3 — TanStack AI 0.10.3 → 0.47.1, ai-ollama 0.6.6 → 0.9.3

Thirty-seven minors on a pre-1.0 line, where semver's major-zero clause means no
compatibility promise whatsoever. music-kb's `docs/tanstack-ai-upgrade-plan.md`
is the playbook; the findings below are from reading the actual 0.47.1 typings,
so several of its risk areas are already resolved for yt-kb.

### Call surface

Four symbols, twelve files, **eighteen `chat({...})` call sites**:

```
chat                        most service files + all four API routes
toolDefinition              chat-tools.ts, library-tools.ts
toServerSentEventsResponse  routes/api.chat.tsx
createOllamaChat            8 sites across services + routes
```

### Grounded findings

**`createOllamaChat` is unchanged.** 0.9.3 still declares:

```ts
createOllamaChat<TModel extends string>(
  model: TModel,
  hostOrConfig?: string | OllamaClientConfig,
): OllamaTextAdapter<TModel>
```

All 8 positional `createOllamaChat(MODEL, OLLAMA_HOST)` call sites survive
untouched. The playbook's "adapter construction reorganized" risk does not
apply here.

**Top-level `temperature` is gone.** 0.47.1's chat options are `systemPrompts`,
`agentLoopStrategy`, `lazyToolsConfig`, `metadata`, `modelOptions`, `request`,
`outputSchema`, `threadId` — no `temperature`. The typings say so directly:
*"use the provider's `modelOptions` field instead."*

yt-kb passes `temperature` at the top level in **11 places** (`reader.ts` ×3,
`learning.ts` ×3, `digest.ts` ×2, `notes.ts`, `api.notes.compose.tsx`,
`api.ask.tsx`). Because every call site is an object literal, TypeScript's
excess-property check makes all 11 **hard compile errors**, not silent drops —
better than the playbook feared. music-kb hit this too and fixed it after the
fact in `3970462` ("set a temperature on /api/chat so tool calls stop being
narrated").

**Two workarounds are now obsolete.** `api.chat.tsx:160` and `learning.ts:508`
both carry comments stating that `ai-ollama@0.6.6` silently drops
`systemPrompts`, so they prepend a `{ role: 'system' }` message and cast
`messages ... as never` to defeat the `ConstrainedModelMessage` union. 0.47.1
specifies `systemPrompts` fully. Leaving these in is the playbook's "compensating
workaround now conflicts" trap; removing them closes a real type-safety hole.

### Steps

- **3a** Bump both packages; typecheck; record every error and its cause. That
  list is the real changelog for this codebase and belongs in the commit body.
- **3b** Move the 11 `temperature` values into `modelOptions: { temperature }`.
- **3c** Remove the two obsolete `systemPrompts` workarounds and their `as never`
  casts; adopt the real option.
- **3d** Audit `chat-stream.ts:103` against `TOOL_CALL_END` firing **twice per
  tool call** in current versions (once for input, once for output). The
  existing tests in `chat-stream.test.ts` already assert two different payload
  shapes (`toolName`/`input` and `toolCallName`/`args`), so the code may already
  tolerate this — confirm rather than assume.
- **3e** Check `coerceStrictSchema()` against the `outputSchema` consumers
  (`learning.ts`, `digest.ts`, `notes.ts`, `reader.ts`). It should *fix* strict
  structured output; the risk is a hand-rolled compensation that now conflicts.
- **3f** Read `client/node_modules/@tanstack/ai/skills/ai-core` after install —
  the package ships agent-readable guides with a "Common Mistakes" section,
  which music-kb found more reliable than the docs site.

### Live verification

Types cannot catch renamed stream events or silently-ignored options. Verified
against local Ollama (`gemma4-kb:latest` and `nomic-embed-text` confirmed
present):

| Path | Check |
|---|---|
| Plain chat | streams tokens, completes |
| Tool-calling | `web_search` invoked, result renders, `TOOL_CALL_*` frames well-formed |
| Structured output | summary generation parses; `finalScore` writers stay consistent |
| Error path | kill Ollama mid-stream, confirm `RUN_ERROR` fires — a test depends on that event name |
| Timings | compared against the Phase 0 baseline |

Any test that fails after the bump is **a finding, not an inconvenience**:
decide deliberately whether the test or the code is wrong, and record which.

---

## Phase 4 — Documentation

**ADR 0008 — official Strapi MCP over hand-rolled.** yt-kb shipped this in
`e22c4f2` and never recorded it. music-kb has the ADR for the same decision.
Backfill it, written from yt-kb's own migration.

**ADR 0009 — CI and static gates.** New decision from Phase 1: what the gates
are, why the build rather than `--noEmit`, why live-backend tests self-skip
instead of running services in CI.

**ADR 0010 — exact pins for pre-1.0 dependencies.** Records the `0.x`-caret
ceiling and the bump cadence that replaces it.

**`CLAUDE.md`** — new root `test` and `install:all` scripts, the corrected test
counts, `vitest.config.ts` replacing the `vite.config.ts` test block, the
`core.hooksPath` step, and the pinning policy.

**`docs/architecture.md`** — the AI-layer changes from Phase 3: `modelOptions`,
`systemPrompts`, and the removal of the `as never` casts.

**`docs/tanstack-ai-upgrade-plan.md`** — music-kb's plan ported as a completed
record carrying yt-kb's actual type-error list and behavioural findings.

---

## Testing strategy

Every phase gates on: `npx tsc --noEmit` in both packages, `yarn test` from the
root, and — for Phases 2 and 3 — the Playwright e2e smoke with the stack up.
Phase 3 adds the live Ollama matrix above.

The suite is the safety net this whole effort depends on, which is why Phase 0
comes first and Phase 1 comes before anything that changes behaviour.

## Risks

| Risk | Mitigation |
|---|---|
| Phase 3 stream-shape changes are runtime-only, invisible to typecheck | The live Ollama matrix, exercising all four paths including the error path |
| Strapi codemod touches content-type schemas carrying MCP tools and scoring fields | `upgrade:dry` first; diff reviewed before the real run |
| Single branch makes a late failure hard to isolate | One commit per phase; each phase independently green before the next starts |
| Phase 0 turns out to be a real embeddings regression, widening scope | That is a finding worth having. If the fix is large it becomes its own commit, and the ranking assertion stays red-but-understood rather than blocking |
| `coerceStrictSchema` changes structured-output behaviour subtly | Summary generation verified end to end, including the three `finalScore` writers |

## Success criteria

- `yarn test` green from the root; CI green on a pushed branch.
- All nine dependencies at their target versions, AI family exact-pinned.
- Zero `as never` casts remaining at `chat()` call sites.
- All 11 temperature settings verifiably reaching Ollama via `modelOptions`.
- Per-video chat, cross-video semantic search, summary generation, digests, and
  the notes composer all working against local Ollama.
- ADRs 0008–0010 written; `CLAUDE.md` and `architecture.md` accurate.
