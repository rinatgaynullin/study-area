import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // Ядро, химию и чертежи разрешает хост: в бандле только код пакета.
      external: [/^@rich-editor\//, /^@tiptap\//],
    },
  },
});
