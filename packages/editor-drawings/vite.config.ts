import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      // Два входа, как у ядра: возможность целиком и документная часть для
      // вьюера. Общие модули (парсер, рендер) Rollup выносит в chunks/.
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        viewer: resolve(import.meta.dirname, 'src/viewer.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'styles',
    },
    rollupOptions: {
      // Ядро и TipTap разрешает хост: в бандле только код пакета.
      external: [/^@rich-editor\/core/, /^@tiptap\//],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
