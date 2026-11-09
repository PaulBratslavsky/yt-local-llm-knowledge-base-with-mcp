import { describe, expect, it, vi } from 'vitest';
import { buildBM25Index, chunkForRetrieval, makeStoredIndex, prepareSegmentedTranscript } from '../../services/bm25-core';
import { DURATION_SEC, RAW_SEGMENTS } from '../../__fixtures__/eight-topics';
import { searchTranscriptTool } from './search-transcript';
import { crossSearchTranscriptsTool } from './cross-search-transcripts';

const chunks = chunkForRetrieval(prepareSegmentedTranscript(RAW_SEGMENTS), DURATION_SEC);
// The app's contextual index: chunk 9 (timeSec 240) carries a term no
// transcript word has, so a hit on it proves this index was the one searched.
const contextual = makeStoredIndex(
  buildBM25Index(chunks, (c) => (c.id === 9 ? `zebracontext ${c.text}` : c.text)),
  { rawSegments: RAW_SEGMENTS, durationSec: DURATION_SEC },
);

type Row = Record<string, unknown> & { documentId: string };
const pick = (row: Row, fields?: string[]) =>
  fields ? Object.fromEntries(Object.entries(row).filter(([k]) => k === 'documentId' || fields.includes(k))) : { ...row };

/** Fake Strapi. Transcript root reads (findOne / findFirst / findMany) come from
 *  `transcripts` and return only the requested fields, as the Document Service
 *  does. Video reads return the given rows as they are. */
function fakeStrapi(opts: { videoFindFirst?: unknown; videoFindMany?: unknown[]; transcripts?: Row[] }) {
  const store = new Map((opts.transcripts ?? []).map((r) => [r.documentId, r]));
  const video = {
    findFirst: vi.fn(async () => opts.videoFindFirst ?? null),
    findOne: vi.fn(async () => null),
    findMany: vi.fn(async () => opts.videoFindMany ?? []),
    update: vi.fn(),
  };
  const transcript = {
    findFirst: vi.fn(async ({ filters, fields }: any) => {
      const id = filters?.youtubeVideoId?.$eq;
      const row = [...store.values()].find((r) => r.youtubeVideoId === id);
      return row ? pick(row, fields) : null;
    }),
    findOne: vi.fn(async ({ documentId, fields }: any) => {
      const row = store.get(documentId);
      return row ? pick(row, fields) : null;
    }),
    findMany: vi.fn(async ({ filters, fields }: any) =>
      (filters.documentId.$in as string[]).flatMap((id) => (store.has(id) ? [pick(store.get(id)!, fields)] : [])),
    ),
    update: vi.fn(async ({ documentId, data }: any) => ({ documentId, ...data })),
  };
  const docs: Record<string, unknown> = { 'plugin::yt-kb.video': video, 'plugin::yt-kb.transcript': transcript };
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const strapi = { documents: vi.fn((uid: string) => docs[uid]), log };
  return { strapi: strapi as never, video, transcript };
}

/** Strapi 5.61 rejects a private attribute inside a populate's `fields`. */
function expectNoPrivateInPopulate(video: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }) {
  for (const [query] of [...video.findFirst.mock.calls, ...video.findMany.mock.calls] as Array<[any]>) {
    expect(JSON.stringify(query.populate ?? {})).not.toContain('searchIndex');
  }
}

const search = (strapi: never, args: Record<string, unknown>) =>
  searchTranscriptTool.execute(searchTranscriptTool.schema.parse(args), { strapi }) as Promise<any>;

// The transcript as the video's populate returns it: no searchIndex.
const populated = (documentId: string, rawSegments: unknown = RAW_SEGMENTS) => ({
  documentId,
  title: 'T',
  rawSegments,
  durationSec: DURATION_SEC,
});
const stored = (documentId: string, extra: Record<string, unknown> = {}): Row => ({
  documentId,
  searchIndex: null,
  rawSegments: RAW_SEGMENTS,
  durationSec: DURATION_SEC,
  ...extra,
});

describe('searchTranscript', () => {
  it("searches the video's contextual index first", async () => {
    const { strapi, video, transcript } = fakeStrapi({
      videoFindFirst: { youtubeVideoId: 'm4CtxVideo1', videoTitle: 'V', transcriptSegments: contextual, transcript: populated('t1') },
      transcripts: [stored('t1')],
    });
    const r = await search(strapi, { videoId: 'm4CtxVideo1', query: 'zebracontext', k: 3 });
    expect(r.source).toBe('bm25');
    expect(r.results[0].timeSec).toBe(240);
    expect(transcript.update).not.toHaveBeenCalled();
    expectNoPrivateInPopulate(video);
  });

  it("builds and saves the transcript's index when the video has none", async () => {
    const { strapi, video, transcript } = fakeStrapi({
      videoFindFirst: { youtubeVideoId: 'm4LazyVid01', transcriptSegments: null, transcript: populated('t2') },
      transcripts: [stored('t2')],
    });
    const r = await search(strapi, { videoId: 'm4LazyVid01', query: 'espresso crema' });
    expect(r.source).toBe('bm25-transcript');
    expect(r.results[0].timeSec).toBe(240);
    expect(transcript.update).toHaveBeenCalledTimes(1);
    // The index is read root-level, once.
    expect(transcript.findOne).toHaveBeenCalledTimes(1);
    expect(transcript.findOne).toHaveBeenCalledWith({ documentId: 't2', fields: ['searchIndex', 'durationSec'] });
    expectNoPrivateInPopulate(video);
  });

  it('uses a current stored transcript index without rebuilding it', async () => {
    const { strapi, transcript } = fakeStrapi({
      videoFindFirst: { youtubeVideoId: 'm4LazyVid01', transcriptSegments: null, transcript: populated('t2') },
      transcripts: [stored('t2', { searchIndex: makeStoredIndex(buildBM25Index(chunks), { rawSegments: RAW_SEGMENTS, durationSec: DURATION_SEC }) })],
    });
    const r = await search(strapi, { videoId: 'm4LazyVid01', query: 'espresso crema' });
    expect(r.source).toBe('bm25-transcript');
    expect(r.results[0].timeSec).toBe(240);
    expect(transcript.update).not.toHaveBeenCalled();
  });

  it("uses the plain transcript index, not the app's contextual one", async () => {
    const { strapi } = fakeStrapi({
      videoFindFirst: { youtubeVideoId: 'm4LazyVid01', transcriptSegments: null, transcript: populated('t2') },
      transcripts: [stored('t2')],
    });
    const r = await search(strapi, { videoId: 'm4LazyVid01', query: 'zebracontext' });
    expect(r.source).toBe('bm25-transcript');
    expect(r.results).toEqual([]);
  });

  it('searches a transcript that has no Video row', async () => {
    const { strapi } = fakeStrapi({
      transcripts: [{ documentId: 't5', youtubeVideoId: 'm4OnlyTrans', title: 'T', rawSegments: RAW_SEGMENTS }],
    });
    const r = await search(strapi, { videoId: 'm4OnlyTrans', query: 'espresso crema' });
    expect(r.source).toBe('bm25-transcript');
    expect(r.title).toBe('T');
  });

  it('reports a missing video and transcript', async () => {
    const { strapi } = fakeStrapi({});
    const r = await search(strapi, { videoId: 'm4Nothing01', query: 'espresso crema' });
    expect(r).toEqual({ error: 'No video or transcript found for videoId "m4Nothing01".' });
  });

  it('falls back to substring scoring when the segments yield no index', async () => {
    const music = [{ text: '[Music]', startMs: 0 }];
    const { strapi } = fakeStrapi({
      videoFindFirst: { youtubeVideoId: 'm4MusicOnly', transcriptSegments: null, transcript: populated('t6', music) },
      transcripts: [stored('t6', { rawSegments: music })],
    });
    const r = await search(strapi, { videoId: 'm4MusicOnly', query: 'music' });
    expect(r.source).toBe('substring');
  });
});

describe('crossSearchTranscripts', () => {
  it('searches every video with a transcript, pending ones included, in batched reads', async () => {
    const { strapi, video, transcript } = fakeStrapi({
      videoFindMany: [
        { youtubeVideoId: 'vidA', videoTitle: 'A', transcriptSegments: contextual, tags: [], transcript: { documentId: 'tA' } },
        { youtubeVideoId: 'vidB', videoTitle: 'B', transcriptSegments: null, tags: [], transcript: { documentId: 'tB' } },
        { youtubeVideoId: 'vidD', videoTitle: 'D', transcriptSegments: null, tags: [], transcript: { documentId: 'tD' } },
        { youtubeVideoId: 'vidC', videoTitle: 'C', transcriptSegments: null, tags: [], transcript: null },
      ],
      transcripts: [stored('tA'), stored('tB'), stored('tD')],
    });
    const r = (await crossSearchTranscriptsTool.execute(
      crossSearchTranscriptsTool.schema.parse({ query: 'espresso crema' }),
      { strapi },
    )) as any;
    expect(r.videosScanned).toBe(4);
    const got = r.results.map((x: any) => ({ id: x.youtubeVideoId, src: x.indexSource }));
    expect(got).toEqual(
      expect.arrayContaining([
        { id: 'vidA', src: 'bm25' },
        { id: 'vidB', src: 'bm25-transcript' },
        { id: 'vidD', src: 'bm25-transcript' },
      ]),
    );
    expect(got.map((x: any) => x.id)).not.toContain('vidC');
    const query = (video.findMany.mock.calls as unknown as Array<[{ filters: Record<string, unknown> }]>)[0][0];
    expect(query.filters).not.toHaveProperty('summaryStatus');
    expectNoPrivateInPopulate(video);

    // One query for the indexes (only the videos without the app's index),
    // one for the segments of the rows that need a build; no per-video read.
    expect(transcript.findOne).not.toHaveBeenCalled();
    expect(transcript.findMany).toHaveBeenCalledTimes(2);
    const [indexQuery, segQuery] = (transcript.findMany.mock.calls as unknown as Array<[any]>).map(([q]) => q);
    expect(indexQuery).toEqual({
      filters: { documentId: { $in: ['tB', 'tD'] } },
      fields: ['documentId', 'searchIndex', 'durationSec'],
      limit: 2,
    });
    expect(segQuery.fields).toEqual(['documentId', 'rawSegments', 'durationSec']);
    expect(transcript.update).toHaveBeenCalledTimes(2);
  });
});
