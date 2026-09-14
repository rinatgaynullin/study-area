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
    },
  },
});
