import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRichEditor, type RichEditorUi } from '../src/index';
import { MATHLIVE_STRINGS } from '../src/i18n/mathlive';

/**
 * Диалог формул целиком, но с поддельным MathLive: настоящий в jsdom не
 * монтируется (нет раскладки и шрифтов). Подделка запоминает то, что диалог
 * ей передал, — политику клавиатуры и пункты меню, — и даёт править значение
 * так, как это делает пользователь: присвоить и послать `input`.
 *
 * Конвертация LaTeX → MathML настоящая: под Node `mathlive/ssr` и `mathlive`
 * — один модуль, поэтому подменяется только класс поля, остальное — оригинал.
 */
const { FakeMathfield, loadFailure } = vi.hoisted(() => {
  /** Взведённый флаг роняет создание поля — ту же ветку, что отказ `import`. */
  const loadFailure = { armed: false };

  class FakeMathfield extends HTMLElement {
    static fontsDirectory: string | null = null;

    static soundsDirectory: string | null = null;

    static strings: Record<string, unknown> = {};

    static locale = '';

    value = '';

    menuItems: readonly unknown[] | undefined = undefined;

    readonly mathVirtualKeyboardPolicy: string;

    constructor(options: { mathVirtualKeyboardPolicy?: string } = {}) {
      super();

      if (loadFailure.armed) {
        loadFailure.armed = false;
        throw new Error('MathLive не загрузился');
      }

      this.mathVirtualKeyboardPolicy = options.mathVirtualKeyboardPolicy ?? 'auto';
    }

    insert(latex: string): void {
      this.value = `${this.value}${latex}`;
    }
  }

  // Один раз: фабрику мока галерея и поле могут вызвать одновременно.
  customElements.define('fake-math-field', FakeMathfield);

  return { FakeMathfield, loadFailure };
});

vi.mock('mathlive', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MathfieldElement: FakeMathfield,
}));

// Формулу без TeX-аннотации переводит в LaTeX этот конвертер; здесь он не
// справляется ни с чем — так выглядит «чужая» формула, которую не открыть.
vi.mock('mathml-to-latex', () => ({
  MathMLToLaTeX: {
    convert: (): string => {
      throw new Error('не разобрать');
    },
  },
}));

interface FakeField extends HTMLElement {
  value: string;
  menuItems: readonly unknown[] | undefined;
  mathVirtualKeyboardPolicy: string;
}

let ui: RichEditorUi | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  ui?.destroy();
  ui = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

const mountEditor = (content = '<p>текст</p>'): RichEditorUi => {
  host = document.createElement('div');
  document.body.appendChild(host);
  ui = createRichEditor({ element: host, content });

  return ui;
};

const openDialog = (): HTMLElement | null => document.querySelector('.rte-modal:not([hidden])');

const formulaOverlay = (): HTMLElement => {
  const overlay = document.querySelector('.rte-formula-editor')?.closest<HTMLElement>('.rte-modal');

  if (!overlay) throw new Error('Нет диалога формул');

  return overlay;
};

const openMathDialog = (): void => {
  const button = document.querySelector<HTMLButtonElement>(
    '.rte-toolbar button[aria-label="Математическая формула"]',
  );

  if (!button) throw new Error('Нет кнопки формулы');

  button.click();
};

/** MathLive грузится лениво (первый раз — заметно долго): ждём поле в диалоге. */
const waitForField = async (): Promise<FakeField> =>
  vi.waitFor(
    () => {
      const field = openDialog()?.querySelector<FakeField>('fake-math-field');

      if (!field) throw new Error('Поле ещё не смонтировано');

      return field;
    },
    { timeout: 10_000 },
  );

const typeIntoField = (field: FakeField, latex: string): void => {
  field.value = latex;
  field.dispatchEvent(new Event('input'));
};

const categoryLabels = (dialog: HTMLElement): string[] =>
  [...dialog.querySelectorAll('.rte-formula-editor__category')].map(
    (category) => category.textContent ?? '',
  );

/** Поддельная экранная клавиатура MathLive: видимость, высота, события и подписчики. */
class FakeKeyboard extends EventTarget {
  visible = false;

  listenerCount = 0;

  addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
    this.listenerCount += 1;
    super.addEventListener(...args);
  }

  removeEventListener(...args: Parameters<EventTarget['removeEventListener']>): void {
    this.listenerCount -= 1;
    super.removeEventListener(...args);
  }

  boundingRect = new DOMRect(0, 0, 0, 0);

  readonly hide = vi.fn(() => {
    this.visible = false;
  });

  showWithHeight(height: number): void {
    this.visible = true;
    this.boundingRect = new DOMRect(0, window.innerHeight - height, window.innerWidth, height);
    this.dispatchEvent(new Event('geometrychange'));
  }
}

const stubCoarsePointer = (): void => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
};

describe('диалог формул', () => {
  it('не показывает блок предпросмотра, а сохранение отдаёт MathML с LaTeX', async () => {
    const editor = mountEditor();

    openMathDialog();

    const dialog = openDialog()!;
    const field = await waitForField();

    expect(dialog.querySelector('.rte-formula-editor__preview')).toBeNull();
    expect(dialog.querySelector('.rte-formula-editor__preview-box')).toBeNull();

    typeIntoField(field, 'a^2+b^2');
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')!.click();

    // Первая конвертация подгружает MathLive SSR — это не мгновенно.
    await vi.waitFor(
      () => {
        expect(openDialog()).toBeNull();
      },
      { timeout: 10_000 },
    );

    const mathml =
      editor.element.querySelector('.rte-content .rte-formula')?.getAttribute('data-mathml') ?? '';

    expect(mathml).toContain('<math');
    expect(mathml).toContain('<annotation encoding="application/x-tex">a^2+b^2</annotation>');
  });

  it('без формулы кнопка вставки выключена и объясняет почему', async () => {
    mountEditor();
    openMathDialog();

    const dialog = openDialog()!;
    const field = await waitForField();
    const save = dialog.querySelector<HTMLButtonElement>('.rte-button--primary')!;

    expect(save.disabled).toBe(true);
    expect(save.title).toBe('Сначала напиши формулу');

    typeIntoField(field, 'x');
    expect(save.disabled).toBe(false);
    expect(save.title).toBe('');
  });

  it('первая категория математики — «Частые», её шаблоны вставляются в поле', async () => {
    mountEditor();
    openMathDialog();

    const dialog = openDialog()!;
    const field = await waitForField();
    const [first] = dialog.querySelectorAll<HTMLButtonElement>('.rte-formula-editor__category');

    expect(first?.textContent).toBe('Частые');
    expect(first?.getAttribute('aria-selected')).toBe('true');

    const templates = dialog.querySelectorAll<HTMLButtonElement>('.rte-formula-editor__template');

    expect(templates.length).toBe(17);
    expect(templates[0]?.dataset.templateId).toBe('fractions.frac');

    templates[0]!.click();

    expect(field.value).toContain('\\frac');
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(false);
  });

  it('шаблон, нажатый до загрузки поля, вставляется, когда поле появилось', async () => {
    mountEditor();
    openMathDialog();

    const dialog = openDialog()!;

    // Сразу, пока MathLive ещё грузится: поля в диалоге нет.
    expect(dialog.querySelector('fake-math-field')).toBeNull();
    dialog.querySelector<HTMLButtonElement>('.rte-formula-editor__template')!.click();

    const field = await waitForField();

    await vi.waitFor(() => {
      expect(field.value).toContain('\\frac');
    });
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(false);
  });

  it('шаблон, нажатый до загрузки поля, не попадает в формулу, открытую после закрытия', async () => {
    mountEditor();
    openMathDialog();
    openDialog()!.querySelector<HTMLButtonElement>('.rte-formula-editor__template')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(openDialog()).toBeNull();

    openMathDialog();

    const field = await waitForField();

    // Даём отложенной вставке шанс сработать, если бы она осталась.
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(field.value).toBe('');
    expect(openDialog()!.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(true);
  });

  it('повторное открытие во время загрузки не создаёт второе поле', async () => {
    const created = vi.spyOn(FakeMathfield.prototype, 'insert');

    mountEditor();
    openMathDialog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    openMathDialog();

    const field = await waitForField();

    openDialog()!.querySelector<HTMLButtonElement>('.rte-formula-editor__template')!.click();

    // Шаблон попал в то самое поле, что стоит в диалоге, и ровно один раз.
    expect(created).toHaveBeenCalledTimes(1);
    expect(field.value).toContain('\\frac');
    expect(document.querySelectorAll('fake-math-field')).toHaveLength(1);
  });

  it('при сбое конвертера в поле не остаётся прошлая формула', async () => {
    const editor = mountEditor('<p>x</p>');

    // Первая формула — с TeX-аннотацией: открывается без конвертера.
    openMathDialog();

    const field = await waitForField();

    typeIntoField(field, 'a+b');
    openDialog()!.querySelector<HTMLButtonElement>('.rte-button--primary')!.click();
    await vi.waitFor(() => {
      expect(openDialog()).toBeNull();
    });

    // Вторая — чужая, без аннотации: конвертер (подделка) её не переводит.
    editor.core.insertFormula(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>y</mi></math>',
      'math',
    );

    const nodes = editor.element.querySelectorAll<HTMLElement>('.rte-content .rte-formula');

    nodes[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(field.value).toBe('a+b');
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    nodes[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(document.querySelector('.rte-formula-editor__status')?.textContent).toBe(
        'Эту формулу не получилось открыть. Напиши её заново',
      );
    });
    expect(field.value).toBe('');
    expect(openDialog()!.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(true);
  });

  it('нажатие на категорию оставляет фокус в поле только на сенсорном устройстве', async () => {
    const pressCategory = (): boolean => {
      const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });

      openDialog()!.querySelector<HTMLButtonElement>('.rte-formula-editor__category')!.dispatchEvent(event);

      return event.defaultPrevented;
    };

    mountEditor();
    openMathDialog();
    await waitForField();
    expect(pressCategory()).toBe(false);

    ui?.destroy();
    host?.remove();

    stubCoarsePointer();
    mountEditor();
    openMathDialog();
    await waitForField();
    expect(pressCategory()).toBe(true);
  });

  it('у химии «Частых» нет: первой остаётся прежняя категория', async () => {
    mountEditor();
    openMathDialog();

    const dialog = openDialog()!;

    await waitForField();
    dialog.querySelectorAll<HTMLButtonElement>('.rte-formula-editor__tab')[1]!.click();

    const labels = categoryLabels(dialog);

    expect(labels[0]).toBe('Реакции');
    expect(labels).not.toContain('Частые');
  });

  it('у поля нет меню MathLive', async () => {
    mountEditor();
    openMathDialog();

    const field = await waitForField();

    expect(field.menuItems).toEqual([]);
  });

  it('с мышью экранная клавиатура открывается только вручную', async () => {
    mountEditor();
    openMathDialog();

    const field = await waitForField();

    expect(field.mathVirtualKeyboardPolicy).toBe('manual');
    expect(field.classList.contains('rte-formula-editor__field--touch')).toBe(false);
  });

  it('с пальцем экранная клавиатура открывается по фокусу', async () => {
    stubCoarsePointer();
    mountEditor();
    openMathDialog();

    const field = await waitForField();

    expect(field.mathVirtualKeyboardPolicy).toBe('auto');
    expect(field.classList.contains('rte-formula-editor__field--touch')).toBe(true);
  });

  it('поднимает диалог над клавиатурой и возвращает всё после закрытия', async () => {
    stubCoarsePointer();

    const keyboard = new FakeKeyboard();

    vi.stubGlobal('mathVirtualKeyboard', keyboard);
    mountEditor();

    // В jsdom нет ни стилей редактора, ни раскладки: слой и рамку оверлея
    // задаём сами — так, как их увидел бы браузер.
    const overlay = formulaOverlay();

    overlay.style.zIndex = '2000';
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, window.innerWidth, window.innerHeight),
    );

    openMathDialog();
    await waitForField();

    // Клавиатура выше модалки, пока диалог открыт.
    expect(document.body.style.getPropertyValue('--keyboard-zindex')).toBe('2001');
    expect(overlay.style.paddingBottom).toBe('');

    keyboard.showWithHeight(300);
    // Высота клавиатуры и зазор над ней.
    expect(overlay.style.paddingBottom).toBe('308px');

    const cancel = [
      ...openDialog()!.querySelectorAll<HTMLButtonElement>('.rte-formula-editor__action'),
    ].find((button) => button.textContent === 'Отмена');

    cancel!.click();

    expect(openDialog()).toBeNull();
    expect(keyboard.hide).toHaveBeenCalled();
    expect(overlay.style.paddingBottom).toBe('');
    expect(document.body.style.getPropertyValue('--keyboard-zindex')).toBe('');

    // Отписались: клавиатура другого поля больше не двигает закрытый диалог.
    keyboard.showWithHeight(300);
    expect(overlay.style.paddingBottom).toBe('');
  });

  it('сообщает, что формулу не удалось понять, и снимает сообщение после правки', async () => {
    mountEditor();
    openMathDialog();

    const dialog = openDialog()!;
    const field = await waitForField();
    const status = dialog.querySelector<HTMLElement>('.rte-formula-editor__status')!;

    // Конвертер не собрал MathML — так бывает с недописанной записью.
    const mathlive = await import('mathlive/ssr');

    vi.spyOn(mathlive, 'convertLatexToMathMl').mockReturnValueOnce('');
    typeIntoField(field, 'x^{');
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')!.click();

    await vi.waitFor(
      () => {
        expect(status.hidden).toBe(false);
      },
      { timeout: 10_000 },
    );

    expect(status.textContent).toBe('Не получилось понять формулу. Проверь, что всё дописано');
    expect(openDialog()).not.toBeNull();

    typeIntoField(field, 'x');
    expect(status.hidden).toBe(true);
  });

  it('отдаёт MathLive русские строки и локаль редактора', async () => {
    mountEditor();
    openMathDialog();
    await waitForField();

    expect(FakeMathfield.strings).toBe(MATHLIVE_STRINGS);
    expect(FakeMathfield.locale).toBe('ru');
  });

  it('destroy при открытом диалоге снимает слой, отступ и подписки клавиатуры', async () => {
    stubCoarsePointer();

    const keyboard = new FakeKeyboard();

    vi.stubGlobal('mathVirtualKeyboard', keyboard);

    const editor = mountEditor();
    const overlay = formulaOverlay();

    overlay.style.zIndex = '2000';
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, window.innerWidth, window.innerHeight),
    );

    const removeWindowListener = vi.spyOn(window, 'removeEventListener');

    openMathDialog();
    await waitForField();
    keyboard.showWithHeight(300);

    expect(overlay.style.paddingBottom).toBe('308px');
    expect(keyboard.listenerCount).toBeGreaterThan(0);

    editor.destroy();
    ui = undefined;

    expect(keyboard.hide).toHaveBeenCalled();
    expect(keyboard.listenerCount).toBe(0);
    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(overlay.style.paddingBottom).toBe('');
    expect(document.body.style.getPropertyValue('--keyboard-zindex')).toBe('');
  });

  it('пересчитывает подъём окна при изменении размера', async () => {
    stubCoarsePointer();

    const keyboard = new FakeKeyboard();

    vi.stubGlobal('mathVirtualKeyboard', keyboard);
    mountEditor();

    const overlay = formulaOverlay();
    const rect = vi
      .spyOn(overlay, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, window.innerWidth, window.innerHeight));

    openMathDialog();
    await waitForField();
    keyboard.showWithHeight(300);
    expect(overlay.style.paddingBottom).toBe('308px');

    // Повернули экран: оверлей стал на 100px ниже, клавиатура той же высоты.
    rect.mockReturnValue(new DOMRect(0, 0, window.innerWidth, window.innerHeight - 100));
    window.dispatchEvent(new Event('resize'));

    await vi.waitFor(() => {
      expect(overlay.style.paddingBottom).toBe('208px');
    });
  });

  it('диалог закрыли до загрузки поля — клавиатура не подключается', async () => {
    stubCoarsePointer();

    const keyboard = new FakeKeyboard();

    vi.stubGlobal('mathVirtualKeyboard', keyboard);
    mountEditor();

    const overlay = formulaOverlay();

    overlay.style.zIndex = '2000';
    openMathDialog();
    // Сразу, пока MathLive ещё грузится.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(openDialog()).toBeNull();

    await vi.waitFor(
      () => {
        expect(overlay.querySelector('fake-math-field')).not.toBeNull();
      },
      { timeout: 10_000 },
    );

    expect(keyboard.listenerCount).toBe(0);
    expect(document.body.style.getPropertyValue('--keyboard-zindex')).toBe('');
  });

  it('три разных сбоя — три разных объяснения', async () => {
    const statusText = (): string =>
      document.querySelector<HTMLElement>('.rte-formula-editor__status')?.textContent ?? '';

    // Не загрузился MathLive: поля нет, вставить нечего.
    loadFailure.armed = true;
    mountEditor();
    openMathDialog();

    await vi.waitFor(() => {
      expect(statusText()).toBe(
        'Не получилось открыть редактор формул. Проверь интернет и попробуй ещё раз',
      );
    });

    const loadFailed = statusText();

    expect(openDialog()!.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(
      true,
    );

    ui?.destroy();
    host?.remove();

    // Формулу из документа не перевести в LaTeX: поле пустое, объяснение своё.
    const editor = mountEditor('<p>x</p>');

    editor.core.insertFormula(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>',
      'math',
    );

    const node = editor.element.querySelector<HTMLElement>('.rte-content .rte-formula')!;

    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const field = await waitForField();

    await vi.waitFor(() => {
      expect(statusText()).toBe('Эту формулу не получилось открыть. Напиши её заново');
    });

    const unreadable = statusText();

    expect(field.value).toBe('');

    // Запись не разобралась при сохранении.
    const mathlive = await import('mathlive/ssr');

    vi.spyOn(mathlive, 'convertLatexToMathMl').mockReturnValueOnce('');
    typeIntoField(field, 'x^{');
    openDialog()!.querySelector<HTMLButtonElement>('.rte-button--primary')!.click();

    await vi.waitFor(() => {
      expect(statusText()).toBe('Не получилось понять формулу. Проверь, что всё дописано');
    });

    expect(new Set([loadFailed, unreadable, statusText()]).size).toBe(3);
  });
});
