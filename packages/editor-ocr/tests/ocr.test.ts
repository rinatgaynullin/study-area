import { RichEditorCore, extractTexAnnotation } from '@rich-editor/core';
import { createChemistryFeature } from '@rich-editor/chemistry';
import { createDrawingsFeature } from '@rich-editor/drawings';
import { createRichEditor, type RichEditorUi } from '@rich-editor/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ceToLatex,
  closeOpenEnvironments,
  fixMarkdownTableLines,
  htmlToOcrText,
  markdownToHtml,
  ocrTextToHtml,
  pipesToVmatrix,
  wrapBareLatex,
} from '../src';

const formulaLatexes = (html: string): string[] =>
  [...html.matchAll(/data-mathml="([^"]*)"/g)].map((match) => {
    const mathml = match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

    return extractTexAnnotation(mathml) ?? '';
  });

const TRIANGLE = '{"type":"2d","vertices":{"A":[0,0],"B":[4,0],"C":[0,3]},"edges":[["A","B"],["B","C"],["C","A"]]}';

const SAMPLE = `# Решение

а) Рассмотрим $\\triangle DSA$: $(3\\sqrt{17})^2 = 3^2 + 12^2$
$$\\begin{cases} x+y=1 \\\\ x-y=3 \\end{cases}$$
| x | 1 | 2 |
|---|---|---|
| y | 3 | 4 |

* первый пункт
* второй **важный** пункт
1. раз
2. два

\\chemfig{CH_3-CH_2-CH_3} $\\xrightarrow{t, \\text{кат.}}$ \\ce{2H2 + O2 -> 2H2O}
<<<TIKZ_START>>>
\\begin{tikzpicture}\\end{tikzpicture}
<<<TIKZ_END>>>
<<<DATA_START>>>
${TRIANGLE}
<<<DATA_END>>>
Ответ: ~~12~~ 15.`;

describe('текст распознавания → HTML документа', () => {
  it('строит абзацы, заголовки, списки с нумерацией, таблицы и зачёркивание', async () => {
    const html = await ocrTextToHtml(SAMPLE, { subject: 'math' });

    expect(html).toContain('<h1>Решение</h1>');
    expect(html).toContain('<ul><li><p>первый пункт</p></li><li><p>второй <strong>важный</strong> пункт</p></li></ul>');
    expect(html).toContain('<ol><li><p>раз</p></li><li><p>два</p></li></ol>');
    expect(html).toContain('<table><tbody><tr><th><p>x</p></th>');
    expect(html).toContain('<td><p>4</p></td></tr></tbody></table>');
    expect(html).toContain('<s>12</s>');
  });

  it('формулы становятся узлами MathML с аннотацией LaTeX; системы — выключными', async () => {
    const html = await ocrTextToHtml(SAMPLE);
    const latexes = formulaLatexes(html);

    expect(latexes).toContain('\\triangle DSA');
    expect(latexes).toContain('(3\\sqrt{17})^2 = 3^2 + 12^2');
    expect(latexes.some((latex) => latex.includes('\\begin{cases}'))).toBe(true);
    expect(html).toMatch(/<p style="text-align: center"><span data-formula="true" data-formula-type="math" data-mathml="[^"]*cases/);
  });

  it('\\chemfig становится узлом структуры, \\ce — формулой-реакцией', async () => {
    const html = await ocrTextToHtml(SAMPLE);

    expect(html).toContain('data-chemistry-code="CH_3-CH_2-CH_3"');
    expect(html).toContain('data-chemistry-type="chemfig"');
    expect(html).toContain('data-formula-type="chem"');
    expect(formulaLatexes(html).some((latex) => latex.includes('\\text{H}_2') && latex.includes('\\to'))).toBe(true);
  });

  it('пара TIKZ + DATA становится узлом чертежа с данными и TikZ', async () => {
    const html = await ocrTextToHtml(SAMPLE);

    expect(html).toContain('data-geometry="true"');
    expect(html).toContain('data-geometry-data="{&quot;type&quot;:&quot;2d&quot;');
    expect(html).toContain('data-tikz-code="\\begin{tikzpicture}\\end{tikzpicture}"');
    // Чертёж — блок, не внутри абзаца.
    expect(html).not.toMatch(/<p>[^<]*<div data-geometry/);
  });

  it('вид чертежа: физика по предмету или по сцене, химия только по сцене', async () => {
    const data = '<<<DATA_START>>>{"elements":[{"type":"spring","points":[[0,0],[1,0]]}]}<<<DATA_END>>>';

    expect(await ocrTextToHtml(data)).toContain('data-physics-data=');
    // Явный тип сцены главнее предмета: треугольник остаётся чертежом и на физике.
    expect(await ocrTextToHtml(`<<<DATA_START>>>${TRIANGLE}<<<DATA_END>>>`, { subject: 'physics' })).toContain('data-geometry-data=');
    // Без типа и вершин предмет решает.
    expect(await ocrTextToHtml('<<<TIKZ_START>>>\\draw;<<<TIKZ_END>>><<<DATA_START>>>{"scale":30}<<<DATA_END>>>', { subject: 'physics' })).toContain('data-physics-data=');
    expect(await ocrTextToHtml(`<<<DATA_START>>>${TRIANGLE}<<<DATA_END>>>`, { subject: 'chemistry' })).toContain('data-geometry-data=');
    expect(
      await ocrTextToHtml('<<<TIKZ_START>>>**6(------)<<<TIKZ_END>>><<<DATA_START>>>{"type":"chemistry"}<<<DATA_END>>>'),
    ).toContain('data-chemistry-code="**6(------)"');
  });

  it('пустая сцена без TikZ не даёт узла; обёртки [[[ ]]] и $ $ понимаются', async () => {
    expect(await ocrTextToHtml('текст [[[DATA_START]]]{}[[[DATA_END]]]')).toBe('<p>текст</p>');

    const html = await ocrTextToHtml(`$TIKZ_START$ \\draw; $TIKZ_END$ $DATA_START$ ${TRIANGLE} $DATA_END$`);

    expect(html).toContain('data-tikz-code="\\draw;"');
  });

  it('чертёж из метаданных встаёт на место плейсхолдера $GEOMETRY_1$', async () => {
    const html = await ocrTextToHtml('Чертёж: $GEOMETRY_1$ готов', {
      metadata: { ocr_and_tikz_data_plots: [{ tikz_code: '\\draw;', data: JSON.parse(TRIANGLE) }] },
    });

    expect(html).toContain('data-geometry-data=');
    expect(html).toContain('data-tikz-code="\\draw;"');
    expect(html).not.toContain('GEOMETRY_1');
  });

  it('голый LaTeX оборачивается в формулу, \\ce без $ — тоже', async () => {
    const html = await ocrTextToHtml('Дробь \\frac{a}{b} и реакция \\ce{H2 + Cl2 -> 2HCl}.');

    expect(formulaLatexes(html)).toContain('\\frac{a}{b}');
    expect(html).toContain('data-formula-type="chem"');
  });

  it('экспорт PinQueen с HTML и формулами data-math-latex читается как документ', async () => {
    const html = await ocrTextToHtml(
      '<p>Пусть <span data-math-latex="x^2" data-math-display="false"></span></p><p><span data-math-latex="y=1" data-math-display="true"></span></p>'
      + '<span class="chemistry-node" data-chemistry-code="CH_3-OH"></span>',
    );

    expect(formulaLatexes(html)).toEqual(['x^2', 'y=1']);
    expect(html).toContain('data-chemistry-code="CH_3-OH"');
    expect(html).toContain('<p>Пусть ');
  });

  it('текст экранируется: разметка из распознавания не исполняется', async () => {
    const html = await ocrTextToHtml('Привет <img src=x onerror="alert(1)"> мир');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('HTML документа → текст распознавания', () => {
  it('пишет заголовки, абзацы, списки с нумерацией, таблицы, оформление и формулы', async () => {
    const html = await ocrTextToHtml(SAMPLE);
    const text = await htmlToOcrText(html);

    expect(text).toContain('# Решение');
    expect(text).toContain('$\\triangle DSA$');
    expect(text).toContain('$$\n\\begin{cases}');
    expect(text).toContain('| x | 1 | 2 |\n| --- | --- | --- |\n| y | 3 | 4 |');
    expect(text).toContain('* первый пункт\n* второй **важный** пункт');
    expect(text).toContain('1. раз\n2. два');
    expect(text).toContain('\\chemfig{CH_3-CH_2-CH_3}');
    expect(text).toContain('~~12~~');
    expect(text).toContain('<<<TIKZ_START>>>\n\\begin{tikzpicture}\\end{tikzpicture}\n<<<TIKZ_END>>>');
    expect(text).toContain(`<<<DATA_START>>>\n${TRIANGLE}\n<<<DATA_END>>>`);
  });

  it('физика получает блок SVG, свой TikZ и DATA', async () => {
    const data = '{"elements":[{"id":"s","type":"spring","points":[[0,0],[2,0]]}]}';
    const html = `<div data-physics="true" data-physics-data='${data}' data-tikz-code="\\draw;"></div>`;
    const text = await htmlToOcrText(html);

    expect(text).toContain('<<<SVG_START>>>\n<svg');
    expect(text).toContain('<<<TIKZ_START>>>\n\\draw;\n<<<TIKZ_END>>>');
    expect(text).toContain(`<<<DATA_START>>>\n${data}\n<<<DATA_END>>>`);
    expect(await htmlToOcrText(html, { physicsSvg: false })).not.toContain('SVG_START');
  });

  it('нумерованный список со start и вложенные списки', async () => {
    const text = await htmlToOcrText('<ol start="3"><li><p>три</p><ul><li><p>вложенный</p></li></ul></li><li><p>четыре</p></li></ol>');

    expect(text).toBe('3. три\n  * вложенный\n4. четыре');
  });
});

/** Значение атрибута сцены, разобранное строгим `JSON.parse` — как на бэке. */
const strictSceneOf = (html: string, attribute = 'data-physics-data'): unknown => {
  const root = document.createElement('div');

  root.innerHTML = html;

  const value = root.querySelector(`[${attribute}]`)?.getAttribute(attribute);

  if (value === undefined || value === null) throw new Error(`Нет узла с ${attribute}`);

  return JSON.parse(value) as unknown;
};

describe('сцены и пустые строки в тексте распознавания', () => {
  it('JSON сцены ложится в узел строгим и без потерь LaTeX в подписях', async () => {
    const scene = {
      type: 'physics',
      elements: [
        { id: 'F', type: 'vector', points: [[0, 0], [2, 0]], label: '\\vec{F}' },
        { id: 'a', type: 'angle', center: [0, 0], points: [[1, 0], [0, 1]], label: '\\frac{\\pi}{2}' },
        { id: 't', type: 'text_label', coords: [1, 1], text: '\\theta = \\nu t' },
      ],
    };
    const html = await ocrTextToHtml(`Схема:\n<<<DATA_START>>>\n${JSON.stringify(scene)}\n<<<DATA_END>>>`, { subject: 'physics' });

    expect(strictSceneOf(html)).toEqual(scene);
  });

  it('сцена с LaTeX без экранирования и хвостовыми запятыми тоже становится строгим JSON', async () => {
    const html = await ocrTextToHtml(
      '<<<DATA_START>>>\n{"type":"physics","elements":[{"id":"F","type":"vector","points":[[0,0],[2,0]],"label":"\\frac{F}{2}",},]}\n<<<DATA_END>>>',
    );

    expect(strictSceneOf(html)).toEqual({
      type: 'physics',
      elements: [{ id: 'F', type: 'vector', points: [[0, 0], [2, 0]], label: '\\frac{F}{2}' }],
    });
  });

  it('TikZ из текста сохраняется без правок LaTeX', async () => {
    const tikz = '\\begin{tikzpicture}\\node[align=center] {A\\\\B};\\end{tikzpicture}';
    const html = await ocrTextToHtml(`<<<TIKZ_START>>>\n${tikz}\n<<<TIKZ_END>>>\n<<<DATA_START>>>\n${TRIANGLE}\n<<<DATA_END>>>`);
    const root = document.createElement('div');

    root.innerHTML = html;

    expect(root.querySelector('[data-geometry-data]')?.getAttribute('data-tikz-code')).toBe(tikz);
    expect(strictSceneOf(html, 'data-geometry-data')).toEqual(JSON.parse(TRIANGLE));
  });

  it('пустые строки разделяют блоки, но пустыми абзацами не становятся', async () => {
    const html = await ocrTextToHtml('Первый\n\n\nВторой\n\n$$x^2$$\n\nТретий');

    expect(html).toContain('<p>Первый</p><p>Второй</p>');
    expect(html).not.toContain('<p></p>');
  });

  it('геометрия без TikZ пишется одним блоком DATA', async () => {
    const text = await htmlToOcrText(`<div data-geometry="true" data-geometry-data='${TRIANGLE}'></div>`);

    expect(text).not.toContain('TIKZ_START');
    expect(text).toContain(`<<<DATA_START>>>\n${TRIANGLE}\n<<<DATA_END>>>`);
  });
});

describe('круговое преобразование через редактор', () => {
  let ui: RichEditorUi | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    ui?.destroy();
    ui = undefined;
    host?.remove();
    host = undefined;
  });

  it('текст → документ → текст стабилен на образце', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    ui = createRichEditor({ element: host, features: [createChemistryFeature(), createDrawingsFeature()] });

    const first = await ocrTextToHtml(SAMPLE);

    ui.core.setHTML(first);

    const text = await htmlToOcrText(ui.core.getHTML());
    const second = await ocrTextToHtml(text);

    ui.core.setHTML(second);

    expect(await htmlToOcrText(ui.core.getHTML())).toBe(text);
    expect(text).toContain('\\chemfig{CH_3-CH_2-CH_3}');
    expect(text).toContain('1. раз\n2. два');
    expect(text).toContain('<<<TIKZ_START>>>');
  });
  it('документ не обрастает пустыми абзацами при повторных проходах', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    ui = createRichEditor({ element: host, features: [createChemistryFeature(), createDrawingsFeature()] });

    const pass = async (html: string): Promise<string> => {
      ui?.core.setHTML(await ocrTextToHtml(await htmlToOcrText(html)));

      return (ui?.core.getHTML() ?? '').replace(/<svg[\s\S]*?<\/svg>/g, '');
    };

    ui.core.setHTML(await ocrTextToHtml(SAMPLE));

    const twice = await pass(await pass(ui.core.getHTML()));

    expect(await pass(twice)).toBe(twice);
    expect(twice).not.toContain('<p></p>');
  });

  it('ядро без возможностей принимает формулы из текста', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    const core = new RichEditorCore({ element: host });

    core.setHTML(await ocrTextToHtml('Формула $x^2$ в тексте.'));
    expect(core.getHTML()).toContain('data-formula="true"');
    core.destroy();
  });
});

describe('помощники', () => {
  it('ceToLatex переводит реакцию в LaTeX с индексами и стрелками', () => {
    expect(ceToLatex('2H2 + O2 -> 2H2O')).toBe('2 \\text{H}_2 + \\text{O}_2 \\to 2 \\text{H}_2\\text{O}');
    expect(ceToLatex('A ->[t^o] B')).toContain('\\xrightarrow{\\text{t^\\circ}}');
  });

  it('закрывает незакрытые окружения перед следующим заголовком', () => {
    const fixed = closeOpenEnvironments('\\begin{cases} a \\\\ b\n# Далее');

    expect(fixed).toContain('\\end{cases}');
    expect(fixed.indexOf('\\end{cases}')).toBeLessThan(fixed.indexOf('# Далее'));
  });

  it('палочки превращаются в определитель, таблицы — нет', () => {
    expect(pipesToVmatrix('|1 2 3 4|')).toContain('\\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix}');
    expect(pipesToVmatrix('| слово длинное | x |')).toBe('| слово длинное | x |');
  });

  it('склеенные строки таблицы разделяются', () => {
    expect(fixMarkdownTableLines('| a | b | | c | d |')).toBe('| a | b |\n| c | d |');
  });

  it('wrapBareLatex не трогает уже обёрнутое и плейсхолдеры', () => {
    const text = wrapBareLatex('$a$ и \\frac{1}{2} и \uE000MATH0\uE001', /\uE000(MATH)(\d+)\uE001/g);

    expect(text).toBe('$a$ и $\\frac{1}{2}$ и \uE000MATH0\uE001');
  });

  it('markdownToHtml экранирует текст и понимает курсив', () => {
    const html = markdownToHtml('Это *курсив* и <b>не тег</b>', { placeholder: /\uE000(MATH)(\d+)\uE001/, isBlockPlaceholder: () => false });

    expect(html).toBe('<p>Это <em>курсив</em> и &lt;b&gt;не тег&lt;/b&gt;</p>');
  });
});
