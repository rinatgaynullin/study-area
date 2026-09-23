import type { Editor } from '@tiptap/core';

/**
 * Возвращает фокус в документ, не трогая выделение и не прокручивая к нему.
 *
 * Не через `commands.focus()`: на Android и iOS та фокусирует view
 * синхронно, плагин фокуса TipTap тут же применяет свою транзакцию, и
 * транзакция самой команды, созданная раньше, становится «несовпадающей» —
 * в консоли ошибка на каждое закрытие диалога. `view.focus()` делает то же
 * самое без собственной транзакции.
 */
export const focusEditorView = (editor: Editor): void => {
  if (editor.isDestroyed || editor.view.hasFocus()) return;

  editor.view.focus();
};
