import { createDisposer, el, on } from '../dom';
import { createModal } from '../modal';
import type { DialogComponent, EditorUiContext } from '../types';

/** Состояние ссылки под кареткой, с которым открывают диалог. */
export interface LinkDialogPayload {
  href: string;
  targetBlank: boolean;
  /** Есть ли что удалять: кнопка удаления показывается только тогда. */
  canRemove: boolean;
}

/** Что пользователь подтвердил кнопкой применения. */
export interface LinkDialogResult {
  href: string;
  targetBlank: boolean;
}

export interface LinkDialogOptions {
  onApply(result: LinkDialogResult): void;
  onRemove(): void;
}

/** Схемы, по которым браузер действительно куда-то переходит. */
const NAVIGABLE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

const REGEX_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Повторяет санитайзер: принимаются только адреса с навигационной схемой.
 *
 * Адрес без схемы считаем сокращённой записью и достраиваем до https, а всё
 * остальное (javascript:, data: и прочее) отбрасываем — иначе диалог пустил бы
 * в документ то, что санитайзер всё равно вырежет.
 *
 * @returns Нормализованный адрес или `null`, если адрес использовать нельзя.
 */
function normalizeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const scheme = REGEX_SCHEME.exec(trimmed)?.[1].toLowerCase();
  if (!scheme) return `https://${trimmed}`;
  return NAVIGABLE_SCHEMES.includes(scheme) ? trimmed : null;
}

/** Диалог создания и правки ссылки. */
export function createLinkDialog(
  context: EditorUiContext,
  options: LinkDialogOptions,
): DialogComponent<LinkDialogPayload> {
  const { t } = context;
  const disposer = createDisposer();

  const hrefInput = el('input', {
    class: 'rte-input',
    attrs: {
      type: 'url',
      inputmode: 'url',
      placeholder: t('link_url_placeholder'),
      'data-autofocus': true,
    },
  });

  const hrefField = el('label', {
    class: 'rte-field',
    children: [el('span', { class: 'rte-field__label', text: t('link_url') }), hrefInput],
  });

  const errorText = el('p', { class: 'rte-field__error' });
  errorText.hidden = true;

  const targetBlankInput = el('input', { attrs: { type: 'checkbox' } });
  const targetBlankField = el('label', {
    class: 'rte-checkbox',
    children: [targetBlankInput, el('span', { text: t('link_open_in_new_tab') })],
  });

  const removeButton = el('button', {
    class: 'rte-button rte-button--danger',
    text: t('link_remove'),
    attrs: { type: 'button' },
  });

  const cancelButton = el('button', {
    class: 'rte-button',
    text: t('common_cancel'),
    attrs: { type: 'button' },
  });

  const applyButton = el('button', {
    class: 'rte-button rte-button--primary',
    text: t('link_apply'),
    attrs: { type: 'button' },
  });

  const modal = createModal({ title: t('link_title'), closeLabel: t('common_close') });
  modal.body.append(hrefField, errorText, targetBlankField);
  modal.footer.append(
    removeButton,
    el('span', { class: 'rte-modal__spacer' }),
    cancelButton,
    applyButton,
  );

  /** Пустое сообщение прячет абзац целиком — как `v-if` в шаблоне. */
  function setError(message: string): void {
    errorText.textContent = message;
    errorText.hidden = !message;
  }

  function apply(): void {
    const normalized = normalizeHref(hrefInput.value);
    if (!normalized) {
      setError(t('link_invalid'));
      return;
    }

    options.onApply({ href: normalized, targetBlank: targetBlankInput.checked });
    modal.close();
  }

  function remove(): void {
    options.onRemove();
    modal.close();
  }

  function open(payload: LinkDialogPayload): void {
    hrefInput.value = payload.href;
    targetBlankInput.checked = payload.targetBlank;
    removeButton.hidden = !payload.canRemove;
    setError('');
    modal.open();
  }

  disposer.add(
    on(hrefInput, 'keydown', (event) => {
      if (event.key !== 'Enter') return;
      // Иначе Enter в поле отправил бы форму, в которую вставлен редактор.
      event.preventDefault();
      apply();
    }),
  );
  disposer.add(on(applyButton, 'click', apply));
  disposer.add(on(removeButton, 'click', remove));
  disposer.add(on(cancelButton, 'click', () => modal.close()));

  return {
    element: modal.element,
    open,
    close: () => modal.close(),
    get isVisible() {
      return modal.isVisible;
    },
    destroy: () => {
      disposer.dispose();
      modal.destroy();
    },
  };
}
