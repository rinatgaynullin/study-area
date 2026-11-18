import { expect, test, type Page } from '@playwright/test';

/**
 * Набранная функция на вкладке «Графики»: ученик сам пишет запись, график
 * строится по ней. Проверяется то, чего не видит jsdom: настоящий набор с
 * клавиатуры, ползунок параметра, вставка чертежа в документ и раскладка
 * блока «Функция» в колонке свойств и на телефоне.
 */
const EDITOR = '.rte-root .rte-content';
const OPEN_MODAL = '.rte-modal:not([hidden])';
const SKETCH = `${OPEN_MODAL} .rte-sketch`;
const DIALOG_TABS = `${OPEN_MODAL} .rte-drawing-dialog__tabs [role="tab"]`;
const PROPS = `${OPEN_MODAL} .rte-builder__props`;
const BLOCK = `${OPEN_MODAL} .rte-plots-fn`;
const FORMULA = `${BLOCK} .rte-plots-fn__formula[role="img"]`;
const FIELD = `${BLOCK} input[data-prop="expr"]`;
const DRAWING = `${EDITOR} [data-geometry-data]`;

async function openPlots(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(`${EDITOR} .rte-formula svg`, { timeout: 30_000 });
  await page.locator(`${EDITOR} p`).first().click();
  await page.locator('.rte-toolbar button[aria-label="Чертёж"]').click();
  await page.locator(DIALOG_TABS, { hasText: 'Графики' }).click();
  await expect(page.locator(`${DIALOG_TABS}[aria-selected="true"]`)).toHaveText('Графики');
}

/** Ломаные функций на полотне одной строкой: меняется, когда перерисован график. */
const curvePoints = (page: Page): Promise<string> =>
  page.locator(`${SKETCH} .rte-sketch__layer svg polyline`).evaluateAll((lines) => lines.map((line) => line.getAttribute('points') ?? '').join('|'));

/** «+ Функция» и набор записи с клавиатуры. */
async function typeFunction(page: Page, text: string): Promise<void> {
  await page.locator(`${OPEN_MODAL} button[data-plot-add="function"]`).click();
  await expect(page.locator(FIELD)).toBeFocused();
  await page.keyboard.type(text);
}

async function insertDrawing(page: Page): Promise<void> {
  const count = await page.locator(DRAWING).count();

  await page.locator(`${OPEN_MODAL} .rte-modal__footer`).getByRole('button', { name: 'Вставить', exact: true }).click();
  await expect(page.locator(OPEN_MODAL)).toHaveCount(0);
  await expect(page.locator(DRAWING)).toHaveCount(count + 1);
}

test('«+ Функция»: набранная запись строит график, правка меняет его, «Вставить» кладёт в документ сцену с expr', async ({ page }) => {
  await openPlots(page);
  await typeFunction(page, 'x^2 - 4');

  await expect(page.locator(FORMULA)).toHaveAttribute('aria-label', 'y = x² − 4');
  await expect(page.locator(FORMULA)).toHaveText('y = x2 − 4');

  const parabola = await curvePoints(page);

  expect(parabola).not.toBe('');

  await page.locator(FIELD).fill('sin(x)');
  await expect(page.locator(FORMULA)).toHaveAttribute('aria-label', 'y = sin(x)');
  await expect.poll(() => curvePoints(page)).not.toBe(parabola);
  await page.keyboard.press('Enter');
  await insertDrawing(page);

  const scene = JSON.parse((await page.locator(DRAWING).last().getAttribute('data-geometry-data')) ?? '{}') as { plots?: Array<Record<string, unknown>> };

  expect(scene.plots?.length).toBeGreaterThan(0);
  scene.plots?.forEach((plot) => expect(plot).toMatchObject({ type: 'freehand', expr: 'sin(x)' }));
});

test('функция x^2 - 4 в документе: кривая в картинке целиком, оси на месте', async ({ page }) => {
  await openPlots(page);
  await typeFunction(page, 'x^2 - 4');
  await page.keyboard.press('Enter');
  await insertDrawing(page);

  const view = await page
    .locator(DRAWING)
    .last()
    .locator('svg')
    .first()
    .evaluate((root) => {
      const box = root.viewBox.baseVal;
      const curve = root.querySelector('polyline');
      const points = (curve?.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',').map(Number));
      const xs = points.map(([x]) => x ?? NaN);
      const ys = points.map(([, y]) => y ?? NaN);

      return { width: box.width, height: box.height, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), axes: root.querySelectorAll('line').length };
    });

  expect(view.minX).toBeGreaterThanOrEqual(0);
  expect(view.maxX).toBeLessThanOrEqual(view.width);
  expect(view.minY).toBeGreaterThanOrEqual(0);
  expect(view.maxY).toBeLessThanOrEqual(view.height);
  expect(view.axes).toBeGreaterThan(1);
});

test('неправильная запись x^ показывает ошибку, прежний график на месте', async ({ page }) => {
  await openPlots(page);
  await typeFunction(page, 'x^2');

  const before = await curvePoints(page);

  await page.keyboard.press('Backspace');
  await expect(page.locator(`${BLOCK} .rte-plots-fn__error`)).toHaveText('Здесь должно быть число или x');
  await expect(page.locator(FIELD)).toHaveAttribute('aria-invalid', 'true');
  expect(await curvePoints(page)).toBe(before);
  await expect(page.locator(FORMULA)).toHaveAttribute('aria-label', 'y = x²');
});

test('запись a*x^2 даёт ползунок a; сдвиг ползунка клавишей меняет график', async ({ page }) => {
  await openPlots(page);
  await typeFunction(page, 'a*x^2');
  await page.keyboard.press('Enter');

  const slider = page.locator(`${BLOCK} input[type="range"][data-prop="a"]`);

  await expect(slider).toBeVisible();

  const before = await curvePoints(page);

  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => curvePoints(page)).not.toBe(before);
  await expect(page.locator(`${BLOCK} input[type="number"][data-prop="a"]`)).toHaveValue('1.1');
  // Карточка показывает букву, а не значение.
  await expect(page.locator(FORMULA)).toHaveAttribute('aria-label', 'y = ax²');
});

test('кнопки-подсказки вставляют знак в поле и не уводят из него фокус', async ({ page }) => {
  await openPlots(page);
  await typeFunction(page, '2');
  await page.locator(`${BLOCK} .rte-plots-fn__keys button[data-key="sin"]`).click();
  await expect(page.locator(FIELD)).toBeFocused();
  await page.keyboard.type('x');
  await expect(page.locator(FIELD)).toHaveValue('2sin(x)');
  await expect(page.locator(FORMULA)).toHaveAttribute('aria-label', 'y = 2sin(x)');
});

test('карточка, поле и кнопки-подсказки видны без прокрутки; на телефоне блок без горизонтальной прокрутки', async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 720 });

  await openPlots(page);
  await typeFunction(page, 'a*sin(b*x)');

  const layout = await page.locator(PROPS).evaluate((props) => {
    const box = props.getBoundingClientRect();
    const inside = (selector: string): boolean => {
      const rect = props.querySelector(selector)?.getBoundingClientRect();

      return rect !== undefined && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
    };
    const block = props.querySelector('.rte-plots-fn');
    const keys = [...props.querySelectorAll<HTMLElement>('.rte-plots-fn__key')].map((key) => key.getBoundingClientRect());

    return {
      formula: inside('.rte-plots-fn__formula'),
      field: inside('.rte-plots-fn__input'),
      keys: inside('.rte-plots-fn__keys'),
      scrollTop: props.scrollTop,
      props: { scrollWidth: props.scrollWidth, clientWidth: props.clientWidth },
      block: { scrollWidth: block?.scrollWidth ?? 0, clientWidth: block?.clientWidth ?? 0 },
      keyHeights: keys.map((key) => key.height),
      keyRows: new Set(keys.map((key) => Math.round(key.top))).size,
    };
  });

  expect(layout.props.scrollWidth).toBeLessThanOrEqual(layout.props.clientWidth);
  expect(layout.block.scrollWidth).toBeLessThanOrEqual(layout.block.clientWidth);
  layout.keyHeights.forEach((height) => expect(height).toBeGreaterThanOrEqual(40));
  expect(layout.keyRows).toBeLessThanOrEqual(2);

  if (isMobile) return;

  expect(layout.scrollTop).toBe(0);
  expect(layout.formula).toBe(true);
  expect(layout.field).toBe(true);
  expect(layout.keys).toBe(true);
});
