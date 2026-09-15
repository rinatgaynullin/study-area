import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, RichEditorCore, createI18n, en, ru } from '../src';

describe('i18n layer', () => {
  it('defaults to Russian', () => {
    const i18n = createI18n();

    expect(i18n.locale).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe('ru');
    expect(i18n.t('toolbar.bold')).toBe('Полужирный');
    expect(i18n.t('formula.titleChem')).toBe('Химическая формула');
  });

  it('switches strings from a supplied JSON tree', () => {
    const i18n = createI18n({
      locale: 'en',
      messages: { en: en as never },
    });

    expect(i18n.t('toolbar.bold')).toBe('Bold');
    expect(i18n.t('formula.categories.fractions')).toBe('Fractions');
  });

  it('accepts a partial translation and falls back to Russian for the rest', () => {
    const i18n = createI18n({
      locale: 'de',
      messages: { de: { toolbar: { bold: 'Fett' } } },
    });

    expect(i18n.t('toolbar.bold')).toBe('Fett');
    expect(i18n.t('toolbar.italic')).toBe('Курсив');
  });

  it('lets a host override the built-in Russian strings', () => {
    const i18n = createI18n({
      messages: { ru: { toolbar: { bold: 'Жирный' } } },
    });

    expect(i18n.t('toolbar.bold')).toBe('Жирный');
    expect(i18n.t('toolbar.italic')).toBe('Курсив');
  });

  it('interpolates parameters', () => {
    const i18n = createI18n();

    expect(i18n.t('toolbar.headingLevel', { level: 3 })).toBe('Заголовок 3');
    expect(i18n.t('errors.fileTooLarge', { name: 'a.png', size: '5 MB', max: '1 MB' })).toBe(
      'Файл «a.png» слишком большой: 5 MB. Максимум — 1 MB.',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    const i18n = createI18n({ messages: { ru: { x: 'a {known} b {unknown}' } } });

    expect(i18n.t('x', { known: '1' })).toBe('a 1 b {unknown}');
  });

  it('returns the key itself when nothing resolves', () => {
    expect(createI18n().t('nothing.here.at.all')).toBe('nothing.here.at.all');
  });

  it('changes locale and messages at runtime', () => {
    const i18n = createI18n({ messages: { en: en as never } });
    expect(i18n.t('toolbar.bold')).toBe('Полужирный');

    i18n.setLocale('en');
    expect(i18n.t('toolbar.bold')).toBe('Bold');

    i18n.setMessages({ en: { toolbar: { bold: 'Heavy' } } });
    expect(i18n.t('toolbar.bold')).toBe('Heavy');
  });

  it('ships matching key sets for the built-in bundles', () => {
    const keys = (tree: object, prefix = ''): string[] =>
      Object.entries(tree).flatMap(([key, value]) =>
        typeof value === 'string'
          ? [`${prefix}${key}`]
          : keys(value as object, `${prefix}${key}.`),
      );

    expect(keys(en).sort()).toEqual(keys(ru).sort());
  });
});

describe('i18n through the editor', () => {
  let core: RichEditorCore | undefined;
  let element: HTMLElement | undefined;

  afterEach(() => {
    core?.destroy();
    element?.remove();
    core = undefined;
    element = undefined;
  });

  function mount(options: Partial<ConstructorParameters<typeof RichEditorCore>[0]> = {}) {
    element = document.createElement('div');
    document.body.appendChild(element);
    core = new RichEditorCore({ element, ...options });
    return core;
  }

  it('exposes the translator and honours the configured locale', () => {
    const editor = mount({ locale: 'en', messages: { en: en as never } });

    expect(editor.t('toolbar.bold')).toBe('Bold');
    expect(editor.t('audio.record')).toBe('Record');
  });

  it('switches locale after construction', () => {
    const editor = mount({ messages: { en: en as never } });
    expect(editor.t('common.cancel')).toBe('Отмена');

    editor.setLocale('en');
    expect(editor.t('common.cancel')).toBe('Cancel');
  });

  it('uses the localized placeholder by default', () => {
    const editor = mount();
    expect(element!.querySelector('.rte-content')?.innerHTML).toContain('Начните писать');
  });
});
