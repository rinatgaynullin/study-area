import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHEMISTRY_MESSAGES } from '../src/messages';
import { CHEMISTRY_TEMPLATES } from '../src/templates';

// От корня монорепы: под jsdom `import.meta.url` — не file-адрес.
const SOURCE_ROOT = resolve(process.cwd(), 'packages/editor-chemistry/src');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    // Сама таблица переводов — не «использование».
    if (/[/\\]messages\.ts$/.test(path)) return [];

    return /\.ts$/.test(path) ? [path] : [];
  });

describe('таблицы переводов возможности', () => {
  const source = sourceFiles(SOURCE_ROOT)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('русская таблица не содержит ключей, которых код не читает', () => {
    const isUsed = (key: string): boolean =>
      source.includes(`'${key}'`) || source.includes(`"${key}"`);

    expect(Object.keys(CHEMISTRY_MESSAGES.ru).filter((key) => !isUsed(key))).toEqual([]);
  });

  it('английская таблица повторяет набор ключей русской', () => {
    expect(Object.keys(CHEMISTRY_MESSAGES.en).sort()).toEqual(Object.keys(CHEMISTRY_MESSAGES.ru).sort());
  });

  it('у каждого шаблона есть подпись', () => {
    CHEMISTRY_TEMPLATES.forEach((template) => {
      expect(CHEMISTRY_MESSAGES.ru[template.labelKey]).toBeTruthy();
    });
  });
});
