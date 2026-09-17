import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Токены — единственный интерфейс кастомизации (THEMING.md). Тест держит
 * правило тремя проверками: в правилах интерфейса нет литералов того, что
 * отличает один UI-кит от другого (цвет, шрифт, радиус, тень); каждый токен
 * объявлен и используется; документ описывает ровно объявленные токены.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const STYLES = read('../src/styles.css');
const LEGACY = read('../src/legacy.css');
const THEMING = read('../../../THEMING.md');

/** Блок объявлений: от общего селектора до первой закрывающей скобки. */
const TOKEN_BLOCK = (() => {
  const start = STYLES.indexOf('.rte-root,\n.rte-content-root {');
  expect(start).toBeGreaterThan(-1);
  return STYLES.slice(start, STYLES.indexOf('}', start));
})();

/** Правила интерфейса — всё после блока объявлений. */
const CHROME = STYLES.slice(STYLES.indexOf('}', STYLES.indexOf('.rte-root,\n.rte-content-root {')));

const declared = new Set([...TOKEN_BLOCK.matchAll(/^\s*(--rte-[a-z0-9-]+):/gm)].map((m) => m[1]));
const legacyDeclared = new Set(
  [...LEGACY.matchAll(/^\s*(--rte-legacy-[a-z0-9-]+):/gm)].map((m) => m[1]),
);

/** Значение, которое рекордер ставит из JS, — не токен темы. */
const RUNTIME = new Set(['--rte-level']);

function usedIn(css: string): Set<string> {
  return new Set([...css.matchAll(/var\((--rte-[a-z0-9-]+)/g)].map((m) => m[1]));
}

describe('токены темы', () => {
  it('каждая переменная, которую читают стили, объявлена', () => {
    const used = new Set([...usedIn(STYLES), ...usedIn(LEGACY)]);
    const unknown = [...used].filter(
      (name) => !declared.has(name) && !legacyDeclared.has(name) && !RUNTIME.has(name),
    );
    expect(unknown).toEqual([]);
  });

  it('каждый объявленный токен где-то используется', () => {
    // Ссылка из другого токена — тоже использование: `--rte-color-primary-soft`
    // существует ради того, чтобы тема меняла его один раз, а выделение,
    // подсветка формулы и активная кнопка следовали за ним.
    const used = new Set([...usedIn(STYLES), ...usedIn(LEGACY)]);
    const dead = [...declared].filter((name) => !used.has(name));
    expect(dead).toEqual([]);
  });

  it('интерфейс не содержит цветовых литералов', () => {
    const colours = CHROME.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [];
    expect(colours, 'цвет должен приходить из токена').toEqual([]);
  });

  it('интерфейс берёт шрифт, радиус и тень из токенов', () => {
    // Lookbehind отсекает объявления токенов вроде `--rte-font-size: 16px` в
    // мобильном блоке: это значение токена, а не литерал в правиле.
    const literal = (property: string): string[] =>
      [...CHROME.matchAll(new RegExp(`(?<![-\\w])${property}:\\s*([^;]+);`, 'g'))]
        .map((m) => m[1].trim())
        // Проценты, em и none — не «размер из дизайн-системы».
        .filter((value) => !value.startsWith('var(') && !/^(none|inherit|0|50%|[\d.]+em)$/.test(value));

    expect(literal('font-size'), 'кегль').toEqual([]);
    expect(literal('font-family'), 'гарнитура').toEqual([]);
    expect(literal('border-radius'), 'радиус').toEqual([]);
    expect(
      literal('box-shadow').filter((value) => !value.startsWith('0 0 0 2px var(')),
      'тень',
    ).toEqual([]);
  });

  it('THEMING.md описывает ровно объявленные токены', () => {
    const documented = new Set([...THEMING.matchAll(/^\| `(--rte-[a-z0-9-]+)`/gm)].map((m) => m[1]));
    expect([...declared].filter((name) => !documented.has(name)), 'не описаны').toEqual([]);
    expect([...documented].filter((name) => !declared.has(name)), 'описаны, но не объявлены').toEqual([]);
  });
});
