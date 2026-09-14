import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Tests run against sources so no build step is needed first.
    alias: {
      '@rich-editor/core': resolveFromRoot('packages/editor-core/src/index.ts'),
      '@rich-editor/vue': resolveFromRoot('packages/editor-vue/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['packages/*/tests/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // MathJax's first render compiles its font data, which is slow under jsdom.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,vue}'],
      exclude: ['packages/*/src/**/*.d.ts'],
    },
  },
});
