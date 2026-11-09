// Plans and sends the POST bodies for /api/yt-kb/import/:type (copy-content.mjs).
//
// A stock Strapi accepts at most 1 MB of JSON per request (koa-body's
// default, @strapi/core middlewares/body.js). Each body {"data":[...]} is
// kept at or under MAX_BATCH_BYTES; a record that is bigger than that on its
// own is sent alone, and if the destination still answers 413 the copy
// records it as failed with TOO_LARGE and goes on (M-6).

export const MAX_BATCH_BYTES = 900_000;
export const TOO_LARGE = 'body too large — raise strapi::body jsonLimit on the destination';

const ENVELOPE_BYTES = Buffer.byteLength('{"data":[]}');

/** Split records, in order, into batches whose JSON body stays at or under
 *  maxBytes. A record that alone exceeds maxBytes gets a batch of its own. */
export function planBatches(records, maxBytes = MAX_BATCH_BYTES) {
  const batches = [];
  let batch = [];
  let bytes = ENVELOPE_BYTES;
  for (const record of records) {
    const size = Buffer.byteLength(JSON.stringify(record));
    const added = batch.length === 0 ? size : size + 1; // +1 for the comma
    if (batch.length > 0 && bytes + added > maxBytes) {
      batches.push(batch);
      batch = [];
      bytes = ENVELOPE_BYTES;
    }
    bytes += batch.length === 0 ? size : size + 1;
    batch.push(record);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** POST `records` in planned batches through `post(batch)` and total the
 *  importer's answers. `post` resolves the importer's
 *  `{ created, updated, failed[] }` body, or `{ tooLarge: true }` when the
 *  destination answered 413: that batch's records are recorded as failed
 *  with TOO_LARGE and the copy goes on. Anything `post` throws stops the run. */
export async function importInBatches(records, post, maxBytes = MAX_BATCH_BYTES) {
  const totals = { created: 0, updated: 0, failed: [] };
  for (const batch of planBatches(records, maxBytes)) {
    const r = await post(batch);
    if (r.tooLarge) {
      totals.failed.push(...batch.map((rec) => ({ documentId: rec.documentId, error: TOO_LARGE })));
      continue;
    }
    totals.created += r.created;
    totals.updated += r.updated;
    totals.failed.push(...r.failed);
  }
  return totals;
}
