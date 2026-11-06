# Strapi Change-Spec Standard

**Applies to:** `06-change-spec.md` in existing-app mode, read together with the codebase.
**Based on:** EGM's implementation-readiness standard (the zero-decision rule and phasing), plus what changing a live Strapi app requires.

## Core principle

The spec passes if a coding agent with **this spec, the codebase, and the official docs** can make every change correctly on the first attempt — without making design decisions, and without breaking existing data or clients.

Severity guide: anything that could lose data, break a core flow, or leave a security hole open is a **Blocker**. Anything that forces the agent to guess is a **Major**.

## 1. Zero-decision rule

Flag every place where the implementer would have to choose: a field type, a route path, where logic lives, a library, an error or empty-state behaviour, a name.

## 2. Scope

- **Goals** list the user's change goals and the accepted review findings, by ID (for example `B-4`).
- **Every change traces to a goal.** Unrelated refactors or "while we're here" changes are a Major.
- **Non-goals** list the deferred findings.

## 3. Every change names its files

Each edit lists the exact files and the change, as code or a precise description. Paths to existing files must exist in the codebase; new files say where they go. A wrong or missing path is a Blocker.

- **New code compiles** under the project's own settings (check `tsconfig.json` — for example `"strict": true`): types of values passed between new and existing code match. Code that breaks the build is a Blocker.
- **Edit lists are complete**: when a spec lists lines to delete inside a function, every line that refers to something deleted is in the list. If that's hard to guarantee, replace the whole function.

## 4. Every caller is updated

A change to a schema, a route, a response shape, a permission, or an environment variable lists **every** place that uses it — frontend data helpers, components, seed scripts, tests, MCP tools — and updates them in the same milestone. A missed caller is a Major, or a Blocker if it breaks a core flow.

## 5. Data safety

- **Schema changes** say what happens to existing rows: default values, backfills. Strapi doesn't migrate data for a renamed or retyped field — the spec moves the data explicitly. Possible data loss is a Blocker.
- **Data migrations** go in `database/migrations` (they run on startup) or in a one-off script, and the spec says how to test them on a copy of real data.
- **New unique constraints** first find and merge existing duplicates.
- **Permission changes** are seeded in code (`bootstrap()`), not clicked in the admin panel.
- **Destructive steps** come with a backup step. Every milestone has a rollback — revert the commit and undo the data step — or says plainly that it can't be rolled back.

## 6. Milestones

- **Ordered:** data and schema before the code that needs them; backend before the frontend that calls it.
- **Each one leaves the app bootable**, and is committed on its own.
- **Each has a "Done when"** that a command, a request, or a test can check.

## 7. Verification

Each milestone says how to verify it: HTTP requests with the expected status, a test command, or a UI step. **Security fixes include a negative test** — for example, another user's record returns 403, or `?populate=*` returns no email.

- **A change to a frontend page or server handler is verified through the frontend** — a request to that page or handler, or a UI or end-to-end step — not only by calling Strapi directly. A milestone that changes a core-loop page also says what users see while it loads, with no data, and on error.

- **Security checks don't trust client-declared metadata.** An upload check uses the file extension **and** the file's bytes, not the multipart `Content-Type` alone; anything else is a Blocker (a file declared `image/png` can be HTML served from the Strapi origin).
- **Verification is safe to run.** No step deletes local data (use a scratch database, e.g. `DATABASE_FILENAME=.tmp/scratch.db`, or back up first), and every expected result can actually happen in the state the step sets up.
- **An agent can run every check.** A check set-up step that needs clicking in the admin panel (create an admin, tick a permission, set a field) also gets a scripted version: an API call, a CLI command, or a query against the scratch database. Otherwise it's a Major. This is for check set-up only: permissions the app needs are seeded in `bootstrap()` (§5).
- **Checks parse structured output.** Check JSON with `jq`, or with `node -e` if `jq` isn't installed, not `grep` on formatted text. A pattern like `"maxDuration":[0-9]*` misses `"maxDuration": 150`.
- **No production keys needed.** A path that calls a paid or third-party API is testable without real keys, and the spec says how:
  - the no-key command, with its expected status (the failure path);
  - for the success path and any race, the SDK's base-URL variable and the minimal response the local mock returns;
  - if the client has no base-URL setting, the stub to use.

  A check that only passes with a real key is a Major.

## 8. Header

- The **deviation protocol**: if the code makes a step wrong or impossible, stop and ask; don't improvise.
- **Docs lookup:** the `strapi-docs` MCP or https://docs.strapi.io, plus the frontend framework's docs.
- **Safety:** work on a branch, don't push, never use production data or credentials.
- **Environment:** the spec is written before anything runs, so runtime versions are "to be confirmed in the E8 baseline". E8 records the versions it used in `E8-implementation-log.md`. A claim that a version is required or unsupported cites a failure someone saw, or is marked "not verified". Neither the `engines` field nor a package manager refusing because of it counts as that failure.

## 9. Deployment

- Environment variables added, changed, or removed, for each environment.
- Deploy order (for example, the backend first when the frontend depends on a new endpoint).
- When migrations run, and any host-specific steps (Strapi Cloud, Docker).
