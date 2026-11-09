# YT Knowledge Base

> As-is — 2026-11-08. Carried over from `docs/designs/yt-knowledge-base/01-product.md` (2026-10-31): the owner raised no change to the product, its users or its core loop this round. What changes is where the parts run — see `03-requirements.md`, "Change goals".

## One-liner

A personal knowledge base that turns YouTube videos into summarised,
timecoded, searchable notes using local inference only, with a public
static site for sharing the summary layer and an MCP server so frontier
models can query and add to the library. This round moves its data and its
Strapi code into a plugin (`strapi-plugin-yt-kb`) that installs in any
Strapi 5 app, while all AI stays on the owner's Mac.

## The problem

Watching a long technical video costs 20–60 minutes, and most of it is not
worth the time. Afterwards the useful part is unfindable: it is inside a
video, not in any text the owner can search. Existing options either send
the transcript to a cloud model (`docs/adr/0001-local-first-no-cloud-ai.md`
rejects this) or produce a summary with no way back to the moment that
supports it.

## The value

- **Decide before watching.** Each video carries a verdict
  (`worth_it` / `skim` / `skip`) and a 0–100 content score
  (`client/src/lib/services/videos.ts`).
- **Find the moment, not the video.** Every summary section carries a
  `timeSec` recovered from the transcript by BM25, never written by the
  model (`docs/adr/0004-deterministic-timecodes-not-llm-generated.md`).
- **Ask the library.** Per-video chat over BM25 chunks and cross-video
  semantic search over per-video embeddings
  (`docs/adr/0003-bm25-for-chat-embeddings-for-discovery.md`).
- **Nothing leaves the machine.** Inference and embeddings run on a local
  Ollama (`docs/adr/0001-local-first-no-cloud-ai.md`).

## Product category

A personal knowledge tool with three surfaces: a local web app, a public
static publication, and an MCP server for agents.

## What success looks like

Not stated in the repo. ⚠️ not in code — the owner has never written
success criteria for the product as a whole; the static site's spec
(`docs/superpowers/specs/2026-10-11-static-knowledge-site-design.md`) is
the only document that states them, and only for that surface.

## Today's workaround

Not stated in the repo. ⚠️ not in code — confirm with the owner.

## Riskiest assumption

Not stated in the repo. ⚠️ not in code — confirm with the owner.

## Early signal

Not stated in the repo. ⚠️ not in code — confirm with the owner.
