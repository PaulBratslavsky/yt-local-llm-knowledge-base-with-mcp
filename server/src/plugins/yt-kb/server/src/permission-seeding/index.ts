import type { Core } from '@strapi/strapi';
import { migrateLegacyToolGrants } from './legacy-grants';
import { removeYtKbFromOpenRoles } from './users-permissions';

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Permission work done in code at boot (standard §5). Never throws. */
export async function seedPermissions(strapi: Core.Strapi): Promise<void> {
  // Counts go in the message as well as the meta object: Strapi's default
  // console format prints only the message.
  try {
    const r = await migrateLegacyToolGrants(strapi);
    strapi.log.info(
      `[yt-kb] legacy MCP grant migration: ${r.legacyRows} legacy row(s), ${r.migratedRows} migrated, ${r.inserted} per-tool grant(s) added, ${r.skippedSuperAdmin} super-admin and ${r.skippedOrphans} orphan row(s) left to Strapi`,
      r,
    );
  } catch (err) {
    const message = errorMessage(err);
    strapi.log.warn(`[yt-kb] legacy MCP grant migration failed: ${message}`);
  }
  try {
    const removed = await removeYtKbFromOpenRoles(strapi);
    if (removed === null) {
      strapi.log.info('[yt-kb] Users & Permissions not installed; no role permissions to check');
    } else {
      strapi.log.info(`[yt-kb] removed ${removed} yt-kb permission(s) from Public/Authenticated roles`, { count: removed });
    }
  } catch (err) {
    const message = errorMessage(err);
    strapi.log.warn(`[yt-kb] could not check Users & Permissions roles: ${message}`);
  }
}
