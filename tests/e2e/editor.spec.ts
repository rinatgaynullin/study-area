import { expect, test, type Page } from '@playwright/test';

const EDITOR = '.rte-root .rte-content';
const FORMULA = `${EDITOR} .rte-formula`;

/*
 * Диалоги и поповеры ванильного интерфейса живут в DOM постоянно и скрываются
 * атрибутом `hidden`, а не пересоздаются на каждое открытие. Поэтому «диалог
 * открыт» проверяется по видимой модалке: сама по себе разметка есть всегда,
 * и на странице с редактором её несколько.
 */
const OPEN_MODAL = '.rte-modal:not([hidden])';
const MODAL_PANEL = `${OPEN_MODAL} .rte-modal__panel`;
const MODAL_TITLE = `${OPEN_MODAL} .rte-modal__title`;
const OPEN_POPOVER = '.rte-popover:not([hidden])';

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  // The sample document renders its formulas through MathJax on load.
  await page.waitForSelector(`${FORMULA} svg`, { timeout: 30_000 });
}

test.describe('document', () => {
  test('renders the sample document with formulas and a table', async ({ page }) => {
    await openDemo(page);

    await expect(page.locator(FORMULA)).toHaveCount(4);
    await expect(page.locator(`${FORMULA} svg`).first()).toBeVisible();
    await expect(page.locator(`${EDITOR} table`)).toHaveCount(1);
    await expect(page.locator(`${EDITOR} blockquote`)).toHaveCount(1);
  });

  test('exports self-contained HTML that keeps MathML and renders without the editor', async ({
    page,
  }) => {
    await openDemo(page);

    await page.getByRole('button', { name: 'Исходник' }).click();
    const source = await page.locator('.demo__source').innerText();

    expect(source).toContain('data-formula="true"');
    // MathML lives escaped inside the attribute — that is the storage contract.
    expect(source).toContain('data-mathml="&lt;math');
    expect(source).toContain('&lt;annotation encoding=&quot;application/x-tex&quot;&gt;');
    // The MathJax projection travels with the document.
    expect(source).toContain('<svg');

    await page.getByRole('button', { name: 'Экспортированный HTML (рендер)' }).click();
    await expect(page.locator('.demo__preview .rte-formula svg').first()).toBeVisible();
  });

  test('read-only viewer shows the document without editing affordances', async ({ page }) => {
    await openDemo(page);

    const viewer = page.locator('.demo__preview.rte-content-root');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.rte-formula svg')).toHaveCount(4);
    await expect(viewer.locator('table')).toHaveCount(1);

    // No toolbar and nothing editable inside the viewer.
    await expect(viewer.locator('.rte-toolbar')).toHaveCount(0);
    await expect(viewer.locator('[contenteditable="true"]')).toHaveCount(0);

    await viewer.locator('.rte-formula').first().click();
    await expect(page.locator(MODAL_PANEL)).toHaveCount(0);
  });
});

test.describe('pasting HTML into the editor', () => {
  async function applySample(page: Page, sample: string): Promise<void> {
    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page.getByRole('button', { name: sample }).click();
    await page.getByRole('button', { name: 'Применить в редактор' }).click();
    await expect(page.locator('.demo__input-report')).toBeVisible();
  }

  test('strips everything executable from hostile markup', async ({ page }) => {
    await openDemo(page);

    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await applySample(page, 'Небезопасный HTML');
    const html = await page.locator(EDITOR).innerHTML();

    expect(html).toContain('Безопасный текст остаётся');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<form|<input/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/annotation-xml/i);
    // Event handlers: match only a real attribute, so `contenteditable` does
    // not read as a false positive.
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);

    // A safe link survives, and gains the opener protection.
    expect(html).toContain('https://example.com');
    expect(html).toContain('noopener noreferrer');

    expect(dialogs, 'no payload should have executed').toEqual([]);
  });

  test('turns raw MathML into editable formulas', async ({ page }) => {
    await openDemo(page);
    await applySample(page, 'MathML из другого редактора');

    await expect(page.locator(`${FORMULA} svg`)).toHaveCount(3);
    await expect(page.locator(`${FORMULA}[data-formula-type="chem"]`)).toHaveCount(1);
    // The MathML must not leak into the document as text.
    await expect(page.locator(EDITOR)).not.toContainText('mfrac');

    await page.locator(FORMULA).first().click();
    await expect(page.locator(MODAL_PANEL)).toBeVisible();
  });

  test('applies arbitrary typed HTML', async ({ page }) => {
    await openDemo(page);

    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page.locator('.demo__textarea').fill('<h2>Заголовок</h2><p><strong>жирный</strong></p>');
    await page.getByRole('button', { name: 'Применить в редактор' }).click();

    await expect(page.locator(`${EDITOR} h2`)).toHaveText('Заголовок');
    await expect(page.locator(`${EDITOR} strong`)).toHaveText('жирный');
  });
});

test.describe('formula editing', () => {
  test('click opens the editor with the stored formula and saving updates it', async ({ page }) => {
    await openDemo(page);

    const formula = page.locator(FORMULA).first();
    const before = await formula.getAttribute('data-mathml');

    await formula.click();
    await expect(page.locator(MODAL_PANEL)).toBeVisible();

    const field = page.locator('math-field').first();
    await expect(field).toBeAttached();
    // The LaTeX comes back out of the stored MathML annotation.
    await expect.poll(() => field.evaluate((el: HTMLElement & { value: string }) => el.value)).toBe(
      'a^2+b^2=c^2',
    );

    await page.locator('.rte-formula-editor__category', { hasText: 'Дроби' }).click();
    await page.locator('.rte-formula-editor__template').first().click();
    await expect(page.locator('.rte-formula-editor__preview-box svg')).toBeVisible();

    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator(MODAL_PANEL)).toBeHidden();

    await expect
      .poll(() => page.locator(FORMULA).first().getAttribute('data-mathml'))
      .toContain('mfrac');
    expect(await page.locator(FORMULA).first().getAttribute('data-mathml')).not.toBe(before);
    await expect(page.locator(FORMULA)).toHaveCount(4);
  });

  test('keeps the virtual keyboard out and puts the menu in Russian', async ({ page }) => {
    await openDemo(page);

    await page.locator(FORMULA).first().click();
    const field = page.locator('math-field').first();
    await expect(field).toBeAttached();

    // The toggle lives in MathLive's shadow DOM; it is hidden via ::part, so
    // asking the browser for its computed style is the only honest check.
    await expect
      .poll(() =>
        field.evaluate((el) => {
          const toggle = el.shadowRoot?.querySelector('.ML__virtual-keyboard-toggle');
          return toggle ? getComputedStyle(toggle).display : 'missing';
        }),
      )
      .toBe('none');

    // Focusing the field must not summon the keyboard either.
    await field.click();
    await expect(page.locator('.ML__keyboard')).toHaveCount(0);

    // MathLive's own menu, not ours — it ships no Russian, so any Russian here
    // proves the merged string table is in use. Playwright's CSS engine pierces
    // the open shadow root, so the toggle is clicked like a user would.
    await page.locator('math-field .ML__menu-toggle').first().click();
    await expect(page.getByRole('menuitem', { name: 'Вставить матрицу' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Начертание' })).toBeVisible();
    // No English left at the top level of the menu.
    const items = await page.getByRole('menuitem').allTextContents();
    expect(items.length).toBeGreaterThan(5);
    expect(items.filter((item) => /^[A-Za-z]/.test(item.trim()))).toEqual([]);

    await page.keyboard.press('Escape');
  });

  test('inserts a new chemistry formula from the toolbar', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Химическая формула"]').click();

    await expect(page.locator(MODAL_TITLE)).toHaveText('Химическая формула');
    await page.locator('.rte-formula-editor__category', { hasText: 'Типовые формулы' }).click();
    await page.locator('.rte-formula-editor__template').first().click();

    // Exact: the demo also has a "Вставить HTML" tab, which this would match.
    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect(page.locator(MODAL_PANEL)).toBeHidden();

    await expect(page.locator(`${FORMULA}[data-formula-type="chem"]`)).toHaveCount(3);
  });

  test('deletes a formula only as a whole node', async ({ page }) => {
    await openDemo(page);

    await page.locator(FORMULA).first().click();
    await expect(page.locator(MODAL_PANEL)).toBeVisible();
    await page.getByRole('button', { name: 'Удалить формулу' }).click();

    await expect(page.locator(FORMULA)).toHaveCount(3);
    // No fragment of the removed formula is left behind as text.
    await expect(page.locator(EDITOR)).not.toContainText('mathml');
    await expect(page.locator(EDITOR)).not.toContainText('msup');
  });

  test('backspace removes the whole formula rather than eating into it', async ({ page }) => {
    await openDemo(page);

    await page.locator(FORMULA).nth(1).click();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.locator(MODAL_PANEL)).toBeHidden();
    // Фокус возвращается в документ в следующем кадре; Backspace раньше него
    // уйдёт в пустоту, и тест упадёт не по делу.
    await expect(page.locator(EDITOR)).toBeFocused();

    await page.keyboard.press('Backspace');

    await expect(page.locator(FORMULA)).toHaveCount(3);
    await expect(page.locator(EDITOR)).not.toContainText('<math');
  });
});

test.describe('toolbar', () => {
  test('applies formatting to the selection', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} h2`).first().click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.locator('.rte-toolbar button[aria-label="Полужирный"]').click();

    await page.getByRole('button', { name: 'Исходник' }).click();
    expect(await page.locator('.demo__source').innerText()).toContain('<strong>');
  });

  test('switches every label when the locale changes', async ({ page }) => {
    await openDemo(page);

    await expect(page.locator('.rte-toolbar button[aria-label="Полужирный"]')).toBeVisible();

    await page.selectOption('.demo__controls select', { label: 'English (messages.json)' });

    await expect(page.locator('.rte-toolbar button[aria-label="Bold"]')).toBeVisible();
    await expect(page.locator('.rte-toolbar button[aria-label="Voice message"]')).toBeVisible();

    await page.locator('.rte-toolbar button[aria-label="Math formula"]').click();
    await expect(page.locator(MODAL_TITLE)).toHaveText('Math formula');
    await expect(page.locator('.rte-formula-editor__category').first()).toHaveText('Basics');
  });
});

test.describe('тема', () => {
  test('проп theme переключает встроенную тёмную тему редактора и вьюера', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator('.rte-root')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await page.selectOption('.demo__controls select >> nth=2', 'dark');

    await expect(page.locator('.rte-root')).toHaveClass(/rte-theme-dark/);
    await expect(page.locator('.rte-root')).toHaveCSS('background-color', 'rgb(45, 44, 54)');
    await expect(page.locator('.rte-content-root').first()).toHaveCSS('color', 'rgb(235, 235, 240)');

    await page.selectOption('.demo__controls select >> nth=2', 'light');
    await expect(page.locator('.rte-root')).not.toHaveClass(/rte-theme-dark/);
  });
});

test.describe('responsive layout', () => {
  test('collapses secondary groups into the overflow menu when narrow', async ({ page }) => {
    await openDemo(page);
    await page.setViewportSize({ width: 420, height: 900 });

    const overflow = page.locator('.rte-toolbar button[aria-label="Ещё"]');
    await expect(overflow).toBeVisible();

    // Undo lives in a collapsible group, so it moves into the menu.
    await expect(page.locator('.rte-toolbar > .rte-toolbar__group button[aria-label="Отменить"]')).toHaveCount(0);

    await overflow.click();
    await expect(page.locator('.rte-dropdown__panel', { hasText: 'Отменить' })).toBeVisible();
  });

  test('keeps the editor usable at phone width', async ({ page }) => {
    await openDemo(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.locator(EDITOR)).toBeVisible();
    await expect(page.locator(`${FORMULA} svg`).first()).toBeVisible();

    const box = await page.locator('.rte-root').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
  });
});

test.describe('legacy-контент Froala', () => {
  async function applyLegacySample(page: import('@playwright/test').Page) {
    await openDemo(page);
    await page.getByRole('checkbox', { name: 'Legacy-контент (Froala)' }).check();
    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page.getByRole('button', { name: 'Legacy-контент Froala' }).click();
    await page.getByRole('button', { name: 'Применить в редактор' }).click();
    await expect(page.locator(`${EDITOR} table`)).toBeVisible();
  }

  test('формула Wiris становится формулой и не рвёт строку', async ({ page }) => {
    await applyLegacySample(page);

    // Картинка-заглушка Wiris заменена узлом формулы с восстановленным MathML.
    await expect(page.locator(`${EDITOR} img.Wirisformula`)).toHaveCount(0);
    const formula = page.locator(`${EDITOR} .rte-formula`).first();
    await expect(formula).toBeVisible();
    expect(await formula.getAttribute('data-mathml')).toContain('mfrac');

    // Текст до и после формулы остался одним абзацем.
    const paragraph = page.locator(`${EDITOR} p`).filter({ hasText: 'Решите уравнение' });
    await expect(paragraph).toHaveCount(1);
    await expect(paragraph).toContainText('при указанных условиях.');
  });

  test('один базовый токен управляет и новым, и legacy-контентом', async ({ page }) => {
    await applyLegacySample(page);

    const legacyCell = page.locator(`${EDITOR} table td`).first();
    const readBorder = () =>
      legacyCell.evaluate((cell) => getComputedStyle(cell).borderTopColor);

    const before = await readBorder();

    // Правка одного токена на корне темы.
    await page.evaluate(() => {
      document
        .querySelector('.rte-root, .rte-content-root')
        ?.setAttribute('style', '--rte-color-border: rgb(255, 0, 0)');
    });

    await expect.poll(readBorder).toBe('rgb(255, 0, 0)');
    expect(before).not.toBe('rgb(255, 0, 0)');
  });

  test('compat-стили не применяются с выключенным режимом', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator(`${EDITOR}.rte-legacy`)).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Legacy-контент (Froala)' }).check();
    await expect(page.locator(`${EDITOR}.rte-legacy`)).toHaveCount(1);
  });
});

test.describe('инлайновое оформление', () => {
  /** Снимает вид абзаца так, как его видит браузер. */
  async function readComputedLook(page: import('@playwright/test').Page) {
    return page.locator(`${EDITOR} p`).first().evaluate((paragraph) => {
      const sized = [...paragraph.querySelectorAll('span')].map(
        (span) => getComputedStyle(span).fontSize,
      );
      return { align: getComputedStyle(paragraph).textAlign, sized };
    });
  }

  async function applyInlineSample(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page.getByRole('button', { name: 'Инлайновое оформление' }).click();
    await page.getByRole('button', { name: 'Применить в редактор' }).click();
    await expect(page.locator('.demo__input-report')).toBeVisible();
  }

  test('кегль и выравнивание переживают редактор', async ({ page }) => {
    await openDemo(page);
    await applyInlineSample(page);

    const look = await readComputedLook(page);
    expect(look.align).toBe('center');
    // 72px, 30px и 96px из инлайновых стилей, а не базовый кегль.
    expect(look.sized).toContain('72px');
    expect(look.sized).toContain('30px');
    expect(look.sized).toContain('96px');
  });

  test('выглядит одинаково с legacy-режимом и без него', async ({ page }) => {
    await openDemo(page);
    await applyInlineSample(page);
    const asNew = await readComputedLook(page);

    await page.getByRole('checkbox', { name: 'Legacy-контент (Froala)' }).check();
    await applyInlineSample(page);
    const asLegacy = await readComputedLook(page);

    expect(asLegacy).toEqual(asNew);
  });
});

test.describe('compat-стили применяются в браузере', () => {
  /**
   * Проверяем вид через computed-стили, а не через пиксельный снимок.
   * Playwright 1.58 ставит сборку Chromium 1243, а в среде разработки может
   * стоять другая — baseline, снятый на одной сборке, разойдётся с CI из-за
   * растеризации шрифтов. Computed-стили от сборки не зависят и проверяют
   * ровно то, что задаёт compat-слой.
   */
  async function openLegacyViewer(page: import('@playwright/test').Page) {
    await openDemo(page);
    await page.getByRole('checkbox', { name: 'Legacy-контент (Froala)' }).check();
    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page.getByRole('button', { name: 'Legacy-контент Froala' }).click();
    await page.getByRole('button', { name: 'Применить в редактор' }).click();

    // Вьюер рендерит исходный HTML без ProseMirror — классы там доживают до
    // DOM, поэтому compat-стили проверяем именно на нём. Вкладка с экспортом
    // редактора для этого не годится: схема классы снимает.
    await page.getByRole('button', { name: 'Вьюер без редактора' }).click();
    const viewer = page.locator('.demo__preview--raw.rte-legacy');
    await expect(viewer).toBeVisible();
    return viewer;
  }

  const styleOf = (locator: import('@playwright/test').Locator, property: string) =>
    locator.evaluate(
      (element, name) => getComputedStyle(element).getPropertyValue(name),
      property,
    );

  test('раскладка и оформление картинок', async ({ page }) => {
    const viewer = await openLegacyViewer(page);

    // fr-dib блочная и по центру, fr-dii в строке — это и есть модель Froala.
    expect(await styleOf(viewer.locator('img.fr-dib').first(), 'display')).toBe('block');
    expect(await styleOf(viewer.locator('img.fr-dii').first(), 'display')).toBe('inline-block');

    // Скругление только у fr-rounded: собственное правило редактора скругляло
    // бы все картинки подряд.
    expect(await styleOf(viewer.locator('img.fr-rounded'), 'border-radius')).not.toBe('0px');
    expect(await styleOf(viewer.locator('img.fr-dib').first(), 'border-radius')).toBe('0px');

    expect(await styleOf(viewer.locator('img.fr-bordered'), 'border-top-style')).toBe('solid');
    expect(await styleOf(viewer.locator('img.fr-shadow'), 'box-shadow')).not.toBe('none');
  });

  test('таблицы, текстовые классы и подпись', async ({ page }) => {
    const viewer = await openLegacyViewer(page);

    expect(
      await styleOf(viewer.locator('table.fr-dashed-borders td').first(), 'border-top-style'),
    ).toBe('dashed');
    expect(await styleOf(viewer.locator('td.fr-thick'), 'border-top-width')).toBe('2px');
    expect(await styleOf(viewer.locator('td.fr-highlighted'), 'border-top-style')).toBe('double');

    expect(await styleOf(viewer.locator('.fr-text-uppercase'), 'text-transform')).toBe('uppercase');
    expect(await styleOf(viewer.locator('.fr-text-spaced'), 'letter-spacing')).toBe('1px');
    expect(await styleOf(viewer.locator('.fr-class-transparency'), 'opacity')).toBe('0.5');
    expect(await styleOf(viewer.locator('.fr-inner'), 'text-align')).toBe('center');
  });

  test('формулы не разрывают строку', async ({ page }) => {
    const viewer = await openLegacyViewer(page);

    // Формула Wiris стала узлом и стоит внутри абзаца с текстом.
    const paragraph = viewer.locator('p').filter({ hasText: 'Решите уравнение' });
    await expect(paragraph.locator('.rte-formula')).toHaveCount(1);
    await expect(paragraph).toContainText('при указанных условиях.');

    // Вывод MathJax внутри формулы остаётся инлайновым, несмотря на то что
    // preflight у хоста мог бы сделать svg блочным.
    expect(await styleOf(viewer.locator('.rte-formula svg').first(), 'display')).not.toBe('block');
  });
});

test.describe('изменение размера картинки', () => {
  const IMAGE = `${EDITOR} img`;

  async function insertImage(page: Page): Promise<void> {
    await openDemo(page);
    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page
      .locator('.demo__textarea')
      .fill('<p><img src="https://placehold.co/400x300/png" width="400" height="300"></p>');
    await page.getByRole('button', { name: 'Применить в редактор' }).click();
    await expect(page.locator(IMAGE)).toBeVisible();
    // На узком экране картинка уходит под сгиб, и координаты ручки оказываются
    // за пределами вьюпорта — живой пользователь тоже сперва доскроллит.
    await page.locator(IMAGE).first().scrollIntoViewIfNeeded();
  }

  test('показывает ручки по всем четырём углам', async ({ page }) => {
    await insertImage(page);

    const handles = page.locator(`${EDITOR} [data-resize-handle]`);
    await expect(handles).toHaveCount(4);
    expect(await handles.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-resize-handle')).sort(),
    )).toEqual(['bottom-left', 'bottom-right', 'top-left', 'top-right']);
  });

  test('перетаскивание меняет размер и сохраняет пропорции', async ({ page }) => {
    await insertImage(page);

    const image = page.locator(IMAGE).first();
    const before = await image.boundingBox();
    expect(before).not.toBeNull();

    const handle = page.locator(`${EDITOR} [data-resize-handle="bottom-right"]`);
    const grip = await handle.boundingBox();
    expect(grip).not.toBeNull();

    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x - 120, grip!.y - 90, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => Math.round((await image.boundingBox())!.width)).toBeLessThan(
      Math.round(before!.width),
    );

    const after = (await image.boundingBox())!;
    // Исходное отношение 4:3 должно сохраниться — допуск на округление пикселей.
    expect(Math.abs(after.width / after.height - before!.width / before!.height)).toBeLessThan(0.05);
  });

  test('новый размер попадает в экспортированный HTML', async ({ page }) => {
    await insertImage(page);

    const handle = page.locator(`${EDITOR} [data-resize-handle="bottom-right"]`);
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x - 120, grip.y - 90, { steps: 12 });
    await page.mouse.up();

    await page.getByRole('button', { name: 'Исходник' }).click();
    const source = await page.locator('.demo__source').innerText();
    const tag = /<img[^>]*>/.exec(source)?.[0] ?? '';

    expect(tag).toContain('width="');
    // Картинка уменьшилась, значит в разметке уже не исходные 400.
    expect(tag).not.toContain('width="400"');
  });
});

test.describe('поповер ссылки', () => {
  const POPOVER = `${OPEN_POPOVER} .rte-link-popover`;

  async function insertLink(page: Page): Promise<void> {
    await openDemo(page);
    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page
      .locator('.demo__textarea')
      .fill('<p>Смотри <a href="https://example.com">эту ссылку</a> внимательно.</p>');
    await page.getByRole('button', { name: 'Применить в редактор' }).click();
    await expect(page.locator(`${EDITOR} a`)).toBeVisible();
  }

  test('появляется по курсору внутри ссылки и не раньше', async ({ page }) => {
    await insertLink(page);
    await expect(page.locator(POPOVER)).toHaveCount(0);

    await page.locator(`${EDITOR} a`).first().click();
    await expect(page.locator(POPOVER)).toBeVisible();

    // Адрес и подпись подставлены из самой ссылки.
    const inputs = page.locator(`${POPOVER} input`);
    await expect(inputs.nth(0)).toHaveValue('https://example.com');
    await expect(inputs.nth(1)).toHaveValue('эту ссылку');
  });

  test('меняет подпись, заменяя её, а не дублируя', async ({ page }) => {
    await insertLink(page);
    await page.locator(`${EDITOR} a`).first().click();
    await expect(page.locator(POPOVER)).toBeVisible();

    await page.locator(`${POPOVER} input`).nth(1).fill('новая подпись');
    await page.locator(POPOVER).getByRole('button', { name: 'Применить' }).click();

    await expect(page.locator(`${EDITOR} a`)).toHaveText('новая подпись');
    // Старый текст не остался рядом с новым.
    await expect(page.locator(`${EDITOR} p`).first()).toHaveText(
      'Смотри новая подпись внимательно.',
    );
  });

  test('меняет адрес и оформление', async ({ page }) => {
    await insertLink(page);
    await page.locator(`${EDITOR} a`).first().click();
    await expect(page.locator(POPOVER)).toBeVisible();

    await page.locator(`${POPOVER} input`).nth(0).fill('https://umschool.net');
    await page.locator(`${POPOVER} select`).selectOption('rte-link--strong');
    await page.locator(POPOVER).getByRole('button', { name: 'Применить' }).click();

    const link = page.locator(`${EDITOR} a`).first();
    await expect(link).toHaveAttribute('href', 'https://umschool.net');
    await expect(link).toHaveClass(/rte-link--strong/);
  });

  test('удаляет ссылку, оставляя текст', async ({ page }) => {
    await insertLink(page);
    await page.locator(`${EDITOR} a`).first().click();
    await expect(page.locator(POPOVER)).toBeVisible();

    await page.locator(`${POPOVER} button[aria-label="Удалить ссылку"]`).click();

    await expect(page.locator(`${EDITOR} a`)).toHaveCount(0);
    await expect(page.locator(`${EDITOR} p`).first()).toContainText('эту ссылку');
  });

  test('закрывается по Escape', async ({ page }) => {
    await insertLink(page);
    await page.locator(`${EDITOR} a`).first().click();
    await expect(page.locator(POPOVER)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(POPOVER)).toHaveCount(0);
  });

  test('Escape из поля панели возвращает каретку в текст и не открывает панель заново', async ({
    page,
  }) => {
    await insertLink(page);
    await page.locator(`${EDITOR} a`).first().click();
    await expect(page.locator(POPOVER)).toBeVisible();
    await expect(page.locator(OPEN_POPOVER)).toHaveAttribute('aria-label', 'Ссылка');

    await page.locator(`${POPOVER} input`).nth(0).click();
    await page.keyboard.press('Escape');
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(page.locator(EDITOR)).toBeFocused();

    // Каретка всё ещё в ссылке, но Escape что-то значит: набор текста в ней
    // панель не возвращает. Вернётся, когда каретка выйдет и зайдёт снова.
    await page.keyboard.type('ё');
    await expect(page.locator(POPOVER)).toHaveCount(0);

    await page.locator(`${EDITOR} p`).first().click({ position: { x: 4, y: 8 } });
    await page.locator(`${EDITOR} a`).first().click();
    await expect(page.locator(POPOVER)).toBeVisible();
  });
});

test.describe('размер формулы не зависит от окружения', () => {
  const FORMULA_MATHML =
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';

  test('одна формула одинакова в абзаце, в ячейке и в заголовке', async ({ page }) => {
    await openDemo(page);

    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page.locator('.demo__textarea').fill(
      `<p>абзац ${FORMULA_MATHML}</p>` +
        `<table><tbody><tr><td>ячейка ${FORMULA_MATHML}</td></tr></tbody></table>` +
        `<h1>заголовок ${FORMULA_MATHML}</h1>`,
    );
    await page.getByRole('button', { name: 'Применить в редактор' }).click();

    const svgs = page.locator(`${EDITOR} .rte-formula svg`);
    await expect(svgs).toHaveCount(3);

    const widths = await svgs.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().width * 10) / 10),
    );

    // Заголовок вдвое крупнее абзаца; до правки формула в нём была почти вдвое
    // шире, потому что браузерный ex считается от унаследованного кегля.
    expect(new Set(widths).size, `ширины разошлись: ${widths.join(', ')}`).toBe(1);
  });

  test('размер запечён в пикселях, а не в ex', async ({ page }) => {
    await openDemo(page);

    const svg = page.locator(`${EDITOR} .rte-formula svg`).first();
    const width = await svg.getAttribute('width');

    expect(width).toMatch(/px$/);
    expect(width).not.toMatch(/ex$/);
  });
});

test.describe('превью шаблонов формул', () => {
  const TEMPLATE = '.rte-formula-editor__template';

  async function openFormulaDialog(page: Page): Promise<void> {
    await page.locator('.rte-toolbar button[aria-label="Математическая формула"]').click();
    await page.locator(TEMPLATE).first().waitFor();
  }

  /** Сколько кнопок шаблонов показывают заглушку вместо формулы. */
  async function countPlaceholders(page: Page): Promise<number> {
    return page
      .locator('.rte-formula-editor__template-preview')
      .evaluateAll((elements) =>
        elements.filter((element) => element.textContent?.trim() === '…').length,
      );
  }

  test('отрисовываются при первом открытии', async ({ page }) => {
    await openDemo(page);
    await openFormulaDialog(page);

    await expect.poll(() => countPlaceholders(page)).toBe(0);
    await expect(page.locator(`${TEMPLATE} svg`).first()).toBeVisible();
  });

  test('остаются отрисованными при повторном открытии', async ({ page }) => {
    await openDemo(page);

    await openFormulaDialog(page);
    await expect.poll(() => countPlaceholders(page)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL_PANEL)).toBeHidden();

    // Раньше здесь все кнопки показывали «…»: кэш превью очищался при открытии,
    // а watcher категории не срабатывал, потому что значение не менялось.
    await openFormulaDialog(page);
    await expect.poll(() => countPlaceholders(page)).toBe(0);
  });

  test('переживают переключение вкладок', async ({ page }) => {
    await openDemo(page);
    await openFormulaDialog(page);

    await page.locator('.rte-formula-editor__tab', { hasText: 'Химия' }).click();
    await expect.poll(() => countPlaceholders(page)).toBe(0);

    await page.locator('.rte-formula-editor__tab', { hasText: 'Математика' }).click();
    await expect.poll(() => countPlaceholders(page)).toBe(0);
  });
});

/*
 * Модалка на телефоне: экран короткий, страница под оверлеем длинная. Диалог
 * должен целиком помещаться в видимую область, тело — прокручиваться внутри,
 * а страница под оверлеем — стоять на месте.
 */
test.describe('модалка на телефоне', () => {
  test.use({ viewport: { width: 440, height: 600 }, hasTouch: true, isMobile: true });

  test('редактор формул помещается на экран, прокручивается сам, а не страница', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await openDemo(page);
    await page.locator('.rte-toolbar button[aria-label="Математическая формула"]').first().click();
    const dialog = page.locator('.rte-modal:not([hidden])');
    await expect(dialog.locator('math-field')).toBeVisible({ timeout: 20000 });
    // Playwright сам подтягивает страницу к кнопке перед кликом, если та под
    // сгибом (зависит от шрифтов машины) — отсчёт ведём от положения после
    // открытия, а не от нуля.
    const pageScrollY = await page.evaluate(() => window.scrollY);

    const footer = dialog.locator('.rte-modal__footer');
    const viewportHeight = page.viewportSize()!.height;
    const footerBox = (await footer.boundingBox())!;
    expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(viewportHeight);

    const body = dialog.locator('.rte-modal__body');
    const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeGreaterThan(0);

    // Колесо над телом прокручивает тело, страница под оверлеем стоит.
    const box = (await body.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollY);

    // Колесо над подложкой не уходит на страницу.
    await page.mouse.move(220, 20);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollY);

    // Закрытие возвращает фокус в документ без ошибок: на мобильном UA
    // `commands.focus()` TipTap роняла «Applying a mismatched transaction».
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator(EDITOR)).toBeFocused();
    expect(pageErrors).toEqual([]);
  });
});
