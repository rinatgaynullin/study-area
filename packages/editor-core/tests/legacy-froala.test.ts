import { afterEach, describe, expect, it } from 'vitest';
import { RichEditorCore, decodeWirisMathml, prepareIncomingHtml } from '../src';

/**
 * Разметка, сохранённая старым редактором (Froala + Wiris). Открытие такого
 * документа на редактирование не должно терять данные: до появления
 * legacy-режима схема ProseMirror выбрасывала MathML формул, вывод MathJax и
 * структурные формулы химии — молча и безвозвратно.
 */

/** Как Wiris пишет формулу: HTML-экранирование, зачастую двойное. */
const WIRIS_DOUBLE_ESCAPED =
  '<p>Найдите <img class="Wirisformula" src="w.png" data-mathml="' +
  '&amp;lt;math xmlns=&amp;quot;http://www.w3.org/1998/Math/MathML&amp;quot;&amp;gt;' +
  '&amp;lt;mfrac&amp;gt;&amp;lt;mi&amp;gt;a&amp;lt;/mi&amp;gt;&amp;lt;mi&amp;gt;b&amp;lt;/mi&amp;gt;' +
  '&amp;lt;/mfrac&amp;gt;&amp;lt;/math&amp;gt;"> при a = 2.</p>';

/** Второй вариант кодировки Wiris — «безопасный XML». */
const WIRIS_SAFE_XML =
  '<p><img class="Wirisformula" src="w.png" data-mathml="' +
  '«math xmlns=¨http://www.w3.org/1998/Math/MathML¨»«msqrt»«mi»x«/mi»«/msqrt»«/math»"></p>';

const MATHJAX_OUTPUT =
  '<p>До <span class="formula-rendered"><svg viewBox="0 0 10 10"><path d="M0 0"></path></svg>' +
  '</span> после.</p>';

const CHEMISTRY_STRUCTURE =
  '<div class="formula-chemistry-structure"><svg viewBox="0 0 20 20"><rect x="1" y="1"></rect>' +
  '</svg></div>';

let core: RichEditorCore | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  core?.destroy();
  element?.remove();
  core = undefined;
  element = undefined;
});

function mount(content: string, legacy = true) {
  element = document.createElement('div');
  document.body.appendChild(element);
  core = new RichEditorCore({ element, content, legacy });
  return core;
}

describe('декодирование MathML из Wiris', () => {
  it('снимает двойное HTML-экранирование', () => {
    const decoded = decodeWirisMathml('&amp;lt;math&amp;gt;&amp;lt;mi&amp;gt;x&amp;lt;/mi&amp;gt;&amp;lt;/math&amp;gt;');
    expect(decoded).toContain('<math>');
    expect(decoded).toContain('<mi>x</mi>');
  });

  it('снимает одинарное экранирование', () => {
    expect(decodeWirisMathml('&lt;math&gt;&lt;mi&gt;x&lt;/mi&gt;&lt;/math&gt;')).toContain('<mi>x</mi>');
  });

  it('разбирает «безопасный XML» Wiris', () => {
    const decoded = decodeWirisMathml('«math»«mi»x«/mi»«/math»');
    expect(decoded).toBe('<math><mi>x</mi></math>');
  });

  it('возвращает пустую строку, если MathML не восстановился', () => {
    expect(decodeWirisMathml('не формула')).toBe('');
    expect(decodeWirisMathml('')).toBe('');
  });
});

describe('формулы Wiris переживают редактор', () => {
  it('превращаются в узел формулы с восстановленным MathML', () => {
    const html = mount(WIRIS_DOUBLE_ESCAPED).getHTML();

    expect(html).toContain('data-formula="true"');
    expect(html).toContain('<mfrac>');
    // Картинки-заглушки больше нет: формула стала узлом модели.
    expect(html).not.toContain('Wirisformula');
  });

  it('понимают «безопасный XML»', () => {
    expect(mount(WIRIS_SAFE_XML).getHTML()).toContain('<msqrt>');
  });

  it('не разрывают абзац, в котором стоят', () => {
    const html = mount(WIRIS_DOUBLE_ESCAPED).getHTML();

    // Один абзац, а не три: текст до формулы, формула, текст после.
    expect((html.match(/<p>/g) ?? []).length).toBe(1);
    expect(html).toContain('Найдите');
    expect(html).toContain('при a = 2.');
  });

  it('остаются картинкой, если MathML разобрать не удалось', () => {
    const html = mount('<p><img class="Wirisformula" src="w.png" data-mathml="мусор"></p>').getHTML();
    expect(html).toContain('<img');
  });
});

describe('фрагменты, которые нечем смоделировать', () => {
  it('сохраняют вывод MathJax вместо того, чтобы его потерять', () => {
    const html = mount(MATHJAX_OUTPUT).getHTML();

    expect(html).toContain('data-legacy-embed="true"');
    expect(html).toContain('<svg');
    expect(html).toContain('До');
    expect(html).toContain('после.');
  });

  it('сохраняют структурные формулы химии', () => {
    expect(mount(CHEMISTRY_STRUCTURE).getHTML()).toContain('<svg');
  });
});

describe('подсветка из инлайновых стилей', () => {
  it('становится маркой модели, сохраняя исходный цвет', () => {
    const html = mount('<p><span style="background-color: #B6F0C8;">важно</span></p>').getHTML();

    expect(html).toContain('<mark');
    expect(html).toContain('#B6F0C8');
  });

  it('не затрагивает спан, у которого задан только цвет текста', () => {
    const html = mount('<p><span style="color: #ff0000;">красный</span></p>').getHTML();

    expect(html).not.toContain('<mark');
    expect(html).toContain('255, 0, 0');
  });
});

describe('legacy-режим выключен по умолчанию', () => {
  it('оставляет разметку Wiris нетронутой в prepareIncomingHtml', () => {
    expect(prepareIncomingHtml(WIRIS_DOUBLE_ESCAPED)).toContain('Wirisformula');
    expect(prepareIncomingHtml(WIRIS_DOUBLE_ESCAPED, { legacy: true })).toContain('data-formula');
  });

  it('не расширяет схему узлом legacyEmbed', () => {
    expect(mount(MATHJAX_OUTPUT, false).getHTML()).not.toContain('data-legacy-embed');
  });
});
