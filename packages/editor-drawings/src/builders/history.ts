/** Глубокая копия сцены: снимки истории не должны делить объекты с живой сценой. */
export const cloneScene = <T>(value: T): T =>
  typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);

/**
 * История изменений: стеки снимков для отмены и повтора.
 *
 * Снимок делается ДО изменения (`record`), а не после — иначе первая отмена
 * возвращает то же состояние, и откат требует двух нажатий (так было в
 * оригинале). Стек ограничен, чтобы долгая правка не копила память.
 */
export class HistoryStack<T> {
  private readonly undoStack: T[] = [];

  private readonly redoStack: T[] = [];

  constructor(private readonly limit = 100) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Запоминает состояние перед изменением; новая ветка истории сбрасывает повтор. */
  record(current: T): void {
    this.undoStack.push(cloneScene(current));

    if (this.undoStack.length > this.limit) this.undoStack.shift();

    this.redoStack.length = 0;
  }

  /** Возвращает предыдущее состояние, текущее кладёт в повтор; `null`, если отменять нечего. */
  undo(current: T): T | null {
    const previous = this.undoStack.pop();

    if (previous === undefined) return null;

    this.redoStack.push(cloneScene(current));

    return previous;
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();

    if (next === undefined) return null;

    this.undoStack.push(cloneScene(current));

    return next;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
