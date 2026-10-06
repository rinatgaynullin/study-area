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
        // Шрифты: импорт остаётся в index.js как есть, файлы выдаёт бандлер
        // хоста. В режиме библиотеки Vite иначе заинлайнил бы их в CSS base64.
        'mathlive/fonts.css',
        'mathml-to-latex',
      ],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
