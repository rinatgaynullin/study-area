import type { Messages, Translate } from '../types';
import { en } from './en';
import { ru } from './ru';

export { ru } from './ru';
export { en } from './en';

export const DEFAULT_LOCALE = 'ru';

/**
 * Встроенные таблицы. Русская — запасная для любого языка; английская
 * включается по `locale: 'en'` без таблицы от хоста: обе уже в бандле, и
 * молча оставлять интерфейс русским при явно запрошенном английском — ловушка.
 */
const BUILTIN: Record<string, Messages> = { ru, en };

export interface I18nOptions {
  locale?: string;
  /** Язык → плоская таблица. Накладывается поверх встроенных таблиц. */
  messages?: Record<string, Messages>;
}

export interface I18n {
  readonly locale: string;
  t: Translate;
  setLocale(locale: string): void;
  setMessages(messages: Record<string, Messages> | undefined): void;
}

function lookup(table: Messages | undefined, key: string): string | undefined {
  const value = table?.[key];
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Минимальный переводчик над плоскими `lower_snake`-таблицами.
 *
 * Порядок поиска: таблица хоста для запрошенного языка → встроенная для него →
 * таблица хоста для русского → встроенная русская → сам ключ. Частичный JSON
 * от хоста поэтому деградирует до встроенного перевода, а не до пустых
 * подписей, и русскую таблицу хост может переопределить через `messages.ru`.
 */
export function createI18n(options: I18nOptions = {}): I18n {
  let locale = options.locale ?? DEFAULT_LOCALE;
  let messages = options.messages ?? {};

  const t: Translate = (key, params) => {
    const chain = [
      messages[locale],
      BUILTIN[locale],
      messages[DEFAULT_LOCALE],
      BUILTIN[DEFAULT_LOCALE],
    ];

    for (const table of chain) {
      const value = lookup(table, key);
      if (value !== undefined) return interpolate(value, params);
    }

    return key;
  };

  return {
    get locale() {
      return locale;
    },
    t,
    setLocale(next: string) {
      locale = next;
    },
    setMessages(next: Record<string, Messages> | undefined) {
      messages = next ?? {};
    },
  };
}
