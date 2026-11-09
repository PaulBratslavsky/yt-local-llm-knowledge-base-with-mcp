# yt-kb static site

A static, searchable build of the knowledge base summary layer.

## What it publishes

Per video: title, author, verdict, content score and the reason behind it,
overview, key takeaways, sections with timecoded links into the video,
action steps, tags, and the readable article when one exists. Thumbnails
come straight from YouTube (`i.ytimg.com/vi/<id>/hqdefault.jpg`, built from
the video id in `src/lib/player.ts`), so the allowlist does not fetch
`videoThumbnailUrl`.

It does **not** publish raw transcripts, embeddings, or the BM25 index. The
`fields[]` allowlist in `src/lib/video.ts` is the mechanism, applied by the
loader in `src/lib/strapi.ts`; `scripts/verify-output.mjs` fails the build if
anything slips through.

## Build

The build reads Strapi at `STRAPI_BASE_URL` (default
`http://localhost:1340/api/yt-kb`, the plugin's REST prefix) with the token
in `STRAPI_API_TOKEN`, both from `site/.env`, so the Strapi host must be
running:

```bash
yarn start        # from the repo root, in another terminal
yarn site:build   # from the repo root
```

`STRAPI_API_TOKEN` is the `yt-kb-site` custom token — find on videos and
tags, nothing else. Create it once with the plugin's token script, from the
Strapi app root (`server/` here):

```bash
node src/plugins/yt-kb/scripts/create-tokens.cjs --out-app <file> --out-site <file>
```

(`node node_modules/strapi-plugin-yt-kb/scripts/create-tokens.cjs …` in an
app that installed the plugin from npm), then paste the contents of the
`--out-site` file into `site/.env`. If a `yt-kb-site` token already exists,
add `--rotate yt-kb-site`: the script revokes it and creates it fresh
(without that flag it skips an existing name). Don't use a Read-only
token: on a host with Users & Permissions it can also read `/api/users`.

The build fails if Strapi is unreachable, answers with an error (a missing
or wrong token is a 403), returns fewer videos than it reports, or has no
video with a generated summary — rather than publishing an empty or partial
site.

## Publishing a content update

The site shows the library as of the last build, so new or regenerated
summaries need a republish. One command, from the repo root, with the stack
running:

```bash
yarn site:publish         # rebuild, deploy live
yarn site:publish:draft   # same, but to a preview URL
```

It refuses to publish rather than ship something wrong: the build stops on
an unreachable Strapi, a short read or an empty library, and the script
stops if `site/` is not linked to Netlify.

`yarn site:deploy` also rebuilds and deploys live, without the draft option
or the link check — prefer `yarn site:publish`.

**Run the Netlify CLI from `site/`, never the repo root.** It reads the linked
project from its working directory, not from `--dir`: at the root it finds no
link and creates a brand new project instead of updating this one. `publish-site.sh`
handles this, and refuses to run if `site/.netlify/state.json` is missing.

First time only: `cd site && npx netlify login && npx netlify link`.

## Search

`/search-index.json` is emitted at build time from the summary layer — one
document per video (`src/lib/search-docs.ts`), so it grows with the library;
`yarn site:publish` prints its size after each build — and loaded once by the
search island on the home page. Cmd-K focuses it, or navigates here from a
page without it.

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
yarn site:test              # 107 unit tests, no stack needed
cd site && npx astro sync && npx tsc --noEmit  # typecheck
yarn site:build             # build + output guard
```
