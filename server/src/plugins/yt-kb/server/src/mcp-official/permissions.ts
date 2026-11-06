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
