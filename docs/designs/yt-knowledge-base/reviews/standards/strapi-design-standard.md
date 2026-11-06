# Strapi Design Standard

**Applies to:** `04-tech-decisions.md` and `05-tech-requirements.md` (stages 4–5), checked against `03-requirements.md`.
**Covers:** the whole product, not only the Strapi app: the Strapi backend, the frontend, any other apps (workers, other APIs), the outside services they call, and hosting.
**Based on:** EGM's feature-spec standard (alternatives, risks), plus the rules in `strapi-product-builder` — its content-modeling primer, build cookbook, auth, MCP, and frontend-framework references — and findings from this skill's test runs (`docs/field-notes/` in the plugin repo). Each check names the failure it prevents.

## Core principle

The design passes if an engineer new to the project can read 04 and 05 and know, for every requirement in 03, which content type, route, permission, page, and outside service delivers it — and if every decision that build agents usually get wrong, in Strapi v5 and in the chosen frontend, is already made.

Severity guide: a gap that would corrupt data, leak user data, or block the core loop is a **Blocker**. A gap that forces the build agent to guess is a **Major**. Wording and polish are **Nits**.

## 1. Decisions (`04-tech-decisions.md`)

- Every area records **Choice · Considered · Why**. A non-default choice with nothing under "Considered" fails EGM's alternatives rule (Major).
- Defaults (Strapi v5, PostgreSQL, Strapi Cloud, Users & Permissions) are stated as defaults; each override has a reason.
- The **frontend framework** is chosen explicitly. There is no silent default.
- **Auth:** Users & Permissions (default), or Better Auth with its status stated — beta and not for production per its maintainers, needs Strapi ≥ 5.45, requires removing Users & Permissions, and moves permissions to `plugin-api-permissions` (alpha).
- **MCP server:** off unless 03 asks for AI-agent access to content. If on: Strapi ≥ 5.49, admin-token scope, and whether agents do real work (then purpose-built tools with tokens scoped to them — the generic CRUD tools have overwritten content) or only browse.
- **Module layout:** `src/api/<name>` folders by default. Local plugins only with a stated reason: admin-panel UI, reuse across projects, or distribution.
- **Outside services:** each one is marked required or optional. Optional ones say how the feature degrades when the key is missing (disabled cleanly, core loop unaffected).
- **Reference repos**, if the user gave any: their conventions are recorded as binding, not "inspiration".

## 2. Coverage (03 → 05)

- Every core feature and every content item in 03 maps to a content type, component, custom route, or page in 05. An unmapped requirement is a **Blocker**.
- Everything in 05 traces to 03 or to a stated technical need. Anything else is a YAGNI candidate (Major).

## 3. Content model

For **every** content type: kind (collection or single), fields with Strapi field types, relations with target and cardinality, draft & publish yes/no, localized yes/no, and validations. Anything missing is a Major.

- **Who authors it** is stated per type: the team (admin panel) or end users (content API).
- Rich text uses `blocks`, unless the legacy Markdown `richtext` is wanted on purpose.
- Externally sourced strings (URLs, names from other systems) use `text`, not `string` — `string` has a 255-character validator that turns one long value into an ingest failure.
- Components hold embedded shapes with no life of their own; relations hold data that is edited or shared independently.
- Every `uid` / slug field that anything filters on has a generator in Document Service middleware. Slugs are only auto-filled by the admin panel, not by API, seed, or Document Service writes — a missing generator makes `?filters[slug]=` return nothing.
- Every field used as an identity key (`externalId`, slug, key) that is marked `unique: true` also has a real database unique index and a create-catch-refetch plan. `unique: true` is a validation rule only; Document Service, seed, ingest, and cron writes can create duplicates (Blocker if writes run concurrently).
- Users & Permissions path: an extension of the `user` type reproduces the full base schema plus the additions. An extension replaces the schema; it doesn't merge (Blocker — the base columns disappear).

## 4. Permissions and identity

Apply the checks for the auth path chosen in 04.

**Both paths:**

- A table of roles (Public, Authenticated, any custom) × actions (`find`, `findOne`, `create`, `update`, `delete`, uploads, each custom route) for every content type.
- Permissions for **both** Public and Authenticated are seeded in code, not clicked in the admin panel (clicks don't survive a fresh database).
- Server-set fields (`owner`, `author` = current user) are stamped in the **controller** through the Document Service — not taken from the request body (v5 rejects it with a 400) and not set in lifecycle hooks (no request context there).
- Per-record ownership uses an `is-owner` policy on `update` and `delete`. "Only my records" reads query the Document Service server-side, not with client filters on a private relation.
- Other users' identity in responses is trimmed to safe fields (`id`, `documentId`, a display name). No route lists all users.
- Authorization gates (plan limits, quotas, role checks) are route policies.

**Users & Permissions path (default):**

- The current user comes only from `/api/users/me`. `user.find` is never granted — it lets any signed-in user list every account's email.

**Better Auth path:**

- Permissions are described and seeded in `plugin-api-permissions` terms, because Users & Permissions is removed.
- The `user` content type's UID (from the Better Auth generate step) is stated, and so is how a controller reads the signed-in user.

## 5. Where logic lives

- Logic that needs the request or the signed-in user → **controller**.
- Document-level logic without a request (slugs, derived fields, notifications) → **Document Service middleware**, registered in `register()`.
- **Lifecycle hooks are not used for business logic** — they have no request context and fire twice on publish.
- An operation that writes two or more records (status + audit row + notification) runs in **one transaction on the service**, re-checks its guard inside the transaction, and keeps external side effects (email, Slack) outside it.
- Custom admin permission actions are registered in `register()`, not `bootstrap()` (otherwise every restart revokes them).

## 6. API and data fetching

- Default population uses **route middleware**, with separate list and detail profiles. Each middleware's UID matches its file location (`api::<api>.<name>` lives in `src/api/<api>/middlewares/`; `global::<name>` in `src/middlewares/`).
- Each custom route lists method, path, auth, request, and response.
- Webhooks: a route with `auth: false`, raw-body access for signature checks, and the user's identity carried in the provider's metadata.

## 7. Operations — the builder's robustness sweep

05 has an **Operations (robustness sweep)** section with one line per item: where it's specified in 05, or **N/A with a reason**. An item that is missing from that section is a Major (a Blocker if the product's value depends on it). An item marked N/A with a reason passes — the user decided it.

silent failures and a replay path · uniqueness under concurrency · cron overlap guard and retry cap · transactional workflow steps · session lifetime that matches the auth config (Users & Permissions refresh mode issues 10-minute access tokens) · user-data exposure · metric definitions · human correction loops · versioning of computed results · cost guards · aging and SLA visibility · audit trail · search · empty states.

- An N/A passes only its own sweep line. Rules in other sections still apply on their own terms; for example, §9 still asks for each core-loop page's states.
- In as-built documents (existing-app mode), a line that says "not handled" is graded like a missing item.
- "The product's value depends on it" (here and in §10) means the core loop can't complete without it.

## 8. Platform limits

- Background work uses Strapi cron (`config/cron-tasks.ts` with `cron.enabled` in `config/server`) or names an external worker. If the backend host is Strapi Cloud, there are no long-running workers.
- Environment variables are split into backend and frontend lists. Only browser-safe values use the framework's public prefix (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `NUXT_PUBLIC_`); server tokens never do.
- Version floors agree everywhere (for example MCP ≥ 5.49, Better Auth ≥ 5.45).

## 9. Frontend

Applies to every frontend in the product (usually 05's "Pages & components" and "State management" sections).

- **Every route is described.** The route tree uses the chosen framework's convention. For each route: who can open it (public, signed in, a role), where it fetches data (on the server or in the browser) and with which credential, and how it renders (built ahead, rendered per request, or in the browser). A missing route or a missing answer is a Major.
- **Published content reaches the live site.** Every page that is built ahead or cached and shows Strapi content says how it updates when an editor publishes: a rebuild, a time-based refresh, or a Strapi webhook that tells the frontend to refresh. Missing is a Major: editors publish and nothing changes.
- **The session is decided end to end:** where it is stored in the browser (an `httpOnly` cookie, or storage that scripts can read), which origin sets it, how each request sends it to Strapi (a cookie or a bearer header, from the frontend's server or from the browser), and what happens when it expires. Undecided is a Blocker if the product has sign-in.
  - When the frontend and Strapi are on different sites (for example `*.vercel.app` and `*.strapiapp.com`, which are separate public suffixes), cookies between them are third-party. The design picks one: a shared parent domain (this needs custom domains for both, because no cookie can be shared under `vercel.app` or `strapiapp.com`), proxying Strapi through the frontend's own origin, or bearer tokens. (Seen in a test run, where two reviewers flagged it as a Blocker.)
  - A session cookie is `httpOnly` and `secure`, with a `sameSite` value that fits the chosen option. A session token in storage that scripts can read is exposed to any injected script, so that choice needs a stated reason. Either gap is a Major.
- **Access is enforced on the server.** A redirect in the browser or a hidden link isn't access control. "Server-side handlers" below means everything in the frontend that runs on its server: pages rendered there, route handlers, server actions, server routes, and loaders.
  - Wherever private data is read, or a write is made on a user's behalf, on the frontend's server, that code checks the session first. Strapi's permissions back it up. Missing is a Blocker.
  - Where the browser calls Strapi directly with the user's own credential (always so in a frontend with no server of its own), Strapi's permissions are the access check; a guard in the browser only shapes what users see.
  - Sign-in, sign-up, and password-reset handlers, and code that only reads public content, need no session.
  - Handlers called by machines (a Strapi webhook, a schedule) check a shared secret or a signature instead.
- **Server-side handlers don't widen access.** Code that calls Strapi with an API token acts with that token's rights, for any visitor who reaches it. The design says which credential each handler uses and what it checks first.
  - A public read uses a read-only token. A full-access token there is a Major.
  - A Blocker: an API token used for a write, or reached by visitor input (path, `filters`, `populate`, `fields`, or body) passed through to the Strapi call, without a check of the user first.
- **Each core-loop page has its states:** what users see while it loads, when there's no data yet, and when a call fails (Strapi unreachable, permission denied, invalid input). A missing state is a Major. (Seen in a test run: undefined empty and error states left the build agent guessing.)
- **Public pages that need search traffic** (if 03 says so) say where each route's title, description, and share image come from. Missing is a Major.

## 10. Outside services and other apps

- **Every outside service is listed** (payments, email, AI, storage, search, analytics, any other API), with what it does, which side calls it (Strapi, the frontend's server, or the browser), and the name of the environment variable that holds its key. A key used from the browser must be one the provider publishes as browser-safe; anything else is a Blocker.
- **Every other app in the product is listed** (workers, other APIs, shared packages): what it does, what calls it, and what data it writes.
- **When a service the core loop depends on fails,** 05 says what users see and how the team finds out (a log line, an alert, a status an admin can see). Missing is a Major, or a Blocker if the product's value depends on that service. (Seen in a test run: a third-party transcript library failed for every request, and nothing showed it until the app was run.)
- **Each service has a test mode:** a sandbox or test key, a local mock through the SDK's base-URL setting, or, if the client has no such setting, a stub, so development and tests never need production keys. Missing is a Major.
- Webhooks are covered by §6, and cost guards by the robustness sweep (§7).

## 11. Hosting and environments

- **Every app has a host** (the Strapi app, each frontend, each worker). Overriding the builder's default for Strapi (Strapi Cloud) needs a reason.
- **The environments are listed** (local, any preview or staging, production), with the Strapi instance each frontend environment calls. A missing list is a Major. A preview or staging frontend that can write to production data needs a stated reason; without one, that's a Major too.
- **Strapi's CORS settings** allow exactly the origins whose browsers call Strapi directly, in each environment, or none when every call goes through the frontend's server or a proxy. Per-deploy preview URLs use a pattern that matches only the team's own preview domains, or go through the proxy. A wildcard (`*`, or any pattern that matches domains the team doesn't control, such as `*.vercel.app`) together with cookies or credentials is a Blocker. (Seen in a test run: CORS origins and `credentials` were left for the build agent to decide.)
- **CI and deploys:** what runs on each push (type check, tests, build) and how each app deploys, or "N/A — <reason>". Missing is a Major.

## 12. Risks

Every high-impact risk the design creates — data loss, account enumeration, runaway cost, a security hole — has a stated mitigation (EGM's risks rule). A missing mitigation for one of these is a Major. A separate "Risks" section isn't required if section 7 covers them.
