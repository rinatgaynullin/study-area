import { afterEach, describe, expect, it } from 'vitest';
import { RichEditorCore, prepareIncomingHtml } from '../src';
import {
  CHEMISTRY_STRUCTURE,
  FULL_DOCUMENT,
  HIGHLIGHTS,
  IMAGES_WITH_ALIGNMENT,
  IMAGES_WITH_DECORATION,
  IMAGE_WITH_CAPTION,
  LINKS,
  MATHJAX_RENDERED,
  PRESERVED_CLASSES,
  TABLES,
  TEXT_CLASSES,
  WIRIS_FORMULA,
  WIRIS_SAFE_XML,
} from './fixtures/froala-content';

/**
 * Путь вьюера: `prepareIncomingHtml` плюс `v-html`, без ProseMirror. Классы
 * здесь обязаны доживать до DOM в неизменном виде — на них держится весь
 * compat-слой стилей.
 */
const asViewer = (html: string) => prepareIncomingHtml(html, { legacy: true });

let core: RichEditorCore | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  core?.destroy();
  element?.remove();
  core = undefined;
  element = undefined;
});

const mount = (content: string) => {
  element = document.createElement('div');
  document.body.appendChild(element);
  core = new RichEditorCore({ element, content, legacy: true });

  return core;
};

describe('вьюер сохраняет классы оформления', () => {
  it('не теряет ни одного класса из перечня', () => {
    const html = asViewer(FULL_DOCUMENT);
    const lost = PRESERVED_CLASSES.filter((name) => !html.includes(name));

    expect(lost, 'на этих классах держатся compat-стили').toEqual([]);
  });

  it('сохраняет раскладку картинок', () => {
    const html = asViewer(IMAGES_WITH_ALIGNMENT);

    expect(html).toContain('class="fr-dib"');
    expect(html).toContain('fr-dib fr-fil');
    expect(html).toContain('fr-dib fr-fir');
    expect(html).toContain('class="fr-dii"');
  });

  it('сохраняет оформление картинок', () => {
    const html = asViewer(IMAGES_WITH_DECORATION);

    expect(html).toContain('fr-rounded');
    expect(html).toContain('fr-bordered');
    expect(html).toContain('fr-shadow');
  });

  it('сохраняет трёхуровневую обёртку подписи', () => {
    const html = asViewer(IMAGE_WITH_CAPTION);

    expect(html).toContain('fr-img-caption');
    expect(html).toContain('fr-img-wrap');
    expect(html).toContain('fr-inner');
    expect(html).toContain('Рис. 1. Подпись к схеме');
  });

  it('сохраняет классы таблиц и ячеек', () => {
    const html = asViewer(TABLES);

    expect(html).toContain('fr-dashed-borders');
    expect(html).toContain('fr-alternate-rows');
    expect(html).toContain('fr-highlighted');
    expect(html).toContain('fr-thick');
    expect(html).toContain('<th>');
  });

  it('сохраняет ссылки-файлы и вендорное оформление ссылок', () => {
    const html = asViewer(LINKS);

    expect(html).toContain('fr-file');
    expect(html).toContain('fr-green');
    expect(html).toContain('fr-strong');
    expect(html).toContain('theory.pdf');
  });

  it('сохраняет обе формы подсветки', () => {
    const html = asViewer(HIGHLIGHTS);

    expect(html).toContain('fr-class-highlighted');
    // Инлайновые цвета из inlineStyles переносятся как есть.
    expect(html).toContain('#B6F0C8');
    expect(html).toContain('#FC8D8D');
  });

  it('сохраняет текстовые классы', () => {
    const html = asViewer(TEXT_CLASSES);

    ['fr-text-gray', 'fr-text-spaced', 'fr-text-uppercase', 'fr-text-bordered'].forEach((name) => {
      expect(html).toContain(name);
    });
  });
});

describe('вьюер разбирает формулы', () => {
  it('превращает картинку Wiris в узел формулы', () => {
    const html = asViewer(WIRIS_FORMULA);

    expect(html).toContain('data-formula="true"');
    expect(html).toContain('<mfrac>');
    expect(html).not.toContain('Wirisformula');
  });

  it('понимает «безопасный XML»', () => {
    expect(asViewer(WIRIS_SAFE_XML)).toContain('<msqrt>');
  });

  it('сохраняет вывод MathJax и структурные формулы химии', () => {
    expect(asViewer(MATHJAX_RENDERED)).toContain('<svg');
    expect(asViewer(CHEMISTRY_STRUCTURE)).toContain('<svg');
  });

  it('оставляет текст вокруг формулы на месте', () => {
    const html = asViewer(WIRIS_FORMULA);

    expect(html).toContain('Вычислите');
    expect(html).toContain('и запишите ответ.');
  });
});

describe('документ переживает обратный импорт', () => {
  it('сохраняет формулы и структуру после экспорта и повторного разбора', async () => {
    const editor = mount(FULL_DOCUMENT);

    await editor.whenFormulasReady();

    const exported = editor.getHTML();

    expect(exported).toContain('data-formula="true"');

    editor.setHTML(exported);
    await editor.whenFormulasReady();

    const reimported = editor.getHTML();

    expect(reimported).toContain('data-formula="true"');
    expect(reimported).toContain('<mfrac>');
    expect(reimported).toContain('data-legacy-embed="true"');
    expect(editor.getText()).toContain('Вычислите');
  });

  it('не накапливает изменений при повторных проходах', async () => {
    const editor = mount(FULL_DOCUMENT);

    await editor.whenFormulasReady();

    const first = editor.getHTML();

    editor.setHTML(first);
    await editor.whenFormulasReady();

    const second = editor.getHTML();

    // Второй проход обязан быть неподвижной точкой: иначе каждое открытие
    // документа тихо меняло бы данные.
    expect(second).toBe(first);
  });
});
