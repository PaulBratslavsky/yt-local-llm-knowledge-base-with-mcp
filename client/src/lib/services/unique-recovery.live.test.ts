import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Digest } from './digest';

// Live race check for M2: createVideoService (the share path) and
// upsertDigestService (saveDigest) through the real strapiFetch, against a
// scratch Strapi. Runs only when E8_STRAPI_URL and E8_TOKEN_FILE are set
// (M2 Verify 10); otherwise both tests are skipped and nothing is fetched.
// E8_TOKEN_FILE is the check kit's tokens.json; its `rest` key is read
// here and never printed.
const BASE = process.env.E8_STRAPI_URL;
const TOKEN_FILE = process.env.E8_TOKEN_FILE;
const LIVE = Boolean(BASE && TOKEN_FILE);

// env.ts reads STRAPI_URL and STRAPI_API_TOKEN when it is first imported,
// so they are set before the services are imported.
async function services() {
  process.env.STRAPI_URL = BASE;
  process.env.STRAPI_API_TOKEN = JSON.parse(readFileSync(TOKEN_FILE as string, 'utf8')).rest;
  const { createVideoService } = await import('./videos');
  const { upsertDigestService } = await import('./digests');
  return { createVideoService, upsertDigestService };
}

describe.skipIf(!LIVE)('unique-key races against a live Strapi', () => {
  it('createVideoService: five shares of one id at once leave one row', async () => {
    const { createVideoService } = await services();
    const id = 'e8LiveVid01';
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createVideoService({ videoId: id, url: `https://www.youtube.com/watch?v=${id}`, tagNames: ['e8 live'] }),
      ),
    );
    const docIds = results.map((r) => (r.success || r.kind === 'exists' ? r.video.documentId : null));
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success && r.kind === 'exists')).toHaveLength(4);
    expect(new Set(docIds).size).toBe(1);
    expect(docIds[0]).not.toBeNull();
  });

  it('upsertDigestService: five saves of one video set at once leave one row, created once', async () => {
    const { upsertDigestService } = await services();
    const digest = {
      title: 'E8 live', description: 'D', overallTheme: 'O', bottomLine: 'B',
      sharedThemes: [], uniqueInsights: [], contradictions: [], viewingOrder: [],
    } as unknown as Digest;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        upsertDigestService({ videoSetKey: 'e8live-a,e8live-b', title: 'E8 live', digest, videoDocumentIds: [] }),
      ),
    );
    const saved = results.flatMap((r) => (r.success ? [r.data] : []));
    expect(saved).toHaveLength(5);
    expect(saved.filter((d) => d.created)).toHaveLength(1);
    expect(new Set(saved.map((d) => d.documentId)).size).toBe(1);
  });
});
