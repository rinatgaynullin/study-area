import { expect, test, type Page } from '@playwright/test';

/**
 * Блок «Функция» на вкладке «Графики»: формула выделенного графика и её
 * параметры. Проверяется то, чего не видит jsdom: настоящий ползунок с
 * клавиатуры перерисовывает кривую, а блок помещается в колонку свойств.
 */
const EDITOR = '.rte-root .rte-content';
const OPEN_MODAL = '.rte-modal:not([hidden])';
const SKETCH = `${OPEN_MODAL} .rte-sketch`;
const DIALOG_TABS = `${OPEN_MODAL} .rte-drawing-dialog__tabs [role="tab"]`;
const BLOCK = `${OPEN_MODAL} .rte-plots-fn`;
const FORMULA = `${BLOCK} .rte-plots-fn__formula[role="img"]`;

async function openPlots(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(`${EDITOR} .rte-formula svg`, { timeout: 30_000 });
  await page.locator(`${EDITOR} p`).first().click();
  await page.locator('.rte-toolbar button[aria-label="Чертёж"]').click();
  await page.locator(DIALOG_TABS, { hasText: 'Графики' }).click();
  await expect(page.locator(`${DIALOG_TABS}[aria-selected="true"]`)).toHaveText('Графики');
}

/** Пути кривых на полотне одной строкой: меняется, когда перерисована кривая. */
const curvePaths = (page: Page): Promise<string> =>
  page.locator(`${SKETCH} .rte-sketch__layer svg path`).evaluateAll((paths) => paths.map((path) => path.getAttribute('d') ?? '').join('|'));

test('шаблон параболы: блок «Функция» с формулой, ползунок a с клавиатуры меняет кривую и формулу', async ({ page }) => {
  await openPlots(page);
  await page.locator(`${OPEN_MODAL} button[data-plot-template="parabola"]`).click();

  await expect(page.locator(BLOCK)).toBeVisible();
  await expect(page.locator(FORMULA)).toHaveAttribute('aria-label', 'y = x²');
  await expect(page.locator(FORMULA)).toHaveText('y = x2');

  const before = await curvePaths(page);
  const slider = page.locator(`${BLOCK} input[type="range"][data-param="a"]`);

  await slider.focus();
  await page.keyboard.press('ArrowRight');

  await expect(page.locator(FORMULA)).toHaveAttribute('aria-label', 'y = 1,1x²');
  await expect(page.locator(FORMULA)).toHaveText('y = 1,1x2');
  expect(await curvePaths(page)).not.toBe(before);
  // Ползунок не пересоздан и не потерял фокус: следующее нажатие продолжает жест.
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(FORMULA)).toHaveAttribute('aria-label', 'y = 1,2x²');
});

/** Шаблон выделен: колонка свойств и блок без горизонтальной прокрутки, ползунки и числа не ниже 40px. */
async function expectBlockFits(page: Page, template: string): Promise<void> {
  await page.locator(`${OPEN_MODAL} button[data-plot-template="${template}"]`).click();
  await expect(page.locator(BLOCK)).toBeVisible();

  const sizes = await page.locator(`${OPEN_MODAL} .rte-builder__props`).evaluate((props) => {
    const block = props.querySelector('.rte-plots-fn');
    const controls = [...props.querySelectorAll<HTMLElement>('.rte-plots-fn input[type="range"], .rte-plots-fn input[type="number"]')];

    return {
      props: { scrollWidth: props.scrollWidth, clientWidth: props.clientWidth },
      block: { scrollWidth: block?.scrollWidth ?? 0, clientWidth: block?.clientWidth ?? 0 },
      heights: controls.map((control) => control.getBoundingClientRect().height),
      sliders: [...props.querySelectorAll<HTMLElement>('.rte-plots-fn input[type="range"]')].map((range) => range.getBoundingClientRect().width),
    };
  });

  expect(sizes.props.scrollWidth, template).toBeLessThanOrEqual(sizes.props.clientWidth);
  expect(sizes.block.scrollWidth, template).toBeLessThanOrEqual(sizes.block.clientWidth);
  sizes.heights.forEach((height) => expect(height, template).toBeGreaterThanOrEqual(40));
  // Ползунок забирает остаток строки, а не сжимается в точку.
  sizes.sliders.forEach((width) => expect(width, template).toBeGreaterThanOrEqual(100));
}

test('блок «Функция» не даёт горизонтальной прокрутки колонки свойств, поля не ниже 40px', async ({ page }) => {
  await openPlots(page);
  await expectBlockFits(page, 'parabola');
  await expectBlockFits(page, 'hyperbola');
  await expectBlockFits(page, 'sqrt');
  await expectBlockFits(page, 'line');
  await expectBlockFits(page, 'circle');

  // Колонка свойств — во всю ширину полотна на телефоне, сбоку от него на десктопе.
  const sketch = await page.locator(SKETCH).boundingBox();
  const props = await page.locator(`${OPEN_MODAL} .rte-builder__props`).boundingBox();

  expect(sketch).not.toBeNull();
  expect(props).not.toBeNull();

  if (page.viewportSize()?.width === 1280) expect(props?.width ?? 0).toBeLessThanOrEqual(282);
  else expect(props?.width ?? 0).toBeGreaterThanOrEqual((sketch?.width ?? 0) - 2);
});
