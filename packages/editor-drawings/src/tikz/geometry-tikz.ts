import type {
  GeometryEdge,
  GeometryScene,
  HyperbolaPlot,
  LinePlot,
  ParabolaPlot,
  Plot,
  Point,
  SqrtPlot,
  Vec2,
} from '../scene/types';
import {
  anchorTowards,
  leftNormal,
  mathLabel,
  num,
  options,
  placement,
  polyline,
  requiresLine,
  shifted,
  tikzColor,
  xy,
  xyz,
} from './common';

/**
 * Геометрическая сцена → TikZ.
 *
 * Три картинки по типу сцены: стереометрия с косоугольной проекцией через
 * векторы осей (`x`/`y`/`z` в опциях картинки, поэтому координаты пишутся
 * трёхмерными, а проекцию делает сам TikZ), планиметрия с `\pic{angle}` и
 * графики функций в `axis` pgfplots. Вход уже нормализован, но ссылки на
 * вершины в сечениях, цилиндрах и текстовых подписях не проверены — такие
 * элементы просто пропускаются.
 */

/** Канвасный вектор оси x 3D-картинки: «в глубину» влево-вниз; y вправо, z вверх. */
const X_VECTOR: Vec2 = [-0.6, -0.3];

const PREAMBLE_3D = `\\begin{tikzpicture}[scale=3, line join=round, line cap=round, x={(${X_VECTOR[0]}cm,${X_VECTOR[1]}cm)}, y={(1cm,0cm)}, z={(0cm,1cm)}, >=Stealth]`;
const STYLES_3D = '\\tikzset{hidden/.style={dashed, thin, color=black!70}, visible/.style={thick, color=black}}';
const PREAMBLE_2D = '\\begin{tikzpicture}[scale=1.5, line join=round, >=Stealth]';
const PREAMBLE_PLOT = '% requires: \\usepackage{pgfplots} \\pgfplotsset{compat=1.18}';

/**
 * Угол (в градусах) точки горизонтальной окружности, которая в проекции
 * оказывается крайней справа: через неё и диаметрально противоположную
 * проходят образующие цилиндра. Зависит только от вектора оси x.
 */
const SILHOUETTE_ANGLE = (Math.atan2(1, X_VECTOR[0]) * 180) / Math.PI;

const ANGLE_RADII: Record<string, number[]> = { single: [0.4], double: [0.4, 0.5], triple: [0.4, 0.5, 0.6] };

/** Засечки равенства: половина длины и шаг между соседними, в единицах мира. */
const TICK_HALF = 0.1;
const TICK_GAP = 0.12;

interface Context {
  scene: GeometryScene;
  is3d: boolean;
  /** Имя вершины → имя узла TikZ. */
  names: Map<string, string>;
  /** Библиотеки TikZ, которые понадобились по ходу обхода. */
  libraries: Set<string>;
}

/** Точка, запятая и скобки в имени узла ломают синтаксис TikZ — заменяются; совпавшие после замены нумеруются. */
const nodeNames = (vertices: Record<string, Point>): Map<string, string> => {
  const used = new Set<string>();
  const names = new Map<string, string>();

  Object.keys(vertices).forEach((name) => {
    const safe = name.replace(/[^A-Za-z0-9_'-]/g, '_') || 'P';
    let candidate = safe;
    let suffix = 2;

    while (used.has(candidate)) {
      candidate = `${safe}_${suffix}`;
      suffix += 1;
    }

    used.add(candidate);
    names.set(name, candidate);
  });

  return names;
};

const bare = (ctx: Context, name: string): string => ctx.names.get(name) ?? name;

const ref = (ctx: Context, name: string): string => `(${bare(ctx, name)})`;

/** Точка на канвасе: для 2D — она сама, для 3D — проекция теми же векторами осей, что в преамбуле. */
const canvas = (ctx: Context, point: Point): Vec2 =>
  ctx.is3d
    ? [point[0] * X_VECTOR[0] + point[1], point[0] * X_VECTOR[1] + (point[2] ?? 0)]
    : [point[0], point[1]];

/** Буква вершины: `A1` → `A_{1}`, остальное как есть. */
const vertexLabel = (name: string): string => {
  const indexed = /^([A-Za-z]+)(\d+)('*)$/.exec(name);

  return mathLabel(indexed ? `${indexed[1]}_{${indexed[2]}}${indexed[3]}` : name);
};

const indent = (line: string): string => `  ${line}`;

const assemble = (ctx: Context, head: string[], body: string[]): string => {
  const requires = requiresLine(ctx.libraries);

  return [...(requires ? [requires] : []), ...head, ...body.map(indent), '\\end{tikzpicture}'].join('\n');
};

const withHeading = (heading: string, lines: string[]): string[] => (lines.length > 0 ? [heading, ...lines] : []);

// ------------------------------------------------------- общие части 2D/3D

const angleLines = (ctx: Context): string[] => {
  if (ctx.scene.angles.length === 0) return [];

  ctx.libraries.add('angles');
  ctx.libraries.add('quotes');

  const lines: string[] = [];

  ctx.scene.angles.forEach((angle) => {
    const [p, v, q] = angle.points;
    const [a, b, c] = [p, v, q].map((name) => canvas(ctx, ctx.scene.vertices[name]));
    const start = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const end = Math.atan2(c[1] - b[1], c[0] - b[0]);
    const sweep = (((((end - start) * 180) / Math.PI) % 360) + 360) % 360;
    // `\pic{angle}` ведёт дугу против часовой от первого луча ко второму:
    // лучи меняются местами, чтобы вместо угла не вышел его развёрнутый остаток.
    const [first, last] = sweep > 180 ? [q, p] : [p, q];
    const spec = `${bare(ctx, first)}--${bare(ctx, v)}--${bare(ctx, last)}`;

    if (angle.style === 'right') {
      lines.push(`\\pic [draw, angle radius=0.3cm] {right angle = ${spec}};`);

      return;
    }

    const radii = ANGLE_RADII[angle.style] ?? ANGLE_RADII.single;

    radii.forEach((radius, index) => {
      const text = index === radii.length - 1 && angle.label ? `pic text={${mathLabel(angle.label)}}` : undefined;

      lines.push(
        `\\pic ${options('draw', `angle radius=${num(radius)}cm`, text && 'angle eccentricity=1.6', text)} {angle = ${spec}};`,
      );
    });
  });

  return withHeading('% Углы', lines);
};

const textLabelLines = (ctx: Context): string[] => {
  const lines: string[] = [];

  ctx.scene.textLabels.forEach((label) => {
    const text = mathLabel(label.text);

    if (label.position) {
      const [from, to] = label.position;
      const a = ctx.scene.vertices[from];
      const b = ctx.scene.vertices[to];

      if (!a || !b) return;

      ctx.libraries.add('calc');

      const normal = leftNormal(canvas(ctx, a), canvas(ctx, b));
      const side: Vec2 = label.offset === 'right' ? [-normal[0], -normal[1]] : normal;

      lines.push(`\\node[${anchorTowards(side[0], side[1])}] at ($${ref(ctx, from)}!0.5!${ref(ctx, to)}$) {${text}};`);
    } else if (label.coords) {
      lines.push(`\\node at ${xy(label.coords)} {${text}};`);
    }
  });

  return withHeading('% Текстовые подписи', lines);
};

const vertexLabelLines = (ctx: Context, fallback: string, innerSep: string): string[] =>
  withHeading(
    '% Подписи вершин',
    Object.keys(ctx.scene.vertices).map(
      (name) =>
        `\\node[${placement(ctx.scene.labels[name], fallback)}, fill=white, inner sep=${innerSep}] at ${ref(ctx, name)} {${vertexLabel(name)}};`,
    ),
  );

// --------------------------------------------------------------------- 3D

const sectionLines = (ctx: Context): string[] =>
  withHeading(
    '% Сечения',
    ctx.scene.sections.flatMap((section) => {
      const names = section.vertices.filter((name) => name in ctx.scene.vertices);

      return names.length >= 3 ? [`\\fill[fill=blue!10, opacity=0.5] ${names.map((name) => ref(ctx, name)).join(' -- ')} -- cycle;`] : [];
    }),
  );

/**
 * Цилиндр с вертикальной осью: окружности оснований лежат в плоскости xy,
 * поэтому `circle`/`arc` с безразмерным радиусом TikZ сам проецирует в
 * эллипсы. Нижнее основание — скрытая задняя дуга и видимая передняя.
 */
const cylinderLines = (ctx: Context): string[] =>
  withHeading(
    '% Цилиндры',
    ctx.scene.cylinders.flatMap((cylinder) => {
      if (!(cylinder.base in ctx.scene.vertices) || !(cylinder.top in ctx.scene.vertices)) return [];

      const radius = num(cylinder.radius);
      const front = num(SILHOUETTE_ANGLE - 180);
      const back = num(SILHOUETTE_ANGLE);
      const backEnd = num(SILHOUETTE_ANGLE + 180);
      const rim = (angle: string, name: string): string => `([shift={(${angle}:${radius})}]${bare(ctx, name)})`;

      return [
        `\\draw[hidden] ${rim(back, cylinder.base)} arc[start angle=${back}, end angle=${backEnd}, radius=${radius}];`,
        `\\draw[visible] ${rim(front, cylinder.base)} arc[start angle=${front}, end angle=${back}, radius=${radius}];`,
        `\\draw[visible] ${ref(ctx, cylinder.top)} circle (${radius});`,
        `\\draw[visible] ${rim(back, cylinder.base)} -- ${rim(back, cylinder.top)};`,
        `\\draw[visible] ${rim(front, cylinder.base)} -- ${rim(front, cylinder.top)};`,
      ];
    }),
  );

const edgeLines3d = (ctx: Context): string[] => {
  const rank = (edge: GeometryEdge): number => (edge.style === 'dashed' ? 0 : 1);
  const sorted = [...ctx.scene.edges].sort((a, b) => rank(a) - rank(b));

  return withHeading(
    '% Рёбра: сначала скрытые, чтобы видимые легли поверх',
    sorted.map((edge) => `\\draw[${edge.style === 'dashed' ? 'hidden' : 'visible'}] ${ref(ctx, edge.from)} -- ${ref(ctx, edge.to)};`),
  );
};

const render3d = (ctx: Context): string => {
  const { vertices } = ctx.scene;
  const body = [
    ...Object.keys(vertices).map((name) => `\\coordinate ${ref(ctx, name)} at ${xyz(vertices[name])};`),
    ...sectionLines(ctx),
    ...cylinderLines(ctx),
    ...edgeLines3d(ctx),
    ...angleLines(ctx),
    ...textLabelLines(ctx),
    ...vertexLabelLines(ctx, 'above', '1pt'),
  ];

  return assemble(ctx, [PREAMBLE_3D, STYLES_3D], body);
};

// --------------------------------------------------------------------- 2D

const edgeLines2d = (ctx: Context): string[] =>
  withHeading(
    '% Рёбра',
    ctx.scene.edges.map((edge) => {
      const color = tikzColor(edge.color);

      return `\\draw${options('thick', color && `color=${color}`, edge.style === 'dashed' && 'dashed')} ${ref(ctx, edge.from)} -- ${ref(ctx, edge.to)};`;
    }),
  );

/** Засечки равенства — короткие перпендикуляры у середины ребра, числом `ticks`. */
const tickLines = (ctx: Context): string[] =>
  withHeading(
    '% Засечки равенства',
    ctx.scene.edges.flatMap((edge) => {
      const count = edge.ticks ?? 0;
      const a = canvas(ctx, ctx.scene.vertices[edge.from]);
      const b = canvas(ctx, ctx.scene.vertices[edge.to]);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);

      if (count <= 0 || length === 0) return [];

      const along: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const normal = leftNormal(a, b);
      const middle: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

      return Array.from({ length: count }, (_, index) => {
        const center = shifted(middle, along, (index - (count - 1) / 2) * TICK_GAP);

        return `\\draw[thick] ${xy(shifted(center, normal, TICK_HALF))} -- ${xy(shifted(center, normal, -TICK_HALF))};`;
      });
    }),
  );

const plotLines2d = (ctx: Context): string[] =>
  withHeading(
    '% Окружности и графики',
    ctx.scene.plots.flatMap((plot) => {
      const color = tikzColor(plot.color);
      const style = options('thick', color && `color=${color}`, plot.style === 'dashed' && 'dashed');
      const label = (at: Vec2, anchor = 'above right'): string[] =>
        plot.label ? [`\\node[${anchor}] at ${xy(at)} {${mathLabel(plot.label)}};`] : [];

      switch (plot.type) {
        case 'circle': {
          const at = plot.centerVertex && plot.centerVertex in ctx.scene.vertices ? ref(ctx, plot.centerVertex) : xy(plot.center);

          return [
            `\\draw${style} ${at} circle (${num(plot.radius)});`,
            ...label(shifted(plot.center, [Math.SQRT1_2, Math.SQRT1_2], plot.radius)),
          ];
        }
        case 'line': {
          const [p1, p2] = plot.p1 && plot.p2 ? [plot.p1, plot.p2] : lineEnds(plot, [-5, 5]);

          return [`\\draw${style} ${xy(p1)} -- ${xy(p2)};`, ...label([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2])];
        }
        case 'point':
          return [
            `\\node[${plot.pointStyle === 'hollow' ? 'circle, draw, fill=white' : 'circle, fill'}, inner sep=1.5pt] at ${xy(plot.coords)} {};`,
            ...label(plot.coords),
          ];
        case 'freehand':
          return [`\\draw${style} ${polyline(plot.points)};`, ...label(plot.points[plot.points.length - 1])];
        case 'shading':
          return shadingPath(plot, xy) ? [`\\fill[blue!10, opacity=0.4] ${shadingPath(plot, xy)};`] : [];
        default:
          return [`% график «${plot.type}» в 2D-сцене не экспортируется`];
      }
    }),
  );

const render2d = (ctx: Context): string => {
  const { vertices } = ctx.scene;
  const body = [
    ...Object.keys(vertices).map((name) => `\\coordinate ${ref(ctx, name)} at ${xy([vertices[name][0], vertices[name][1]])};`),
    ...edgeLines2d(ctx),
    ...tickLines(ctx),
    ...angleLines(ctx),
    ...plotLines2d(ctx),
    ...textLabelLines(ctx),
    ...vertexLabelLines(ctx, 'below', '0.5pt'),
  ];

  return assemble(ctx, [PREAMBLE_2D], body);
};

// ---------------------------------------------------------------- plot_2d

interface Bounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

const DEFAULT_BOUNDS: Bounds = { xmin: -6, xmax: 6, ymin: -4, ymax: 6 };
const BOUNDS_MARGIN = 1;
/** Сколько отступать от края картинки, чтобы подпись графика не обрезалась. */
const LABEL_INSET = 0.3;

const parabolaAt = (plot: ParabolaPlot, x: number): number =>
  (plot.direction === 'down' ? -1 : 1) * plot.stretchY * ((x - plot.vertex[0]) / (plot.stretchX || 1)) ** 2 + plot.vertex[1];

const sqrtAt = (plot: SqrtPlot, x: number): number =>
  (plot.directionY === 'down' ? -1 : 1) * plot.stretch * Math.sqrt(plot.directionX === 'left' ? plot.vertex[0] - x : x - plot.vertex[0]) +
  plot.vertex[1];

const hyperbolaAt = (plot: HyperbolaPlot, x: number): number => plot.k / (x - plot.center[0]) + plot.center[1];

const lineAt = (plot: LinePlot, x: number): number => (plot.k ?? 0) * x + (plot.b ?? 0);

const lineEnds = (plot: LinePlot, fallback: [number, number]): [Vec2, Vec2] => {
  const [lo, hi] = clampDomain(plot.domain, fallback[0], fallback[1]);

  return [
    [lo, lineAt(plot, lo)],
    [hi, lineAt(plot, hi)],
  ];
};

/** Конечные точки области определения — чтобы границы осей захватили весь график. */
const domainPoints = (domain: [number, number] | undefined, at: (x: number) => number): Vec2[] =>
  (domain ?? []).filter(Number.isFinite).map((x): Vec2 => [x, at(x)]).filter((point) => Number.isFinite(point[1]));

const plotExtent = (plot: Plot): Vec2[] => {
  switch (plot.type) {
    case 'circle':
      return [
        [plot.center[0] - plot.radius, plot.center[1] - plot.radius],
        [plot.center[0] + plot.radius, plot.center[1] + plot.radius],
      ];
    case 'parabola':
      return [plot.vertex, ...domainPoints(plot.domain, (x) => parabolaAt(plot, x))];
    case 'sqrt':
      return [plot.vertex, ...domainPoints(plot.domain, (x) => sqrtAt(plot, x))];
    case 'hyperbola':
      return [plot.center];
    case 'line':
      return plot.p1 && plot.p2 ? [plot.p1, plot.p2] : domainPoints(plot.domain, (x) => lineAt(plot, x));
    case 'point':
      return [plot.coords];
    case 'shading':
      return plot.points ?? (plot.bounds ? [[plot.bounds[0], plot.bounds[2]], [plot.bounds[1], plot.bounds[3]]] : []);
    case 'freehand':
      return plot.points;
    default:
      return [];
  }
};

/** Границы осей: не уже умолчания, но с запасом вокруг всех точек графиков. */
const computeBounds = (plots: Plot[]): Bounds => {
  const bounds = { ...DEFAULT_BOUNDS };

  plots.flatMap(plotExtent).forEach(([x, y]) => {
    bounds.xmin = Math.min(bounds.xmin, Math.floor(x - BOUNDS_MARGIN));
    bounds.xmax = Math.max(bounds.xmax, Math.ceil(x + BOUNDS_MARGIN));
    bounds.ymin = Math.min(bounds.ymin, Math.floor(y - BOUNDS_MARGIN));
    bounds.ymax = Math.max(bounds.ymax, Math.ceil(y + BOUNDS_MARGIN));
  });

  return bounds;
};

const clampDomain = (domain: [number, number] | undefined, lo: number, hi: number): [number, number] => [
  Math.max(lo, Number.isFinite(domain?.[0] ?? -Infinity) ? (domain as [number, number])[0] : lo),
  Math.min(hi, Number.isFinite(domain?.[1] ?? Infinity) ? (domain as [number, number])[1] : hi),
];

const axisXY = (point: Vec2): string => `(axis cs:${num(point[0])},${num(point[1])})`;

/** `x - 1`, `x + 1` или `x`: pgfmath плохо читает `x - -1`. */
const shiftedVar = (offset: number): string => (offset === 0 ? 'x' : offset > 0 ? `x - ${num(offset)}` : `x + ${num(-offset)}`);

const constantTerm = (value: number): string => (value === 0 ? '' : value > 0 ? ` + ${num(value)}` : ` - ${num(-value)}`);

const scaled = (coefficient: number, body: string): string =>
  coefficient === 1 ? body : coefficient === -1 ? `-${body}` : `${num(coefficient)}*${body}`;

const shadingPath = (plot: Plot & { type: 'shading' }, point: (p: Vec2) => string): string | undefined => {
  if (plot.bounds) {
    const [x1, x2, y1, y2] = plot.bounds;

    return `${point([x1, y1])} rectangle ${point([x2, y2])}`;
  }

  return plot.points && plot.points.length > 0 ? `${plot.points.map(point).join(' -- ')} -- cycle` : undefined;
};

const plotOptions = (plot: Plot, fallbackColor: string, ...extra: Array<string | undefined>): string =>
  options('thick', tikzColor(plot.color) ?? fallbackColor, plot.style === 'dashed' && 'dashed', ...extra);

const domainOption = (lo: number, hi: number): string => `domain=${num(lo)}:${num(hi)}`;

const plotLines = (plot: Plot, bounds: Bounds): string[] => {
  const labelAt = (point: Vec2 | undefined, anchor = 'above right'): string[] =>
    plot.label && point ? [`\\node[${anchor}] at ${axisXY(point)} {${mathLabel(plot.label)}};`] : [];

  /** Подпись кривой — у правого края её области, если там она в кадре, иначе левее. */
  const curveLabel = (at: (x: number) => number, lo: number, hi: number): string[] => {
    const inside = (point: Vec2): boolean =>
      point[0] >= lo && point[0] <= hi && Number.isFinite(point[1]) && point[1] >= bounds.ymin + LABEL_INSET && point[1] <= bounds.ymax - LABEL_INSET;
    const candidates: Vec2[] = [hi - 0.6, lo + 0.6, (lo + hi) / 2].map((x) => [x, at(x)]);

    return labelAt(candidates.find(inside));
  };

  switch (plot.type) {
    case 'parabola': {
      const [vx, vy] = plot.vertex;
      const [lo, hi] = clampDomain(plot.domain, bounds.xmin, bounds.xmax);
      const inner = plot.stretchX === 1 || !plot.stretchX ? `(${shiftedVar(vx)})` : `((${shiftedVar(vx)})/${num(plot.stretchX)})`;
      const coefficient = (plot.direction === 'down' ? -1 : 1) * plot.stretchY;

      return [
        `\\addplot${plotOptions(plot, 'blue', domainOption(lo, hi), 'samples=100')} {${scaled(coefficient, `${inner}^2`)}${constantTerm(vy)}};`,
        ...curveLabel((x) => parabolaAt(plot, x), lo, hi),
      ];
    }
    case 'sqrt': {
      const [vx, vy] = plot.vertex;
      const toLeft = plot.directionX === 'left';
      const [lo, hi] = toLeft
        ? clampDomain(plot.domain, bounds.xmin, Math.min(vx, bounds.xmax))
        : clampDomain(plot.domain, Math.max(vx, bounds.xmin), bounds.xmax);

      if (lo >= hi) return [];

      const inner = toLeft ? (vx === 0 ? '-x' : `${num(vx)} - x`) : shiftedVar(vx);
      const coefficient = (plot.directionY === 'down' ? -1 : 1) * plot.stretch;

      return [
        `\\addplot${plotOptions(plot, 'blue', domainOption(lo, hi), 'samples=100')} {${scaled(coefficient, `sqrt(${inner})`)}${constantTerm(vy)}};`,
        ...curveLabel((x) => sqrtAt(plot, x), lo, hi),
      ];
    }
    case 'hyperbola': {
      const [cx, cy] = plot.center;
      // Ближе к асимптоте значения уходят за кадр: ветви начинаются там, где y ещё в границах.
      const gap = Math.max(0.05, Math.abs(plot.k) / Math.max(bounds.ymax - cy, cy - bounds.ymin, 0.5));
      const expression = `{${num(plot.k)}/(${shiftedVar(cx)})${constantTerm(cy)}}`;
      const branches: Array<[number, number]> = [
        clampDomain(plot.domain, bounds.xmin, cx - gap),
        clampDomain(plot.domain, cx + gap, bounds.xmax),
      ].filter(([lo, hi]) => lo < hi);
      const right = branches[branches.length - 1];

      return [
        ...branches.map(([lo, hi]) => `\\addplot${plotOptions(plot, 'blue', domainOption(lo, hi), 'samples=80')} ${expression};`),
        ...(right ? curveLabel((x) => hyperbolaAt(plot, x), right[0], right[1]) : []),
      ];
    }
    case 'line': {
      if (plot.p1 && plot.p2) {
        return [
          `\\draw${plotOptions(plot, 'red')} ${axisXY(plot.p1)} -- ${axisXY(plot.p2)};`,
          ...labelAt([(plot.p1[0] + plot.p2[0]) / 2, (plot.p1[1] + plot.p2[1]) / 2]),
        ];
      }

      const [lo, hi] = clampDomain(plot.domain, bounds.xmin, bounds.xmax);
      const k = plot.k ?? 0;
      const expression = k === 0 ? num(plot.b ?? 0) : `${scaled(k, 'x')}${constantTerm(plot.b ?? 0)}`;

      return [`\\addplot${plotOptions(plot, 'red', domainOption(lo, hi))} {${expression}};`, ...curveLabel((x) => lineAt(plot, x), lo, hi)];
    }
    case 'circle':
      return [
        `\\draw${plotOptions(plot, 'orange')} ${axisXY(plot.center)} circle [radius=${num(plot.radius)}];`,
        ...labelAt([plot.center[0], plot.center[1] + plot.radius], 'above'),
      ];
    case 'point':
      return [
        `\\node[${plot.pointStyle === 'hollow' ? 'circle, draw, fill=white' : 'circle, fill'}, inner sep=1.5pt] at ${axisXY(plot.coords)} {};`,
        ...labelAt(plot.coords),
      ];
    case 'shading': {
      const path = shadingPath(plot, axisXY);

      return path ? [`\\fill[blue!10, opacity=0.4] ${path};`] : [];
    }
    case 'freehand':
      return [`\\draw${plotOptions(plot, 'red')} ${plot.points.map(axisXY).join(' -- ')};`, ...labelAt(plot.points[plot.points.length - 1])];
    default:
      return [];
  }
};

/** Значение опции pgfplots: запятая или знак равенства внутри требуют фигурных скобок. */
const optionValue = (value: string): string => (/[,=\]]/.test(value) ? `{${value}}` : value);

const renderPlot2d = (scene: GeometryScene): string => {
  const bounds = computeBounds(scene.plots);
  const axisOptions = [
    'axis lines=middle',
    `xlabel=${optionValue(mathLabel(scene.axes.xLabel))}`,
    `ylabel=${optionValue(mathLabel(scene.axes.yLabel))}`,
    `xmin=${num(bounds.xmin)}`,
    `xmax=${num(bounds.xmax)}`,
    `ymin=${num(bounds.ymin)}`,
    `ymax=${num(bounds.ymax)}`,
    ...(scene.showGrid ? ['grid=both'] : []),
    'axis equal image',
  ];
  const body = scene.plots.flatMap((plot) => plotLines(plot, bounds));

  return [
    PREAMBLE_PLOT,
    '\\begin{tikzpicture}',
    `\\begin{axis}[${axisOptions.join(', ')}]`,
    ...body.map(indent),
    '\\end{axis}',
    '\\end{tikzpicture}',
  ].join('\n');
};

// ------------------------------------------------------------------ вход

/** Нормализованная геометрическая сцена → фрагмент TikZ. Не бросает: битые ссылки пропускаются. */
export const geometryToTikz = (scene: GeometryScene): string => {
  if (scene.type === 'plot_2d') return renderPlot2d(scene);

  const ctx: Context = {
    scene,
    is3d: scene.type === '3d',
    names: nodeNames(scene.vertices),
    libraries: new Set<string>(),
  };

  return ctx.is3d ? render3d(ctx) : render2d(ctx);
};
