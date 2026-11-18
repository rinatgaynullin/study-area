import { expect, test, type Page } from '@playwright/test';

/**
 * Escape в окнах-конструкторах: окно не закрывается, начатое отменяется,
 * инструмент — снова «Выбрать». Закрывают окно только «Отмена» и крестик.
 * В браузере проверяется и то, чего jsdom не умеет: `change` поля свойств
 * при потере фокуса не применяет недописанное значение.
 */
const EDITOR = '.rte-root .rte-content';
const OPEN_MODAL = '.rte-modal:not([hidden])';
const MODAL_PANEL = `${OPEN_MODAL} .rte-modal__panel`;
const SKETCH = `${OPEN_MODAL} .rte-sketch`;
const DIALOG_TABS = `${OPEN_MODAL} .rte-drawing-dialog__tabs [role="tab"]`;
const PRESSED_TOOL = `${OPEN_MODAL} button[data-tool][aria-pressed="true"]`;

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

/** Точка полотна в долях его ширины и высоты, в координатах страницы. */
async function sketchPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator(SKETCH).boundingBox();

  if (!box) throw new Error('Полотно не видно');

  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

test.describe('окно чертежа', () => {
  test('«Отрезок» с одной точкой: Escape — окно видно, нажат «Выбрать»; второй Escape — тоже; «Отмена» закрывает', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');
    await page.locator(`${OPEN_MODAL} button[data-tool="segment"]`).click();

    const first = await sketchPoint(page, 0.3, 0.3);

    await page.mouse.click(first.x, first.y);
    // Черновик отрезка — кружок у первой точки в оверлее.
    await expect(page.locator(`${SKETCH} .rte-sketch__overlay circle`)).not.toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL_PANEL)).toBeVisible();
    await expect(page.locator(PRESSED_TOOL)).toHaveAttribute('data-tool', 'select');
    await expect(page.locator(`${SKETCH} .rte-sketch__overlay *`)).toHaveCount(0);
    await expect(page.locator(SKETCH)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL_PANEL)).toBeVisible();

    await page.locator(`${OPEN_MODAL} .rte-modal__footer button`, { hasText: 'Отмена' }).click();
    await expect(page.locator(MODAL_PANEL)).toHaveCount(0);
  });

  test('Escape в поле имени точки не переименовывает её, фокус уходит на полотно', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');
    await page.locator(`${OPEN_MODAL} button[data-tool="point"]`).click();

    const at = await sketchPoint(page, 0.3, 0.3);

    await page.mouse.click(at.x, at.y);
    await page.locator(`${OPEN_MODAL} button[data-tool="select"]`).click();
    await page.mouse.click(at.x, at.y);

    const name = page.locator(`${OPEN_MODAL} .rte-builder__props input[type="text"]`).first();

    await expect(name).toHaveValue('A');
    await name.fill('Q');
    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL_PANEL)).toBeVisible();
    await expect(page.locator(SKETCH)).toBeFocused();
    await expect(page.locator(`${OPEN_MODAL} .rte-builder__props input`)).toHaveCount(0);

    // Точку выбираем снова: имя прежнее.
    await page.mouse.click(at.x, at.y);
    await expect(page.locator(`${OPEN_MODAL} .rte-builder__props input[type="text"]`).first()).toHaveValue('A');
  });

  test('крестик закрывает окно', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Графики');
    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL_PANEL)).toBeVisible();
    await page.locator(`${OPEN_MODAL} .rte-modal__close`).click();
    await expect(page.locator(MODAL_PANEL)).toHaveCount(0);
  });
});

test.describe('окно структурной формулы', () => {
  // На телефоне кнопка уезжает в меню «ещё»; диалоги возможностей — на десктопе.
  test.skip(({ isMobile }) => Boolean(isMobile), 'диалоги возможностей проверяются на десктопе');

  test('Escape без выделения окно не закрывает', async ({ page }) => {
    await openDemo(page);
    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Структурная формула"]').click();
    await expect(page.locator(`${OPEN_MODAL} .rte-chem-builder__stage`)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL_PANEL)).toBeVisible();

    await page.locator(`${OPEN_MODAL} .rte-modal__footer button`, { hasText: 'Отмена' }).click();
    await expect(page.locator(MODAL_PANEL)).toHaveCount(0);
  });
});
