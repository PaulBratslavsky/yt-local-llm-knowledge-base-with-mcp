import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextTheme, resolveTheme, THEME_STORAGE_KEY } from './theme';

describe('resolveTheme', () => {
  it('honours a stored choice over the system preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  // localStorage holds whatever anyone put there, including a value from an
  // older build. An unrecognised one must not leave the page unthemed.
  it('falls back to the system for a value it does not recognise', () => {
    expect(resolveTheme('midnight', true)).toBe('dark');
    expect(resolveTheme('', false)).toBe('light');
  });
});

describe('nextTheme', () => {
  it('flips between the two themes', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});

describe('THEME_STORAGE_KEY', () => {
  // The no-flash script in the document head is inlined separately from the
  // toggle, so both must agree on the key or the page flips on every load.
  it('is a single shared constant', () => {
    expect(THEME_STORAGE_KEY).toBe('ytkb-theme');
  });

  // BaseLayout's no-flash script runs before any module loads, so it cannot
  // import this constant and hardcodes the string. If the two drift, a
  // returning visitor's choice is silently ignored on first paint.
  it('matches the key hardcoded in the no-flash script', () => {
    const layout = readFileSync(
      new URL('../layouts/BaseLayout.astro', import.meta.url),
      'utf8',
    );
    const inlined = layout.match(/localStorage\.getItem\('([^']+)'\)/)?.[1];
    expect(inlined, 'no getItem call found in BaseLayout.astro').toBeDefined();
    expect(inlined).toBe(THEME_STORAGE_KEY);
  });
});
