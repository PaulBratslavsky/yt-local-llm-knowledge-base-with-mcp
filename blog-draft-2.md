# Local Has a Ceiling — Here's How MCP Raises It

**TL;DR**

- The first post on this project ([*Building a Local-First AI App with Gemma 4, Ollama, and TanStack AI*](./blog-draft.md)) stopped at a specific point: everything runs on your laptop, nothing calls a hosted API, a ~4B-param local model writes all the summaries and handles all the chat.
- That's the point — but it's also the ceiling. Small local models drift on multi-step reasoning, miss fine-grained distinctions across long videos, and don't reason across your **whole library** very well. Sometimes you want to ask Claude "look at all 40 videos I tagged `rag` and tell me what everyone actually disagrees about." A local 4B-param model cannot do that, even if every byte of data it needs is already on your machine.
- The fix is not "rewrite the app with Anthropic's API baked in." That would blow up the local-first claim and hand-roll two incompatible pipelines (local chat + cloud chat) with the same tools defined twice.
- Instead: expose the knowledge base as an **MCP (Model Context Protocol) server** from Strapi, keep the in-app chat on Ollama exactly as it was, and let Claude Desktop / Claude Code / Cursor / any MCP client connect to your running app when you want a bigger brain. Tools get defined **once** in Strapi; both the frontier client and (eventually) the local chat consume them from the same place.
- 14 tools, all pure data operations — `listTranscripts`, `getTranscript`, `searchTranscript`, `findTranscripts`, `fetchTranscript`, `listVideos`, `getVideo`, `searchVideos`, `addVideo`, `saveSummary`, `listTags`, `tagVideo`, `untagVideo`, `saveNote`. No LLM calls live inside the tools. That's a deliberate boundary: the MCP server is a **data surface**, and the model lives wherever the user picked — local Ollama for in-app chat, Claude Desktop for the frontier path.
- Auth uses Strapi's native API tokens (`Settings → API Tokens`). Custom token type with scope `Mcp → handle` gives you least-privilege access that can be rotated from the admin UI without touching any code or env files.
- The real interesting direction, and what the rest of this post is building toward: **data segregation as a future feature.** Some videos are private thinking — internal notes, unpublished drafts, stuff you don't want leaving the machine. Others are fine to hand to a frontier model. The content-types need to learn which is which, and the MCP tools need to respect that boundary at the SQL level, not the LLM-prompt level. Design sketch at the end.

---

## Where we left off

The first post landed here: a single-user local-first app, `yt-knowledge-base`, that ingests a YouTube URL, caches the transcript in Strapi, runs it through a local Ollama model (default: `gemma4-kb:latest` — a custom Gemma 4 Modelfile at Q4) to produce a Zod-validated structured summary, then lets you chat with the video using BM25-grounded retrieval and a `web_search` tool.

The whole pipeline stayed local:

```
Browser ─▶ TanStack Start (Nitro server fn) ─▶ Ollama + youtubei.js
                     │
                     └─▶ Strapi 5 (SQLite) ──┐
                                              │
                                              ▼
                                         Transcript / Video / Tag rows
```

Every box in that diagram runs on your laptop. That's the constraint the project was built around.

The thing nobody tells you about "local-first AI" until you ship one: **the local model is always the weakest part of the system**. Your retrieval logic is solid. Your data model is solid. Your UI is fine. The local model confabulates when the transcript is long, mis-grounds tool calls, and can't reason across your whole corpus. Every complaint you have about the app is, at root, a complaint about the 4B-param brain doing the reasoning.

That's the ceiling I want to talk about in this post.

## The ceiling

Three specific things a small local model can't do well, all of which I hit while using the v1 app for real:

1. **Reason across the entire library at once.** I have ~80 videos tagged with variations of `rag`, `context-engineering`, `agents`, etc. I want to ask: *"Which of these videos contradict each other on how to chunk documents?"* Single-video chat can't do it. Cross-video requires pulling multiple transcripts into a single reasoning context, and a 4B Gemma at `num_ctx=32768` collapses on anything beyond 2–3 videos. Frontier models have 200k–1M context and actually follow long arguments.
2. **Handle fine-grained technical distinctions.** Q: *"In this video the speaker distinguishes 'evals' from 'benchmarks' — do their definitions match what Anthropic's team uses publicly?"* This is a multi-hop reasoning task with implicit comparison against training data the local model doesn't carry robustly. Claude is better at it for the same reason GPT-4 was better at it: more compute baked into better pattern matching.
3. **Multi-step agentic work across my data.** *"Pull every 'TODO' I've left in my notes, group them by video topic, draft a one-week reading plan."* This is five tool calls orchestrated by reasoning about the intermediate results. The local model's [Tau2 tool-use score](https://arxiv.org/abs/2406.12045) is ~42% single-call, and chained calls multiply the failure rate. The first post documented this honestly; the v1 app handles single-shot tool calls (`web_search`) and gives up on chains.

For each of these I'd pay more compute to get the answer. "More compute" means Claude, GPT-5, Gemini — something I can't fit into `num_ctx` on my M4.

So I want a way to use frontier models against my local data, **without** giving up the local-first property of the app itself.

## What "local-first" means when you cross the boundary

The temptation when you hit this ceiling is to just bolt cloud models into the app. Swap `@tanstack/ai-ollama` for `@tanstack/ai-anthropic`, add an API key to `.env`, done.

That would work. But it would erase what the project was demonstrating in the first place. The point of v1 wasn't "I can't afford Claude credits" — it was "what can you actually build when every layer is local?" Stapling a cloud call into the middle of that is answering a different question.

The better frame: **local-first means your data lives locally. It does not have to mean your reasoning lives locally.** iCloud Keychain is local-first — the secrets live on your device — but you can unlock them from multiple devices because Apple thought hard about which bits leave the machine and when. The architecture is "local data + opt-in data flow."

MCP fits that frame exactly. The server stays on your laptop, speaks to a local database, and exposes a well-defined surface of operations. The **client** is wherever you happen to be reasoning — Claude Desktop, Claude Code, Cursor, an agent you wrote yourself. The data flows out only when you explicitly route a client at the server, with a token you created, scoped to actions you picked.

```
                    local laptop
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │   Ollama ──▶ in-app chat (TanStack AI)                  │
  │                                                         │
  │   Strapi ──▶ /api/mcp  ◀───────── bearer auth token     │
  │     │                                  ▲                │
  │     └─▶ Video / Transcript / Tag       │                │
  │                                        │                │
  └────────────────────────────────────────┼────────────────┘
                                           │
                          ◀────────────────┤
                                           │
           Claude Desktop / Claude Code / Cursor / etc.
                   (frontier model lives here)
```

The token is the boundary. Without it, nothing leaves. With it, the holder gets exactly the actions the token was scoped to — `tools/list` and `tools/call` against whatever subset of the 14 tools you enabled.

The rest of this post is the implementation of that idea, then a sketch of how I want to evolve it.

## The design constraint that shaped everything: no tool duplication

If you stop at "expose an MCP server from Strapi," you've solved the frontier-model problem. But you've also introduced a new problem: **now the same tool logic has to exist in two places.**

The in-app chat uses TanStack AI's `toolDefinition()` + `.server()` for `web_search`. If I wanted Claude Desktop to also run searches it would need an MCP-side definition of the same tool. `search_transcript` would have a BM25 search function in `client/src/lib/services/`, and also an MCP handler in `server/src/mcp/tools/`. Schemas would drift. Descriptions would drift. One day you'd patch a bug in one copy and forget the other and spend an hour wondering why Claude calls the tool differently than the local chat does.

So the rule I set before writing any code: **tools are defined in exactly one place, the MCP server on Strapi, and every other consumer pulls from it.** Not copies, references.

For v1 this means:

- The 14 tools live in `server/src/mcp/tools/*.ts`, registered into a process-global registry at Strapi boot.
- Each tool is `{ name, description, schema: z.object({...}), execute: async (args, { strapi }) => ... }` — a data primitive, no LLM inside.
- Claude Desktop consumes them via MCP.
- The in-app Ollama chat keeps its old `web_search` tool definition unchanged. It does NOT yet consume Strapi's MCP tools. (Reason: TanStack AI doesn't ship an MCP client, and I didn't want to wedge one in during v1 of this refactor. The in-app chat surface is tiny — one tool — so the "zero-duplication" rule is trivially satisfied for now. If I later want `search_transcript` inside the in-app chat, the move is to write a thin MCP client that loads tool definitions from Strapi at boot and hands them to TanStack AI. Still one source of truth.)

Here's what a tool file looks like — `searchTranscript`, mirroring the shape of my previous `strapi-plugin-ai-sdk-yt-transcripts` plugin so prompts transfer:

```ts
// server/src/mcp/tools/search-transcript.ts
import { z } from 'zod';
import type { ToolDef } from '../registry';
import { isStoredIndex, searchBM25 } from '../../services/bm25-search';

const schema = z.object({
  videoId: z.string().min(1),
  query: z.string().min(2).max(300),
  k: z.number().int().min(1).max(25).default(8),
});

export const searchTranscriptTool: ToolDef<z.infer<typeof schema>> = {
  name: 'searchTranscript',
  description: 'BM25 full-text search within a single transcript...',
  schema,
  execute: async ({ videoId, query, k }, { strapi }) => {
    const video = await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
      populate: ['transcript'],
    });
    if (isStoredIndex(video.transcriptSegments)) {
      const ranked = searchBM25(video.transcriptSegments.bm25, query, k);
      return { videoId, source: 'bm25', results: ranked.map(format) };
    }
    // ...fallback to substring match on rawText
  },
};
```

Crucially: the BM25 index that the in-app chat builds during summary generation — stored on `Video.transcriptSegments` — is reused by the MCP tool. No second index. No second implementation. The tool is a thin wrapper over data that was already produced for the local chat path.

## How the route gets mounted (and why this took three tries)

Mounting the MCP endpoint inside Strapi sounds trivial and then isn't.

The obvious thing, which I did first:

```ts
// server/src/index.ts  (DON'T DO THIS)
register({ strapi }) {
  strapi.server.routes([
    { method: 'POST', path: '/api/mcp', handler: mcpHandler, config: { auth: false } },
    // ...
  ]);
}
```

This mounts the route. Requests arrive. Handler runs. Everything works.

Except the route is **invisible to Strapi's admin UI.** When you go to `Settings → API Tokens → Create new Token → Custom`, the permissions picker walks `strapi.contentApi.routes` and shows every action you could scope a token to. Routes added via `strapi.server.routes()` are on a different server layer and never show up there. So the user's only option for authing MCP is `Token type: Full access`, which defeats the whole point of least-privilege.

The fix is to register the route the same way Strapi's own content-types do — as a filesystem-discovered content-API under `src/api/<name>/routes/`:

```ts
// server/src/api/mcp/routes/mcp.ts
export default {
  routes: [
    { method: 'POST',   path: '/mcp', handler: 'mcp.handle', config: { policies: [] } },
    { method: 'GET',    path: '/mcp', handler: 'mcp.handle', config: { policies: [] } },
    { method: 'DELETE', path: '/mcp', handler: 'mcp.handle', config: { policies: [] } },
  ],
};
```

```ts
// server/src/api/mcp/controllers/mcp.ts
import { handleMcpRequest } from '../../../mcp/transport';
export default {
  async handle(ctx) {
    await handleMcpRequest(ctx, strapi);
  },
};
```

Two things happen when you put the route here:

1. **Strapi's built-in content-API auth middleware kicks in.** `config: { policies: [] }` (no `auth: false` anywhere) means the middleware runs, validates the bearer against `admin::api-token`, and — if it's a Custom token — checks the token's scope list for `api::mcp.mcp.handle`. My custom `requireMcpToken` function from the first attempt became dead code the moment I moved here; I deleted it.
2. **The route shows up in the permissions picker** as `Mcp → handle`. Custom tokens can now be scoped to MCP-only. No sledgehammer Full Access needed.

So the actual code in `register()` is now just:

```ts
// server/src/index.ts
register({ strapi }) {
  // ...existing document middleware for video/transcript/tag dedupe...
  registerAllTools();   // populate the process-global tool registry
}
```

One line. All the route plumbing lives in the filesystem.

## Zod v4 vs `zod-to-json-schema@3` — a silent-failure story

This one cost me 40 minutes of "why is Claude Desktop listing the server as 'Add from yt-knowledge-base' instead of giving me a toggle?" and belongs in the blog because it's the exact class of bug you don't notice until a user sees different UI than you expected.

The MCP spec says every tool's `inputSchema` must be JSON Schema. I was converting with the `zod-to-json-schema` library (v3.25). Strapi uses Zod v4. The library's published types still target Zod v3; I assumed the runtime behavior would match.

It didn't. For every v4 Zod schema I passed in, the library silently returned this:

```json
{ "$schema": "http://json-schema.org/draft-07/schema#" }
```

That's it. No `type`, no `properties`, no `required`. The library didn't throw — it just quietly emitted a valid-looking but empty schema. The MCP handshake succeeded, `tools/list` returned 14 tools, and every single `inputSchema` was that degenerate object.

Claude Desktop, reasonably, decided "this server exposes 14 things with no callable shape" and routed the whole server into its **resources picker** — the UI affordance for servers that only expose read-only content, not tools.

The fix was the one line I should have written in the first place:

```ts
// zod v4 ships its own JSON Schema converter, version-matched to the Zod in use.
const schema = z.toJSONSchema(tool.schema, { target: 'draft-7' });
```

Zod v4 has a native `toJSONSchema`. It always matches the Zod you have installed, by construction. No third-party library in the middle.

After that change `tools/list` started returning the shapes Claude Desktop expects:

```json
{
  "name": "listTranscripts",
  "inputSchema": {
    "type": "object",
    "properties": {
      "page":     { "type": "integer", "default": 1  },
      "pageSize": { "type": "integer", "default": 25, "max": 100 },
      "sort":     { "enum": ["newest","oldest","title"], "default": "newest" }
    }
  }
}
```

…and the connector switched from "Add from…" (resource picker) to a regular on/off toggle alongside my other MCP servers.

The lesson, generalized: **when you see a UI that implies one set of capabilities but your code is declaring another, suspect your schema serialization before suspecting the client.** The MCP handshake was doing exactly what the spec says to do. Claude Desktop's decision tree was exactly what its UX docs say to do. The bug was in the 40-character function call in between.

## Auth: reuse what Strapi already ships

I spent a beat considering a custom `MCP_AUTH_TOKEN` env var. That idea lasted about ninety seconds. Strapi already has:

- A `Settings → API Tokens` admin UI with create/edit/delete/rotate
- A per-token `lifespan` + `expiresAt` enforcement
- A per-token permissions tree for Custom tokens
- A `sha512(accessKey)` hash stored in `admin::api-token` — the raw key is shown once and never persisted
- Middleware that validates on every request, with 401/403 responses matching the content-API conventions

Inventing a parallel system would replace four visible admin-UI features with one hidden env var and a handwritten hash comparison. Hard pass.

The flow is therefore exactly what it would be for any other Strapi content-API endpoint:

1. Admin UI → Settings → API Tokens → Create new.
2. Pick `Custom`, expand `Mcp`, check `handle`, save.
3. Copy the token (shown once; you won't see it again).
4. Drop it into Claude Desktop:

   ```json
   {
     "mcpServers": {
       "yt-knowledge-base": {
         "command": "npx",
         "args": [
           "-y", "mcp-remote",
           "http://localhost:1337/api/mcp",
           "--header", "Authorization: Bearer YOUR_TOKEN"
         ]
       }
     }
   }
   ```

5. ⌘Q Claude Desktop, reopen. Toggle appears. Tools light up.

Rotate = create a new token, update the config, delete the old one. The token never touches any `.env` file.

## The tool surface

14 tools, grouped by concern:

**Transcripts** — cloned almost verbatim in intent from my previous `strapi-plugin-ai-sdk-yt-transcripts` plugin, so prompts that work there work here too:

| Tool | Purpose |
|---|---|
| `listTranscripts` | Paged list of stored transcripts |
| `getTranscript` | Full transcript (or chunked segments, or time-range slice) by videoId |
| `searchTranscript` | BM25 top-k passages inside one video |
| `findTranscripts` | Cross-transcript substring search with 244-char previews |
| `fetchTranscript` | Fetch from YouTube + upsert. Acts as "regenerate" with `force: true` |

**Videos / KB**:

| Tool | Purpose |
|---|---|
| `listVideos` | Paged video catalog with tags + summary status |
| `getVideo` | Full record: summary, sections, takeaways, action steps, tags |
| `searchVideos` | Substring search over titles + AI-generated summary fields |
| `addVideo` | Ingest a YouTube URL (creates Video + fetches transcript) |
| `saveSummary` | Persist a frontier-generated summary onto a Video row |

**Organization**:

| Tool | Purpose |
|---|---|
| `listTags` | List every tag with video counts |
| `tagVideo` / `untagVideo` | Tag CRUD |
| `saveNote` | Attach a short markdown note to a video |

Notice what's **not** in there: no "chat with a video" tool, no "generate a summary" tool. The MCP server is pure data + pure ingestion; reasoning stays on whichever client is connected. That's the boundary.

Two patterns worth calling out:

- **`findTranscripts` returns truncated previews** (244 chars) and explicitly tells the agent `"Transcript content truncated... Use getTranscript for full content or set includeFullContent=true."` This is lifted from the plugin I wrote last year and it works great — Claude self-routes between discovery (`findTranscripts` → pick a candidate → `getTranscript` for the full content) without me having to prompt-engineer it.
- **`saveSummary`'s input schema is the same Zod shape the in-app pipeline writes to Strapi** — title, description, overview, sections with optional timecodes, key takeaways, action steps. So Claude-Desktop-generated summaries surface in the app UI alongside Ollama-generated ones. The two pipelines meet at the `Video` row, not at the prompt.

## A concrete workflow

Here's the cross-library question I used to open this post, run end-to-end:

> *"Using yt-knowledge-base — which videos tagged `rag` contradict each other on how to chunk documents? Cite timecodes."*

What Claude Desktop does:

1. `listVideos(tag: "rag")` → 12 videos come back.
2. For each, `getVideo(videoId)` → summaries arrive, no transcripts (Claude doesn't need them yet).
3. Claude notices a few relevant-looking chunking sections and drills in: `searchTranscript(videoId: <X>, query: "chunk size overlap recursive")`.
4. Finds the specific passages. Does the same for 3–4 other videos. Compares.
5. Writes a structured answer citing `[youtubeVideoId] [mm:ss]` for each claim.

All the data operations hit my laptop. The model runs on Anthropic's servers. The answer quality is what a 200k-context frontier model can do with a clean data surface. The app on my laptop did not know or care that any of this happened — I didn't touch the in-app chat, didn't start a new summary job, didn't change any env vars. I just had a conversation in Claude Desktop.

## Where this is going: data segregation as a feature

Here's the thing I didn't want to hand-wave past. Everything above assumes *all* of your knowledge base is OK to expose to whatever MCP client holds a token. For a single-user laptop-only demo that's fine. For the app I actually want to use long-term, it isn't.

Some videos in my library are **public technical content** I would happily paste into any AI chat — conference talks, documentation walkthroughs, open-source project demos. Some are not. I keep videos I've recorded as personal thinking (screen recordings of me reasoning through work, private calls, internal drafts) alongside the public ones because *this is my knowledge base, not a publishing platform.* Privately-thinking videos should never leave the machine. Public ones can.

Today, the boundary is coarse: it's the token. You hold the token, you see everything. I want a finer boundary: the **data itself** declares whether it's allowed to leave, and the MCP tools enforce that declaration.

### The sketch

**Step 1: add a `privacy` field to the content types.** On `Video` and `Transcript`:

```json
{
  "privacy": {
    "type": "enumeration",
    "enum": ["local-only", "shareable", "public"],
    "required": true,
    "default": "local-only"
  }
}
```

Default `local-only` — safer to opt in to sharing than to opt out. Users promote a video to `shareable` deliberately, either from the Video detail page or via a `setPrivacy` tool (more on that below).

**Step 2: filter at the tool level, not the prompt level.** Every read tool gets a hard filter:

```ts
// server/src/mcp/tools/list-videos.ts (sketch)
execute: async ({ page, pageSize, status, tag }, { strapi }) => {
  const filters = {
    ...existingFilters,
    privacy: { $in: ['shareable', 'public'] },   // hard cutoff
  };
  return strapi.documents('api::video.video').findMany({ filters, /*...*/ });
}
```

Critically: this is at the **query** layer, not the prompt layer. You can't instruct a frontier model out of it. You can't prompt-inject around it. `local-only` rows do not come back from `strapi.documents(...).findMany()`, so they cannot be in the MCP response. The only code path that returns them is the in-app chat (which runs on your laptop against a local model).

**Step 3: token scope as a second gate.** Strapi's Custom tokens already have a scope list. Extend the MCP surface with a second action — `api::mcp.mcp.handle-shareable` vs `api::mcp.mcp.handle-all` — and let the user pick which one their Claude Desktop token is bound to. The `all` variant skips the `privacy` filter and is reserved for tokens the user explicitly marked as trusted. The default `handle-shareable` is what ordinary tokens get. This way there's a way to say "yes actually, this time I do want to feed my private videos to Claude for a specific reason" without flipping the global default.

**Step 4: UI affordances.** The Video detail page gets a privacy toggle. The feed view gets a `privacy` badge on each card. The admin "Create API Token" screen already has the permission picker — users see the two MCP actions and pick the one matching their trust level.

**Step 5: audit log.** Strapi tracks when an API token was used. Add a lightweight log row per MCP `tools/call` — `{ timestamp, tokenId, toolName, argsDigest }` — so you can review what a given client has been asking for. Not PII-level detail (we don't log arg values, just a hash), just "this token ran `getTranscript(privacyFilter=shareable)` 47 times this week." If something feels off, you revoke the token from the admin UI.

### Why this matters more than it sounds like it does

The pattern is bigger than my little YouTube app. Most "connect AI to my data" stories have one of two failure modes:

- **Privacy-by-promise.** You trust the vendor's TOS, or the user's manual choice to not upload certain files, to keep sensitive stuff out of a cloud model. Nothing in the system architecture actually enforces that. One accidental drag-and-drop and the sensitive stuff is in Anthropic's logs.
- **All-or-nothing.** Either you connect the whole data store and cross your fingers, or you don't connect it and lose the feature. Most products default to the former because the UX of partial connection is gnarly.

MCP plus content-type-level privacy gives you a third way: **the data layer enforces the boundary, the model layer never sees what it isn't allowed to see, and the user sees a plain UI affordance (`local-only` / `shareable` / `public`) that maps directly onto that enforcement.**

It's the same pattern Apple pushes with on-device vs. Private Cloud Compute: *the system architecture is what keeps your data from leaking, not your discipline.* The LLM isn't the trusted party. The storage layer is.

I'm going to build this incrementally. v1 ships with everything `shareable` by default so nothing breaks for me personally. v2 adds the `privacy` field but keeps the default as `shareable` during the migration. v3 flips the default to `local-only` and adds the admin UI for promoting rows.

The interesting question I don't have a clean answer to yet: **at what granularity does privacy actually matter?** Is it per-video? Per-tag? Per-section within a video? Some of my videos have public content in the first 30 minutes and private thinking in the last 10 — do I want to mark timecode ranges as local-only, so `getTranscript` redacts them for shareable tokens? Possibly. Early to call. I'll know more once I'm using the v1 boundary in anger and see where it chafes.

## What I'm not doing (and why)

A few things this refactor deliberately did *not* ship:

- **No MCP client inside the app.** In-app chat stays on its existing TanStack AI + Ollama + `web_search` path. Wiring TanStack AI up to MCP as a client is a separate project — when I do it, the `web_search` tool moves to Strapi and becomes just another MCP tool both paths consume.
- **No summary generation via MCP.** `saveSummary` exists; `generateSummary` does not. The MCP surface is data primitives; LLM calls live on whichever client is connected. If you want Claude to generate a summary, Claude calls `getTranscript` → reasons → calls `saveSummary` with the result. Model selection is the client's problem.
- **No multi-user auth.** One user, possibly many tokens. Per-user row-level auth is a much larger design exercise and I haven't felt the need.

## Closing: local-first is an architecture, not a constraint

The framing I started this project with — "can the whole app actually run locally?" — implied a binary. Local or not-local. Cloud-free or cloud-dependent.

After building v2 I think the framing was too narrow. **Local-first is really a claim about where your data lives and who controls the flow out of it**, not about which hardware is executing which tokens. Once you internalize that, the MCP bridge isn't a compromise on the local-first principle — it's an implementation of it. The data doesn't move. The schema is yours. The token is yours. The revocation is yours. When you connect a frontier model, you're making a deliberate, scoped decision to let it see a subset of your data, for one session, at a latency and cost you can predict.

That's what good local-first UX looks like in 2026. Not "the model runs on my laptop" — that's a spec of the model, not of the architecture. **"My data stays on my laptop and I decide, per token, per scope, per row, what leaves."** Same principle, wider surface.

Next post will either be about wiring TanStack AI up as an MCP client (so the local chat shares the same tool definitions the frontier path uses) or about building the `privacy` field and the audit log. Probably the second — the ceiling on local models isn't moving, but the data-governance story is the thing I actually want to be able to recommend to people.

[add video here]

---

*Source: [paulbratslavsky/yt-knowledge-base](https://github.com/paulbratslavsky/yt-knowledge-base) · MCP setup walkthrough in [`docs/mcp.md`](./docs/mcp.md) · First post: [*Building a Local-First AI App with Gemma 4, Ollama, and TanStack AI*](./blog-draft.md).*
