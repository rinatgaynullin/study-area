<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Translate } from '@rich-editor/core';
import RteModal from '../rte-modal.vue';

const props = defineProps<{
  modelValue: boolean;
  t: Translate;
  href: string;
  targetBlank: boolean;
  canRemove: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'apply', payload: { href: string; targetBlank: boolean }): void;
  (event: 'remove'): void;
}>();

const href = ref('');
const targetBlank = ref(true);
const error = ref('');

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    href.value = props.href;
    targetBlank.value = props.targetBlank;
    error.value = '';
  },
);

/** Mirrors the sanitizer: only navigable schemes are accepted. */
function normalize(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (!scheme) return `https://${trimmed}`;
  return ['http', 'https', 'mailto', 'tel'].includes(scheme) ? trimmed : null;
}

function apply(): void {
  const normalized = normalize(href.value);
  if (!normalized) {
    error.value = props.t('link_invalid');
    return;
  }
  emit('apply', { href: normalized, targetBlank: targetBlank.value });
  emit('update:modelValue', false);
}
</script>

<template>
  <RteModal
    :model-value="modelValue"
    :title="t('link_title')"
    :close-label="t('common_close')"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <label class="rte-field">
      <span class="rte-field__label">{{ t('link_url') }}</span>
      <input
        v-model="href"
        data-autofocus
        class="rte-input"
        type="url"
        inputmode="url"
        :placeholder="t('link_url_placeholder')"
        @keydown.enter.prevent="apply"
      />
    </label>

    <p v-if="error" class="rte-field__error">{{ error }}</p>

    <label class="rte-checkbox">
      <input v-model="targetBlank" type="checkbox" />
      <span>{{ t('link_open_in_new_tab') }}</span>
    </label>

    <template #footer>
      <button
        v-if="canRemove"
        type="button"
        class="rte-button rte-button--danger"
        @click="emit('remove'); emit('update:modelValue', false)"
      >
        {{ t('link_remove') }}
      </button>
      <span class="rte-modal__spacer" />
      <button type="button" class="rte-button" @click="emit('update:modelValue', false)">
        {{ t('common_cancel') }}
      </button>
      <button type="button" class="rte-button rte-button--primary" @click="apply">
        {{ t('link_apply') }}
      </button>
    </template>
  </RteModal>
</template>
