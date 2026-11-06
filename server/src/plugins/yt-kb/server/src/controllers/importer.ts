import type { Core } from '@strapi/strapi';
import { IMPORT_TYPES, isImportType } from '../services/importer';

// POST /api/yt-kb/import/:type  { data: [record, ...] }
// Scope plugin::yt-kb.importer.importRecords — granted to no role; a token
// needs it explicitly (or full access). See services/importer.ts.
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async importRecords(ctx: any) {
    const { type } = ctx.params;
    if (!isImportType(type)) {
      return ctx.badRequest(`Unknown type "${type}". Expected one of: ${IMPORT_TYPES.join(', ')}`);
    }
    const records = ctx.request.body?.data;
    if (!Array.isArray(records)) {
      return ctx.badRequest('Body must be { "data": [ ...records ] }');
    }
    ctx.body = await strapi.plugin('yt-kb').service('importer').importRecords(type, records);
  },
});
