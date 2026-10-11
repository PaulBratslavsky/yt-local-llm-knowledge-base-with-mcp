# Static knowledge site — design

**Date:** 2026-10-11
**Status:** Approved for planning

## Intent

A static, searchable site built from the yt-kb library, used as a **fast
lookup while talking**. The author is reacting to a video or discussing a
related topic and wants the summary, the key points and the timecoded
sections in front of them within seconds. Other people landing on it
should be able to get the gist of a video without watching it.

That use shapes every decision below: finding the right video fast beats
visual polish, pages must be scannable rather than essays, and
tag-to-tag movement matters more than it would on a blog.

### Success criteria

- From a cold load, typing two or three words surfaces the right video
  without a network round trip per keystroke.
- A video page answers "is this worth my time, and what's in it" above the
  fold, and lets you jump into the video at a specific section.
- The build is one command against a running local stack, and publishing
  is one more.
- No retrieval state — embeddings, BM25 index, raw transcripts — ever
  reaches the published output.

### Stated by the author (not inferred)

- For themselves and for others who want a video's summary.
- Doubles as notes when reacting to videos or discussing related topics.
- Must include the readable article when one exists.
- Summary layer only; no raw transcripts.
- Prebuilt in-memory search index.
- Build locally, deploy the output.
- Deploy target: Netlify.
- Astro, following the pattern in
  `PaulBratslavsky/astro-strapi-example-project`.

### Assumptions (correct these if wrong)

- Publicly readable; no auth.
- Read-only. Videos are still added and summarized in the yt-kb app.
- Stale content between builds is acceptable.

## Architecture

### Package

`site/` becomes a third package beside `client/` and `server/`, following
the existing convention: its own `package.json`, its own `.env`, driven by
root scripts.

```
yarn site           # astro dev   (needs Strapi up)
yarn site:build     # astro build (needs Strapi up)
yarn site:deploy    # netlify deploy --prod --dir=site/dist
```

It was placed in the monorepo rather than a standalone repo because the
Astro zod schema **mirrors** the Strapi content type. Across two repos
that mirror drifts silently — the same failure this project just removed
from the MCP layer (issue #16), where a schema declared in two places
meant only one of them was enforced. Here, adding a Strapi field and
surfacing it on the site is one diff. If the site is ever wanted as a
standalone example repo, extracting `site/` is a clean cut; re-merging two
drifted copies is not.

### Stack

Matching the reference project (`astro-strapi-example-project`) so the
pattern stays one pattern:

| Package | Version | Why |
|---|---|---|
| `astro` | 6.x | Zero-JS by default, which suits 172 near-static pages. |
| *(inline content-layer loader)* | — | Build-time Strapi to content collections. The reference project uses `strapi-community-astro-loader`, whose latest release (4.0.0) pins `engines.node` to `~22.14.0` — one Node minor, and this repo runs 24. ~40 lines of `fetch` in `site/src/lib/strapi.ts` replace it, which also puts the field allowlist under test rather than inside a dependency. |
| `tailwindcss` + `@tailwindcss/vite` | 4.x | As in the reference. |
| `minisearch` | latest | In-memory index. |
| `marked` | 15.x | Renders `readableArticle` and `summaryOverview` markdown. |

**Pin any pre-1.0 dependency exactly** (ADR-0010): on a `0.x` package a
caret is a silent ceiling, not a float.

### Data flow

Build-time fetch only. No runtime calls to Strapi, no API keys in the
output.

```
Strapi (localhost:1340)
  → site/src/lib/strapi.ts         (fields allowlist)
  → Astro content collections      (zod schema mirrors the content type)
  → static pages + search-index.json
  → netlify deploy
```

### The field allowlist is the privacy mechanism

The loader requests an explicit `fields[]` list, and `buildVideoQuery`'s
tests assert that no forbidden name appears anywhere in the query it builds. `transcriptSegments`,
`summaryEmbedding` and `passageEmbeddings` are never named, so they cannot
appear in the output even by accident. This matters: those three fields
are server-side retrieval state, they are the bulk of a Video row, and
`passageEmbeddings` alone would dwarf the entire site.

Published per video: `youtubeVideoId`, `url`, `videoTitle`, `videoAuthor`,
`videoThumbnailUrl`, `summaryTitle`, `summaryDescription`,
`summaryOverview`, `watchVerdict`, `verdictSummary`, `verdictReason`,
`finalScore`, `summaryGeneratedAt`, `readableArticle`, plus the
`keyTakeaways`, `sections` and `actionSteps` components and the `tags`
relation (name only).

Only videos with `summaryStatus === 'generated'` are published.

### Measured size

From the current library (172 generated videos):

| Payload | Size |
|---|---|
| Summary layer including readable articles | 667 KB |
| Summary layer without articles | 307 KB |
| Search-index projection | ~131 KB before takeaways and sections |

49 videos have a readable article, averaging 7.2 KB. The whole corpus is
smaller than a typical hero image, which is why an in-memory search index
is the right call rather than a chunked or server-backed one.

## Pages

| Route | Purpose |
|---|---|
| `/` | Search-first landing. Search focused on load; recent and top-scoring videos below. |
| `/v/[youtubeVideoId]` | The video page. |
| `/t/[tag]` | Topic page — every video carrying that tag. |
| `/articles` | The subset with a readable article, which read like posts. |
| `/404` | Not found. |

### Slugs are the YouTube video id

Not a title slug. Summary titles change when a summary is regenerated; the
video id never does. A link pasted into a conversation months ago still
resolves.

### Video page content order

Answer "is this worth my time" first: verdict, content score, one-line
description. Then overview, key takeaways, sections, action steps, tags.
The readable article, where present, renders in full below that.

### Sections deep-link into the video

Each section carries a `timeSec` recovered deterministically from the
transcript (ADR-0004). The page renders it as a link to
`https://www.youtube.com/watch?v=<id>&t=<timeSec>s`. This is the feature
that serves the stated use: find the section, click, land on the moment.

Sections without a `timeSec` render as plain headings — the generation
pipeline deliberately leaves a section ungrounded rather than inventing a
timecode, and the site must not invent one either.

## Search

A build step emits `search-index.json` covering: summary title, video
title, author, description, overview, key takeaway text, section headings
and tag names. Expected size 150–250 KB.

One Astro island loads the index and runs MiniSearch in memory. Every
other page ships zero JavaScript. Facets: tag, verdict, score range.
Cmd-K opens search from any page.

In-memory rather than Pagefind because the corpus is small enough to fit
comfortably, facets are a first-class need for "discussing related
topics", and ranking stays under our control.

**Not semantic search.** That needs Ollama at request time and cannot be
static. Keyword search over the summary layer is the trade; the app
remains the place for semantic and moment search.

## Build and deploy

`yarn site:build` requires the stack running. If Strapi is unreachable the
build **fails loudly** rather than emitting a half-empty site — a
successful build that silently dropped half the library is the worst
outcome available here, and the same "don't swallow errors into empty
data" rule the app follows (ADR-0007).

Deploy is `netlify deploy --prod --dir=site/dist`.

## Verification

1. **Output guard.** A post-build assertion that no built file contains
   `summaryEmbedding`, `passageEmbeddings`, `transcriptSegments`, or raw
   transcript text. The allowlist is the mechanism; this proves it held.
   Modelled on the seroval-safety tests, which lock a boundary rather than
   a function.
2. **Schema mirror.** The zod schema fails the build when a required field
   is missing from the Strapi response, so a renamed Strapi field breaks
   the build rather than silently emptying a page.
3. **Build smoke.** After a build: expected page count, a spot-checked
   video page containing its takeaways and at least one timecoded section
   link, and a search index that returns the right video for a known
   query.

## Out of scope

- Notes (11) and digests (6). Clean additions later.
- Raw transcripts — excluded deliberately, both for size and because they
  are other people's spoken words.
- Any write path. The site is read-only; content is authored in the app.
- Semantic or moment search.
- Auth.

## Risks

- **Stale content.** The site shows the last build. Accepted; publishing
  is a deliberate act.
- **Schema drift within the repo.** Mitigated by co-location and the
  build-failing zod schema, not eliminated.
- **Publishing requires the laptop** with Strapi running. Accepted — it is
  where videos get added anyway. If this becomes a constraint, the upgrade
  path is a content snapshot committed to the repo so CI can build without
  Strapi.
