/**
 * Варианты оформления ссылки, доступные в поповере.
 *
 * Класс попадает в марку ссылки, поэтому переживает экспорт и читается вьюером
 * без участия редактора. Хост может заменить набор своим — например, если в
 * его дизайн-системе ссылки различаются иначе.
 */
export interface LinkStyle {
  /** Ключ перевода подписи. */
  labelKey: string;
  /** CSS-класс на теге ссылки. Пустая строка — обычная ссылка без класса. */
  className: string;
}

export const DEFAULT_LINK_STYLES: LinkStyle[] = [
  { labelKey: 'link_style_default', className: '' },
  { labelKey: 'link_style_strong', className: 'rte-link--strong' },
  { labelKey: 'link_style_muted', className: 'rte-link--muted' },
];
