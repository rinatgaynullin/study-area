import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Compat-слой обязан резолвить оформление через те же токены `--rte-*`, что и
 * остальной редактор: правка одной переменной должна менять и новый контент, и
 * старый. Тест ловит возврат к захардкоженным значениям — без него правило
 * держится только на договорённости.
 */
const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/legacy.css'),
  'utf8',
);

/** Блок объявления переменных: литералы там допустимы и прокомментированы. */
const DECLARATIONS_END = CSS.indexOf('Снятие конфликтов');
const RULES = CSS.slice(DECLARATIONS_END);

/**
 * Значения, которые не являются оформлением: толщина волосяной границы и
 * стандартный приём «скрыть визуально». Тот же паттерн у базовых стилей.
 */
const NON_DESIGN_LITERALS = /^-?1px$/;

describe('compat-стили держатся на токенах', () => {
  it('не содержат цветовых литералов вне var()-фолбэков', () => {
    // Убираем фолбэки вида var(--x, #fff): они и есть «значение по умолчанию».
    const withoutFallbacks = RULES.replace(/var\([^)]*\)/g, 'var()');
    const colours = withoutFallbacks.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? [];

    expect(colours, 'цвет должен приходить из токена').toEqual([]);
  });

  it('не содержат размерных литералов вне var()-фолбэков', () => {
    const withoutFallbacks = RULES.replace(/var\([^)]*\)/g, 'var()');
    const sizes = (withoutFallbacks.match(/\b-?\d+(\.\d+)?px\b/g) ?? []).filter(
      (size) => !NON_DESIGN_LITERALS.test(size),
    );

    expect(sizes, 'размер должен приходить из токена').toEqual([]);
  });

  it('объявляет каждую --rte-legacy-* переменную до использования', () => {
    const declared = new Set(
      [...CSS.matchAll(/^\s*(--rte-legacy-[a-z-]+):/gm)].map((match) => match[1]),
    );
    const used = new Set(
      [...RULES.matchAll(/var\((--rte-legacy-[a-z-]+)/g)].map((match) => match[1]),
    );

    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('связывает legacy-переменные с базовыми токенами, кроме помеченных литералов', () => {
    const declarations = [...CSS.matchAll(/^\s*(--rte-legacy-[a-z-]+):\s*([^;]+);/gm)];
    expect(declarations.length).toBeGreaterThan(5);

    // Литералы допустимы только там, где у сущности Froala нет аналога в новом
    // визуальном языке; каждый такой случай прокомментирован в файле.
    const LITERALS_WITHOUT_ANALOGUE = new Set([
      '--rte-legacy-image-gap',
      '--rte-legacy-image-border-width',
      '--rte-legacy-table-thick-width',
      '--rte-legacy-marker-bg',
      '--rte-legacy-transparency-opacity',
      '--rte-legacy-text-spacing',
    ]);

    const unlinked = declarations
      .filter(([, name]) => !LITERALS_WITHOUT_ANALOGUE.has(name))
      .filter(([, , value]) => !value.includes('var(--rte-'));

    expect(unlinked.map(([, name]) => name)).toEqual([]);
  });

  it('заскоуплен так, что работает и во вьюере, и в редакторе', () => {
    // Оба пути кладут .rte-content на элемент с контентом, поэтому один скоуп
    // покрывает обе ветки.
    const rules = RULES.match(/^\.[^{]+\{/gm) ?? [];
    const unscoped = rules.filter((rule) => !rule.includes('.rte-content.rte-legacy'));

    expect(unscoped).toEqual([]);
  });
});
