# 0009. CI and static gates

**Status:** Accepted

## Context

The repo had a GitHub remote and no CI at all — no typecheck, no test run, nothing gating a push or a pull request. Two problems had already gone unnoticed as a result:

- `client/vite.config.ts` imported `defineConfig` from `vitest/config`, which types its plugin array against vitest's own nested copy of Vite. That copy collided with the client's real Vite 8, producing 6 typecheck errors (`'tsconfigPaths' does not exist`, `Plugin<any>` incompatibilities) that sat invisible because nothing ran `tsc --noEmit` in CI or as a gate. The sibling repo music-kb hit the identical symptom for the identical reason, which is independent corroboration this is a real, recurring trap in this stack rather than a one-off.
- `videos.smoke.test.ts` has a tag-creation test that fails when Strapi is live (Strapi core doesn't auto-populate `uid` fields outside the admin UI) and self-skips when Strapi is down — so it had been silently skipping on every local run, hiding a real bug. music-kb found the same class of bug the week it added its own CI.

Adding CI meant deciding what it could realistically check. Two of the app's test families need live external services: `embeddings.ranking.test.ts` needs a reachable Ollama, and `videos.smoke.test.ts` needs a reachable Strapi. Provisioning either in a GitHub Actions runner (installing Ollama, pulling models, booting Strapi against a scratch SQLite DB) is real infrastructure for a personal-scale project, and the smoke test above shows that "live Strapi" isn't even a strictly stronger check — it surfaces a different, unrelated bug.

Separately, a local pre-push gate was wanted so type errors and build failures are caught before they reach the remote at all, not just after CI runs on a pushed branch. music-kb had already tried the naive version of this and hit a hole: `tsc --noEmit` passed twice on a change where `vite build` genuinely failed, because `--noEmit` and Vite's own bundling/transform pipeline don't check exactly the same things (module resolution edge cases, asset imports, and dead code that Rollup's tree-shaking touches can differ from what the TypeScript compiler alone sees).

## Decision

**One CI workflow, two static gates, and live-backend tests self-skip rather than CI provisioning services for them.**

- **CI** (`.github/workflows/ci.yml`): a single job on push to `main` and on pull requests. Three separate `yarn install --frozen-lockfile` steps (root, `server/`, `client/`) since the two packages are not a workspace and share no `node_modules`. Then `npx tsc --noEmit` in `client/`, `npx tsc --noEmit` in `server/`, and `yarn test` from the root (which delegates to `yarn --cwd client test`). No `continue-on-error`, no `|| true` — every step is a real gate.
- **Live-backend tests self-skip, not CI-provisioned.** `embeddings.ranking.test.ts` and `videos.smoke.test.ts` both probe their dependency (Ollama / Strapi) at the top of the file and skip if it's unreachable, rather than CI installing and booting Ollama or Strapi as services. This means CI's green suite count is measured with **both dependencies down** — currently 181 passed.
- **Pre-push hook runs the client `vite build`, not `tsc --noEmit`.** `.githooks/pre-push` runs `yarn --cwd client build` before every push and aborts the push on failure (`set -e`). This is deliberate, not an oversight: `--noEmit` and the real build check different things, and music-kb had `--noEmit` pass twice while `vite build` failed for real. The build is the honest gate for a TanStack Start app — it's what actually has to succeed for the app to ship. The hook is opt-in per clone (`git config core.hooksPath .githooks`) since git doesn't auto-enable custom hook paths, and is skippable with `--no-verify` for a deliberate WIP push.

## Consequences

**What we gain.**

- The six typecheck errors and the tag-creation bug are now both visible and documented rather than silently tolerated — CI would fail loudly on a regression of the first; the second is recorded as a known, pre-existing gap (see the CLAUDE.md gotcha and Task 7's ledger entry) rather than an invisible skip.
- Every push gets a real build check locally, before CI even runs, catching the class of error `--noEmit` alone misses.
- CI installs are cheap (three lockfile-pinned installs, no service containers) and fast, which keeps the feedback loop tight for a personal-scale project.

**What we accept.**

- **CI cannot catch integration regressions that need live services.** A change that breaks the actual Ollama request shape, or Strapi's live behavior under the admin UI vs. a bare API call, will not fail CI — it will only fail if someone runs the suite locally against a live stack (and, per the tag-creation case, might fail for an unrelated pre-existing reason when they do). This class of regression is covered only by the Playwright e2e smoke (`yarn --cwd client test:e2e`), which explicitly assumes a live stack and is run manually, not in CI.
- The pre-push hook is local and opt-in — a clone that never runs `git config core.hooksPath .githooks` gets no local gate at all, only the remote CI check after pushing.
- "Green suite" is an environment-dependent claim: 181/181 with both dependencies down is not the same guarantee as 181/181 with them live. Anyone quoting the test count should say which environment it was measured in.

**What's enforced in code.**

- New tests that need Ollama or Strapi must self-skip when the dependency is unreachable, following the existing pattern in `embeddings.ranking.test.ts` / `videos.smoke.test.ts` — CI must never hang or flake waiting on an absent service.
- CI steps must not use `continue-on-error` or `|| true`; a red step should fail the job.
