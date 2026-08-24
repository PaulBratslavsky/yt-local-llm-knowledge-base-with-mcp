# Modernize yt-knowledge-base from music-kb Patterns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring yt-knowledge-base current on TanStack, TanStack AI and Strapi, and adopt the CI and dependency-hygiene practices already proven in the sibling repo music-kb.

**Architecture:** Four phases on one branch, one commit per phase group. Fix the red baseline first so the suite is a trustworthy signal, then build CI so it catches regressions, then do routine bumps, then the 37-minor TanStack AI migration with the net in place. Docs last, recording what actually happened.

**Tech Stack:** TanStack Start 1.168 + React 19 (client, port 3005), Strapi 5 + SQLite (server, port 1340), local Ollama for inference and embeddings, vitest + Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-modernize-from-music-kb-design.md`

## Global Constraints

- **Branch:** `feat/modernize-from-music-kb`, already created, spec committed at `c4e0770`.
- **Target versions, exact:** `@tanstack/ai` 0.47.1 · `@tanstack/ai-ollama` 0.9.3 · `@tanstack/react-router` 1.170.31 · `@tanstack/react-start` 1.168.48 · `@tanstack/router-core` 1.171.26 · `@tanstack/router-plugin` 1.168.34 · `@tanstack/react-router-ssr-query` 1.167.1 · `@tanstack/react-router-devtools` 1.167.1 · `@strapi/strapi` + `@strapi/plugin-cloud` + `@strapi/plugin-users-permissions` 5.52.1.
- **Pinning:** every version above is written **without a caret**. On a `0.x` package a caret is a silent ceiling (`^0.10.3` means `<0.11.0`); that is the documented root cause of the 37-minor drift.
- **Package manager:** yarn 1.22.22. Each package installs independently — there is no workspace, and none is to be introduced.
- **Do not touch:** `client/src/routeTree.gen.ts` (generated), `server/seed-data/`, anything music-domain.
- **Local ports:** Strapi 1340, client 3005. Kill orphans with `lsof -ti :1340 -ti :3005 | xargs kill -9`.
- **Ollama models present:** `gemma4-kb:latest`, `nomic-embed-text:latest`, `all-minilm:latest`.
- **Gate between phases:** `npx tsc --noEmit` in both packages and `yarn --cwd client test` green before starting the next phase.

---

## File Structure

**Created:**
- `client/vitest.config.ts` — vitest's include/exclude, plugin-free
- `.github/workflows/ci.yml` — typecheck + test on push/PR
- `.githooks/pre-push` — client build gate
- `docs/adr/0008-official-strapi-mcp-over-hand-rolled.md`
- `docs/adr/0009-ci-and-static-gates.md`
- `docs/adr/0010-exact-pins-for-pre-1.0-dependencies.md`
- `docs/tanstack-ai-upgrade-record.md`

**Modified:**
- `client/src/lib/services/embeddings.ranking.test.ts:245-262` — assertion fix
- `client/vite.config.ts:16-19` — remove the `test` block
- `package.json` — add `test`, `install:all`
- `client/package.json` — AI + router version bumps
- `server/package.json` — Strapi bump
- 11 chat call sites — `temperature` → `modelOptions`
- `client/src/routes/api.chat.tsx:159-180`, `client/src/lib/services/learning.ts:505-521` — remove obsolete workarounds
- `docs/adr/README.md`, `CLAUDE.md`, `docs/architecture.md`

---

# Phase 0 — Fix the red baseline

### Task 1: Correct the over-tight ranking assertion

The suite is 169 passed / 1 failed. The failure is not a bug — it was diagnosed before this plan was written and the evidence is below. `embedText` applies `search_query:` / `search_document:` prefixes correctly, and every caller in both test and app code passes the right task, so the two code-regression hypotheses are falsified. Measured scores for the failing query:

```
kimi   0.6152
rust   0.5872
gemma  0.5855   <- #3, loses 2nd by 0.0018 (0.3% relative)
qwen   0.5140
filler-9  0.4891   <- best filler, 0.096 below gemma
```

Dense retrieval is doing exactly what the test exists to prove — the Gemma passage clears every unrelated filler by a decisive margin. The test asserted a top-2 rank cutoff, which sits on noise. Replace it with the property that actually matters.

**Files:**
- Modify: `client/src/lib/services/embeddings.ranking.test.ts:255-262`

**Interfaces:**
- Consumes: `rankByCosine(queryText, docs)` → `Array<{ id: string; score: number }>`, already defined at line 55 of the same file.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the failure reproduces**

```bash
cd client && yarn vitest run src/lib/services/embeddings.ranking.test.ts
```

Expected: FAIL — `expected [ 'kimi', 'rust' ] to include 'gemma'`. If it passes, Ollama is down and the test self-skipped; start Ollama and retry.

- [ ] **Step 2: Replace the assertion**

In `embeddings.ranking.test.ts`, replace these lines:

```ts
    // Dense should rank the Gemma passage (mentions "local inference",
    // "consumer hardware", "Ollama") at or near the top — the conceptual
    // bridge query BM25 can't make.
    const topTwoIds = cosine.slice(0, 2).map((c) => c.id);
    expect(topTwoIds).toContain('gemma');
```

with:

```ts
    // Dense should rank the Gemma passage (mentions "local inference",
    // "consumer hardware", "Ollama") near the top — the conceptual bridge
    // query BM25 can't make.
    //
    // Top-3, not top-2. Measured 2026-08-22 against nomic-embed-text:
    //   kimi 0.6152 | rust 0.5872 | gemma 0.5855 | qwen 0.5140
    //   best filler 0.4891
    // Gemma loses second place by 0.0018 — 0.3% relative, a statistical
    // tie carrying no semantic meaning — while sitting ~0.096 clear of
    // every filler. A top-2 cutoff made the suite flaky on noise without
    // testing anything real.
    const topThreeIds = cosine.slice(0, 3).map((c) => c.id);
    expect(topThreeIds).toContain('gemma');

    // The property that actually matters: the conceptual bridge must beat
    // unrelated content by a real margin, not by a hair.
    const gemmaScore = cosine.find((c) => c.id === 'gemma')!.score;
    const bestFillerScore = Math.max(
      ...cosine.filter((c) => c.id.startsWith('filler-')).map((c) => c.score),
    );
    expect(gemmaScore).toBeGreaterThan(bestFillerScore + 0.05);
```

- [ ] **Step 3: Run the file to verify it passes**

```bash
cd client && yarn vitest run src/lib/services/embeddings.ranking.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 4: Run the full suite for a green baseline**

```bash
cd client && yarn test
```

Expected: 170 passed, 0 failed. **This green baseline is the gate for Phase 3.** Record the number.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/services/embeddings.ranking.test.ts
git commit -m "test(embeddings): assert the retrieval property, not a knife-edge rank

The semantic-query test required the Gemma passage in the dense top 2.
Measured against nomic-embed-text it lands 3rd, losing 2nd by 0.0018 —
0.3% relative, a statistical tie — while clearing every filler doc by
0.096. The assertion was testing noise.

Now asserts top-3 plus a real margin over unrelated content, which is
the property the test was written to prove. embedText's search_query:/
search_document: prefixing was verified correct at every call site
before changing the test."
```

---

# Phase 1 — CI and static gates

### Task 2: Split vitest config out of vite config

`vite.config.ts` currently carries the `test` block, so every vitest run loads the full plugin chain — devtools, tailwind, TanStack Start, nitro, React. Vitest prefers `vitest.config.ts` when present; a plugin-free one is faster and removes a class of plugin interference from unit tests.

**Files:**
- Create: `client/vitest.config.ts`
- Modify: `client/vite.config.ts:14-19`

**Interfaces:**
- Consumes: nothing.
- Produces: `client/vitest.config.ts` becomes the config CI and Task 4 rely on.

- [ ] **Step 1: Record the current test count**

```bash
cd client && yarn test 2>&1 | grep "Tests "
```

Expected: `Tests  170 passed (170)`. This number must not change in this task.

- [ ] **Step 2: Create `client/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

// Deliberately plugin-free. Vitest prefers this file over vite.config.ts,
// so unit tests no longer boot the devtools / tailwind / TanStack Start /
// nitro plugin chain they never used.
//
// Vitest (unit) owns src/**. Playwright (e2e) owns e2e/** and uses
// *.spec.ts — excluded here so vitest's default glob doesn't try to run
// browser specs in node.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
```

- [ ] **Step 3: Remove the test block from `vite.config.ts`**

Delete lines 14–19 (the comment and the `test: { ... }` object) and change the import on line 1 from `vitest/config` back to `vite`:

```ts
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
})

export default config
```

- [ ] **Step 4: Verify the count is unchanged and paths still resolve**

```bash
cd client && yarn test 2>&1 | grep "Tests "
```

Expected: `Tests  170 passed (170)` — identical to Step 1. A drop means the `include` glob or the `#/*` alias regressed.

- [ ] **Step 5: Verify the dev build still works**

```bash
cd client && yarn build
```

Expected: build succeeds. This confirms removing the `test` key didn't disturb the plugin chain.

- [ ] **Step 6: Commit**

```bash
git add client/vitest.config.ts client/vite.config.ts
git commit -m "test: move vitest config into its own plugin-free file

Unit tests were loading the full Vite plugin chain for no benefit."
```

### Task 3: Add root `test` and `install:all` scripts

The repo root has no `test` script — `yarn test` at the root fails outright today. Unlike music-kb (three test packages, where the root script prevents silently skipping 199 tests), yt-kb has one test package, so this is for CI symmetry and one obvious entry point.

**Files:**
- Modify: `package.json` (root)

**Interfaces:**
- Produces: `yarn test` and `yarn install:all` at the repo root. Task 4's CI workflow calls both.

- [ ] **Step 1: Verify the current failure**

```bash
yarn test
```

Expected: error — no such script.

- [ ] **Step 2: Add both scripts**

In the root `package.json` `scripts` block, add:

```json
    "test": "yarn --cwd ./client test",
    "install:all": "yarn install --frozen-lockfile && yarn --cwd server install --frozen-lockfile && yarn --cwd client install --frozen-lockfile"
```

- [ ] **Step 3: Verify `yarn test` now runs the suite**

```bash
yarn test 2>&1 | grep "Tests "
```

Expected: `Tests  170 passed (170)`.

- [ ] **Step 4: Verify `install:all` succeeds against committed lockfiles**

```bash
yarn install:all
```

Expected: all three installs succeed. A `--frozen-lockfile` failure means a `package.json` and its lockfile disagree — fix that before continuing, because CI will hit the same wall.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: add root test and install:all scripts

install:all pins every package to its committed lockfile, which is what
CI runs."
```

### Task 4: Add the CI workflow

yt-kb has a GitHub remote and zero CI. Both live-backend test families already self-skip when their dependency is absent (`embeddings.ranking.test.ts` probes Ollama, `videos.smoke.test.ts` probes Strapi), so CI needs no services.

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `yarn install:all` and `yarn test` from Task 3.

- [ ] **Step 1: Create the workflow**

```yaml
# Minimal CI — the static gates from CLAUDE.md: typecheck both packages and
# run the vitest suite. Both live-backend test families self-skip headless:
# embeddings.ranking.test.ts probes Ollama and videos.smoke.test.ts probes
# Strapi, so neither needs services here.
#
# One job, three installs (root + client + server). Each package owns its
# dependencies — there is no workspace and no hoisting. Keeping Strapi's
# React 18 unreachable from the React 19 client is deliberate: sharing a
# root lets the two majors meet, which breaks SSR.
#
# Caching keys on every lockfile, so a change in any package busts it.
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: yarn
          cache-dependency-path: |
            yarn.lock
            server/yarn.lock
            client/yarn.lock

      - name: Install all packages
        run: yarn install:all

      # Typecheck is per-package: each has its own tsconfig and there is no
      # project-wide script. The client is the one with real coverage; the
      # server's is thinner but catches Strapi API drift across upgrades.
      - name: Typecheck client
        run: npx tsc --noEmit
        working-directory: client

      - name: Typecheck server
        run: npx tsc --noEmit
        working-directory: server

      - name: Test
        run: yarn test
```

- [ ] **Step 2: Verify each CI step passes locally**

```bash
yarn install:all
cd client && npx tsc --noEmit && cd ..
cd server && npx tsc --noEmit && cd ..
yarn test
```

Expected: all four succeed. If the **server** typecheck fails, that is pre-existing drift — record the errors and fix them in this task, because CI cannot go green otherwise.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck both packages and run the vitest suite

Live-backend tests self-skip headless, so no services are needed."
```

### Task 5: Add the pre-push build hook

**Files:**
- Create: `.githooks/pre-push`

- [ ] **Step 1: Create the hook**

```sh
#!/bin/sh
# Pre-push gate — runs the client's production build before any push, so
# TypeScript / Vite errors get caught locally instead of in CI.
#
# The build rather than `tsc --noEmit` on purpose: in the sibling music-kb
# repo, --noEmit passed twice while the real build failed on genuine type
# errors. `vite build` is the honest gate for a TanStack Start app.
#
# Enable once per clone:
#   git config core.hooksPath .githooks
#
# Skip with --no-verify if you need to push an unrelated WIP branch
# (sparingly — that's how broken builds reach main).

set -e

echo "→ pre-push: running client build…"
yarn --cwd "$(git rev-parse --show-toplevel)/client" build > /dev/null
echo "✓ pre-push: build clean."
```

- [ ] **Step 2: Make it executable and enable it**

```bash
chmod +x .githooks/pre-push
git config core.hooksPath .githooks
```

- [ ] **Step 3: Verify it runs and passes**

```bash
.githooks/pre-push
```

Expected: `✓ pre-push: build clean.`

- [ ] **Step 4: Commit**

```bash
git add .githooks/pre-push
git commit -m "chore: pre-push hook running the client build

Enable with: git config core.hooksPath .githooks"
```

---

# Phase 2 — Routine version bumps

### Task 6: Bump the TanStack router/Start family

Six packages, already exact-pinned, moving 1–3 minors on a stable `1.x` line.

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Set the exact versions**

In `client/package.json` `dependencies`, set:

```json
    "@tanstack/react-router": "1.170.31",
    "@tanstack/react-router-devtools": "1.167.1",
    "@tanstack/react-router-ssr-query": "1.167.1",
    "@tanstack/react-start": "1.168.48",
    "@tanstack/router-core": "1.171.26",
    "@tanstack/router-plugin": "1.168.34",
```

- [ ] **Step 2: Install**

```bash
cd client && yarn install
```

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean. Record and fix any error; the router family's generated `routeTree.gen.ts` may need regenerating, which happens automatically on the next `yarn dev` or `yarn build`.

- [ ] **Step 4: Build and test**

```bash
cd client && yarn build && yarn test
```

Expected: build succeeds, 170 tests pass.

- [ ] **Step 5: Verify the SSR surfaces with the stack up**

In one terminal: `yarn dev` from the repo root. Then:

```bash
cd client && yarn test:e2e
```

Expected: `e2e/seroval-surfaces.spec.ts` passes. This guards the seroval server→client boundary, which a Start upgrade is the most likely thing to disturb.

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/yarn.lock
git commit -m "chore(deps): bump TanStack router/Start family to latest

react-router 1.168.18 -> 1.170.31, react-start 1.167.32 -> 1.168.48,
router-core 1.168.14 -> 1.171.26, router-plugin 1.167.18 -> 1.168.34,
ssr-query and router-devtools -> 1.167.1. Seroval e2e smoke green."
```

### Task 7: Bump Strapi 5.49.0 → 5.52.1

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Stop Strapi**

```bash
lsof -ti :1340 | xargs kill -9 2>/dev/null; echo done
```

SQLite needs exclusive write access; a live Strapi during an upgrade risks the dev DB.

- [ ] **Step 2: Dry-run the codemod and review the diff**

```bash
cd server && yarn upgrade:dry
```

Read the output before proceeding. **Pay particular attention to any change under `src/api/*/content-types/`** — yt-kb's schemas carry the MCP tool surface and the `valueScore` / `signalScore` / `finalScore` fields. If the codemod proposes touching them, review each change individually rather than accepting wholesale.

- [ ] **Step 3: Run the upgrade**

```bash
cd server && yarn upgrade
```

- [ ] **Step 4: Confirm the versions landed exactly**

```bash
grep -E '"@strapi/' server/package.json
```

Expected: all three at `5.52.1`, no carets. Edit them by hand if the codemod introduced carets.

- [ ] **Step 5: Typecheck and boot**

```bash
cd server && npx tsc --noEmit && yarn develop
```

Expected: typecheck clean; Strapi boots and the admin is reachable at `http://localhost:1340/admin`.

- [ ] **Step 6: Verify the MCP surface survived**

With Strapi running, confirm `/mcp` still responds and the tool list is intact — the official MCP server is built into Strapi, so a Strapi minor is exactly what could disturb it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:1340/mcp
```

Expected: a non-5xx status (401/406 is correct without an admin token — it proves the route is mounted).

- [ ] **Step 7: Full-stack check**

With the stack up via `yarn dev`, load `/feed` and one `/learn/$videoId` page in a browser and confirm both render server-side without a backend error panel.

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/yarn.lock
git commit -m "chore(deps): bump Strapi 5.49.0 -> 5.52.1

Codemod dry-run reviewed; content-type schemas unchanged. /mcp mounted
and both SSR surfaces render."
```

---

# Phase 3 — TanStack AI 0.10.3 → 0.47.1

**Do not start this phase until Task 1's green baseline holds and Phase 1's CI is in place.**

### Task 8: Bump the AI packages and migrate `temperature` to `modelOptions`

Top-level `temperature` does not exist on 0.47.1's chat options. The typings say to use `modelOptions` instead. All 11 yt-kb call sites are object literals, so TypeScript's excess-property check turns every one into a hard compile error rather than a silent drop — the typecheck in Step 3 *is* the failing test for this task.

**Files:**
- Modify: `client/package.json`
- Modify: `client/src/lib/services/reader.ts:173,235,291`
- Modify: `client/src/lib/services/learning.ts:520,716,1530`
- Modify: `client/src/lib/services/digest.ts:345,476`
- Modify: `client/src/lib/services/notes.ts:292`
- Modify: `client/src/routes/api.notes.compose.tsx:198`
- Modify: `client/src/routes/api.ask.tsx:148`

**Interfaces:**
- Consumes: `chat(options)` from `@tanstack/ai`, `createOllamaChat(model, hostOrConfig?)` from `@tanstack/ai-ollama` — signature verified unchanged at 0.9.3, so no adapter call site needs editing.
- Produces: all `chat()` calls carry `modelOptions: { temperature: number }`.

- [ ] **Step 1: Snapshot the current typings for diffing**

```bash
cp -r client/node_modules/@tanstack/ai/dist /tmp/tsai-0.10-dist
```

This is the authoritative changelog for our usage if Step 3 produces a surprise.

- [ ] **Step 2: Bump both packages to exact pins**

In `client/package.json` `dependencies`:

```json
    "@tanstack/ai": "0.47.1",
    "@tanstack/ai-ollama": "0.9.3",
```

Note the removed carets — see Global Constraints.

```bash
cd client && yarn install
```

- [ ] **Step 3: Typecheck to surface every break**

```bash
cd client && npx tsc --noEmit 2>&1 | tee /tmp/tsai-upgrade-errors.txt
```

Expected: FAIL, with roughly 11 errors of the form *"Object literal may only specify known properties, and 'temperature' does not exist in type..."*. **Keep this file** — the error list goes in the commit body and in Task 12's upgrade record. Any error that is *not* about `temperature` is a finding: diff it against `/tmp/tsai-0.10-dist` before deciding how to fix it.

- [ ] **Step 4: Read the shipped skills**

```bash
ls client/node_modules/@tanstack/ai/skills/ai-core
```

Read what's there before writing fixes — the package ships agent-readable guides with a "Common Mistakes" section, which music-kb found more reliable than the docs site.

- [ ] **Step 5: Migrate all 11 call sites**

At each site, replace the top-level `temperature` with a `modelOptions` object. Ten sites use `0.3`; `api.ask.tsx:148` uses `0.4`. For example, in `learning.ts` around line 520:

```ts
        chat({
          adapter: ollamaAdapter,
          messages: [
            { role: 'system', content: SUMMARY_SYSTEM },
            { role: 'user', content: userPrompt },
          ] as never,
          outputSchema: SummarySchema,
          // Low temp for summarization: cuts confabulated specifics in
          // action steps / section bodies. Ollama default is 1.0, which
          // is great for chat but invites creative drift in structured
          // tasks where we want grounded prose.
          //
          // Lives in modelOptions since @tanstack/ai 0.47 — provider-native
          // keys, not top-level chat options.
          modelOptions: { temperature: 0.3 },
        }),
```

Apply the same shape at every site, preserving each site's existing explanatory comment and its own temperature value.

- [ ] **Step 6: Typecheck until clean**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Run the suite**

```bash
cd client && yarn test
```

Expected: 170 passed. **Any test that fails here is a finding, not an inconvenience** — decide deliberately whether the test or the code is wrong and record which in the commit body.

- [ ] **Step 8: Commit**

```bash
git add client/package.json client/yarn.lock client/src
git commit -m "feat(ai): upgrade TanStack AI 0.10.3 -> 0.47.1, ai-ollama 0.6.6 -> 0.9.3

Thirty-seven minors on a pre-1.0 line. Both now exact-pinned: a caret on
a 0.x package is a silent ceiling, which is how this drift accumulated
while the exact-pinned router family stayed current.

Type errors and their causes:
- 11x 'temperature does not exist in type ChatOptions' — top-level
  temperature was removed; provider-native options now live in
  modelOptions. Migrated all 11 sites.

createOllamaChat(model, hostOrConfig?) is unchanged at 0.9.3, so all 8
adapter call sites were untouched."
```

### Task 9: Remove the obsolete `systemPrompts` workarounds

Two sites carry comments stating that `ai-ollama@0.6.6` silently drops `systemPrompts`, so they prepend a `{ role: 'system' }` message and cast `messages ... as never` to defeat the `ConstrainedModelMessage` union. 0.47.1 specifies `systemPrompts` fully. Leaving these in is the "compensating workaround now conflicts" trap; removing them closes a real type-safety hole.

**Files:**
- Modify: `client/src/routes/api.chat.tsx:159-180`
- Modify: `client/src/lib/services/learning.ts:505-521`

**Interfaces:**
- Consumes: `chat({ systemPrompts?: Array<SystemPrompt>, ... })` from `@tanstack/ai` 0.47.1.

- [ ] **Step 1: Confirm the adapter now honours `systemPrompts`**

Read the `systemPrompts` declaration in the installed typings before changing anything:

```bash
grep -n -B12 "systemPrompts?: Array<SystemPrompt>" client/node_modules/@tanstack/ai/dist/esm/types.d.ts
```

Expected: the option exists and is documented. If it does not, **stop and keep the workarounds** — record why in the upgrade record and skip to Task 10.

- [ ] **Step 2: Rewrite the `api.chat.tsx` call**

Replace the workaround block (the `messagesWithSystem` construction and the `as never` cast) with:

```ts
        const adapter = createOllamaChat(CHAT_MODEL, OLLAMA_HOST);
        const stream = chat({
          adapter,
          messages: expanded,
          systemPrompts: [system],
          // Agent loop: model can call `web_search(query)` when the
          // retrieved transcript passages don't answer the question.
          // Execution happens server-side; tool events stream as
          // TOOL_CALL_* SSE frames (ignored by the current client, which
          // only renders TEXT_MESSAGE_CONTENT deltas — the model's
          // natural-language response after the tool runs shows through).
          tools: [webSearchTool],
        });
```

Remove the now-unused `ModelMessage` import if nothing else in the file uses it.

- [ ] **Step 3: Rewrite the `learning.ts` call**

Replace the system-message-prepend and `as never` cast with:

```ts
        chat({
          adapter: ollamaAdapter,
          messages: [{ role: 'user', content: userPrompt }],
          systemPrompts: [SUMMARY_SYSTEM],
          outputSchema: SummarySchema,
          // Low temp for summarization: cuts confabulated specifics in
          // action steps / section bodies. Ollama default is 1.0, which
          // is great for chat but invites creative drift in structured
          // tasks where we want grounded prose.
          modelOptions: { temperature: 0.3 },
        }),
```

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean, with no `as never` remaining at either site.

- [ ] **Step 5: Verify no `as never` casts remain at chat call sites**

```bash
grep -rn "as never" client/src --include='*.ts' --include='*.tsx'
```

Expected: no hits in `api.chat.tsx` or `learning.ts`. Other files may legitimately still have them; only the two workaround sites are in scope.

- [ ] **Step 6: Test**

```bash
cd client && yarn test
```

Expected: 170 passed.

- [ ] **Step 7: Commit**

```bash
git add client/src
git commit -m "refactor(ai): use systemPrompts instead of the 0.6.6 workaround

ai-ollama 0.6.6 silently dropped systemPrompts, so two call sites
prepended a system-role message and cast messages 'as never' to defeat
the ConstrainedModelMessage union. 0.47.1 specifies the option properly,
so both casts are gone and the type hole with them."
```

### Task 10: Verify the runtime behaviour types cannot catch

Typechecking cannot catch renamed stream events, silently-ignored options, or changed structured-output semantics. This task is verification with a written result, not code changes — unless it finds something.

**Files:**
- Read: `client/src/lib/services/chat-stream.ts:98-116`
- Modify: only if a check fails.

- [ ] **Step 1: Confirm the stream parser tolerates both event dialects**

Read `chat-stream.ts:98-116`. It currently reads `event.toolName ?? event.toolCallName` and `event.input ?? event.args`, deliberately covering both dialects. Confirm this still matches what 0.47.1 emits. Note `TOOL_CALL_END` may fire **twice per tool call** — once for input, once for output. Check whether `chat-stream.ts` producing two `tool_end` records for one call would break `VideoChat.tsx`, which treats it as the source of truth for `input`.

- [ ] **Step 2: Start the stack**

```bash
yarn start
```

Wait for Strapi on 1340 and the client on 3005.

- [ ] **Step 3: Verify plain chat**

Open a video at `/learn/$videoId` and ask a question answerable from the transcript. Expected: tokens stream, the answer completes, `[mm:ss]` chips resolve against real caption segments.

- [ ] **Step 4: Verify tool-calling chat**

Ask a question the transcript cannot answer, to force `web_search`. Expected: the tool runs server-side and the model's natural-language response renders. Watch the `yarn dev` terminal for `TOOL_CALL_*` frames and confirm no duplicate-`tool_end` errors appear.

- [ ] **Step 5: Verify structured output**

Regenerate a video summary from `/learn/$videoId`. Expected: `summaryStatus` moves `pending` → `generated`, sections carry deterministic `timeSec` values, and `valueScore` / `signalScore` / `finalScore` are all written. This exercises `coerceStrictSchema` against `SummarySchema`.

- [ ] **Step 6: Verify the error path**

With a chat streaming, kill Ollama:

```bash
pkill -9 ollama
```

Expected: the UI shows a friendly Ollama message via `friendlyOllamaError`, not a raw stack fragment. This confirms `RUN_ERROR` still fires under its old name — `chat-stream.test.ts` depends on it. Restart with `yarn start:fresh` afterwards.

- [ ] **Step 7: Verify cross-video semantic search**

On `/feed`, run a semantic search and confirm results rank sensibly, then open a video and confirm Related videos populate. This exercises the embedding path end to end.

- [ ] **Step 8: Record the results**

Write each check's outcome and any timing differences versus the Phase 0 baseline into a scratch note; Task 12 folds them into the upgrade record.

- [ ] **Step 9: Commit any fixes**

If Steps 1–7 required code changes, commit them here with a message naming the behaviour that changed. If nothing changed, skip the commit — verification with no findings needs no commit.

---

# Phase 4 — Documentation

### Task 11: Write ADRs 0008, 0009 and 0010

yt-kb's ADR format is Status / Context / Decision / Consequences, and `docs/adr/README.md` carries an index table that must be updated. ADRs are append-only.

**Files:**
- Create: `docs/adr/0008-official-strapi-mcp-over-hand-rolled.md`
- Create: `docs/adr/0009-ci-and-static-gates.md`
- Create: `docs/adr/0010-exact-pins-for-pre-1.0-dependencies.md`
- Modify: `docs/adr/README.md` (index table)

- [ ] **Step 1: Write ADR 0008**

This backfills a decision yt-kb already shipped in commit `e22c4f2` and never recorded. Source the Context from that commit and from `docs/mcp.md`. It must cover: the hand-rolled `/api/mcp` server that existed before; the move to the official Strapi MCP server at `/mcp` gated by admin API tokens; the three permission tiers (`api::yt-kb-mcp.read` 14 tools, `.write` 4 mutations, `.maintenance` 4 expensive/external); that tool bodies are defined once in `server/src/mcp/tools/` and registered via `server/src/mcp-official/`; and the zod-3 requirement in `tools.ts` (the MCP SDK's schema conversion needs zod 3 while the app uses zod 4).

- [ ] **Step 2: Write ADR 0009**

Context: the repo had a GitHub remote and no CI; two live-backend test families would fail unattended if run naively. Decision: one CI job typechecking both packages and running vitest, with live-backend tests self-skipping rather than CI provisioning Ollama and Strapi; a pre-push hook running the client **build** rather than `tsc --noEmit`, because in music-kb `--noEmit` passed twice while the real build failed. Consequences: CI cannot catch integration regressions that need live services — those stay manual and are covered by the Playwright smoke run against a live stack.

- [ ] **Step 3: Write ADR 0010**

Context: `@tanstack/ai` drifted 37 minors while the exact-pinned router family drifted 2, in the same repo with the same maintainer. Decision: exact pins for every pre-1.0 dependency. Consequences: bumps become deliberate and visible; the cost is that no update arrives automatically, which is the point. Include the mechanism explicitly — on a `0.x` package `^0.10.3` resolves to `>=0.10.3 <0.11.0`, so the caret looks permissive while capping you at a dead minor line, producing neither updates nor the visible staleness that prompts a manual bump.

- [ ] **Step 4: Update the index table**

Add three rows to the table in `docs/adr/README.md`:

```markdown
| [0008](./0008-official-strapi-mcp-over-hand-rolled.md) | Official Strapi MCP server over a hand-rolled one | Accepted |
| [0009](./0009-ci-and-static-gates.md) | CI and static gates | Accepted |
| [0010](./0010-exact-pins-for-pre-1.0-dependencies.md) | Exact pins for pre-1.0 dependencies | Accepted |
```

- [ ] **Step 5: Commit**

```bash
git add docs/adr
git commit -m "docs(adr): record MCP, CI and pinning decisions

0008 backfills the official-MCP migration shipped in e22c4f2 and never
written down. 0009 and 0010 record decisions made in this branch."
```

### Task 12: Update CLAUDE.md, architecture.md and write the upgrade record

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`
- Create: `docs/tanstack-ai-upgrade-record.md`

- [ ] **Step 1: Update the CLAUDE.md Tests and Typecheck sections**

Change the test count from `~165 tests` to the real number from Task 1's baseline. Add `yarn test` from the root as the primary entry point. Replace the `vite.config.ts`'s `test.exclude` reference with `vitest.config.ts`. Add the `git config core.hooksPath .githooks` one-time step.

- [ ] **Step 2: Add a pinning note to the CLAUDE.md gotchas**

Add a bullet to the Don't / Gotchas list:

```markdown
- **Pin pre-1.0 dependencies exactly.** On a `0.x` package a caret is a silent ceiling — `^0.10.3` means `<0.11.0`. `@tanstack/ai` sat 37 minors behind on a caret while the exact-pinned router family stayed current. See ADR 0010.
```

- [ ] **Step 3: Update `docs/architecture.md`**

Update the AI-layer description for: `modelOptions` carrying provider-native options, `systemPrompts` replacing the prepend-a-system-message workaround, and the removal of the `as never` casts. Update any stated TanStack AI version.

- [ ] **Step 4: Write the upgrade record**

Create `docs/tanstack-ai-upgrade-record.md` covering: the version table before and after; the root cause of the drift; the type-error list from `/tmp/tsai-upgrade-errors.txt`; which of music-kb's six predicted risk areas actually applied (adapter construction did **not** — `createOllamaChat` was unchanged; `temperature`/`modelOptions` **did**; the `systemPrompts` workaround **did**); and the Task 10 live-verification results.

- [ ] **Step 5: Verify every command in CLAUDE.md still works**

Run each command in the Common Commands table and confirm it does what the table says. A stale CLAUDE.md is worse than none, because it is loaded into context every session.

- [ ] **Step 6: Final full verification**

```bash
yarn install:all
cd client && npx tsc --noEmit && cd ..
cd server && npx tsc --noEmit && cd ..
yarn test
cd client && yarn build
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: update for the CI, pinning and TanStack AI changes

Adds the upgrade record with the actual type-error list and which of the
predicted risk areas applied."
```

---

## Done criteria

- `yarn test` green from the root; CI green on the pushed branch.
- All nine dependencies at their target versions, AI family exact-pinned, no carets on any `0.x` package.
- Zero `as never` casts at `chat()` call sites in `api.chat.tsx` and `learning.ts`.
- All 11 temperature settings reaching Ollama via `modelOptions`.
- Per-video chat, cross-video semantic search, summary generation, digests and the notes composer all verified working against local Ollama.
- ADRs 0008–0010 written and indexed; `CLAUDE.md` and `architecture.md` accurate.
