import type { Messages } from '../types';

/**
 * Накладывает таблицы переводов слева направо: правая главнее. Так подписи
 * возможностей ложатся под таблицы хоста, и хост может переопределить любую.
 * Без единой таблицы — `undefined`, чтобы переводчик не отличал «нет таблиц»
 * от «таблицы пустые».
 */
export const mergeMessages = (
  ...tables: Array<Record<string, Messages> | undefined>
): Record<string, Messages> | undefined => {
  const merged: Record<string, Messages> = {};
  let hasAny = false;

  tables.forEach((table) => {
    Object.entries(table ?? {}).forEach(([locale, messages]) => {
      merged[locale] = { ...merged[locale], ...messages };
      hasAny = true;
    });
  });

  return hasAny ? merged : undefined;
};
