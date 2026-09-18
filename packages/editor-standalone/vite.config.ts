import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const core = (path: string) => resolve(import.meta.dirname, '../editor-core', path);

/**
 * Автономная сборка: все зависимости внутри.
 *
 * `@rich-editor/core` собирается библиотекой и оставляет TipTap, MathJax,
 * MathLive и DOMPurify внешними — их ставит хост с бандлером. Хосту без
 * бандлера (Django-шаблон, статика на CDN) нужен готовый набор файлов:
 * `<script type="module" src="editor.js">` и всё. Формат — ES-модули с
 * чанками, а не один IIFE: так MathLive и MathJax остаются ленивыми и
 * грузятся только при первой формуле, как в обычной сборке.
 *
 * Ядро берётся из исходников, а не из его dist: собранный `index.js` — один
 * модуль, и Rollup положил бы его целиком в общий чанк, а вьюер получил бы
 * ProseMirror, который ему не нужен. По исходникам чанки делятся честно.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@rich-editor/core/styles.css', replacement: core('src/styles.css') },
      { find: '@rich-editor/core', replacement: core('src/index.ts') },
    ],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: {
        editor: resolve(import.meta.dirname, 'src/editor.ts'),
        viewer: resolve(import.meta.dirname, 'src/viewer.ts'),
      },
      formats: ['es'],
      // Один styles.css на оба входа: вьюер и редактор рисуют документ одними
      // стилями.
      cssFileName: 'styles',
    },
    rollupOptions: {
      output: {
        // Имена чанков стабильны по содержимому: хеш меняется только с кодом,
        // и кэш статики не сбрасывается на каждый релиз целиком.
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name].js',
      },
    },
  },
});
