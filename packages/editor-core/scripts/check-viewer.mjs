import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Сторож входа вьюера: ни один модуль, до которого дотягивается
 * dist/viewer.js, не должен импортировать редактор (TipTap, ProseMirror,
 * MathLive), а dist/viewer.css — содержать стили интерфейса.
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

const css = readFileSync(resolve(dist, 'viewer.css'), 'utf8');

if (css.includes('.rte-toolbar')) problems.push('viewer.css содержит стили тулбара');

if (problems.length > 0) {
  console.error(['Вход вьюера тянет редактор:', ...problems.map((p) => `  - ${p}`)].join('\n'));
  process.exit(1);
}

console.log(`viewer entry: ${visited.size} файлов без TipTap, MathLive и стилей редактора`);
