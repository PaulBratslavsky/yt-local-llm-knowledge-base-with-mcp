import { defineConfig } from 'vitest/config';

// The plugin's unit tests and guards. Node environment only; they never
// boot Strapi. `server/tsconfig.build.json` excludes **/*.test.ts, so
// nothing here reaches dist/.
export default defineConfig({
  test: {
    include: ['server/src/**/*.test.ts'],
    environment: 'node',
  },
});
