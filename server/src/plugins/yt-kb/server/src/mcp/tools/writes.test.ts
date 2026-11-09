import { describe, expect, it } from 'vitest';
import type { Core } from '@strapi/strapi';
import { addVideoTool } from './add-video';
import { tagVideoTool } from './tags';
import { fetchTranscriptTool } from './fetch-transcript';

const unique = () => Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });

function fake(opts: { videoCreate?: () => unknown; videoFinds?: Array<unknown> } = {}) {
  const log: string[] = [];
  const created: unknown[] = [];
  let depth = 0;
  const finds = [...(opts.videoFinds ?? [])];
  const strapi = {
    db: {
      inTransaction: () => depth > 0,
      transaction: async (cb: (p: unknown) => Promise<unknown>) => {
        depth += 1;
        log.push('tx:start');
        try { return await cb({}); } finally { depth -= 1; log.push('tx:end'); }
      },
    },
    plugin: () => ({
      service: () => ({
        fetchAndStore: async () => {
          log.push(`fetch:inTx=${depth > 0}`);
          return { action: 'created', transcript: { documentId: 't1', title: 'T', author: 'A', thumbnailUrl: null, rawSegments: [], durationSec: 1 } };
        },
      }),
    }),
    documents: (uid: string) =>
      uid === 'plugin::yt-kb.tag'
        ? {
            findFirst: async () => null,
            create: async ({ data }: { data: { name: string } }) => {
              log.push(`tag:${data.name}:inTx=${depth > 0}`);
              return { documentId: `tag-${data.name}`, name: data.name, slug: data.name };
            },
          }
        : {
            findFirst: async () => { log.push('video:find'); return finds.shift() ?? null; },
            findOne: async () => null,
            create: async ({ data }: { data: unknown }) => { log.push(`video:create:inTx=${depth > 0}`); created.push(data); return opts.videoCreate ? opts.videoCreate() : { documentId: 'v1' }; },
            update: async ({ data }: { data: unknown }) => { log.push(`video:update:inTx=${depth > 0}:${JSON.stringify(data)}`); return {}; },
          },
  } as unknown as Core.Strapi;
  return { strapi, log, created };
}

describe('addVideo', () => {
  const args = { url: 'https://www.youtube.com/watch?v=abcdefghijk', tags: ['  AI  '] };

  it('fetches outside the transaction and writes tags + video inside it', async () => {
    const { strapi, log } = fake();
    const out = (await addVideoTool.execute(args, { strapi })) as { action: string };
    expect(out.action).toBe('created');
    expect(log).toEqual(['video:find', 'fetch:inTx=false', 'tx:start', 'tag:ai:inTx=true', 'video:create:inTx=true', 'tx:end']);
  });

  it('returns exists when another caller created the video meanwhile', async () => {
    const { strapi, log } = fake({ videoCreate: () => { throw unique(); }, videoFinds: [null, { documentId: 'v-other' }] });
    const out = await addVideoTool.execute(args, { strapi });
    expect(out).toMatchObject({ action: 'exists', videoDocumentId: 'v-other' });
    expect(log.filter((l) => l === 'tx:start')).toHaveLength(2);
    expect(log.filter((l) => l.startsWith('fetch'))).toHaveLength(1);
  });

  it('returns exists for a stored video without fetching or writing, and its description says so', async () => {
    const { strapi, log } = fake({ videoFinds: [{ documentId: 'v-stored' }] });
    const out = await addVideoTool.execute(args, { strapi });
    expect(out).toMatchObject({ action: 'exists', videoDocumentId: 'v-stored' });
    expect(log).toEqual(['video:find']);
    expect(addVideoTool.description).not.toContain('duplicate-key error');
    expect(addVideoTool.description).toContain("returns `action: 'exists'` without writing");
  });
});

describe('tagVideo', () => {
  it('creates missing tags and updates the video in one transaction', async () => {
    const { strapi, log } = fake({ videoFinds: [{ documentId: 'v1', tags: [{ documentId: 't-old', name: 'old' }] }] });
    const out = await tagVideoTool.execute({ videoId: 'abcdefghijk', tags: ['C++', 'old'] }, { strapi });
    expect(out).toEqual({ videoDocumentId: 'v1', tagsAdded: ['c++', 'old'], totalTags: 3 });
    expect(log.slice(1)).toEqual([
      'tx:start',
      'tag:c++:inTx=true',
      'tag:old:inTx=true',
      'video:update:inTx=true:{"tags":["t-old","tag-c++","tag-old"]}',
      'tx:end',
    ]);
  });
});

describe('fetchTranscript creates the video card', () => {
  const args = { videoId: 'abcdefghijk', force: false };

  it('creates a pending video linked to the transcript when none exists', async () => {
    const { strapi, log, created } = fake({ videoFinds: [null] });
    const out = await fetchTranscriptTool.execute(args, { strapi });
    expect(out).toMatchObject({ action: 'created', transcriptDocumentId: 't1', videoAction: 'created', videoDocumentId: 'v1' });
    expect(log).toEqual(['fetch:inTx=false', 'video:find', 'tx:start', 'video:create:inTx=true', 'tx:end']);
    expect(created[0]).toMatchObject({
      youtubeVideoId: 'abcdefghijk',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      videoTitle: 'T',
      videoAuthor: 'A',
      summaryStatus: 'pending',
      transcript: 't1',
    });
  });

  it('leaves an existing video alone', async () => {
    const { strapi, log } = fake({ videoFinds: [{ documentId: 'v-stored' }] });
    const out = await fetchTranscriptTool.execute(args, { strapi });
    expect(out).toMatchObject({ videoAction: 'exists', videoDocumentId: 'v-stored' });
    expect(log.filter((l) => l.startsWith('video:create'))).toHaveLength(0);
  });

  it('returns exists when another caller created the video meanwhile', async () => {
    const unique = () => Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    const { strapi } = fake({ videoCreate: () => { throw unique(); }, videoFinds: [null, { documentId: 'v-other' }] });
    const out = await fetchTranscriptTool.execute(args, { strapi });
    expect(out).toMatchObject({ videoAction: 'exists', videoDocumentId: 'v-other' });
  });

  it('says in its description that it adds the video card', () => {
    expect(fetchTranscriptTool.description).toContain('pending video card');
  });
});
