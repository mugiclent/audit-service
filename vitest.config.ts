import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 70 },
      exclude: [
        'src/loaders/**',
        'src/config/**',
        'src/index.ts',
        'src/models/index.ts',
        'src/types/**',
        'prisma/**',
        '*.config.ts',
        '*.config.mjs',
      ],
    },
  },
});
