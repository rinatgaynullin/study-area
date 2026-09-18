import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Кладёт автономную сборку редактора в static пакета.
 *
 * Python-пакет — способ доставить редактор туда, где нет npm: Django-проект
 * ставит колесо с приватного PyPI, и статика уже внутри. Поэтому dist
 * `@rich-editor/standalone` копируется сюда перед сборкой колеса. Карты
 * исходников не берём: колесо от них вдвое тяжелее, а хосту они не нужны.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../editor-standalone/dist');
const target = resolve(here, '../rich_editor/static/rich_editor');

if (!existsSync(resolve(source, 'editor.js'))) {
  console.error('Нет сборки @rich-editor/standalone: сначала `npm run build -w @rich-editor/standalone`.');
  process.exit(1);
}

const keep = new Set(['.gitignore', 'rich_editor.js', 'rich_editor_viewer.js']);
mkdirSync(target, { recursive: true });
for (const name of readdirSync(target)) {
  if (!keep.has(name)) rmSync(resolve(target, name), { recursive: true, force: true });
}

let copied = 0;
cpSync(source, target, {
  recursive: true,
  filter: (path) => {
    if (path.endsWith('.map')) return false;
    copied += 1;
    return true;
  },
});
console.log(`django-rich-editor: сборка скопирована в rich_editor/static/rich_editor (${copied} записей)`);
