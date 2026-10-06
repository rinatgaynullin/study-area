import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const coreSrc = resolve(root, 'packages/editor-core/src');
/** Что кладём: имя файла в dist → содержимое. */
const sources = {
  'legacy.css': () => readFileSync(resolve(coreSrc, 'legacy.css'), 'utf8'),
  // Вьюеру нужны документ, токены темы и compat-слой — без интерфейса редактора.
  'viewer.css': () =>
    [readFileSync(resolve(coreSrc, 'content.css'), 'utf8'), readFileSync(resolve(coreSrc, 'legacy.css'), 'utf8')].join('\n'),
};
const packages = { core: 'packages/editor-core', vue: 'packages/editor-vue' };
const selected = process.argv[2] ? [process.argv[2]] : Object.keys(packages);

for (const name of selected) {
  const dir = packages[name];

  if (!dir) throw new Error(`Неизвестный пакет: ${name}`);

  for (const [file, read] of Object.entries(sources)) {
    const target = resolve(root, dir, 'dist', file);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, read());
    console.log(`${file} -> ${target.slice(root.length + 1)}`);
  }
}
