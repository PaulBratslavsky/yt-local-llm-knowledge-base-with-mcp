import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoService } from './videos';
import { upsertDigestService } from './digests';
import type { Digest } from './digest';

// Duplicate-key races, driven at the Strapi HTTP boundary: the unique
// index is the real gate, and each service must turn its 400 into the
// row the other writer stored.
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
const strapiError = (status: number, message: string) =>
  json(status, { data: null, error: { status, name: 'ValidationError', message, details: {} } });

const video = { id: 1, documentId: 'v1', youtubeVideoId: 'abcdefghijk', summaryStatus: 'pending' };
const base = { videoId: 'abcdefghijk', url: 'https://youtu.be/abcdefghijk' };

describe('createVideoService', () => {
  it('returns exists when the POST loses a race', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(strapiError(400, 'This attribute must be unique'))
      .mockResolvedValueOnce(json(200, { data: [video] }));
    const result = await createVideoService({ ...base, tagNames: [] });
    expect(result).toMatchObject({ success: false, kind: 'exists', video: { documentId: 'v1' } });
  });

  it('uses the tag another writer created', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(strapiError(400, 'This attribute must be unique'))
      .mockResolvedValueOnce(json(200, { data: [{ id: 2, documentId: 't1', name: 'ai', slug: 'ai' }] }))
      .mockResolvedValueOnce(json(201, { data: video }));
    const result = await createVideoService({ ...base, tagNames: ['AI'] });
    expect(result.success).toBe(true);
    const postBody = JSON.parse(fetchMock.mock.calls[4][1].body as string);
    expect(postBody.data.tags).toEqual(['t1']);
  });

  it('stops with an error when a tag cannot be stored', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(strapiError(500, 'Internal Server Error'));
    const result = await createVideoService({ ...base, tagNames: ['AI'] });
    expect(result).toMatchObject({ success: false, kind: 'error' });
    expect(result.success === false && result.kind === 'error' && result.error).toContain('Could not create tag "AI"');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not treat other 400s as a duplicate', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(strapiError(400, 'youtubeVideoId must be at most 32 characters'));
    const result = await createVideoService({ ...base, tagNames: [] });
    expect(result).toMatchObject({ success: false, kind: 'error' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('upsertDigestService', () => {
  const digest = {
    title: 'T', description: 'D', overallTheme: 'O', bottomLine: 'B',
    sharedThemes: [{ title: 'S', body: 'b', videoTitles: [] }],
    uniqueInsights: [], contradictions: [], viewingOrder: [],
  } as unknown as Digest;
  const row = { id: 1, documentId: 'd1', title: 'T', articleMarkdown: null };

  it('updates the winner when the create loses a race', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(strapiError(400, 'This attribute must be unique'))
      .mockResolvedValueOnce(json(200, { data: [row] }))
      .mockResolvedValueOnce(json(200, { data: row }));
    const result = await upsertDigestService({ videoSetKey: 'a,b', title: 'T', digest, videoDocumentIds: ['v1', 'v2'] });
    expect(result).toEqual({ success: true, data: { documentId: 'd1', created: false } });
    expect(fetchMock.mock.calls[3][1].method).toBe('PUT');
  });

  it('creates when no row has the key', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: [] }))
      .mockResolvedValueOnce(json(201, { data: row }));
    const result = await upsertDigestService({ videoSetKey: 'a,b', title: 'T', digest, videoDocumentIds: ['v1', 'v2'] });
    expect(result).toEqual({ success: true, data: { documentId: 'd1', created: true } });
  });
});
