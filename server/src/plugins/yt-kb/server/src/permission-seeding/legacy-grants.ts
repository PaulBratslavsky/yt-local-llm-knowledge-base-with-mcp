// Boot-time migration of the three legacy tier grants to per-tool grants.
//
// For each admin_permissions row whose action is plugin::yt-kb.read /
// .write / .maintenance and which belongs to an API token or a role, insert
// the per-tool actions of that tier (read → 15 tools, write → 4,
// maintenance → 2; from domainTools' sideEffects) for the same token or role
// when absent, then delete the legacy row — one transaction per row.
// Idempotent: a second run finds no legacy rows (or only skipped ones).
//
// Skipped on purpose:
// - rows on the super-admin role: admin's bootstrap runs AFTER plugin
//   bootstraps and resetSuperAdminPermissions() grants that role every
//   registered action — the 21 tool actions, and the legacy ones again for
//   as long as they stay registered. Deleting them here would churn every boot.
// - rows with neither a role nor a token: admin's cleanPermissionsInDatabase
//   deletes orphans on the same boot.
//
// The new rows copy the legacy row's `conditions`; `subject` is null and
// `properties` {} (plugin actions have neither).
import type { Core } from '@strapi/strapi';
import { domainTools } from '../mcp-official/tools';
import type { SideEffects } from '../mcp-official/adapter';
import { toolActionId } from '../mcp-official/names';
import { LEGACY_ACTIONS } from '../mcp-official/permissions';

const SUPER_ADMIN_CODE = 'strapi-super-admin';

const LEGACY_BY_SIDE_EFFECTS: Record<SideEffects, string> = {
  none: LEGACY_ACTIONS.READ,
  write: LEGACY_ACTIONS.WRITE,
  external: LEGACY_ACTIONS.MAINTENANCE,
};

/** The per-tool action ids a legacy tier action stood for. */
export function perToolActionsForLegacy(legacyAction: string): string[] {
  return domainTools
    .filter((d) => LEGACY_BY_SIDE_EFFECTS[d.sideEffects] === legacyAction)
    .map((d) => toolActionId(d.tool.name));
}

type LegacyRow = {
  id: number;
  action: string;
  conditions?: unknown;
  role?: { id: number; code?: string } | null;
  apiToken?: { id: number } | null;
};

export type LegacyMigrationResult = {
  legacyRows: number;
  migratedRows: number;
  inserted: number;
  skippedSuperAdmin: number;
  skippedOrphans: number;
};

export async function migrateLegacyToolGrants(strapi: Core.Strapi): Promise<LegacyMigrationResult> {
  const permissions = strapi.db.query('admin::permission');
  const rows = (await permissions.findMany({
    where: { action: { $in: Object.values(LEGACY_ACTIONS) } },
    populate: ['role', 'apiToken'],
  })) as LegacyRow[];

  const result: LegacyMigrationResult = {
    legacyRows: rows.length,
    migratedRows: 0,
    inserted: 0,
    skippedSuperAdmin: 0,
    skippedOrphans: 0,
  };

  for (const row of rows) {
    if (row.role?.code === SUPER_ADMIN_CODE) {
      result.skippedSuperAdmin += 1;
      continue;
    }
    const tokenId = row.apiToken?.id ?? null;
    const roleId = row.role?.id ?? null;
    if (tokenId === null && roleId === null) {
      result.skippedOrphans += 1;
      continue;
    }
    const owner = tokenId !== null ? { apiToken: tokenId } : { role: roleId };
    const ownerWhere =
      tokenId !== null ? { apiToken: { id: tokenId } } : { role: { id: roleId } };
    const wanted = perToolActionsForLegacy(row.action);

    await strapi.db.transaction(async () => {
      const existing = (await permissions.findMany({
        where: { action: { $in: wanted }, ...ownerWhere },
        select: ['action'],
      })) as { action: string }[];
      const have = new Set(existing.map((p) => p.action));
      for (const action of wanted) {
        if (have.has(action)) continue;
        await permissions.create({
          data: {
            action,
            actionParameters: {},
            subject: null,
            properties: {},
            conditions: Array.isArray(row.conditions) ? row.conditions : [],
            ...owner,
          },
        });
        result.inserted += 1;
      }
      await permissions.delete({ where: { id: row.id } });
    });
    result.migratedRows += 1;
  }
  return result;
}
