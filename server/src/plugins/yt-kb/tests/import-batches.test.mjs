import { describe, expect, it } from 'vitest';
import { MAX_BATCH_BYTES, TOO_LARGE, importInBatches, planBatches } from '../scripts/import-batches.mjs';

const rec = (id, pad) => ({ documentId: id, pad: 'x'.repeat(pad) });
const bodyBytes = (batch) => Buffer.byteLength(JSON.stringify({ data: batch }));

describe('planBatches', () => {
  it('keeps every multi-record body at or under MAX_BATCH_BYTES, in order', () => {
    const records = Array.from({ length: 50 }, (_, i) => rec(`r${i}`, 100_000 + i * 997));
    const batches = planBatches(records);
    for (const b of batches) if (b.length > 1) expect(bodyBytes(b)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    expect(batches.flat()).toEqual(records);
  });
  it('only starts a new batch when the next record would not fit', () => {
    const records = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, 50_000 + i * 1_337));
    const batches = planBatches(records);
    for (let i = 0; i + 1 < batches.length; i += 1) {
      expect(bodyBytes([...batches[i], batches[i + 1][0]])).toBeGreaterThan(MAX_BATCH_BYTES);
    }
  });
  it('sends a record larger than the limit on its own', () => {
    const big = rec('big', MAX_BATCH_BYTES);
    const batches = planBatches([rec('a', 10), big, rec('b', 10)]);
    expect(batches.map((b) => b.map((r) => r.documentId))).toEqual([['a'], ['big'], ['b']]);
  });
  it('returns no batches for no records', () => {
    expect(planBatches([])).toEqual([]);
  });
  it('names the fix in the 413 message', () => {
    expect(TOO_LARGE).toBe('body too large — raise strapi::body jsonLimit on the destination');
  });
});

describe('importInBatches', () => {
  it('totals the answers and records a 413 batch as failed, then goes on', async () => {
    const big = rec('big', MAX_BATCH_BYTES);
    const sent = [];
    const post = async (batch) => {
      sent.push(batch.map((r) => r.documentId));
      if (batch.some((r) => r.documentId === 'big')) return { tooLarge: true };
      return { created: batch.length, updated: 0, failed: [] };
    };
    const totals = await importInBatches([rec('a', 10), big, rec('b', 10)], post);
    expect(sent).toEqual([['a'], ['big'], ['b']]);
    expect(totals).toEqual({ created: 2, updated: 0, failed: [{ documentId: 'big', error: TOO_LARGE }] });
  });
  it('passes the importer\'s own failures through and stops on a throw', async () => {
    const totals = await importInBatches([rec('a', 10)], async () => ({ created: 0, updated: 0, failed: [{ documentId: 'a', error: 'bad' }] }));
    expect(totals.failed).toEqual([{ documentId: 'a', error: 'bad' }]);
    await expect(importInBatches([rec('a', 10)], async () => { throw new Error('POST → 500'); })).rejects.toThrow('POST → 500');
  });
});
