import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'styles',
    },
    rollupOptions: {
      // JSXGraph остаётся внешней зависимостью: хост грузит его лениво.
      external: ['@rich-editor/core', 'jsxgraph', /^@tiptap\//],
    },
  },
});
