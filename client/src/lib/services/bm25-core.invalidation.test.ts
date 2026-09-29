import { describe, expect, it } from 'vitest';
import {
  CURRENT_INDEX_PARAMS,
  buildBM25Index,
  loadStoredIndex,
  makeStoredIndex,
  storedIndexStatus,
} from './bm25-core';

// Embeddings carry (embeddingModel, embeddingVersion) and /settings can
// report and backfill stale ones. Stored BM25 indexes carried a bare
// `version: 1` literal and no record of which chunker or tokenizer built
// them — so #1's tokenizer fix left every stored index in the library
// scored by a mismatched query-side tokenizer, silently and with no way
// to find them.
function sampleIndex() {
  return buildBM25Index([
    { id: 0, text: 'kubernetes scheduling internals', startWord: 0, timeSec: 0 },
    { id: 1, text: 'networking and storage layers', startWord: 30, timeSec: 20 },
  ]);
}

describe('stored index invalidation', () => {
  it('stamps a freshly built index with the current params', () => {
    const stored = makeStoredIndex(sampleIndex());
    expect(stored.params).toEqual(CURRENT_INDEX_PARAMS);
    expect(storedIndexStatus(stored)).toBe('current');
  });

  it('reports an index built by an older tokenizer as stale', () => {
    const stored = makeStoredIndex(sampleIndex());
    const older = {
      ...stored,
      params: { ...stored.params, tokenizer: CURRENT_INDEX_PARAMS.tokenizer - 1 },
    };
    expect(storedIndexStatus(older)).toBe('stale');
  });

  it('reports an index built with different chunking as stale', () => {
    const stored = makeStoredIndex(sampleIndex());
    const older = {
      ...stored,
      params: { ...stored.params, chunkWords: CURRENT_INDEX_PARAMS.chunkWords + 25 },
    };
    expect(storedIndexStatus(older)).toBe('stale');
  });

  // Every index written before this change. They predate #1's tokenizer
  // fix, so their term frequencies are all 1 — they must not be trusted.
  it('reports a v1 index with no params at all as stale', () => {
    const legacy = { version: 1, bm25: sampleIndex() };
    expect(storedIndexStatus(legacy)).toBe('stale');
  });

  it('reports a row with no index as missing', () => {
    expect(storedIndexStatus(null)).toBe('missing');
    expect(storedIndexStatus(undefined)).toBe('missing');
    expect(storedIndexStatus({ notAnIndex: true })).toBe('missing');
  });

  it('refuses to load a stale index rather than scoring against it', () => {
    const legacy = { version: 1, bm25: sampleIndex() };
    expect(loadStoredIndex(legacy)).toBeNull();
  });

  it('still loads a current index, sanitized', () => {
    const stored = makeStoredIndex(sampleIndex());
    const roundTripped = JSON.parse(JSON.stringify(stored));
    const loaded = loadStoredIndex(roundTripped);
    expect(loaded).not.toBeNull();
    expect(loaded?.bm25.chunks.length).toBe(2);
  });
});
