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
    await page.locator('.rte-toolbar button[aria-label="Полужирный"]').click();
    // Клик по кнопке уводит фокус из документа, а TipTap возвращает его в
    // следующем кадре; набор до этого лёг бы под старое выделение.
    await expect(page.locator(EDITOR)).toBeFocused();
    await page.keyboard.type('жирный');

    await expect(page.locator(`${EDITOR} strong`).last()).toHaveText('жирный');
  });

  test('кнопка заголовка не меняет ширину, когда подпись меняется', async ({ page }) => {
    await openVanilla(page);
    const button = page.locator('.rte-toolbar button[aria-label="Заголовок"]');
    const toolbar = page.locator('.rte-toolbar');

    await page.locator(`${EDITOR} h2`).click();
    await expect(button).toHaveText(/H2/);
    const onHeading = (await button.boundingBox())!;
    const toolbarOnHeading = (await toolbar.boundingBox())!;

    await page.locator(`${EDITOR} p`).click();
    await expect(button).toHaveText('Обычный текст');
    const onParagraph = (await button.boundingBox())!;
    const toolbarOnParagraph = (await toolbar.boundingBox())!;

    // Подпись стала в три раза длиннее, а тулбар не перестроился.
    expect(onParagraph.width).toBe(onHeading.width);
    expect(toolbarOnParagraph.height).toBe(toolbarOnHeading.height);

    // Не влезающая подпись обрезается многоточием, а не растягивает кнопку.
    // Влезает ли подпись по умолчанию, зависит от шрифта на машине, поэтому
    // проверяется правило, а не факт обрезки.
    const label = button.locator('.rte-btn__text');
    await expect(label).toHaveCSS('overflow', 'hidden');
    await expect(label).toHaveCSS('text-overflow', 'ellipsis');
  });

  test('открывает выпадающие меню', async ({ page }) => {
    await openVanilla(page);

    await page.locator('.rte-toolbar button[aria-label="Заголовок"]').click();

    // В DOM висит по панели на каждый дропдаун, поэтому смотрим на открытую.
    const panel = page.locator('.rte-dropdown__panel:not([hidden])');
    await expect(panel).toHaveCount(1);
    // Обычный текст плюс шесть уровней.
    await expect(panel.locator('.rte-menu__item')).toHaveCount(7);

    await page.keyboard.press('Escape');
    await expect(page.locator('.rte-dropdown__panel:not([hidden])')).toHaveCount(0);
  });

  test('панель меню не привязана к потоку документа: её не обрежет корень', async ({ page }) => {
    await openVanilla(page);
    await page.locator('.rte-toolbar button[aria-label="Заголовок"]').click();

    const panel = page.locator('.rte-dropdown__panel:not([hidden])');
    await expect(panel).toHaveCSS('position', 'fixed');
    await expect(panel).toHaveAttribute('role', 'menu');
  });

  test('вьюер без фреймворка показывает документ редактора', async ({ page }) => {
    await openVanilla(page);

    const viewer = page.locator('#viewer.rte-content-root');
    await expect(viewer).toContainText('Набран без фреймворка.');
    await expect(viewer.locator('strong')).toHaveText('без');
    await expect(viewer.locator('[contenteditable="true"]')).toHaveCount(0);
  });

  test('открывает диалоги', async ({ page }) => {
    await openVanilla(page);

    await page.locator('.rte-toolbar button[aria-label="Таблица"]').click();
    await page.locator('.rte-dropdown__panel .rte-menu__item').first().click();

    const dialog = page.locator('.rte-modal:not([hidden])');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.rte-modal__title')).toHaveText('Вставить таблицу');

    // Скрытые диалоги не должны перехватывать клики: атрибут hidden сам по себе
    // не побеждает display: flex у подложки.
    await page.keyboard.press('Escape');
    await expect(page.locator('.rte-modal:not([hidden])')).toHaveCount(0);
    await page.locator('.rte-toolbar button[aria-label="Полужирный"]').click();
  });

  test('вставляет таблицу в документ', async ({ page }) => {
    await openVanilla(page);

    await page.locator('.rte-toolbar button[aria-label="Таблица"]').click();
    await page.locator('.rte-dropdown__panel .rte-menu__item').first().click();
    await page.locator('.rte-modal:not([hidden])').getByRole('button', { name: 'Применить' }).click();

    await expect(page.locator(`${EDITOR} table`)).toBeVisible();
  });
});

/** Страница отдаёт редактор наружу, чтобы тесты могли дёргать его API. */
interface VanillaWindow {
  vanillaEditor: { setEditable(editable: boolean): void; setLocale(locale: string): void };
}

interface VanillaCore {
  insertFormula(mathml: string, type: 'math' | 'chem'): boolean;
}

/*
 * Видимость интерфейса. Ванильный UI прячет элементы атрибутом `hidden`, а
 * тот проигрывает любому авторскому `display`, если стили не оговаривают
 * обратное. Юнит-тесты в jsdom этого не видят — там нет стилей, — поэтому
 * скрытие проверяется здесь, в браузере, по факту отрисовки.
 */
test.describe('видимость интерфейса', () => {
  test('режим чтения прячет тулбар', async ({ page }) => {
    await openVanilla(page);

    await page.evaluate(() => (window as unknown as VanillaWindow).vanillaEditor.setEditable(false));
    await expect(page.locator('.rte-toolbar')).toBeHidden();
    await expect(page.locator(`${EDITOR}[contenteditable="false"]`)).toBeVisible();

    await page.evaluate(() => (window as unknown as VanillaWindow).vanillaEditor.setEditable(true));
    await expect(page.locator('.rte-toolbar')).toBeVisible();
  });

  test('диалог записи показывает кнопки только своей фазы', async ({ page }) => {
    await openVanilla(page);
    await page.locator('.rte-toolbar button[aria-label="Голосовое сообщение"]').click();

    const controls = page.locator('.rte-modal:not([hidden]) .rte-recorder__controls button');
    await expect(controls.filter({ visible: true })).toHaveCount(1);
    await expect(controls.filter({ hasText: /^Записать$/ })).toBeVisible();
    await expect(controls.filter({ hasText: 'Пауза' })).toBeHidden();
    await expect(controls.filter({ hasText: 'Записать заново' })).toBeHidden();
  });

  test('при вставке новой формулы кнопки удаления нет', async ({ page }) => {
    await openVanilla(page);
    await page.locator('.rte-toolbar button[aria-label="Математическая формула"]').click();

    const dialog = page.locator('.rte-modal:not([hidden])');
    await expect(dialog.getByRole('button', { name: 'Вставить' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Удалить формулу' })).toBeHidden();
  });

  test('модалка затемняет страницу и закрывается кликом по подложке', async ({ page }) => {
    await openVanilla(page);
    await page.locator('.rte-toolbar button[aria-label="Таблица"]').click();
    await page.locator('.rte-dropdown__panel .rte-menu__item').first().click();

    const backdrop = page.locator('.rte-modal:not([hidden]) .rte-modal__backdrop');
    await expect(backdrop).toBeVisible();

    await backdrop.click({ position: { x: 8, y: 8 } });
    await expect(page.locator('.rte-modal:not([hidden])')).toHaveCount(0);
  });

  test('смена локали переводит диалоги, а не только тулбар', async ({ page }) => {
    await openVanilla(page);
    await page.evaluate(() => (window as unknown as VanillaWindow).vanillaEditor.setLocale('en'));

    await page.locator('.rte-toolbar button[aria-label="Link"]').click();
    await expect(page.locator('.rte-modal:not([hidden]) .rte-modal__title')).toHaveText('Link');
  });
});

test.describe('клавиатура', () => {
  const focusedButton = (page: Page) => page.locator('.rte-toolbar button:focus');

  /**
   * Ставит каретку в абзац и ждёт, пока редактор это заметит: позицию клика
   * ProseMirror читает асинхронно, и нажатая сразу клавиша застала бы каретку
   * ещё в начале документа. Подпись кнопки заголовка меняется вслед за
   * кареткой — по ней и ждём.
   */
  async function caretIntoParagraph(page: Page): Promise<void> {
    await openVanilla(page);
    await page.locator(`${EDITOR} p`).click();
    await expect(page.locator(EDITOR)).toBeFocused();
    await expect(page.locator('.rte-toolbar button[aria-label="Заголовок"]')).toHaveText(
      'Обычный текст',
    );
  }

  test('Alt+F10 ведёт в тулбар, стрелки ходят по кнопкам, Escape возвращает в документ', async ({
    page,
  }) => {
    await caretIntoParagraph(page);

    await page.keyboard.press('Alt+F10');
    // Отменять нечего: первая доступная кнопка — заголовок.
    await expect(focusedButton(page)).toHaveAttribute('aria-label', 'Заголовок');

    await page.keyboard.press('ArrowRight');
    await expect(focusedButton(page)).toHaveAttribute('aria-label', 'Полужирный');

    // На телефоне последняя кнопка — «Ещё», на десктопе — последняя из групп.
    const lastLabel = await page
      .locator('.rte-toolbar button:not(:disabled)')
      .last()
      .getAttribute('aria-label');
    await page.keyboard.press('End');
    await expect(focusedButton(page)).toHaveAttribute('aria-label', lastLabel!);
    await page.keyboard.press('Home');
    await expect(focusedButton(page)).toHaveAttribute('aria-label', 'Заголовок');

    // Тулбар — одна остановка Tab'а.
    await expect(page.locator('.rte-toolbar button[tabindex="0"]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator(EDITOR)).toBeFocused();
  });

  test('Enter на кнопке применяет форматирование к выделению и возвращает каретку', async ({
    page,
  }) => {
    await caretIntoParagraph(page);
    await page.keyboard.press('ControlOrMeta+a');

    await page.keyboard.press('Alt+F10');
    await page.keyboard.press('ArrowRight');
    await expect(focusedButton(page)).toHaveAttribute('aria-label', 'Полужирный');
    await page.keyboard.press('Enter');

    await expect(page.locator(`${EDITOR} p strong`)).toHaveText(/Набран/);
    await expect(page.locator(EDITOR)).toBeFocused();
  });

  test('стрелка вниз открывает меню, пункты — переключатели, Escape возвращает на кнопку', async ({
    page,
  }) => {
    await caretIntoParagraph(page);
    await page.keyboard.press('Alt+F10');
    await expect(focusedButton(page)).toHaveAttribute('aria-label', 'Заголовок');

    await page.keyboard.press('ArrowDown');
    const menu = page.locator('.rte-dropdown__panel:not([hidden])');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-labelledby', /rte-dropdown-/);

    const paragraph = menu.locator('[role="menuitemradio"]', { hasText: 'Обычный текст' });
    await expect(paragraph).toBeFocused();
    await expect(paragraph).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator(`${EDITOR} h1`)).toHaveText(/Набран/);
    await expect(menu).toBeHidden();
    // Команда пункта возвращает фокус в документ в следующем кадре — ждём его,
    // иначе Alt+F10 уйдёт в пустоту.
    await expect(page.locator(EDITOR)).toBeFocused();

    await page.keyboard.press('Alt+F10');
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(focusedButton(page)).toHaveAttribute('aria-label', 'Заголовок');
  });

  test('вкладки редактора формул переключаются стрелками', async ({ page }) => {
    await openVanilla(page);
    await page.locator('.rte-toolbar button[aria-label="Математическая формула"]').click();
    const dialog = page.locator('.rte-modal:not([hidden])');
    await expect(dialog).toBeVisible();
    // MathLive грузится лениво и, догрузившись, забирает фокус в поле формулы.
    // Дождёмся этого, иначе он перехватит фокус уже у вкладки.
    await expect(dialog.locator('math-field')).toBeFocused({ timeout: 20_000 });

    const math = dialog.getByRole('tab', { name: 'Математика' });
    const chem = dialog.getByRole('tab', { name: 'Химия' });
    await expect(math).toHaveAttribute('aria-selected', 'true');
    await expect(chem).toHaveAttribute('tabindex', '-1');

    await math.focus();
    await page.keyboard.press('ArrowRight');
    await expect(chem).toBeFocused();
    await expect(chem).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('.rte-modal__title')).toHaveText('Химическая формула');

    const panel = dialog.locator('.rte-formula-editor__panel');
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', await chem.getAttribute('id') ?? '');

    // Категории шаблонов — тоже вкладки: вправо — следующая категория и её галерея.
    const categories = dialog.locator('.rte-formula-editor__categories [role="tab"]');
    await categories.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(categories.nth(1)).toBeFocused();
    await expect(categories.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('.rte-formula-editor__template').first()).toHaveAttribute(
      'aria-label',
      /\S/,
    );
  });

  test('Enter на выделенной формуле открывает её редактор', async ({ page, isMobile }) => {
    // ProseMirror намеренно не обрабатывает keydown Enter в Chrome на Android:
    // там он приходит частью композиции. На телефоне формулу открывают касанием.
    test.skip(isMobile, 'Enter в Chrome на Android не доходит до сочетаний ProseMirror');
    await caretIntoParagraph(page);
    await page.evaluate(() => {
      const mathml =
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><msup><mi>x</mi><mn>2</mn></msup>' +
        '<annotation encoding="application/x-tex">x^2</annotation></semantics></math>';
      (window as unknown as { vanillaEditor: { core: VanillaCore } }).vanillaEditor.core.insertFormula(
        mathml,
        'math',
      );
    });
    const formula = page.locator(`${EDITOR} .rte-formula`);
    await expect(formula).toHaveAttribute('role', 'img');
    await expect(formula).toHaveAttribute('aria-label', 'x^2');

    // Стрелка влево с позиции сразу за формулой выделяет её как узел.
    await page.keyboard.press('ArrowLeft');
    await expect(formula).toHaveClass(/rte-formula--selected/);
    await page.keyboard.press('Enter');

    const dialog = page.locator('.rte-modal:not([hidden])');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.rte-modal__title')).toHaveText('Математическая формула');
    await expect(dialog.getByRole('button', { name: 'Удалить формулу' })).toBeVisible();
  });

  test('Ctrl+K открывает диалог ссылки из документа', async ({ page }) => {
    await caretIntoParagraph(page);

    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.locator('.rte-modal:not([hidden])');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.rte-modal__title')).toHaveText('Ссылка');
    await expect(dialog.locator('input[type="url"]')).toBeFocused();
  });
});
