import { describe, expect, it } from 'vitest';
import { normalizeHref } from '../src/ui/normalize-href';

describe('normalizeHref', () => {
  it('достраивает адрес без схемы до https', () => {
    expect(normalizeHref('example.com/path')).toBe('https://example.com/path');
    expect(normalizeHref('  example.com  ')).toBe('https://example.com');
  });

  it('пропускает только навигационные схемы', () => {
    expect(normalizeHref('http://a')).toBe('http://a');
    expect(normalizeHref('MAILTO:x@y')).toBe('MAILTO:x@y');
    expect(normalizeHref('tel:+7')).toBe('tel:+7');
    // eslint-disable-next-line no-script-url -- проверяем опасную схему намеренно
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('data:text/html,hi')).toBeNull();
  });

  it('отвергает пустой адрес', () => {
    expect(normalizeHref('')).toBeNull();
    expect(normalizeHref('   ')).toBeNull();
  });
});
