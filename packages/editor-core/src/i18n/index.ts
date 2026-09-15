import type { MessagesTree, Translate } from '../types';
import { ru } from './ru';

export { ru } from './ru';
export { en } from './en';

export const DEFAULT_LOCALE = 'ru';

export interface I18nOptions {
  locale?: string;
  /** Locale → message tree. Merged over the built-in Russian bundle. */
  messages?: Record<string, MessagesTree>;
}

export interface I18n {
  readonly locale: string;
  t: Translate;
  setLocale(locale: string): void;
  setMessages(messages: Record<string, MessagesTree> | undefined): void;
}

function lookup(tree: MessagesTree | undefined, key: string): string | undefined {
  if (!tree) return undefined;
  let node: string | MessagesTree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Minimal dot-path translator. Resolution order: requested locale → built-in
 * Russian → the key itself, so a partial translation JSON degrades gracefully
 * instead of rendering blanks.
 */
export function createI18n(options: I18nOptions = {}): I18n {
  let locale = options.locale ?? DEFAULT_LOCALE;
  let messages = options.messages ?? {};

  const t: Translate = (key, params) => {
    const fromLocale = lookup(messages[locale], key);
    if (fromLocale !== undefined) return interpolate(fromLocale, params);

    // The built-in Russian bundle can itself be overridden by `messages.ru`.
    const fromDefault =
      locale === DEFAULT_LOCALE ? undefined : lookup(messages[DEFAULT_LOCALE], key);
    if (fromDefault !== undefined) return interpolate(fromDefault, params);

    const builtin = lookup(ru, key);
    if (builtin !== undefined) return interpolate(builtin, params);

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
    setMessages(next: Record<string, MessagesTree> | undefined) {
      messages = next ?? {};
    },
  };
}
