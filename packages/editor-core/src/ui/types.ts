import type { Editor } from '@tiptap/core';
import type { EditorLimits, FormulaPayload, Translate } from '../types';
import type { UploadPipeline } from '../media/upload';

/**
 * Контракты ванильного UI.
 *
 * UI редактора написан без фреймворка: тулбар, диалоги и поповеры собираются на
 * голом DOM. Обёртка под фреймворк монтирует готовый редактор и пробрасывает
 * пропы, а не пересобирает интерфейс заново — иначе каждая обёртка тащила бы
 * собственную копию логики и расходилась бы с остальными.
 */

/** Всё, что нужно любому куску UI, чтобы работать с документом. */
export interface EditorUiContext {
  editor: Editor;
  t: Translate;
  limits: EditorLimits;
  uploads: UploadPipeline;
  /** Открывает визуальный редактор формул. */
  editFormula(payload: FormulaPayload): void;
}

/**
 * Часть UI с собственным жизненным циклом: диалог, поповер, панель.
 *
 * Общий интерфейс нужен, чтобы оболочка редактора складывала их в один список
 * и уничтожала одним проходом, не зная, что внутри.
 */
export interface UiComponent {
  /** Корневой элемент. Оболочка сама решает, куда его поместить. */
  readonly element: HTMLElement;
  /** Освобождает слушатели и таймеры. Должен быть идемпотентным. */
  destroy(): void;
}

/** Диалог, который открывается с полезной нагрузкой и закрывается сам. */
export interface DialogComponent<TPayload = void> extends UiComponent {
  open(payload: TPayload): void;
  close(): void;
  readonly isVisible: boolean;
}

/** Как пункт тулбара выглядит и что делает. */
export type ToolbarItemKind = 'button' | 'dropdown';

export interface ToolbarItemDescriptor {
  id: string;
  /** Имя иконки из встроенного набора. */
  icon?: string;
  /**
   * Иконка от состояния документа — например, текущее выравнивание. Главнее
   * `icon`; пересчитывается на каждой транзакции.
   */
  dynamicIcon?(editor: Editor): string;
  /** Короткая подпись вместо иконки — например, уровень заголовка. */
  text?(context: EditorUiContext): string;
  /** Ключ перевода для подписи и подсказки. */
  labelKey: string;
  /**
   * Сочетание клавиш в записи TipTap («Mod-Shift-S»). Попадает в подсказку
   * и в `aria-keyshortcuts`; само сочетание вешает расширение, не тулбар.
   */
  shortcut?: string;
  kind?: ToolbarItemKind;
  /** Выполняет действие пункта. */
  run?(context: EditorUiContext, payload?: unknown): void;
  /** Подсвечен ли пункт для текущего выделения. */
  isActive?(editor: Editor): boolean;
  /** Недоступен ли пункт — например, отменять ещё нечего. */
  isDisabled?(editor: Editor): boolean;
  /** Содержимое выпадающей панели. Только для `kind: 'dropdown'`. */
  renderPanel?(context: EditorUiContext, close: () => void): HTMLElement;
}

/**
 * Возможность редактора: расширения схемы, пункты тулбара и диалоги одним
 * объявлением.
 *
 * Смысл в том, чтобы «таблицы» или «формулы» описывались в одном месте, а не
 * были размазаны по списку расширений, таблице команд, пресетам тулбара и
 * набору иконок, как это было раньше. Тогда набор возможностей можно собрать
 * под задачу, а не выбирать из трёх зашитых пресетов.
 */
export interface EditorFeature {
  id: string;
  /** Расширения TipTap, которые добавляет возможность. */
  extensions?(options: FeatureBuildOptions): unknown[];
  /** Пункты, которые возможность предлагает тулбару. */
  toolbarItems?(): ToolbarItemDescriptor[];
  /**
   * Диалоги, которые нужны её пунктам. Вызывается при создании редактора и
   * заново при каждой смене языка: подписи запекаются при сборке, поэтому
   * диалог должен целиком собираться из контекста, а не хранить состояние.
   */
  dialogs?(context: EditorUiContext): UiComponent[];
}

export interface FeatureBuildOptions {
  t: Translate;
  /** Разбирать разметку старого редактора (Froala + Wiris). */
  legacy: boolean;
  placeholder?: string;
  formulaScale: number;
  onFormulaEdit?: (payload: FormulaPayload) => void;
}
