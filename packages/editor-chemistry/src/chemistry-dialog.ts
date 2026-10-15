import {
  createDisposer,
  createModal,
  el,
  on,
  sanitizeSvg,
  type DialogComponent,
  type EditorUiContext,
  type Modal,
  type Translate,
} from '@rich-editor/core';
import { chemfigToSvg } from './chemfig';
import { CHEMISTRY_TEMPLATES } from './templates';
import type { ChemistryPayload } from './types';

export interface ChemistryDialogOptions {
  onSave(payload: ChemistryPayload): void;
  onRemove(pos: number): void;
}

/** Масштаб превью и миниатюр шаблонов относительно картинки в документе. */
const PREVIEW_SCALE = 1.2;
const TEMPLATE_SCALE = 0.45;

/** Счётчик для уникальных id: подсказка и превью привязаны к полю через aria. */
let chemistryDialogCount = 0;

/**
 * Диалог структурной формулы: поле кода chemfig, шаблоны и живое превью.
 *
 * Класс, а не замыкания: код, открытая структура, состояние превью и
 * кнопки — общее состояние, к которому обращаются и обработчики ввода, и
 * открытие, и сохранение.
 */
class ChemistryDialogController implements DialogComponent<ChemistryPayload | null> {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private payload: ChemistryPayload | null = null;

  /** Разобрался ли текущий код: от этого зависит кнопка вставки. */
  private isValid = false;

  private readonly modal: Modal;

  private readonly codeInput: HTMLTextAreaElement;

  private readonly preview: HTMLElement;

  private readonly status: HTMLElement;

  private readonly removeButton: HTMLButtonElement;

  private readonly saveButton: HTMLButtonElement;

  constructor(
    context: EditorUiContext,
    private readonly options: ChemistryDialogOptions,
  ) {
    const { t } = context;

    this.t = t;

    chemistryDialogCount += 1;

    const idPrefix = `rte-chemistry-${chemistryDialogCount}`;
    const hintId = `${idPrefix}-hint`;

    this.codeInput = el('textarea', {
      class: 'rte-input rte-chemistry-dialog__code',
      attrs: {
        rows: 3,
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        'aria-describedby': hintId,
        'data-autofocus': true,
      },
    });

    const field = el('label', {
      class: 'rte-field',
      children: [
        el('span', { class: 'rte-field__label', text: t('chemistry_code_label') }),
        this.codeInput,
        el('p', { class: 'rte-chemistry-dialog__hint', text: t('chemistry_code_hint'), attrs: { id: hintId } }),
      ],
    });

    const templates = el('div', {
      class: 'rte-chemistry-dialog__templates',
      attrs: { role: 'group', 'aria-label': t('chemistry_templates') },
      children: CHEMISTRY_TEMPLATES.map((template) => {
        const label = t(template.labelKey);
        const svg = chemfigToSvg(template.code, { scale: TEMPLATE_SCALE });

        return el('button', {
          class: 'rte-chemistry-dialog__template',
          attrs: { type: 'button', title: label, 'aria-label': label, 'data-code': template.code },
          // Миниатюра — наш же SVG, тем же путём через санитайзер.
          html: svg ? sanitizeSvg(svg) : '',
          text: svg ? undefined : label,
        });
      }),
    });

    this.status = el('p', { class: 'rte-chemistry-dialog__status', attrs: { role: 'status' } });
    this.preview = el('div', { class: 'rte-chemistry-dialog__preview', attrs: { 'aria-hidden': 'true' } });

    this.modal = createModal({ title: t('chemistry_title_insert'), closeLabel: t('common_close') });

    this.modal.body.appendChild(
      el('div', {
        class: 'rte-chemistry-dialog',
        children: [
          field,
          el('section', {
            children: [
              el('h3', { class: 'rte-chemistry-dialog__section-title', text: t('chemistry_templates') }),
              templates,
            ],
          }),
          el('section', {
            children: [
              el('h3', { class: 'rte-chemistry-dialog__section-title', text: t('chemistry_preview') }),
              this.preview,
              this.status,
            ],
          }),
        ],
      }),
    );

    this.removeButton = el('button', {
      class: 'rte-button rte-button--danger',
      attrs: { type: 'button' },
      text: t('chemistry_remove'),
    });

    const cancelButton = el('button', {
      class: 'rte-button',
      attrs: { type: 'button' },
      text: t('common_cancel'),
    });

    this.saveButton = el('button', {
      class: 'rte-button rte-button--primary',
      attrs: { type: 'button' },
      text: t('chemistry_apply_insert'),
    });

    this.modal.footer.append(
      this.removeButton,
      el('span', { class: 'rte-modal__spacer' }),
      cancelButton,
      this.saveButton,
    );

    this.element = this.modal.element;

    this.disposer.add(on(this.codeInput, 'input', this.onCodeInput));
    this.disposer.add(on(this.codeInput, 'keydown', this.onCodeKeydown));
    this.disposer.add(on(templates, 'click', this.onTemplatesClick));
    this.disposer.add(on(cancelButton, 'click', this.onCancelClick));
    this.disposer.add(on(this.removeButton, 'click', this.onRemoveClick));
    this.disposer.add(on(this.saveButton, 'click', this.onSaveClick));
  }

  get isVisible(): boolean {
    return this.modal.isVisible;
  }

  /** Открывает диалог: со структурой из документа — на правку, с `null` — на вставку. */
  open(next: ChemistryPayload | null): void {
    const editing = next !== null && next.pos !== null;

    this.payload = next;
    this.modal.setTitle(this.t(editing ? 'chemistry_title_edit' : 'chemistry_title_insert'));
    this.saveButton.textContent = this.t(editing ? 'chemistry_apply_save' : 'chemistry_apply_insert');
    this.removeButton.hidden = !editing;
    this.codeInput.value = next?.code ?? '';
    this.renderPreview();
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  destroy(): void {
    this.disposer.dispose();
    this.modal.destroy();
  }

  /** Превью по текущему коду; пустой и неразобранный код объявляются в строке статуса. */
  private renderPreview(): void {
    const code = this.codeInput.value.trim();
    const svg = code ? chemfigToSvg(code, { scale: PREVIEW_SCALE }) : null;

    this.isValid = code !== '' && svg !== null;
    this.preview.innerHTML = svg ? sanitizeSvg(svg) : '';
    this.preview.hidden = svg === null;

    if (code === '') this.setStatus(this.t('chemistry_empty'), false);
    else if (svg === null) this.setStatus(this.t('chemistry_invalid'), true);
    else this.setStatus('', false);

    // Неразобранный код всё же можно вставить: он сохранится как текст.
    this.saveButton.disabled = code === '';
  }

  private setStatus(text: string, isError: boolean): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
    this.status.classList.toggle('rte-chemistry-dialog__status--error', isError);
  }

  private readonly onCodeInput = (): void => {
    this.renderPreview();
  };

  /** Ctrl/Cmd+Enter вставляет: Enter в многострочном поле оставляем переносу. */
  private readonly onCodeKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.save();
    }
  };

  private readonly onTemplatesClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-code]');

    if (!button) return;

    this.codeInput.value = button.dataset.code ?? '';
    this.renderPreview();
    this.codeInput.focus();
  };

  private readonly onCancelClick = (): void => {
    this.close();
  };

  private readonly onRemoveClick = (): void => {
    if (this.payload?.pos !== null && this.payload?.pos !== undefined) {
      this.options.onRemove(this.payload.pos);
    }

    this.close();
  };

  private readonly onSaveClick = (): void => {
    this.save();
  };

  private save(): void {
    const code = this.codeInput.value.trim();

    if (!code) return;

    this.options.onSave({ code, type: 'chemfig', pos: this.payload?.pos ?? null });
    this.close();
  }
}

export const createChemistryDialog = (
  context: EditorUiContext,
  options: ChemistryDialogOptions,
): DialogComponent<ChemistryPayload | null> => new ChemistryDialogController(context, options);
