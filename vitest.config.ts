import { defineConfig } from 'vitest/config';

// Un solo runner para todo el monorepo. Los tests que necesitan DOM
// declaran `// @vitest-environment jsdom` en la primera línea.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
