import { createDisposer, el, on } from '../dom';
import { normalizeHref } from '../normalize-href';
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
interface LinkDialogResult {
  href: string;
  targetBlank: boolean;
}

interface LinkDialogOptions {
  onApply(result: LinkDialogResult): void;
  onRemove(): void;
}

/** Диалог создания и правки ссылки. */
export const createLinkDialog = (
  context: EditorUiContext,
  options: LinkDialogOptions,
): DialogComponent<LinkDialogPayload> => {
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

  const errorText = el('p', { class: 'rte-field__error', attrs: { role: 'alert' } });

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
  const setError = (message: string): void => {
    errorText.textContent = message;
    errorText.hidden = !message;
    hrefInput.setAttribute('aria-invalid', String(Boolean(message)));
  };

  const apply = (): void => {
    const normalized = normalizeHref(hrefInput.value);

    if (!normalized) {
      setError(t('link_invalid'));

      return;
    }

    options.onApply({ href: normalized, targetBlank: targetBlankInput.checked });
    modal.close();
  };

  const remove = (): void => {
    options.onRemove();
    modal.close();
  };

  const open = (payload: LinkDialogPayload): void => {
    hrefInput.value = payload.href;
    targetBlankInput.checked = payload.targetBlank;
    removeButton.hidden = !payload.canRemove;
    setError('');
    modal.open();
  };

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
};
