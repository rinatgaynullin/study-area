<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Translate } from '@rich-editor/core';
import RtePopover from './rte-popover.vue';
import RteIcon from './rte-icon.vue';
import { DEFAULT_LINK_STYLES, type LinkStyle } from '../link-styles';

/**
 * Панель у ссылки, под курсором: правка адреса и подписи, выбор оформления,
 * переход и удаление.
 *
 * Модалка здесь не годится. Она забирает фокус и перекрывает текст, а работа со
 * ссылкой — это несколько мелких правок подряд, при которых важно видеть
 * окружающий абзац.
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    t: Translate;
    anchor: DOMRect | null;
    href: string;
    text: string;
    linkClass: string;
    styles?: LinkStyle[];
  }>(),
  { styles: () => DEFAULT_LINK_STYLES },
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'apply', payload: { href: string; text: string; linkClass: string }): void;
  (event: 'remove'): void;
}>();

const href = ref('');
const text = ref('');
const linkClass = ref('');
const error = ref('');

watch(
  () => [props.modelValue, props.href, props.text, props.linkClass] as const,
  ([isVisible]) => {
    if (!isVisible) return;
    href.value = props.href;
    text.value = props.text;
    linkClass.value = props.linkClass;
    error.value = '';
  },
  { immediate: true },
);

/** Повторяет правило санитайзера: проходят только схемы, по которым можно перейти. */
const NAVIGABLE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

function normalize(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  // Адрес без схемы — почти всегда домен, набранный руками.
  if (!scheme) return `https://${trimmed}`;
  return NAVIGABLE_SCHEMES.includes(scheme) ? trimmed : null;
}

const normalized = computed(() => normalize(href.value));

function apply(): void {
  const safeHref = normalized.value;
  if (!safeHref) {
    error.value = props.t('link_invalid');
    return;
  }

  emit('apply', { href: safeHref, text: text.value.trim(), linkClass: linkClass.value });
  emit('update:modelValue', false);
}

function openLink(): void {
  const safeHref = normalized.value;
  if (!safeHref) {
    error.value = props.t('link_invalid');
    return;
  }
  window.open(safeHref, '_blank', 'noopener,noreferrer');
}

function remove(): void {
  emit('remove');
  emit('update:modelValue', false);
}
</script>

<template>
  <RtePopover
    :model-value="modelValue"
    :anchor="anchor"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="rte-link-popover">
      <label class="rte-link-popover__field">
        <span class="rte-link-popover__label">{{ t('link_url') }}</span>
        <input
          v-model="href"
          class="rte-input"
          type="url"
          inputmode="url"
          :placeholder="t('link_url_placeholder')"
          @keydown.enter.prevent="apply"
        />
      </label>

      <label class="rte-link-popover__field">
        <span class="rte-link-popover__label">{{ t('link_text') }}</span>
        <input
          v-model="text"
          class="rte-input"
          type="text"
          @keydown.enter.prevent="apply"
        />
      </label>

      <label v-if="styles.length > 1" class="rte-link-popover__field">
        <span class="rte-link-popover__label">{{ t('link_style') }}</span>
        <select v-model="linkClass" class="rte-input">
          <option v-for="style in styles" :key="style.className" :value="style.className">
            {{ t(style.labelKey) }}
          </option>
        </select>
      </label>

      <p v-if="error" class="rte-field__error">{{ error }}</p>

      <div class="rte-link-popover__actions">
        <button
          type="button"
          class="rte-button"
          :title="t('link_open')"
          @click="openLink"
        >
          <RteIcon name="openLink" :size="16" />
          {{ t('link_open') }}
        </button>

        <button
          type="button"
          class="rte-button rte-button--danger"
          :title="t('link_remove')"
          @click="remove"
        >
          <RteIcon name="unlink" :size="16" />
        </button>

        <span class="rte-link-popover__spacer" />

        <button type="button" class="rte-button rte-button--primary" @click="apply">
          {{ t('link_apply') }}
        </button>
      </div>
    </div>
  </RtePopover>
</template>
