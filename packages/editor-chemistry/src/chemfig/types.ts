/**
 * Модель структуры, разобранной из кода chemfig.
 *
 * Поддерживается подмножество языка: цепочки с углами, связи `-`, `=`, `~`,
 * ветви в скобках, кольца `*n(…)` и `**n(…)` с заместителями, индексы
 * `CH_3`. Этого хватает для школьной органики; остальное остаётся в коде как
 * есть и рисуется подписью.
 */

/** Одинарная, двойная и тройная связь. */
export type ChemBondType = '-' | '=' | '~';

export interface ChemAtom {
  /** Подпись как в коде (`CH_3`); пустая — безымянный узел цепи. */
  label: string;
  bonds: ChemBond[];
}

export interface ChemBond {
  type: ChemBondType;
  /** Абсолютный угол в градусах: 0 — вправо, растёт против часовой; `null` — по умолчанию. */
  angle: number | null;
  /** Связь объявлена в скобках — ветвь, а не продолжение цепи. */
  branch: boolean;
  target: ChemAtom;
}

export interface ChemChain {
  kind: 'chain';
  root: ChemAtom;
  /** Направление первой связи без явного угла; из префикса `[:30]`. */
  startAngle: number;
}

export interface ChemRing {
  kind: 'ring';
  /** Число вершин, от 3 до 8. */
  size: number;
  /** `**n` — ароматическое кольцо, рисуется с окружностью внутри. */
  aromatic: boolean;
  /** Типы связей по сторонам кольца, ровно `size` штук. */
  bonds: ChemBondType[];
  /**
   * Вершины по порядку. `null` — безымянный углерод без заместителей; атом с
   * подписью заменяет вершину, его связи — заместители наружу.
   */
  vertices: Array<ChemAtom | null>;
}

export type ChemStructure = ChemChain | ChemRing;
