#!/usr/bin/env node
// Copy yt-kb content from one Strapi to another over HTTP, keeping every
// record's documentId, createdAt and updatedAt, then check the copy.
//
//   SOURCE_URL     default http://localhost:1340
//   SOURCE_PREFIX  REST prefix of the source types: /api/yt-kb (the plugin,
//                  default) or /api (an app that still has the api:: types)
//   SOURCE_TOKEN   API token that can read the source types
//   DEST_URL       default http://localhost:1340
//   DEST_TOKEN     API token with plugin::yt-kb.importer.importRecords
//                  (and read access, for the check)
//
//   node copy-content.mjs            copy, then check
//   node copy-content.mjs --check    check only, write nothing
//
// Safe to re-run: records are upserted by documentId. It never deletes —
// a record removed from the source stays in the destination, and the check
// reports it as "only in destination".

const SOURCE_URL = (process.env.SOURCE_URL ?? 'http://localhost:1340').replace(/\/$/, '');
const SOURCE_PREFIX = (process.env.SOURCE_PREFIX ?? '/api/yt-kb').replace(/\/$/, '');
const DEST_URL = (process.env.DEST_URL ?? 'http://localhost:1340').replace(/\/$/, '');
const { SOURCE_TOKEN, DEST_TOKEN } = process.env;
const CHECK_ONLY = process.argv.includes('--check');

if (!SOURCE_TOKEN || !DEST_TOKEN) {
  console.error('SOURCE_TOKEN and DEST_TOKEN are required.');
  process.exit(2);
}

const docId = { fields: ['documentId'] };

// Import order: a record's relations must already exist in the destination.
// Only the owning side of each relation is copied; the other side follows.
const TYPES = [
  { type: 'tag', plural: 'tags', pageSize: 100, populate: {} },
  { type: 'transcript', plural: 'transcripts', pageSize: 25, populate: {} },
  {
    type: 'video',
    plural: 'videos',
    pageSize: 10,
    relations: ['tags', 'transcript'],
    populate: {
      tags: docId,
      transcript: docId,
      keyTakeaways: true,
      sections: true,
      actionSteps: true,
    },
  },
  { type: 'note', plural: 'notes', pageSize: 100, relations: ['videos'], populate: { videos: docId } },
  {
    type: 'digest',
    plural: 'digests',
    pageSize: 25,
    relations: ['videos'],
    populate: {
      videos: docId,
      sharedThemes: { populate: { videoTitles: true } },
      uniqueInsights: true,
      contradictions: { populate: { positions: true } },
      viewingOrder: true,
    },
  },
];

// Strapi's bracketed query syntax: populate[tags][fields][0]=documentId
const toQuery = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) return v.map((item, i) => `${key}[${i}]=${encodeURIComponent(item)}`);
    if (v && typeof v === 'object') return toQuery(v, key);
    return [`${key}=${encodeURIComponent(v)}`];
  });

async function request(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function readAll(base, prefix, token, t) {
  const out = [];
  for (let page = 1; ; page++) {
    const q = toQuery({
      populate: t.populate,
      pagination: { page, pageSize: t.pageSize },
      sort: ['id:asc'],
    }).join('&');
    const body = await request(`${base}${prefix}/${t.plural}?${q}`, token);
    out.push(...body.data);
    if (page >= (body.meta?.pagination?.pageCount ?? 1)) return out;
  }
}

// POST in batches that stay well under Strapi's JSON body limit.
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
async function importAll(t, records) {
  const totals = { created: 0, updated: 0, failed: [] };
  let batch = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const r = await request(`${DEST_URL}/api/yt-kb/import/${t.type}`, DEST_TOKEN, {
      method: 'POST',
      body: JSON.stringify({ data: batch }),
    });
    totals.created += r.created;
    totals.updated += r.updated;
    totals.failed.push(...r.failed);
    batch = [];
    bytes = 0;
  };
  for (const record of records) {
    const size = Buffer.byteLength(JSON.stringify(record));
    if (bytes + size > MAX_BATCH_BYTES) await flush();
    batch.push(record);
    bytes += size;
  }
  await flush();
  return totals;
}

// What a record must look like on both sides. Row ids differ by design;
// publishedAt is stamped at write time and nothing reads it.
const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (k !== 'id' && k !== 'publishedAt') out[k] = strip(v[k]);
    return out;
  }
  return v;
};
const normalize = (t, record) => {
  const r = { ...record };
  for (const rel of t.relations ?? []) {
    const v = r[rel];
    r[rel] = Array.isArray(v) ? v.map((x) => x.documentId).sort() : (v?.documentId ?? null);
  }
  return JSON.stringify(strip(r));
};

const differingFields = (a, b) => {
  const A = JSON.parse(a);
  const B = JSON.parse(b);
  return [...new Set([...Object.keys(A), ...Object.keys(B)])]
    .filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]))
    .join(', ');
};

async function check(t, sourceRecords) {
  const dest = await readAll(DEST_URL, '/api/yt-kb', DEST_TOKEN, t);
  const destById = new Map(dest.map((r) => [r.documentId, normalize(t, r)]));
  const sourceIds = new Set(sourceRecords.map((r) => r.documentId));
  const missing = [];
  const different = [];
  for (const r of sourceRecords) {
    const d = destById.get(r.documentId);
    if (d === undefined) missing.push(r.documentId);
    else {
      const s = normalize(t, r);
      if (s !== d) different.push(`${r.documentId} (${differingFields(s, d)})`);
    }
  }
  const extra = dest.filter((r) => !sourceIds.has(r.documentId)).map((r) => r.documentId);
  return { source: sourceRecords.length, dest: dest.length, missing, different, extra };
}

let ok = true;
console.log(`source ${SOURCE_URL}${SOURCE_PREFIX} → dest ${DEST_URL}/api/yt-kb${CHECK_ONLY ? ' (check only)' : ''}`);
for (const t of TYPES) {
  const records = await readAll(SOURCE_URL, SOURCE_PREFIX, SOURCE_TOKEN, t);
  if (!CHECK_ONLY) {
    const r = await importAll(t, records);
    console.log(`${t.plural}: read ${records.length}, created ${r.created}, updated ${r.updated}, failed ${r.failed.length}`);
    for (const f of r.failed.slice(0, 5)) console.log(`  failed ${f.documentId}: ${f.error}`);
    if (r.failed.length) ok = false;
  }
  const c = await check(t, records);
  const clean = !c.missing.length && !c.different.length;
  console.log(
    `  check ${t.plural}: source ${c.source}, dest ${c.dest}, missing ${c.missing.length}, ` +
      `different ${c.different.length}, only in destination ${c.extra.length} ${clean ? 'OK' : 'FAIL'}`,
  );
  for (const id of [...c.missing, ...c.different].slice(0, 5)) console.log(`    ${id}`);
  if (!clean) ok = false;
}
console.log(ok ? 'ALL OK' : 'PROBLEMS FOUND');
process.exit(ok ? 0 : 1);
