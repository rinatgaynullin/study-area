import { DEFAULT_FORMULA_FONT_SIZE_PX, renderMathML } from '../../formula/mathjax';
import { latexToMathML } from '../../formula/mathml';
import type { FormulaType } from '../../types';

/**
 * Готовые превью по ключу «тип + масштаб + LaTeX».
 *
 * Кэш живёт на уровне модуля и намеренно переживает закрытие диалога: превью
 * зависит только от шаблона и типа формулы, а они между открытиями не
 * меняются. Перерисовывать полтора десятка SVG на каждое открытие — заметная
 * задержка на ровном месте.
 */
const cache = new Map<string, string>();

/** Разделитель частей ключа: в LaTeX и в типе формулы его быть не может. */
const KEY_SEPARATOR = '\u0000';

function buildCacheKey(latex: string, type: FormulaType, scale: number): string {
  return [type, scale, latex].join(KEY_SEPARATOR);
}

/**
 * Возвращает уже отрисованное превью, не запуская рендер.
 *
 * Нужен галерее шаблонов: при повторном открытии диалога она сразу показывает
 * формулы, а не моргает заглушкой в ожидании микрозадачи.
 */
export function getCachedLatexPreview(
  latex: string,
  type: FormulaType = 'math',
  scale = 1,
): string | undefined {
  return cache.get(buildCacheKey(latex, type, scale));
}

/**
 * Отрисовывает LaTeX в тот же SVG от MathJax, которым пользуется документ,
 * чтобы превью в галерее и живое превью совпадали с тем, что будет вставлено.
 *
 * Пустая строка в ответе означает «отрисовать не удалось».
 */
export async function renderLatexPreview(
  latex: string,
  type: FormulaType = 'math',
  scale = 1,
): Promise<string> {
  const key = buildCacheKey(latex, type, scale);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Незаполненные слоты шаблона после конвертации читаются как «??», а пустая
  // рамка говорит «сюда вводить» — именно это автору и нужно увидеть.
  const previewLatex = latex.replace(/\\placeholder\{\}/g, '\\square');

  const mathml = await latexToMathML(previewLatex, type);
  if (!mathml) return '';

  const svg = await renderMathML(mathml, {
    fontSizePx: DEFAULT_FORMULA_FONT_SIZE_PX * scale,
  });

  // Неудачу рендера (например, MathJax не дотянул динамический кусок шрифта)
  // кэшировать нельзя: превью осталось бы заглушкой навсегда, хотя со второй
  // попытки отрисовалось бы.
  if (svg) cache.set(key, svg);
  return svg;
}

/** Тестовый шов: сбрасывает кэш превью. */
export function clearPreviewCache(): void {
  cache.clear();
}
