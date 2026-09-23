import { afterEach, describe, expect, it, vi } from 'vitest';
import { DARK_THEME_CLASS, applyTheme } from '../src';

/** Подставной matchMedia: jsdom его не даёт, а `auto` без него — светлая тема. */
const stubMatchMedia = (matches: boolean) => {
  const listeners = new Set<() => void>();

  const query = {
    matches,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    /** Системная тема сменилась. */
    flip: () => {
      query.matches = !query.matches;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };

  vi.stubGlobal('matchMedia', () => query);

  return query;
};

afterEach(() => vi.unstubAllGlobals());

describe('applyTheme', () => {
  it('ставит и снимает класс тёмной темы', () => {
    const element = document.createElement('div');

    applyTheme(element, 'dark');
    expect(element.classList.contains(DARK_THEME_CLASS)).toBe(true);

    applyTheme(element, 'light');
    expect(element.classList.contains(DARK_THEME_CLASS)).toBe(false);
  });

  it('auto следует за системной настройкой и перестаёт после отписки', () => {
    const query = stubMatchMedia(true);
    const element = document.createElement('div');

    const release = applyTheme(element, 'auto');

    expect(element.classList.contains(DARK_THEME_CLASS)).toBe(true);

    query.flip();
    expect(element.classList.contains(DARK_THEME_CLASS)).toBe(false);

    release();
    expect(query.listeners.size).toBe(0);
    query.flip();
    expect(element.classList.contains(DARK_THEME_CLASS)).toBe(false);
  });

  it('auto без matchMedia — светлая тема', () => {
    vi.stubGlobal('matchMedia', undefined);

    const element = document.createElement('div');

    element.classList.add(DARK_THEME_CLASS);

    applyTheme(element, 'auto');
    expect(element.classList.contains(DARK_THEME_CLASS)).toBe(false);
  });
});
