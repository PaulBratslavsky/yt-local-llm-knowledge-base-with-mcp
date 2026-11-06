# Functional Requirements

> As-is — 2026-10-31. Describes the product as it exists, not intentions.

## Core features (as built)

- **Share and summarise.** URL in, cached transcript, background
  generation with `summaryStatus: pending | generated | failed`
  (`client/src/lib/services/learning.ts`).
- **Hybrid content score.** `valueScore` (model) + `signalScore`
  (programmatic) → `finalScore`
  (`client/src/lib/services/content-signals.ts`, `videos.ts`).
- **Deterministic timecodes.** Section starts recovered by BM25 against
  transcript chunks (`docs/adr/0004-…`).
- **Per-video chat** over BM25 chunks with RRF fusion
  (`client/src/lib/services/chat-retrieval.ts`).
- **Cross-video discovery** by cosine over one embedding per video
  (`client/src/lib/services/embeddings.ts`).
- **Digests** of up to 5 videos, identified by `videoSetKey`
  (`docs/adr/0006-digest-upsert-by-video-set-key.md`).
- **Notes** attached to videos (`server/src/api/note/`).
- **Public static site** of the summary layer (`site/`).
- **MCP server** exposing 22 domain tools (`server/src/mcp-official/tools.ts`).

## Account & auth

None in the app. The Public role is granted read/create/update on every
content type in `server/src/index.ts`. The MCP server is the only gated
surface: admin API tokens, tiered by three custom permissions
(`api::yt-kb-mcp.read` / `.write` / `.maintenance`).

## Content the product manages

- **Video** — the central row: summary fields, three score fields,
  `watchVerdict`, repeatable components for takeaways, sections and action
  steps, `summaryEmbedding`, `passageEmbeddings`, `transcriptSegments`
  (the stored BM25 index), tags relation.
- **Transcript** — `rawText`, `rawSegments`, `durationSec`, one per video.
- **Digest** — structured synthesis plus `articleMarkdown`, keyed by
  `videoSetKey`.
- **Note**, **Tag** — annotations and taxonomy.

## Localization & drafts

Not used. All five schemas set `"draftAndPublish": false` explicitly and
carry an empty `pluginOptions`, so no i18n is configured
(`server/src/api/*/content-types/*/schema.json`).

## Integrations

- **Ollama** (local) for chat, embeddings and optional synthesis.
- **youtubei.js** for transcripts.
- **Netlify** for the static site.
- No cloud AI provider — forbidden by `docs/adr/0001-…`.

## AI / agent access (MCP)

The official Strapi MCP server at `/mcp`, Streamable HTTP, admin-token
gated. 22 domain tools defined once in `server/src/mcp/tools/` and
registered through `server/src/mcp-official/`.

## Non-functional requirements

Stated only for the static site
(`docs/superpowers/specs/2026-10-11-static-knowledge-site-design.md`):
search without a per-keystroke round trip, a build that fails rather than
publishing a partial library, no retrieval state in the output. Nothing
equivalent is written down for the app or the server.

## Change goals (this round)

In the owner's words:

1. **Review the app** for performance, user experience, and code
   updates or fixes. **The flow stays the same.**
2. **Make the app better suited for agents**, over MCP or a CLI.
3. **Bulk processing** — given a list of ~10 videos, either hand it to an
   agent or do it in the UI.

## Constraints

- **Live data.** 190 videos in SQLite (`server/.tmp/data.db`), the owner's
  real library. 185 generated, 4 pending, 1 failed.
- **The public site is live** at a Netlify URL with permanent
  `/v/<youtubeVideoId>` slugs; a pasted link must keep resolving
  (`site/README.md`).
- **MCP token grants are live and fragile.** One admin token holds all
  three tiers; a boot with MCP disabled previously deleted them
  (fixed in `72c1290`).
- **Local-first is non-negotiable** — no cloud AI adapters
  (`docs/adr/0001-…`).
- **Single-node assumption.** The in-process `generationInflight` Set
  dedupes generation; horizontal scaling would need a shared store
  (`client/src/lib/services/generation-state.ts`).
- **Out of scope for this review:** nothing lives in another repo; the
  product is this monorepo only.
