import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAWINGS_MESSAGES } from '../src/messages';
import { DRAWING_TEMPLATES } from '../src/templates';

// От корня монорепы: под jsdom `import.meta.url` — не file-адрес.
const SOURCE_ROOT = resolve(process.cwd(), 'packages/editor-drawings/src');

/** Ключи, которые код собирает из префикса и переменной. */
const DYNAMIC_PREFIXES = [
  'drawings_title_',
  'drawings_insert_',
  'drawings_aria_',
  'drawings_scene_',
  'drawings_hint_',
  'drawings_selected_',
  'drawings_position_',
  'drawings_angle_',
  'drawings_style_',
  'drawings_tab_',
  'drawings_tool_',
  'drawings_prop_',
  'drawings_template_',
];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    if (/[/\\]messages\.ts$/.test(path)) return [];

    return /\.ts$/.test(path) ? [path] : [];
  });

describe('таблицы переводов возможности', () => {
  const source = sourceFiles(SOURCE_ROOT)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('русская таблица не содержит ключей, которых код не читает', () => {
    const isUsed = (key: string): boolean =>
      source.includes(`'${key}'`)
      || source.includes(`"${key}"`)
      || DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix) && source.includes(prefix));

    expect(Object.keys(DRAWINGS_MESSAGES.ru).filter((key) => !isUsed(key))).toEqual([]);
  });

  it('английская таблица повторяет набор ключей русской', () => {
    expect(Object.keys(DRAWINGS_MESSAGES.en).sort()).toEqual(Object.keys(DRAWINGS_MESSAGES.ru).sort());
  });

  it('у каждого шаблона есть подпись', () => {
    DRAWING_TEMPLATES.forEach((template) => {
      expect(DRAWINGS_MESSAGES.ru[template.labelKey]).toBeTruthy();
    });
  });
});
