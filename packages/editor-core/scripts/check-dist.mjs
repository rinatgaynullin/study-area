import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Сторож dist: вход вьюера не тянет редактор, стили лежат там, где обещано.
 *
 * - до чего дотягивается dist/viewer.js, не импортирует TipTap, ProseMirror
 *   и MathLive;
 * - dist/index.js импортирует mathlive/fonts.css, а dist/styles.css несёт
 *   compat-слой — хосту нечего подключать руками;
 * - dist/viewer.css несёт документ и compat-слой, но не интерфейс и не шрифты.
 */
const dist = resolve(import.meta.dirname, '../dist');
const FORBIDDEN = [/^@tiptap\//, /^prosemirror/, /^mathlive/];
const visited = new Set();
const problems = [];

const walk = (file) => {
  if (visited.has(file)) return;

  visited.add(file);

  const source = readFileSync(file, 'utf8');
  const specifiers = [...source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]);

  for (const specifier of specifiers) {
    if (FORBIDDEN.some((pattern) => pattern.test(specifier))) {
      problems.push(`${file.slice(dist.length + 1)} импортирует ${specifier}`);
    }

    if (specifier.startsWith('.')) walk(resolve(dirname(file), specifier));
  }
};

walk(resolve(dist, 'viewer.js'));

const styles = readFileSync(resolve(dist, 'styles.css'), 'utf8');
const viewer = readFileSync(resolve(dist, 'viewer.css'), 'utf8');

if (/@font-face/.test(styles)) problems.push('styles.css содержит заинлайненные шрифты');

const index = readFileSync(resolve(dist, 'index.js'), 'utf8');

if (!/import\s*["']mathlive\/fonts\.css["']/.test(index)) {
  problems.push('index.js не импортирует mathlive/fonts.css — хосту пришлось бы подключать шрифты руками');
}
if (!styles.includes('.rte-legacy')) problems.push('styles.css не содержит compat-слоя');
if (!viewer.includes('.rte-legacy')) problems.push('viewer.css не содержит compat-слоя');
if (viewer.includes('.rte-toolbar')) problems.push('viewer.css содержит стили тулбара');
if (viewer.includes('@font-face')) problems.push('viewer.css содержит шрифты');

if (problems.length > 0) {
  console.error(['dist не соответствует контракту:', ...problems.map((p) => `  - ${p}`)].join('\n'));
  process.exit(1);
}

console.log(`dist: вход вьюера (${visited.size} файлов) без редактора, импорт шрифтов и compat-слой на месте`);
