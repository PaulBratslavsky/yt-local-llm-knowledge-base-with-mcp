import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// B-1: every Strapi path built from input escapes its segment with seg(), and
// every documentId a server function accepts is validated with DOCUMENT_ID,
// so no browser-supplied id can redirect a request to another Strapi route
// (`../../users/1` turned /api/yt-kb/notes/<id> into /api/users/1, sent with
// the app's token). M-21: no raw Strapi fetch outside strapi-client.ts.
const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(name)) return [];
    if (/\.test\.tsx?$/.test(name) || name === 'routeTree.gen.ts') return [];
    return [path];
  });
}

const UNESCAPED_SEGMENT = /\/api\/yt-kb\/[a-z-]+\/\$\{(?!seg\()/;

describe('Strapi path segments (B-1)', () => {
  it('escapes every interpolated /api/yt-kb/<type>/ segment with seg()', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          UNESCAPED_SEGMENT.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(offenders, 'Strapi path segments built without seg()').toEqual([]);
  });

  it('reads STRAPI_API_TOKEN only in env.ts and strapi-client.ts (no raw Strapi fetch)', () => {
    const readers = sourceFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('STRAPI_API_TOKEN'))
      .map((file) => relative(SRC, file))
      .sort();
    expect(readers).toEqual(['lib/env.ts', 'lib/services/strapi-client.ts']);
  });

  it('validates every documentId list in the server functions with DOCUMENT_ID', () => {
    const dir = join(SRC, 'data', 'server-functions');
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !/\.test\.ts$/.test(name))
      .flatMap((name) => {
        const text = readFileSync(join(dir, name), 'utf8');
        return [...text.matchAll(/\b(\w*[dD]ocumentIds?)\s*:\s*(z\.[^\n]*)/g)]
          .filter((m) => !m[2].startsWith('z.array(DOCUMENT_ID)'))
          .map((m) => `${name}: ${m[1]}: ${m[2].trim()}`);
      });
    expect(offenders, 'documentId fields not validated with DOCUMENT_ID').toEqual([]);
  });
});
