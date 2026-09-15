import { expect, test, type Page } from '@playwright/test';

const EDITOR = '.rte-root .rte-content';
const FORMULA = `${EDITOR} .rte-formula`;

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
    await expect(page.locator('.rte-modal__panel')).toHaveCount(0);
  });
});

test.describe('formula editing', () => {
  test('click opens the editor with the stored formula and saving updates it', async ({ page }) => {
    await openDemo(page);

    const formula = page.locator(FORMULA).first();
    const before = await formula.getAttribute('data-mathml');

    await formula.click();
    await expect(page.locator('.rte-modal__panel')).toBeVisible();

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
    await expect(page.locator('.rte-modal__panel')).toBeHidden();

    await expect
      .poll(() => page.locator(FORMULA).first().getAttribute('data-mathml'))
      .toContain('mfrac');
    expect(await page.locator(FORMULA).first().getAttribute('data-mathml')).not.toBe(before);
    await expect(page.locator(FORMULA)).toHaveCount(4);
  });

  test('inserts a new chemistry formula from the toolbar', async ({ page }) => {
    await openDemo(page);

    await page.locator(`${EDITOR} p`).first().click();
    await page.locator('.rte-toolbar button[title="Химическая формула"]').click();

    await expect(page.locator('.rte-modal__title')).toHaveText('Химическая формула');
    await page.locator('.rte-formula-editor__category', { hasText: 'Типовые формулы' }).click();
    await page.locator('.rte-formula-editor__template').first().click();

    await page.getByRole('button', { name: 'Вставить' }).click();
    await expect(page.locator('.rte-modal__panel')).toBeHidden();

    await expect(page.locator(`${FORMULA}[data-formula-type="chem"]`)).toHaveCount(3);
  });

  test('deletes a formula only as a whole node', async ({ page }) => {
    await openDemo(page);

    await page.locator(FORMULA).first().click();
    await expect(page.locator('.rte-modal__panel')).toBeVisible();
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
    await expect(page.locator('.rte-modal__panel')).toBeHidden();

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
    await page.locator('.rte-toolbar button[title="Полужирный"]').click();

    await page.getByRole('button', { name: 'Исходник' }).click();
    expect(await page.locator('.demo__source').innerText()).toContain('<strong>');
  });

  test('switches every label when the locale changes', async ({ page }) => {
    await openDemo(page);

    await expect(page.locator('.rte-toolbar button[title="Полужирный"]')).toBeVisible();

    await page.selectOption('.demo__controls select', { label: 'English (messages.json)' });

    await expect(page.locator('.rte-toolbar button[title="Bold"]')).toBeVisible();
    await expect(page.locator('.rte-toolbar button[title="Voice message"]')).toBeVisible();

    await page.locator('.rte-toolbar button[title="Math formula"]').click();
    await expect(page.locator('.rte-modal__title')).toHaveText('Math formula');
    await expect(page.locator('.rte-formula-editor__category').first()).toHaveText('Basics');
  });
});

test.describe('responsive layout', () => {
  test('collapses secondary groups into the overflow menu when narrow', async ({ page }) => {
    await openDemo(page);
    await page.setViewportSize({ width: 420, height: 900 });

    const overflow = page.locator('.rte-toolbar button[title="Ещё"]');
    await expect(overflow).toBeVisible();

    // Undo lives in a collapsible group, so it moves into the menu.
    await expect(page.locator('.rte-toolbar > .rte-toolbar__group button[title="Отменить"]')).toHaveCount(0);

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
