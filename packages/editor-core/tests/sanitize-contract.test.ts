import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_URI_SCHEMES,
  HTML_ATTRS,
  HTML_TAGS,
  MATHML_ATTRS,
  MATHML_TAGS,
} from '../src/security/sanitize';

/**
 * Серверный санитайзер в django-rich-editor повторяет allowlist редактора на
 * Python. Копия неизбежна — общего рантайма нет, — но расхождение между ними
 * означает либо дыру на сервере, либо документ, который сервер портит.
 * Тест читает python-файл и сверяет списки с исходником.
 */
// От корня монорепы: под jsdom `import.meta.url` — не file-адрес.
const PYTHON_SANITIZER = resolve(process.cwd(), 'packages/django-rich-editor/rich_editor/sanitize.py');

/** Строковые литералы из python-списка `NAME = [...]`; внутри строк `]` нет. */
function pythonList(source: string, name: string): string[] {
  const match = new RegExp(`^${name} = \\[([^\\]]*)\\]`, 'm').exec(source);
  if (!match) throw new Error(`В sanitize.py нет списка ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

describe('контракт санитайзера', () => {
  const source = readFileSync(PYTHON_SANITIZER, 'utf8');

  it.each([
    ['HTML_TAGS', HTML_TAGS],
    ['HTML_ATTRS', HTML_ATTRS],
    ['MATHML_TAGS', MATHML_TAGS],
    ['MATHML_ATTRS', MATHML_ATTRS],
    ['ALLOWED_URI_SCHEMES', ALLOWED_URI_SCHEMES],
  ])('python-копия %s совпадает с исходником', (name, expected) => {
    expect(new Set(pythonList(source, name))).toEqual(new Set(expected));
  });
});
