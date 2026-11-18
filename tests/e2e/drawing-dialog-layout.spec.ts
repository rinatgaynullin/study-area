import { expect, test, type Page } from '@playwright/test';

/**
 * Раскладка диалога «Чертёж»: окно на весь экран, полотно — главная часть.
 * Проверяется то, чего юнит-тесты не видят: настоящие размеры полотна,
 * отсутствие прокрутки тела на десктопе, полотно на первом экране телефона и
 * попадание клика в увеличенное CSS-ом полотно.
 */
const EDITOR = '.rte-root .rte-content';
const OPEN_MODAL = '.rte-modal:not([hidden])';
const SKETCH = `${OPEN_MODAL} .rte-sketch`;
/** Вкладки диалога; у физики свои вкладки разделов — тоже `role="tab"`. */
const DIALOG_TABS = `${OPEN_MODAL} .rte-drawing-dialog__tabs [role="tab"]`;

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(`${EDITOR} .rte-formula svg`, { timeout: 30_000 });
}

async function openDrawingDialog(page: Page, tab: string): Promise<void> {
  await page.locator(`${EDITOR} p`).first().click();
  await page.locator('.rte-toolbar button[aria-label="Чертёж"]').click();
  await page.locator(DIALOG_TABS, { hasText: tab }).click();
  await expect(page.locator(`${DIALOG_TABS}[aria-selected="true"]`)).toHaveText(tab);
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();

  if (!box) throw new Error(`Элемент ${selector} не виден`);

  return box;
}

test.describe('десктоп', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'раскладка с боковой колонкой — только на широком окне');

  test('полотно стереометрии крупное, целиком в окне, тело диалога не прокручивается', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Стереометрия');

    const viewport = page.viewportSize();
    const sketch = await boxOf(page, SKETCH);

    expect(viewport).not.toBeNull();
    expect(sketch.y).toBeGreaterThanOrEqual(0);
    expect(sketch.y + sketch.height).toBeLessThanOrEqual(viewport?.height ?? 0);
    expect(sketch.width).toBeGreaterThanOrEqual(600);

    const scroll = await page
      .locator(`${OPEN_MODAL} .rte-modal__body`)
      .evaluate((body) => ({ scrollHeight: body.scrollHeight, clientHeight: body.clientHeight }));

    expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight + 1);
  });

  test('на окне 1440×900 полотно планиметрии не меньше прежних 856×642', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');

    const sketch = await boxOf(page, SKETCH);

    expect(sketch.width).toBeGreaterThanOrEqual(852);
    expect(sketch.height).toBeGreaterThanOrEqual(639);
  });

  test('панель свойств — справа от полотна, в одной строке с ним', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Стереометрия');

    const sketch = await boxOf(page, SKETCH);
    const props = await boxOf(page, `${OPEN_MODAL} .rte-builder__props`);

    expect(props.x).toBeGreaterThanOrEqual(sketch.x + sketch.width);
    expect(props.y).toBeLessThan(sketch.y + sketch.height);
  });

  test('клик по увеличенному полотну ставит точку под указателем', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');
    await page.locator(`${OPEN_MODAL} button[data-tool="point"]`).click();

    const sketch = await boxOf(page, SKETCH);

    // Полотно больше логических 560×420 — значит, координаты пересчитываются.
    expect(sketch.width).toBeGreaterThan(560);

    const target = { x: sketch.x + sketch.width * 0.63, y: sketch.y + sketch.height * 0.37 };

    // Shift отключает прилипание к сетке: точка встаёт ровно туда, куда нажали.
    await page.keyboard.down('Shift');
    await page.mouse.click(target.x, target.y);
    await page.keyboard.up('Shift');

    const centers = await page.locator(`${SKETCH} .rte-sketch__layer svg circle`).evaluateAll((circles) =>
      circles.map((circle) => {
        const rect = circle.getBoundingClientRect();

        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }),
    );
    const nearest = Math.min(...centers.map((center) => Math.hypot(center.x - target.x, center.y - target.y)));

    expect(nearest).toBeLessThanOrEqual(3);
  });

  test('вкладка JSON и образцы — только с флажком демо', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');

    await expect(page.locator(`${OPEN_MODAL} [role="tab"]`)).toHaveText(['Планиметрия', 'Стереометрия', 'Графики', 'Физика']);
    await expect(page.locator(`${OPEN_MODAL} [data-tab="json"]`)).toHaveCount(0);
    await expect(page.locator(`${OPEN_MODAL} button[data-template]`)).toHaveCount(0);
    // Escape окно чертежа не закрывает — только «Отмена» и крестик.
    await page.locator(`${OPEN_MODAL} .rte-modal__footer button`, { hasText: 'Отмена' }).click();
    await expect(page.locator(OPEN_MODAL)).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'JSON в диалоге чертежа' }).check();
    await openDrawingDialog(page, 'Планиметрия');

    // Служебный блок свёрнут на конструкторе и раскрыт на вкладке JSON.
    const more = page.locator(`${OPEN_MODAL} details.rte-drawing-dialog__more`);

    await expect(more).not.toHaveAttribute('open');
    await page.locator(`${OPEN_MODAL} [data-tab="json"]`).click();
    await expect(more).toHaveAttribute('open');
    await expect(page.locator(`${OPEN_MODAL} button[data-template="triangle"]`)).toBeVisible();
  });
});

test.describe('черновики вкладок и значки', () => {
  test('рисунок «Планиметрии» переживает переход на «Стереометрию» и обратно', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');
    await page.locator(`${OPEN_MODAL} button[data-tool="point"]`).click();

    const sketch = await boxOf(page, SKETCH);

    await page.mouse.click(sketch.x + sketch.width * 0.3, sketch.y + sketch.height * 0.3);
    await page.mouse.click(sketch.x + sketch.width * 0.6, sketch.y + sketch.height * 0.6);

    const points = page.locator(`${SKETCH} .rte-sketch__layer svg circle`);
    const drawn = await points.count();

    expect(drawn).toBeGreaterThanOrEqual(2);

    await page.locator(DIALOG_TABS, { hasText: 'Стереометрия' }).click();
    await expect(page.locator(`${OPEN_MODAL} .rte-builder--stereometry`)).toBeVisible();
    await page.locator(DIALOG_TABS, { hasText: 'Планиметрия' }).click();
    await expect(page.locator(`${OPEN_MODAL} .rte-builder--planimetry`)).toBeVisible();
    await expect(points).toHaveCount(drawn);
  });

  test('кнопка «Добавить деление» не обрезана', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Физика');
    await page.locator(`${OPEN_MODAL} button[data-section="thermo"]`).click();
    await page.locator(`${OPEN_MODAL} button[data-element="thermo_axes"]`).click();

    const add = page.locator(`${OPEN_MODAL} button[data-add-tick="xTicks"]`);

    await add.scrollIntoViewIfNeeded();
    await expect(add).toBeVisible();
    await expect(add).toHaveText('+ Добавить деление');

    const size = await add.evaluate((button) => ({ scrollWidth: button.scrollWidth, clientWidth: button.clientWidth }));

    expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
  });

  test('в кнопках инструментов видны значки', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');

    const icons = page.locator(`${OPEN_MODAL} .rte-builder__tool svg`);

    expect(await icons.count()).toBeGreaterThan(10);

    const sizes = await icons.evaluateAll((svgs) =>
      svgs.map((svg) => {
        const rect = svg.getBoundingClientRect();

        return { width: rect.width, height: rect.height };
      }),
    );

    sizes.forEach((size) => {
      expect(size.width).toBe(20);
      expect(size.height).toBe(20);
    });
  });
});

test.describe('телефон', () => {
  test.skip(({ isMobile }) => !isMobile, 'первый экран телефона');

  test('полотно целиком на первом экране и начинается выше середины', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Стереометрия');

    const viewport = page.viewportSize();
    const sketch = await boxOf(page, SKETCH);
    const height = viewport?.height ?? 0;

    expect(sketch.y).toBeLessThanOrEqual(height * 0.45);
    expect(sketch.y + sketch.height).toBeLessThanOrEqual(height);
  });
});
