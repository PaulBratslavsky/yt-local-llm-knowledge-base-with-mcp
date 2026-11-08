import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// yt-kb's content lives in the strapi-plugin-yt-kb plugin, whose REST routes
// are served under /api/yt-kb/<plural>. An unprefixed /api/videos would hit
// whatever the host Strapi has at that path — the old api:: types while they
// still exist, a 404 after, or a different app's content on a shared host.
//
// /api/notes/compose is this client's own TanStack route, not Strapi.
const SRC = join(__dirname, '..', '..');
const UNPREFIXED = /\/api\/(?:videos|tags|transcripts|digests)\b|\/api\/notes(?!\/compose)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(name)) return [];
    if (/\.test\.tsx?$/.test(name) || name === 'routeTree.gen.ts') return [];
    return [path];
  });
}

describe('Strapi content paths', () => {
  it('uses the /api/yt-kb prefix for every yt-kb content type', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          UNPREFIXED.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(offenders, 'Strapi paths without the /api/yt-kb prefix').toEqual([]);
  });
});
