import { nextTheme, resolveTheme, THEME_STORAGE_KEY, type Theme } from '../lib/theme';

/** The toggle in the header.
 *
 *  The theme itself is already painted by the inline script in BaseLayout's
 *  <head> — this only handles clicks and keeps the button's label honest. */
const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');

if (button) {
  const root = document.documentElement;

  const read = (): Theme => {
    const attr = root.dataset.theme;
    if (attr === 'light' || attr === 'dark') return attr;
    return resolveTheme(null, window.matchMedia('(prefers-color-scheme: dark)').matches);
  };

  const label = (theme: Theme) =>
    theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  const paint = (theme: Theme) => {
    root.dataset.theme = theme;
    button.setAttribute('aria-label', label(theme));
    button.setAttribute('title', label(theme));
    // Two icons live in the button; CSS shows whichever matches the theme.
    button.dataset.theme = theme;
  };

  paint(read());

  button.addEventListener('click', () => {
    const theme = nextTheme(read());
    paint(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Private mode or blocked storage: the choice holds for this page only.
    }
  });
}
