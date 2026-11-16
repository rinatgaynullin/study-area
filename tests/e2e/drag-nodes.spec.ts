import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Перенос блоков мышью внутри документа: чертежи, картинки, файлы и аудио.
 * Сам перенос делает ProseMirror — здесь проверяется, что ему ничего не мешает:
 * узел уезжает на новое место и не остаётся на старом, клик без переноса
 * по-прежнему открывает диалог, ручки картинки меняют размер, а не место.
 */
const EDITOR = '.rte-root .rte-content';
const OPEN_MODAL = '.rte-modal:not([hidden])';
const MODAL_TITLE = `${OPEN_MODAL} .rte-modal__title`;

/** Сцена первого чертежа образца — по ней чертёж узнаётся в HTML. */
const TRIANGLE_MARK = '&quot;C&quot;:[0,3]';

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(`${EDITOR} .rte-formula svg`, { timeout: 30_000 });
}

async function applySample(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Вставить HTML' }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Применить в редактор' }).click();
}

async function applyHtml(page: Page, html: string): Promise<void> {
  await page.getByRole('button', { name: 'Вставить HTML' }).click();
  await page.locator('.demo__textarea').fill(html);
  await page.getByRole('button', { name: 'Применить в редактор' }).click();
}

async function readSource(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Исходник' }).click();

  return page.locator('.demo__source').innerText();
}

/** Рамка элемента на экране; невидимый элемент — ошибка теста, а не `null`. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();

  if (!box) throw new Error(`Элемент не на экране: ${locator.toString()}`);

  return box;
}

/**
 * Перенос, как его делает рука: нажать, несколько промежуточных движений,
 * отпустить. Одного скачка Chromium не всегда хватает, чтобы начать
 * нативный drag-and-drop, — `dragTo` делает то же, но без шагов. Мышь не
 * прокручивает страницу, поэтому оба конца должны быть на экране сразу.
 */
async function drag(page: Page, from: Locator, to: Locator, target: { x: number; y: number }): Promise<void> {
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();

  const start = await boxOf(from);
  const end = await boxOf(to);

  expect(end.y, 'место вставки должно быть на экране').toBeGreaterThanOrEqual(0);

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 4, start.y + start.height / 2 + 4, { steps: 4 });
  await page.mouse.move(end.x + target.x, end.y + target.y, { steps: 12 });
  await page.mouse.up();
}

/** Подпись блоков верхнего уровня по порядку: тег и текст абзаца или вид узла. */
async function blockOrder(page: Page): Promise<string[]> {
  return page.locator(EDITOR).evaluate((root) =>
    Array.from(root.children).map((child) => {
      if (child.classList.contains('rte-drawing')) return 'drawing';

      if (child.querySelector('img.rte-image')) return child.tagName === 'P' ? `p+img:${child.textContent?.trim() ?? ''}` : 'img';

      if (child.classList.contains('rte-attachment')) return 'attachment';

      if (child.classList.contains('rte-audio')) return 'audio';

      return `${child.tagName.toLowerCase()}:${child.textContent?.trim() ?? ''}`;
    }),
  );
}

/** Картинка в PNG, нарисованная прямо в странице: внешние адреса тесту не нужны. */
async function pngFile(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');

    canvas.width = 160;
    canvas.height = 120;

    const context = canvas.getContext('2d');

    if (context) {
      context.fillStyle = '#3b82f6';
      context.fillRect(0, 0, 160, 120);
    }

    return canvas.toDataURL('image/png');
  });

  return { name: 'picture.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1] ?? '', 'base64') };
}

/** Вставляет картинку через скрытое поле файла, как кнопка тулбара. */
async function insertPicture(page: Page, after: Locator): Promise<Locator> {
  await after.click();
  await page.keyboard.press('End');
  // Поле с `multiple` — у распознавания фото, картинку вставляет другое.
  await page
    .locator('.rte-root input[type="file"][accept="image/*"]:not([multiple])')
    .setInputFiles(await pngFile(page));

  const image = page.locator(`${EDITOR} img.rte-image`);
  await expect(image).toHaveCount(1);
  await expect(image).toBeVisible();

  return image;
}

test.skip(({ isMobile }) => Boolean(isMobile), 'перенос мышью проверяется на десктопе');

test.describe('перенос чертежей', () => {
  test('чертёж переезжает под абзац ниже и не остаётся на старом месте', async ({ page }) => {
    await openDemo(page);
    await applySample(page, 'Чертежи PinQueen');

    const drawings = page.locator(`${EDITOR} .rte-drawing`);
    await expect(drawings).toHaveCount(4);

    const before = await blockOrder(page);
    const below = page.locator(`${EDITOR} > p`, { hasText: 'Пирамида' });

    expect(before.indexOf('drawing')).toBeLessThan(before.findIndex((block) => block.startsWith('p:Пирамида')));

    // Нижняя половина абзаца — место вставки после него.
    const box = await boxOf(below);
    await drag(page, drawings.first(), below, { x: box.width / 2, y: box.height * 0.8 });

    await expect(drawings).toHaveCount(4);
    await expect(page.locator(OPEN_MODAL)).toHaveCount(0);

    const after = await blockOrder(page);
    const paragraph = after.findIndex((block) => block.startsWith('p:Пирамида'));

    expect(after[paragraph + 1]).toBe('drawing');
    expect(after.slice(0, paragraph)).not.toContain('drawing');

    // Переехал именно треугольник, и он в документе один.
    const html = await readSource(page);
    expect(html.split(TRIANGLE_MARK)).toHaveLength(2);
    expect(html.indexOf(TRIANGLE_MARK)).toBeGreaterThan(html.indexOf('Пирамида'));
  });

  test('клик по чертежу без переноса открывает диалог', async ({ page }) => {
    await openDemo(page);
    await applySample(page, 'Чертежи PinQueen');

    const before = await blockOrder(page);

    await page.locator(`${EDITOR} .rte-drawing`).first().click();
    await expect(page.locator(MODAL_TITLE)).toHaveText('Изменить чертёж');
    expect(await blockOrder(page)).toEqual(before);
  });
});

test.describe('перенос картинки', () => {
  const PARAGRAPHS = '<p>первый</p><p>второй</p><p>третий</p>';

  test('картинка переезжает выше первого абзаца', async ({ page }) => {
    await openDemo(page);
    await applyHtml(page, PARAGRAPHS);

    const image = await insertPicture(page, page.locator(`${EDITOR} p`, { hasText: 'третий' }));

    expect(await blockOrder(page)).toEqual(['p:первый', 'p:второй', 'p:третий', 'img', 'p:']);

    // Начало строки: правее текста абзаца позиция была бы уже в его конце.
    const first = page.locator(`${EDITOR} p`, { hasText: 'первый' });
    await drag(page, image, first, { x: 2, y: 2 });

    await expect.poll(() => blockOrder(page)).toEqual(['img', 'p:первый', 'p:второй', 'p:третий', 'p:']);
    await expect(page.locator(`${EDITOR} img.rte-image`)).toHaveCount(1);
  });

  test('в legacy-режиме строчная картинка переезжает в начало первого абзаца', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('checkbox', { name: 'Legacy-контент (Froala)' }).check();
    await expect(page.locator(`${EDITOR}.rte-legacy`)).toHaveCount(1);
    await applyHtml(page, PARAGRAPHS);

    const image = await insertPicture(page, page.locator(`${EDITOR} p`, { hasText: 'третий' }));

    expect(await blockOrder(page)).toEqual(['p:первый', 'p:второй', 'p+img:третий']);

    const first = page.locator(`${EDITOR} p`, { hasText: 'первый' });
    const box = await boxOf(first);
    await drag(page, image, first, { x: 1, y: box.height / 2 });

    await expect.poll(() => blockOrder(page)).toEqual(['p+img:первый', 'p:второй', 'p:третий']);
    await expect(page.locator(`${EDITOR} img.rte-image`)).toHaveCount(1);
  });

  test('ручка размера меняет ширину и не переносит картинку', async ({ page }) => {
    await openDemo(page);
    await applyHtml(page, PARAGRAPHS);

    const image = await insertPicture(page, page.locator(`${EDITOR} p`, { hasText: 'второй' }));
    const order = await blockOrder(page);
    const before = await boxOf(image);

    await image.click();

    const grip = await boxOf(page.locator(`${EDITOR} [data-resize-handle="bottom-right"]`));
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x - 60, grip.y - 45, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => Math.round((await boxOf(image)).width)).toBeLessThan(Math.round(before.width));
    expect(await blockOrder(page)).toEqual(order);
  });
});

test.describe('перенос файла и аудио', () => {
  const HTML =
    '<p>первый</p>'
    + '<div data-attachment="true" data-href="https://example.com/a.txt" data-name="a.txt"><a href="https://example.com/a.txt">a.txt</a></div>'
    + '<div data-audio="true" data-src="https://example.com/a.webm" class="rte-audio">'
    + '<audio controls="controls" preload="metadata" src="https://example.com/a.webm"></audio></div>'
    + '<p>второй</p>';

  test('вложение уезжает в конец документа, аудио — в начало', async ({ page }) => {
    await openDemo(page);
    await applyHtml(page, HTML);

    expect(await blockOrder(page)).toEqual(['p:первый', 'attachment', 'audio', 'p:второй']);

    const last = page.locator(`${EDITOR} p`, { hasText: 'второй' });
    const lastBox = await boxOf(last);
    await drag(page, page.locator(`${EDITOR} .rte-attachment__icon`), last, { x: lastBox.width / 2, y: lastBox.height - 2 });
    await expect.poll(() => blockOrder(page)).toEqual(['p:первый', 'audio', 'p:второй', 'attachment', 'p:']);

    const first = await boxOf(page.locator(`${EDITOR} p`, { hasText: 'первый' }));
    const audio = await boxOf(page.locator(`${EDITOR} .rte-audio`));

    // За край плеера, а не за кнопку: кнопка запускает воспроизведение.
    await page.mouse.move(audio.x + audio.width - 6, audio.y + audio.height / 2);
    await page.mouse.down();
    await page.mouse.move(audio.x + audio.width - 2, audio.y + audio.height / 2 + 4, { steps: 4 });
    await page.mouse.move(first.x + 2, first.y + 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => blockOrder(page)).toEqual(['audio', 'p:первый', 'p:второй', 'attachment', 'p:']);
  });
});
