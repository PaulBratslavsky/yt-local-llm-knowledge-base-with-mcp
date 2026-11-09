# strapi-plugin-yt-kb

A YouTube knowledge base inside any Strapi 5 app. Strapi stores and serves the
data; the AI (summaries, embeddings, chat) runs in your own client.

## What it is

The plugin adds five content types — `plugin::yt-kb.video`, `.transcript`,
`.tag`, `.note` and `.digest`, plus their components in the `ytkb` category —
and serves them over REST under `/api/yt-kb` (`/api/yt-kb/videos`,
`/api/yt-kb/transcripts`, …). It registers 21 tools on Strapi's built-in MCP
server at `/mcp`, and offers the same tools to `strapi-plugin-tanstack-ai`.
Its transcript fetcher downloads captions and video metadata from YouTube
(`youtubei.js`, through a proxy if you set one), stores them on the
transcript, and builds a model-free BM25 search index for each transcript.
Strapi computes no summaries and no embeddings: a client writes them, and the
plugin stores and searches them. Requires Strapi `^5.61.0` (peer dependencies
`@strapi/strapi` and `@strapi/utils`).

Supports SQLite and PostgreSQL. MySQL and MariaDB are not supported: the
schema puts a unique index on the `text` column `digest.videoSetKey`, which
MySQL cannot index without a prefix length. (The plugin has not been run on
MySQL.)

## Install

```bash
npm install strapi-plugin-yt-kb
# or
yarn add strapi-plugin-yt-kb
```

Then enable it in the host's `config/plugins.ts`:

```ts
export default ({ env }) => ({
  'yt-kb': {
    enabled: true,
    config: {
      proxyUrl: env('PROXY_URL', ''), // residential proxy; needed on most cloud hosts
      mcp: true,                      // register MCP tools on /mcp
      import: false,                  // enable only while copying content in
      backfillMetadata: false,
    },
  },
});
```

Restart Strapi. The first boot creates the tables and their unique indexes
(on `video.youtubeVideoId`, `transcript.youtubeVideoId`, `tag.name`,
`tag.slug` and `digest.videoSetKey`). The boot log shows lines such as
`[yt-kb] registered 21 tool permission(s) and 3 legacy tier permission(s)`
and `[yt-kb] registered 21 of 21 MCP tool(s) on the official MCP server`.

The MCP tools also need Strapi's own MCP server on: `mcp: { enabled: true }`
in the host's `config/server.ts`.

## Configuration

| Key | Type | Default | Effect |
|---|---|---|---|
| `proxyUrl` | string | `env('PROXY_URL', '')` | Proxy for every YouTube request the plugin makes (captions, metadata, oEmbed), e.g. `http://user:pass@proxy.example.com:8080`. Empty: no proxy. Checked once at boot (see [Proxy](#proxy)). No caller can pass its own proxy. |
| `mcp` | boolean | `true` | Register the 21 tools on `/mcp`. With `false` the tools are not registered, but their admin permissions still are, so existing token grants survive. It does not affect the `ai-tools` service. |
| `import` | boolean | `false` | `POST /api/yt-kb/import/:type` answers 403 (`Import is disabled. Set the yt-kb plugin config \`import: true\` to enable it.`) unless this is `true`. Turn it on only while copying content in. |
| `backfillMetadata` | boolean | `false` | At boot, in the background, fetch the missing metadata (channel id, thumbnails, view count, description, keywords, category, publish date, plus author, thumbnail URL and duration where YouTube has them) for stored transcripts whose `thumbnails` is empty. At most 500 rows per boot, one YouTube call each, 1.5 s apart. It does not re-fetch captions. Ends with `[yt-kb] metadata backfill complete: …`. |

A non-boolean `mcp`, `import` or `backfillMetadata`, or a non-string
`proxyUrl`, stops Strapi at boot (`yt-kb: \`mcp\` must be a boolean`).

The plugin also reads two environment variables, for the `yt_kb__related_videos`
tool only: `OLLAMA_EMBEDDING_MODEL` (default `nomic-embed-text`) and
`EMBEDDING_VERSION` (default `2`). A stored embedding counts only when its
model and version match these, so set them to the values your client writes.

## Tokens

Nothing is granted to the Users & Permissions **Public** or **Authenticated**
role. At every boot the plugin removes any `plugin::yt-kb.*` permission an
operator gave those roles. Every caller uses its own Content API token, so
anonymous calls get 403.

Two custom tokens cover the usual callers:

| Token | For | Scopes |
|---|---|---|
| `yt-kb-app` | A client that reads and writes (24 scopes) | `find`, `findOne`, `create`, `update`, `delete` on `video`, `tag`, `note` and `digest`; `find` and `findOne` on `transcript`; `fetcher.fetchTranscript`; `fetcher.getOrFetch` |
| `yt-kb-site` | A read-only static build (2 scopes) | `video.find`, `tag.find` |

Each scope is `plugin::yt-kb.<type>.<action>`, for example
`plugin::yt-kb.video.find` or `plugin::yt-kb.fetcher.getOrFetch`. Neither
token can write transcripts directly, call the import route, or reach
anything outside yt-kb. Don't use a **Full access** token for a client
without its own sign-in, and don't use **Read-only** for the site: on a host
with Users & Permissions it can also read `/api/users`.

After switching the app to the `yt-kb-app` token, revoke any older
full-access token the app used (**Settings → API Tokens**). The token script
below never revokes it.

### With the script (self-hosted or local)

For a host whose database you can reach, the plugin ships a script that
creates both tokens. Run it from the Strapi app root:

```bash
node node_modules/strapi-plugin-yt-kb/scripts/create-tokens.cjs \
  --out-app <file> --out-site <file>
```

- **Stop Strapi first** when the app uses SQLite, which needs exclusive
  access. The script refuses to run while something listens on the app's
  port. On PostgreSQL it can run next to a running Strapi.
- A TypeScript app must be built first (`strapi build`); the script loads
  `dist/config`. It loads Strapi in-process with the app's `.env`.
- Each key is written to its file with mode 0600 and is never printed. Both
  files must be new paths in an existing folder: the script never
  overwrites a file.
- A token whose name already exists is skipped (logged), and its file is
  not written. `--rotate yt-kb-app` / `--rotate yt-kb-site` (repeatable)
  revokes the existing token of that name and creates it fresh, in one
  transaction, so a failed create keeps the old token. `--rotate` accepts
  only those two names, and never replaces an admin token.
- Exit codes: 0 done, 1 failed, 2 usage or precondition.

### In the admin panel (Strapi Cloud)

On Strapi Cloud the managed database is not reachable from outside, so the
script cannot run there. Create each token by hand: **Settings → API Tokens →
Create new API Token**, token type **Custom**, then in **Permissions** tick
exactly the scopes in the table above for `yt-kb-app` or `yt-kb-site`, and
nothing else. Copy the key when Strapi shows it.

### Pointing a frontend at it

A client calls `https://<your-strapi>/api/yt-kb/<plural>` with
`Authorization: Bearer <token>`. The REST base is `/api/yt-kb`, not `/api`.

| Method and path | Scope | What it does |
|---|---|---|
| `GET /api/yt-kb/<plural>`, `GET /api/yt-kb/<plural>/:documentId` | `<type>.find`, `<type>.findOne` | Read `videos`, `transcripts`, `tags`, `notes`, `digests` (standard Strapi query parameters) |
| `POST`, `PUT /:documentId`, `DELETE /:documentId` on the same paths | `<type>.create`, `.update`, `.delete` | Write |
| `POST /api/yt-kb/transcripts/fetch` with `{ "data": { "videoId": "<11-character id>", "force": false } }` | `fetcher.fetchTranscript` | Fetch a transcript from YouTube and store it. Answers `{ data, meta: { action } }`, where `action` is `created`, `updated` or `skipped` (already stored, `force` not set). |
| `GET /api/yt-kb/yt-transcript/:videoId` | `fetcher.getOrFetch` | The stored transcript, or fetch and store it. Takes an id or a YouTube URL (watch, `youtu.be`, shorts, embed, live). |
| `POST /api/yt-kb/import/:type` | `importer.importRecords` | Bulk copy; see [Copying content in](#copying-content-in) |

The same fetch-or-return route is served on the admin API at
`GET /yt-kb/yt-transcript/:videoId`, for an admin session or admin token
holding `plugin::yt-kb.tool.fetch-transcript`.

A failed fetch answers with `error.name: "TranscriptFetchError"` and
`error.details.reason`:

| Reason | Status | Meaning |
|---|---|---|
| `invalid_id` | 400 | Not an 11-character YouTube id or a recognised URL |
| `unavailable` | 404 | Private, removed or otherwise unavailable |
| `no_captions` | 404 | The video has no caption track |
| `blocked` | 502 | YouTube refused the server's IP (bot wall) |
| `rate_limited` | 502 | YouTube kept answering 429/403 after 3 attempts |
| `network` | 502 | YouTube could not be reached, or the download failed after 3 attempts |

Only `network` is worth retrying from the client; the plugin already
retries the caption download itself.

`transcript.searchIndex` (the BM25 index) is a private attribute: REST never
returns it.

## MCP

The plugin registers its 21 tools on Strapi's official MCP server
(`/mcp`, Streamable HTTP). That server accepts **admin** API tokens only; a
Content API token gets 401. Each tool has its own admin permission, and a
token sees and can call only the tools whose permission it holds.

| MCP tool | Permission | What it does |
|---|---|---|
| `yt_kb__library_stats` | `plugin::yt-kb.tool.library-stats` | Video count, summary-status breakdown, top tags and channels, monthly ingestion |
| `yt_kb__list_videos` | `plugin::yt-kb.tool.list-videos` | Paged video list (filter by status, verdict, tag) |
| `yt_kb__search_videos` | `plugin::yt-kb.tool.search-videos` | Search titles and summaries; a URL or video id also works |
| `yt_kb__get_video` | `plugin::yt-kb.tool.get-video` | One video with its summary, sections and tags |
| `yt_kb__get_transcript` | `plugin::yt-kb.tool.get-transcript` | A stored transcript: a character slice, a page of segments, or a time range |
| `yt_kb__search_transcript` | `plugin::yt-kb.tool.search-transcript` | BM25 passages with timecodes inside one video |
| `yt_kb__find_transcripts` | `plugin::yt-kb.tool.find-transcripts` | Substring search across transcripts, with previews |
| `yt_kb__cross_search_transcripts` | `plugin::yt-kb.tool.cross-search-transcripts` | BM25 across many transcripts, top passages per video (optional tag filter) |
| `yt_kb__list_transcripts` | `plugin::yt-kb.tool.list-transcripts` | Paged list of stored transcripts |
| `yt_kb__aggregate_by_tag` | `plugin::yt-kb.tool.aggregate-by-tag` | Summary data for every video with a set of tags |
| `yt_kb__list_untagged` | `plugin::yt-kb.tool.list-untagged` | Videos with no tags, with context for suggesting some |
| `yt_kb__list_tags` | `plugin::yt-kb.tool.list-tags` | Existing tags |
| `yt_kb__related_videos` | `plugin::yt-kb.tool.related-videos` | Similar videos by cosine similarity over stored embeddings |
| `yt_kb__get_readable_article` | `plugin::yt-kb.tool.get-readable-article` | The stored readable article for a video, or null |
| `yt_kb__generate_digest` | `plugin::yt-kb.tool.generate-digest` | Summary fields of 2–5 videos, for the caller to synthesise |
| `yt_kb__save_summary` | `plugin::yt-kb.tool.save-summary` | Save a summary the caller wrote; each section's timecode is found in the transcript, never taken from the caller |
| `yt_kb__tag_video` | `plugin::yt-kb.tool.tag-video` | Add tags to a video |
| `yt_kb__untag_video` | `plugin::yt-kb.tool.untag-video` | Remove tags from a video |
| `yt_kb__save_note` | `plugin::yt-kb.tool.save-note` | Attach a note to a video |
| `yt_kb__add_video` | `plugin::yt-kb.tool.add-video` | Add a YouTube URL: creates the video and fetches its transcript (calls YouTube) |
| `yt_kb__fetch_transcript` | `plugin::yt-kb.tool.fetch-transcript` | Fetch a transcript from YouTube and store it; `force: true` re-fetches (calls YouTube) |

In the admin panel the permissions are under the plugin's **AI tools**
group, one per tool (for example "Get video").

**Give MCP tokens only `plugin::yt-kb.tool.*` permissions; never grant
Content Manager permissions on yt-kb types to a token used by an agent —
Strapi's Content Manager and `tanstack-ai` expose generic create/update/delete
tools for those types.** With those an agent can write any field directly
(for example a section timecode the model made up) or delete records.

To create an MCP token: **Settings → Admin Tokens → Create new Admin Token**,
then grant only the tool permissions the agent needs. An admin token can
hold no more than its owner's role. Then connect a client, for example
Claude Code:

```bash
claude mcp add yt-kb --transport http https://<your-strapi>/mcp \
  -H "Authorization: Bearer <admin token>"
```

Notes:

- A tool name another plugin already registered is skipped and logged
  (`[yt-kb] skipped MCP tool …`); boot goes on. A tool that throws is
  logged (`[yt-kb] MCP tool failed …`) and reported to the client as
  `Tool "<name>" execution failed: <message>`.
- A result larger than the MCP response limit (~1 MB on the wire) is
  replaced by a `RESULT_TOO_LARGE` answer that says how to ask for less.
- **Upgrading from the three tiers.** Earlier versions gated the tools with
  `plugin::yt-kb.read` (15 tools), `.write` (4) and `.maintenance` (2). At
  every boot the plugin replaces each such grant on a token or role with
  the per-tool permissions of that tier and deletes the old row, then logs
  `[yt-kb] legacy MCP grant migration: …`. Rows on the Super Admin role are
  left to Strapi. The three old actions stay registered for this release,
  labelled "(legacy — migrated at boot)". MCP clients must reconnect to see
  the `yt_kb__` names.

## tanstack-ai

When the host also runs `strapi-plugin-tanstack-ai`, its admin chat picks up
the same 21 tools from this plugin's `ai-tools` service. They appear in its
chat as `yt-kb__<name>`, with the camelCase base name (for example
`yt-kb__getTranscript`), when the admin's role holds the tool's permission
(`plugin::yt-kb.tool.<name>`; Super Admins hold all of them). Nothing needs
configuring, and `mcp: false` does not turn them off.

## Copying content in

`scripts/copy-content.mjs` copies yt-kb content from one Strapi to another
over HTTP, keeping every record's `documentId`, `createdAt` and `updatedAt`,
then checks the copy record by record. It copies tags, transcripts, videos,
notes and digests, in that order.

1. On the destination, set `import: true` in the yt-kb plugin config and
   restart it.
2. Create a destination token (Custom) with `importer.importRecords` plus
   `find` on all five types; the check reads them back. The source token
   needs `find` on the source's types (`yt-kb-app` is enough for a yt-kb
   source).
3. Run it from anywhere:

   ```bash
   SOURCE_URL=https://source.example SOURCE_TOKEN=… \
   DEST_URL=https://dest.example DEST_TOKEN=… \
     node node_modules/strapi-plugin-yt-kb/scripts/copy-content.mjs
   ```

   | Variable | Default | Meaning |
   |---|---|---|
   | `SOURCE_URL` | — (required) | Source Strapi |
   | `SOURCE_PREFIX` | `/api/yt-kb` | REST prefix of the source types; `/api` for an app that still has its own `api::` types |
   | `SOURCE_TOKEN` | — (required) | Reads the source |
   | `DEST_URL` | — (required) | Destination Strapi; must differ from `SOURCE_URL` |
   | `DEST_TOKEN` | — (required) | Imports into and reads the destination |

   `--check` compares the two sides and writes nothing. The script exits 0
   (`ALL OK`), 1 (`PROBLEMS FOUND`) or 2 (a URL or token missing, the two
   URLs naming the same Strapi, or import disabled on the destination).
   There is no default URL: both must be set, and a trailing slash or the
   host's case does not make two URLs different.
4. Set `import: false` again, restart the destination, and revoke the
   import token.

It is safe to re-run: records are upserted by `documentId`. It never
deletes; a record removed from the source is reported as "only in
destination".

**Body limit.** Records are sent in batches of at most 900 KB of JSON, so
hosts on the default `strapi::body` (1 MB JSON) copy one large record per
request. A record over ~900 KB is sent on its own; if the destination
answers 413, the record is reported as failed
(`body too large — raise strapi::body jsonLimit on the destination`) and
the copy goes on. Raise the limit in the destination's
`config/middlewares.ts`, for example
`{ name: 'strapi::body', config: { jsonLimit: '20mb' } }`, then run the
script again.

## Proxy

YouTube tends to block datacenter and cloud IPs: fetches fail with
`blocked` (its "confirm you're not a bot" wall) or `rate_limited`. On a home
connection no proxy is needed. On a cloud host, set `PROXY_URL` in the
host's environment to a residential proxy (it is the default of `proxyUrl`),
or set `proxyUrl` in the plugin config, and restart. Every YouTube request
the plugin makes goes through it.

At boot the plugin checks the proxy against `https://httpbin.org/ip`
(10 s timeout) without blocking boot, and logs, with the password masked:

```
[yt-kb] Proxy configured: http://user:****@proxy.example.com:8080
[yt-kb] Proxy connection successful - Outbound IP: 203.0.113.7
```

or, when the check fails:

```
[yt-kb] Proxy connection FAILED (http://user:****@proxy.example.com:8080): <error>
[yt-kb] YouTube requests will likely fail. Check the proxy credentials and URL.
```

With no proxy it logs a warning instead:
`[yt-kb] No proxy configured; YouTube may block datacenter IPs. Set PROXY_URL, or proxyUrl in the yt-kb plugin config (config/plugins.ts).`

The caption download makes up to 3 attempts of 25 s each. It backs off 1 s
and 3 s between attempts, or 2 s and 6 s (honouring `Retry-After` up to
15 s, with a fresh YouTube session) when YouTube rate-limits it.

## License

GPL-3.0-or-later. The full text is in [LICENSE](./LICENSE).

The transcript fetcher (`server/src/services/youtube-transcript.ts`: metadata
extraction, the proxy fetch, the caption parsers, the caption download and
track choice, and the boot-time proxy check) is adapted from
[`strapi-plugin-youtube-transcripts`](https://www.npmjs.com/package/strapi-plugin-youtube-transcripts)
2.6.2, which is MIT-licensed. Its URL patterns, metadata backfill and tool
naming follow the same plugin. Its notice:

```
Copyright (c) Paul Brats

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
