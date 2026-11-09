import type { Core } from '@strapi/strapi';
import {
  buildTranscriptSearchIndex,
  loadStoredIndex,
  type StoredTranscriptIndex,
  type TimedTextSegment,
} from './bm25-core';

// The transcript's model-free search index (Transcript.searchIndex), for the
// tools that read it. fetchAndStore writes it on every fetch; a transcript
// stored before that, or indexed by an older tokenizer/chunker, gets it here
// on first use: built from rawSegments and saved.
//
// searchIndex is a private attribute, and Strapi 5.61's Document Service
// rejects a private attribute named inside a populate's `fields` ("Invalid
// key searchIndex") while accepting it in a root-level query. So the tools
// populate the transcript without it and read it here, root-level: one
// findOne for a single transcript, one findMany for many.

const TRANSCRIPT = 'plugin::yt-kb.transcript';

/** A Transcript row as the tools load it. `rawSegments` may be left out of the
 *  query: it is read only when the index has to be built. */
export type TranscriptIndexSource = {
  documentId: string;
  searchIndex?: unknown;
  rawSegments?: TimedTextSegment[] | null;
  durationSec?: number | null;
};

/** The current stored index, else one built from the segments and saved; null when there are no segments. */
export async function ensureTranscriptSearchIndex(
  strapi: Core.Strapi,
  row: TranscriptIndexSource,
): Promise<StoredTranscriptIndex | null> {
  const stored = loadStoredIndex(row.searchIndex);
  if (stored) return stored;

  let rawSegments = row.rawSegments;
  let durationSec = row.durationSec;
  if (rawSegments === undefined) {
    const full = (await strapi.documents(TRANSCRIPT as never).findOne({
      documentId: row.documentId,
      fields: ['rawSegments', 'durationSec'],
    } as never)) as { rawSegments?: TimedTextSegment[] | null; durationSec?: number | null } | null;
    rawSegments = full?.rawSegments ?? null;
    durationSec = full?.durationSec ?? durationSec ?? null;
  }

  const built = buildTranscriptSearchIndex(rawSegments, durationSec);
  if (!built) return null;
  try {
    await strapi.documents(TRANSCRIPT as never).update({
      documentId: row.documentId,
      data: { searchIndex: built } as never,
    });
    strapi.log.info(`[yt-kb] built transcript search index for ${row.documentId} (${built.bm25.chunks.length} chunks)`);
  } catch (err) {
    // The search still runs on the index in hand; the next reader retries the save.
    const message = err instanceof Error ? err.message : String(err);
    strapi.log.warn(`[yt-kb] could not save transcript search index for ${row.documentId}: ${message}`, {
      documentId: row.documentId,
    });
  }
  return built;
}

/** One transcript's stored index, read root-level (see the header). Null when the row is gone. */
export async function loadTranscriptSearchIndex(
  strapi: Core.Strapi,
  documentId: string,
): Promise<{ searchIndex?: unknown; durationSec?: number | null } | null> {
  return (await strapi.documents(TRANSCRIPT as never).findOne({
    documentId,
    fields: ['searchIndex', 'durationSec'],
  } as never)) as { searchIndex?: unknown; durationSec?: number | null } | null;
}

/** Many transcripts' stored indexes in one root-level query, keyed by
 *  documentId. Rows whose index is missing or stale also get their
 *  rawSegments, in one more query, so ensureTranscriptSearchIndex can build
 *  without a read per row. */
export async function loadTranscriptSearchIndexes(
  strapi: Core.Strapi,
  documentIds: string[],
): Promise<Map<string, TranscriptIndexSource>> {
  const ids = Array.from(new Set(documentIds));
  const out = new Map<string, TranscriptIndexSource>();
  if (ids.length === 0) return out;

  const rows = (await strapi.documents(TRANSCRIPT as never).findMany({
    filters: { documentId: { $in: ids } },
    fields: ['documentId', 'searchIndex', 'durationSec'],
    limit: ids.length,
  } as never)) as unknown as TranscriptIndexSource[];
  for (const row of rows) out.set(row.documentId, row);

  const toBuild = rows.filter((row) => !loadStoredIndex(row.searchIndex)).map((row) => row.documentId);
  if (toBuild.length > 0) {
    const segs = (await strapi.documents(TRANSCRIPT as never).findMany({
      filters: { documentId: { $in: toBuild } },
      fields: ['documentId', 'rawSegments', 'durationSec'],
      limit: toBuild.length,
    } as never)) as unknown as Array<{ documentId: string; rawSegments?: TimedTextSegment[] | null; durationSec?: number | null }>;
    const byId = new Map(segs.map((r) => [r.documentId, r]));
    for (const id of toBuild) {
      const row = out.get(id)!;
      const seg = byId.get(id);
      // null, not undefined: ensureTranscriptSearchIndex must not read it again.
      row.rawSegments = seg?.rawSegments ?? null;
      row.durationSec = row.durationSec ?? seg?.durationSec ?? null;
    }
  }
  return out;
}
