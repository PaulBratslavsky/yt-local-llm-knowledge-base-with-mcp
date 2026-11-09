// BM25 search against a persisted index — the read side for the MCP
// `searchTranscript` and `crossSearchTranscripts` tools. They read the app's
// contextual index on `Video.transcriptSegments` when it is current, else the
// transcript's own model-free index (`Transcript.searchIndex`, see
// ./search-index.ts), rather than rebuilding one per query.
//
// The scoring lives in ./bm25-core, which this plugin owns; the client
// carries a generated copy, so "results are identical to what the in-app
// chat sees" is enforced by `bm25-core.sync.test.ts`. This file re-exports
// what the tools need and adds the one helper they use that is not scoring.

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
