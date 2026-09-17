import { expect, test, type Page } from '@playwright/test';

/**
 * Редактор, собранный без фреймворка.
 *
 * Страница подключает только ядро: ни Vue, ни компонентов — один вызов
 * `createRichEditor`. Тест существует затем, чтобы «ванильность» была
 * проверяемым свойством, а не обещанием в документации: если в ядро
 * просочится зависимость от фреймворка, страница перестанет работать.
 */
const EDITOR = '.rte-root .rte-content';

async function openVanilla(page: Page): Promise<void> {
  await page.goto('/vanilla.html');
  await page.waitForSelector('.rte-root');
}

test.describe('ванильный редактор', () => {
  test('монтируется с тулбаром и областью ввода', async ({ page }) => {
    await openVanilla(page);

    await expect(page.locator('.rte-toolbar')).toBeVisible();
    await expect(page.locator(`${EDITOR}[contenteditable="true"]`)).toBeVisible();
    await expect(page.locator('.rte-toolbar .rte-btn')).not.toHaveCount(0);
    await expect(page.locator(EDITOR)).toContainText('Набран без фреймворка.');
  });

  test('форматирует текст через тулбар', async ({ page }) => {
    await openVanilla(page);

    await page.locator(EDITOR).click();
    await page.keyboard.press('End');
    await page.locator('.rte-toolbar button[title="Полужирный"]').click();
    await page.keyboard.type('жирный');

    await expect(page.locator(`${EDITOR} strong`).last()).toHaveText('жирный');
  });

  test('открывает выпадающие меню', async ({ page }) => {
    await openVanilla(page);

    await page.locator('.rte-toolbar button[title="Заголовок"]').click();

    // В DOM висит по панели на каждый дропдаун, поэтому смотрим на открытую.
    const panel = page.locator('.rte-dropdown__panel:not([hidden])');
    await expect(panel).toHaveCount(1);
    // Обычный текст плюс шесть уровней.
    await expect(panel.locator('.rte-menu__item')).toHaveCount(7);

    await page.keyboard.press('Escape');
    await expect(page.locator('.rte-dropdown__panel:not([hidden])')).toHaveCount(0);
  });

  test('открывает диалоги', async ({ page }) => {
    await openVanilla(page);

    await page.locator('.rte-toolbar button[title="Таблица"]').click();
    await page.locator('.rte-dropdown__panel .rte-menu__item').first().click();

    const dialog = page.locator('.rte-modal:not([hidden])');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.rte-modal__title')).toHaveText('Вставить таблицу');

    // Скрытые диалоги не должны перехватывать клики: атрибут hidden сам по себе
    // не побеждает display: flex у подложки.
    await page.keyboard.press('Escape');
    await expect(page.locator('.rte-modal:not([hidden])')).toHaveCount(0);
    await page.locator('.rte-toolbar button[title="Полужирный"]').click();
  });

  test('вставляет таблицу в документ', async ({ page }) => {
    await openVanilla(page);

    await page.locator('.rte-toolbar button[title="Таблица"]').click();
    await page.locator('.rte-dropdown__panel .rte-menu__item').first().click();
    await page.locator('.rte-modal:not([hidden])').getByRole('button', { name: 'Применить' }).click();

    await expect(page.locator(`${EDITOR} table`)).toBeVisible();
  });
});
