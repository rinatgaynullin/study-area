import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATHLIVE_STRINGS, mathliveRu } from '../src/i18n/mathlive';

/**
 * MathLive ships translations for de/en/es/fr/it/ja/pl only, so its menu stays
 * English under `locale="ru"` unless we merge our own table in. These tests
 * pin that table against MathLive's own keys: a key we misspell is a silently
 * untranslated menu item, and a key upstream renames is the same bug later.
 */
function readMathliveEnglishKeys(): Set<string> {
  // Under Node, `mathlive` resolves to a minified build that does not even
  // export MathfieldElement, so the string table is read from the unminified
  // ESM bundle next to it. A layout change fails loudly here, by design.
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('mathlive'));
  const bundle = readFileSync(join(root, 'mathlive.mjs'), 'utf8');

  const start = bundle.indexOf('var STRINGS = {');
  const english = bundle.indexOf('"en": {', start);
  const end = bundle.indexOf('\n  },', english);
  expect(start, 'MathLive should still ship a STRINGS table').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(english);

  const keys = bundle.slice(english, end).matchAll(/^ {4}"([^"]+)":/gm);
  return new Set([...keys].map((match) => match[1]));
}

describe('Russian strings for MathLive', () => {
  const upstream = readMathliveEnglishKeys();

  it('reads a non-trivial key set from MathLive', () => {
    expect(upstream.size).toBeGreaterThan(50);
  });

  it('uses only keys MathLive actually looks up', () => {
    const unknown = Object.keys(mathliveRu).filter((key) => !upstream.has(key));
    expect(unknown, 'these keys would never be rendered').toEqual([]);
  });

  it('translates everything except the LaTeX templates', () => {
    // `*-template` values are LaTeX fragments, not prose — MathLive keeps its own.
    const untranslated = [...upstream].filter(
      (key) => !(key in mathliveRu) && !key.endsWith('-template'),
    );
    expect(untranslated).toEqual([]);
  });

  it('leaves no English behind and keeps placeholders intact', () => {
    for (const [key, value] of Object.entries(mathliveRu)) {
      expect(value.trim(), `${key} should not be empty`).not.toBe('');
      // `%@` is MathLive's substitution marker; dropping it loses the value.
      if (key === 'menu.solve-for' || key === 'tooltip.row-by-col') {
        expect(value, `${key} should keep its placeholder`).toContain('%@');
      }
    }
  });

  it('is exposed under the language code MathLive falls back to', () => {
    // `localize()` tries the full locale, then its first two letters, then en —
    // so a "ru" key serves ru, ru-RU and any other Russian region.
    expect(Object.keys(MATHLIVE_STRINGS)).toEqual(['ru']);
    expect(MATHLIVE_STRINGS.ru).toBe(mathliveRu);
  });
});
