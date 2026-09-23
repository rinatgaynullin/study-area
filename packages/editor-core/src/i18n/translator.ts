import type { Messages, Translate } from '../types';
import { en } from './en';
import { ru } from './ru';

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

const lookup = (table: Messages | undefined, key: string): string | undefined => {
  const value = table?.[key];

  return typeof value === 'string' ? value : undefined;
};

const interpolate = (template: string, params?: Record<string, string | number>): string => {
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
};

/**
 * Минимальный переводчик над плоскими `lower_snake`-таблицами.
 *
 * Порядок поиска: таблица хоста для запрошенного языка → встроенная для него →
 * таблица хоста для русского → встроенная русская → сам ключ. Частичный JSON
 * от хоста поэтому деградирует до встроенного перевода, а не до пустых
 * подписей, и русскую таблицу хост может переопределить через `messages.ru`.
 */
class Translator implements I18n {
  private currentLocale: string;

  private messages: Record<string, Messages>;

  constructor(options: I18nOptions = {}) {
    this.currentLocale = options.locale ?? DEFAULT_LOCALE;
    this.messages = options.messages ?? {};
  }

  get locale(): string {
    return this.currentLocale;
  }

  /** Стрелочное поле: `t` передаётся дальше без привязки к экземпляру. */
  readonly t: Translate = (key, params) => {
    const chain = [
      this.messages[this.currentLocale],
      BUILTIN[this.currentLocale],
      this.messages[DEFAULT_LOCALE],
      BUILTIN[DEFAULT_LOCALE],
    ];

    // Первый найденный перевод по цепочке; `??` не даёт заглядывать в таблицы дальше.
    const value = chain.reduce<string | undefined>(
      (found, table) => found ?? lookup(table, key),
      undefined,
    );

    return value === undefined ? key : interpolate(value, params);
  };

  setLocale(next: string): void {
    this.currentLocale = next;
  }

  setMessages(next: Record<string, Messages> | undefined): void {
    this.messages = next ?? {};
  }
}

export const createI18n = (options: I18nOptions = {}): I18n => new Translator(options);
