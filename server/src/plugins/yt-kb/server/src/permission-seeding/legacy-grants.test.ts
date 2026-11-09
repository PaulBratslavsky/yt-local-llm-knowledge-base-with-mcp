import { describe, expect, it, vi } from 'vitest';
import { migrateLegacyToolGrants, perToolActionsForLegacy } from './legacy-grants';

type Row = { id: number; action: string; conditions: string[]; role: { id: number; code: string } | null; apiToken: { id: number } | null };
const ROLES: Record<number, { id: number; code: string }> = {
  1: { id: 1, code: 'strapi-super-admin' },
  2: { id: 2, code: 'strapi-editor' },
};
const legacy = (id: number, action: string, owner: Partial<Row>): Row =>
  ({ id, action: `plugin::yt-kb.${action}`, conditions: [], role: null, apiToken: null, ...owner }) as Row;

function fakeStrapi(rows: Row[]) {
  let nextId = 1000;
  const matches = (r: Row, where: any) =>
    (!where.action?.$in || where.action.$in.includes(r.action)) &&
    (!where.apiToken || r.apiToken?.id === where.apiToken.id) &&
    (!where.role || r.role?.id === where.role.id);
  const query = {
    findMany: vi.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r }))),
    create: vi.fn(async ({ data }: any) => {
      const row: Row = {
        id: nextId++, action: data.action, conditions: data.conditions,
        role: data.role ? ROLES[data.role] : null, apiToken: data.apiToken ? { id: data.apiToken } : null,
      };
      rows.push(row);
      return row;
    }),
    delete: vi.fn(async ({ where }: any) => rows.splice(rows.findIndex((r) => r.id === where.id), 1)[0]),
  };
  const strapi = {
    db: { query: vi.fn(() => query), transaction: vi.fn(async (cb: any) => cb({})) },
    log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
  return { strapi: strapi as any, rows, query };
}

const actionsOf = (rows: Row[], pred: (r: Row) => boolean) => rows.filter(pred).map((r) => r.action).sort();

describe('legacy MCP grant migration', () => {
  it('maps the tiers to 15 / 4 / 2 per-tool actions', () => {
    expect(perToolActionsForLegacy('plugin::yt-kb.read')).toHaveLength(15);
    expect(perToolActionsForLegacy('plugin::yt-kb.write')).toEqual([
      'plugin::yt-kb.tool.save-summary', 'plugin::yt-kb.tool.tag-video',
      'plugin::yt-kb.tool.untag-video', 'plugin::yt-kb.tool.save-note',
    ]);
    expect(perToolActionsForLegacy('plugin::yt-kb.maintenance')).toEqual([
      'plugin::yt-kb.tool.add-video', 'plugin::yt-kb.tool.fetch-transcript',
    ]);
  });

  it('gives a token holding all three tiers the 21 tool actions and drops the tiers', async () => {
    const { strapi, rows } = fakeStrapi([
      legacy(1, 'read', { apiToken: { id: 4 } }),
      legacy(2, 'write', { apiToken: { id: 4 } }),
      legacy(3, 'maintenance', { apiToken: { id: 4 } }),
    ]);
    const r = await migrateLegacyToolGrants(strapi);
    expect(r).toEqual({ legacyRows: 3, migratedRows: 3, inserted: 21, skippedSuperAdmin: 0, skippedOrphans: 0 });
    const onToken = actionsOf(rows, (x) => x.apiToken?.id === 4);
    expect(onToken).toHaveLength(21);
    expect(onToken.every((a) => a.startsWith('plugin::yt-kb.tool.'))).toBe(true);
    expect(strapi.db.transaction).toHaveBeenCalledTimes(3);
  });

  it('migrates a non-super-admin role and keeps its conditions', async () => {
    const { strapi, rows } = fakeStrapi([{ ...legacy(1, 'write', { role: ROLES[2] }), conditions: ['admin::is-creator'] }]);
    await migrateLegacyToolGrants(strapi);
    const onRole = rows.filter((x) => x.role?.id === 2);
    expect(onRole).toHaveLength(4);
    expect(onRole.every((x) => x.conditions[0] === 'admin::is-creator')).toBe(true);
  });

  it('leaves super-admin and orphan rows to Strapi', async () => {
    const { strapi, rows } = fakeStrapi([legacy(1, 'read', { role: ROLES[1] }), legacy(2, 'read', {})]);
    const r = await migrateLegacyToolGrants(strapi);
    expect(r).toMatchObject({ legacyRows: 2, migratedRows: 0, inserted: 0, skippedSuperAdmin: 1, skippedOrphans: 1 });
    expect(rows.map((x) => x.id)).toEqual([1, 2]);
  });

  it('does not duplicate an action the owner already holds', async () => {
    const { strapi, rows } = fakeStrapi([
      { id: 9, action: 'plugin::yt-kb.tool.get-video', conditions: [], role: null, apiToken: { id: 4 } },
      legacy(1, 'read', { apiToken: { id: 4 } }),
    ]);
    const r = await migrateLegacyToolGrants(strapi);
    expect(r.inserted).toBe(14);
    expect(rows.filter((x) => x.action === 'plugin::yt-kb.tool.get-video')).toHaveLength(1);
  });

  it('is idempotent', async () => {
    const { strapi, rows } = fakeStrapi([legacy(1, 'read', { apiToken: { id: 4 } })]);
    await migrateLegacyToolGrants(strapi);
    const before = rows.length;
    const second = await migrateLegacyToolGrants(strapi);
    expect(second).toEqual({ legacyRows: 0, migratedRows: 0, inserted: 0, skippedSuperAdmin: 0, skippedOrphans: 0 });
    expect(rows.length).toBe(before);
  });
});
