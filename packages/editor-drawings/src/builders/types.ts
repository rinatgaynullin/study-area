import type { Translate, UiComponent, Unsubscribe } from '@rich-editor/core';
import type { DrawingKind } from '../scene/types';
import type { BuilderIconId } from './builder-icons';

/** Сырая сцена, какой она лежит в узле: конструкторы работают с ней напрямую. */
export type RawScene = Record<string, unknown>;

/** Что получает конструктор от диалога. */
export interface SceneEditorContext {
  t: Translate;
  /** Сканы работы ученика рядом с полотном — чтобы перерисовывать «с фото». */
  scans?: string[];
}

/**
 * Конструктор одной вкладки диалога: планиметрия, графики, механика…
 *
 * Диалог загружает в него сцену, слушает изменения и забирает результат при
 * сохранении; превью и TikZ считает сам диалог общим рендером.
 */
export interface SceneEditor extends UiComponent {
  /** Подставляет сцену; конструктор берёт из неё то, что понимает. */
  load(scene: RawScene): void;
  /** Текущая сцена в формате PinQueen. */
  getScene(): RawScene;
  /** Вызывается после каждого изменения сцены. */
  onChange(listener: () => void): Unsubscribe;
  /** Фокус на полотно — для клавиатуры (Delete, Ctrl+Z). */
  focus(): void;
  /**
   * «Отменить начатое» (Escape): бросает незаконченное построение, возвращает
   * инструмент «Выбрать», снимает выделение и перерисовывает полотно, панель
   * свойств и подсказку. Сам шаг истории не пишет и сцену не меняет;
   * перетаскивание, которое уже сдвинуло объект, доводится, как при
   * отпускании. В чистом состоянии ничего не делает и `onChange` не зовёт.
   */
  cancel?(): void;
}

export interface SceneEditorFactory {
  id: string;
  kind: DrawingKind;
  /** Ключ перевода названия вкладки. */
  labelKey: string;
  /** Значок перед названием вкладки; без него вкладка — одна подпись. */
  icon?: BuilderIconId;
  /** Подходит ли сцена этой вкладке: диалог открывает первую подходящую. */
  accepts(scene: RawScene): boolean;
  create(context: SceneEditorContext): SceneEditor;
}
