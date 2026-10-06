import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Кладёт в dist пакетов те таблицы стилей, которые не должны попадать в общий
 * styles.css сборщика: compat-слой `legacy.css` (хост без старых данных его
 * не скачивает) и `viewer.css` — стили документа для входа `./viewer` без
 * интерфейса редактора. Файлы ничего не импортируют, поэтому их достаточно
 * скопировать, минуя сборщик. Источник один — пакет ядра: exports пакета не
 * умеют ссылаться за его пределы.
 *
 * Аргумент — `core`, `vue` или ничего (оба пакета).
 */
const root = resolve(import.meta.dirname, '..');
const sources = {
  'legacy.css': resolve(root, 'packages/editor-core/src/legacy.css'),
  'viewer.css': resolve(root, 'packages/editor-core/src/content.css'),
};
const packages = { core: 'packages/editor-core', vue: 'packages/editor-vue' };
const selected = process.argv[2] ? [process.argv[2]] : Object.keys(packages);

for (const name of selected) {
  const dir = packages[name];

  if (!dir) throw new Error(`Неизвестный пакет: ${name}`);

  for (const [file, source] of Object.entries(sources)) {
    const target = resolve(root, dir, 'dist', file);

    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    console.log(`${file} -> ${target.slice(root.length + 1)}`);
  }
}
