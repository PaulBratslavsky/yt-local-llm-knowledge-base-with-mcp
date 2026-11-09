// M-14: yt-kb grants nothing to Users & Permissions' Public or Authenticated
// roles — every caller uses its own token. A host whose owner ticked yt-kb
// routes for those roles gets them removed at boot. A host without
// Users & Permissions is left alone.
import type { Core } from '@strapi/strapi';

export const OPEN_ROLE_TYPES = ['public', 'authenticated'];

/** Number of rows removed, or null when Users & Permissions is not installed. */
export async function removeYtKbFromOpenRoles(strapi: Core.Strapi): Promise<number | null> {
  if (!strapi.plugin('users-permissions')) return null;
  const query = strapi.db.query('plugin::users-permissions.permission');
  const rows = (await query.findMany({
    where: {
      action: { $startsWith: 'plugin::yt-kb.' },
      role: { type: { $in: OPEN_ROLE_TYPES } },
    },
    select: ['id'],
  })) as { id: number }[];
  if (rows.length > 0) {
    await query.deleteMany({ where: { id: { $in: rows.map((r) => r.id) } } });
  }
  return rows.length;
}
