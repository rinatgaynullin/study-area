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
import { readScene, renderDrawingPreview } from './paint-drawing';
import { parseSceneJson, stringifyScene } from './scene/json';
import type { DrawingKind, GeometryScene, PhysicsScene } from './scene/types';
import { DRAWING_TEMPLATES } from './templates';
import { geometryToTikz, physicsToTikz } from './tikz';
import type { DrawingPayload } from './types';

export interface DrawingDialogOptions {
  onSave(payload: DrawingPayload): void;
  onRemove(pos: number): void;
}

/** Счётчик для уникальных id: подсказки и группы радио привязаны к полям. */
let drawingDialogCount = 0;

const KINDS: DrawingKind[] = ['geometry', 'physics'];

/**
 * Диалог чертежа: вид сцены, JSON с живым превью, шаблоны и TikZ.
 *
 * Это базовая версия — редактирование кодом. Конструкторы (планиметрия,
 * графики, физика, стереометрия) встанут в тот же диалог вкладками, а JSON
 * останется запасным путём. Класс, потому что вид, открытая сцена, статус
 * и кнопки — общее состояние обработчиков ввода, открытия и сохранения.
 */
class DrawingDialogController implements DialogComponent<DrawingPayload | null> {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private payload: DrawingPayload | null = null;

  private kind: DrawingKind = 'geometry';

  /** Разобранная сцена текущего JSON; `null` — JSON нечитаем. */
  private scene: GeometryScene | PhysicsScene | null = null;

  private readonly modal: Modal;

  private readonly kindInputs: HTMLInputElement[];

  private readonly kindRow: HTMLElement;

  private readonly codeInput: HTMLTextAreaElement;

  private readonly tikzOutput: HTMLTextAreaElement;

  private readonly templatesRow: HTMLElement;

  private readonly preview: HTMLElement;

  private readonly status: HTMLElement;

  private readonly removeButton: HTMLButtonElement;

  private readonly saveButton: HTMLButtonElement;

  constructor(
    context: EditorUiContext,
    private readonly options: DrawingDialogOptions,
  ) {
    const { t } = context;

    this.t = t;

    drawingDialogCount += 1;

    const idPrefix = `rte-drawing-${drawingDialogCount}`;
    const hintId = `${idPrefix}-hint`;

    this.kindInputs = KINDS.map((kind) =>
      el('input', { attrs: { type: 'radio', name: `${idPrefix}-kind`, value: kind } }),
    );

    this.kindRow = el('div', {
      class: 'rte-drawing-dialog__kinds',
      attrs: { role: 'radiogroup' },
      children: this.kindInputs.map((input, index) =>
        el('label', {
          children: [input, el('span', { text: t(`drawings_insert_${KINDS[index]}`) })],
        }),
      ),
    });

    this.codeInput = el('textarea', {
      class: 'rte-input rte-drawing-dialog__code',
      attrs: {
        rows: 6,
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        'aria-describedby': hintId,
        'data-autofocus': true,
      },
    });

    const codeField = el('label', {
      class: 'rte-field',
      children: [
        el('span', { class: 'rte-field__label', text: t('drawings_json_label') }),
        this.codeInput,
        el('p', { class: 'rte-drawing-dialog__hint', text: t('drawings_json_hint'), attrs: { id: hintId } }),
      ],
    });

    this.templatesRow = el('div', {
      class: 'rte-drawing-dialog__templates',
      attrs: { role: 'group', 'aria-label': t('drawings_templates') },
    });

    this.status = el('p', { class: 'rte-drawing-dialog__status', attrs: { role: 'status' } });
    this.preview = el('div', { class: 'rte-drawing-dialog__preview', attrs: { 'aria-hidden': 'true' } });

    this.tikzOutput = el('textarea', {
      class: 'rte-input rte-drawing-dialog__code rte-drawing-dialog__code--tikz',
      attrs: { rows: 4, readonly: true, spellcheck: 'false' },
    });

    const tikzField = el('label', {
      class: 'rte-field',
      children: [
        el('span', { class: 'rte-field__label', text: t('drawings_tikz_label') }),
        this.tikzOutput,
        el('p', { class: 'rte-drawing-dialog__hint', text: t('drawings_tikz_hint') }),
      ],
    });

    this.modal = createModal({ title: t('drawings_title_insert_geometry'), closeLabel: t('common_close'), wide: true });

    this.modal.body.appendChild(
      el('div', {
        class: 'rte-drawing-dialog',
        children: [
          this.kindRow,
          codeField,
          el('section', {
            children: [
              el('h3', { class: 'rte-drawing-dialog__section-title', text: t('drawings_templates') }),
              this.templatesRow,
            ],
          }),
          el('section', {
            children: [
              el('h3', { class: 'rte-drawing-dialog__section-title', text: t('drawings_preview') }),
              this.preview,
              this.status,
            ],
          }),
          tikzField,
        ],
      }),
    );

    this.removeButton = el('button', {
      class: 'rte-button rte-button--danger',
      attrs: { type: 'button' },
      text: t('drawings_remove'),
    });

    const cancelButton = el('button', { class: 'rte-button', attrs: { type: 'button' }, text: t('common_cancel') });

    this.saveButton = el('button', {
      class: 'rte-button rte-button--primary',
      attrs: { type: 'button' },
      text: t('drawings_apply_insert'),
    });

    this.modal.footer.append(this.removeButton, el('span', { class: 'rte-modal__spacer' }), cancelButton, this.saveButton);

    this.element = this.modal.element;

    this.disposer.add(on(this.kindRow, 'change', this.onKindChange));
    this.disposer.add(on(this.codeInput, 'input', this.onCodeInput));
    this.disposer.add(on(this.templatesRow, 'click', this.onTemplatesClick));
    this.disposer.add(on(cancelButton, 'click', this.onCancelClick));
    this.disposer.add(on(this.removeButton, 'click', this.onRemoveClick));
    this.disposer.add(on(this.saveButton, 'click', this.onSaveClick));
  }

  get isVisible(): boolean {
    return this.modal.isVisible;
  }

  /** Открывает диалог: с чертежом из документа — на правку, с `null` — на вставку. */
  open(next: DrawingPayload | null): void {
    const editing = next !== null && next.pos !== null;

    this.payload = next;
    this.kind = next?.kind ?? 'geometry';
    this.saveButton.textContent = this.t(editing ? 'drawings_apply_save' : 'drawings_apply_insert');
    this.removeButton.hidden = !editing;
    // Вид существующего чертежа не меняют: это другой узел.
    this.kindRow.hidden = editing;
    this.kindInputs.forEach((input) => {
      input.checked = input.value === this.kind;
    });
    this.codeInput.value = next?.data ?? '';
    this.applyKind();
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  destroy(): void {
    this.disposer.dispose();
    this.modal.destroy();
  }

  /** Вид выбран: заголовок, шаблоны и превью под него. */
  private applyKind(): void {
    const editing = this.payload !== null && this.payload.pos !== null;

    this.modal.setTitle(this.t(`drawings_title_${editing ? 'edit' : 'insert'}_${this.kind}`));
    this.renderTemplates();
    this.renderPreview();
  }

  private renderTemplates(): void {
    this.templatesRow.replaceChildren(
      ...DRAWING_TEMPLATES.filter((template) => template.kind === this.kind).map((template) =>
        el('button', {
          class: 'rte-drawing-dialog__template',
          attrs: { type: 'button', 'data-template': template.id },
          text: this.t(template.labelKey),
        }),
      ),
    );
  }

  /** Превью и TikZ по текущему JSON; пустая и нечитаемая сцена объявляются в статусе. */
  private renderPreview(): void {
    const data = this.codeInput.value.trim();

    this.scene = data ? readScene(this.kind, data) : null;

    const svg = this.scene ? renderDrawingPreview(this.kind, this.scene) : null;

    this.preview.innerHTML = svg ? sanitizeSvg(svg) : '';
    this.preview.hidden = svg === null;
    this.tikzOutput.value = this.scene ? this.buildTikz(this.scene) : '';

    if (data === '') this.setStatus(this.t('drawings_empty'), false);
    else if (this.scene === null) this.setStatus(this.t('drawings_invalid'), true);
    else if (svg === null) this.setStatus(this.t('drawings_placeholder'), false);
    else this.setStatus('', false);

    // Нечитаемый JSON всё же можно сохранить: узел покажет плейсхолдер, данные не потеряются.
    this.saveButton.disabled = data === '';
  }

  private buildTikz(scene: GeometryScene | PhysicsScene): string {
    return scene.type === 'physics' ? physicsToTikz(scene) : geometryToTikz(scene);
  }

  private setStatus(text: string, isError: boolean): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
    this.status.classList.toggle('rte-drawing-dialog__status--error', isError);
  }

  private readonly onKindChange = (): void => {
    const checked = this.kindInputs.find((input) => input.checked);

    if (!checked) return;

    this.kind = checked.value as DrawingKind;
    this.applyKind();
  };

  private readonly onCodeInput = (): void => {
    this.renderPreview();
  };

  private readonly onTemplatesClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-template]');
    const template = DRAWING_TEMPLATES.find((candidate) => candidate.id === button?.dataset.template);

    if (!template) return;

    this.codeInput.value = JSON.stringify(template.scene, null, 2);
    this.renderPreview();
    this.codeInput.focus();
  };

  private readonly onCancelClick = (): void => {
    this.close();
  };

  private readonly onRemoveClick = (): void => {
    if (this.payload?.pos !== null && this.payload?.pos !== undefined) this.options.onRemove(this.payload.pos);

    this.close();
  };

  private readonly onSaveClick = (): void => {
    const data = this.codeInput.value.trim();

    if (!data) return;

    // Разобранную сцену сохраняем компактно и без правок; нечитаемую — как есть.
    const raw = parseSceneJson(data);

    this.options.onSave({
      kind: this.kind,
      data: raw === null ? data : stringifyScene(raw),
      tikz: this.scene ? this.buildTikz(this.scene) : (this.payload?.tikz ?? ''),
      pos: this.payload?.pos ?? null,
    });
    this.close();
  };
}

export const createDrawingDialog = (
  context: EditorUiContext,
  options: DrawingDialogOptions,
): DialogComponent<DrawingPayload | null> => new DrawingDialogController(context, options);
