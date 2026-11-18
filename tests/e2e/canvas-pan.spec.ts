import { expect, test, type Page } from '@playwright/test';

/**
 * Перемещение листа в конструкторах чертежей: протяжка пустого места двигает
 * вид на всех вкладках, клик на месте остаётся кликом, два пальца двигают и
 * масштабируют лист. Юнит-тесты видят это на jsdom без раскладки; здесь —
 * настоящие размеры полотна и настоящий браузер.
 */
const EDITOR = '.rte-root .rte-content';
const OPEN_MODAL = '.rte-modal:not([hidden])';
const SKETCH = `${OPEN_MODAL} .rte-sketch`;
const DIALOG_TABS = `${OPEN_MODAL} .rte-drawing-dialog__tabs [role="tab"]`;
/** Точки и прочие кружки сцены — в статичном слое полотна. */
const LAYER_CIRCLES = `${SKETCH} .rte-sketch__layer svg circle`;

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };

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

async function sketchBox(page: Page): Promise<Box> {
  const box = await page.locator(SKETCH).boundingBox();

  if (!box) throw new Error('Полотно не видно');

  return box;
}

async function centersOf(page: Page, selector: string): Promise<Point[]> {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();

      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }),
  );
}

/** Ближайший к `target` центр и расстояние до него. */
function nearest(centers: Point[], target: Point): { at: Point; distance: number } {
  return centers.reduce<{ at: Point; distance: number }>(
    (best, center) => {
      const distance = Math.hypot(center.x - target.x, center.y - target.y);

      return distance < best.distance ? { at: center, distance } : best;
    },
    { at: target, distance: Number.POSITIVE_INFINITY },
  );
}

/**
 * Протяжка мышью: первый шаг в 5 px проходит порог и становится точкой
 * отсчёта, дальше лист едет на `dx`, `dy` вслед за указателем.
 */
async function panBy(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, from.y);
  await page.mouse.move(from.x + 5 + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('перемещение листа', () => {
  test('планиметрия: протяжка пустого места сдвигает точку на экране, «Показать целиком» возвращает её', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');
    await page.locator(`${OPEN_MODAL} button[data-tool="point"]`).click();

    const box = await sketchBox(page);
    const target = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.3 };

    // Shift — без прилипания: точка встаёт ровно под указатель.
    await page.keyboard.down('Shift');
    await page.mouse.click(target.x, target.y);
    await page.keyboard.up('Shift');

    const placed = nearest(await centersOf(page, LAYER_CIRCLES), target);

    expect(placed.distance).toBeLessThanOrEqual(3);

    const count = await page.locator(LAYER_CIRCLES).count();
    const shift = { x: -Math.round(box.width * 0.2), y: Math.round(box.height * 0.15) };

    // В «Точке» протяжка двигает лист и точку не ставит.
    await panBy(page, { x: box.x + box.width * 0.4, y: box.y + box.height * 0.6 }, shift.x, shift.y);
    await expect(page.locator(LAYER_CIRCLES)).toHaveCount(count);

    const moved = nearest(await centersOf(page, LAYER_CIRCLES), { x: placed.at.x + shift.x, y: placed.at.y + shift.y });

    expect(moved.distance).toBeLessThanOrEqual(2);

    // Уводим точку за край полотна; «Показать целиком» возвращает её в поле зрения.
    await page.locator(`${OPEN_MODAL} button[data-tool="select"]`).click();
    await panBy(page, { x: box.x + box.width * 0.9, y: box.y + box.height * 0.8 }, -Math.round(box.width * 0.85), 0);

    const gone = nearest(await centersOf(page, LAYER_CIRCLES), moved.at);

    expect(gone.at.x).toBeLessThan(box.x);

    await page.locator(`${OPEN_MODAL} button[aria-label="Показать целиком"]`).click();

    const back = await centersOf(page, LAYER_CIRCLES);

    expect(back).toHaveLength(count);
    back.forEach((center) => {
      expect(center.x).toBeGreaterThan(box.x);
      expect(center.x).toBeLessThan(box.x + box.width);
      expect(center.y).toBeGreaterThan(box.y);
      expect(center.y).toBeLessThan(box.y + box.height);
    });
  });

  test('графики: протяжка пустого места сдвигает точку графика', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Графики');
    await page.locator(`${OPEN_MODAL} button[data-tool="point"]`).click();

    const box = await sketchBox(page);
    const target = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.3 };

    await page.mouse.click(target.x, target.y);

    const placed = nearest(await centersOf(page, LAYER_CIRCLES), target);

    // Точка прилипает к сетке: не дальше половины клетки.
    expect(placed.distance).toBeLessThanOrEqual(box.width / 20);

    await page.locator(`${OPEN_MODAL} button[data-tool="select"]`).click();
    await panBy(page, { x: box.x + box.width * 0.3, y: box.y + box.height * 0.7 }, -40, 30);

    const moved = nearest(await centersOf(page, LAYER_CIRCLES), { x: placed.at.x - 40, y: placed.at.y + 30 });

    expect(moved.distance).toBeLessThanOrEqual(2);
  });

  test('физика: протяжка пустого места сдвигает элемент вместе с его ручками', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Физика');
    await page.locator(`${OPEN_MODAL} button[data-element="block_rect"]`).click();

    // Новый элемент выбран: его ручки — в оверлее, они едут вместе с листом.
    const handles = `${SKETCH} .rte-sketch__overlay rect, ${SKETCH} .rte-sketch__overlay circle`;

    await expect(page.locator(handles).first()).toBeAttached();

    const before = await centersOf(page, handles);
    const box = await sketchBox(page);

    await panBy(page, { x: box.x + box.width * 0.1, y: box.y + box.height * 0.85 }, 50, -30);

    const after = await centersOf(page, handles);

    expect(after).toHaveLength(before.length);
    after.forEach((center, index) => {
      expect(center.x - (before[index]?.x ?? 0)).toBeCloseTo(50, 0);
      expect(center.y - (before[index]?.y ?? 0)).toBeCloseTo(-30, 0);
    });
  });
});

test.describe('жест двумя пальцами', () => {
  test.skip(({ isMobile }) => !isMobile, 'сенсорный экран — проект телефона');

  test('планиметрия: пальцы разводят — лист увеличивается вокруг середины, точек столько же', async ({ page }) => {
    await openDemo(page);
    await openDrawingDialog(page, 'Планиметрия');
    await page.locator(`${OPEN_MODAL} button[data-tool="point"]`).click();

    const box = await sketchBox(page);
    const target = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.35 };

    await page.keyboard.down('Shift');
    await page.mouse.click(target.x, target.y);
    await page.keyboard.up('Shift');

    const placed = nearest(await centersOf(page, LAYER_CIRCLES), target);
    const count = await page.locator(LAYER_CIRCLES).count();
    const mid = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };

    // Касания не пустить через `page.touchscreen`: два указателя рассылаются событиями напрямую.
    await page.locator(SKETCH).evaluate(
      (sketch, { mid: center }) => {
        const send = (type: string, pointerId: number, x: number, y: number): void => {
          sketch.dispatchEvent(
            new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', isPrimary: pointerId === 11, clientX: x, clientY: y, button: 0, buttons: 1 }),
          );
        };

        send('pointerdown', 11, center.x - 20, center.y);
        send('pointerdown', 12, center.x + 20, center.y);
        [25, 30, 35, 40].forEach((half) => {
          send('pointermove', 11, center.x - half, center.y);
          send('pointermove', 12, center.x + half, center.y);
        });
        send('pointerup', 12, center.x + 40, center.y);
        // Оставшийся палец ничего не двигает и не рисует.
        send('pointermove', 11, center.x - 80, center.y + 40);
        send('pointerup', 11, center.x - 80, center.y + 40);
      },
      { mid },
    );

    await expect(page.locator(LAYER_CIRCLES)).toHaveCount(count);

    // Расстояние между пальцами выросло вдвое: точка вдвое дальше от их середины.
    const expected = { x: mid.x + (placed.at.x - mid.x) * 2, y: mid.y + (placed.at.y - mid.y) * 2 };
    const zoomed = nearest(await centersOf(page, LAYER_CIRCLES), expected);

    expect(zoomed.distance).toBeLessThanOrEqual(3);
  });
});
