import { describe, expect, it } from 'vitest';
import { runBackfill, type BackfillOutcome } from './backfill';
import type { StrapiResult } from './strapi-client';

// M-13: each backfill writes the field it filters on, so a fixed row leaves
// the eligible set. These drive runBackfill over an in-memory eligible set,
// sorted by id, that shrinks underneath it exactly as Strapi's would.
type Row = { id: number; documentId: string };

function library(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, documentId: `doc${i + 1}` }));
}

function store(rows: Row[]) {
  const eligible = [...rows].sort((a, b) => a.id - b.id);
  let reads = 0;
  return {
    eligible,
    get reads() {
      return reads;
    },
    readPage: async (start: number, limit: number): Promise<StrapiResult<Row[]>> => {
      reads += 1;
      return {
        ok: true,
        data: eligible.slice(start, start + limit),
        meta: { pagination: { total: eligible.length } },
      };
    },
    remove(row: Row) {
      const i = eligible.findIndex((r) => r.id === row.id);
      if (i >= 0) eligible.splice(i, 1);
    },
  };
}

describe('runBackfill', () => {
  it('drains a library larger than one page', async () => {
    const s = store(library(250));
    const result = await runBackfill<Row>({
      pageSize: 100,
      readPage: s.readPage,
      process: async (row) => {
        s.remove(row);
        return 'updated';
      },
    });
    expect(result).toMatchObject({ status: 'ok', updated: 250, skipped: 0, failed: 0, total: 250 });
    expect(s.eligible).toEqual([]);
  });

  it('steps over rows it cannot fix and still fixes every other row', async () => {
    const s = store(library(250));
    const unfixable = (row: Row) => row.id % 3 === 0;
    const result = await runBackfill<Row>({
      pageSize: 100,
      readPage: s.readPage,
      process: async (row): Promise<BackfillOutcome> => {
        if (unfixable(row)) return 'skipped';
        s.remove(row);
        return 'updated';
      },
    });
    const thirds = library(250).filter(unfixable).length;
    expect(result).toMatchObject({ status: 'ok', skipped: thirds, updated: 250 - thirds, failed: 0, total: 250 });
    expect(s.eligible.every(unfixable)).toBe(true);
  });

  it('stops with the reason when a read fails, keeping what it already did', async () => {
    const s = store(library(250));
    let pass = 0;
    const result = await runBackfill<Row>({
      pageSize: 100,
      readPage: async (start, limit) => {
        pass += 1;
        if (pass === 2) return { ok: false, status: 0, error: 'fetch failed' };
        return s.readPage(start, limit);
      },
      process: async (row) => {
        s.remove(row);
        return 'updated';
      },
    });
    expect(result.status).toBe('error');
    expect(result.error).toBe('Backend unreachable. Check that Strapi is running on port 1340.');
    expect(result.updated).toBe(100);
  });

  it('counts failed writes and keeps at most five of their messages', async () => {
    const s = store(library(12));
    const result = await runBackfill<Row>({
      pageSize: 100,
      readPage: s.readPage,
      process: async (row): Promise<BackfillOutcome> => {
        if (row.id <= 8) return { failed: `write ${row.id} refused` };
        s.remove(row);
        return 'updated';
      },
    });
    expect(result).toMatchObject({ status: 'ok', failed: 8, updated: 4 });
    expect(result.errors).toHaveLength(5);
    expect(result.errors[0]).toBe('doc1: write 1 refused');
  });

  it('gives up after maxPasses when rows never leave the eligible set', async () => {
    const s = store(library(10));
    const result = await runBackfill<Row>({
      pageSize: 5,
      maxPasses: 3,
      readPage: s.readPage,
      // Reports 'updated' but the write never lands, so the row stays.
      process: async () => 'updated',
    });
    expect(result.status).toBe('error');
    expect(result.error).toBe('Stopped after 3 passes — run it again to continue.');
    expect(s.reads).toBe(3);
  });
});
