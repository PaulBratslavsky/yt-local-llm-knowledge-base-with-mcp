import { describe, expect, it } from 'vitest';
import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { registerDocumentRules } from './document-rules';
import { UNIQUE_CODE, UNIQUE_MESSAGE } from './services/db-errors';

type Mw = (ctx: any, next: () => Promise<unknown>) => Promise<unknown>;
// `data` is a loose record so the rule's additions (`slug`) typecheck
// under `test:ts:back`, which includes the tests.
type Ctx = { uid: string; action: string; params: { data: Record<string, unknown> } };
const unique = () => Object.assign(new Error('UNIQUE constraint failed: yt_kb_videos.youtube_video_id'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });

function rules({ slugs = [] as string[], existingVideo = null as null | { documentId: string } } = {}) {
  let mw: Mw | undefined;
  let slugQuery: unknown;
  const documents = Object.assign(() => ({ findFirst: async () => existingVideo }), {
    use: (fn: Mw) => { mw = fn; },
  });
  const strapi = {
    documents,
    db: { query: () => ({ findMany: async (q: unknown) => { slugQuery = q; return slugs.map((slug) => ({ slug })); } }) },
  } as unknown as Core.Strapi;
  registerDocumentRules(strapi);
  return { mw: mw as Mw, slugQuery: () => slugQuery };
}

describe('tag create rule', () => {
  it('normalizes the name and suffixes a taken slug', async () => {
    const { mw, slugQuery } = rules({ slugs: ['c'] });
    const ctx: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: '  C#  ' } } };
    await mw(ctx, async () => 'ok');
    expect(ctx.params.data).toEqual({ name: 'c#', slug: 'c-2' });
    expect(slugQuery()).toEqual({ where: { slug: { $startsWith: 'c' } }, select: ['slug'] });
  });
  it('takes the next free suffix', async () => {
    const { mw } = rules({ slugs: ['tag', 'tag-2'] });
    const ctx: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: '中文' } } };
    await mw(ctx, async () => 'ok');
    expect(ctx.params.data.slug).toBe('tag-3');
  });
  it('keeps the bare slug when it is free and an explicit slug as given', async () => {
    const { mw } = rules({ slugs: ['c-sharp'] });
    const a: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: 'c' } } };
    const b: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: 'x', slug: 'given' } } };
    await mw(a, async () => 'ok');
    await mw(b, async () => 'ok');
    expect([a.params.data.slug, b.params.data.slug]).toEqual(['c', 'given']);
  });
});

describe('duplicates', () => {
  it('rethrows a raw database duplicate on a yt-kb type as the validator 400', async () => {
    const { mw } = rules();
    const err = await mw({ uid: 'plugin::yt-kb.digest', action: 'update', params: {} }, async () => { throw unique(); })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(errors.ValidationError);
    expect(err).toMatchObject({ message: UNIQUE_MESSAGE, details: { code: UNIQUE_CODE } });
  });
  it('rethrows a validator error that fails two unique attributes as one YT_KB_UNIQUE error', async () => {
    // A lost tag race: name and slug are both taken, so yup reports
    // "2 errors occurred" and only details.errors[] says why.
    const { mw } = rules();
    const twoFailures = new errors.ValidationError('2 errors occurred', {
      errors: [
        { path: ['name'], message: UNIQUE_MESSAGE, name: 'ValidationError', value: 'e8 race' },
        { path: ['slug'], message: UNIQUE_MESSAGE, name: 'ValidationError', value: 'e8-race' },
      ],
    });
    const ctx: Ctx = { uid: 'plugin::yt-kb.tag', action: 'create', params: { data: { name: 'e8 race' } } };
    const err = await mw(ctx, async () => { throw twoFailures; }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(errors.ValidationError);
    expect(err).not.toBe(twoFailures);
    expect(err).toMatchObject({ message: UNIQUE_MESSAGE, details: { code: UNIQUE_CODE } });
  });
  it('leaves other content types alone', async () => {
    const { mw } = rules();
    const raw = unique();
    await expect(mw({ uid: 'api::article.article', action: 'create', params: {} }, async () => { throw raw; })).rejects.toBe(raw);
  });
  it('names the existing video on a duplicate create', async () => {
    const { mw } = rules({ existingVideo: { documentId: 'd1' } });
    const ctx: Ctx = { uid: 'plugin::yt-kb.video', action: 'create', params: { data: { youtubeVideoId: 'abcdefghijk' } } };
    await expect(mw(ctx, async () => 'ok')).rejects.toMatchObject({
      name: 'ApplicationError',
      details: { code: UNIQUE_CODE, documentId: 'd1' },
    });
  });
});
