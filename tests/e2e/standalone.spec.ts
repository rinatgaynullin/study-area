import { expect, test } from '@playwright/test';

/**
 * Страница автономной сборки: редактор и вьюер подключены одним
 * module-скриптом из public/standalone, без участия Vite. Тест проверяет то,
 * что важно хосту без бандлера: сборка поднимается, ленивые чанки MathLive и
 * MathJax доезжают относительными импортами, стили и шрифты на месте.
 */
const EDITOR = '#editor .rte-content';

test.describe('автономная сборка', () => {
  test('редактор и вьюер работают из статики', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/standalone.html');
    await page.waitForSelector('.rte-root');

    await expect(page.locator('.demo__variants a[aria-current="page"]')).toHaveText('Standalone');
    expect(await page.locator('.rte-toolbar button').count()).toBeGreaterThan(10);

    // Формула из MathML отрисована ленивым MathJax — и в редакторе, и во вьюере.
    await expect(page.locator(`${EDITOR} .rte-formula svg`)).toHaveCount(1);
    await expect(page.locator('#viewer span[data-formula] svg')).toHaveCount(1);

    // Редактор формул — ленивый чанк MathLive со шрифтами из соседнего каталога.
    await page.locator('.rte-toolbar button[aria-label="Математическая формула"]').click();
    await expect(page.locator('.rte-modal:not([hidden]) math-field')).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() =>
      [...document.fonts].some((face) => face.family.includes('KaTeX') && face.status === 'loaded'),
    );
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
  });

  test('страницы демо ссылаются друг на друга', async ({ page }) => {
    await page.goto('/');
    await page.locator('.demo__variants a', { hasText: 'Vanilla' }).click();
    await expect(page).toHaveURL(/vanilla\.html$/);
    await page.locator('.demo__variants a', { hasText: 'Standalone' }).click();
    await expect(page).toHaveURL(/standalone\.html$/);
    await page.locator('.demo__variants a', { hasText: 'Vue' }).click();
    await expect(page.locator('.demo__variants a[aria-current="page"]')).toHaveText('Vue');
  });
});
