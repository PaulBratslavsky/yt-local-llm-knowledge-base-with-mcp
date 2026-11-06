# As-Built Standard

**Applies to:** `04-tech-decisions.md` and `05-tech-requirements.md` in existing-app mode, checked against the codebase.
**Based on:** EGM's re-implementation standard, narrowed to what the design review needs.
**Covers:** the whole repo: the Strapi app, every frontend, and any other apps (workers, other APIs, shared packages).

## Core principle

The documents pass if every statement is true of the code at the cited commit, and nothing that the design standard asks about is silently missing.

## 1. Accuracy

Every claim matches the code, and the cited file exists and actually says that. A wrong claim is a **Blocker** if it concerns the data model, auth, or permissions, and a **Major** otherwise.

## 2. Citations

Every claim cites a file path. An uncited claim is a Major.

## 3. Coverage

Each of these appears in the documents if it exists in the code. A missing one is a **Major**, or a **Blocker** if it is auth, permissions, or code that writes data:

- content types, components, and extensions of plugin types (such as the Users & Permissions `user`);
- custom routes and controller overrides;
- policies and middlewares (route, global, and Document Service);
- lifecycle files;
- cron tasks;
- local plugins;
- auth setup and any permission seeding;
- environment variable names from `.env.example` and the code;
- every app and package in the repo, with its root folder and what it does;
- each frontend's full route tree: for each route, who can open it, where it fetches data and with which credential, and how it renders or caches;
- server-side handlers in each frontend (route handlers, server actions, server routes, API routes) and what each checks before it reads or writes;
- the session from sign-in to expiry: where it's stored, how each request sends it, and where it's checked;
- outside services: which code calls each one, the environment variable that holds its key, and what the code does when the call fails;
- Strapi's CORS settings, and the hosting and deploy configuration (Dockerfile, CI workflows, host config files such as `vercel.json` or `netlify.toml`);
- the tests that exist, and what they cover.

## 4. Unknowns are flagged, not guessed

Facts the code can't show — permissions set in the admin panel, data in the database, hosting settings, webhooks and deploy hooks — are marked `⚠️ not in code`. Claims that depend on how the installed framework behaves, such as a framework's default caching, are marked `⚠️ framework behavior`. A guess written as fact is a Major.

## 5. Description, not judgment

The documents describe what the code does. Evaluations ("insecure", "should be") belong in review findings, not here. Each one is a Nit.

## 6. Versions

The Strapi version, each frontend framework's version, the Node engine, and key package versions match each app's `package.json` and the lockfile. The Node engine is written as *declared* ("`engines`: ≤ 22"), never as tested support, unless someone actually ran it.
