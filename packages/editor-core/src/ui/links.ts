/** Схемы, по которым браузер действительно куда-то переходит. */
const NAVIGABLE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

const REGEX_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Приводит адрес из поля ввода к виду, который примет документ.
 *
 * Повторяет санитайзер: принимаются только адреса с навигационной схемой.
 * Адрес без схемы считаем сокращённой записью и достраиваем до https, а всё
 * остальное (javascript:, data: и прочее) отбрасываем — иначе диалог пустил бы
 * в документ то, что санитайзер всё равно вырежет. Функция одна на диалог и
 * поповер: два списка схем разошлись бы при первой же правке.
 *
 * @returns Нормализованный адрес или `null`, если адрес использовать нельзя.
 */
export function normalizeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const scheme = REGEX_SCHEME.exec(trimmed)?.[1].toLowerCase();
  if (!scheme) return `https://${trimmed}`;
  return NAVIGABLE_SCHEMES.includes(scheme) ? trimmed : null;
}
