import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { errors } from '@strapi/utils';
import { UNIQUE_CODE, UNIQUE_MESSAGE, isUniqueViolation, withUniqueRetry } from './db-errors';

// better-sqlite3 is the host app's driver (server/node_modules).
const fromServer = createRequire(join(__dirname, '..', '..', '..', '..', '..', '..', 'package.json'));

function sqliteError(ddl: string, insert: string): unknown {
  const Database = fromServer('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(ddl);
  try {
    db.exec(insert);
    db.exec(insert);
  } catch (e) {
    return e;
  } finally {
    db.close();
  }
  return null;
}

describe('isUniqueViolation', () => {
  it('recognises a real better-sqlite3 unique violation', () => {
    const err = sqliteError('CREATE TABLE t (v TEXT); CREATE UNIQUE INDEX t_v_uq ON t (v);', "INSERT INTO t (v) VALUES ('a')");
    expect(isUniqueViolation(err)).toBe(true);
  });
  it('does not treat a NOT NULL failure as one', () => {
    const err = sqliteError('CREATE TABLE n (v TEXT NOT NULL);', 'INSERT INTO n (v) VALUES (NULL)');
    expect(isUniqueViolation(err)).toBe(false);
  });
  it('recognises Postgres 23505 and MySQL ER_DUP_ENTRY', () => {
    expect(isUniqueViolation(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }))).toBe(true);
  });
  it("recognises Strapi's validator error", () => {
    const err = new errors.ValidationError(UNIQUE_MESSAGE, {
      errors: [{ path: ['name'], message: UNIQUE_MESSAGE, name: 'ValidationError' }],
    });
    expect(isUniqueViolation(err)).toBe(true);
  });
  it("recognises yt-kb's own duplicate errors", () => {
    expect(isUniqueViolation(new errors.ApplicationError('A video for this id already exists.', { code: UNIQUE_CODE }))).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isUniqueViolation(new errors.ValidationError('title must be at most 200 characters', { errors: [{ message: 'too long' }] }))).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('SQLITE_CONSTRAINT_UNIQUE')).toBe(false);
  });
});

describe('withUniqueRetry', () => {
  const unique = () => Object.assign(new Error('dup'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
  it('runs the work once more after a unique violation', async () => {
    let calls = 0;
    const out = await withUniqueRetry(async () => {
      calls += 1;
      if (calls === 1) throw unique();
      return 'ok';
    });
    expect([out, calls]).toEqual(['ok', 2]);
  });
  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(withUniqueRetry(async () => { calls += 1; throw new Error('boom'); })).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
  it('lets a second unique violation through', async () => {
    await expect(withUniqueRetry(async () => { throw unique(); })).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
  });
});
