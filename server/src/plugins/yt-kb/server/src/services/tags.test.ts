import { describe, expect, it } from 'vitest';
import type { Core } from '@strapi/strapi';
import { findOrCreateTag, type TagRow } from './tags';

const unique = () => Object.assign(new Error('UNIQUE constraint failed: yt_kb_tags.name'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
const row = (name: string, slug = name): TagRow => ({ documentId: `doc-${slug}`, name, slug });

function fake(finds: Array<TagRow | null>, creates: Array<TagRow | Error>, inTransaction = false) {
  const created: unknown[] = [];
  const strapi = {
    db: { inTransaction: () => inTransaction },
    documents: () => ({
      findFirst: async () => finds.shift() ?? null,
      create: async (params: unknown) => {
        created.push(params);
        const next = creates.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    }),
  } as unknown as Core.Strapi;
  return { strapi, created };
}

describe('findOrCreateTag', () => {
  it('returns an existing tag without creating', async () => {
    const { strapi, created } = fake([row('ai')], []);
    expect(await findOrCreateTag(strapi, ' AI ')).toEqual(row('ai'));
    expect(created).toEqual([]);
  });
  it('creates with the normalized name only (the rule makes the slug)', async () => {
    const { strapi, created } = fake([null], [row('foo bar', 'foo-bar')]);
    await findOrCreateTag(strapi, '  Foo   BAR ');
    expect(created).toEqual([{ data: { name: 'foo bar' } }]);
  });
  it('returns the winner of a name race', async () => {
    const { strapi } = fake([null, row('ai')], [unique()]);
    expect(await findOrCreateTag(strapi, 'ai')).toEqual(row('ai'));
  });
  it('creates once more after a slug race', async () => {
    const { strapi, created } = fake([null, null], [unique(), row('c#', 'c-2')]);
    expect(await findOrCreateTag(strapi, 'c#')).toEqual(row('c#', 'c-2'));
    expect(created).toHaveLength(2);
  });
  it('rethrows inside a transaction so the caller retries it whole', async () => {
    const { strapi } = fake([null], [unique()], true);
    await expect(findOrCreateTag(strapi, 'ai')).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
  });
  it('rethrows other errors and skips empty names', async () => {
    const { strapi } = fake([null], [new Error('boom')]);
    await expect(findOrCreateTag(strapi, 'ai')).rejects.toThrow('boom');
    const empty = fake([], []);
    expect(await findOrCreateTag(empty.strapi, '   ')).toBeNull();
    expect(empty.created).toEqual([]);
  });
});
