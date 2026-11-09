# Review log — yt-kb-cloud

Run: existing-app mode, strapi-product-egm 0.3.2, EGM plugin `egm@strapi-product-egm` 0.1.0. Repos: `yt-knowledge-base` @ `721f210`; reference install `strapi-cloud-backend-main-site` @ `c3d0b74`.

## 2026-11-08 — E1 interview

- Goals recorded, then revised the same day: the target moved from one host (`strapi-cloud-backend-main-site`) to "any Strapi app" (03, "Change goals"). Owner: "don't worry about main site just make sure plugin work I may put it in another Strapi app".
- Owner answers: build for the latest Strapi (5.61.0); proxy configured the same way as `youtube-transcripts`; backups exist; bulk generation next round.

## 2026-11-08 — Checkpoint R (reconstruction), run twice

- Run 1: 4 Blockers, 21 Majors, 10 Nits. Most were gaps (Users & Permissions, Content Manager's MCP tools for yt-kb types, missing handlers, CORS/body/API config, root scripts, plugin build step), some wrong citations. All factual fixes applied; main-site-only items declined as out of scope.
- Run 2: 1 Blocker (admin panel sign-in missing from Auth/Session), 6 Majors, ~12 Nits. Applied. One claim contested with evidence: Content Manager registers its MCP tools in `bootstrap()` on both 5.52 and 5.60.
- Report: `reviews/R-reconstruction-review.md`.

## 2026-11-08 — Checkpoint B (design)

- Five reviewers in parallel. Merged: 5 Blockers, 21 Majors, Nits. Report: `reviews/B-design-review.md`.
- Elephant checks: no unique index on yt-kb's keys in the local SQLite (B-2 confirmed); `new URL()` resolves `…/videos/../../users?` to `/api/users?` (B-1 confirmed); `@strapi/utils` loads `zod/v4` on 5.52.1 too (corrected the docs' "zod 3").
- Owner decisions (E5): all Blockers and Majors plus the goals; app stays local and single-user with a scoped token and a 127.0.0.1 pin; tool names `yt_kb__<snake_case>`; parity = hardened fetcher + proxy check, extra metadata, REST fetch-or-return route, per-tool permissions replacing the tiers; the plugin owns search, builds a model-free transcript index and grounds `saveSummary` timecodes. Nits deferred.

## 2026-11-08 — E6/E7 change spec and checkpoint C

- 06 written from a contract of shared decisions; four helpers drafted M1–M7 in parallel; an integration pass applied 15 resolutions (incl. owner-added **B-6**, chat retrieval).
- Checkpoint C: 2 Blockers / 7 Majors / ~10 Nits, all applied; one re-run: 0 Blockers, 10 Majors, 12 Nits, all applied. Reports: `reviews/C-change-readiness-review.md`.
- Owner: implement now (E8) on `egm/yt-kb-any-strapi`; local env files point at no production service (owner, 2026-11-08).

## Lessons

- **L1 — Don't put lockfiles in a reviewer's "read in full" list.** The first fact-checker run read `site/yarn.lock` partway, found three lockfiles (~600K tokens) would not fit, and correctly stopped with no findings. Re-run with lockfiles as "search as needed" worked. Fix for `references/checkpoints.md`: in the fact-checker's code-aware prompt, list lockfiles under a separate "search as needed" line.
- **L2 — A target change mid-run is a contradiction, and the as-built docs should name a reference install as such.** The owner moved the target from one host to "any Strapi app" after E1. Recording main-site as "reference only" in 03/04/05 kept the reviewers from auditing a host that is out of scope.
- **L3 — The Elephant should filter reviewer findings before relaying them.** Relaying an out-of-scope finding (another plugin's OAuth sign-in) cost the owner three turns of "why are you asking this". Apply the scope in 03 before telling the owner about a finding.
- **L4 — Check "framework behavior" claims in both directions.** Two reviewers asserted opposite things about zod in `@strapi/utils`; the installed `dist/index.js` settled it in one line. The as-built writer had copied a stale code comment.
- **L5 — Parallel drafting needs a contract first, and an integration pass after.** Four helpers drafting milestones from one contract produced ~8,000 consistent-enough lines in one round; the integration pass still found 15 cross-milestone conflicts (duplicate action registration, two bootstrap files, two check kits, conflicting error shapes). Budget the integration pass as its own step.
- **L6 — Check-time safety must follow the spec's own changes.** Once M3 made the plugin call out through `PROXY_URL` at boot, every later scratch boot needed a dead proxy; only the C re-run caught that M5–M7 lacked it. When a milestone adds an outbound call, add the neutraliser to the shared check conventions in the same edit.
