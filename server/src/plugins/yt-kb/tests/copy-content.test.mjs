import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Runs the script as an operator would, with only the variables given (the
// parent's environment is not inherited). Every case here must exit before
// the first request, so none of them touches the network.
const SCRIPT = fileURLToPath(new URL('../scripts/copy-content.mjs', import.meta.url));

function run(env) {
  const res = spawnSync(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH, SOURCE_TOKEN: 'source-test', DEST_TOKEN: 'dest-test', ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
  return { code: res.status, stderr: res.stderr };
}

describe('copy-content.mjs URL preconditions', () => {
  it('requires SOURCE_URL, with no localhost default', () => {
    const { code, stderr } = run({ DEST_URL: 'https://dest.test' });
    expect(code).toBe(2);
    expect(stderr).toContain('SOURCE_URL is required');
  });

  it('requires DEST_URL, with no localhost default', () => {
    const { code, stderr } = run({ SOURCE_URL: 'https://source.test' });
    expect(code).toBe(2);
    expect(stderr).toContain('DEST_URL is required');
  });

  it('refuses to copy a Strapi onto itself, after normalising slash and host case', () => {
    for (const [src, dest] of [
      ['https://cms.test', 'https://cms.test'],
      ['https://cms.test/', 'https://cms.test'],
      ['https://CMS.Test:1340', 'https://cms.test:1340/'],
    ]) {
      const { code, stderr } = run({ SOURCE_URL: src, DEST_URL: dest });
      expect(code).toBe(2);
      expect(stderr).toContain('SOURCE_URL and DEST_URL are the same Strapi');
    }
  });
});
