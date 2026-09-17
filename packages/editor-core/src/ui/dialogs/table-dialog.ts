import { createDisposer, el, on } from '../dom';
import { createModal } from '../modal';
import type { DialogComponent, EditorUiContext } from '../types';

/** Размер таблицы, который пользователь подтвердил. */
export interface TableDialogResult {
  rows: number;
  cols: number;
  withHeaderRow: boolean;
}

export interface TableDialogOptions {
  onInsert(result: TableDialogResult): void;
}

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

/** Границы размера: больше в текст урока всё равно не помещается. */
const MIN_SIZE = 1;
const MAX_ROWS = 20;
const MAX_COLS = 10;

/**
 * Приводит содержимое числового поля к целому в допустимых границах.
 *
 * Поле можно очистить или ввести в него дробь, поэтому доверять его значению
 * нельзя: в документ должен уйти только осмысленный размер.
 */
function clampToRange(value: string, min: number, max: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

/** Диалог вставки таблицы. */
export function createTableDialog(
  context: EditorUiContext,
  options: TableDialogOptions,
): DialogComponent {
  const { t } = context;
  const disposer = createDisposer();

  const rowsInput = el('input', {
    class: 'rte-input',
    attrs: { type: 'number', min: MIN_SIZE, max: MAX_ROWS, 'data-autofocus': true },
  });

  const colsInput = el('input', {
    class: 'rte-input',
    attrs: { type: 'number', min: MIN_SIZE, max: MAX_COLS },
  });

  const sizeRow = el('div', {
    class: 'rte-field-row',
    children: [
      el('label', {
        class: 'rte-field',
        children: [el('span', { class: 'rte-field__label', text: t('table_rows') }), rowsInput],
      }),
      el('label', {
        class: 'rte-field',
        children: [el('span', { class: 'rte-field__label', text: t('table_cols') }), colsInput],
      }),
    ],
  });

  const headerRowInput = el('input', { attrs: { type: 'checkbox' } });
  const headerRowField = el('label', {
    class: 'rte-checkbox',
    children: [headerRowInput, el('span', { text: t('table_with_header') })],
  });

  const cancelButton = el('button', {
    class: 'rte-button',
    text: t('common_cancel'),
    attrs: { type: 'button' },
  });

  const insertButton = el('button', {
    class: 'rte-button rte-button--primary',
    text: t('common_apply'),
    attrs: { type: 'button' },
  });

  const modal = createModal({ title: t('table_insert'), closeLabel: t('common_close') });
  modal.body.append(sizeRow, headerRowField);
  modal.footer.append(el('span', { class: 'rte-modal__spacer' }), cancelButton, insertButton);

  function insert(): void {
    options.onInsert({
      rows: clampToRange(rowsInput.value, MIN_SIZE, MAX_ROWS),
      cols: clampToRange(colsInput.value, MIN_SIZE, MAX_COLS),
      withHeaderRow: headerRowInput.checked,
    });
    modal.close();
  }

  /** Диалог всегда открывается с размером по умолчанию, а не с прошлым. */
  function open(): void {
    rowsInput.value = String(DEFAULT_ROWS);
    colsInput.value = String(DEFAULT_COLS);
    headerRowInput.checked = true;
    modal.open();
  }

  disposer.add(on(insertButton, 'click', insert));
  disposer.add(on(cancelButton, 'click', () => modal.close()));

  return {
    element: modal.element,
    open,
    close: () => modal.close(),
    get isVisible() {
      return modal.isVisible;
    },
    destroy: () => {
      disposer.dispose();
      modal.destroy();
    },
  };
}
