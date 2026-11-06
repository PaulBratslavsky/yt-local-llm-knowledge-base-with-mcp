// BM25 search against a persisted index — the read-only side of the
// indexer at client/src/lib/services/transcript.ts. The MCP
// `searchTranscript` and `crossSearchTranscripts` tools reuse the index
// already stored on `Video.transcriptSegments` (built during summary
// generation) rather than rebuilding one per query.
//
// The scoring itself lives in ./bm25-core, a generated copy of the
// client's module — so "results are identical to what the in-app chat
// sees" is now enforced by `bm25-core.sync.test.ts` instead of asserted in
// a comment. This file is the thin Strapi-facing adapter: it re-exports
// what the tools need and adds the one helper they use that is not part of
// scoring.

export {
  isStoredIndex,
  loadStoredIndex,
  searchBM25Ranked as searchBM25,
  tokenize,
  type BM25Index,
  type RankedChunk,
  type StoredTranscriptIndex,
  type TranscriptChunk,
} from './bm25-core';

/** `mm:ss`, or `h:mm:ss` past an hour. Presentation only — not scoring,
 *  which is why it stays out of the shared core. */
export function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
