import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_VERSION,
  embeddingStatus,
} from './embeddings';
import type { StrapiVideo } from './videos';

// The staleness key is the whole embedding-invalidation protocol, and it
// had no test — which is how the client/server version split-brain
// survived: the client hard-coded EMBEDDING_VERSION while the server read
// it from env, so following the documented "bump the env-level version"
// procedure made the server write vectors the client treats as stale
// forever, and retrieval quietly went empty.
function video(over: Partial<StrapiVideo>): StrapiVideo {
  return {
    documentId: 'doc1',
    youtubeVideoId: 'abc123',
    summaryEmbedding: [0.1, 0.2, 0.3],
    embeddingModel: CURRENT_EMBEDDING_MODEL,
    embeddingVersion: CURRENT_EMBEDDING_VERSION,
    ...over,
  } as StrapiVideo;
}

describe('embeddingStatus', () => {
  it('is current when the model and version both match', () => {
    expect(embeddingStatus(video({}))).toBe('current');
  });

  it('is missing when there is no vector', () => {
    expect(embeddingStatus(video({ summaryEmbedding: null }))).toBe('missing');
    expect(embeddingStatus(video({ summaryEmbedding: [] }))).toBe('missing');
  });

  it('is stale when the model differs', () => {
    expect(embeddingStatus(video({ embeddingModel: 'some-other-model' }))).toBe('stale');
  });

  it('is stale when the version differs', () => {
    expect(
      embeddingStatus(video({ embeddingVersion: CURRENT_EMBEDDING_VERSION + 1 })),
    ).toBe('stale');
    expect(
      embeddingStatus(video({ embeddingVersion: CURRENT_EMBEDDING_VERSION - 1 })),
    ).toBe('stale');
  });

  it('is stale when the row predates the key entirely', () => {
    expect(embeddingStatus(video({ embeddingModel: null, embeddingVersion: null }))).toBe(
      'stale',
    );
  });
});

describe('EMBEDDING_VERSION resolution', () => {
  // CLAUDE.md and ADR-0003 both say to bump "the env-level
  // EMBEDDING_VERSION". That was only true on the server; the client had a
  // hard-coded literal, so the documented procedure broke retrieval.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is read from the environment, as the documented procedure assumes', async () => {
    vi.stubEnv('EMBEDDING_VERSION', '99');
    vi.resetModules();
    const fresh = await import('./embeddings');
    expect(fresh.CURRENT_EMBEDDING_VERSION).toBe(99);
  });

  it('falls back to the shipped default when unset or unparseable', async () => {
    vi.stubEnv('EMBEDDING_VERSION', 'not-a-number');
    vi.resetModules();
    const fresh = await import('./embeddings');
    expect(fresh.CURRENT_EMBEDDING_VERSION).toBe(2);
  });
});
