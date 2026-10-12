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
the home page. Every other page ships no external JavaScript; Cmd-K from one
of them navigates here.

## Local ports

`yarn site` serves on **4330**, not Astro's default 4321.

## Checks

```bash
yarn site:test              # 76 unit tests, no stack needed
cd site && npx astro sync && npx tsc --noEmit  # typecheck
yarn site:build             # build + output guard
```
