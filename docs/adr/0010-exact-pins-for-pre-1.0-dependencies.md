# 0010. Exact pins for pre-1.0 dependencies

**Status:** Accepted

## Context

Auditing this branch's dependency ages surfaced a striking gap between two families in the *same repo, from the same maintainer*: the TanStack router/Start family (`@tanstack/react-router`, `react-start`, `router-plugin`, `react-query`-adjacent packages) and the TanStack AI family (`@tanstack/ai`, `@tanstack/ai-ollama`).

- The router family, already exact-pinned (no caret), had drifted **2 minors** behind current before this branch bumped it.
- The AI family, pinned with a caret (`^0.10.3`, `^0.6.6`), had drifted **37 minors** behind before this branch bumped it to `0.47.1` / `0.9.3`.

Both families are pre-1.0 (`0.x`). npm/yarn's semver caret behaves differently below 1.0.0: for a `0.x.y` version, `^0.10.3` resolves to `>=0.10.3 <0.11.0` — the caret only allows patch-level movement, capping at the same minor. It does not "float forward" the way `^1.10.3` would (which allows any `1.x` up to `<2.0.0`). This is standard semver-caret behavior, not a bug in the tooling, but it produces a specific, dangerous illusion: the version specifier *looks* permissive (a caret usually reads as "keep this reasonably current"), while it actually pins the package to one dead minor line forever, because `0.11.0`, `0.12.0`, ... never satisfy the range and `yarn install` silently keeps resolving the same old minor on every run. There is no error, no warning, and no visible staleness signal — `yarn.lock` looks fine, `yarn install` reports nothing wrong, and the only way to notice is to go looking.

The exact-pinned router family, by contrast, has its literal old version number sitting in `package.json` in plain sight every time that file is opened — which is what prompted its (comparatively modest) 2-minor bump. The caret's silence is what let the AI family run 37 minors past that.

## Decision

**Pin every pre-1.0 (`0.x`) dependency to an exact version — no caret, no tilde, no range.** This applies repo-wide, in both `client/package.json` and `server/package.json`, and to any new `0.x` dependency added in the future.

Concretely in this branch: `@tanstack/ai` and `@tanstack/ai-ollama` both moved from caret ranges to exact pins (`"@tanstack/ai": "0.47.1"`, not `"^0.47.1"`) as part of the same commit that bumped their versions. The already-exact-pinned TanStack router/Start family kept its existing convention.

## Consequences

**What we gain.**

- Every `0.x` dependency's currency is visible at a glance in `package.json` — no need to run `yarn outdated` or notice a lockfile anomaly to know a package is stale. The version number itself is the staleness signal.
- Bumping a pre-1.0 dependency becomes a deliberate, single-line diff with an obvious "before" and "after" — exactly the shape of diff that invites someone to actually read the changelog between those two points, which caret-driven silent drift never prompts.
- The failure mode this prevents is specifically the one that happened here: 37 minors of accumulated breaking change (a completely different `chat()` options shape, `systemPrompts` behavior, tool-call event framing) arriving all at once, instead of in reviewable increments.

**What we accept.**

- **No update ever arrives automatically for a `0.x` package**, including harmless patch releases that would have been safe to take. That is the explicit point of this ADR, not a side effect: for pre-1.0 software, "automatic" and "safe" are not the same claim, and a caret's promise of the latter was never actually backed by semver for these packages in the first place (a `0.x` minor bump carries no compatibility guarantee at all).
- Every `0.x` dependency now requires a human to notice it's stale and choose to bump it. Nothing in CI currently flags `0.x` staleness on a schedule; the discipline is manual, enforced by code review and by whoever next reads the affected `package.json`.
- This is a heavier process than pinning `1.x`+ dependencies with a caret, where the compatibility promise is real and floating patch/minor bumps is genuinely low-risk. Pre-1.0 and post-1.0 dependencies are deliberately treated differently under this ADR.

**What's enforced in code.**

- No `0.x` dependency should carry a caret (`^`) or tilde (`~`) range in either package's `package.json`. A PR introducing one should be corrected before merge.
- See `CLAUDE.md`'s Don't/Gotchas list for the day-to-day version of this rule.
