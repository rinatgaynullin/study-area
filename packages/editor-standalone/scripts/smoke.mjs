import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/**
 * Дымовая проверка автономной сборки в настоящем браузере.
 *
 * Юнит-тесты ядра не отвечают на вопрос, который важен хосту без бандлера:
 * поднимается ли редактор одним `<script type="module">`, доезжают ли ленивые
 * чанки MathLive и MathJax относительными импортами, находит ли MathLive
 * шрифты в соседнем каталоге. Здесь dist раздаётся как статика — так, как её
 * отдаст Django или CDN, — и проверяется именно это.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(here, '../dist');

const MIME = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.html': 'text/html; charset=utf-8',
};

const FORMULA_MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';

const PAGE = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/dist/styles.css" />
  </head>
  <body>
    <div id="editor"></div>
    <div id="viewer"></div>
    <script type="module">
      import { createRichEditor } from '/dist/editor.js';
      import { createRichContent } from '/dist/viewer.js';

      window.editor = createRichEditor({
        element: document.querySelector('#editor'),
        content: '<p>Собран без бандлера.</p>',
      });
      createRichContent({
        element: document.querySelector('#viewer'),
        html: '<p>Дробь: <span data-formula="true" data-mathml="${FORMULA_MATHML.replace(/"/g, '&quot;')}"></span></p>',
        onRendered: () => {
          window.viewerRendered = true;
        },
      });
    </script>
  </body>
</html>`;

function serve() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': MIME['.html'] });
      response.end(PAGE);
      return;
    }
    if (!url.pathname.startsWith('/dist/')) {
      response.writeHead(404);
      response.end();
      return;
    }
    const path = join(dist, normalize(url.pathname.slice('/dist/'.length)));
    try {
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

const server = await serve();
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

const problems = [];
const requested = new Set();
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
page.on('response', (response) => {
  requested.add(response.url().slice(origin.length));
  if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
});

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) problems.push(`check failed: ${name} ${detail}`);
}

try {
  await page.goto(origin);
  await page.waitForSelector('.rte-toolbar button', { timeout: 15_000 });
  const buttons = await page.locator('.rte-toolbar button').count();
  check('редактор смонтирован одним module-скриптом', buttons > 10, `кнопок: ${buttons}`);

  await page.locator('.rte-toolbar button[aria-label="Математическая формула"]').click();
  await page.waitForSelector('.rte-modal:not([hidden]) math-field', { timeout: 20_000 });
  check('ленивый чанк MathLive доехал относительным импортом', true);

  // MathLive объявляет шрифты через @font-face по fontsDirectory; лицо со
  // статусом loaded означает, что каталог рядом со сборкой найден.
  await page.waitForFunction(
    () => [...document.fonts].some((face) => face.family.includes('KaTeX') && face.status === 'loaded'),
    null,
    { timeout: 20_000 },
  );
  const fontRequests = [...requested].filter((path) => path.startsWith('/dist/fonts/'));
  check('шрифты MathLive взяты из dist/fonts', fontRequests.length > 0, fontRequests.join(', '));

  await page.waitForFunction(() => window.viewerRendered === true, null, { timeout: 20_000 });
  const svg = await page.locator('#viewer span[data-formula] svg').count();
  check('вьюер дорисовал формулу через ленивый MathJax', svg === 1, `svg: ${svg}`);

  const chunks = [...requested].filter((path) => path.startsWith('/dist/chunks/'));
  check('чанки грузятся из dist/chunks', chunks.length > 0, `${chunks.length} чанков`);
} catch (error) {
  problems.push(`smoke: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
  server.close();
}

for (const item of checks) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
if (problems.length > 0) {
  console.error('\nПроблемы:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('\nstandalone smoke: всё на месте');
