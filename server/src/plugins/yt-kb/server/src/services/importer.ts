import type { Core } from '@strapi/strapi';

// Bulk import that keeps each record's identity: its documentId and its
// createdAt / updatedAt. The REST API refuses those keys on create, and a
// copy that resets them would scramble the feed (sorted by createdAt) and
// break every saved /video/<documentId> link.
//
// Records come in the shape the REST API returns them in, so a copy is
// "GET from the source, POST here": relations may be populated objects,
// components may carry their old ids. The schema decides what is kept.
//
// Upsert by documentId, so re-running a copy updates instead of duplicating.
// Import order matters for relations: tag, transcript, video, note, digest.

export const IMPORT_TYPES = ['tag', 'transcript', 'video', 'note', 'digest'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const isImportType = (t: string): t is ImportType =>
  (IMPORT_TYPES as readonly string[]).includes(t);

type Attribute = {
  type: string;
  relation?: string;
  mappedBy?: string;
  component?: string;
  repeatable?: boolean;
};
type AnyRecord = Record<string, unknown>;

export type ImportResult = {
  created: number;
  updated: number;
  failed: { documentId: unknown; error: string }[];
};

const isObject = (v: unknown): v is AnyRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Components are re-created on write, so their old ids must go — at every
// depth, since some components nest others.
const stripIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripIds);
  if (!isObject(value)) return value;
  const out: AnyRecord = {};
  for (const [k, v] of Object.entries(value)) if (k !== 'id') out[k] = stripIds(v);
  return out;
};

// A relation may arrive as a documentId, a populated object, or a list of
// either. The Document Service takes documentIds.
const toDocumentIds = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(toDocumentIds);
  if (isObject(value)) return value.documentId;
  return value;
};

/**
 * The writable data for one record. Only attributes the schema declares are
 * kept; the non-owning side of a relation (`mappedBy`) is dropped, because
 * the owning type's import writes that link.
 */
export const toWriteData = (
  attributes: Record<string, Attribute>,
  record: AnyRecord,
): AnyRecord => {
  const data: AnyRecord = {};
  for (const [key, attr] of Object.entries(attributes)) {
    if (!(key in record)) continue;
    const value = record[key];
    if (attr.type === 'relation') {
      if (attr.mappedBy) continue;
      data[key] = toDocumentIds(value);
    } else if (attr.type === 'component') {
      data[key] = stripIds(value);
    } else {
      data[key] = value;
    }
  }
  return data;
};

const asDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async importRecords(type: ImportType, records: AnyRecord[]): Promise<ImportResult> {
    const uid = `plugin::yt-kb.${type}`;
    const model = strapi.getModel(uid as never) as unknown as {
      attributes: Record<string, Attribute>;
      collectionName: string;
    };
    const docs = strapi.documents(uid as never);
    const result: ImportResult = { created: 0, updated: 0, failed: [] };

    for (const record of records) {
      const documentId = record.documentId;
      try {
        if (typeof documentId !== 'string' || !documentId) {
          throw new Error('documentId is required');
        }
        const data = toWriteData(model.attributes, record);
        const existing = await docs.findOne({ documentId } as never);
        if (existing) {
          await docs.update({ documentId, data } as never);
          result.updated += 1;
        } else {
          await docs.create({ data: { ...data, documentId } } as never);
          result.created += 1;
        }

        // Set the dates last: any write through the Document Service stamps
        // updatedAt with "now", and validation may drop createdAt. This goes
        // straight to the row, the same way on SQLite and Postgres.
        const createdAt = asDate(record.createdAt);
        const updatedAt = asDate(record.updatedAt);
        const stamps: AnyRecord = {};
        if (createdAt) stamps.created_at = createdAt;
        if (updatedAt) stamps.updated_at = updatedAt;
        if (Object.keys(stamps).length > 0) {
          await strapi.db
            .connection(model.collectionName)
            .where({ document_id: documentId })
            .update(stamps);
        }
      } catch (err) {
        result.failed.push({
          documentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return result;
  },
});
