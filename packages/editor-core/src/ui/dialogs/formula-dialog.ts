import type { MathfieldElement } from 'mathlive';
import { MATHLIVE_STRINGS } from '../../i18n/mathlive';
import { latexToMathML, mathmlToLatex } from '../../formula/mathml';
import { getTemplateCategories } from '../../formula/templates';
import type { FormulaTemplate, TemplateCategory } from '../../formula/templates';
import type { FormulaPayload, FormulaType, Translate } from '../../types';
import { createDisposer, el, icon, on } from '../dom';
import { createModal } from '../modal';
import type { Modal } from '../modal';
import type { DialogComponent, EditorUiContext } from '../types';
import { getCachedLatexPreview, renderLatexPreview } from './formula-preview';

interface FormulaDialogOptions {
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
const onTablistKeydown = (
  event: KeyboardEvent,
  tabs: HTMLElement[],
  select: (tab: HTMLElement) => void,
): void => {
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

  if (!tab) return;

  select(tab);
  // Выбор мог пересобрать вкладки (категории рисуются заново) — фокусируем
  // ту, что теперь в разметке под тем же id.
  (document.getElementById(tab.id) ?? tab).focus();
};

/**
 * Неудача рендера не должна ронять галерею и превью: вместо SVG приходит
 * пустая строка, и вызывающий показывает запасной текст. Промис никогда не
 * отклоняется — поэтому его результата можно не ждать.
 */
const renderPreviewSafely = async (source: string, previewType: FormulaType): Promise<string> => {
  try {
    return await renderLatexPreview(source, previewType);
  } catch {
    return '';
  }
};

/**
 * Визуальный редактор формул: вкладки математика/химия, галерея шаблонов по
 * категориям и живое превью.
 *
 * Формула хранится в документе как MathML, а правится как LaTeX: MathLive
 * умеет отдавать MathML, но не умеет его читать, поэтому LaTeX едет внутри
 * самого MathML аннотацией, а диалог достаёт его через `mathmlToLatex`.
 *
 * Класс, а не набор замыканий: тип формулы, текущий LaTeX, категория, поле
 * MathLive и счётчики отрисовок — общее изменяемое состояние, к которому
 * обращаются и обработчики, и асинхронные шаги загрузки.
 */
class FormulaDialogController implements DialogComponent<FormulaPayload | null> {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private payload: FormulaPayload | null = null;

  private type: FormulaType = 'math';

  private latex = '';

  private activeCategoryId = '';

  private field: MathfieldElement | null = null;

  /**
   * Номер последнего запуска отрисовки. Рендер асинхронный, а вкладку можно
   * переключить раньше, чем он закончится: ответы прошлых запусков отбрасываем
   * по номеру, иначе в галерею попадут чужие формулы.
   */
  private galleryToken = 0;

  private previewToken = 0;

  private openToken = 0;

  private readonly idPrefix: string;

  private readonly panelId: string;

  private readonly galleryId: string;

  private readonly hintId: string;

  private readonly mathTab: HTMLButtonElement;

  private readonly chemTab: HTMLButtonElement;

  /** Загрузка и ошибка объявляются сами: ждать их взглядом читалка не может. */
  private readonly status: HTMLElement;

  private readonly host: HTMLElement;

  private readonly categoryList: HTMLElement;

  private readonly gallery: HTMLElement;

  private readonly previewContent: HTMLElement;

  /** Всё под вкладками — их панель: поле, шаблоны и превью зависят от типа. */
  private readonly panel: HTMLElement;

  private readonly modal: Modal;

  private readonly removeButton: HTMLButtonElement;

  private readonly cancelButton: HTMLButtonElement;

  private readonly saveButton: HTMLButtonElement;

  constructor(
    context: EditorUiContext,
    private readonly options: FormulaDialogOptions,
  ) {
    const { t } = context;

    this.t = t;

    // --------------------------------------------------------------- разметка

    formulaDialogCount += 1;

    this.idPrefix = `rte-formula-${formulaDialogCount}`;
    this.panelId = `${this.idPrefix}-panel`;
    this.galleryId = `${this.idPrefix}-gallery`;
    this.hintId = `${this.idPrefix}-hint`;

    this.mathTab = this.createTab('formulaMath', 'formula_tab_math', 'math');
    this.chemTab = this.createTab('formulaChem', 'formula_tab_chem', 'chem');

    const tabs = el('div', {
      class: 'rte-formula-editor__tabs',
      attrs: { role: 'tablist' },
      children: [this.mathTab, this.chemTab],
    });

    this.status = el('p', { class: 'rte-formula-editor__status', attrs: { role: 'status' } });
    this.status.hidden = true;

    this.host = el('div', { class: 'rte-formula-editor__host' });

    const input = el('div', {
      class: 'rte-formula-editor__input',
      children: [
        this.host,
        el('p', {
          class: 'rte-formula-editor__hint',
          text: t('formula_input_hint'),
          attrs: { id: this.hintId },
        }),
      ],
    });

    this.categoryList = el('div', {
      class: 'rte-formula-editor__categories',
      attrs: { role: 'tablist', 'aria-label': t('formula_templates') },
    });

    this.gallery = el('div', {
      class: 'rte-formula-editor__gallery',
      attrs: { role: 'tabpanel', id: this.galleryId },
    });

    const templates = el('section', {
      class: 'rte-formula-editor__templates',
      children: [
        el('h3', { class: 'rte-formula-editor__section-title', text: t('formula_templates') }),
        this.categoryList,
        this.gallery,
      ],
    });

    this.previewContent = el('span');

    const preview = el('section', {
      class: 'rte-formula-editor__preview',
      children: [
        el('h3', { class: 'rte-formula-editor__section-title', text: t('formula_preview') }),
        // Сообщения «формула пуста» и «не удалось разобрать» читалка слышит;
        // сама картинка формулы ей ни о чём не говорит.
        el('div', {
          class: 'rte-formula-editor__preview-box',
          attrs: { 'aria-live': 'polite' },
          children: [this.previewContent],
        }),
      ],
    });

    this.modal = createModal({
      title: t('formula_title_math'),
      closeLabel: t('common_close'),
      wide: true,
    });

    this.panel = el('div', {
      class: 'rte-formula-editor__panel',
      attrs: { role: 'tabpanel', id: this.panelId },
      children: [this.status, input, templates, preview],
    });

    this.modal.body.appendChild(
      el('div', {
        class: 'rte-formula-editor',
        children: [tabs, this.panel],
      }),
    );

    this.removeButton = el('button', {
      class: 'rte-button rte-button--danger',
      attrs: { type: 'button' },
      text: t('formula_remove'),
    });

    this.cancelButton = el('button', {
      class: 'rte-button',
      attrs: { type: 'button' },
      text: t('formula_cancel'),
    });

    this.saveButton = el('button', {
      class: 'rte-button rte-button--primary',
      attrs: { type: 'button' },
      text: t('formula_insert'),
    });

    this.modal.footer.append(
      this.removeButton,
      el('span', { class: 'rte-modal__spacer' }),
      this.cancelButton,
      this.saveButton,
    );

    this.element = this.modal.element;

    // --------------------------------------------------------------- события

    this.disposer.add(on(this.mathTab, 'click', this.onMathTabClick));
    this.disposer.add(on(this.chemTab, 'click', this.onChemTabClick));
    this.disposer.add(on(tabs, 'keydown', this.onTabsKeydown));
    this.disposer.add(on(this.categoryList, 'keydown', this.onCategoryListKeydown));
    this.disposer.add(on(this.cancelButton, 'click', this.onCancelButtonClick));
    this.disposer.add(on(this.removeButton, 'click', this.onRemoveButtonClick));
    this.disposer.add(on(this.saveButton, 'click', this.onSaveButtonClick));

    // Кнопки категорий и шаблонов пересобираются на каждой смене вкладки,
    // поэтому слушатель один — на контейнере, а не на каждой кнопке.
    this.disposer.add(on(this.categoryList, 'click', this.onCategoryListClick));
    this.disposer.add(on(this.gallery, 'click', this.onGalleryClick));
  }

  get isVisible(): boolean {
    return this.modal.isVisible;
  }

  /** Открывает диалог: с формулой из документа — на правку, с `null` — на вставку. */
  open(next: FormulaPayload | null): void {
    this.payload = next;
    this.type = next?.type ?? 'math';
    this.activeCategoryId = this.getCategories()[0]?.id ?? '';

    this.modal.setTitle(
      this.type === 'chem' ? this.t('formula_title_chem') : this.t('formula_title_math'),
    );

    this.syncTabs();
    this.setLatex('');
    this.syncFooter();
    this.renderCategories();
    this.renderGallery();
    // Сообщение о прошлом сбое конвертации не должно пережить повторное
    // открытие; загрузку MathLive prepareField объявит заново сам.
    this.setStatus('idle');

    this.modal.open();
    this.openToken += 1;
    this.prepareField(this.openToken).catch(this.onConversionError);
  }

  close(): void {
    this.modal.close();
  }

  /** Освобождает слушатели, поле MathLive и разметку. Идемпотентен. */
  destroy(): void {
    this.disposer.dispose();
    this.field?.remove();
    this.field = null;
    this.modal.destroy();
  }

  private createTab(iconName: string, labelKey: string, tabType: FormulaType): HTMLButtonElement {
    return el('button', {
      class: 'rte-formula-editor__tab',
      attrs: {
        type: 'button',
        role: 'tab',
        id: `${this.idPrefix}-tab-${tabType}`,
        'aria-controls': this.panelId,
      },
      children: [icon(iconName, 16), document.createTextNode(this.t(labelKey))],
    });
  }

  // ---------------------------------------------------------------- чтение

  private isEditing(): boolean {
    return typeof this.payload?.pos === 'number';
  }

  private getCategories(): TemplateCategory[] {
    return getTemplateCategories(this.type);
  }

  private findActiveCategory(): TemplateCategory | undefined {
    return this.getCategories().find((category) => category.id === this.activeCategoryId);
  }

  // -------------------------------------------------------------- отрисовка

  private setStatus(next: FieldStatus): void {
    this.status.hidden = next === 'idle';

    if (next === 'idle') return;

    const isFailed = next === 'failed';

    this.status.className = isFailed
      ? 'rte-formula-editor__status rte-field__error'
      : 'rte-formula-editor__status';

    this.status.textContent = isFailed ? this.t('formula_invalid') : this.t('formula_loading');
  }

  private syncTab(element: HTMLButtonElement, tabType: FormulaType): void {
    const isActive = this.type === tabType;

    element.className = isActive
      ? 'rte-formula-editor__tab rte-formula-editor__tab--active'
      : 'rte-formula-editor__tab';

    element.setAttribute('aria-selected', String(isActive));
    element.tabIndex = isActive ? 0 : -1;

    if (isActive) this.panel.setAttribute('aria-labelledby', element.id);
  }

  private syncTabs(): void {
    this.syncTab(this.mathTab, 'math');
    this.syncTab(this.chemTab, 'chem');
  }

  private syncFooter(): void {
    this.removeButton.hidden = !this.isEditing();

    this.saveButton.textContent = this.isEditing()
      ? this.t('formula_save')
      : this.t('formula_insert');

    this.saveButton.disabled = this.latex.trim() === '';
  }

  private renderCategories(): void {
    this.categoryList.replaceChildren(
      ...this.getCategories().map((category) => {
        const isActive = category.id === this.activeCategoryId;
        const id = `${this.idPrefix}-category-${category.id}`;

        if (isActive) this.gallery.setAttribute('aria-labelledby', id);

        return el('button', {
          class: isActive
            ? 'rte-formula-editor__category rte-formula-editor__category--active'
            : 'rte-formula-editor__category',
          attrs: {
            type: 'button',
            role: 'tab',
            id,
            'aria-selected': String(isActive),
            'aria-controls': this.galleryId,
            tabindex: isActive ? 0 : -1,
            'data-category-id': category.id,
          },
          text: this.t(category.labelKey),
        });
      }),
    );
  }

  private async fillTemplatePreview(
    element: HTMLElement,
    template: FormulaTemplate,
    previewType: FormulaType,
    token: number,
  ): Promise<void> {
    const svg = await renderPreviewSafely(template.preview, previewType);

    // Галерея успела смениться — результат уже не для этой кнопки.
    if (token !== this.galleryToken) return;

    if (svg) {
      // Разметка от MathJax, уже прошедшая санитайзер, — не пользовательская.
      element.innerHTML = svg;

      return;
    }

    // Не отрисовалось — показываем исходный LaTeX. Заглушка «…» означает
    // «рисуем сейчас», а не «не получилось»: иначе кнопка врала бы о своём
    // состоянии до конца жизни диалога.
    element.textContent = template.preview;
  }

  /**
   * Рисует превью только для видимой категории: рендерить весь каталог
   * расточительно, категорий полтора десятка, а видна одна.
   *
   * Вызывается явно при открытии диалога и при каждой смене вкладки, а не по
   * факту изменения категории: при повторном открытии категория остаётся той
   * же, и проверка «значение изменилось» оставила бы кнопки с заглушками.
   */
  private renderGallery(): void {
    this.galleryToken += 1;

    const token = this.galleryToken;
    const category = this.findActiveCategory();

    if (!category) {
      this.gallery.replaceChildren();

      return;
    }

    this.gallery.replaceChildren(
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
          // Результата не ждём: превью дорисуется в фоне, а отказ рендера
          // гасит renderPreviewSafely — отклониться промису нечем.
          this.fillTemplatePreview(target, template, category.type, token);
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

  private showPreviewMessage(message: string): void {
    this.previewContent.className = 'rte-formula-editor__empty';
    this.previewContent.textContent = message;
  }

  private renderPreview(): void {
    this.previewToken += 1;

    const token = this.previewToken;
    const value = this.latex.trim();

    if (!value) {
      this.showPreviewMessage(this.t('formula_empty'));

      return;
    }

    // Результата не ждём: превью обновится в фоне, а отказ рендера гасит
    // renderPreviewSafely — отклониться промису нечем.
    this.fillPreview(value, token);
  }

  /** Асинхронная часть живого превью: ответ устаревшего запуска отбрасывается по номеру. */
  private async fillPreview(value: string, token: number): Promise<void> {
    const svg = await renderPreviewSafely(value, this.type);

    if (token !== this.previewToken) return;

    if (!svg) {
      this.showPreviewMessage(this.t('formula_invalid'));

      return;
    }

    this.previewContent.className = '';
    this.previewContent.innerHTML = svg;
  }

  // --------------------------------------------------------------- действия

  private setLatex(value: string): void {
    this.latex = value;
    this.saveButton.disabled = this.latex.trim() === '';
    this.renderPreview();
  }

  private setType(next: FormulaType): void {
    if (this.type === next) return;

    this.type = next;
    this.activeCategoryId = this.getCategories()[0]?.id ?? '';

    this.modal.setTitle(
      this.type === 'chem' ? this.t('formula_title_chem') : this.t('formula_title_math'),
    );

    this.syncTabs();
    this.renderCategories();
    this.renderGallery();
    // Одна и та же запись в математике и в химии выглядит по-разному.
    this.renderPreview();
  }

  private setCategory(id: string): void {
    this.activeCategoryId = id;
    this.renderCategories();
    this.renderGallery();
  }

  private applyTemplate(template: FormulaTemplate): void {
    if (!this.field) return;

    this.field.insert(template.latex, { selectionMode: 'placeholder', focus: true });
    this.setLatex(this.field.value);
  }

  /** MathLive тяжёлый и работает только в браузере — грузим при первом показе. */
  private async ensureMathfield(): Promise<void> {
    if (this.field || typeof window === 'undefined') return;

    this.setStatus('loading');

    try {
      const { MathfieldElement: MathfieldConstructor } = await import('mathlive');

      MathfieldConstructor.soundsDirectory = null;

      if (this.options.fontsDirectory !== undefined) {
        MathfieldConstructor.fontsDirectory = this.options.fontsDirectory;
      }

      // Русского перевода MathLive не поставляет, и без этой таблицы его меню
      // осталось бы английским. Локаль и строки живут на самом классе, а не на
      // экземпляре, поэтому задаются один раз — при загрузке.
      MathfieldConstructor.strings = MATHLIVE_STRINGS;
      MathfieldConstructor.locale = this.options.locale;

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
      created.setAttribute('aria-label', this.t('formula_input_hint'));
      created.setAttribute('aria-describedby', this.hintId);

      this.disposer.add(
        on(created, 'input', () => {
          this.setLatex(created.value);
        }),
      );

      this.field = created;
      this.setStatus('idle');
    } catch {
      this.setStatus('failed');
    }
  }

  private async prepareField(token: number): Promise<void> {
    await this.ensureMathfield();

    // Диалог успели открыть заново, пока грузился MathLive.
    if (token !== this.openToken || !this.field) return;

    this.host.replaceChildren(this.field);

    // Существующая формула открывается из сохранённого MathML.
    const nextLatex = this.payload?.mathml ? await mathmlToLatex(this.payload.mathml) : '';

    if (token !== this.openToken || !this.field) return;

    this.field.value = nextLatex;
    this.setLatex(nextLatex);
    this.field.focus();
  }

  private async save(): Promise<void> {
    const value = this.latex.trim();

    if (!value) return;

    const mathml = await latexToMathML(value, this.type);

    if (!mathml) return;

    this.options.onSave({ mathml, type: this.type, pos: this.payload?.pos ?? null });
    this.modal.close();
  }

  private remove(): void {
    const pos = this.payload?.pos;

    if (typeof pos === 'number') this.options.onRemove(pos);

    this.modal.close();
  }

  // ------------------------------------------------------------ обработчики

  private readonly onMathTabClick = (): void => {
    this.setType('math');
  };

  private readonly onChemTabClick = (): void => {
    this.setType('chem');
  };

  private readonly onTabsKeydown = (event: KeyboardEvent): void => {
    onTablistKeydown(event, [this.mathTab, this.chemTab], (tab) => {
      this.setType(tab === this.chemTab ? 'chem' : 'math');
    });
  };

  private readonly onCategoryListKeydown = (event: KeyboardEvent): void => {
    onTablistKeydown(
      event,
      [...this.categoryList.querySelectorAll<HTMLElement>('[role="tab"]')],
      (tab) => {
        const id = tab.dataset.categoryId;

        if (id) this.setCategory(id);
      },
    );
  };

  private readonly onCancelButtonClick = (): void => {
    this.modal.close();
  };

  private readonly onRemoveButtonClick = (): void => {
    this.remove();
  };

  private readonly onSaveButtonClick = (): void => {
    this.save().catch(this.onConversionError);
  };

  private readonly onCategoryListClick = (event: MouseEvent): void => {
    const { target } = event;

    if (!(target instanceof Element)) return;

    const id = target.closest<HTMLElement>('[data-category-id]')?.dataset.categoryId;

    if (id) this.setCategory(id);
  };

  private readonly onGalleryClick = (event: MouseEvent): void => {
    const { target } = event;

    if (!(target instanceof Element)) return;

    const id = target.closest<HTMLElement>('[data-template-id]')?.dataset.templateId;

    if (!id) return;

    const template = this.findActiveCategory()?.templates.find((item) => item.id === id);

    if (template) this.applyTemplate(template);
  };

  /**
   * Конвертация формулы не удалась: MathLive и конвертер MathML подгружаются
   * лениво и могут не доехать, а разбор LaTeX может не пройти. Сообщаем той
   * же строкой статуса, что и о невозможности загрузить редактор, вместо
   * необработанного отклонения промиса.
   */
  private readonly onConversionError = (): void => {
    this.setStatus('failed');
  };
}

/**
 * Собирает визуальный редактор формул.
 *
 * Тонкая обёртка над {@link FormulaDialogController}: оболочке редактора нужен
 * только контракт `DialogComponent`.
 */
export const createFormulaDialog = (
  context: EditorUiContext,
  options: FormulaDialogOptions,
): DialogComponent<FormulaPayload | null> => new FormulaDialogController(context, options);
