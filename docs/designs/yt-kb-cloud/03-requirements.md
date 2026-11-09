# Functional Requirements

> As-is — 2026-11-08. The features are those of
> `docs/designs/yt-knowledge-base/03-requirements.md` (2026-10-31), which
> this file does not repeat. This file records what this round changes:
> where each part runs, and the plugin that can replace
> `strapi-plugin-youtube-transcripts`. Revised 2026-11-08 after the owner
> moved the target from one host to any Strapi app (see "Change goals").

## Core features (as built)

Unchanged from the earlier run: share a YouTube URL, get a local-Ollama
summary with a verdict, a content score and transcript-grounded timecodes;
read and chat with a video; search and relate videos; notes and digests; a
public static site of the summary layer; an MCP server for frontier models.

## Parts of the product this round

| Part | Where it lives | Where it runs after this round |
|---|---|---|
| TanStack app (all AI, via Ollama) | `client/` in this repo | The owner's Mac |
| `strapi-plugin-yt-kb` (content types, REST, MCP tools, transcript fetcher) | `server/src/plugins/yt-kb/` in this repo; published to npm | Installed in whichever Strapi 5 app the owner chooses (the "host"), local or Strapi Cloud; this repo's `server/` loads it for local testing |
| Astro static site | `site/` in this repo | Built on the owner's Mac, deployed to Netlify |
| MCP clients (Claude) | — | Wherever the owner runs Claude; they call the host's `/mcp` |
| Reference only: `strapi-cloud-backend-main-site` | Another repo; local checkout `~/work/plugin-dev/strapi-prod` | Strapi Cloud, live production. Read for `strapi-plugin-youtube-transcripts` 2.6.2 and `strapi-plugin-tanstack-ai` 1.7.0 as installed there; not a target this round |

## Account & auth

No user accounts. Each caller has its own token: the app a Content API
token, the site a read-only Content API token, MCP clients an admin API
token. Nothing is granted to the Public role.

## Content the product manages

Unchanged: videos, transcripts, tags, notes, digests, now under
`plugin::yt-kb.*`. A host may also have `strapi-plugin-youtube-transcripts`
installed, with its own `youtube_transcripts` table.

## Integrations

- YouTube (captions and metadata), called from the host Strapi, through an
  optional residential proxy configured the way
  `strapi-plugin-youtube-transcripts` configures it (owner: "follow same
  shape" — a plugin `proxyUrl` setting defaulting to `PROXY_URL`).
- Ollama, called only from the TanStack app.
- `strapi-plugin-tanstack-ai`, when a host has it: its admin chat uses the
  tools other plugins contribute. The owner uses that chat with
  `youtube-transcripts`' tools today.

## AI / agent access (MCP)

The host's official Strapi MCP server at `/mcp`. yt-kb registers its tools
there. Claude uses `youtube-transcripts`' tools over MCP today; yt-kb must
offer the same capabilities.

## Change goals (this round)

In the owner's words (quotes have typos corrected). First recorded
2026-11-08, then revised the same day when the owner said: "don't worry
about main site just make sure plugin work I may put it in another Strapi
app". The revision replaces the earlier goals that named
`strapi-cloud-backend-main-site`.

1. Separate the Strapi code from the frontend: `strapi-plugin-yt-kb`,
   published to npm, installs and works in any Strapi 5 app, built for the
   latest Strapi ("Build for latest version": 5.61.0, published 2026-11-04,
   per `npm view @strapi/strapi`).
2. Whichever Strapi hosts the plugin is the source of truth for the data
   and the transcripts.
3. All AI stays local: the TanStack app runs on the owner's Mac with
   Ollama, pointed at the host's URL and token.
4. The Astro site builds from the host.
5. Parity with `strapi-plugin-youtube-transcripts` 2.6.2, so yt-kb can
   replace it in any app: "I don't mind removing it. And changing to using
   our new plugin instead. I just want parity from old plugin."
6. The `tanstack-ai` chat picks up yt-kb's tools when a host has that
   plugin, "similar how it picked them up for yt transcript plugin".
7. The proxy is configured the same way as in `youtube-transcripts`
   ("Follow same shape").
8. Agents work headless over MCP: Claude can add videos, fetch transcripts
   and read the library without the app running.

Deferred to the next round: bulk generation ("We can add bulk generation
after we finish this").

## Constraints

- **The target host is not fixed.** The plugin must not depend on any one
  app's content types, config or plugins (owner, 2026-11-08).
- **Live data:** the owner's library is in this repo's local Strapi
  (`server/.tmp/data.db`); `copy-content.mjs` moves it to a host. Backups
  exist (owner, 2026-11-08).
- **The public site's `/v/<youtubeVideoId>` URLs must keep resolving**
  (earlier run, `site/README.md`).
- **Local-first inference is non-negotiable**
  (`docs/adr/0001-local-first-no-cloud-ai.md`): Strapi computes no
  summaries and no embeddings.
- **Single-node generation:** the app dedupes generation in-process
  (`client/src/lib/services/generation-state.ts`).
- **Out of scope:** `strapi-cloud-backend-main-site` itself (its data, its
  other plugins, moving its `youtube_transcripts`
  rows, removing `youtube-transcripts` from it); the owner's main website
  frontend; the separate projects `health-app` and `music-kb`.

## Out of scope for this round

Bulk generation. Any change to the summary pipeline itself.
