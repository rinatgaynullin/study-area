import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      // Два входа: пакет целиком и вьюер без редактора.
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        viewer: resolve(import.meta.dirname, 'src/viewer.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: ['vue', /^@rich-editor\/core/, /^@tiptap\//],
      output: { globals: { vue: 'Vue' }, chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
