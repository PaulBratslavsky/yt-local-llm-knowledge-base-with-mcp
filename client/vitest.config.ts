import { defineConfig } from 'vitest/config'

// Deliberately plugin-free. Vitest prefers this file over vite.config.ts,
// so unit tests no longer boot the devtools / tailwind / TanStack Start /
// nitro plugin chain they never used.
//
// Vitest (unit) owns src/**. Playwright (e2e) owns e2e/** and uses
// *.spec.ts — excluded here so vitest's default glob doesn't try to run
// browser specs in node.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
