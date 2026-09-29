// Rebuilding a stored BM25 index in place.
//
// An index goes stale when the chunker or the tokenizer changes
// (CURRENT_INDEX_PARAMS). Before this existed the only way to refresh one
// was a full summary regenerate — an LLM pass and, on pre-cache rows, a
// YouTube fetch — for a change that touches neither. The raw caption
// segments are cached on the index itself, so a rebuild is local work.

import {
  buildBM25Index,
  chunkForRetrieval,
  makeSectionContextualizer,
  makeStoredIndex,
  prepareSegmentedTranscript,
  storedIndexStatus,
  type StoredIndexStatus,
  type StoredTranscriptIndex,
  type TimedTextSegment,
} from './transcript';
import type { StrapiVideo } from './videos';

export type IndexRebuild =
  | { status: 'rebuilt'; index: StoredTranscriptIndex }
  | { status: 'unrecoverable'; reason: string };

type IndexLike = {
  rawSegments?: TimedTextSegment[] | null;
  durationSec?: number | null;
};

/** The stored index of a video, whatever state it is in. */
export function videoIndexStatus(video: StrapiVideo): StoredIndexStatus {
  return storedIndexStatus(video.transcriptSegments);
}

/** True when a stale/missing index can be rebuilt without re-fetching
 *  captions — i.e. the row cached its raw segments. */
export function canRebuildIndex(video: StrapiVideo): boolean {
  const stored = video.transcriptSegments as IndexLike | null | undefined;
  return Array.isArray(stored?.rawSegments) && stored.rawSegments.length > 0;
}

export function rebuildStoredIndex(video: StrapiVideo): IndexRebuild {
  const stored = video.transcriptSegments as IndexLike | null | undefined;
  const rawSegments = stored?.rawSegments;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return {
      status: 'unrecoverable',
      reason:
        'No cached caption segments on this row — needs a full regenerate to refetch them.',
    };
  }

  const prepared = prepareSegmentedTranscript(rawSegments);
  const chunks = chunkForRetrieval(prepared, stored?.durationSec ?? null);
  if (chunks.length === 0) {
    return { status: 'unrecoverable', reason: 'Cached segments produced no chunks.' };
  }

  // Same contextualizer the generation pipeline uses, so a rebuilt index
  // scores identically to a freshly generated one. Sections carry no
  // timeSec on the Video row, which matches what learning.ts passes.
  const sections = (video.sections ?? []).map((s) => ({
    timeSec: 0,
    heading: s.heading,
    body: s.body,
  }));
  const bm25 = buildBM25Index(chunks, makeSectionContextualizer(sections));

  return {
    status: 'rebuilt',
    index: makeStoredIndex(bm25, {
      rawSegments,
      durationSec: stored?.durationSec ?? null,
    }),
  };
}
