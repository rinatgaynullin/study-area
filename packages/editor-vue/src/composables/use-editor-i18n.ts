import { ref, watch, type Ref } from 'vue';
import { createI18n, type Messages, type Translate } from '@rich-editor/core';

/**
 * Reactive wrapper around the core translator. Reading `revision` inside `t`
 * is what makes templates re-render when the locale or messages change.
 */
export function useEditorI18n(
  locale: Ref<string>,
  messages: Ref<Record<string, Messages> | undefined>,
): { t: Translate } {
  const i18n = createI18n({ locale: locale.value, messages: messages.value });
  const revision = ref(0);

  watch([locale, messages], ([nextLocale, nextMessages]) => {
    i18n.setLocale(nextLocale);
    i18n.setMessages(nextMessages);
    revision.value += 1;
  });

  const t: Translate = (key, params) => {
    void revision.value;
    return i18n.t(key, params);
  };

  return { t };
}
