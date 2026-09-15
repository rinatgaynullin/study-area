/**
 * Payloads for the "paste HTML" panel. Each one exercises a different part of
 * the import path, so applying it shows what the editor keeps and what it drops.
 */
export interface HtmlSample {
  id: string;
  label: string;
  hint: string;
  html: string;
}

export const HTML_SAMPLES: HtmlSample[] = [
  {
    id: 'mathml',
    label: 'MathML из другого редактора',
    hint: 'Сырые <math> превращаются в редактируемые формулы, а не в «битый» текст.',
    html: `<h3>Импорт формул</h3>
<p>Дробь: <math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mrow><mi>a</mi><mo>+</mo><mn>1</mn></mrow><msqrt><mi>b</mi></msqrt></mfrac></math></p>
<p>Сумма: <math xmlns="http://www.w3.org/1998/Math/MathML"><munderover><mo>&#x2211;</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msup><mi>i</mi><mn>2</mn></msup></math></p>
<p>Реакция: <math xmlns="http://www.w3.org/1998/Math/MathML" data-formula-type="chem"><mrow><mn>2</mn><msub><mi mathvariant="normal">H</mi><mn>2</mn></msub><mo>+</mo><msub><mi mathvariant="normal">O</mi><mn>2</mn></msub><mo>&#x2192;</mo><mn>2</mn><msub><mi mathvariant="normal">H</mi><mn>2</mn></msub><mi mathvariant="normal">O</mi></mrow></math></p>`,
  },
  {
    id: 'system',
    label: 'Система уравнений',
    hint: 'Фигурная скобка (<mfenced>), таблица строк и корень внутри — сложный MathML из стороннего редактора.',
    html: `<p>При каких значениях параметра а система уравнений</p><p><math xmlns="http://www.w3.org/1998/Math/MathML"><mfenced close="" open="{"><mtable columnalign="left"><mtr><mtd><mo>(</mo><mi>x</mi><msup><mi>y</mi><mn>2</mn></msup><mo>-</mo><mn>3</mn><mi>x</mi><mi>y</mi><mo>-</mo><mn>3</mn><mi>y</mi><mo>+</mo><mn>9</mn><mo>)</mo><msqrt><mn>3</mn><mo>-</mo><mi>x</mi></msqrt><mo>=</mo><mn>0</mn></mtd></mtr><mtr><mtd><mi>y</mi><mo>=</mo><mi>a</mi><mi>x</mi></mtd></mtr></mtable></mfenced></math></p><p>имеет ровно три различных решения?</p>`,
  },
  {
    id: 'hostile',
    label: 'Небезопасный HTML',
    hint: 'Скрипты, обработчики событий, javascript:-ссылки и фреймы вырезаются.',
    html: `<p>Безопасный текст остаётся.</p>
<script>alert('xss')</script>
<img src="x" onerror="alert('xss')">
<a href="javascript:alert('xss')">ссылка со скриптом</a>
<a href="https://example.com" target="_blank">обычная ссылка</a>
<p style="color: green; background: url(javascript:alert(1))">стиль частично чистится</p>
<iframe src="https://example.com"></iframe>
<form><input name="login"><button>Отправить</button></form>
<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>`,
  },
  {
    id: 'word',
    label: 'Разметка из Word',
    hint: 'Мусорные обёртки и проприетарные теги схлопываются в чистый HTML.',
    html: `<div><span style="font-family:Calibri,sans-serif; font-size:14pt; color:#1F497D"><b>Заголовок из Word</b></span></div>
<p class="MsoNormal"><span lang="RU" style="font-size:11pt">Абзац с <o:p></o:p>проприетарной разметкой.</span></p>
<p class="MsoNormal"><span style="mso-spacerun:yes">&nbsp;&nbsp;</span>Вложенные <span><span><span>обёртки</span></span></span>.</p>
<table border="1" cellspacing="0"><tr><td><p class="MsoNormal">Ячейка</p></td><td><p>Вторая</p></td></tr></table>`,
  },
  {
    id: 'formatting',
    label: 'Базовое форматирование',
    hint: 'Всё, что поддерживает схема: списки, таблицы, цвета, индексы.',
    html: `<h2>Заголовок</h2>
<p><strong>жирный</strong>, <em>курсив</em>, <u>подчёркнутый</u>, <s>зачёркнутый</s>, <code>код</code></p>
<p>H<sub>2</sub>O и x<sup>2</sup>, <span style="color: #d32f2f">цветной</span>, <mark>выделенный</mark></p>
<ul><li><p>маркированный</p></li><li><p>список</p></li></ul>
<ol><li><p>нумерованный</p></li></ol>
<blockquote><p>Цитата</p></blockquote>
<pre><code>const x = 1;</code></pre>
<hr>
<table><tbody><tr><th><p>A</p></th><td><p>B</p></td></tr></tbody></table>`,
  },
];
