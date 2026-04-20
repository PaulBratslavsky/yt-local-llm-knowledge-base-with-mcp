# Two doors into your knowledge base: thinking about local vs. public AI access

*This is a half-formed idea I've been turning over while working on a local-first knowledge base. I don't have this built — I want to think out loud and see what people make of it. Feedback very welcome.*

## Where this came from

I've been building a small local-first knowledge base on top of Strapi + a local Ollama model. The idea is simple: I paste in content (YouTube videos in my case, but it could be anything), a local model summarizes and tags it, and everything stays on my machine. No hosted APIs, no data leaving.

At some point I added an MCP server so I could also drive the knowledge base from Claude Desktop when I needed a smarter model for cross-referencing or synthesis. That's where the tension showed up. The local Ollama model only ever sees my stuff on my machine — I don't have to think about what I share with it. But an MCP connection opens a tunnel to a frontier model that may be hosted, may log what it sees, and is at least conceptually *outside the house*.

So the question I've been sitting with: can I have both, cleanly?

## The idea

Two tiers of access over the same underlying data:

- **Local tools** (my own client, the local Ollama model, whatever I'm running on my machine) see everything — drafts, private notes, raw content, the works.
- **MCP clients** (Claude Desktop, Claude Code, anything connecting from outside my trust boundary) only see what I've explicitly marked as exposable.

Picture two rooms with a wall between them. On the local side is the full working library. On the MCP side is a curated projection of that library — a pinhole through the wall. The MCP server is the pinhole.

In practice that probably looks like:

- A `visibility` flag (or the existing Strapi draft/publish state) acting as the approval gate
- MCP tools returning a **projected** version of each record — certain fields stripped, private records filtered out, related records re-filtered so nothing leaks through relations
- Two separate API tokens — one for local, full-access; one for MCP, scoped read-only to approved data
- Enforcement at the query layer (or via Strapi permissions), never trusting each individual tool to remember to filter

The local in-app chat keeps talking to the database directly, not through MCP — otherwise it inherits the same restrictions and the whole point collapses.

## Why I think this is worth doing

A few reasons it keeps pulling at me:

- **Privacy by default.** Ingest goes into the private side. Sharing something with an external model becomes an explicit act, the same way "publishing" a draft post is.
- **It matches how people actually work.** I keep rough notes, half-thoughts, and personal commentary next to polished summaries. I'd like one to be LLM-readable and the other not, without splitting them into two apps.
- **Resilient to mistakes.** If I ever expose the MCP endpoint beyond localhost, or share it with someone else, the damage is bounded by what I've already approved rather than by whether I remembered to lock things down.
- **It's mostly additive.** You can start with the local side and add the MCP projection later, or build both together.

## Pros

- Clear mental model: publish means "OK for LLMs to see."
- Uses Strapi-native primitives (draft/publish, permissions, scoped tokens) — not a lot of new plumbing.
- Scales naturally: same pattern works for a personal KB, a team KB, or a shared one.
- Forces you to think about what you actually want an external model reasoning over. That's probably healthy.
- Doesn't constrain your local workflow. You still get the full-fat experience on your own machine.

## Cons and things I'm unsure about

- **Friction.** Every new entry needs an approval step if you default to private. Might feel annoying fast.
- **Relation leaks.** If record A is public and links to record B which is private, the MCP tool needs to remember to filter the populated relation too. Easy to get wrong.
- **Aggregate leaks.** A catalog or index built naively will list private entries by title. Every derived artifact has to respect the boundary.
- **Search indexes leak sideways.** If BM25 or embeddings are built over private content, even "public" search can reveal things through ranking signals or suggestions.
- **Is it overkill for a single-user local app?** On a laptop, talking to local Ollama only, nothing actually leaves. The segregation solves a problem I don't technically have yet. The value only kicks in the moment a frontier MCP client shows up — or the app becomes multi-user, or the endpoint becomes reachable.
- **Field-level vs record-level.** Record-level (the whole video is public or private) is simpler. Field-level (summary public, notes private, on the same record) matches real workflows better but adds a redaction layer everywhere.

## What I'd love to hear from others

I'm genuinely not sure how far to take this. Some things I'd appreciate thoughts on:

1. If you've built a personal or team knowledge base with LLM access, did you ever draw this kind of line? How?
2. Is draft/publish a good enough approval gate, or do you want something more explicit ("this is OK for AI")?
3. Record-level visibility vs. field-level — which have you found actually holds up in practice?
4. How do you keep aggregate artifacts (indexes, summaries, catalogs) honest about the boundary without having to maintain two parallel versions?
5. Is there a prior-art pattern for this I should be reading? I keep feeling like someone in the "personal knowledge management" or "structured data + LLM" space must have landed on a standard way to do this already.

Not trying to land a thesis here — just trying to figure out the right shape before I build it. If you've thought about this, or tried something adjacent, I'd love to know what worked and what fell over.
