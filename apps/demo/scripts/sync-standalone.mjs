import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Кладёт автономную сборку в public/standalone, чтобы страница
 * standalone.html показывала ровно то, что получит хост без бандлера:
 * dist как статику, без участия Vite. Сборка запускается каждый раз — она
 * занимает секунду, а устаревший dist показал бы не то, что в исходниках.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const dist = resolve(root, 'packages/editor-standalone/dist');
const target = resolve(here, '../public/standalone');

execSync('npm run -s build -w @rich-editor/standalone', { cwd: root, stdio: 'inherit' });

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true, filter: (path) => !path.endsWith('.map') });
console.log('demo: сборка standalone скопирована в public/standalone');
