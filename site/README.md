# yt-kb static site

A static, searchable build of the knowledge base summary layer.

## What it publishes

Per video: title, author, verdict, content score and the reason behind it,
overview, key
takeaways, sections with timecoded links into the video, action steps, tags,
and the readable article when one exists. No thumbnails — the allowlist
carries only fields the pages actually render.

It does **not** publish raw transcripts, embeddings, or the BM25 index. The
`fields[]` allowlist in `src/lib/video.ts` is the mechanism, applied by the
loader in `src/lib/strapi.ts`; `scripts/verify-output.mjs` fails the build if
anything slips through.

## Build

The build reads Strapi at `STRAPI_BASE_URL` (default
`http://localhost:1340/api`), so the stack must be running:

```bash
yarn start        # from the repo root, in another terminal
yarn site:build   # from the repo root
```

The build fails if Strapi is unreachable, returns an error, or returns no
videos, rather than publishing an empty site.

## Deploy

```bash
yarn site:deploy  # netlify deploy --prod --dir=dist
```

First time only: `npx netlify login && npx netlify link`.

## Search

`/search-index.json` is emitted at build time from the summary layer — 380 KB
raw, 133 KB gzipped for 172 videos — and loaded once by the search island on
the home page. Cmd-K focuses it, or navigates here from a page without it.

## JavaScript

Three small islands, all plain `.ts` bundled by Astro — no framework runtime:

| Island | Where | What it does |
|---|---|---|
| `theme-client.ts` | every page | The light/dark toggle. The theme itself is painted by an inline script in `<head>` so there is no flash. |
| `player-client.ts` | video pages | Click-to-seek. Talks to the YouTube embed over its own `postMessage` protocol rather than loading YouTube's API script. |
| `search-client.ts` | `/` and `/404` | MiniSearch over the prebuilt index, plus the facets. |

Only the search island is big enough for Astro to emit as a separate file;
the other two inline. A tag page ships the theme island and nothing else.

## The video page

Notes on the left, the player pinned on the right. Every timecode — the
chips in the walkthrough and the rows in the chapter rail — carries
`data-seek`, and one delegated listener drives the player, so a new timecode
anywhere needs no extra wiring. The embed ignores commands until the page
announces itself with a `listening` message, which is why `player-client.ts`
sends one on load and before every command.

A shared `?t=` link opens at that moment: the client rewrites the iframe src
rather than seeking, because a command posted before the player has loaded is
dropped.

## Local ports

`yarn site` serves on **4330**, not Astro's default 4321.

## Checks

```bash
yarn site:test              # 96 unit tests, no stack needed
cd site && npx astro sync && npx tsc --noEmit  # typecheck
yarn site:build             # build + output guard
```
