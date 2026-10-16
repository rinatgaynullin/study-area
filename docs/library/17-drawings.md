# 17. Чертежи: `@rich-editor/drawings`

## Назначение

Чертёж — блочный атомарный узел `geometry` или `physics`. Источник истины —
JSON-сцена в формате PinQueen в атрибуте `data-geometry-data` /
`data-physics-data` и TikZ в `data-tikz-code`; картинка рисуется по сцене при
показе и в HTML не хранится. Пакет даёт редактору два узла, две кнопки
тулбара и диалог с шаблонами, живым превью и TikZ, а вьюеру — лёгкий вход без
TipTap. Сцена хранится строкой как пришла: поля, которых рендер не знает, не
теряются.

```mermaid
flowchart LR
  json["JSON в data-*-data"] -- "parseSceneJson()" --> raw["объект"]
  raw -- "normalize*Scene()" --> scene["GeometryScene | PhysicsScene"]
  scene -- "render*Svg()" --> svg["SVG при показе"]
  scene -- "*ToTikz()" --> tikz["TikZ в data-tikz-code"]
```

## Когда использовать

- Геометрия: планиметрия (вершины, рёбра, углы, засечки, окружности),
  стереометрия (3D-вершины, сечения, цилиндры, кабинетная проекция), графики
  функций (парабола, корень, гипербола, прямая, окружность, штриховка, точки).
- Физика: механика, термодинамика, электрические цепи, оптика — элементы с
  типом и координатами.
- Документы от распознавания: сцены приходят «грязными», нормализация
  принимает синонимы и старые форматы; битый JSON показывается плейсхолдером.

## Интерфейс

Сигнатуры — [14-api-reference.md](14-api-reference.md#rich-editordrawings).

### Подключение

| Где | Что | Вход |
| --- | --- | --- |
| Редактор | `createRichEditor({ features: [createDrawingsFeature()] })`, `<RichEditor :features>` | `@rich-editor/drawings` |
| Вьюер | `createRichContent({ features: [drawingsContent] })` или `createDrawingsContent({ locale })` | `@rich-editor/drawings/viewer` |
| Стили | Подключаются сами при импорте из исходников; для `dist` — `@rich-editor/drawings/styles.css` | — |

`createDrawingsFeature({ toolbarItems?: boolean })`; подписи — `DRAWINGS_MESSAGES`
(ru, en), `messages` хоста их переопределяют. Заголовки карточек во вьюере
берутся из таблиц возможности по `locale` документной части.

### Формат узла

```html
<div data-geometry="true" data-geometry-data='{"type":"2d","vertices":{…},"edges":[…]}'
     data-tikz-code="\begin{tikzpicture}…" class="rte-drawing rte-drawing--geometry"
     role="img" aria-label="Чертёж"></div>
```

| Атрибут | Что хранит |
| --- | --- |
| `data-geometry-data`, `data-physics-data` | JSON-сцена строкой; узел читается и из `span`, и из `div` PinQueen |
| `data-tikz-code` | TikZ; генерируется диалогом из сцены, при импорте сохраняется |
| `aria-label` | Имя для читалки: «Чертёж» / «Физическая схема» |

Правила санитайзера — `DRAWINGS_SANITIZER_RULES` (пять атрибутов выше);
серверная копия — `DRAWINGS_ATTRS` в `rich_editor/sanitize.py`.

### Модель сцены

Геометрия (`GeometryScene`): `type` `2d | 3d | plot_2d` (3D с нулевой
глубиной понижается до 2D; без вершин, но с графиками — `plot_2d`),
`vertices` `{ A: [x, y] | [x, y, z] }`, `edges` (`from`, `to`, `style`
`solid | dashed`, `ticks` 0–4), `angles` (`points` — три вершины, вершина
угла вторая; `style` `right | single | double | triple`; `label`), `labels`
(положение буквы: `below left`, `above`…), `textLabels` (у середины отрезка
`position` со стороной `offset` или в точке `coords` мира), `sections` и
`cylinders` (только 3D), `plots`, `angleY`/`angleZ`, `scale`, `offsetX`/`offsetY`,
`showGrid`, `showAxes`, `axes`.

Графики (`Plot`): `circle` (`center` или `centerVertex`, `radius`, `fill`),
`parabola` (`vertex`, `direction`, `stretchX`, `stretchY`, `domain`), `sqrt`,
`hyperbola` (`center`, `k`), `line` (`p1`/`p2` или `k`/`b`), `point` (`coords`,
`pointStyle` `solid | hollow`, `label`), `shading` (`points` или `bounds`),
`freehand`.

Физика (`PhysicsScene`): `elements[]` с `id`, `type`, `label` (LaTeX-подмножество:
греческие буквы, индексы, `\vec{}`, `\text{}`), `color`, `dashed` и геометрией
`points` / `center` / `coords`. Типы по разделам:

| Раздел | Типы |
| --- | --- |
| Механика | `surface` (`hatching`), `arc_surface`, `block` (`subtype` rectangle/circle/pulley, `angle`), `rope`, `spring`, `vector` (`vectorType` force/acc), `angle`, `stickman`, `balloon`, `ellipse_platform`, `dimension_line` |
| Термодинамика | `thermo_axes` (`xTicks`/`yTicks`), `thermo_point`, `thermo_process` (`subtype` line/isotherm/isochor), `piston_vessel` |
| Электричество | `circuit_component` (resistor/capacitor/inductor/switch/source/battery/voltmeter/ammeter/lamp/diode), `wire` (`wavy`), `charge`, `field_line`, `capacitor_plate`, `current_conductor`, `circle_shape` |
| Оптика | `lens` (converging/diverging, `focalLength`), `mirror`, `ray`, `optics_arrow`, `prism`, `glass_slab` |
| Общее | `text_label` |

### Нормализация

`parseSceneJson(text)` — терпимый разбор: ограждение ```` ```json ````, LaTeX-слеши
в строках, хвостовые запятые, одинарные и «умные» кавычки, ключи без кавычек,
комментарии; без `eval`. `normalizeGeometryScene(raw)` и
`normalizePhysicsScene(raw)` принимают что угодно и всегда возвращают сцену:
рёбра массивом, `{from,to}`, `{start,end}`, `{source,target}`; `circle`/`circles`;
`markings` как углы (без точек — пропуск); синонимы элементов `wall → surface`,
`weight`/`box` → `block`, `piston` → `piston_vessel`, `point` → `charge`,
`axis` → `vector`; группы `vessels`/`charges`/`vectors`/`elements`; старые
термографики `graph`, `graph_pV` и верхнеуровневые `thermo_*` с нормировкой
координат в окно 2..6 × 1.5..5.5; `splitEdgesThroughVertices` режет рёбра,
на которых лежит вершина. Подмены сцены `incline` шаблоном, как в оригинале,
нет: данные пользователя не выбрасываются. `detectDrawingKind(raw, hint?)`
отличает физику от геометрии по типу, термо-полям и элементам.

### Рендер и экспорт

| Функция | Что делает |
| --- | --- |
| `renderGeometrySvg(scene, { width?, height?, highlight?, autoFit? })` | SVG 300×300; слои: сетка → сечения → цилиндры → рёбра → углы → окружности → вершины → подписи; `plot_2d` — оси, тики и графики |
| `renderPhysicsSvg(scene, { width?, height?, highlight?, autoFit? })` | SVG 340×300 со всеми типами элементов |
| `renderDrawingPreview(kind, scene, scale?)` | Превью карточки 340×300 с `autoFit`; `null`, если рисовать нечего |
| `geometryToTikz(scene)`, `physicsToTikz(scene)` | TikZ: 3D со `scale=3` и стилями hidden/visible, 2D с `\pic{angle}`, графики в `axis`; физика со `scale=0.5`, пружина `coil`, цепи в ключах circuitikz (`to[R]`, `to[C]`, `to[L]`, `battery1`…), изотерма гладкой кривой |
| `parsePgfplotsTikz(tikz)` | Сцена `plot_2d` из `\addplot`, если JSON нет |

Координаты: ось y вверх, масштаб 25 px на единицу (графики — 20); 3D —
поворот `angleZ`, затем `angleY`, затем кабинетная проекция (глубина под 45°
с коэффициентом 0.5). `autoFit` вписывает сцену в картинку: масштаб 12–120
для геометрии, 12–80 для физики. Линии и текст — `currentColor`, подложки
подписей и сетка — классы под тему; явные цвета элементов (силы синие,
ускорения красные, подсветка `#ec4899`) остаются.

### Конструкторы

Диалог открывает сцену на вкладке подходящего конструктора; вкладка JSON —
запасной путь и способ посмотреть сцену как есть. Конструктор реализует
`SceneEditor` (`load(scene)`, `getScene()`, `onChange()`, `focus()`), а
подключается через `SceneEditorFactory` (`id`, `kind`, `labelKey`,
`accepts(scene)`, `create(context)`); `createDrawingsFeature({ editors })`
принимает свой список, по умолчанию — `DEFAULT_SCENE_EDITORS`.
`createDrawingsFeature({ scans: () => urls })` показывает сканы работы ученика
рядом с полотном.

| Вкладка | Что умеет |
| --- | --- |
| Планиметрия (`planimetryEditorFactory`) | Точки, отрезки, окружности (центр — точка `O`), углы (прямой — уголком), засечки 0–4, подписи у отрезков и в точке; перетаскивание точек с прилипанием к отрезкам, окружностям и сетке 0.5 (`Shift` отключает); панель свойств: имя и положение буквы, тип линии и засечки, вид дуги и метка угла, радиус и подпись окружности, текст; отмена и повтор (`Ctrl+Z`, `Ctrl+Y`), `Delete`, `Escape`, зум колесом и панорамирование средней кнопкой; точка на отрезке делит его сразу |
| Стереометрия (`stereometryEditorFactory`) | Шаблоны пирамид (3 и 4), призмы, параллелепипеда и цилиндра; вращение правой кнопкой (0.8°/px, наклон ±85°); точка — на ребре делит его, в пустоте ложится на плоскость `z = 0` обратной проекцией; отрезки, сечения из 3+ вершин, углы тремя кликами или вводом «SOH»; панель свойств: имя и подпись вершины, координаты, стиль ребра, заливка сечения, повороты, сетка и оси |
| Графики (`plotsEditorFactory`) | Шаблоны параболы, гиперболы, прямой, окружности и `√x`; точки (сплошные и пустые), карандаш с распознаванием штриха (прямая, окружность, парабола, иначе ломаная), штриховка многоугольником по кликам, подписи; перетаскивание графика целиком с прилипанием к сетке; панель свойств по виду графика (цвет, пунктир, метка, область по x, направление и растяжение, `k`, радиус и заливка) и подписи осей; `Ctrl+C`/`Ctrl+V` |
| Механика, термодинамика, электричество, оптика (`physicsEditorFactory`, одна вкладка с разделами) | Палитры всех 29 типов элементов; новый элемент встаёт в центр; выбор по хит-тесту, перетаскивание элемента целиком и его точек ручками, ручки размера у фигур; привязка к точкам других элементов, их отрезкам и сетке 0.5; `Ctrl+клик` и `Ctrl+C`/`Ctrl+V` дублируют; панель свойств по типу (подпись LaTeX, цвет, пунктир, подтип, тип вектора, заряд, штриховка, знак пластины, размеры, фокус, деления осей); смена раздела меняет только палитру, сцена остаётся |

Общая основа для всех вкладок — `SketchCanvas` (слой сцены через общий
рендер и оверлей для черновиков, координаты мира, зум к курсору),
`HistoryStack` (снимок до изменения — одна отмена возвращает прошлое
состояние), `ToolBar` и подбор фигур `fitLine` / `fitCircle` / `fitParabola`,
`recognizeStroke` для карандаша.

## Пример

```ts
import { createRichEditor } from '@rich-editor/core';
import { createDrawingsFeature } from '@rich-editor/drawings';

createRichEditor({ element, features: [createDrawingsFeature()] });
```

```ts
import { createRichContent } from '@rich-editor/core/viewer';
import { createDrawingsContent } from '@rich-editor/drawings/viewer';

createRichContent({ element, html, features: [createDrawingsContent({ locale: 'ru' })] });
```

```ts
// Рендер вне редактора: сцена от бэкенда → SVG и TikZ.
import { normalizeGeometryScene, parseSceneJson, renderGeometrySvg, geometryToTikz } from '@rich-editor/drawings';

const scene = normalizeGeometryScene(parseSceneJson(text));
const svg = renderGeometrySvg(scene, { autoFit: true });
const tikz = geometryToTikz(scene);
```

## Ограничения

- Ручек изменения формы у графиков нет: растяжение, радиус и `k` правятся в
  панели свойств. У физических осей длины правятся числами.
- SVG в документе не хранится: вьюер без документной части вырежет узлы.
  Standalone-сборка и Django-виджет пакет пока не включают.
- `textLabels.coords` — координаты мира (в PinQueen это были пиксели).
- TikZ не компилируется в редакторе; это экспорт для бэкенда и LaTeX.

## См. также

- [16-chemistry.md](16-chemistry.md), [03-vanilla-ui.md](03-vanilla-ui.md#возможность-editorfeature),
  [06-viewer.md](06-viewer.md#возможности-во-вьюере-contentfeature),
  [11-security.md](11-security.md#правила-возможностей).
