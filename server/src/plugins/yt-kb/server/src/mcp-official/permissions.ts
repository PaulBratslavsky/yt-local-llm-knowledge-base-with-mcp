// Admin permissions for this plugin's tools.
//
// One action per tool, plugin::yt-kb.tool.<kebab> (section 'plugins',
// subCategory 'AI tools', youtube-transcripts' shape). The official MCP
// server lists a tool only to a token holding its action; tanstack-ai offers
// a tool only to an admin whose role holds it.
//
// The three tier actions of earlier versions stay registered for one release
// so the boot-time migration (permission-seeding/legacy-grants.ts) can still
// read their rows: Strapi deletes rows of unregistered actions at boot.
//
// registerMany is NOT wrapped in try/catch on purpose: if it failed and boot
// went on, admin's cleanPermissionsInDatabase would delete every yt-kb grant.
//
// M3 registered plugin::yt-kb.tool.fetch-transcript by hand ahead of the
// others; this file replaces that entry with the generated list, which
// contains it exactly once (the action provider throws on a duplicate).
import type { Core } from '@strapi/strapi';
import { domainTools } from './tools';
import { PLUGIN_ID, toolActionId, toolActionUid, toolDisplayName } from './names';

/** Gates the admin route GET /yt-kb/yt-transcript/:videoId (routes/index.ts,
 *  M3) — the same action as the fetchTranscript tool. */
export const FETCH_TRANSCRIPT_ACTION = toolActionId('fetchTranscript');

export const LEGACY_ACTIONS = {
  READ: 'plugin::yt-kb.read',
  WRITE: 'plugin::yt-kb.write',
  MAINTENANCE: 'plugin::yt-kb.maintenance',
} as const;

const LEGACY_SUFFIX = ' (legacy — migrated at boot)';

export const LEGACY_ACTION_DEFS = [
  {
    section: 'plugins',
    pluginName: PLUGIN_ID,
    subCategory: 'MCP tools',
    displayName: `Use read-only MCP tools${LEGACY_SUFFIX}`,
    uid: 'read',
  },
  {
    section: 'plugins',
    pluginName: PLUGIN_ID,
    subCategory: 'MCP tools',
    displayName: `Use mutating MCP tools${LEGACY_SUFFIX}`,
    uid: 'write',
  },
  {
    section: 'plugins',
    pluginName: PLUGIN_ID,
    subCategory: 'MCP tools',
    displayName: `Use maintenance MCP tools (hit YouTube)${LEGACY_SUFFIX}`,
    uid: 'maintenance',
  },
];

export const buildToolActionDefs = () =>
  domainTools.map(({ tool }) => ({
    section: 'plugins',
    pluginName: PLUGIN_ID,
    subCategory: 'AI tools',
    displayName: toolDisplayName(tool.name),
    uid: toolActionUid(tool.name),
  }));

export async function registerMcpAdminPermissions(strapi: Core.Strapi): Promise<void> {
  const toolDefs = buildToolActionDefs();
  await strapi
    .service('admin::permission')
    .actionProvider.registerMany([...toolDefs, ...LEGACY_ACTION_DEFS]);
  strapi.log.info(
    `[yt-kb] registered ${toolDefs.length} tool permission(s) and ${LEGACY_ACTION_DEFS.length} legacy tier permission(s)`,
  );
}
