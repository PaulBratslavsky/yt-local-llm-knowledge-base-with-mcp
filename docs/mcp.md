# MCP (Model Context Protocol) Integration

This Strapi server exposes the knowledge base (videos, transcripts,
summaries, tags, notes) as an **MCP server** so Claude Desktop / Claude
Code / Cursor can drive the app using a frontier model. The in-app chat
path stays local-first (Ollama, BM25 grounding); MCP is the bridge for
when you want more power than a local model can provide.

Served by the **official Strapi MCP server** (built into Strapi 5.47+; this
repo runs 5.61.0). Our 21 domain tools are registered by strapi-plugin-yt-kb
(plugin config `mcp: true`) via its adapter in
`server/src/plugins/yt-kb/server/src/mcp-official/`; the tool bodies live in
`server/src/plugins/yt-kb/server/src/mcp/tools/`. Every tool is named
`yt_kb__<snake_case>`, so it can't clash with another plugin's tool on a
shared `/mcp`. The previous hand-rolled server (which served `/api/mcp`) was
retired — **that endpoint no longer exists**.

## Endpoint

```
http://localhost:1340/mcp
```

Streamable HTTP transport, enabled by `server.mcp.enabled` in
`config/server.ts` (env `MCP_ENABLED`, default on). The server is
stateless — each POST is an ephemeral session scoped to the token.

Turning `MCP_ENABLED` off (or the plugin config `mcp: false`) is safe for
your tokens. It used not to be: the admin actions registered behind the
same flag as the tools, and Strapi admin's bootstrap deletes every
`admin::permission` row whose action is not registered — which is exactly
where an API token's grants live. One boot with the flag off silently
emptied every token's grants, and switching MCP back on did not restore
them. The actions now register unconditionally in
`server/src/plugins/yt-kb/server/src/mcp-official/index.ts`, before the flag
is read; an action no tool references is inert.
`mcp-official/permissions.guard.test.ts` fails if that ordering is ever
reversed.

## Authentication

The official server authenticates **admin API tokens** (not content API
tokens). A token must be `kind: 'admin'`, owned by an active admin user,
and carry the admin permissions of the tools it should see. **Each tool has
its own permission**, `plugin::yt-kb.tool.<kebab-case name>` (the table under
[Tools](#tools) lists all 21). A token sees and can call only the tools
whose permission it holds; calling any other answers
`Tool yt_kb__<name> disabled`. In the admin panel the permissions are under
the plugin's **AI tools** group, labelled by tool ("Get video", "Fetch
transcript", …).

Strapi exposes no embedding or inference tool. Embeddings are computed by the
TanStack app next to Ollama (reindex from `/settings`) and stored on the Video
row; MCP tools only read them. That keeps the MCP surface working on a hosted
Strapi, where there is no Ollama.

Pick per tool: the 15 query tools for a safe browsing token; add
`save-summary`, `tag-video`, `untag-video` and `save-note` for
browse-and-annotate; add `add-video` and `fetch-transcript` (the two that
call YouTube) for a full-power token.

**Give MCP tokens only `plugin::yt-kb.tool.*` permissions; never grant
Content Manager permissions on yt-kb types to a token used by an agent —
Strapi's Content Manager and `tanstack-ai` expose generic create/update/delete
tools for those types.** With them an agent can write any field directly
(a model-made timecode, for one) or delete records, past every check the
yt-kb tools make.

> A plain content-API token from Settings → API Tokens is **rejected (401)**
> — it isn't `kind: 'admin'`. Create an admin token: Settings → Admin
> Tokens → Create new Admin Token in the admin panel, or the console mint
> below.

### Legacy tiers, migrated at boot

Before the per-tool permissions, three actions tiered the tools:
`plugin::yt-kb.read` (15 query tools), `plugin::yt-kb.write` (4 mutations)
and `plugin::yt-kb.maintenance` (the 2 that call YouTube). At every boot,
before admin's own bootstrap, the plugin
(`server/src/plugins/yt-kb/server/src/permission-seeding/legacy-grants.ts`)
finds each such grant on an API token or role, inserts the per-tool
permissions of that tier for the same token or role, and deletes the legacy
row, one transaction per row. It logs, for example:

```
[yt-kb] legacy MCP grant migration: 6 legacy row(s), 3 migrated, 21 per-tool grant(s) added, 3 super-admin and 0 orphan row(s) left to Strapi
```

Rows on the Super Admin role are left alone: admin's bootstrap grants that
role every registered action anyway. Rows with neither a role nor a token
are left for admin's cleanup to delete. A second boot finds nothing to
migrate. The three legacy actions stay registered for one release, labelled
"(legacy — migrated at boot)", so the migration can still read their rows.
The tier of each tool comes from its `sideEffects` in
`mcp-official/tools.ts` (`none` → read, `write` → write, `external` →
maintenance), and that is now its only use.

The same boot step removes any `plugin::yt-kb.*` permission from the Users &
Permissions **Public** and **Authenticated** roles.

### Mint an admin token (console)

The reliable, version-proof way is the admin-token service via
`strapi console`. Stop the dev server first (SQLite single-writer), then:

```bash
cd server
printf '%s\n' \
  "const u=(await strapi.db.query('admin::user').findMany({populate:['roles']}))[0]; const t=await strapi.service('admin::api-token-admin').create({name:'claude-'+Date.now(), description:'MCP', lifespan:null, adminUserOwner:u.id, adminPermissions:[{action:'plugin::yt-kb.tool.library-stats'},{action:'plugin::yt-kb.tool.list-videos'},{action:'plugin::yt-kb.tool.search-videos'},{action:'plugin::yt-kb.tool.get-video'},{action:'plugin::yt-kb.tool.get-transcript'},{action:'plugin::yt-kb.tool.search-transcript'},{action:'plugin::yt-kb.tool.find-transcripts'},{action:'plugin::yt-kb.tool.cross-search-transcripts'},{action:'plugin::yt-kb.tool.list-transcripts'},{action:'plugin::yt-kb.tool.aggregate-by-tag'},{action:'plugin::yt-kb.tool.list-untagged'},{action:'plugin::yt-kb.tool.list-tags'},{action:'plugin::yt-kb.tool.related-videos'},{action:'plugin::yt-kb.tool.get-readable-article'},{action:'plugin::yt-kb.tool.generate-digest'},{action:'plugin::yt-kb.tool.save-summary'},{action:'plugin::yt-kb.tool.tag-video'},{action:'plugin::yt-kb.tool.untag-video'},{action:'plugin::yt-kb.tool.save-note'},{action:'plugin::yt-kb.tool.add-video'},{action:'plugin::yt-kb.tool.fetch-transcript'}]}, u); console.log('TOKEN='+t.accessKey);" \
  ".exit" | npx strapi console
```

Copy the `TOKEN=` value (shown once). The snippet grants all 21 tools (full
power); drop the last two (`add-video`, `fetch-transcript`) for
browse-and-annotate, or keep only the first 15 for a read-only token. The
token can hold no more than its owner's role allows. Restart the dev server
afterwards.

Every request to `/mcp` must carry:

```
Authorization: Bearer <your-token>
```

Rotate by minting a new token and revoking the old one
(`strapi.service('admin::api-token-admin').revoke(id)`).

## Tools

21 tools, each with its own permission. The legacy tier is the one the boot
migration maps it from.

| Tool | Permission | Legacy tier | Purpose |
|---|---|---|---|
| `yt_kb__library_stats` | `plugin::yt-kb.tool.library-stats` | read | High-level KB stats: video count, summary-status breakdown, top tags, top channels, monthly ingestion buckets |
| `yt_kb__list_videos` | `plugin::yt-kb.tool.list-videos` | read | Paged video catalog (filter by status / verdict / tag) |
| `yt_kb__search_videos` | `plugin::yt-kb.tool.search-videos` | read | Tokenized substring search over titles + summaries (a full URL or 11-char id also works) |
| `yt_kb__get_video` | `plugin::yt-kb.tool.get-video` | read | Full video record (summary, sections, tags) |
| `yt_kb__get_transcript` | `plugin::yt-kb.tool.get-transcript` | read | Full transcript (or chunked / time-range slice) by videoId |
| `yt_kb__search_transcript` | `plugin::yt-kb.tool.search-transcript` | read | BM25 top-k passages inside a single video |
| `yt_kb__find_transcripts` | `plugin::yt-kb.tool.find-transcripts` | read | Cross-transcript substring search with previews |
| `yt_kb__cross_search_transcripts` | `plugin::yt-kb.tool.cross-search-transcripts` | read | BM25 search across many transcripts at once, top-k passages per video (optional tag filter) |
| `yt_kb__list_transcripts` | `plugin::yt-kb.tool.list-transcripts` | read | Paged list of stored transcripts |
| `yt_kb__aggregate_by_tag` | `plugin::yt-kb.tool.aggregate-by-tag` | read | Gather summary data for every video matching a set of tags (avoids N `yt_kb__get_video` round-trips) |
| `yt_kb__list_untagged` | `plugin::yt-kb.tool.list-untagged` | read | List videos with zero tags + enough context to suggest tags |
| `yt_kb__list_tags` | `plugin::yt-kb.tool.list-tags` | read | List existing tags |
| `yt_kb__related_videos` | `plugin::yt-kb.tool.related-videos` | read | Semantically similar videos by cosine similarity over the per-video topical embedding |
| `yt_kb__get_readable_article` | `plugin::yt-kb.tool.get-readable-article` | read | Cached long-form readable article (filler/sponsor stripped); null until generated from the app UI |
| `yt_kb__generate_digest` | `plugin::yt-kb.tool.generate-digest` | read | Bundle compiled summary fields for 2–5 videos into one payload for cross-video synthesis |
| `yt_kb__save_summary` | `plugin::yt-kb.tool.save-summary` | write | Persist a frontier-model-generated summary to a Video; section timecodes are found in the transcript |
| `yt_kb__tag_video` | `plugin::yt-kb.tool.tag-video` | write | Add tags to a video |
| `yt_kb__untag_video` | `plugin::yt-kb.tool.untag-video` | write | Remove tags from a video |
| `yt_kb__save_note` | `plugin::yt-kb.tool.save-note` | write | Attach a short note to a video |
| `yt_kb__add_video` | `plugin::yt-kb.tool.add-video` | maintenance | Ingest a YouTube URL (creates Video + fetches transcript) |
| `yt_kb__fetch_transcript` | `plugin::yt-kb.tool.fetch-transcript` | maintenance | Fetch from YouTube + upsert, and add a pending video card if the video isn't in the library yet (the app's Generate summary button, or opening `/learn/<id>`, writes the summary); acts as "regenerate" with `force=true`. A failed fetch returns `{ error, reason }` (`invalid_id`, `unavailable`, `no_captions`, `blocked`, `rate_limited`, `network`) |

Titles follow the same scheme, e.g. `YT Knowledge Base: Get Video`. The tool
descriptions still mention each other by their camelCase base names (the
names `tanstack-ai` uses; see below).

Alongside these, the connecting token also sees Strapi's **built-in
per-content-type CRUD tools** if it carries the matching `content-manager`
permissions — which an agent's token must not have (see the rule above) —
plus Strapi core's built-in `log` tool.

`yt_kb__add_video` and `yt_kb__fetch_transcript` reach YouTube through the
plugin setting `proxyUrl`, which defaults to `PROXY_URL` in `server/.env`. No
tool takes a proxy argument.

## tanstack-ai

When a Strapi host also runs `strapi-plugin-tanstack-ai`, its admin chat
picks up the same 21 tools from the plugin's `ai-tools` service
(`server/src/plugins/yt-kb/server/src/services/ai-tools.ts`). tanstack-ai
calls `strapi.plugin('yt-kb').service('ai-tools').getTools()`, keeps each tool
whose `action` is a registered admin action, and names it
`yt-kb__<camelCase name>` (e.g. `yt-kb__getTranscript`). An admin sees a tool
only if their role holds its `plugin::yt-kb.tool.*` permission; Super Admins
hold all of them. The schemas are the tools' own (zod 4 from
`@strapi/utils`, which tanstack-ai reads as Standard JSON Schema). Nothing
needs configuring, and the plugin config `mcp: false` does not turn them
off. This repo's own Strapi does not run tanstack-ai; the in-app Ollama chat
does not use these tools either.

## Claude Code (quickest)

```bash
claude mcp add yt-knowledge-base --transport http http://localhost:1340/mcp \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Then `claude mcp list` / restart Claude Code; the `yt-knowledge-base`
server should list its tools (21 custom + any built-ins the token's
permissions expose). After upgrading from the tiered version, reconnect
existing clients so they pick up the `yt_kb__` names.

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "yt-knowledge-base": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:1340/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

Restart Claude Desktop.

> Why `mcp-remote`? Claude Desktop's built-in client supports stdio
> transports; `mcp-remote` bridges a stdio client to the Streamable HTTP
> endpoint and handles the bearer header.

## Cursor / Windsurf

Both support Streamable HTTP MCP servers directly:

```json
{
  "mcpServers": {
    "yt-knowledge-base": {
      "type": "http",
      "url": "http://localhost:1340/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

## MCP Inspector (for debugging)

```bash
npx @modelcontextprotocol/inspector http://localhost:1340/mcp
```

In the inspector UI, set the bearer under **Authentication → Bearer
Token**. From there you can list tools and call them with arbitrary args —
great for confirming a setup works without involving an LLM.

### curl smoke test

Verify the server independent of any client. A clean `200` means the
problem (if any) is client-side config.

```bash
TOKEN=YOUR_TOKEN
curl -sS -i -X POST http://localhost:1340/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

`401` → not an admin token. `404` → `server.mcp.enabled` false or Strapi
< 5.47.

## Typical workflows

### "What do I have about X?"

```
yt_kb__find_transcripts(query: "X")
  → returns a list of videos with previews
→ yt_kb__get_video(videoId: <pick one>)
  → full summary for context
→ yt_kb__search_transcript(videoId: <that one>, query: "X")
  → top passages with timecodes for citation
```

### Ingest + summarize with Claude

```
yt_kb__add_video(url: "https://youtu.be/…", tags: ["ai", "rag"])
  → creates Video + fetches transcript
→ yt_kb__get_transcript(videoId: <id>, mode: "full")
  → pull the whole thing into Claude's context
Claude reasons across it and writes a summary
→ yt_kb__save_summary(videoId: <id>, summaryTitle: …, sections: [...], …)
  → now visible in the app UI alongside Ollama-generated summaries
```

## Architecture notes

- **The official server owns transport, sessions, and auth.** We only
  register tools (`strapi.ai.mcp.registerTool`) during `register()`, before
  the server starts and locks its tool set. Code: `server/src/plugins/yt-kb/server/src/mcp-official/`.
- **Tool bodies are reused, not rewritten.** Each tool's
  `execute(args, { strapi })` body lives in `server/src/plugins/yt-kb/server/src/mcp/tools/` and is
  host-agnostic; the adapter (`mcp-official/adapter.ts`) wraps it for the
  official API. It measures each result as it goes on the wire (sent twice,
  plus an envelope) and replaces one over 950 KB with a `RESULT_TOO_LARGE`
  answer and a hint (MCP clients reject results over ~1 MB).
- **Registration and execution errors are caught.** A tool whose name is
  already taken (another plugin on the same `/mcp`) is skipped and logged
  as `[yt-kb] skipped MCP tool <name>: …`; boot goes on. A tool body that
  throws is logged as `[yt-kb] MCP tool failed <name>: …` and rethrown, so
  Strapi answers the client `Tool "<name>" execution failed: <message>`.
- **Each tool declares its input schema once**, on the body, with the zod 4
  API that `@strapi/utils` exports (the zod the MCP SDK's schema conversion
  needs). The adapter registers `tool.schema` directly. Until 2026-09, bodies
  used the app's own zod and `mcp-official/tools.ts` carried a hand-written
  restatement of every schema; only the restatement was enforced, so adding
  a field to a body and forgetting the copy left the body destructuring
  `undefined` with nothing to catch it. Output schemas must be a top-level
  `ZodObject`; the adapter normalizes array/scalar results into an object.
- **Names and permissions are derived, not typed.** From a tool's camelCase
  base name, `mcp-official/names.ts` derives the MCP name
  (`yt_kb__<snake_case>`), the title, and the admin action
  (`plugin::yt-kb.tool.<kebab-case>`); `mcp-official/permissions.ts`
  registers one action per entry in `mcp-official/tools.ts`.
- **Adding a tool:** author a `ToolDef` in `server/src/plugins/yt-kb/server/src/mcp/tools/`, then add
  a one-line entry (`tool`, `sideEffects`) to
  `server/src/plugins/yt-kb/server/src/mcp-official/tools.ts`. Its name and
  its permission are generated from that entry. Then update the expected
  lists in `mcp-official/names.test.ts` (base names, MCP names, actions and
  the 15 / 4 / 2 side-effect split) and the count of 21 in
  `mcp-official/permissions.guard.test.ts` and `adapter.test.ts`, which
  pin them on purpose: renaming an action deletes every grant of the old
  one at the next boot.
- `yt_kb__save_summary` writes the summary fields and grounds each section's
  `timeSec` itself: BM25 over the transcript's model-free index
  (`Transcript.searchIndex`, built if missing), the same call and minimum
  score as the app's summary pipeline; a section with no match gets `null`.
  It does **not** set `valueScore` / `signalScore` / `finalScore`, embed the
  video, or build the app's contextual index (`Video.transcriptSegments`) —
  those are Ollama-bound pipelines in the app. A Claude-authored summary is
  therefore invisible to score-filtered views (the feed filters
  `finalScore >= minScore`, and `$gte` excludes nulls) and to
  related-videos/semantic search until something indexes it. Reindex from
  the app's `/settings` page after, or regenerate from the app UI for full
  in-app chat grounding. The transcript search tools work at once: they fall
  back to the transcript's own index when the app's is missing.
