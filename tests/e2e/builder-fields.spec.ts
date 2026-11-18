import { expect, test, type Page } from '@playwright/test';

/**
 * Общие поля панели свойств конструкторов: палитра цвета вместо списка и
 * hex-поля. Юнит-тесты проверяют разметку и правки сцены; здесь — настоящий
 * рендер (цвет обводки) и раскладка сетки плиток в боковой колонке и на телефоне.
 */
const EDITOR = '.rte-root .rte-content';
const OPEN_MODAL = '.rte-modal:not([hidden])';
const LAYER = `${OPEN_MODAL} .rte-sketch__layer`;
const PROPS = `${OPEN_MODAL} .rte-builder__props`;
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

/** Физика с выделенной силой: панель свойств показывает палитру. */
async function selectForce(page: Page): Promise<void> {
  await openDrawingDialog(page, 'Физика');
  await page.locator(`${OPEN_MODAL} button[data-element="force"]`).click();
  await expect(page.locator(`${PROPS} [role="radiogroup"]`)).toBeVisible();
}

test('физика: плитка меняет цвет силы, «Обычный цвет» возвращает исходный вид', async ({ page }) => {
  await openDemo(page);
  await selectForce(page);

  const layer = page.locator(LAYER);
  const original = await layer.innerHTML();
  const red = page.locator(PROPS).getByRole('radio', { name: 'Красный' });

  await red.click();
  await expect(red).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator(`${PROPS} [role="radio"][aria-checked="true"]`)).toHaveCount(1);
  await expect(red).toBeFocused();
  await expect.poll(() => layer.innerHTML()).toContain('#dc2626');

  const reset = page.locator(PROPS).getByRole('button', { name: 'Обычный цвет' });

  await reset.click();
  await expect(reset).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`${PROPS} [role="radio"][aria-checked="true"]`)).toHaveCount(0);
  await expect.poll(() => layer.innerHTML()).toBe(original);
  // Поля hex больше нет.
  await expect(page.locator(`${PROPS} input[type="text"][placeholder^="#"]`)).toHaveCount(0);
});

test('физика: стрелки ходят по плиткам, в порядке Tab одна плитка', async ({ page }) => {
  await openDemo(page);
  await selectForce(page);

  const blue = page.locator(PROPS).getByRole('radio', { name: 'Синий' });

  await blue.click();
  // Вниз — на плитку под синей во втором ряду.
  await page.keyboard.press('ArrowDown');

  const red = page.locator(PROPS).getByRole('radio', { name: 'Красный' });

  await expect(red).toHaveAttribute('aria-checked', 'true');
  await expect(red).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator(PROPS).getByRole('radio', { name: 'Серый' })).toBeFocused();
  await expect(page.locator(`${PROPS} [role="radio"][tabindex="0"]`)).toHaveCount(1);
});

test('сетка цвета не даёт горизонтальной прокрутки колонки, плитки не меньше 36px', async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 720 });

  await openDemo(page);
  await selectForce(page);

  const layout = await page.locator(PROPS).evaluate((props) => {
    const grid = props.querySelector('.rte-builder__colors');
    const tiles = [...props.querySelectorAll('[role="radio"]')].map((tile) => tile.getBoundingClientRect());
    const box = props.getBoundingClientRect();

    return {
      scrollWidth: props.scrollWidth,
      clientWidth: props.clientWidth,
      right: box.right,
      gridRight: grid?.getBoundingClientRect().right ?? Infinity,
      tiles: tiles.map((tile) => ({ width: tile.width, height: tile.height, top: Math.round(tile.top) })),
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.gridRight).toBeLessThanOrEqual(layout.right);
  expect(layout.pageScroll).toBeLessThanOrEqual(0);
  expect(layout.tiles).toHaveLength(10);
  layout.tiles.forEach((tile) => {
    expect(tile.width).toBeGreaterThanOrEqual(36);
    expect(tile.height).toBeGreaterThanOrEqual(36);
  });
  // Две строки по пять плиток.
  expect(new Set(layout.tiles.map((tile) => tile.top)).size).toBe(2);
});

/** Графики с выделенной параболой из шаблона. */
async function selectParabola(page: Page): Promise<void> {
  await openDrawingDialog(page, 'Графики');
  await page.locator(`${OPEN_MODAL} button[data-plot-template="parabola"]`).click();
  await expect(page.locator(`${PROPS} .rte-plots-fn`)).toBeVisible();
}

test('графики: плитка «Красный» красит параболу и отмечена', async ({ page }) => {
  await openDemo(page);
  await selectParabola(page);

  const red = page.locator(PROPS).getByRole('radio', { name: 'Красный' });

  await red.click();
  await expect(red).toHaveAttribute('aria-checked', 'true');
  await expect(red).toBeFocused();
  await expect(page.locator(`${LAYER} svg polyline[stroke="#dc2626"]`).first()).toBeAttached();
  // Поля hex больше нет и здесь.
  await expect(page.locator(`${PROPS} input[type="text"][placeholder^="#"]`)).toHaveCount(0);
});

test('графики: при выделенной параболе шаблоны — одна строка, формула, поле записи и подсказки видны без прокрутки', async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 720 });

  await openDemo(page);
  await selectParabola(page);

  const layout = await page.locator(`${OPEN_MODAL} .rte-builder--plots`).evaluate((builder) => {
    const props = builder.querySelector('.rte-builder__props');
    const top = (element: Element | null | undefined): number => Math.round(element?.getBoundingClientRect().top ?? NaN);
    const box = props?.getBoundingClientRect();
    const formula = props?.querySelector('.rte-plots-fn__formula');
    const inside = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();

      return box !== undefined && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
    };

    return {
      templates: [...builder.querySelectorAll('[data-plot-template]')].map((button) => ({
        top: top(button),
        label: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
      })),
      controls: [...(props?.querySelectorAll('.rte-plots-fn input[data-prop="expr"], .rte-plots-fn__keys') ?? [])].map(inside),
      formula: formula ? inside(formula) : false,
      scrollTop: props?.scrollTop ?? NaN,
      stageTop: top(builder.querySelector('.rte-builder__stage')),
      propsTop: top(props),
      hint: builder.querySelector('.rte-builder__hint')?.textContent,
    };
  });

  expect(layout.templates).toHaveLength(7);
  expect(new Set(layout.templates.map((template) => template.top)).size).toBe(1);
  layout.templates.forEach((template) => {
    expect(template.label).toBeTruthy();
    expect(template.title).toBe(template.label);
  });
  expect(layout.hint).toBe('Напиши функцию — график построится сам. Буквы вроде a и b станут ползунками');

  if (isMobile) {
    // На телефоне порядок прежний: полотно, затем блок свойств.
    expect(layout.stageTop).toBeLessThan(layout.propsTop);

    return;
  }

  expect(layout.scrollTop).toBe(0);
  expect(layout.formula).toBe(true);
  expect(layout.controls).toEqual([true, true]);
});
