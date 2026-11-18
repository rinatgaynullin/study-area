import { expect, test, type Page } from '@playwright/test';

/**
 * Возможности из PinQueen на странице Vue-демо: структурные формулы,
 * чертежи с конструктором и текст распознавания. Проверяется путь целиком —
 * кнопка тулбара, диалог, узел в документе, тот же узел во вьюере и
 * обратная запись в текст для бэкенда.
 */
const EDITOR = '.rte-root .rte-content';
const OPEN_MODAL = '.rte-modal:not([hidden])';
const MODAL_PANEL = `${OPEN_MODAL} .rte-modal__panel`;
const MODAL_TITLE = `${OPEN_MODAL} .rte-modal__title`;

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(`${EDITOR} .rte-formula svg`, { timeout: 30_000 });
}

async function applySample(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Вставить HTML' }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Применить в редактор' }).click();
}

// На телефоне второстепенные кнопки тулбара уезжают в меню «ещё»; путь через
// диалоги здесь проверяется на настольной раскладке.
test.skip(({ isMobile }) => Boolean(isMobile), 'диалоги возможностей проверяются на десктопе');

test.describe('структурные формулы', () => {
  test('кнопка открывает диалог, готовая формула встаёт на полотно, вставка кладёт узел в документ и вьюер', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Структурная формула"]').click();
    await expect(page.locator(MODAL_TITLE)).toHaveText('Структурная формула');

    await page.locator(`${OPEN_MODAL} button[data-code="**6(------)"]`).click();
    await expect(page.locator(`${OPEN_MODAL} .rte-chem-builder__canvas svg`)).toBeVisible();

    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect(page.locator(MODAL_PANEL)).toBeHidden();

    await expect(page.locator(`${EDITOR} .rte-chemistry svg`)).toHaveCount(1);
    // Экспортированный HTML проходит через вьюер без редактора — структура дорисована по коду.
    await expect(page.locator('.demo__preview .rte-chemistry svg')).toHaveCount(1);
  });

  test('конструктор по умолчанию: CH₃–CH₂–OH тремя нажатиями, узел с SVG в документе', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Структурная формула"]').click();
    await expect(page.locator(`${OPEN_MODAL} textarea`)).toHaveCount(0);

    await page.locator(`${OPEN_MODAL} .rte-chem-builder__start`).click();
    await page.locator(`${OPEN_MODAL} button[data-group="CH_2"]`).click();
    await page.locator(`${OPEN_MODAL} [data-plus][data-angle="0"]`).click();
    await page.locator(`${OPEN_MODAL} button[data-group="OH"]`).click();
    await page.locator(`${OPEN_MODAL} [data-plus][data-angle="0"]`).click();
    await expect(page.locator(`${OPEN_MODAL} .rte-chem-builder__canvas text`)).toHaveText(['CH₃', 'CH₂', 'OH']);

    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect(page.locator(MODAL_PANEL)).toBeHidden();

    const node = page.locator(`${EDITOR} .rte-chemistry`);

    await expect(node).toHaveCount(1);
    await expect(node.locator('svg')).toHaveCount(1);
    await expect(node).toHaveAttribute('data-chemistry-code', 'CH_3-[:0]CH_2-[:0]OH');
  });

  test('флажок демо включает поле кода chemfig, связанное с конструктором', async ({ page }) => {
    await openDemo(page);
    await page.getByLabel('Код chemfig в диалоге структуры').check();
    await page.waitForSelector(`${EDITOR} .rte-formula svg`, { timeout: 30_000 });

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Структурная формула"]').click();
    await page.locator(`${OPEN_MODAL} summary`, { hasText: 'Код chemfig' }).click();
    await page.locator(`${OPEN_MODAL} textarea`).fill('CH_3-CH=CH_2');
    await expect(page.locator(`${OPEN_MODAL} .rte-chem-builder__canvas text`)).toHaveText(['CH₃', 'CH', 'CH₂']);

    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect(page.locator(`${EDITOR} .rte-chemistry`)).toHaveAttribute('data-chemistry-code', 'CH_3-CH=CH_2');
  });

  test('с клавиатуры: CH₃–OH — фокус на атом, Enter, фокус на «плюс», Enter — и вставка', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Структурная формула"]').click();

    // Модалка ставит автофокус на полотно в следующем кадре. Пока он не
    // случился, фокус, поставленный сценарием, он перехватит: Enter уйдёт
    // пустому полотну, а Escape без выделения закроет окно. Ждём автофокус.
    await expect(page.locator(`${OPEN_MODAL} .rte-chem-builder__stage`)).toBeFocused();

    const start = page.locator(`${OPEN_MODAL} .rte-chem-builder__start`);

    await start.focus();
    await expect(start).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${OPEN_MODAL} [data-atom="0"]`)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL_PANEL)).toBeVisible();
    await expect(page.locator(`${OPEN_MODAL} [data-atom="0"]`)).toHaveAttribute('aria-pressed', 'false');

    await page.locator(`${OPEN_MODAL} [data-atom="0"]`).focus();
    await expect(page.locator(`${OPEN_MODAL} [data-atom="0"]`)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${OPEN_MODAL} [data-atom="0"]`)).toHaveAttribute('aria-pressed', 'true');

    const oh = page.locator(`${OPEN_MODAL} button[data-group="OH"]`);

    await oh.focus();
    await expect(oh).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(oh).toHaveAttribute('aria-pressed', 'true');

    const plus = page.locator(`${OPEN_MODAL} [data-plus][aria-label="Присоединить группу: вправо"]`);

    await plus.focus();
    await expect(plus).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${OPEN_MODAL} [data-atom="1"]`)).toBeFocused();

    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect(page.locator(`${EDITOR} .rte-chemistry`)).toHaveAttribute('data-chemistry-code', 'CH_3-[:0]OH');
  });

  test.describe('окно 1280×720', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('тело модалки конструктора не прокручивается, в том числе с выделенным атомом', async ({ page }) => {
      await openDemo(page);

      await page.locator(`${EDITOR} p`).first().click();
      await page.locator('.rte-toolbar button[aria-label="Структурная формула"]').click();
      await page.locator(`${OPEN_MODAL} .rte-chem-builder__start`).click();
      await page.locator(`${OPEN_MODAL} [data-plus][data-angle="0"]`).click();

      const body = page.locator(`${OPEN_MODAL} .rte-modal__body`);
      const overflow = await body.evaluate((element) => element.scrollHeight - element.clientHeight);

      expect(overflow).toBeLessThanOrEqual(0);
      await expect(page.locator(`${OPEN_MODAL} .rte-chem-builder__section--templates`)).toBeInViewport();
    });
  });

  test('разметка PinQueen из образца становится структурами, код вне подмножества остаётся текстом', async ({ page }) => {
    await openDemo(page);
    await applySample(page, 'Структурные формулы PinQueen');

    await expect(page.locator(`${EDITOR} .rte-chemistry`)).toHaveCount(6);
    await expect(page.locator(`${EDITOR} .rte-chemistry svg`)).toHaveCount(5);
    await expect(page.locator(`${EDITOR} .rte-chemistry--invalid`)).toHaveText('A-(B');
  });
});

test.describe('чертежи', () => {
  test('конструктор планиметрии: шаблон на полотне, точка кликом, карточка в документе', async ({ page }) => {
    await openDemo(page);
    // Образцы сцен и вкладка JSON — инструменты разработчика, демо включает их флажком.
    await page.getByRole('checkbox', { name: 'JSON в диалоге чертежа' }).check();

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Чертёж"]').click();
    await expect(page.locator(MODAL_TITLE)).toHaveText('Чертёж');
    await expect(page.locator(`${OPEN_MODAL} [role="tab"][aria-selected="true"]`)).toHaveText('Планиметрия');

    // На вкладке конструктора образцы свёрнуты вместе с предпросмотром и TikZ.
    await page.locator(`${OPEN_MODAL} .rte-drawing-dialog__more > summary`).click();
    await page.locator(`${OPEN_MODAL} button[data-template="triangle"]`).click();
    const canvas = page.locator(`${OPEN_MODAL} .rte-sketch`);
    await expect(canvas.locator('svg').first()).toBeVisible();

    // Точка ставится кликом по полотну: в JSON появляется четвёртая вершина.
    await page.locator(`${OPEN_MODAL} button[data-tool="point"]`).click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
    await page.locator(`${OPEN_MODAL} [data-tab="json"]`).click();
    await expect(page.locator(`${OPEN_MODAL} textarea:not([readonly])`)).toHaveValue(/"D": \[/);

    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect(page.locator(MODAL_PANEL)).toBeHidden();

    await expect(page.locator(`${EDITOR} .rte-drawing svg`)).toHaveCount(1);
    await expect(page.locator(`${EDITOR} .rte-drawing__title`)).toHaveText('Планиметрия');
    await expect(page.locator('.demo__preview .rte-drawing svg')).toHaveCount(1);
  });

  test('конструктор стереометрии: левая кнопка двигает полотно, правая вращает шаблон, вид уходит в документ', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Чертёж"]').click();
    await page.locator(`${OPEN_MODAL} [role="tab"]`, { hasText: 'Стереометрия' }).click();
    await page.locator(`${OPEN_MODAL} button[data-template="parallelepiped"]`).click();

    const canvas = page.locator(`${OPEN_MODAL} .rte-sketch`);
    const turn = page.locator(`${OPEN_MODAL} input[data-prop="angleZ"]`);
    await expect(canvas.locator('svg').first()).toBeVisible();
    await expect(turn).toHaveValue('-30');

    // Угол полотна после вписывания шаблона пуст: левая кнопка двигает полотно, угол прежний.
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 88, box.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect(turn).toHaveValue('-30');

    // Правая кнопка вращает фигуру.
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + 88, box.y + 40, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await expect(turn).not.toHaveValue('-30');

    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect(page.locator(MODAL_PANEL)).toBeHidden();

    const node = page.locator(`${EDITOR} div[data-geometry-data]`);
    await expect(node).toHaveCount(1);
    const scene = JSON.parse((await node.getAttribute('data-geometry-data')) ?? '{}') as { angleZ?: number };
    expect(scene.angleZ).not.toBe(-30);
  });

  test('образец чертежей PinQueen: карточки по видам сцен, битый JSON сохраняется', async ({ page }) => {
    await openDemo(page);
    await applySample(page, 'Чертежи PinQueen');

    await expect(page.locator(`${EDITOR} .rte-drawing`)).toHaveCount(4);
    await expect(page.locator(`${EDITOR} .rte-drawing svg`)).toHaveCount(3);
    await expect(page.locator(`${EDITOR} .rte-drawing__title`)).toHaveText(['Планиметрия', 'Стереометрия', 'Механика', 'Планиметрия']);
    await expect(page.locator(`${EDITOR} .rte-drawing--invalid`)).toHaveCount(1);
  });
});

test.describe('текст распознавания', () => {
  test('образец OCR становится документом и записывается обратно в текст для бэкенда', async ({ page }) => {
    await openDemo(page);

    await page.getByRole('button', { name: 'Вставить HTML' }).click();
    await page.getByRole('button', { name: 'Текст распознавания PinQueen', exact: true }).click();
    await expect(page.locator('.demo__input-mode input[type="checkbox"]')).toBeChecked();
    await page.getByRole('button', { name: 'Применить в редактор' }).click();

    await expect(page.locator(`${EDITOR} h1`)).toHaveText('Решение');
    await expect(page.locator(`${EDITOR} .rte-formula svg`).first()).toBeVisible();
    await expect(page.locator(`${EDITOR} .rte-chemistry svg`)).toHaveCount(1);
    await expect(page.locator(`${EDITOR} .rte-drawing svg`)).toHaveCount(1);
    await expect(page.locator(`${EDITOR} ol li`)).toHaveCount(2);
    await expect(page.locator(`${EDITOR} s`)).toHaveText('12');

    await page.getByRole('button', { name: 'Текст для бэкенда' }).click();
    const text = page.locator('.demo__source');
    await expect(text).toContainText('\\chemfig{CH_3-CH_2-CH_3}');
    await expect(text).toContainText('<<<TIKZ_START>>>');
    await expect(text).toContainText('1. раз');
    await expect(text).toContainText('~~12~~');
  });

  test('кнопка «Распознать фото»: снимок уходит адаптеру, результат встаёт в документ, скан виден в конструкторе', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} p`).first().click();
    await expect(page.locator('.rte-toolbar button[aria-label="Распознать фото"]')).toBeVisible();

    // Системный диалог выбора файла не открыть: снимок кладётся прямо в скрытое поле.
    await page.locator('.rte-ocr-input').setInputFiles({
      name: 'scan.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    });
    await expect(page.locator('.rte-status')).toHaveText('Распознаём фото…');

    await expect(page.locator(`${EDITOR} h1`)).toHaveText('Решение');
    await expect(page.locator(`${EDITOR} .rte-chemistry svg`)).toHaveCount(1);
    await expect(page.locator(`${EDITOR} .rte-drawing svg`)).toHaveCount(1);
    await expect(page.locator('.rte-status')).toHaveText('');

    await page.locator('.rte-toolbar button[aria-label="Чертёж"]').click();
    await expect(page.locator(`${OPEN_MODAL} .rte-drawing-dialog__scan`)).toHaveCount(1);
  });
});
