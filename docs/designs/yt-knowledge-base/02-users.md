# Users & Usage

> As-is — 2026-10-31. Describes the product as it exists, not intentions.

## Personas

### The owner — single operator of a local-first library

The only authenticated-by-absence user. The app has no login: the Public
role is granted read, create and update on every content type in
`server/src/index.ts` `bootstrap()`, with delete left admin-only. There is
no per-user data anywhere in the schema
(`server/src/api/*/content-types/*/schema.json`).

### A reader of the public site — arrives from a shared link

Sees only the published summary layer at the Netlify site. Cannot search
transcripts, chat, or change anything; the site is static and read-only
(`site/src/content.config.ts` fetches at build time only).

### An agent — reaches the library over MCP

Connects to Strapi's official MCP server at `/mcp`, gated by an **admin**
API token whose grants select which of the 22 domain tools it can see
(`server/src/mcp-official/`, `docs/mcp.md`).

## Jobs-to-be-done

- Decide whether a video is worth watching, before watching it.
- Return to the exact moment that supports a claim.
- Ask a question across the whole library, not one video.
- Share a readable summary with someone who will not watch the video.
- Let a frontier model read and annotate the library without a cloud
  inference bill or sending transcripts anywhere.

## Primary user journey

1. Share a YouTube URL into the app (`client/src/routes/index.tsx`).
2. The transcript is fetched via youtubei.js and cached on a Strapi
   `Transcript` row (`client/src/lib/services/learning.ts`).
3. Background generation writes `summaryStatus: 'pending'`, then a
   summary, verdict, takeaways, timecoded sections and action steps
   (`client/src/lib/services/learning.ts`).
4. The owner reads it at `/learn/$videoId`, chats with it, tags it.
5. Several videos can be combined into a digest (`client/src/routes/digest.tsx`).
6. The owner publishes the summary layer with `yarn site:publish`
   (`publish-site.sh`).

## Core loop

**Share a video → read the verdict → jump to the moment → ask it a
question.** Everything else (digests, tags, notes, publishing, MCP) hangs
off a library built by repeating that loop.
