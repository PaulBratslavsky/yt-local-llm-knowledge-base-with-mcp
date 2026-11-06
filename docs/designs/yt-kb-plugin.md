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

`strapi transfer` can't map `api::` -> `plugin::`, so a copy script moves the
data over REST and is idempotent. **Order matters:** removing a content type
drops its table, so the old `api::` types stay in this app until the copy is
verified, and only then are removed.

## Steps

1. Scaffold the plugin package and register it in this app (empty).
2. Content types, components, controllers, services, routes.
3. Document Service rules (video dedupe, tag normalize + slug).
4. MCP: the 21 tools, admin permissions, adapter.
5. Copy script `api::` -> `plugin::`; verify counts and relations.
6. Client and site: path prefix, site read-only token.
7. End-to-end through the UI; then remove the `api::` types.
8. Publish to npm; install in the host.
