export type Theme = 'light' | 'dark';

/** Shared by the no-flash script in the document head and the toggle in the
 *  header. If the two ever disagree the page flips on every load. */
export const THEME_STORAGE_KEY = 'ytkb-theme';

/** The theme to paint, given what the visitor last chose and what their
 *  system asks for.
 *
 *  A stored choice wins; anything unrecognised — including a value left by an
 *  older build — falls back to the system rather than leaving the page
 *  unthemed. */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}
