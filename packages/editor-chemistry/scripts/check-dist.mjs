import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Сторож dist: вход вьюера не тянет редактор.
 *
 * До чего дотягивается dist/viewer.js, не импортирует TipTap, ProseMirror и
 * главный вход ядра — только `@rich-editor/core/viewer`. Иначе страница
 * чтения с химией получила бы весь редактор.
 */
const dist = resolve(import.meta.dirname, '../dist');
const FORBIDDEN = [/^@tiptap\//, /^prosemirror/, /^@rich-editor\/core$/];
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

if (problems.length > 0) {
  console.error(['dist не соответствует контракту:', ...problems.map((p) => `  - ${p}`)].join('\n'));
  process.exit(1);
}

console.log(`dist: вход вьюера химии (${visited.size} файлов) без редактора`);
