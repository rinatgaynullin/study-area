import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      // Два входа: редактор целиком и вьюер без него. Общие модули Rollup
      // выносит в chunks/, поэтому вьюер не тянет TipTap.
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        viewer: resolve(import.meta.dirname, 'src/viewer.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      // Один styles.css на оба входа; viewer.css кладёт copy-css.mjs.
      cssFileName: 'styles',
    },
    rollupOptions: {
      // Everything the host resolves itself stays external so the bundle holds
      // only this package's own code.
      external: [
        /^@tiptap\//,
        /^@mathjax\//,
        'dompurify',
        'mathlive',
        'mathlive/ssr',
        'mathml-to-latex',
      ],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
