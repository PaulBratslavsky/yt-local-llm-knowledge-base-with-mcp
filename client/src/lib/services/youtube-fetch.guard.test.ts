import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Transcripts are fetched from YouTube in one place: strapi-plugin-yt-kb
// (POST /api/yt-kb/transcripts/fetch). The app used to carry its own copy of
// the fetcher, identical to the plugin's and kept in sync by nothing, so a
// fix for a YouTube change landed in one copy and not the other. It also
// meant two proxy settings. This fails if a YouTube client comes back.
const SRC = join(__dirname, '..', '..');
const YOUTUBE_CLIENT = /from ['"](youtubei\.js|undici)['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [path];
  });
}

describe('YouTube transcript fetching', () => {
  it('happens in Strapi, not in the app', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => YOUTUBE_CLIENT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders, 'app files importing a YouTube client').toEqual([]);
  });
});
