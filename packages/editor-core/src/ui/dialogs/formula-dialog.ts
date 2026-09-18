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

/** Счётчик для уникальных id: вкладки ссылаются на свою панель, панель — на вкладку. */
let formulaDialogCount = 0;

/**
 * Клавиатура списка вкладок (паттерн ARIA tabs): ← → ходят по вкладкам по
 * кругу, Home/End — к краям, и выбирают вкладку сразу. Список — одна
 * остановка Tab'а: у активной вкладки tabindex 0, у остальных −1.
 */
function onTablistKeydown(event: KeyboardEvent, tabs: HTMLElement[], select: (tab: HTMLElement) => void): void {
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  if (current === -1 || tabs.length === 0) return;

  const moves: Record<string, number> = {
    ArrowRight: current + 1,
    ArrowLeft: current - 1,
    Home: 0,
    End: tabs.length - 1,
  };
  const next = moves[event.key];
  if (next === undefined) return;

  event.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length];
  select(tab);
  // Выбор мог пересобрать вкладки (категории рисуются заново) — фокусируем
  // ту, что теперь в разметке под тем же id.
  (document.getElementById(tab.id) ?? tab).focus();
}

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

  formulaDialogCount += 1;
  const idPrefix = `rte-formula-${formulaDialogCount}`;
  const panelId = `${idPrefix}-panel`;
  const galleryId = `${idPrefix}-gallery`;
  const hintId = `${idPrefix}-hint`;

  function createTab(iconName: string, labelKey: string, type: FormulaType): HTMLButtonElement {
    return el('button', {
      class: 'rte-formula-editor__tab',
      attrs: { type: 'button', role: 'tab', id: `${idPrefix}-tab-${type}`, 'aria-controls': panelId },
      children: [icon(iconName, 16), document.createTextNode(t(labelKey))],
    });
  }

  const mathTab = createTab('formulaMath', 'formula_tab_math', 'math');
  const chemTab = createTab('formulaChem', 'formula_tab_chem', 'chem');
  const tabs = el('div', {
    class: 'rte-formula-editor__tabs',
    attrs: { role: 'tablist' },
    children: [mathTab, chemTab],
  });

  // Загрузка и ошибка объявляются сами: ждать их взглядом читалка не может.
  const status = el('p', { class: 'rte-formula-editor__status', attrs: { role: 'status' } });
  status.hidden = true;

  const host = el('div', { class: 'rte-formula-editor__host' });
  const input = el('div', {
    class: 'rte-formula-editor__input',
    children: [
      host,
      el('p', { class: 'rte-formula-editor__hint', text: t('formula_input_hint'), attrs: { id: hintId } }),
    ],
  });

  const categoryList = el('div', {
    class: 'rte-formula-editor__categories',
    attrs: { role: 'tablist', 'aria-label': t('formula_templates') },
  });
  const gallery = el('div', {
    class: 'rte-formula-editor__gallery',
    attrs: { role: 'tabpanel', id: galleryId },
  });
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
      // Сообщения «формула пуста» и «не удалось разобрать» читалка слышит;
      // сама картинка формулы ей ни о чём не говорит.
      el('div', {
        class: 'rte-formula-editor__preview-box',
        attrs: { 'aria-live': 'polite' },
        children: [previewContent],
      }),
    ],
  });

  const modal = createModal({
    title: t('formula_title_math'),
    closeLabel: t('common_close'),
    wide: true,
  });

  // Всё под вкладками — их панель: поле, шаблоны и превью зависят от типа.
  const panel = el('div', {
    class: 'rte-formula-editor__panel',
    attrs: { role: 'tabpanel', id: panelId },
    children: [status, input, templates, preview],
  });

  modal.body.appendChild(
    el('div', {
      class: 'rte-formula-editor',
      children: [tabs, panel],
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

  function syncTab(tab: HTMLButtonElement, tabType: FormulaType): void {
    const isActive = type === tabType;
    tab.className = isActive
      ? 'rte-formula-editor__tab rte-formula-editor__tab--active'
      : 'rte-formula-editor__tab';
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    if (isActive) panel.setAttribute('aria-labelledby', tab.id);
  }

  function syncTabs(): void {
    syncTab(mathTab, 'math');
    syncTab(chemTab, 'chem');
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
        const id = `${idPrefix}-category-${category.id}`;
        if (isActive) gallery.setAttribute('aria-labelledby', id);
        return el('button', {
          class: isActive
            ? 'rte-formula-editor__category rte-formula-editor__category--active'
            : 'rte-formula-editor__category',
          attrs: {
            type: 'button',
            role: 'tab',
            id,
            'aria-selected': String(isActive),
            'aria-controls': galleryId,
            tabindex: isActive ? 0 : -1,
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

    if (svg) {
      // Разметка от MathJax, уже прошедшая санитайзер, — не пользовательская.
      target.innerHTML = svg;
      return;
    }

    // Не отрисовалось — показываем исходный LaTeX. Заглушка «…» означает
    // «рисуем сейчас», а не «не получилось»: иначе кнопка врала бы о своём
    // состоянии до конца жизни диалога.
    target.textContent = template.preview;
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

    if (!category) {
      gallery.replaceChildren();
      return;
    }

    gallery.replaceChildren(
      ...category.templates.map((template) => {
        // Картинка превью читалке не нужна — имя кнопки даёт сам LaTeX.
        const target = el('span', {
          class: 'rte-formula-editor__template-preview',
          attrs: { 'aria-hidden': 'true' },
        });

        // Кэш читаем синхронно: иначе уже отрисованная галерея на каждом
        // открытии моргала бы заглушкой в ожидании микрозадачи.
        const cached = getCachedLatexPreview(template.preview, category.type);
        if (cached) {
          target.innerHTML = cached;
        } else {
          target.textContent = PREVIEW_PLACEHOLDER;
          void fillTemplatePreview(target, template, category.type, token);
        }

        return el('button', {
          class: 'rte-formula-editor__template',
          attrs: {
            type: 'button',
            'data-template-id': template.id,
            title: template.preview,
            'aria-label': template.preview,
          },
          children: [target],
        });
      }),
    );
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
      const { MathfieldElement: MathfieldConstructor } = await import('mathlive');
      MathfieldConstructor.soundsDirectory = null;
      if (options.fontsDirectory !== undefined) {
        MathfieldConstructor.fontsDirectory = options.fontsDirectory;
      }

      // Русского перевода MathLive не поставляет, и без этой таблицы его меню
      // осталось бы английским. Локаль и строки живут на самом классе, а не на
      // экземпляре, поэтому задаются один раз — при загрузке.
      MathfieldConstructor.strings = MATHLIVE_STRINGS;
      MathfieldConstructor.locale = options.locale;

      const created = new MathfieldConstructor({
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
      // Поле без имени читалка объявляет как «поле математики»; подсказка
      // под ним — его описание.
      created.setAttribute('aria-label', t('formula_input_hint'));
      created.setAttribute('aria-describedby', hintId);
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
    void prepareField((openToken += 1));
  }

  // --------------------------------------------------------------- события

  disposer.add(on(mathTab, 'click', () => setType('math')));
  disposer.add(on(chemTab, 'click', () => setType('chem')));
  disposer.add(
    on(tabs, 'keydown', (event) =>
      onTablistKeydown(event, [mathTab, chemTab], (tab) =>
        setType(tab === chemTab ? 'chem' : 'math'),
      ),
    ),
  );
  disposer.add(
    on(categoryList, 'keydown', (event) =>
      onTablistKeydown(event, [...categoryList.querySelectorAll<HTMLElement>('[role="tab"]')], (tab) => {
        const id = tab.dataset.categoryId;
        if (id) setCategory(id);
      }),
    ),
  );
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
