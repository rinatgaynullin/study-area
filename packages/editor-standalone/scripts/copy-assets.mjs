import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

/**
 * Докладывает в dist то, что сборщик не тащит сам: compat-слой для разметки
 * Froala (его никто не импортирует из точек входа — хост без старых данных
 * не должен его скачивать) и шрифты MathLive. Шрифты нужны рядом со
 * сборкой: `editor.js` по умолчанию показывает MathLive на соседний
 * каталог `fonts/`.
 */
const here = dirname(new URL(import.meta.url).pathname);
const dist = resolve(here, '../dist');
const core = resolve(here, '../../editor-core');
const require = createRequire(import.meta.url);
const mathliveFonts = resolve(dirname(require.resolve('mathlive')), 'fonts');

mkdirSync(resolve(dist, 'fonts'), { recursive: true });

const files = [
  [resolve(core, 'src/legacy.css'), resolve(dist, 'legacy.css')],
  ...readdirSync(mathliveFonts).map((name) => [
    resolve(mathliveFonts, name),
    resolve(dist, 'fonts', name),
  ]),
];

for (const [from, to] of files) copyFileSync(from, to);
console.log(`standalone: ${files.length} files copied to dist (legacy.css, ${files.length - 1} fonts)`);
