import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHEMISTRY_MESSAGES, chemfigToSvg, parseChemfig, type ChemAtom } from '../src';
import { StructureEditor } from '../src/builder/structure-editor';
import { normalizeGroupLabel } from '../src/builder/structure-model';
import { CHEMISTRY_TEMPLATES } from '../src/templates';

let editor: StructureEditor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const t = (key: string): string => CHEMISTRY_MESSAGES.ru?.[key] ?? key;

const mount = (onChange?: () => void): StructureEditor => {
  editor = new StructureEditor({ t, onChange });
  document.body.appendChild(editor.element);

  return editor;
};

const click = (element: Element | null | undefined): void => {
  if (!element) throw new Error('Нет элемента для нажатия');

  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

const find = (root: StructureEditor, selector: string): Element => {
  const found = root.element.querySelector(selector);

  if (!found) throw new Error(`Нет элемента ${selector}`);

  return found;
};

const button = (root: StructureEditor, selector: string): HTMLButtonElement => {
  const found = root.element.querySelector<HTMLButtonElement>(selector);

  if (!found) throw new Error(`Нет кнопки ${selector}`);

  return found;
};

/** Видимые кнопки удаления в свойствах: скрыты сама кнопка или её ряд. */
const visibleDeletes = (root: StructureEditor): HTMLButtonElement[] =>
  [...root.element.querySelectorAll<HTMLButtonElement>('.rte-chem-builder__props [data-action="delete"]')].filter(
    (item) => !item.closest('[hidden]'),
  );

const plusAngles = (root: StructureEditor): number[] =>
  [...root.element.querySelectorAll('[data-plus]')].map((plus) => Number(plus.getAttribute('data-angle')));

const clickPlus = (root: StructureEditor, angle: number): void => {
  click(root.element.querySelector(`[data-plus][data-angle="${angle}"]`));
};

const chooseGroup = (root: StructureEditor, group: string): void => {
  click(button(root, `button[data-group="${group}"]`));
};

const hint = (root: StructureEditor): string => find(root, '.rte-chem-builder__hint').textContent ?? '';

const atomCount = (code: string): number => {
  const structure = parseChemfig(code);
  const walk = (atom: ChemAtom): number => 1 + atom.bonds.reduce((sum, bond) => sum + walk(bond.target), 0);

  if (structure.kind === 'chain') return walk(structure.root);

  return structure.vertices.reduce((sum, vertex) => sum + (vertex ? walk(vertex) : 0), 0);
};

/** Этанол тремя нажатиями: первая группа, «плюс» вправо с CH₂, «плюс» вправо с OH. */
const buildEthanol = (root: StructureEditor): void => {
  click(find(root, '[data-action="start"]'));
  chooseGroup(root, 'CH_2');
  clickPlus(root, 0);
  chooseGroup(root, 'OH');
  clickPlus(root, 0);
};

describe('конструктор структуры: сборка', () => {
  it('пустое полотно: подсказка и большой «плюс», который ставит выбранную группу', () => {
    const builder = mount();

    expect(builder.getCode()).toBe('');
    expect(hint(builder)).toBe('Выбери группу справа и нажми на плюс');
    expect(button(builder, 'button[data-group="CH_3"]').getAttribute('aria-pressed')).toBe('true');
    expect(button(builder, 'button[data-group="CH_3"]').textContent).toBe('CH₃');

    click(find(builder, '[data-action="start"]'));

    expect(builder.getCode()).toBe('CH_3');
    expect(builder.element.querySelector('.rte-chem-builder__canvas svg')).not.toBeNull();
    expect(hint(builder)).toBe('Нажми на плюс, чтобы присоединить группу. Группу можно заменить справа');
  });

  it('этанол тремя нажатиями: код разбирается, три атома и две одинарные связи, картинка как у шаблона', () => {
    const onChange = vi.fn();
    const builder = mount(onChange);

    buildEthanol(builder);

    const code = builder.getCode();
    const structure = parseChemfig(code);

    expect(code).toBe('CH_3-[:0]CH_2-[:0]OH');
    expect(atomCount(code)).toBe(3);
    expect(structure.kind === 'chain' && structure.root.bonds.map((bond) => bond.type)).toEqual(['-']);
    expect(chemfigToSvg(code)).toBe(chemfigToSvg('CH_3-CH_2-OH'));
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('двойная связь для новых атомов и смена типа выделенной связи', () => {
    const builder = mount();

    click(find(builder, '[data-action="start"]'));
    click(button(builder, 'button[data-bond="="]'));
    chooseGroup(builder, 'O');
    clickPlus(builder, 45);

    expect(builder.getCode()).toBe('CH_3=[:45]O');

    click(builder.element.querySelector('[data-bond="0"]'));
    expect(hint(builder)).toBe('Выбери тип связи или удали её');
    expect(button(builder, 'button[data-set-bond="="]').getAttribute('aria-pressed')).toBe('true');

    click(button(builder, 'button[data-set-bond="~"]'));
    expect(builder.getCode()).toBe('CH_3~[:45]O');
  });

  it('удаление атома убирает его ветку, удаление корня — всю структуру; отмена возвращает', () => {
    const builder = mount();

    buildEthanol(builder);
    click(builder.element.querySelector('[data-atom="1"]'));
    expect(visibleDeletes(builder)).toHaveLength(1);
    click(visibleDeletes(builder)[0]);
    expect(builder.getCode()).toBe('CH_3');

    click(button(builder, 'button[data-action="undo"]'));
    expect(builder.getCode()).toBe('CH_3-[:0]CH_2-[:0]OH');

    click(builder.element.querySelector('[data-atom="0"]'));
    find(builder, '.rte-chem-builder__stage').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
    );
    expect(builder.getCode()).toBe('');
    expect(builder.element.querySelector('[data-action="start"]')).not.toBeNull();

    find(builder, '.rte-chem-builder__stage').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(builder.getCode()).toBe('CH_3-[:0]CH_2-[:0]OH');

    find(builder, '.rte-chem-builder__stage').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(builder.getCode()).toBe('');
  });

  it('удаление выделенной связи убирает ветку за ней', () => {
    const builder = mount();

    buildEthanol(builder);
    click(builder.element.querySelector('[data-bond="1"]'));
    expect(visibleDeletes(builder)).toHaveLength(1);
    click(visibleDeletes(builder)[0]);
    expect(builder.getCode()).toBe('CH_3-[:0]CH_2');
  });

  it('Escape снимает выделение и не уходит дальше, пока оно есть', () => {
    const builder = mount();
    const outer = vi.fn();

    document.addEventListener('keydown', outer);
    click(find(builder, '[data-action="start"]'));

    const escape = (): void => {
      find(builder, '.rte-chem-builder__stage').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    };

    escape();
    expect(outer).not.toHaveBeenCalled();
    expect(builder.element.querySelector('[data-plus]')).toBeNull();

    escape();
    expect(outer).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outer);
  });
});

describe('конструктор структуры: «плюсы»', () => {
  it('занятые направления не предлагаются', () => {
    const builder = mount();

    buildEthanol(builder);
    click(builder.element.querySelector('[data-atom="1"]'));

    // К родителю — 180°, к OH — 0°.
    expect(plusAngles(builder)).toEqual([45, 90, 135, 225, 270, 315]);
  });

  it('у атома с четырьмя связями «плюсов» не больше свободных направлений', () => {
    const builder = mount();

    expect(builder.load('H-C(-[2]H)(-[6]H)-H')).toBe(true);
    click(builder.element.querySelector('[data-atom="1"]'));

    const angles = plusAngles(builder);

    expect(angles).toEqual([45, 135, 225, 315]);
    angles.forEach((angle) => {
      [0, 90, 180, 270].forEach((bond) => expect(Math.abs(angle - bond)).toBeGreaterThanOrEqual(30));
    });
  });
});

describe('конструктор структуры: кольцо', () => {
  it('бензол на пустом полотне, заместитель у вершины, подпись вершины и тип связи кольца', () => {
    const builder = mount();

    click(button(builder, 'button[data-ring="benzene"]'));
    expect(builder.getCode()).toBe('**6(------)');

    click(builder.element.querySelector('[data-atom="0"]'));
    expect(plusAngles(builder)).toEqual([30]);

    chooseGroup(builder, 'OH');
    clickPlus(builder, 30);
    expect(builder.getCode()).toBe('**6((-[:30]OH)------)');

    // Заместитель уже есть — второго «плюса» у той же вершины нет.
    click(builder.element.querySelector('[data-atom="0"]'));
    expect(plusAngles(builder)).toEqual([]);

    // Гетероатом во второй вершине и обратно; атомы раскладки идут по вершинам с их заместителями.
    click(builder.element.querySelector('[data-atom="2"]'));
    builder.element.querySelector<HTMLInputElement>('.rte-chem-builder__toggle input')?.click();
    chooseGroup(builder, 'N');
    expect(builder.getCode()).toBe('**6((-[:30]OH)-N-----)');

    click(button(builder, 'button[data-action="clear-label"]'));
    expect(builder.getCode()).toBe('**6((-[:30]OH)------)');

    // Сторона кольца: только одинарная или двойная, удалить нельзя.
    click(builder.element.querySelector('[data-bond="0"]'));
    expect(button(builder, 'button[data-set-bond="~"]').disabled).toBe(true);
    expect(visibleDeletes(builder)).toHaveLength(0);

    click(button(builder, 'button[data-set-bond="="]'));
    expect(builder.getCode()).toBe('**6((-[:30]OH)=-----)');
    expect(parseChemfig(builder.getCode()).kind).toBe('ring');
  });

  it('второе кольцо и кольцо в середине цепочки недоступны, причина — в подсказке кнопки', () => {
    const builder = mount();

    click(button(builder, 'button[data-ring="pentagon"]'));
    expect(builder.getCode()).toBe('*5(-----)');
    expect(button(builder, 'button[data-ring="benzene"]').disabled).toBe(true);
    expect(button(builder, 'button[data-ring="benzene"]').title).toBe('В формуле может быть только одно кольцо');

    builder.load('CH_3-CH_2-OH');
    click(builder.element.querySelector('[data-atom="1"]'));
    expect(button(builder, 'button[data-ring="hexagon"]').disabled).toBe(true);
    expect(button(builder, 'button[data-ring="hexagon"]').title).toContain('Кольцо можно начать только с пустого полотна');
  });

  it('кольцо у концевого корня цепочки: цепочка становится заместителем', () => {
    const builder = mount();

    builder.load('CH_3-CH_2-OH');
    click(builder.element.querySelector('[data-atom="0"]'));
    click(button(builder, 'button[data-ring="hexagon"]'));

    const code = builder.getCode();

    // Цепь шла вправо: ближайшая наружу вершина — первая (30°).
    expect(code).toBe('*6((-[:30]CH_3-CH_2-OH)------)');
    expect(atomCount(code)).toBe(4);
  });
});

describe('конструктор структуры: группы, загрузка, готовые формулы', () => {
  it('своя группа: C2H5 → C_2H_5, пустая строка отвергается', () => {
    const builder = mount();
    const input = find(builder, '.rte-chem-builder__custom-input');

    if (!(input instanceof HTMLInputElement)) throw new Error('нет поля своей группы');

    input.value = '';
    click(button(builder, 'button[data-action="custom"]'));
    expect(find(builder, '.rte-chem-builder__status').textContent).toBe('Напиши группу буквами и цифрами, например C2H5');

    input.value = 'C2H5';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(input.value).toBe('C_2H_5');
    expect(builder.element.querySelector('button[data-group][aria-pressed="true"]')).toBeNull();

    click(find(builder, '[data-action="start"]'));
    expect(builder.getCode()).toBe('C_2H_5');

    expect(normalizeGroupLabel('  ')).toBeNull();
    expect(normalizeGroupLabel('(CH3)2')).toBe('(CH_3)_2');
    expect(normalizeGroupLabel('A-B')).toBeNull();
    expect(normalizeGroupLabel('*6(')).toBeNull();
  });

  it('открывает шаблон и чужой код с углами; после добавления атома код разбирается', () => {
    const builder = mount();

    expect(builder.load('CH_3-C(=[1]O)-[7]OH')).toBe(true);
    click(builder.element.querySelector('[data-atom="1"]'));
    clickPlus(builder, plusAngles(builder)[0] ?? -1);
    expect(parseChemfig(builder.getCode())).toBeTruthy();
    expect(atomCount(builder.getCode())).toBe(5);

    expect(builder.load('[:30]CH_3-[:-30]CH_2-[:30]OH')).toBe(true);
    click(builder.element.querySelector('[data-atom="2"]'));
    clickPlus(builder, plusAngles(builder)[0] ?? -1);
    expect(atomCount(builder.getCode())).toBe(4);

    expect(builder.load('A-(B')).toBe(false);
    expect(builder.getCode()).toBe('');
  });

  it('шаблоны без правок дают ту же картинку; готовая формула заменяет структуру отменяемо', () => {
    const builder = mount();

    CHEMISTRY_TEMPLATES.forEach((template) => {
      expect(builder.load(template.code)).toBe(true);
      expect(chemfigToSvg(builder.getCode()), template.code).toBe(chemfigToSvg(template.code));
    });

    builder.load('CH_3');
    click(button(builder, 'button[data-code="**6(---(-OH)---)"]'));
    expect(builder.getCode()).toBe('**6(---(-OH)---)');

    click(button(builder, 'button[data-action="undo"]'));
    expect(builder.getCode()).toBe('CH_3');

    click(button(builder, 'button[data-action="clear"]'));
    expect(builder.getCode()).toBe('');
    click(button(builder, 'button[data-action="undo"]'));
    expect(builder.getCode()).toBe('CH_3');
  });

  it('ни одно нажатие по полотну и панели не даёт неразборчивого кода', () => {
    const builder = mount();
    const actions = [
      () => click(builder.element.querySelector('[data-action="start"]') ?? builder.element.querySelector('[data-atom="0"]')),
      () => clickPlus(builder, plusAngles(builder)[0] ?? -1),
      () => chooseGroup(builder, 'COOH'),
      () => clickPlus(builder, plusAngles(builder).at(-1) ?? -1),
      () => click(builder.element.querySelector('[data-atom="1"]')),
      () => click(button(builder, 'button[data-bond="~"]')),
      () => clickPlus(builder, plusAngles(builder)[1] ?? -1),
      () => click(builder.element.querySelector('[data-bond="0"]')),
      () => click(button(builder, 'button[data-set-bond="="]')),
    ];

    actions.forEach((action) => {
      try {
        action();
      } catch {
        // Нажатия на то, чего сейчас нет на полотне, пропускаем.
      }

      const code = builder.getCode();

      if (code) expect(() => parseChemfig(code), code).not.toThrow();
    });

    expect(atomCount(builder.getCode())).toBeGreaterThanOrEqual(3);
  });
});
