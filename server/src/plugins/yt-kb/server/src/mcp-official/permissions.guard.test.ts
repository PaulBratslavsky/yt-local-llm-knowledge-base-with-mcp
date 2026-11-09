import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards an ordering that nothing else can catch.
//
// Strapi admin's bootstrap runs cleanPermissionsInDatabase(), which deletes
// every `admin::permission` row whose action is not registered in the
// actionProvider. An admin API token's grants are exactly those rows. So if
// the plugin::yt-kb actions register behind an enabled check, one boot with
// the flag off deletes the grants from every token — permanently, silently,
// and turning MCP back on does not bring them back. Measured on a copy of
// the real database: six grant rows went to zero on a single boot.
//
// The guard reads the source rather than importing it: the ordering is
// the thing under test, and importing would need a running Strapi.
const ENTRY = join(__dirname, 'index.ts');
const PERMISSIONS = join(__dirname, 'permissions.ts');

describe('MCP admin permission registration', () => {
  const source = readFileSync(ENTRY, 'utf8');

  it('registers the permissions before the enabled check returns', () => {
    const register = source.indexOf('registerMcpAdminPermissions(strapi)');
    const gate = source.indexOf('isEnabled()');

    expect(register, 'registerMcpAdminPermissions call not found').toBeGreaterThan(-1);
    expect(gate, 'isEnabled() gate not found').toBeGreaterThan(-1);
    expect(
      register,
      'Permissions must register before the MCP_ENABLED gate. Behind it, one ' +
        'boot with MCP disabled deletes every token grant for good.',
    ).toBeLessThan(gate);
  });

  it('does not return from the function before registering them', () => {
    const register = source.indexOf('registerMcpAdminPermissions(strapi)');
    const earlyReturn = source.indexOf('return;');

    expect(
      earlyReturn === -1 || earlyReturn > register,
      'An early return above registerMcpAdminPermissions would skip it on ' +
        'exactly the boots that destroy token grants.',
    ).toBe(true);
  });

  // The three action ids are what a minted token's grants point at. Renaming
  // one has the same effect as not registering it: the old rows no longer
  // match a registered action and the next boot deletes them.
  it('still registers the three action ids tokens are granted', () => {
    const permissions = readFileSync(PERMISSIONS, 'utf8');

    // Registered as plugin::yt-kb.<uid>.
    expect(permissions).toContain("pluginName: 'yt-kb'");
    for (const uid of ['read', 'write', 'maintenance']) {
      expect(
        permissions,
        `plugin::yt-kb.${uid} missing — existing grants for it would be deleted`,
      ).toContain(`uid: '${uid}'`);
    }
  });
});
