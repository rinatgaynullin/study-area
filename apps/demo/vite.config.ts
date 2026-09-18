import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // GitHub Pages serves a project site from a subpath, so the built asset URLs
  // need that prefix. Unset everywhere else, which keeps `npm run dev` and the
  // Playwright suite on `/`.
  base: process.env.DEMO_BASE || '/',
  plugins: [vue()],
  build: {
    // Три страницы — три сборки редактора: Vue, ванильная и автономная. Без
    // явного списка в dist попадает только index.html.
    rollupOptions: {
      input: {
        index: page('index.html'),
        vanilla: page('vanilla.html'),
        standalone: page('standalone.html'),
      },
    },
  },
  resolve: {
    // The demo runs against package sources so changes hot-reload without a
    // build. Subpath entries come first: alias matching is order-sensitive.
    alias: [
      {
        find: '@rich-editor/core/styles.css',
        replacement: fromRoot('../../packages/editor-core/src/styles.css'),
      },
      {
        find: '@rich-editor/vue/legacy.css',
        replacement: fromRoot('../../packages/editor-core/src/legacy.css'),
      },
      {
        find: '@rich-editor/core/legacy.css',
        replacement: fromRoot('../../packages/editor-core/src/legacy.css'),
      },
      {
        find: '@rich-editor/vue/styles.css',
        replacement: fromRoot('../../packages/editor-vue/src/styles/index.css'),
      },
      {
        find: '@rich-editor/core/styles.css',
        replacement: fromRoot('../../packages/editor-core/src/styles.css'),
      },
      {
        find: '@rich-editor/vue',
        replacement: fromRoot('../../packages/editor-vue/src/index.ts'),
      },
      {
        find: '@rich-editor/core',
        replacement: fromRoot('../../packages/editor-core/src/index.ts'),
      },
    ],
  },
  server: { host: true, port: 5173 },
});
