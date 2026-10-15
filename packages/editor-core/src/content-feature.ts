import { mergeSanitizerRules, type SanitizerRules } from './security/sanitize';

/** Что гидратор получает кроме корня документа. */
export interface ContentHydrateContext {
  /** Масштаб формул: рисунки возможности масштабируются вместе с ними. */
  formulaScale: number;
}

/** Снимает то, что гидратор повесил: слушатели, таймеры, наблюдатели. */
export type ContentHydrateDispose = () => void;

export type ContentHydrateResult = ContentHydrateDispose | void;

/**
 * Возможность со стороны документа: что из её разметки пропускать и как
 * оживлять её узлы без редактора.
 *
 * Вьюеру не нужны ни расширения TipTap, ни тулбар — только эта часть.
 * Поэтому возможность отдаёт её отдельным лёгким входом, который не тянет
 * редактор, а `EditorFeature` расширяет этот контракт пунктами и диалогами.
 */
export interface ContentFeature {
  id: string;
  /**
   * Теги и атрибуты узлов возможности. Без них санитайзер срезал бы разметку
   * на входе — и в редакторе, и во вьюере. Запрещённые теги (`script`,
   * `iframe`) добавить нельзя. Серверный санитайзер этих правил не знает:
   * хост дописывает их в свою копию allowlist.
   */
  sanitize?: SanitizerRules;
  /**
   * Оживляет узлы возможности после каждой отрисовки документа во вьюере:
   * дорисовывает SVG, вешает обработчики. Возвращённая функция снимает их
   * перед следующей отрисовкой и при уничтожении вьюера. В редакторе не
   * вызывается: там узлы рисуют NodeView расширений.
   */
  hydrate?(
    root: HTMLElement,
    context: ContentHydrateContext,
  ): ContentHydrateResult | Promise<ContentHydrateResult>;
}

/** Правила санитайзера всех возможностей одним объектом. */
export const collectSanitizerRules = (
  features: readonly ContentFeature[],
): SanitizerRules | undefined => mergeSanitizerRules(...features.map((feature) => feature.sanitize));
