import {
  createDisposer,
  createModal,
  el,
  on,
  type DialogComponent,
  type EditorUiContext,
  type Modal,
  type Translate,
} from '@rich-editor/core';
import { StructureEditor } from './builder/structure-editor';
import { tryParseChemfig } from './chemfig';
import type { ChemistryPayload } from './types';

export interface ChemistryDialogOptions {
  onSave(payload: ChemistryPayload): void;
  onRemove(pos: number): void;
  /** Показать под конструктором поле кода chemfig. */
  code?: boolean;
}

/** Счётчик для уникальных id: подсказка привязана к полю кода через aria. */
let chemistryDialogCount = 0;

/**
 * Диалог структурной формулы: конструктор и, по опции, поле кода chemfig.
 *
 * Класс, а не замыкания: открытая структура, конструктор, поле кода и
 * кнопки — общее состояние, к которому обращаются и обработчики правок, и
 * открытие, и сохранение.
 */
class ChemistryDialogController implements DialogComponent<ChemistryPayload | null> {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private payload: ChemistryPayload | null = null;

  /** Код узла как он был: без правок он и сохраняется, байт в байт. */
  private originalCode = '';

  /** Запись структуры сразу после загрузки: совпала — значит, правок не было. */
  private loadedCode = '';

  /** В поле кода текст, который не разбирается: сохранять нечего, конструктор заперт. */
  private codeInvalid = false;

  private readonly modal: Modal;

  private readonly editor: StructureEditor;

  /** Поле кода есть только при `code: true`. */
  private readonly codeInput: HTMLTextAreaElement | null;

  private readonly status: HTMLElement;

  private readonly removeButton: HTMLButtonElement;

  private readonly saveButton: HTMLButtonElement;

  constructor(
    context: EditorUiContext,
    private readonly options: ChemistryDialogOptions,
  ) {
    const { t } = context;

    this.t = t;
    this.editor = new StructureEditor({ t, onChange: this.onEditorChange });
    this.status = el('p', { class: 'rte-chemistry-dialog__status', attrs: { role: 'status' } });
    this.codeInput = options.code ? this.createCodeInput() : null;

    this.modal = createModal({ title: t('chemistry_title_insert'), closeLabel: t('common_close'), wide: true });

    this.modal.body.appendChild(
      el('div', {
        class: 'rte-chemistry-dialog',
        children: [this.editor.element, this.codeInput ? this.createCodeBlock(this.codeInput) : null, this.status],
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

    if (this.codeInput) {
      this.disposer.add(on(this.codeInput, 'input', this.onCodeInput));
      this.disposer.add(on(this.codeInput, 'keydown', this.onCodeKeydown));
    }

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
    const code = next?.code ?? '';
    const loaded = this.editor.load(code);

    this.payload = next;
    this.originalCode = code;
    this.loadedCode = this.editor.getCode();
    this.modal.setTitle(this.t(editing ? 'chemistry_title_edit' : 'chemistry_title_insert'));
    this.saveButton.textContent = this.t(editing ? 'chemistry_apply_save' : 'chemistry_apply_insert');
    this.removeButton.hidden = !editing;

    if (this.codeInput) this.codeInput.value = code;

    // Код, который не разобрать: с полем кода он остаётся в поле, а
    // конструктор заперт, чтобы первое нажатие не затёрло текст; без поля
    // формулу собирают заново на пустом полотне.
    const unreadable = code.trim() !== '' && !loaded;

    this.setCodeInvalid(unreadable && this.codeInput !== null);

    if (unreadable) {
      this.setStatus(this.t(this.codeInput ? 'chemistry_invalid' : 'chemistry_unreadable'), true);
    } else {
      this.setStatus('', false);
    }

    this.updateSaveButton();
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  destroy(): void {
    this.disposer.dispose();
    this.editor.destroy();
    this.modal.destroy();
  }

  private createCodeInput(): HTMLTextAreaElement {
    chemistryDialogCount += 1;

    return el('textarea', {
      class: 'rte-input rte-chemistry-dialog__code',
      attrs: {
        rows: 3,
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        'aria-describedby': `rte-chemistry-${chemistryDialogCount}-hint`,
      },
    });
  }

  /** Сворачиваемый блок «Код chemfig» с прежним полем и подсказкой про синтаксис. */
  private createCodeBlock(input: HTMLTextAreaElement): HTMLElement {
    return el('details', {
      class: 'rte-chemistry-dialog__code-block',
      children: [
        el('summary', { class: 'rte-chemistry-dialog__summary', text: this.t('chemistry_code_label') }),
        el('label', {
          class: 'rte-field',
          children: [
            el('span', { class: 'rte-field__label', text: this.t('chemistry_code_label') }),
            input,
            el('p', {
              class: 'rte-chemistry-dialog__hint',
              text: this.t('chemistry_code_hint'),
              attrs: { id: input.getAttribute('aria-describedby') },
            }),
          ],
        }),
      ],
    });
  }

  /** Сохранить можно только непустую структуру и только когда поле кода разбирается. */
  private updateSaveButton(): void {
    this.saveButton.disabled = this.codeInvalid || this.editor.getCode() === '';
  }

  private setCodeInvalid(invalid: boolean): void {
    this.codeInvalid = invalid;
    this.editor.setLocked(invalid);
  }

  /**
   * Код для сохранения. Без правок — исходный код узла как есть: в нём может
   * быть то, чего модель не хранит (относительные углы, длина связи), а
   * сервер рисует настоящий chemfig. После правки в конструкторе — его запись,
   * после правки поля — текст поля.
   */
  private codeToSave(): string {
    const code = this.editor.getCode();

    if (!code) return '';

    if (this.codeInput) {
      const text = this.codeInput.value.trim();

      return text === this.originalCode.trim() ? this.originalCode : text;
    }

    return code === this.loadedCode && this.originalCode.trim() ? this.originalCode : code;
  }

  private setStatus(text: string, isError: boolean): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
    this.status.classList.toggle('rte-chemistry-dialog__status--error', isError);
  }

  /** Правка в конструкторе переписывает поле кода; вернулись к исходной структуре — и к исходному коду. */
  private readonly onEditorChange = (): void => {
    const code = this.editor.getCode();

    if (this.codeInput) this.codeInput.value = code === this.loadedCode && code !== '' ? this.originalCode : code;

    this.setStatus('', false);
    this.updateSaveButton();
  };

  /**
   * Правка поля — шаг истории конструктора. Код, который не разбирается,
   * конструктор не трогает и запирает его: ошибка — в статусе, сохранить
   * нельзя. Очистил поле или исправил код — конструктор снова работает.
   */
  private readonly onCodeInput = (): void => {
    const code = this.codeInput?.value.trim() ?? '';
    const invalid = code !== '' && !tryParseChemfig(code);

    this.setCodeInvalid(invalid);

    if (invalid) {
      this.setStatus(this.t('chemistry_invalid'), true);
    } else {
      this.editor.applyCode(code);
      this.setStatus('', false);
    }

    this.updateSaveButton();
  };

  /** Ctrl/Cmd+Enter вставляет: Enter в многострочном поле оставляем переносу. */
  private readonly onCodeKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.save();
    }
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
    if (this.codeInvalid) return;

    const code = this.codeToSave();

    if (!code) return;

    this.options.onSave({ code, type: 'chemfig', pos: this.payload?.pos ?? null });
    this.close();
  }
}

export const createChemistryDialog = (
  context: EditorUiContext,
  options: ChemistryDialogOptions,
): DialogComponent<ChemistryPayload | null> => new ChemistryDialogController(context, options);
