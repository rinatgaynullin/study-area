import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Кладёт compat-стили в dist обоих пакетов.
 *
 * Vite в режиме библиотеки собирает весь CSS, импортированный из точки входа,
 * в один `styles.css`. Compat-слой туда попасть не должен: хост без старых
 * данных не обязан его скачивать. Файл ничего не импортирует, поэтому его
 * достаточно скопировать, минуя сборщик.
 *
 * Источник один — пакет ядра. `@rich-editor/vue` отдаёт ту же копию, потому
 * что exports пакета не умеют ссылаться за его пределы.
 */
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'packages/editor-core/src/legacy.css');

const targets = [
  resolve(root, 'packages/editor-core/dist/legacy.css'),
  resolve(root, 'packages/editor-vue/dist/legacy.css'),
];

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`legacy.css -> ${target.slice(root.length + 1)}`);
}
