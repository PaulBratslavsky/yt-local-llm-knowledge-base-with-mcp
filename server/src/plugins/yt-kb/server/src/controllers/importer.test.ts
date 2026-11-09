import { describe, expect, it, vi } from 'vitest';
import controllerFactory, { IMPORT_DISABLED_MESSAGE } from './importer';

const make = (importFlag: unknown, result?: unknown) => {
  const service = { importRecords: vi.fn(async () => result) };
  const strapi = {
    plugin: () => ({ config: (k: string) => (k === 'import' ? importFlag : undefined), service: () => service }),
  };
  return { controller: controllerFactory({ strapi } as never), service };
};
const ctx = () => ({ params: { type: 'tag' }, request: { body: { data: [] } }, status: 404, body: undefined as any, badRequest: vi.fn() });

describe('import gate', () => {
  for (const flag of [undefined, false, 'true']) {
    it(`refuses with 403 when import is ${String(flag)}`, async () => {
      const { controller, service } = make(flag);
      const c = ctx();
      await controller.importRecords(c);
      expect(c.status).toBe(403);
      expect(c.body.error.message).toBe(IMPORT_DISABLED_MESSAGE);
      expect(service.importRecords).not.toHaveBeenCalled();
    });
  }
  it('returns 200 when every record was written', async () => {
    const { controller } = make(true, { created: 1, updated: 0, failed: [] });
    const c = ctx();
    await controller.importRecords(c);
    expect(c.status).toBe(200);
    expect(c.body).toEqual({ created: 1, updated: 0, failed: [] });
  });
  it('returns 207 with the same body when any record failed', async () => {
    const body = { created: 1, updated: 0, failed: [{ documentId: 'x', error: 'bad' }] };
    const { controller } = make(true, body);
    const c = ctx();
    await controller.importRecords(c);
    expect(c.status).toBe(207);
    expect(c.body).toEqual(body);
  });
});
