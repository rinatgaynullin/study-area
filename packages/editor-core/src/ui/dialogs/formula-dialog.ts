import type { MathfieldElement } from 'mathlive';
import { MATHLIVE_STRINGS } from '../../i18n/mathlive';
import { latexToMathML, mathmlToLatex } from '../../formula/mathml';
import { getTemplateCategories } from '../../formula/templates';
import type { FormulaTemplate, TemplateCategory } from '../../formula/templates';
import type { FormulaPayload, FormulaType } from '../../types';
import { createDisposer, el, icon, on } from '../dom';
import { createModal } from '../modal';
import type { DialogComponent, EditorUiContext } from '../types';
import { getCachedLatexPreview, renderLatexPreview } from './formula-preview';

export interface FormulaDialogOptions {
  /** Откуда MathLive берёт шрифты; `null` — считать, что CSS уже подключён. */
  fontsDirectory?: string | null;
  /** Язык меню и подсказок самого MathLive. */
  locale: string;
  onSave(payload: FormulaPayload): void;
  onRemove(pos: number): void;
}

/** Состояние загрузки MathLive: он подгружается лениво и может не доехать. */
type FieldStatus = 'idle' | 'loading' | 'failed';

/** Заглушка на кнопке шаблона. Означает «превью рисуется прямо сейчас». */
const PREVIEW_PLACEHOLDER = '…';

/**
 * Визуальный редактор формул: вкладки математика/химия, галерея шаблонов по
 * категориям и живое превью.
 *
 * Формула хранится в документе как MathML, а правится как LaTeX: MathLive
 * умеет отдавать MathML, но не умеет его читать, поэтому LaTeX едет внутри
 * самого MathML аннотацией, а диалог достаёт его через `mathmlToLatex`.
 */
export function createFormulaDialog(
  context: EditorUiContext,
  options: FormulaDialogOptions,
): DialogComponent<FormulaPayload | null> {
  const { t } = context;
  const disposer = createDisposer();

  let payload: FormulaPayload | null = null;
  let type: FormulaType = 'math';
  let latex = '';
  let activeCategoryId = '';
  let field: MathfieldElement | null = null;

  /**
   * Номер последнего запуска отрисовки. Рендер асинхронный, а вкладку можно
   * переключить раньше, чем он закончится: ответы прошлых запусков отбрасываем
   * по номеру, иначе в галерею попадут чужие формулы.
   */
  let galleryToken = 0;
  let previewToken = 0;
  let openToken = 0;

  // --------------------------------------------------------------- разметка

  function createTab(iconName: string, labelKey: string): HTMLButtonElement {
    return el('button', {
      class: 'rte-formula-editor__tab',
      attrs: { type: 'button', role: 'tab' },
      children: [icon(iconName, 16), document.createTextNode(t(labelKey))],
    });
  }

  const mathTab = createTab('formulaMath', 'formula_tab_math');
  const chemTab = createTab('formulaChem', 'formula_tab_chem');
  const tabs = el('div', {
    class: 'rte-formula-editor__tabs',
    attrs: { role: 'tablist' },
    children: [mathTab, chemTab],
  });

  const status = el('p', { class: 'rte-formula-editor__status' });
  status.hidden = true;

  const host = el('div', { class: 'rte-formula-editor__host' });
  const input = el('div', {
    class: 'rte-formula-editor__input',
    children: [
      host,
      el('p', { class: 'rte-formula-editor__hint', text: t('formula_input_hint') }),
    ],
  });

  const categoryList = el('div', {
    class: 'rte-formula-editor__categories',
    attrs: { role: 'tablist' },
  });
  const gallery = el('div', { class: 'rte-formula-editor__gallery' });
  const templates = el('section', {
    class: 'rte-formula-editor__templates',
    children: [
      el('h3', { class: 'rte-formula-editor__section-title', text: t('formula_templates') }),
      categoryList,
      gallery,
    ],
  });

  const previewContent = el('span');
  const preview = el('section', {
    class: 'rte-formula-editor__preview',
    children: [
      el('h3', { class: 'rte-formula-editor__section-title', text: t('formula_preview') }),
      el('div', { class: 'rte-formula-editor__preview-box', children: [previewContent] }),
    ],
  });

  const modal = createModal({
    title: t('formula_title_math'),
    closeLabel: t('common_close'),
    wide: true,
  });

  modal.body.appendChild(
    el('div', {
      class: 'rte-formula-editor',
      children: [tabs, status, input, templates, preview],
    }),
  );

  const removeButton = el('button', {
    class: 'rte-button rte-button--danger',
    attrs: { type: 'button' },
    text: t('formula_remove'),
  });
  const cancelButton = el('button', {
    class: 'rte-button',
    attrs: { type: 'button' },
    text: t('formula_cancel'),
  });
  const saveButton = el('button', {
    class: 'rte-button rte-button--primary',
    attrs: { type: 'button' },
    text: t('formula_insert'),
  });

  modal.footer.append(
    removeButton,
    el('span', { class: 'rte-modal__spacer' }),
    cancelButton,
    saveButton,
  );

  // ---------------------------------------------------------------- чтение

  function isEditing(): boolean {
    return typeof payload?.pos === 'number';
  }

  function categories(): TemplateCategory[] {
    return getTemplateCategories(type);
  }

  function findActiveCategory(): TemplateCategory | undefined {
    return categories().find((category) => category.id === activeCategoryId);
  }

  // -------------------------------------------------------------- отрисовка

  function setStatus(next: FieldStatus): void {
    status.hidden = next === 'idle';
    if (next === 'idle') return;

    const isFailed = next === 'failed';
    status.className = isFailed
      ? 'rte-formula-editor__status rte-field__error'
      : 'rte-formula-editor__status';
    status.textContent = isFailed ? t('formula_invalid') : t('formula_loading');
  }

  function syncTabs(): void {
    for (const [tab, tabType] of [
      [mathTab, 'math'],
      [chemTab, 'chem'],
    ] as const) {
      const isActive = type === tabType;
      tab.className = isActive
        ? 'rte-formula-editor__tab rte-formula-editor__tab--active'
        : 'rte-formula-editor__tab';
      tab.setAttribute('aria-selected', String(isActive));
    }
  }

  function syncFooter(): void {
    removeButton.hidden = !isEditing();
    saveButton.textContent = isEditing() ? t('formula_save') : t('formula_insert');
    saveButton.disabled = latex.trim() === '';
  }

  function renderCategories(): void {
    categoryList.replaceChildren(
      ...categories().map((category) => {
        const isActive = category.id === activeCategoryId;
        return el('button', {
          class: isActive
            ? 'rte-formula-editor__category rte-formula-editor__category--active'
            : 'rte-formula-editor__category',
          attrs: {
            type: 'button',
            role: 'tab',
            'aria-selected': String(isActive),
            'data-category-id': category.id,
          },
          text: t(category.labelKey),
        });
      }),
    );
  }

  /** Неудача рендера не должна ронять галерею: она показывает запасной текст. */
  async function renderPreviewSafely(source: string, previewType: FormulaType): Promise<string> {
    try {
      return await renderLatexPreview(source, previewType);
    } catch {
      return '';
    }
  }

  async function fillTemplatePreview(
    target: HTMLElement,
    template: FormulaTemplate,
    previewType: FormulaType,
    token: number,
  ): Promise<void> {
    const svg = await renderPreviewSafely(template.preview, previewType);
    // Галерея успела смениться — результат уже не для этой кнопки.
    if (token !== galleryToken) return;

    // Разметка от MathJax, уже прошедшая санитайзер, — не пользовательская.
    if (svg) target.innerHTML = svg;
    // Не отрисовалось — показываем исходный LaTeX. Заглушка «…» означает
    // «рисуем сейчас», а не «не получилось», иначе кнопка врёт о своём
    // состоянии до конца жизни диалога.
    else target.textContent = template.preview;
  }

  /**
   * Рисует превью только для видимой категории: рендерить весь каталог
   * расточительно, категорий полтора десятка, а видна одна.
   *
   * Вызывается явно при открытии диалога и при каждой смене вкладки, а не по
   * факту изменения категории: при повторном открытии категория остаётся той
   * же, и проверка «значение изменилось» оставила бы кнопки с заглушками.
   */
  function renderGallery(): void {
    const token = (galleryToken += 1);
    const category = findActiveCategory();
    const buttons: HTMLElement[] = [];

    for (const template of category?.templates ?? []) {
      const target = el('span', { class: 'rte-formula-editor__template-preview' });

      // Кэш читаем синхронно: иначе уже отрисованная галерея на каждом
      // открытии моргала бы заглушкой в ожидании микрозадачи.
      const cached = category ? getCachedLatexPreview(template.preview, category.type) : undefined;
      if (cached) {
        target.innerHTML = cached;
      } else if (category) {
        target.textContent = PREVIEW_PLACEHOLDER;
        void fillTemplatePreview(target, template, category.type, token);
      }

      buttons.push(
        el('button', {
          class: 'rte-formula-editor__template',
          attrs: { type: 'button', 'data-template-id': template.id },
          children: [target],
        }),
      );
    }

    gallery.replaceChildren(...buttons);
  }

  function showPreviewMessage(message: string): void {
    previewContent.className = 'rte-formula-editor__empty';
    previewContent.textContent = message;
  }

  function renderPreview(): void {
    const token = (previewToken += 1);
    const value = latex.trim();

    if (!value) {
      showPreviewMessage(t('formula_empty'));
      return;
    }

    void (async () => {
      const svg = await renderPreviewSafely(value, type);
      if (token !== previewToken) return;

      if (!svg) {
        showPreviewMessage(t('formula_invalid'));
        return;
      }

      previewContent.className = '';
      previewContent.innerHTML = svg;
    })();
  }

  // --------------------------------------------------------------- действия

  function setLatex(value: string): void {
    latex = value;
    saveButton.disabled = latex.trim() === '';
    renderPreview();
  }

  function setType(next: FormulaType): void {
    if (type === next) return;

    type = next;
    activeCategoryId = categories()[0]?.id ?? '';
    modal.setTitle(type === 'chem' ? t('formula_title_chem') : t('formula_title_math'));
    syncTabs();
    renderCategories();
    renderGallery();
    // Одна и та же запись в математике и в химии выглядит по-разному.
    renderPreview();
  }

  function setCategory(id: string): void {
    activeCategoryId = id;
    renderCategories();
    renderGallery();
  }

  function applyTemplate(template: FormulaTemplate): void {
    if (!field) return;
    field.insert(template.latex, { selectionMode: 'placeholder', focus: true });
    setLatex(field.value);
  }

  /** MathLive тяжёлый и работает только в браузере — грузим при первом показе. */
  async function ensureMathfield(): Promise<void> {
    if (field || typeof window === 'undefined') return;

    setStatus('loading');
    try {
      const { MathfieldElement: MathfieldCtor } = await import('mathlive');
      MathfieldCtor.soundsDirectory = null;
      if (options.fontsDirectory !== undefined) {
        MathfieldCtor.fontsDirectory = options.fontsDirectory;
      }

      // Русского перевода MathLive не поставляет, и без этой таблицы его меню
      // осталось бы английским. Локаль и строки живут на самом классе, а не на
      // экземпляре, поэтому задаются один раз — при загрузке.
      MathfieldCtor.strings = MATHLIVE_STRINGS;
      MathfieldCtor.locale = options.locale;

      const created = new MathfieldCtor({
        defaultMode: 'math',
        // Диалог — десктопная форма с галереей шаблонов; собственная экранная
        // клавиатура MathLive дублирует её и закрывает превью. 'manual'
        // не даёт ей открываться по фокусу, кнопка вызова скрыта в CSS.
        mathVirtualKeyboardPolicy: 'manual',
      });
      created.className = 'rte-formula-editor__field';
      // Модалка отдаёт фокус помеченному элементу — каретка должна оказаться
      // в поле формулы, а не на первой кнопке.
      created.setAttribute('data-autofocus', '');
      disposer.add(on(created, 'input', () => setLatex(created.value)));

      field = created;
      setStatus('idle');
    } catch {
      setStatus('failed');
    }
  }

  async function prepareField(token: number): Promise<void> {
    await ensureMathfield();
    // Диалог успели открыть заново, пока грузился MathLive.
    if (token !== openToken || !field) return;

    host.replaceChildren(field);

    // Существующая формула открывается из сохранённого MathML.
    const nextLatex = payload?.mathml ? await mathmlToLatex(payload.mathml) : '';
    if (token !== openToken || !field) return;

    field.value = nextLatex;
    setLatex(nextLatex);
    field.focus();
  }

  async function save(): Promise<void> {
    const value = latex.trim();
    if (!value) return;

    const mathml = await latexToMathML(value, type);
    if (!mathml) return;

    options.onSave({ mathml, type, pos: payload?.pos ?? null });
    modal.close();
  }

  function remove(): void {
    const pos = payload?.pos;
    if (typeof pos === 'number') options.onRemove(pos);
    modal.close();
  }

  function open(next: FormulaPayload | null): void {
    payload = next;
    type = next?.type ?? 'math';
    activeCategoryId = categories()[0]?.id ?? '';

    modal.setTitle(type === 'chem' ? t('formula_title_chem') : t('formula_title_math'));
    syncTabs();
    setLatex('');
    syncFooter();
    renderCategories();
    renderGallery();

    modal.open();
    openToken += 1;
    void prepareField(openToken);
  }

  // --------------------------------------------------------------- события

  disposer.add(on(mathTab, 'click', () => setType('math')));
  disposer.add(on(chemTab, 'click', () => setType('chem')));
  disposer.add(on(cancelButton, 'click', () => modal.close()));
  disposer.add(on(removeButton, 'click', remove));
  disposer.add(on(saveButton, 'click', () => void save()));

  // Кнопки категорий и шаблонов пересобираются на каждой смене вкладки,
  // поэтому слушатель один — на контейнере, а не на каждой кнопке.
  disposer.add(
    on(categoryList, 'click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const id = target.closest<HTMLElement>('[data-category-id]')?.dataset.categoryId;
      if (id) setCategory(id);
    }),
  );

  disposer.add(
    on(gallery, 'click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const id = target.closest<HTMLElement>('[data-template-id]')?.dataset.templateId;
      if (!id) return;

      const template = findActiveCategory()?.templates.find((item) => item.id === id);
      if (template) applyTemplate(template);
    }),
  );

  return {
    element: modal.element,
    open,
    close: () => modal.close(),
    get isVisible() {
      return modal.isVisible;
    },
    destroy: () => {
      disposer.dispose();
      field?.remove();
      field = null;
      modal.destroy();
    },
  };
}
