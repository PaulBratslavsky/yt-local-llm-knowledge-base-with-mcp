# 0008. Official Strapi MCP server over a hand-rolled one

**Status:** Accepted

## Context

yt-kb has shipped an MCP (Model Context Protocol) server since early on, exposing videos, transcripts, summaries, tags and notes to frontier-model clients (Claude Desktop, Claude Code, Cursor) while keeping the in-app chat path local-first (Ollama + BM25). That server was hand-rolled: `server/src/api/mcp/` (controller + route), `server/src/mcp/server.ts`, `server/src/mcp/transport.ts`, and `server/src/mcp/tools/index.ts` implemented the Streamable HTTP transport, session handling, and tool dispatch directly against `@modelcontextprotocol/sdk`, serving `/api/mcp`.

Strapi 5.47 shipped an **official, built-in MCP server** (`server.mcp` config, `strapi.ai.mcp.registerTool`). Maintaining a hand-rolled transport in parallel meant carrying transport/session/auth code that a dependency now provides, and staying on an old Strapi minor to avoid disturbing it.

This decision was made and shipped in commit `e22c4f2` ("feat(mcp): migrate to the official Strapi MCP server") without a recorded ADR. This entry backfills that record from the commit and from `docs/mcp.md`, which carries the living operational detail (endpoint, auth, tool list, client setup).

## Decision

**Retire the hand-rolled `/api/mcp` transport and register yt-kb's tools onto Strapi's official MCP server instead.**

- Upgraded Strapi 5.42.0 → 5.49.0 (a prerequisite: `server.mcp.enabled` needs 5.47+) and enabled it in `server/config/server.ts` (env `MCP_ENABLED`, default on). The official server serves Streamable HTTP at `/mcp` — a different path from the old `/api/mcp`, which no longer exists.
- **Tool bodies are defined once**, in `server/src/mcp/tools/` — each tool's `execute(args, { strapi })` is host-agnostic and was already written before this migration. They are *reused*, not rewritten.
- A new adapter layer, `server/src/mcp-official/`, registers those bodies onto the official server from `server/src/index.ts`'s `register()` lifecycle hook, before the server starts and locks its tool set. The adapter also enforces a ~900 KB result-size guard, since MCP clients reject results over roughly 1 MB.
- **Authentication moved from a content-API token to an admin API token.** The official server authenticates tokens with `kind: 'admin'`, owned by an active admin user — a plain "Full access" content token from Settings → API Tokens is rejected with 401.
- **Three custom admin permissions tier the 22 tools**, so a token sees only what it's scoped to:
  - `api::yt-kb-mcp.read` — the 14 read tools (`libraryStats`, `listVideos`, `searchVideos`, `getVideo`, `getReadableArticle`, `relatedVideos`, `listTranscripts`, `getTranscript`, `searchTranscript`, `findTranscripts`, `crossSearchTranscripts`, `aggregateByTag`, `listUntagged`, `listTags`).
  - `api::yt-kb-mcp.write` — 4 ordinary mutations (`saveSummary`, `tagVideo`, `untagVideo`, `saveNote`).
  - `api::yt-kb-mcp.maintenance` — 4 expensive or external-side-effect tools (`addVideo`, `fetchTranscript` — both hit YouTube; `reindexEmbeddings` — a long serial Ollama run; `generateDigest` — LLM cost).
- **Schemas for the official registration are declared in zod 3** (`@strapi/utils`), in `server/src/mcp-official/tools.ts` — not the app's zod 4. The MCP SDK's schema-to-JSON-Schema conversion is built against zod 3's internal shape and does not accept zod 4 schemas interchangeably, so the tool bodies' own zod-4 validation and the MCP-facing zod-3 schema are two separate declarations that must be kept in sync by hand when a tool's shape changes.
- Deleted the hand-rolled transport entirely (`src/api/mcp/`, `src/mcp/server.ts`, `src/mcp/transport.ts`, `src/mcp/tools/index.ts`'s old dispatch) and the now-dead dependencies (`@modelcontextprotocol/sdk`, `zod-to-json-schema`).

Verified live at the time of the migration: `initialize` returns 200, `tools/list` reports 22 custom tools + the built-in `log` tool, read and write round-trips succeed, tier scoping works (a read-only token sees 15 tools and write calls are denied), a non-admin token gets 401, and the old `/api/mcp` route is gone (404).

## Consequences

**What we gain.**

- Transport, session handling, and auth are now Strapi's responsibility, not ours — one less hand-rolled protocol implementation to maintain against MCP spec changes.
- Permission tiering is expressed as ordinary Strapi admin permissions (mintable, revocable, auditable via the admin panel's existing RBAC), rather than bespoke token-scoping logic.
- Tool bodies stayed put in `server/src/mcp/tools/`, so none of the actual domain logic (video/transcript/tag/note operations) needed to change — only how they're wired to a transport.

**What we accept.**

- A second, parallel schema declaration for every tool: zod 4 inside the tool body's own validation, zod 3 in `mcp-official/tools.ts` for the MCP SDK. Adding or changing a tool means touching both and keeping them consistent by hand — nothing enforces that they match beyond code review.
- Admin API tokens are a different mint path than content API tokens (`strapi console` + the `admin::api-token-admin` service, documented in `docs/mcp.md`), which is less discoverable than the Settings UI most Strapi users reach for first.
- We are now dependent on Strapi's own MCP server for correctness and security (auth checks, transport framing, result handling) rather than code we control end to end.

**What's enforced in code.**

- Adding a tool: author a `ToolDef` in `server/src/mcp/tools/`, then add a zod-3 entry with a read/write/maintenance tier to `server/src/mcp-official/tools.ts`. Registration onto the live server is automatic from there.
- The old `/api/mcp` endpoint must not be reintroduced — the official server at `/mcp` is the only supported transport going forward.
