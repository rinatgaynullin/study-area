import { Extension, type CommandProps } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    moveBlock: {
      /** Ставит выделенный блочный атом (картинку, чертёж, файл) на блок выше. */
      moveBlockUp: () => ReturnType;
      /** Ставит выделенный блочный атом на блок ниже. */
      moveBlockDown: () => ReturnType;
    };
  }
}

type Direction = -1 | 1;

/**
 * Меняет выделенный узел местами с соседом в том же родителе. Работает только
 * для блочного атома под `NodeSelection`: текст переставлять так незачем, а
 * каретку в абзаце сочетание трогать не должно.
 */
const moveSelectedBlock =
  (direction: Direction) =>
  ({ state, tr, dispatch }: CommandProps): boolean => {
    const { selection } = state;

    if (!(selection instanceof NodeSelection)) return false;

    const { node, from } = selection;

    if (!node.isBlock || !node.isAtom) return false;

    const $from = state.doc.resolve(from);
    const { parent } = $from;
    const index = $from.index();
    const neighbourIndex = index + direction;

    if (neighbourIndex < 0 || neighbourIndex >= parent.childCount) return false;

    const neighbour = parent.child(neighbourIndex);

    // Пустой абзац в конце дописывает сам редактор, чтобы под атомом было куда
    // поставить каретку. Уйти под него нельзя: на его месте тут же вырос бы
    // новый, и каждое нажатие добавляло бы пустую строку.
    const isTrailingEmpty =
      neighbourIndex === parent.childCount - 1 && neighbour.isTextblock && neighbour.content.size === 0;

    if (direction > 0 && isTrailingEmpty) return false;

    const firstIndex = Math.min(index, neighbourIndex);
    // Пара в новом порядке: при движении вверх узел встаёт перед соседом.
    const swapped = direction < 0 ? Fragment.from([node, neighbour]) : Fragment.from([neighbour, node]);

    // Порядок детей может быть частью схемы — проверяем, что обмен её не ломает.
    if (!parent.canReplace(firstIndex, firstIndex + 2, swapped)) return false;

    if (dispatch) {
      const start = direction < 0 ? from - neighbour.nodeSize : from;
      const end = start + node.nodeSize + neighbour.nodeSize;
      const target = direction < 0 ? start : start + neighbour.nodeSize;

      tr.replaceWith(start, end, swapped);
      tr.setSelection(NodeSelection.create(tr.doc, target));
      tr.scrollIntoView();
    }

    return true;
  };

/**
 * Перестановка блочных атомов с клавиатуры: `Alt+↑` / `Alt+↓`. Дополняет
 * перенос мышью для тех, кому мышь недоступна. На остальном содержимом
 * сочетание не срабатывает и событие уходит дальше.
 */
export const MoveBlock = Extension.create({
  name: 'moveBlock',

  addCommands: () => ({
    moveBlockUp: () => moveSelectedBlock(-1),
    moveBlockDown: () => moveSelectedBlock(1),
  }),

  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => this.editor.commands.moveBlockUp(),
      'Alt-ArrowDown': () => this.editor.commands.moveBlockDown(),
    };
  },
});
