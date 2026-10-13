import { describe, expect, it, vi } from 'vitest';
import { generateAndSaveDigestArticle } from './digest-article';
import type { Digest } from './digest';

const DIGEST = { title: 'Three videos on local inference' } as Digest;
const VIDEO_IDS = ['abc123', 'def456'];

const generatesOk = () =>
  vi.fn(async () => ({ status: 'ok' as const, article: '# The article' }));

const savesOk = () =>
  vi.fn(async () => ({
    status: 'ok' as const,
    digestDocumentId: 'doc-1',
    created: true,
  }));

describe('generateAndSaveDigestArticle', () => {
  it('reports the article and the saved row when both steps succeed', async () => {
    const result = await generateAndSaveDigestArticle({
      digest: DIGEST,
      videoIds: VIDEO_IDS,
      generate: generatesOk(),
      save: savesOk(),
    });

    expect(result).toEqual({
      status: 'ok',
      article: '# The article',
      saved: { documentId: 'doc-1', articleMarkdown: '# The article' },
    });
  });

  it('saves the article it just generated, for the videos it was given', async () => {
    const save = savesOk();

    await generateAndSaveDigestArticle({
      digest: DIGEST,
      videoIds: VIDEO_IDS,
      generate: generatesOk(),
      save,
    });

    expect(save).toHaveBeenCalledWith({
      digest: DIGEST,
      youtubeVideoIds: VIDEO_IDS,
      articleMarkdown: '# The article',
    });
  });

  it('stops at a generation failure and does not save', async () => {
    const save = savesOk();

    const result = await generateAndSaveDigestArticle({
      digest: DIGEST,
      videoIds: VIDEO_IDS,
      generate: vi.fn(async () => ({ status: 'error' as const, error: 'Ollama is down' })),
      save,
    });

    expect(result).toEqual({ status: 'generate-failed', error: 'Ollama is down' });
    expect(save).not.toHaveBeenCalled();
  });

  // The bug this function exists to fix: the old code returned ok whether
  // or not the save worked, so the article rendered and the user was never
  // told it had not been stored. It is back to a blank page on reload.
  it('reports a failed save instead of calling the whole thing a success', async () => {
    const result = await generateAndSaveDigestArticle({
      digest: DIGEST,
      videoIds: VIDEO_IDS,
      generate: generatesOk(),
      save: vi.fn(async () => ({ status: 'error' as const, error: 'Strapi unreachable' })),
    });

    expect(result.status).toBe('save-failed');
  });

  // The article is still worth showing — the model did the work and the
  // person can copy it. The failure is that it was not kept, which is a
  // different message from "generation failed".
  it('still hands back the article when only the save failed', async () => {
    const result = await generateAndSaveDigestArticle({
      digest: DIGEST,
      videoIds: VIDEO_IDS,
      generate: generatesOk(),
      save: vi.fn(async () => ({ status: 'error' as const, error: 'Strapi unreachable' })),
    });

    expect(result).toEqual({
      status: 'save-failed',
      article: '# The article',
      error: 'Strapi unreachable',
    });
  });

  it('surfaces a thrown error rather than letting it escape', async () => {
    const result = await generateAndSaveDigestArticle({
      digest: DIGEST,
      videoIds: VIDEO_IDS,
      generate: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
      save: savesOk(),
    });

    expect(result).toEqual({ status: 'generate-failed', error: 'fetch failed' });
  });

  it('surfaces a throw from the save step as a failed save', async () => {
    const result = await generateAndSaveDigestArticle({
      digest: DIGEST,
      videoIds: VIDEO_IDS,
      generate: generatesOk(),
      save: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });

    expect(result).toEqual({
      status: 'save-failed',
      article: '# The article',
      error: 'socket hang up',
    });
  });
});
