// Admin permissions for this plugin's MCP tools.
//
// The official MCP server gates each custom tool behind an `auth.policies`
// action; that action must exist in the admin permission registry before a
// token can be granted it, and a tool appears in `tools/list` only when the
// connecting token holds its action.
//
// Registered under the plugin namespace (section 'plugins', pluginName
// 'yt-kb'), so the action ids are plugin::yt-kb.read / .write / .maintenance
// and can never collide with a host app's own permissions.
import type { Core } from '@strapi/strapi';

export const MCP_ACTIONS = {
  READ: 'plugin::yt-kb.read',
  WRITE: 'plugin::yt-kb.write',
  MAINTENANCE: 'plugin::yt-kb.maintenance',
} as const;

/** Gates GET /yt-kb/yt-transcript/:videoId (admin route) — the action
 *  youtube-transcripts uses for its route, and the per-tool action M5 gives
 *  the fetchTranscript tool. Registered here ahead of M5 so the route works
 *  now; M5 keeps this uid (it must not register it a second time). */
export const FETCH_TRANSCRIPT_ACTION = 'plugin::yt-kb.tool.fetch-transcript';

const ACTION_DEFS = [
  {
    section: 'plugins',
    pluginName: 'yt-kb',
    subCategory: 'MCP tools',
    displayName: 'Use read-only MCP tools',
    uid: 'read',
  },
  {
    section: 'plugins',
    pluginName: 'yt-kb',
    subCategory: 'MCP tools',
    displayName: 'Use mutating MCP tools',
    uid: 'write',
  },
  {
    // The external-side-effect tools: fetchTranscript + addVideo, which hit
    // YouTube. Split out so a browse-and-annotate token (read + write) can't
    // trigger them. There is no embedding tool: inference runs in the client.
    section: 'plugins',
    pluginName: 'yt-kb',
    subCategory: 'MCP tools',
    displayName: 'Use maintenance MCP tools (hit YouTube)',
    uid: 'maintenance',
  },
  {
    section: 'plugins',
    pluginName: 'yt-kb',
    subCategory: 'AI tools',
    displayName: 'Fetch transcript',
    uid: 'tool.fetch-transcript',
  },
];

export async function registerMcpAdminPermissions(
  strapi: Core.Strapi,
): Promise<void> {
  await strapi
    .service('admin::permission')
    .actionProvider.registerMany(ACTION_DEFS);
  strapi.log.info(
    `[yt-kb] registered ${ACTION_DEFS.length} MCP admin permission(s)`,
  );
}
