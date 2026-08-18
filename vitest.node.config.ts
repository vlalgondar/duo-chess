import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'node',
    include: ['packages/shared/src/**/*.test.ts', 'packages/client/src/**/*.test.ts'],
  },
});
