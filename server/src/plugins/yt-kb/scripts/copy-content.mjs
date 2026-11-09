#!/usr/bin/env node
// Copy yt-kb content from one Strapi to another over HTTP, keeping every
// record's documentId, createdAt and updatedAt, then check the copy.
//
//   SOURCE_URL     required: the Strapi to copy from
//   SOURCE_PREFIX  REST prefix of the source types: /api/yt-kb (the plugin,
//                  default) or /api (an app that still has the api:: types)
//   SOURCE_TOKEN   API token that can read the source types
//   DEST_URL       required: the Strapi to copy into; must differ from
//                  SOURCE_URL (compared without a trailing slash, host
//                  case-insensitive)
//   DEST_TOKEN     API token with plugin::yt-kb.importer.importRecords
//                  (and read access, for the check). The destination must
//                  set the yt-kb plugin config `import: true` while copying.
//
//   node copy-content.mjs            copy, then check
//   node copy-content.mjs --check    check only, write nothing
//
// Safe to re-run: records are upserted by documentId. It never deletes —
// a record removed from the source stays in the destination, and the check
// reports it as "only in destination".
//
// Records are POSTed in batches of at most 900 KB of JSON (import-batches.mjs),
// under a stock Strapi's 1 MB body limit; a record bigger than that is sent on
// its own. A 413 marks that batch's records as failed — raise strapi::body
// jsonLimit on the destination (config/middlewares) and re-run; re-running is
// safe.

import { importInBatches } from './import-batches.mjs';

// Both URLs are required: a default would let a forgotten variable copy a
// Strapi onto itself, or onto whatever happens to listen on localhost.
// Exits 2 (usage) without a request. The values are never printed.
function requiredUrl(name) {
  const raw = process.env[name];
  if (!raw) {
    console.error(`${name} is required: set SOURCE_URL and DEST_URL to the two Strapi base URLs.`);
    process.exit(2);
  }
  try {
    new URL(raw);
  } catch {
    console.error(`${name} is not a valid URL.`);
    process.exit(2);
  }
  return raw.replace(/\/+$/, '');
}

// Scheme, host and path, without a trailing slash. URL lower-cases the
// scheme and host and drops a default port.
const normalUrl = (raw) => {
  const u = new URL(raw);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
};

const SOURCE_URL = requiredUrl('SOURCE_URL');
const DEST_URL = requiredUrl('DEST_URL');
if (normalUrl(SOURCE_URL) === normalUrl(DEST_URL)) {
  console.error('SOURCE_URL and DEST_URL are the same Strapi; refusing to copy a Strapi onto itself.');
  process.exit(2);
}
const SOURCE_PREFIX = (process.env.SOURCE_PREFIX ?? '/api/yt-kb').replace(/\/$/, '');
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

// POST one batch. 200 = every record written; 207 = some failed (listed in
// `failed`, counted below); 403 with the plugin's "Import is disabled"
// message = the destination's yt-kb config does not set `import: true`.
// 413 = the body was too large for the destination; importInBatches records it.
async function postImport(type, batch) {
  const url = `${DEST_URL}/api/yt-kb/import/${type}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DEST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: batch }),
  });
  const text = await res.text();
  if (res.status === 413) return { tooLarge: true };
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status === 403 && body?.error?.message?.startsWith('Import is disabled')) {
    console.error(
      `Import is disabled on ${DEST_URL}. Set the yt-kb plugin config \`import: true\` there, restart it, run this again, then set it back to false.`,
    );
    process.exit(2);
  }
  if ((res.status !== 200 && res.status !== 207) || body === null) {
    throw new Error(`POST ${url} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

// POST in planned batches under a stock Strapi's 1 MB body limit
// (import-batches.mjs); a 413'd batch is recorded as failed and the copy goes on.
const importAll = (t, records) => importInBatches(records, (batch) => postImport(t.type, batch));

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
