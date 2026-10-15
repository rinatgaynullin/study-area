import type { PhysicsElement, PhysicsElementType, PhysicsScene, Vec2 } from '../scene/types';
import {
  anchorTowards,
  leftNormal,
  mathLabel,
  num,
  options,
  polyline,
  polylineMidpoint,
  requiresLine,
  shifted,
  tikzColor,
  xy,
} from './common';

/**
 * Физическая схема → TikZ: `scale=0.5`, по элементу на команду-другую.
 *
 * Цепи — в синтаксисе circuitikz, пружина и волнистый провод — декорациями
 * `coil`/`snake`, штриховка опор — `border`. Какие библиотеки понадобились,
 * собирается по ходу обхода и выносится в первую строку-комментарий.
 * Неизвестный или неполный элемент пропускается; экспорт никогда не бросает.
 */

interface Context {
  scene: PhysicsScene;
  libraries: Set<string>;
  packages: Set<string>;
  /** Определения `\tikzset`, которые понадобились элементам. */
  styles: Set<string>;
}

type Handler = (element: PhysicsElement, ctx: Context) => string[];

/** Стрелка посреди отрезка — для лучей и силовых линий, где стрелка на конце теряется. */
const MIDARROW_STYLE =
  '\\tikzset{midarrow/.style={postaction={decorate}, decoration={markings, mark=at position 0.55 with {\\arrow{Stealth}}}}}';

const SPRING_DECORATION = 'decoration={coil, aspect=0.3, segment length=1.5mm, amplitude=2mm, pre length=2mm, post length=2mm}';
const SNAKE_DECORATION = 'decoration={snake, amplitude=1.5pt, segment length=5pt}';

/** Ключи circuitikz по подтипу элемента цепи. */
const CIRCUIT_KEYS: Record<string, string> = {
  resistor: 'R',
  rheostat: 'vR',
  capacitor: 'C',
  inductor: 'L',
  coil: 'L',
  switch: 'switch',
  key: 'switch',
  source: 'battery1',
  battery: 'battery1',
  cell: 'battery1',
  voltmeter: 'voltmeter',
  ammeter: 'ammeter',
  lamp: 'lamp',
  bulb: 'lamp',
  diode: 'D',
};

const HATCH_SIDES: Record<string, Vec2> = { top: [0, 1], bottom: [0, -1], left: [-1, 0], right: [1, 0] };

const DEGREES = 180 / Math.PI;

const toDegrees = (dx: number, dy: number): number => Math.atan2(dy, dx) * DEGREES;

const normalizeDegrees = (angle: number): number => ((angle % 360) + 360) % 360;

const fromPolar = (center: Vec2, angle: number, radius: number): Vec2 => [
  center[0] + radius * Math.cos(angle / DEGREES),
  center[1] + radius * Math.sin(angle / DEGREES),
];

const pair = (element: PhysicsElement): [Vec2, Vec2] | undefined =>
  element.points && element.points.length >= 2 ? [element.points[0], element.points[1]] : undefined;

const colorOption = (element: PhysicsElement, fallback?: string): string | undefined => {
  const color = tikzColor(element.color) ?? fallback;

  return color ? `color=${color}` : undefined;
};

const dashedOption = (element: PhysicsElement): string | undefined => (element.dashed ? 'dashed' : undefined);

const rotateOption = (element: PhysicsElement, center: Vec2): string | undefined =>
  element.angle ? `rotate around={${num(element.angle)}:${xy(center)}}` : undefined;

const labelNode = (text: string | undefined, at: Vec2, anchor?: string): string[] =>
  text ? [`\\node${options(anchor)} at ${xy(at)} {${mathLabel(text)}};`] : [];

const midArrowSegments = (points: Vec2[], ctx: Context, ...style: Array<string | undefined>): string[] => {
  ctx.libraries.add('decorations.markings');
  ctx.styles.add(MIDARROW_STYLE);

  return points.slice(1).map((point, index) => `\\draw${options(...style, 'midarrow')} ${xy(points[index])} -- ${xy(point)};`);
};

/**
 * Опора: линия и штрихи декорацией `border`. При положительном угле штрихи
 * ложатся слева от направления пути, поэтому знак выбирается по тому, с
 * какой стороны от `a → b` лежит нужная сторона.
 */
const hatchedLine = (a: Vec2, b: Vec2, side: Vec2, element: PhysicsElement, ctx: Context): string[] => {
  ctx.libraries.add('decorations.pathreplacing');

  const normal = leftNormal(a, b);
  const onLeft = normal[0] * side[0] + normal[1] * side[1] >= 0;

  return [
    `\\draw${options('thick', colorOption(element), dashedOption(element))} ${xy(a)} -- ${xy(b)};`,
    `\\draw[decorate, decoration={border, angle=${onLeft ? 45 : -45}, amplitude=0.2cm, segment length=2mm}] ${xy(a)} -- ${xy(b)};`,
  ];
};

/** Начало осей p–V, в чьей первой четверти лежат обе точки: изотерма — гипербола относительно него. */
const thermoOrigin = (points: [Vec2, Vec2], ctx: Context): Vec2 => {
  const axes = ctx.scene.elements.find(
    (element) =>
      element.type === 'thermo_axes' &&
      points.every((point) => point[0] > (element.offset?.[0] ?? 0) && point[1] > (element.offset?.[1] ?? 0)),
  );

  return axes?.offset ?? [0, 0];
};

/** Точки изотермы pV = const между концами; константа интерполируется, если концы не на одной гиперболе. */
const isothermPoints = (points: [Vec2, Vec2], origin: Vec2, steps = 8): Vec2[] | undefined => {
  const [u0, v0] = [points[0][0] - origin[0], points[0][1] - origin[1]];
  const [u1, v1] = [points[1][0] - origin[0], points[1][1] - origin[1]];

  if (u0 <= 0 || u1 <= 0 || u0 === u1) return undefined;

  const [c0, c1] = [u0 * v0, u1 * v1];

  return Array.from({ length: steps + 1 }, (_, index): Vec2 => {
    const t = index / steps;
    const u = u0 + (u1 - u0) * t;

    return [origin[0] + u, origin[1] + (c0 + (c1 - c0) * t) / u];
  });
};

/** Прямой угол рисуется квадратиком, остальные — дугой с подписью на биссектрисе. */
const angleMark = (center: Vec2, start: number, sweep: number, radius: number, label: string | undefined): string[] => {
  const lines: string[] = [];

  if (Math.abs(sweep - 90) < 0.5) {
    const side = radius * 0.6;

    lines.push(
      `\\draw[thin] ${xy(fromPolar(center, start, side))} -- ${xy(shifted(fromPolar(center, start, side), [Math.cos((start + 90) / DEGREES), Math.sin((start + 90) / DEGREES)], side))} -- ${xy(fromPolar(center, start + 90, side))};`,
    );
  } else {
    lines.push(`\\draw[thin] ${xy(fromPolar(center, start, radius))} arc[start angle=${num(start)}, end angle=${num(start + sweep)}, radius=${num(radius)}];`);
  }

  return [...lines, ...labelNode(label, fromPolar(center, start + sweep / 2, radius + 0.4))];
};

const HANDLERS: Record<PhysicsElementType, Handler> = {
  surface: (element, ctx) => {
    const points = pair(element);

    if (!points) return [];

    const side = HATCH_SIDES[element.hatching ?? 'bottom'] ?? HATCH_SIDES.bottom;

    return [
      ...hatchedLine(points[0], points[1], side, element, ctx),
      ...labelNode(element.label, polylineMidpoint(points), anchorTowards(-side[0], -side[1])),
    ];
  },

  arc_surface: (element, ctx) => {
    const points = pair(element);
    const center = element.center;

    if (!points || !center) return [];

    const [p, q] = points;
    const radius = Math.hypot(p[0] - center[0], p[1] - center[1]);

    if (radius === 0) return [];

    const start = toDegrees(p[0] - center[0], p[1] - center[1]);
    const sweepCcw = normalizeDegrees(toDegrees(q[0] - center[0], q[1] - center[1]) - start);
    // Из двух дуг между концами берётся короткая; при равных — против часовой.
    const ccw = sweepCcw <= 180;
    const end = ccw ? start + sweepCcw : start - (360 - sweepCcw);
    const arc = `${xy(p)} arc[start angle=${num(start)}, end angle=${num(end)}, radius=${num(radius)}]`;
    const lines = [`\\draw${options('thick', colorOption(element), dashedOption(element))} ${arc};`];

    if (element.hatching) {
      ctx.libraries.add('decorations.pathreplacing');

      // Слева от дуги против часовой — центр: `inner` штрихуется к нему, остальное — наружу.
      const inward = element.hatching === 'inner';

      lines.push(`\\draw[decorate, decoration={border, angle=${inward === ccw ? 45 : -45}, amplitude=0.2cm, segment length=2mm}] ${arc};`);
    }

    const middle = (start + end) / 2;

    return [...lines, ...labelNode(element.label, fromPolar(center, middle, radius + 0.4), anchorTowards(Math.cos(middle / DEGREES), Math.sin(middle / DEGREES)))];
  },

  block: (element) => {
    const center = element.center;

    if (!center) return [];

    const subtype = element.subtype ?? (element.radius ? 'circle' : 'rectangle');

    if (subtype === 'circle') {
      return [
        `\\draw${options('thick', 'fill=gray!30', colorOption(element), dashedOption(element))} ${xy(center)} circle (${num(element.radius ?? 0.5)});`,
        ...labelNode(element.label, center),
      ];
    }

    if (subtype === 'pulley') {
      const radius = element.radius ?? 0.6;

      return [
        `\\draw${options('thick', 'fill=gray!10', colorOption(element), dashedOption(element))} ${xy(center)} circle (${num(radius)});`,
        `\\draw[thin, dashed] ${xy(center)} circle (${num(radius * 0.75)});`,
        `\\fill ${xy(center)} circle (1.5pt);`,
        ...labelNode(element.label, shifted(center, [Math.SQRT1_2, Math.SQRT1_2], radius), 'above right'),
      ];
    }

    const width = element.width ?? 0.8;
    const height = element.height ?? 0.6;

    return [
      `\\draw${options('thick', 'fill=gray!15', rotateOption(element, center), colorOption(element), dashedOption(element))} ${xy([center[0] - width / 2, center[1] - height / 2])} rectangle ${xy([center[0] + width / 2, center[1] + height / 2])};`,
      ...labelNode(element.label, center),
    ];
  },

  rope: (element) => {
    const points = element.points ?? [];

    if (points.length < 2) return [];

    return [
      `\\draw${options('thin', colorOption(element), dashedOption(element))} ${polyline(points)};`,
      ...labelNode(element.label, polylineMidpoint(points), 'above'),
    ];
  },

  spring: (element, ctx) => {
    const points = pair(element);

    if (!points) return [];

    ctx.libraries.add('decorations.pathmorphing');

    const normal = leftNormal(points[0], points[1]);

    return [
      `\\draw${options('decorate', SPRING_DECORATION, colorOption(element), dashedOption(element))} ${xy(points[0])} -- ${xy(points[1])};`,
      ...labelNode(element.label, shifted(polylineMidpoint(points), normal, 0.3), anchorTowards(normal[0], normal[1])),
    ];
  },

  vector: (element) => {
    const points = pair(element);

    if (!points) return [];

    const [tail, head] = points;
    const byType = element.vectorType === 'force' ? 'blue' : element.vectorType === 'acc' || element.vectorType === 'acceleration' ? 'red' : 'black';

    return [
      `\\draw${options('->', 'thick', colorOption(element, byType), dashedOption(element))} ${xy(tail)} -- ${xy(head)};`,
      ...labelNode(element.label, head, anchorTowards(head[0] - tail[0], head[1] - tail[1])),
    ];
  },

  angle: (element) => {
    // Центр и два луча — или три точки, где вершина посередине.
    const points = element.points ?? [];
    const center = element.center ?? (points.length >= 3 ? points[1] : undefined);
    const rays: [Vec2, Vec2] | undefined = element.center ? pair(element) : points.length >= 3 ? [points[0], points[2]] : undefined;

    if (!center || !rays) return [];

    const a = toDegrees(rays[0][0] - center[0], rays[0][1] - center[1]);
    const b = toDegrees(rays[1][0] - center[0], rays[1][1] - center[1]);
    let start = a;
    let sweep = normalizeDegrees(b - a);
    const wantInner = element.angleType !== 'outer';

    if ((wantInner && sweep > 180) || (!wantInner && sweep <= 180)) {
      start = b;
      sweep = 360 - sweep;
    }

    return angleMark(center, start, sweep, element.arcRadius ?? 0.8, element.label);
  },

  stickman: (element) => {
    const center = element.center;

    if (!center) return [];

    const h = element.height ?? 1.6;
    const stroke = options('thick', colorOption(element), dashedOption(element));
    const at = (x: number, y: number): string => xy([x * h, y * h]);

    return [
      `\\begin{scope}[shift={${xy(center)}}]`,
      `  \\draw${stroke} ${at(0, 0.38)} circle (${num(0.12 * h)});`,
      `  \\draw${stroke} ${at(0, 0.26)} -- ${at(0, -0.15)};`,
      `  \\draw${stroke} ${at(-0.22, 0.02)} -- ${at(0, 0.18)} -- ${at(0.22, 0.02)};`,
      `  \\draw${stroke} ${at(-0.2, -0.5)} -- ${at(0, -0.15)} -- ${at(0.2, -0.5)};`,
      ...labelNode(element.label, [0, 0.5 * h + 0.1], 'above'),
      '\\end{scope}',
    ];
  },

  balloon: (element) => {
    const center = element.center;

    if (!center) return [];

    const radius = element.radius ?? 0.6;
    const ry = radius * 1.25;
    const anchor = element.points?.[0];

    return [
      `\\draw${options('thick', colorOption(element), dashedOption(element))} ${xy(center)} ellipse (${num(radius)} and ${num(ry)});`,
      ...(anchor ? [`\\draw[thin] ${xy([center[0], center[1] - ry])} to[out=-90, in=90] ${xy(anchor)};`] : []),
      ...labelNode(element.label, center),
    ];
  },

  ellipse_platform: (element) => {
    const center = element.center;

    if (!center) return [];

    return [
      `\\draw${options('thick', 'fill=gray!10', rotateOption(element, center), colorOption(element), dashedOption(element))} ${xy(center)} ellipse (${num(element.rx ?? 2)} and ${num(element.ry ?? 0.5)});`,
      ...labelNode(element.label, center),
    ];
  },

  dimension_line: (element) => {
    const points = pair(element);

    if (!points) return [];

    const [a, b] = points;
    const normal = leftNormal(a, b);
    const bar = (point: Vec2): string => `\\draw[thin] ${xy(shifted(point, normal, 0.15))} -- ${xy(shifted(point, normal, -0.15))};`;
    const label = element.label ? ` node[midway, ${anchorTowards(normal[0], normal[1])}] {${mathLabel(element.label)}}` : '';

    return [`\\draw${options('<->', 'thin', colorOption(element), dashedOption(element))} ${xy(a)} --${label} ${xy(b)};`, bar(a), bar(b)];
  },

  thermo_axes: (element) => {
    const [ox, oy] = element.offset ?? [0, 0];
    const xEnd: Vec2 = [ox + (element.xLength ?? 7), oy];
    const yEnd: Vec2 = [ox, oy + (element.yLength ?? 5.5)];
    const lines = [
      `\\draw[->, thick] ${xy([ox, oy])} -- ${xy(xEnd)} node[right] {${mathLabel(element.xLabel ?? 'V')}};`,
      `\\draw[->, thick] ${xy([ox, oy])} -- ${xy(yEnd)} node[above] {${mathLabel(element.yLabel ?? 'p')}};`,
      `\\node[below left] at ${xy([ox, oy])} {${mathLabel(element.originLabel ?? '0')}};`,
    ];
    const seen = new Set<number>();

    (element.xTicks ?? []).forEach((tick) => {
      if (seen.has(tick.val)) return;

      seen.add(tick.val);
      lines.push(`\\draw ${xy([ox + tick.val, oy - 0.1])} -- ${xy([ox + tick.val, oy + 0.1])};`);
      lines.push(`\\node[below] at ${xy([ox + tick.val, oy])} {${mathLabel(tick.label ?? num(tick.val))}};`);
    });

    seen.clear();

    (element.yTicks ?? []).forEach((tick) => {
      if (seen.has(tick.val)) return;

      seen.add(tick.val);
      lines.push(`\\draw ${xy([ox - 0.1, oy + tick.val])} -- ${xy([ox + 0.1, oy + tick.val])};`);
      lines.push(`\\node[left] at ${xy([ox, oy + tick.val])} {${mathLabel(tick.label ?? num(tick.val))}};`);
    });

    return lines;
  },

  thermo_point: (element) => {
    const at = element.coords ?? element.center;

    if (!at) return [];

    return [`\\fill ${xy(at)} circle (2pt);`, ...labelNode(element.label, at, 'above right')];
  },

  thermo_process: (element, ctx) => {
    const points = pair(element);

    if (!points) return [];

    const stroke = options('->', 'thick', colorOption(element), dashedOption(element));
    const curve = element.subtype === 'isotherm' ? isothermPoints(points, thermoOrigin(points, ctx)) : undefined;
    const path = curve ? `plot[smooth] coordinates {${curve.map(xy).join(' ')}}` : `${xy(points[0])} -- ${xy(points[1])}`;
    const middle = curve ? curve[Math.floor(curve.length / 2)] : polylineMidpoint(points);

    return [`\\draw${stroke} ${path};`, ...labelNode(element.label, middle, 'above right')];
  },

  piston_vessel: (element) => {
    const center = element.center;

    if (!center) return [];

    const width = element.width ?? 2;
    const height = element.height ?? 3.5;
    const thickness = element.pistonThickness ?? 0.15;
    // Высота поршня — доля высоты сосуда от дна.
    const piston = ((element.pistonHeight ?? 0.6) - 0.5) * height;
    const rodTop = piston + thickness / 2 + 0.6;
    const stroke = options('thick', colorOption(element), dashedOption(element));

    return [
      `\\begin{scope}[shift={${xy(center)}}${element.angle ? `, rotate=${num(element.angle)}` : ''}]`,
      `  \\draw${stroke} ${xy([-width / 2, height / 2])} -- ${xy([-width / 2, -height / 2])} -- ${xy([width / 2, -height / 2])} -- ${xy([width / 2, height / 2])};`,
      `  \\draw${options('fill=black!60', 'thick', dashedOption(element))} ${xy([-width / 2 + 0.05, piston - thickness / 2])} rectangle ${xy([width / 2 - 0.05, piston + thickness / 2])};`,
      `  \\draw${stroke} ${xy([0, piston + thickness / 2])} -- ${xy([0, rodTop])};`,
      ...(element.weight ? [`  \\draw[fill=gray!30] ${xy([-0.32, rodTop])} rectangle ${xy([0.32, rodTop + 0.35])};`] : []),
      ...labelNode(element.label, [0, height / 2], 'above').map((line) => `  ${line}`),
      '\\end{scope}',
    ];
  },

  circuit_component: (element, ctx) => {
    const points = pair(element);

    if (!points) return [];

    ctx.packages.add('circuitikz');

    const key = CIRCUIT_KEYS[element.subtype ?? ''] ?? 'generic';
    const label = element.label ? `, l={${mathLabel(element.label)}}` : '';

    return [`\\draw${options(colorOption(element), dashedOption(element))} ${xy(points[0])} to[${key}${label}] ${xy(points[1])};`];
  },

  wire: (element, ctx) => {
    const points = element.points ?? [];

    if (points.length < 2) return [];

    if (element.wavy) ctx.libraries.add('decorations.pathmorphing');

    return [
      `\\draw${options('thick', element.wavy && 'decorate', element.wavy && SNAKE_DECORATION, colorOption(element), dashedOption(element))} ${polyline(points)};`,
      ...labelNode(element.label, polylineMidpoint(points), 'above'),
    ];
  },

  charge: (element) => {
    const at = element.coords ?? element.center;

    if (!at) return [];

    const sign = element.charge ?? element.label ?? 'q';
    const bySign = sign === '+' ? 'red' : sign === '-' || sign === '−' ? 'blue' : undefined;
    const label = element.label && element.label !== sign ? labelNode(element.label, shifted(at, [Math.SQRT1_2, Math.SQRT1_2], 0.3), 'above right') : [];

    return [`\\draw${options('thick', colorOption(element, bySign), dashedOption(element))} ${xy(at)} circle (0.3) node {${mathLabel(sign)}};`, ...label];
  },

  field_line: (element, ctx) => {
    const points = element.points ?? [];

    if (points.length < 2) return [];

    const bySubtype = element.subtype === 'electric' ? 'blue' : element.subtype === 'magnetic' ? 'green!60!black' : undefined;

    return [
      ...midArrowSegments(points, ctx, colorOption(element, bySubtype), dashedOption(element)),
      ...labelNode(element.label, points[points.length - 1], 'above right'),
    ];
  },

  capacitor_plate: (element) => {
    const points = pair(element);

    if (!points) return [];

    const [a, b] = points;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lines = [`\\draw${options('ultra thick', colorOption(element), dashedOption(element))} ${xy(a)} -- ${xy(b)};`];

    if (length > 0.3 && element.plateType && element.plateType !== 'neutral') {
      const along: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const normal = leftNormal(a, b);
      const sign = element.plateType === 'positive' ? '+' : '-';
      const count = Math.max(1, Math.floor(length / 0.6));
      const first = (length - (count - 1) * 0.6) / 2;

      for (let index = 0; index < count; index += 1) {
        lines.push(`\\node at ${xy(shifted(shifted(a, along, first + index * 0.6), normal, 0.35))} {$${sign}$};`);
      }
    }

    return [...lines, ...labelNode(element.label, b, anchorTowards(b[0] - a[0], b[1] - a[1]))];
  },

  current_conductor: (element) => {
    const at = element.coords ?? element.center;

    if (!at) return [];

    const into = element.subtype === 'cross' || element.subtype === 'into' || element.subtype === 'in';

    return [
      `\\node${options('font=\\Large', colorOption(element))} at ${xy(at)} {$${into ? '\\otimes' : '\\odot'}$};`,
      ...labelNode(element.label, shifted(at, [Math.SQRT1_2, Math.SQRT1_2], 0.3), 'above right'),
    ];
  },

  circle_shape: (element) => {
    const center = element.center;

    if (!center) return [];

    return [
      `\\draw${options('thick', colorOption(element), dashedOption(element))} ${xy(center)} circle (${num(element.radius ?? 1)});`,
      ...labelNode(element.label, center),
    ];
  },

  lens: (element) => {
    const center = element.center;

    if (!center) return [];

    const height = element.height ?? 2;
    const focal = element.focalLength ?? 2;
    const diverging = element.subtype === 'diverging';
    const tips = diverging ? '{Stealth[reversed]}-{Stealth[reversed]}' : '{Stealth}-{Stealth}';
    const [cx, cy] = center;

    return [
      `\\draw[thin, gray, dashed] ${xy([cx - 2.5 * focal, cy])} -- ${xy([cx + 2.5 * focal, cy])};`,
      `\\draw${options('thick', tips, colorOption(element), dashedOption(element))} ${xy([cx, cy - height / 2])} -- ${xy([cx, cy + height / 2])};`,
      ...[-2, -1, 1, 2].flatMap((multiple) => [
        `\\draw ${xy([cx + multiple * focal, cy - 0.1])} -- ${xy([cx + multiple * focal, cy + 0.1])};`,
        `\\node[below] at ${xy([cx + multiple * focal, cy])} {$${Math.abs(multiple) === 2 ? '2F' : 'F'}$};`,
      ]),
      `\\fill ${xy(center)} circle (1.5pt);`,
      ...labelNode(element.label, [cx, cy + height / 2], 'above'),
    ];
  },

  mirror: (element, ctx) => {
    const points = pair(element);

    if (!points) return [];

    const side = HATCH_SIDES[element.hatching ?? 'bottom'] ?? HATCH_SIDES.bottom;

    return [
      ...hatchedLine(points[0], points[1], side, element, ctx),
      ...labelNode(element.label, polylineMidpoint(points), anchorTowards(-side[0], -side[1])),
    ];
  },

  ray: (element, ctx) => {
    const points = element.points ?? [];

    if (points.length < 2) return [];

    return [
      ...midArrowSegments(points, ctx, 'thick', colorOption(element, 'orange'), dashedOption(element)),
      ...labelNode(element.label, points[points.length - 1], 'above right'),
    ];
  },

  optics_arrow: (element) => {
    const center = element.center;

    if (!center) return [];

    const height = element.height ?? 1;
    const upward = height >= 0;
    const tip: Vec2 = [center[0], center[1] + height];
    // Подпись из двух букв (`AB`, `A'B'`) делится: первая у основания, вторая у стрелки.
    const split = /^([A-Za-z]'*)([A-Za-z]'*)$/.exec(element.label ?? '');
    const labels = split
      ? [...labelNode(split[1], center, upward ? 'below' : 'above'), ...labelNode(split[2], tip, upward ? 'above' : 'below')]
      : labelNode(element.label, tip, upward ? 'above' : 'below');

    return [
      `\\draw${options('->', 'thick', colorOption(element, upward ? 'blue' : 'red'), dashedOption(element))} ${xy(center)} -- ${xy(tip)};`,
      ...labels,
    ];
  },

  prism: (element) => {
    const points = element.points ?? [];

    if (points.length < 3) return [];

    const centroid: Vec2 = [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];

    return [
      `\\draw${options('thick', 'fill=blue!10', colorOption(element), dashedOption(element))} ${polyline(points)} -- cycle;`,
      ...labelNode(element.label, centroid),
    ];
  },

  glass_slab: (element) => {
    const center = element.center;

    if (!center) return [];

    const width = element.width ?? 2;
    const height = element.height ?? 1;

    return [
      `\\draw${options('thick', 'fill=blue!10', rotateOption(element, center), colorOption(element), dashedOption(element))} ${xy([center[0] - width / 2, center[1] - height / 2])} rectangle ${xy([center[0] + width / 2, center[1] + height / 2])};`,
      ...labelNode(element.label, center),
    ];
  },

  text_label: (element) => {
    const at = element.coords ?? element.center;
    const text = element.text ?? element.label;

    if (!at || !text) return [];

    return [`\\node${options(colorOption(element))} at ${xy(at)} {${mathLabel(text)}};`];
  },
};

const indent = (line: string): string => `  ${line}`;

/** Нормализованная физическая сцена → фрагмент TikZ. Не бросает: битый элемент пропускается. */
export const physicsToTikz = (scene: PhysicsScene): string => {
  const ctx: Context = {
    scene,
    libraries: new Set<string>(['arrows.meta']),
    packages: new Set<string>(),
    styles: new Set<string>(),
  };
  const body: string[] = [];

  scene.elements.forEach((element) => {
    const handler = HANDLERS[element.type];

    if (!handler) return;

    try {
      body.push(...handler(element, ctx));
    } catch {
      // Неполные данные одного элемента не должны ломать экспорт всей схемы.
    }
  });

  const requires = body.length > 0 ? requiresLine(ctx.libraries, ctx.packages) : '';

  return [
    ...(requires ? [requires] : []),
    '\\begin{tikzpicture}[scale=0.5]',
    ...[...ctx.styles].map(indent),
    ...body.map(indent),
    '\\end{tikzpicture}',
  ].join('\n');
};
