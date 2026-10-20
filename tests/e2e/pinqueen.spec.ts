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
  test('кнопка открывает диалог, шаблон даёт превью, вставка кладёт узел в документ и вьюер', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Структурная формула"]').click();
    await expect(page.locator(MODAL_TITLE)).toHaveText('Структурная формула');

    await page.locator(`${OPEN_MODAL} button[data-code="**6(------)"]`).click();
    await expect(page.locator(`${OPEN_MODAL} .rte-chemistry-dialog__preview svg`)).toBeVisible();

    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect(page.locator(MODAL_PANEL)).toBeHidden();

    await expect(page.locator(`${EDITOR} .rte-chemistry svg`)).toHaveCount(1);
    // Экспортированный HTML проходит через вьюер без редактора — структура дорисована по коду.
    await expect(page.locator('.demo__preview .rte-chemistry svg')).toHaveCount(1);
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

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[aria-label="Чертёж"]').click();
    await expect(page.locator(MODAL_TITLE)).toHaveText('Чертёж');
    await expect(page.locator(`${OPEN_MODAL} [role="tab"][aria-selected="true"]`)).toHaveText('Планиметрия');

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
