import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FETCH_TRANSCRIPT_ACTION, LEGACY_ACTION_DEFS, buildToolActionDefs } from './permissions';

// Strapi admin's bootstrap deletes every admin::permission row whose action
// is not registered — and an admin API token's grants are exactly those
// rows. If yt-kb's actions registered behind an enabled check, one boot with
// the flag off would delete every token's grants for good.
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');

describe('MCP admin permission registration', () => {
  it('registers the permissions before the enabled check returns', () => {
    const register = source.indexOf('registerMcpAdminPermissions(strapi)');
    const gate = source.indexOf('isEnabled()');
    expect(register, 'registerMcpAdminPermissions call not found').toBeGreaterThan(-1);
    expect(gate, 'isEnabled() gate not found').toBeGreaterThan(-1);
    expect(register).toBeLessThan(gate);
  });

  it('does not return from the function before registering them', () => {
    const register = source.indexOf('registerMcpAdminPermissions(strapi)');
    const earlyReturn = source.indexOf('return;');
    expect(earlyReturn === -1 || earlyReturn > register).toBe(true);
  });

  // Renaming an action has the same effect as not registering it: its rows
  // no longer match and the next boot deletes them.
  it('registers the 21 per-tool actions and the 3 legacy tiers', () => {
    const tools = buildToolActionDefs();
    expect(tools).toHaveLength(21);
    for (const d of tools) {
      expect(d).toMatchObject({ section: 'plugins', pluginName: 'yt-kb', subCategory: 'AI tools' });
      expect(d.uid).toMatch(/^tool\.[a-z]+(-[a-z]+)*$/);
    }
    expect(new Set(tools.map((d) => d.uid)).size).toBe(21);
    // The admin route (routes/index.ts) is gated by the fetch tool's own action.
    expect(FETCH_TRANSCRIPT_ACTION).toBe('plugin::yt-kb.tool.fetch-transcript');
    expect(tools.filter((d) => `plugin::yt-kb.${d.uid}` === FETCH_TRANSCRIPT_ACTION)).toHaveLength(1);
    expect(LEGACY_ACTION_DEFS.map((d) => d.uid)).toEqual(['read', 'write', 'maintenance']);
    for (const d of LEGACY_ACTION_DEFS) {
      expect(d.pluginName).toBe('yt-kb');
      expect(d.displayName.endsWith(' (legacy — migrated at boot)')).toBe(true);
    }
  });
});
