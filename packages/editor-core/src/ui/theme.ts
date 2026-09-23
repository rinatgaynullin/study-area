/** Тема интерфейса: светлая, тёмная или как в системе. */
export type EditorTheme = 'light' | 'dark' | 'auto';

/**
 * Класс тёмной темы. Ставится на элемент редактора или вьюера — или на любого
 * предка, вплоть до <html> рядом с темой хоста: стили срабатывают от обоих.
 */
export const DARK_THEME_CLASS = 'rte-theme-dark';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/**
 * Применяет тему к элементу и возвращает функцию, снимающую слежение.
 *
 * `auto` следует за системной настройкой и переключается вместе с ней; там,
 * где `matchMedia` нет (SSR, старый jsdom), `auto` означает светлую тему.
 */
export const applyTheme = (element: HTMLElement, theme: EditorTheme): (() => void) => {
  if (theme !== 'auto') {
    element.classList.toggle(DARK_THEME_CLASS, theme === 'dark');

    return () => {};
  }

  if (typeof matchMedia !== 'function') {
    element.classList.remove(DARK_THEME_CLASS);

    return () => {};
  }

  const query = matchMedia(DARK_SCHEME_QUERY);

  const sync = (): void => {
    element.classList.toggle(DARK_THEME_CLASS, query.matches);
  };

  sync();
  query.addEventListener('change', sync);

  return () => query.removeEventListener('change', sync);
};
