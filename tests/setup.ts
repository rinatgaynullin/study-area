/**
 * jsdom lacks the browser APIs the editor touches. These stubs are inert
 * defaults; tests that assert on behaviour install their own spies.
 */
import { vi } from 'vitest';

if (typeof URL.createObjectURL === 'undefined') {
  let counter = 0;

  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: () => {
      counter += 1;

      return `blob:http://localhost/${counter}`;
    },
  });

  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: () => undefined });
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  // Класс, а не фабрика: код редактора зовёт `new ResizeObserver(...)`, а
  // `vi.fn(() => ({...}))` под `new` в Vitest 4 бросает «is not a constructor».
  globalThis.ResizeObserver = class {
    observe = vi.fn();

    unobserve = vi.fn();

    disconnect = vi.fn();
  } as unknown as typeof ResizeObserver;
}

// ProseMirror probes hit-testing during focus handling; jsdom has no layout.
if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(Document.prototype, 'elementFromPoint', {
    writable: true,
    value: () => null,
  });
}

// jsdom implements neither playback nor metadata loading.
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  writable: true,
  value: () => Promise.resolve(),
});

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  writable: true,
  value: () => undefined,
});
