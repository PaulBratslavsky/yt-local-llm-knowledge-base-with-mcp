import { describe, expect, it, vi } from 'vitest';

// B-1: every server-function schema that takes a documentId validates it with
// DOCUMENT_ID, and every schema whose ids may be either kind uses VIDEO_REF,
// so a traversal id is refused before any Strapi path is built. The modules
// only define server fns at import; env.ts warns on load, hence the spy.
vi.hoisted(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

import { DocumentIdSchema, UpdateSectionTimecodeSchema } from './videos';
import {
  CreateNoteSchema,
  DeleteNoteSchema,
  ListNotesSchema,
  SummarizeToNoteSchema,
  UpdateNoteSchema,
} from './notes';
import { DeleteSavedDigestSchema, FetchSavedDigestSchema, LoadDigestSchema } from './digests';
import { GenerateDigestSchema } from './digest';

const DOC = 'k3x9q2m8v7b6n5c4z1a0s2d3';
const BAD = '../../users/1';
const YT = 'dQw4w9WgXcQ';

type Schema = { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } } };

// [name, schema, the documentId field, build valid input with that field set]
const documentIdCases: Array<[string, Schema, string, (id: string) => unknown]> = [
  ['DocumentIdSchema', DocumentIdSchema, 'documentId', (id) => ({ documentId: id })],
  [
    'UpdateSectionTimecodeSchema',
    UpdateSectionTimecodeSchema,
    'documentId',
    (id) => ({ documentId: id, sectionId: 1, timeSec: 30 }),
  ],
  ['ListNotesSchema', ListNotesSchema, 'videoDocumentId', (id) => ({ videoDocumentId: id })],
  [
    'CreateNoteSchema',
    CreateNoteSchema,
    'videoDocumentIds',
    (id) => ({ body: 'A note.', videoDocumentIds: [id] }),
  ],
  ['UpdateNoteSchema', UpdateNoteSchema, 'documentId', (id) => ({ documentId: id, body: 'Edited.' })],
  ['DeleteNoteSchema', DeleteNoteSchema, 'documentId', (id) => ({ documentId: id })],
  ['FetchSavedDigestSchema', FetchSavedDigestSchema, 'documentId', (id) => ({ documentId: id })],
  ['DeleteSavedDigestSchema', DeleteSavedDigestSchema, 'documentId', (id) => ({ documentId: id })],
];

const messages = [
  { role: 'user', content: 'q' },
  { role: 'assistant', content: 'a' },
];

// [name, schema, build valid input from an id list]
const videoRefCases: Array<[string, Schema, (ids: string[]) => unknown]> = [
  ['SummarizeToNoteSchema', SummarizeToNoteSchema, (ids) => ({ videoIds: ids, messages })],
  ['LoadDigestSchema', LoadDigestSchema, (ids) => ({ videoIds: ids })],
  ['GenerateDigestSchema', GenerateDigestSchema, (ids) => ({ videoIds: ids })],
];

describe('server-function documentId schemas (B-1)', () => {
  it.each(documentIdCases)('%s rejects a traversal id on its documentId field', (_, schema, field, build) => {
    const res = schema.safeParse(build(BAD));
    expect(res.success).toBe(false);
    expect(res.error?.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });

  it.each(documentIdCases)('%s accepts a well-formed documentId', (_, schema, __, build) => {
    expect(schema.safeParse(build(DOC)).success).toBe(true);
  });

  it.each(videoRefCases)('%s rejects a traversal id among the video ids', (_, schema, build) => {
    expect(schema.safeParse(build([BAD, YT])).success).toBe(false);
  });

  it.each(videoRefCases)('%s accepts a YouTube id and a documentId', (_, schema, build) => {
    expect(schema.safeParse(build([YT, DOC])).success).toBe(true);
  });
});
