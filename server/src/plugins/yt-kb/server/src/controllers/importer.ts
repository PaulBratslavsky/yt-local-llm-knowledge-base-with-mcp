import type { Core } from '@strapi/strapi';
import { IMPORT_TYPES, isImportType } from '../services/importer';

export const IMPORT_DISABLED_MESSAGE =
  'Import is disabled. Set the yt-kb plugin config `import: true` to enable it.';

// POST /api/yt-kb/import/:type  { data: [record, ...] }
// Scope plugin::yt-kb.importer.importRecords — granted to no role, and the
// route refuses (403) unless the plugin config sets `import: true` (M-7).
// 200 when every record was written, 207 when any failed; the body is
// { created, updated, failed[] } either way.
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async importRecords(ctx: any) {
    if (strapi.plugin('yt-kb').config('import') !== true) {
      ctx.status = 403;
      ctx.body = {
        data: null,
        error: { status: 403, name: 'ForbiddenError', message: IMPORT_DISABLED_MESSAGE, details: {} },
      };
      return;
    }
    const { type } = ctx.params;
    if (!isImportType(type)) {
      return ctx.badRequest(`Unknown type "${type}". Expected one of: ${IMPORT_TYPES.join(', ')}`);
    }
    const records = ctx.request.body?.data;
    if (!Array.isArray(records)) {
      return ctx.badRequest('Body must be { "data": [ ...records ] }');
    }
    const result = await strapi.plugin('yt-kb').service('importer').importRecords(type, records);
    ctx.body = result;
    ctx.status = result.failed.length > 0 ? 207 : 200;
  },
});
