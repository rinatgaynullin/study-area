import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ru } from '../src/i18n/ru';

/**
 * Ключи, которые код собирает из префикса и переменной, а не пишет буквально:
 * действия над таблицей и выравнивание.
 */
const DYNAMIC_PREFIXES = ['table_', 'toolbar_align_'];

const SOURCE_ROOTS = ['../src', '../../editor-vue/src'].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    // Сами таблицы переводов — не «использование».
    if (/[/\\]i18n[/\\](ru|en)\.ts$/.test(path)) return [];
    return /\.(ts|vue)$/.test(path) ? [path] : [];
  });
}

describe('таблица переводов', () => {
  it('не содержит ключей, которых код не читает', () => {
    const source = SOURCE_ROOTS.flatMap(sourceFiles)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    const isUsed = (key: string): boolean =>
      source.includes(`'${key}'`) ||
      source.includes(`"${key}"`) ||
      DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix) && source.includes(prefix));

    // Мёртвый ключ — это либо хвост рефакторинга, либо обещание фичи, которой
    // нет; и то и другое лучше видеть в тесте, чем в чужом переводе.
    expect(Object.keys(ru).filter((key) => !isUsed(key))).toEqual([]);
  });
});
