import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDigestService, upsertDigestService } from './digests';
import type { Digest } from './digest';

// Digest paths and duplicate recovery, driven at the Strapi HTTP boundary.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('deleteDigestService (B-1)', () => {
  it('keeps a traversal documentId inside the digests route', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteDigestService('../../users/1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(
      '/api/yt-kb/digests/..%2F..%2Fusers%2F1',
    );
  });
});

describe("upsertDigestService reads the plugin's duplicate code (B-2)", () => {
  const digest = {
    title: 'T', description: 'D', overallTheme: 'O', bottomLine: 'B',
    sharedThemes: [{ title: 'S', body: 'b', videoTitles: [] }],
    uniqueInsights: [], contradictions: [], viewingOrder: [],
  } as unknown as Digest;
  const row = { id: 1, documentId: 'd1', title: 'T', articleMarkdown: null };

  it('re-reads by videoSetKey and updates the row another writer created', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(
        json(400, { data: null, error: { status: 400, message: 'Duplicate', details: { code: 'YT_KB_UNIQUE' } } }),
      )
      .mockResolvedValueOnce(json(200, { data: [row] }))
      .mockResolvedValueOnce(json(200, { data: row }));
    const result = await upsertDigestService({
      videoSetKey: 'a,b',
      title: 'T',
      digest,
      videoDocumentIds: ['v1', 'v2'],
    });
    expect(result).toEqual({ success: true, data: { documentId: 'd1', created: false } });
    const last = fetchMock.mock.calls.at(-1)!;
    expect((last[1] as RequestInit).method).toBe('PUT');
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('filters[videoSetKey][$eq]')).toBe('a,b');
  });
});
