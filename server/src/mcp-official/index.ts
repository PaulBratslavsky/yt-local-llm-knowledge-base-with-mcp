// Entry point for registering yt-knowledge-base's domain tools on the
// OFFICIAL Strapi MCP server. Called from src/index.ts register() —
// registration must happen before the MCP server starts (it locks its tool
// set at start).
import type { Core } from '@strapi/strapi';
import { registerMcpAdminPermissions } from './permissions';
import { registerDomainTool } from './adapter';
import { domainTools } from './tools';

export async function registerOfficialMcpTools(
  strapi: Core.Strapi,
): Promise<void> {
  // Permissions register unconditionally, BEFORE the enabled check.
  //
  // Strapi admin's bootstrap runs cleanPermissionsInDatabase(), which
  // deletes every `admin::permission` row whose action is not in the
  // actionProvider — and an admin API token's grants are exactly those
  // rows. Registering these behind the MCP flag meant a single boot with
  // MCP_ENABLED=false wiped the yt-kb-mcp grants from every token, with
  // nothing logged; turning MCP back on restored the actions but not the
  // grants, so every token had to be re-minted by hand.
  //
  // An action definition with no tool referencing it is inert: it shows up
  // in the admin permission grid and can be granted, and nothing reads it
  // until a tool declares it in `auth.policies`. Cheap insurance against
  // an unrecoverable data loss.
  await registerMcpAdminPermissions(strapi);

  const mcp = strapi.ai?.mcp;
  if (!mcp?.isEnabled()) {
    strapi.log.info(
      '[yt-kb mcp] official MCP server disabled — skipping custom tools. ' +
        'Admin permissions stay registered so existing token grants survive.',
    );
    return;
  }

  for (const def of domainTools) {
    registerDomainTool(mcp.registerTool, strapi, def);
  }
  strapi.log.info(
    `[yt-kb mcp] Registered ${domainTools.length} custom tool(s) on the official MCP server.`,
  );
}
