import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// B-6: /api/chat and /api/digest-chat load the video with its stored BM25
// index, so retrieval finds transcript passages. Query rewriting goes
// through Ollama; with `chat` throwing it falls back to the plain query
// (as in chat-retrieval.test.ts), so no model runs.
vi.mock('@tanstack/ai', () => ({
  chat: vi.fn(async () => {
    throw new Error('ollama down');
  }),
}));
vi.mock('@tanstack/ai-ollama', () => ({
  createOllamaChat: vi.fn(() => ({})),
}));

import {
  fetchVideoByVideoIdForServerWithStatusService,
  fetchVideoByVideoIdWithStatusService,
} from './videos';
import { prepareChatPrompt } from './learning';
import { buildTranscriptSearchIndex, isStoredIndex } from './transcript';
import { friendlyBackendError } from './backend-errors';

// M4's eight-topics fixture (server/src/plugins/yt-kb/server/src/__fixtures__/
// eight-topics.ts), inlined: the client cannot import plugin files.
const TOPICS = [
  ['kubernetes', 'scheduler', 'pods', 'nodes', 'cluster', 'autoscaling'],
  ['sourdough', 'bread', 'flour', 'yeast', 'starter', 'oven'],
  ['marathon', 'training', 'running', 'pace', 'mileage', 'tempo'],
  ['telescope', 'galaxy', 'nebula', 'orbit', 'planet', 'comet'],
  ['espresso', 'grinder', 'crema', 'roast', 'barista', 'portafilter'],
  ['violin', 'orchestra', 'symphony', 'conductor', 'rehearsal', 'concerto'],
  ['glacier', 'avalanche', 'summit', 'crampons', 'altitude', 'ridge'],
  ['compiler', 'parser', 'lexer', 'bytecode', 'optimizer', 'linker'],
];
const words = (v: string[], n: number) => Array.from({ length: n }, (_, i) => v[i % v.length]).join(' ');
const RAW_SEGMENTS = TOPICS.map((v, i) => ({
  text: words(v, 260),
  startMs: i * 60_000,
  endMs: i * 60_000 + 59_000,
}));
const INDEX = buildTranscriptSearchIndex(RAW_SEGMENTS, 480);

const ROW = {
  documentId: 'v1',
  youtubeVideoId: 'fxchat00001',
  summaryStatus: 'generated',
  videoTitle: 'Chat fixture',
  transcriptSegments: INDEX,
};
const QUESTION = [{ role: 'user' as const, content: 'espresso crema grinder' }];

const fetchMock = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const listOf = (rows: unknown[]) =>
  json(200, { data: rows, meta: { pagination: { page: 1, pageCount: 1, pageSize: 1, total: rows.length } } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chat routes load the stored index (B-6)', () => {
  it('the ForServer fetch returns the full row with its stored index', async () => {
    expect(isStoredIndex(INDEX)).toBe(true);
    fetchMock.mockResolvedValue(listOf([ROW]));
    const lookup = await fetchVideoByVideoIdForServerWithStatusService('fxchat00001');
    expect(lookup.error).toBeNull();
    expect(isStoredIndex(lookup.video?.transcriptSegments)).toBe(true);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    const keys = [...url.searchParams.keys()];
    expect(keys.some((k) => k.startsWith('fields['))).toBe(false);
    expect(url.searchParams.get('filters[youtubeVideoId][$eq]')).toBe('fxchat00001');
  });

  it('retrieves passages from that row', async () => {
    fetchMock.mockResolvedValue(listOf([ROW]));
    const { video } = await fetchVideoByVideoIdForServerWithStatusService('fxchat00001');
    const prompt = await prepareChatPrompt(video!, QUESTION);
    expect(prompt.retrievedCount).toBeGreaterThanOrEqual(1);
    expect(prompt.system).toContain('espresso');
  });

  it('the browser-bound fetch strips the index, so retrieval finds nothing (the bug B-6 fixes)', async () => {
    fetchMock.mockResolvedValue(listOf([ROW]));
    const { video } = await fetchVideoByVideoIdWithStatusService('fxchat00001');
    expect(video?.transcriptSegments).toBeNull();
    const prompt = await prepareChatPrompt(video!, QUESTION);
    expect(prompt.retrievedCount).toBe(0);
  });

  it('reports a backend failure instead of a missing row', async () => {
    fetchMock.mockResolvedValue(json(500, { error: { status: 500, message: 'Internal Server Error' } }));
    const lookup = await fetchVideoByVideoIdForServerWithStatusService('fxchat00001');
    expect(lookup).toEqual({ video: null, error: friendlyBackendError(500, 'Internal Server Error') });
  });
});
