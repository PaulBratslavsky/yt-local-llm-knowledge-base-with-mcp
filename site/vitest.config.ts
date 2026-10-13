import { getViteConfig } from 'astro/config';

// Astro's own Vite config, so `.astro` components can be rendered in tests
// via the container API. A plain vitest config cannot transform them.
export default getViteConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
