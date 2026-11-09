import { describe, expect, it, vi } from 'vitest';
import { removeYtKbFromOpenRoles } from './users-permissions';

const rowsFixture = () => [
  { id: 1, action: 'plugin::yt-kb.video.find', role: { type: 'public' } },
  { id: 2, action: 'plugin::yt-kb.importer.importRecords', role: { type: 'authenticated' } },
  { id: 3, action: 'plugin::yt-kb.video.find', role: { type: 'editor' } },
  { id: 4, action: 'api::article.article.find', role: { type: 'public' } },
];

function fakeStrapi(installed: boolean) {
  let rows = rowsFixture();
  const query = {
    findMany: vi.fn(async ({ where }: any) =>
      rows.filter((r) => r.action.startsWith(where.action.$startsWith) && where.role.type.$in.includes(r.role.type))),
    deleteMany: vi.fn(async ({ where }: any) => {
      const before = rows.length;
      rows = rows.filter((r) => !where.id.$in.includes(r.id));
      return { count: before - rows.length };
    }),
  };
  const strapi = { plugin: vi.fn(() => (installed ? {} : undefined)), db: { query: vi.fn(() => query) } };
  return { strapi: strapi as any, query, rows: () => rows };
}

describe('Users & Permissions cleanup', () => {
  it('removes yt-kb actions from Public and Authenticated only', async () => {
    const f = fakeStrapi(true);
    expect(await removeYtKbFromOpenRoles(f.strapi)).toBe(2);
    expect(f.strapi.db.query).toHaveBeenCalledWith('plugin::users-permissions.permission');
    expect(f.rows().map((r) => r.id)).toEqual([3, 4]);
  });
  it('is a no-op the second time', async () => {
    const f = fakeStrapi(true);
    await removeYtKbFromOpenRoles(f.strapi);
    expect(await removeYtKbFromOpenRoles(f.strapi)).toBe(0);
    expect(f.query.deleteMany).toHaveBeenCalledTimes(1);
  });
  it('does nothing without Users & Permissions', async () => {
    const f = fakeStrapi(false);
    expect(await removeYtKbFromOpenRoles(f.strapi)).toBeNull();
    expect(f.strapi.db.query).not.toHaveBeenCalled();
  });
});
