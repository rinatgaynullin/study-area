/**
 * Образцы разметки, сохранённой старым редактором (Froala + Wiris).
 *
 * Формы взяты из вендорной спецификации Froala и из описания того, как
 * umschool хранит формулы. Оригинальные фикстуры проекта недоступны из этой
 * среды, поэтому образцы собраны по документированным контрактам: набор
 * классов, структура обёрток и кодировка `data-mathml` воспроизведены точно.
 */

/** Пустой GIF: реальный src не нужен, важна только разметка вокруг него. */
export const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/** Формула Wiris: MathML в атрибуте, экранированный дважды. */
export const WIRIS_FORMULA =
  `<p>Вычислите <img class="Wirisformula" src="${PIXEL}" data-mathml="` +
  '&amp;lt;math xmlns=&amp;quot;http://www.w3.org/1998/Math/MathML&amp;quot;&amp;gt;' +
  '&amp;lt;mfrac&amp;gt;&amp;lt;mi&amp;gt;a&amp;lt;/mi&amp;gt;&amp;lt;mi&amp;gt;b&amp;lt;/mi&amp;gt;' +
  '&amp;lt;/mfrac&amp;gt;&amp;lt;/math&amp;gt;"> и запишите ответ.</p>';

/** Вторая кодировка Wiris — «безопасный XML» с «»¨ вместо скобок и кавычек. */
export const WIRIS_SAFE_XML =
  `<p><img class="Wiriscas" src="${PIXEL}" data-mathml="` +
  '«math xmlns=¨http://www.w3.org/1998/Math/MathML¨»«msqrt»«mi»x«/mi»«/msqrt»«/math»"></p>';

/** Готовый вывод MathJax: исходного MathML рядом нет. */
export const MATHJAX_RENDERED =
  '<p>Известно, что <span class="formula-rendered">' +
  '<svg viewBox="0 0 24 12"><path d="M1 1 L23 11"></path></svg></span> для всех x.</p>';

/** Структурная формула химии из JSME. */
export const CHEMISTRY_STRUCTURE =
  '<div class="formula-chemistry-structure">' +
  '<svg viewBox="0 0 40 40"><rect x="2" y="2" width="36" height="36"></rect></svg></div>';

/** Картинки: блочная по центру, прижатая влево, инлайновая в строке. */
export const IMAGES_WITH_ALIGNMENT =
  `<p><img class="fr-dib" src="${PIXEL}" alt="по центру"></p>` +
  `<p><img class="fr-dib fr-fil" src="${PIXEL}" alt="влево"></p>` +
  `<p><img class="fr-dib fr-fir" src="${PIXEL}" alt="вправо"></p>` +
  `<p>В строке <img class="fr-dii" src="${PIXEL}" alt="в строке"> продолжение.</p>` +
  `<p><img class="fr-dii fr-fil" src="${PIXEL}" alt="обтекание слева"></p>`;

/** Оформление картинок: скругление, рамка, тень. */
export const IMAGES_WITH_DECORATION =
  `<p><img class="fr-dii fr-rounded" src="${PIXEL}" alt="скруглённая"></p>` +
  `<p><img class="fr-dii fr-bordered" src="${PIXEL}" alt="в рамке"></p>` +
  `<p><img class="fr-dii fr-shadow" src="${PIXEL}" alt="с тенью"></p>`;

/** Картинка с подписью — трёхуровневая обёртка Froala. */
export const IMAGE_WITH_CAPTION =
  '<span class="fr-img-caption fr-dib" style="width: 120px;">' +
  `<span class="fr-img-wrap"><img src="${PIXEL}" alt="схема">` +
  '<span class="fr-inner">Рис. 1. Подпись к схеме</span></span></span>';

/** Таблицы: пунктирные границы, чередование строк, выделенные ячейки. */
export const TABLES =
  '<table class="fr-dashed-borders"><thead><tr><th>Величина</th><th>Значение</th></tr></thead>' +
  '<tbody><tr><td>Ускорение</td><td class="fr-highlighted">9.81</td></tr>' +
  '<tr><td>Масса</td><td class="fr-thick">2 кг</td></tr></tbody></table>' +
  '<table class="fr-alternate-rows"><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>';

/** Ссылки: файл со скрепкой и два вендорных варианта оформления. */
export const LINKS =
  '<p><a href="theory.pdf" class="fr-file">Теория.pdf</a>, ' +
  '<a href="https://example.com" class="fr-green">зелёная</a>, ' +
  '<a href="https://example.com" class="fr-strong">жирная</a>.</p>';

/** Подсветка: класс-маркер Froala и инлайновый стиль из inlineStyles. */
export const HIGHLIGHTS =
  '<p><span class="fr-class-highlighted">маркер</span> и ' +
  '<span style="background-color: #B6F0C8;">зелёная подсветка</span> и ' +
  '<span style="background-color: #FC8D8D;">красная</span>.</p>';

/** Текстовые классы Froala. */
export const TEXT_CLASSES =
  '<p class="fr-text-gray">серый</p>' +
  '<p class="fr-text-spaced">разрядка</p>' +
  '<p class="fr-text-uppercase">капс</p>' +
  '<p class="fr-text-bordered">в рамке сверху и снизу</p>' +
  '<p><span class="fr-class-code">код</span> и ' +
  '<span class="fr-class-transparency">полупрозрачный</span></p>';

/** Всё вместе — как выглядит настоящий документ из базы. */
export const FULL_DOCUMENT = [
  WIRIS_FORMULA,
  MATHJAX_RENDERED,
  IMAGES_WITH_ALIGNMENT,
  IMAGES_WITH_DECORATION,
  IMAGE_WITH_CAPTION,
  TABLES,
  LINKS,
  HIGHLIGHTS,
  TEXT_CLASSES,
].join('\n');

/** Классы, которые обязаны пережить путь вьюера. */
export const PRESERVED_CLASSES = [
  'fr-dib',
  'fr-dii',
  'fr-fil',
  'fr-fir',
  'fr-rounded',
  'fr-bordered',
  'fr-shadow',
  'fr-img-caption',
  'fr-img-wrap',
  'fr-inner',
  'fr-file',
  'fr-green',
  'fr-strong',
  'fr-dashed-borders',
  'fr-alternate-rows',
  'fr-highlighted',
  'fr-thick',
  'fr-class-highlighted',
  'fr-class-code',
  'fr-class-transparency',
  'fr-text-gray',
  'fr-text-spaced',
  'fr-text-uppercase',
  'fr-text-bordered',
] as const;
