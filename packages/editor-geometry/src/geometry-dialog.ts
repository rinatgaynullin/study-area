import {
  createModal,
  type DialogComponent,
  type EditorUiContext,
  type Modal,
} from '@rich-editor/core';
import { DEFAULT_SCRIPT } from './default-script';
import { GeometryBoard } from './geometry-board';
import {
  DEFAULT_BBOX,
  DEFAULT_HEIGHT,
  formatBoundingBox,
  parseBoundingBox,
  type BoundingBox,
  type GeometryPayload,
} from './types';

const PREVIEW_DEBOUNCE_MS = 300;

const createField = <T extends HTMLElement>(tag: string, className: string): T => {
  const element = document.createElement(tag) as T;

  element.className = className;

  return element;
};

/**
 * Диалог построения: текст JessieCode слева от живого предпросмотра.
 *
 * Для спайка редактирование текстовое: цель — проверить, что формула, заданная
 * текстом, разбирается безопасно, перестраивает график и сохраняется в узел.
 * Палитра инструментов — следующий шаг.
 */
class GeometryDialogController implements DialogComponent<GeometryPayload | null> {
  readonly element: HTMLElement;

  private readonly modal: Modal;

  private readonly scriptField: HTMLTextAreaElement;

  private readonly bboxField: HTMLInputElement;

  private readonly previewHost: HTMLElement;

  private readonly status: HTMLElement;

  private preview: GeometryBoard | null = null;

  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  private payload: GeometryPayload | null = null;

  constructor(private readonly context: EditorUiContext) {
    const { t } = context;

    this.modal = createModal({
      title: t('geometry_title'),
      closeLabel: t('common_close'),
      wide: true,
      onClose: () => this.releasePreview(),
    });
    this.element = this.modal.element;

    const layout = createField<HTMLDivElement>('div', 'rte-geometry-dialog');
    const form = createField<HTMLDivElement>('div', 'rte-geometry-dialog__form');

    const scriptLabel = createField<HTMLLabelElement>('label', 'rte-geometry-dialog__label');

    scriptLabel.textContent = t('geometry_script_label');
    this.scriptField = createField<HTMLTextAreaElement>('textarea', 'rte-input rte-geometry-dialog__script');
    this.scriptField.rows = 10;
    this.scriptField.spellcheck = false;
    this.scriptField.setAttribute('data-autofocus', '');
    scriptLabel.appendChild(this.scriptField);

    const bboxLabel = createField<HTMLLabelElement>('label', 'rte-geometry-dialog__label');

    bboxLabel.textContent = t('geometry_bbox_label');
    this.bboxField = createField<HTMLInputElement>('input', 'rte-input');
    this.bboxField.type = 'text';
    bboxLabel.appendChild(this.bboxField);

    this.status = createField<HTMLDivElement>('div', 'rte-geometry-dialog__status');
    this.status.setAttribute('role', 'status');

    form.append(scriptLabel, bboxLabel, this.status);

    const previewLabel = createField<HTMLDivElement>('div', 'rte-geometry-dialog__label');

    previewLabel.textContent = t('geometry_preview_label');
    this.previewHost = createField<HTMLDivElement>('div', 'rte-geometry__board jxgbox rte-geometry-dialog__preview');
    this.previewHost.style.height = `${DEFAULT_HEIGHT}px`;

    const previewColumn = createField<HTMLDivElement>('div', 'rte-geometry-dialog__preview-column');

    previewColumn.append(previewLabel, this.previewHost);
    layout.append(form, previewColumn);
    this.modal.body.appendChild(layout);

    const cancelButton = createField<HTMLButtonElement>('button', 'rte-button');

    cancelButton.type = 'button';
    cancelButton.textContent = t('geometry_cancel');
    cancelButton.addEventListener('click', this.onCancelButtonClick);

    const saveButton = createField<HTMLButtonElement>('button', 'rte-button rte-button--primary');

    saveButton.type = 'button';
    saveButton.textContent = t('geometry_save');
    saveButton.addEventListener('click', this.onSaveButtonClick);

    this.modal.footer.append(cancelButton, saveButton);

    this.scriptField.addEventListener('input', this.onFieldInput);
    this.bboxField.addEventListener('input', this.onFieldInput);
  }

  get isVisible(): boolean {
    return this.modal.isVisible;
  }

  open(payload: GeometryPayload | null): void {
    this.payload = payload;
    this.scriptField.value = payload?.script || DEFAULT_SCRIPT;
    this.bboxField.value = formatBoundingBox(payload?.bbox ?? DEFAULT_BBOX);
    this.setStatus('');
    this.modal.open();
    this.renderPreview();
  }

  close(): void {
    this.modal.close();
  }

  destroy(): void {
    this.releasePreview();
    this.modal.destroy();
  }

  private get bbox(): BoundingBox {
    return parseBoundingBox(this.bboxField.value);
  }

  private readonly onFieldInput = (): void => {
    if (this.previewTimer) clearTimeout(this.previewTimer);

    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.renderPreview();
    }, PREVIEW_DEBOUNCE_MS);
  };

  private readonly onCancelButtonClick = (): void => {
    this.close();
  };

  private readonly onSaveButtonClick = (): void => {
    const attributes = {
      script: this.scriptField.value,
      bbox: this.bbox,
      height: this.payload?.height ?? DEFAULT_HEIGHT,
      // Точки, расставленные в предпросмотре, уезжают в документ как состояние.
      state: this.preview?.captureState() ?? {},
    };
    const chain = this.context.editor.chain().focus();

    if (this.payload?.pos === null || this.payload?.pos === undefined) {
      chain.insertGeometry(attributes).run();
    } else {
      chain.updateGeometry(this.payload.pos, attributes).run();
    }

    this.close();
  };

  private renderPreview(): void {
    this.setStatus('');
    this.releasePreview();
    this.preview = new GeometryBoard({
      element: this.previewHost,
      script: this.scriptField.value,
      bbox: this.bbox,
      state: this.payload?.state,
      interactive: true,
      onError: (error) => {
        const detail = error instanceof Error ? error.message : String(error);

        this.setStatus(`${this.context.t('geometry_error_parse')}: ${detail}`);
      },
    });
  }

  private releasePreview(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }

    this.preview?.destroy();
    this.preview = null;
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.classList.toggle('rte-geometry-dialog__status--error', text !== '');
  }
}

export const createGeometryDialog = (
  context: EditorUiContext,
): DialogComponent<GeometryPayload | null> => new GeometryDialogController(context);
