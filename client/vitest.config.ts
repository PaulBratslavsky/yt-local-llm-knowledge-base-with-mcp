import { defineConfig } from 'vitest/config'

// Deliberately plugin-free. Vitest prefers this file over vite.config.ts,
// so unit tests no longer boot the devtools / tailwind / TanStack Start /
// nitro plugin chain they never used.
//
// Vitest (unit) owns src/**. Playwright (e2e) owns e2e/** and uses
// *.spec.ts — excluded here so vitest's default glob doesn't try to run
// browser specs in node.
//
// Environment is node by default: the suite is mostly service-level tests
// that never touch a DOM, and paying jsdom's per-file setup for them slows
// the run for no benefit. A test that renders a component opts in with a
// docblock on its first line:
//
//   // @vitest-environment jsdom
//
// (Per-file rather than `environmentMatchGlobs`, which vitest 3 deprecates.)
// jsdom, @testing-library/react and @testing-library/dom are already
// devDependencies. Remember `cleanup()` in an `afterEach` — auto-cleanup
// only fires when vitest globals are enabled, and they aren't here.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
