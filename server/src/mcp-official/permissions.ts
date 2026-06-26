// Custom admin permissions for the official Strapi MCP server's tools.
//
// The official server gates each custom tool behind an `auth.policies`
// action string; that action must exist in the admin permission registry
// before a token can be granted it (and a tool only appears in `tools/list`
// when the connecting token's ability satisfies its policy). Registering
// these is a required step the docs gloss over.
//
// App-level registration (we're an app, not a plugin) uses
// `section: 'settings'`, which yields action ids under the `api::` prefix.
// Three coarse actions — read / write / maintenance — keep token scoping
// simple: grant a read-only token the read action to expose every retrieval
// tool while hiding the mutating ones; the maintenance tier fences off the
// expensive / external-side-effect tools.
import type { Core } from '@strapi/strapi';

export const MCP_ACTIONS = {
  READ: 'api::yt-kb-mcp.read',
  WRITE: 'api::yt-kb-mcp.write',
  MAINTENANCE: 'api::yt-kb-mcp.maintenance',
} as const;

const ACTION_DEFS = [
  {
    section: 'settings',
    category: 'MCP',
    displayName: 'Use read-only yt-knowledge-base MCP tools',
    uid: 'yt-kb-mcp.read',
  },
  {
    section: 'settings',
    category: 'MCP',
    displayName: 'Use mutating yt-knowledge-base MCP tools',
    uid: 'yt-kb-mcp.write',
  },
  {
    // The expensive / external-side-effect / hard-to-undo tools:
    // reindexEmbeddings (long Ollama run), fetchTranscript + addVideo
    // (hit YouTube), generateDigest (LLM cost). Split out so a
    // browse-and-annotate token (read + write) can't trigger them.
    section: 'settings',
    category: 'MCP',
    displayName: 'Use maintenance / expensive yt-knowledge-base MCP tools',
    uid: 'yt-kb-mcp.maintenance',
  },
];

export async function registerMcpAdminPermissions(
  strapi: Core.Strapi,
): Promise<void> {
  await strapi
    .service('admin::permission')
    .actionProvider.registerMany(ACTION_DEFS);
  strapi.log.info(
    `[yt-kb mcp] Registered ${ACTION_DEFS.length} custom admin permission(s).`,
  );
}
