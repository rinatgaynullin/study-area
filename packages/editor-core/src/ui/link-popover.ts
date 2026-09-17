import type { Editor } from '@tiptap/core';
import { createDisposer, el, icon, on } from './dom';
import { DEFAULT_LINK_STYLES, type LinkStyle } from './link-styles';
import { createPopover } from './popover';
import type { EditorUiContext, UiComponent } from './types';

export interface LinkPopoverOptions {
  /** Варианты оформления ссылки. По умолчанию — встроенный набор. */
  styles?: LinkStyle[];
}

export interface LinkPopover extends UiComponent {
  /**
   * Подстраивает панель под каретку: показывает у ссылки, прячет вне её.
   * Вызывается на каждой транзакции редактора.
   */
  sync(): void;
  close(): void;
  readonly isVisible: boolean;
}

/** Состояние ссылки под кареткой — то, что панель показывает и с чем сравнивает. */
interface LinkSnapshot {
  href: string;
  text: string;
  className: string;
  /** Прямоугольник всей ссылки в координатах вьюпорта. */
  anchor: DOMRect;
}

/** Повторяет правило санитайзера: проходят только схемы, по которым можно перейти. */
const NAVIGABLE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

const REGEX_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** @returns Нормализованный адрес или `null`, если адрес использовать нельзя. */
function normalizeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const scheme = REGEX_SCHEME.exec(trimmed)?.[1].toLowerCase();
  // Адрес без схемы — почти всегда домен, набранный руками.
  if (!scheme) return `https://${trimmed}`;
  return NAVIGABLE_SCHEMES.includes(scheme) ? trimmed : null;
}

/**
 * Читает ссылку под кареткой.
 *
 * Опираемся на настоящий DOM-элемент ссылки: позиция каретки говорит только о
 * точке в тексте, а панель должна стоять у ссылки целиком.
 */
function readLink(editor: Editor): LinkSnapshot | null {
  if (!editor.isEditable || !editor.isActive('link')) return null;

  const { node } = editor.view.domAtPos(editor.state.selection.from);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const anchorElement = element?.closest('a');
  if (!anchorElement) return null;

  const attributes = editor.getAttributes('link');
  return {
    href: typeof attributes.href === 'string' ? attributes.href : '',
    text: anchorElement.textContent ?? '',
    className: typeof attributes.class === 'string' ? attributes.class : '',
    anchor: anchorElement.getBoundingClientRect(),
  };
}

/**
 * Панель у ссылки, под курсором: правка адреса и подписи, выбор оформления,
 * переход и удаление.
 *
 * Модалка здесь не годится. Она забирает фокус и перекрывает текст, а работа со
 * ссылкой — это несколько мелких правок подряд, при которых важно видеть
 * окружающий абзац.
 */
export function createLinkPopover(
  context: EditorUiContext,
  options: LinkPopoverOptions = {},
): LinkPopover {
  const { editor, t } = context;
  const styles = options.styles ?? DEFAULT_LINK_STYLES;
  const disposer = createDisposer();

  const hrefInput = el('input', {
    class: 'rte-input',
    attrs: { type: 'url', inputmode: 'url', placeholder: t('link_url_placeholder') },
  });

  const textInput = el('input', { class: 'rte-input', attrs: { type: 'text' } });

  const styleSelect = el('select', {
    class: 'rte-input',
    children: styles.map((style) =>
      el('option', { text: t(style.labelKey), attrs: { value: style.className } }),
    ),
  });

  /** Выбирать не из чего — поле только мешало бы. */
  const hasStyleChoice = styles.length > 1;

  const errorText = el('p', { class: 'rte-field__error' });
  errorText.hidden = true;

  const openButton = el('button', {
    class: 'rte-button',
    attrs: { type: 'button', title: t('link_open') },
    children: [icon('openLink', 16), el('span', { text: t('link_open') })],
  });

  const removeButton = el('button', {
    class: 'rte-button rte-button--danger',
    attrs: { type: 'button', title: t('link_remove'), 'aria-label': t('link_remove') },
    children: [icon('unlink', 16)],
  });

  const applyButton = el('button', {
    class: 'rte-button rte-button--primary',
    text: t('link_apply'),
    attrs: { type: 'button' },
  });

  function field(labelKey: string, control: HTMLElement): HTMLElement {
    return el('label', {
      class: 'rte-link-popover__field',
      children: [el('span', { class: 'rte-link-popover__label', text: t(labelKey) }), control],
    });
  }

  const panel = el('div', {
    class: 'rte-link-popover',
    children: [
      field('link_url', hrefInput),
      field('link_text', textInput),
      hasStyleChoice ? field('link_style', styleSelect) : null,
      errorText,
      el('div', {
        class: 'rte-link-popover__actions',
        children: [
          openButton,
          removeButton,
          el('span', { class: 'rte-link-popover__spacer' }),
          applyButton,
        ],
      }),
    ],
  });

  const popover = createPopover();
  popover.body.appendChild(panel);

  /** Последнее прочитанное состояние ссылки: с ним сравниваем правки. */
  let current: LinkSnapshot | null = null;

  /** Пустое сообщение прячет абзац целиком — как `v-if` в шаблоне. */
  function setError(message: string): void {
    errorText.textContent = message;
    errorText.hidden = !message;
  }

  function fill(snapshot: LinkSnapshot): void {
    hrefInput.value = snapshot.href;
    textInput.value = snapshot.text;
    styleSelect.value = snapshot.className;
    setError('');
  }

  function sync(): void {
    const snapshot = readLink(editor);
    if (!snapshot) {
      current = null;
      popover.close();
      return;
    }

    const isSameLink =
      current !== null &&
      current.href === snapshot.href &&
      current.text === snapshot.text &&
      current.className === snapshot.className;
    current = snapshot;

    if (!popover.isVisible) {
      fill(snapshot);
      popover.open(snapshot.anchor);
      return;
    }

    // Панель уже открыта: поля перезаполняем, только если ссылку поменяли
    // мимо панели, иначе стёрли бы то, что пользователь сейчас набирает.
    if (!isSameLink) fill(snapshot);
    popover.reposition(snapshot.anchor);
  }

  /**
   * Применяет правки.
   *
   * Подпись меняется заменой содержимого всей марки: иначе новый текст встанет
   * рядом со старым, а не вместо него.
   */
  function apply(): void {
    const href = normalizeHref(hrefInput.value);
    if (!href) {
      setError(t('link_invalid'));
      return;
    }

    const attributes = editor.getAttributes('link');
    // Оформление без поля выбора берём из документа — не терять же его.
    const className = hasStyleChoice ? styleSelect.value : (current?.className ?? '');
    const attrs = {
      href,
      target: typeof attributes.target === 'string' ? attributes.target : '_blank',
      class: className || null,
    };

    const command = editor.chain().focus().extendMarkRange('link');
    const nextText = textInput.value.trim();

    if (nextText && nextText !== (current?.text ?? '').trim()) {
      command.insertContent({ type: 'text', text: nextText, marks: [{ type: 'link', attrs }] });
    } else {
      command.setLink(attrs);
    }

    command.run();
    popover.close();
  }

  function openLink(): void {
    const href = normalizeHref(hrefInput.value);
    if (!href) {
      setError(t('link_invalid'));
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  function remove(): void {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    popover.close();
  }

  function onFieldKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    // Иначе Enter в поле отправил бы форму, в которую вставлен редактор.
    event.preventDefault();
    apply();
  }

  disposer.add(on(hrefInput, 'keydown', onFieldKeydown));
  disposer.add(on(textInput, 'keydown', onFieldKeydown));
  disposer.add(on(openButton, 'click', openLink));
  disposer.add(on(removeButton, 'click', remove));
  disposer.add(on(applyButton, 'click', apply));

  return {
    element: popover.element,
    sync,
    close: () => popover.close(),
    get isVisible() {
      return popover.isVisible;
    },
    destroy: () => {
      disposer.dispose();
      popover.destroy();
    },
  };
}
