# 8. Темизация

## Назначение

Все цвета, шрифты, радиусы, тени и размеры контролов читаются из CSS-переменных
`--rte-*`, объявленных на `.rte-root` (редактор) и `.rte-content-root` (вьюер).
Перекраска под дизайн-систему — переопределение переменных, не правка
стилей. Тёмная тема встроена: те же токены под классом `rte-theme-dark`.
Полный список токенов с умолчаниями и назначением — `THEMING.md` в корне
репозитория; здесь он не дублируется.

## Когда использовать

- Нужно подогнать редактор под дизайн-систему хоста — переопределите токены.
- Нужна тёмная тема — опция `theme` или класс на предке.
- Нужно оформить то, до чего токены не дотягиваются — стабильные классы-хуки.

## Интерфейс

| Член | Тип | Что делает |
| --- | --- | --- |
| `theme` (опция/проп) | `'light'`, `'dark'`, `'auto'` | Тема редактора или вьюера; `'auto'` следует за `prefers-color-scheme` |
| `setTheme(theme)`, `update({ theme })` | — | Смена темы у живого редактора / вьюера |
| `DARK_THEME_CLASS` | `'rte-theme-dark'` | Класс тёмной темы: на элементе редактора или любом предке, вплоть до `<html>` |
| `applyTheme(element, theme)` | `() => void` | Ставит класс (или следит за системной темой при `'auto'`); возвращает функцию снятия слежения |

Токены переопределяются глобально или для экземпляра (переменные каскадируют):

| Группа токенов | Префиксы |
| --- | --- |
| Палитра | `--rte-color-*` |
| Типографика | `--rte-font-*`, `--rte-ui-font-*`, `--rte-title-*` |
| Форма и слои | `--rte-radius*`, `--rte-shadow*`, `--rte-focus-ring`, `--rte-z-modal` |
| Тулбар и контролы | `--rte-toolbar-*`, `--rte-btn-*`, `--rte-input-*`, `--rte-button-*` |
| Диалоги и меню | `--rte-modal-*`, `--rte-popover-padding`, `--rte-menu-*` |
| Контент и медиа | `--rte-content-padding`, `--rte-block-gap`, `--rte-formula-padding`, `--rte-audio-*` |
| Legacy (Froala) | `--rte-legacy-*` в `legacy.css`; выводятся из базовых токенов |

Классы-хуки, которые считаются стабильными: `.rte-root`, `.rte-content-root`,
`.rte-toolbar`, `.rte-toolbar__group`, `.rte-btn`, `.rte-btn--active`,
`.rte-dropdown__panel`, `.rte-menu__item`, `.rte-modal__panel`, `.rte-content`,
`.rte-formula`, `.rte-audio`, `.rte-attachment`, `.rte-legacy`,
`.rte-legacy-embed`, `.rte-status`, `.rte-popover`.

Системные режимы учтены в `styles.css`: до 640 px крупнее кнопки и текст,
`prefers-reduced-motion` отключает переходы, `forced-colors` даёт активным
состояниям `outline`.

## Пример

```css
/* подключить после styles.css; оба селектора — чтобы вьюер совпадал с редактором */
.rte-root,
.rte-content-root {
  --rte-color-primary: #396fdb;
  --rte-color-primary-soft: #e8f0ff;
  --rte-font-family: Inter, system-ui, sans-serif;
  --rte-radius: 6px;
}

.compact .rte-root {
  --rte-btn-size: 30px;
  --rte-content-padding: 8px 10px;
}
```

```ts
createRichEditor({ element, theme: 'auto' });
document.documentElement.classList.add('rte-theme-dark'); // или так, вместе с темой хоста
```

## Ограничения

- Размер формулы не зависит от `--rte-font-size`: он запечён в пикселях при
  рендере; масштабируйте опцией `formulaScale`.
- Внутренние отступы контролов и размеры образцов — литералы, не токены.
- Тёмный блок меняет только палитру и тени; `--rte-color-on-highlight`
  остаётся тёмным, потому что образцы выделения светлые в обеих темах.

## См. также

- `THEMING.md` — каждая переменная, умолчание, что контролирует.
- [06-viewer.md](06-viewer.md), [10-standalone-and-django.md](10-standalone-and-django.md)
  (тема виджета следует за переключателем админки).
