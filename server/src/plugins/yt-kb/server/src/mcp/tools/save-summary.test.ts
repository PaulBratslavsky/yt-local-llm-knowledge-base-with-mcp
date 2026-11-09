import { describe, expect, it, vi } from 'vitest';
import { buildTranscriptSearchIndex, findEvidenceForQuote } from '../../services/bm25-core';
import { DURATION_SEC, EXPECTED_SECTION_TIMES, RAW_SEGMENTS, SECTIONS } from '../../__fixtures__/eight-topics';
import { saveSummaryTool } from './save-summary';

type Row = Record<string, unknown> & { documentId: string };
const pick = (row: Row, fields?: string[]) =>
  fields ? Object.fromEntries(Object.entries(row).filter(([k]) => k === 'documentId' || fields.includes(k))) : { ...row };

/** Transcript root reads come from `transcripts` and return only the requested fields. */
function fakeStrapi(opts: { videoFindFirst: unknown; transcripts?: Row[] }) {
  const store = new Map((opts.transcripts ?? []).map((r) => [r.documentId, r]));
  const video = {
    findFirst: vi.fn(async () => opts.videoFindFirst),
    findOne: vi.fn(async () => null),
    findMany: vi.fn(),
    update: vi.fn(async ({ documentId, data }: any) => ({ documentId, ...data })),
  };
  const transcript = {
    findFirst: vi.fn(async ({ filters, fields }: any) => {
      const row = [...store.values()].find((r) => r.youtubeVideoId === filters?.youtubeVideoId?.$eq);
      return row ? pick(row, fields) : null;
    }),
    findOne: vi.fn(async ({ documentId, fields }: any) => {
      const row = store.get(documentId);
      return row ? pick(row, fields) : null;
    }),
    findMany: vi.fn(),
    update: vi.fn(async ({ documentId, data }: any) => ({ documentId, ...data })),
  };
  const docs: Record<string, unknown> = { 'plugin::yt-kb.video': video, 'plugin::yt-kb.transcript': transcript };
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const strapi = { documents: vi.fn((uid: string) => docs[uid]), log };
  return { strapi: strapi as never, video, transcript };
}

const base = {
  videoId: 'm4LazyVid01',
  summaryTitle: 't',
  summaryDescription: 'd',
  summaryOverview: 'o',
  watchVerdict: 'skim',
  verdictSummary: 'v',
  verdictReason: 'r',
  keyTakeaways: [{ text: 'k' }],
  actionSteps: [{ title: 'a', body: 'b' }],
};

const storedTimes = (video: { update: ReturnType<typeof vi.fn> }) =>
  (video.update.mock.calls[0][0] as { data: { sections: Array<{ timeSec: number | null }> } }).data.sections.map(
    (s) => s.timeSec,
  );

describe('saveSummary', () => {
  it('grounds each section in the transcript as the app does, ignoring a caller timecode', async () => {
    const { strapi, video, transcript } = fakeStrapi({
      videoFindFirst: { documentId: 'v2', youtubeVideoId: 'm4LazyVid01', transcript: { documentId: 't2', durationSec: DURATION_SEC } },
      transcripts: [{ documentId: 't2', youtubeVideoId: 'm4LazyVid01', searchIndex: null, rawSegments: RAW_SEGMENTS, durationSec: DURATION_SEC }],
    });
    const args = saveSummaryTool.schema.parse({
      ...base,
      sections: [{ ...SECTIONS[0], timeSec: 999 }, SECTIONS[1], SECTIONS[2]],
    });
    const result = (await saveSummaryTool.execute(args, { strapi })) as any;

    const appIndex = buildTranscriptSearchIndex(RAW_SEGMENTS, DURATION_SEC)!.bm25;
    const appTimes = SECTIONS.map((s) => findEvidenceForQuote(`${s.heading}. ${s.body}`, appIndex, 1.0)?.timeSec ?? null);
    expect(storedTimes(video)).toEqual(EXPECTED_SECTION_TIMES);
    expect(storedTimes(video)).toEqual(appTimes);
    expect(result.sectionsWithTimecode).toBe(2);
    expect(result.youtubeVideoId).toBe('m4LazyVid01');

    // searchIndex is never named in the populate; it is read root-level.
    const populate = (video.findFirst.mock.calls[0] as any[])[0].populate;
    expect(JSON.stringify(populate)).not.toContain('searchIndex');
    expect(transcript.findOne).toHaveBeenCalledWith({ documentId: 't2', fields: ['searchIndex', 'durationSec'] });
    expect(transcript.update).toHaveBeenCalledTimes(1);
  });

  it('stores no timecodes when there is no transcript', async () => {
    const { strapi, video } = fakeStrapi({
      videoFindFirst: { documentId: 'v3', youtubeVideoId: 'm4NoTrans01', transcript: null },
    });
    const args = saveSummaryTool.schema.parse({ ...base, videoId: 'm4NoTrans01', sections: SECTIONS });
    const result = (await saveSummaryTool.execute(args, { strapi })) as any;
    expect(storedTimes(video).every((t) => t === null)).toBe(true);
    expect(result.sectionsWithTimecode).toBe(0);
  });

  it('drops a caller-supplied section timeSec at parse time', () => {
    const parsed = saveSummaryTool.schema.parse({ ...base, sections: [{ ...SECTIONS[0], timeSec: 5 }] });
    expect(parsed.sections[0]).not.toHaveProperty('timeSec');
  });
});
