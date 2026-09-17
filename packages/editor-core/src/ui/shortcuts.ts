/**
 * Сочетания клавиш в записи TipTap («Mod-Shift-S»): подсказка для человека и
 * значение `aria-keyshortcuts` для читалки.
 */

function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform ?? '');
}

function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

/** «Mod-B» → «⌘B» на Mac и «Ctrl+B» везде ещё. */
export function formatShortcut(shortcut: string, mac: boolean = isMacLike()): string {
  const parts = shortcut.split('-');
  const key = keyLabel(parts.pop() ?? '');
  const symbols: Record<string, string> = mac
    ? { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' }
    : { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const modifiers = parts.map((part) => symbols[part.toLowerCase()] ?? part);
  return mac ? [...modifiers, key].join('') : [...modifiers, key].join('+');
}

/** «Mod-B» → «Meta+B» на Mac и «Control+B» везде ещё — формат aria-keyshortcuts. */
export function ariaKeyshortcuts(shortcut: string, mac: boolean = isMacLike()): string {
  const parts = shortcut.split('-');
  const key = keyLabel(parts.pop() ?? '');
  const names: Record<string, string> = {
    mod: mac ? 'Meta' : 'Control',
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
  };
  return [...parts.map((part) => names[part.toLowerCase()] ?? part), key].join('+');
}
