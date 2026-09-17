import { describe, expect, it } from 'vitest';
import { ariaKeyshortcuts, formatShortcut } from '../src/ui/shortcuts';

describe('сочетания клавиш в подсказках', () => {
  it('пишет Ctrl+… везде, кроме Mac', () => {
    expect(formatShortcut('Mod-B', false)).toBe('Ctrl+B');
    expect(formatShortcut('Mod-Shift-S', false)).toBe('Ctrl+Shift+S');
    expect(formatShortcut('Mod-Alt-C', false)).toBe('Ctrl+Alt+C');
    expect(formatShortcut('Mod-,', false)).toBe('Ctrl+,');
  });

  it('на Mac собирает символы без разделителей', () => {
    expect(formatShortcut('Mod-B', true)).toBe('⌘B');
    expect(formatShortcut('Mod-Shift-Z', true)).toBe('⌘⇧Z');
    expect(formatShortcut('Mod-Alt-C', true)).toBe('⌘⌥C');
  });

  it('для aria-keyshortcuts называет модификаторы полностью', () => {
    expect(ariaKeyshortcuts('Mod-B', false)).toBe('Control+B');
    expect(ariaKeyshortcuts('Mod-Shift-Z', true)).toBe('Meta+Shift+Z');
  });
});
