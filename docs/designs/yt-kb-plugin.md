# yt-kb as a Strapi plugin

**Goal.** Move everything Strapi does for this project into a plugin,
`strapi-plugin-yt-kb`, built and tested inside this repo, then published to
npm and installed into `strapi-cloud-backend-main-site` (Strapi Cloud). This
repo then becomes frontend-only: `client/` (TanStack + Ollama) and `site/`
(Astro).

The host already runs `strapi-plugin-youtube-transcripts` (with `PROXY_URL`)
and MCP with OAuth. Both are Strapi 5.52.1.

## Decisions

| | Decision | Why |
|---|---|---|
| Name | plugin `yt-kb`, npm `strapi-plugin-yt-kb` | matches the host's existing plugins |
| Location while building | `server/src/plugins/yt-kb`, loaded with `resolve` | test against the real data before publishing |
| UIDs | `plugin::yt-kb.video` / `.tag` / `.transcript` / `.note` / `.digest` | plugin namespace |
| Tables | `yt_kb_*` | the host already has its own `tags` table |
| REST paths | `/api/yt-kb/videos` etc. (plugin prefix kept) | the host already has a `tag` content type, so `/api/tags` would collide |
| Components | 9 components registered from the plugin's `register()` with `strapi.get('components').add`, category `ytkb` | Strapi 5.52 loads components only from the app's `src/components`. **Proven by spike** (2026-11-06): a plugin-registered repeatable component created its tables and round-tripped via REST (201). Undocumented API — **re-check on every Strapi upgrade.** |
| Content API permissions | none granted to Public | new plugin actions aren't public by default. The app writes with a Content API token; the site reads with a read-only token. The Public role is never touched, so the host site's permissions can't be affected. |
| MCP permissions | admin actions `plugin::yt-kb.read` / `.write` / `.maintenance`, registered in the plugin | same tiering as today, under the plugin namespace |
| `@strapi/utils`, `@strapi/strapi` | **peer** dependencies, never bundled | MCP schema conversion needs the host's single `zod` instance |
| Transcripts | plugin keeps its own `transcript` type for now | converging onto `youtube-transcripts` is a separate change (segment shape `startMs` vs `start`); doing both at once doubles the risk |

## Not in the plugin (host app concerns)

CORS, `HOST`, the Public role, users-permissions extensions, database config.

## Data

`strapi transfer` can't map `api::` -> `plugin::`, and it replaces the whole
destination database, so it can't be used on a host with content of its own.
A copy script moves the data over HTTP instead:
`scripts/copy-content.mjs` in the plugin (shipped in the npm package).

- **Plain REST can't do the copy.** The REST API rejects `createdAt` on create
  (`400 Invalid key createdAt`), and a copy that resets it scrambles the feed
  (sorted by `createdAt`) and every "Added X ago". New documentIds would also
  break saved `/video/<documentId>` links.
- **So the plugin has an import route:** `POST /api/yt-kb/import/:type`,
  scope `plugin::yt-kb.importer.importRecords`, granted to no role. It writes
  through the Document Service (so the dedupe and tag rules still run),
  keeps each record's documentId, and sets `created_at` / `updated_at` on
  the row afterwards. It takes records in the shape REST returns them, so a
  copy is GET from the source, POST to the destination.
- **Idempotent:** upsert by documentId. It never deletes.
- **Checked:** after copying, the script reads both sides back and compares
  every record, field by field, with relations and components. It exits
  non-zero on any difference. `--check` runs the comparison alone.
- The same script does the later local -> Cloud copy
  (`SOURCE_PREFIX=/api/yt-kb`, `DEST_URL=<cloud>`).

**Order matters:** removing a content type drops its table, so the old
`api::` types stay in this app until the copy is verified, and only then are
removed.

Step 5 result (2026-11-06, live `data.db`): 17 tags, 195 transcripts,
195 videos, 11 notes and 6 digests copied, with no failures and no
differences. An SQL cross-check, independent of the script, found every
link table, component table, documentId and date equal. Tampering with
one copied video (title plus a tag link) was flagged by `--check` and
repaired by a re-run, with no duplicate rows.

## Steps

1. Scaffold the plugin package and register it in this app (empty).
2. Content types, components, controllers, services, routes.
3. Document Service rules (video dedupe, tag normalize + slug).
4. MCP: the 21 tools, admin permissions, adapter.
5. Copy script `api::` -> `plugin::`; verify counts and relations. **Done.**
6. Client and site: path prefix, site read-only token.
7. End-to-end through the UI; then remove the `api::` types.
8. Publish to npm; install in the host.
