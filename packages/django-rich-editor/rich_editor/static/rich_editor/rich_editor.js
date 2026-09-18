/**
 * Связка виджета Django с редактором.
 *
 * Виджет рендерит обычный `<textarea data-rich-editor="{...}">`. Скрипт
 * ставит рядом редактор, прячет поле и пишет HTML обратно в него на каждое
 * изменение — форма отправляется как всегда, хосту ничего не нужно делать.
 * Инлайны админки, добавленные кнопкой «ещё», подхватываются по событию
 * `formset:added`; переключатель темы админки — по атрибуту `data-theme`.
 */
import { createRichEditor } from './editor.js';

/** Смонтированные редакторы по их textarea: чтобы не ставить второй раз. */
const mounted = new Map();

function readCookie(name) {
  const prefix = `${name}=`;
  const part = document.cookie.split('; ').find((item) => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : '';
}

/**
 * Адаптер загрузки под вьюхи пакета. Понимает и ответ старых вьюх Froala
 * (`link` вместо `url`), чтобы хост мог оставить их на месте.
 */
function uploadAdapter(url, cookieName) {
  return async (file) => {
    const body = new FormData();
    body.append('file', file, file.name);
    const response = await fetch(url, {
      method: 'POST',
      body,
      credentials: 'same-origin',
      headers: { 'X-CSRFToken': readCookie(cookieName) },
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      // Сервер ответил не JSON — ниже это станет ошибкой по статусу.
    }
    const link = data.url ?? data.link;
    if (!response.ok || !link) {
      throw new Error(data.error || `${response.status} ${response.statusText}`);
    }
    return {
      url: link,
      name: data.name ?? file.name,
      size: data.size ?? file.size,
      mime: data.mime ?? file.type,
    };
  };
}

/**
 * Тема: явная из конфига; иначе — переключатель админки Django
 * (`<html data-theme>`); иначе — системная.
 */
function resolveTheme(config) {
  if (config.theme && config.theme !== 'auto') return config.theme;
  const admin = document.documentElement.dataset.theme;
  return admin === 'dark' || admin === 'light' ? admin : 'auto';
}

export function mount(textarea) {
  const existing = mounted.get(textarea);
  if (existing) return existing.editor;
  // Шаблон пустой формы инлайна: настоящее поле появится после клонирования.
  if (textarea.name.includes('__prefix__')) return null;

  const config = JSON.parse(textarea.dataset.richEditor || '{}');
  const uploads = config.uploads ?? {};
  const adapter = (kind) =>
    uploads[kind] ? uploadAdapter(uploads[kind], config.csrfCookie || 'csrftoken') : undefined;

  const host = document.createElement('div');
  host.className = 'rich-editor__host';
  textarea.insertAdjacentElement('afterend', host);
  textarea.hidden = true;

  const editor = createRichEditor({
    element: host,
    content: textarea.value,
    editable: !textarea.disabled && !textarea.readOnly,
    locale: config.locale,
    toolbar: config.toolbar,
    legacy: Boolean(config.legacy),
    theme: resolveTheme(config),
    minHeight: config.minHeight,
    placeholder: config.placeholder ?? undefined,
    ariaLabel: config.ariaLabel ?? undefined,
    limits: config.limits && Object.keys(config.limits).length > 0 ? config.limits : undefined,
    uploadImage: adapter('image'),
    uploadAudio: adapter('audio'),
    uploadFile: adapter('file'),
    onChange: (html) => {
      textarea.value = html;
      // Хост и админка узнают о правке так же, как от обычного поля.
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    },
  });

  mounted.set(textarea, { editor, config, host });
  return editor;
}

export function unmount(textarea) {
  const entry = mounted.get(textarea);
  if (!entry) return;
  entry.editor.destroy();
  entry.host.remove();
  textarea.hidden = false;
  mounted.delete(textarea);
}

export function mountAll(root = document) {
  for (const textarea of root.querySelectorAll('textarea[data-rich-editor]')) mount(textarea);
}

// Инлайн админки добавили кнопкой: событие приходит с новой строки.
document.addEventListener('formset:added', (event) => {
  if (event.target instanceof Element) mountAll(event.target);
});

// Переключатель темы админки меняет data-theme на <html>.
new MutationObserver(() => {
  for (const { editor, config } of mounted.values()) editor.setTheme(resolveTheme(config));
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => mountAll());
} else {
  mountAll();
}

// Для inline-скриптов шаблонов, которым модульный import недоступен.
window.richEditor = { mount, unmount, mountAll, mounted };
