<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Translate } from '@rich-editor/core';
import RteModal from '../rte-modal.vue';

const props = defineProps<{ modelValue: boolean; t: Translate }>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'insert', payload: { rows: number; cols: number; withHeaderRow: boolean }): void;
}>();

const rows = ref(3);
const cols = ref(3);
const withHeaderRow = ref(true);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    rows.value = 3;
    cols.value = 3;
    withHeaderRow.value = true;
  },
);

function insert(): void {
  emit('insert', {
    rows: Math.min(20, Math.max(1, Math.round(rows.value))),
    cols: Math.min(10, Math.max(1, Math.round(cols.value))),
    withHeaderRow: withHeaderRow.value,
  });
  emit('update:modelValue', false);
}
</script>

<template>
  <RteModal
    :model-value="modelValue"
    :title="t('table_insert')"
    :close-label="t('common_close')"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="rte-field-row">
      <label class="rte-field">
        <span class="rte-field__label">{{ t('table_rows') }}</span>
        <input v-model.number="rows" data-autofocus class="rte-input" type="number" min="1" max="20" />
      </label>

      <label class="rte-field">
        <span class="rte-field__label">{{ t('table_cols') }}</span>
        <input v-model.number="cols" class="rte-input" type="number" min="1" max="10" />
      </label>
    </div>

    <label class="rte-checkbox">
      <input v-model="withHeaderRow" type="checkbox" />
      <span>{{ t('table_with_header') }}</span>
    </label>

    <template #footer>
      <span class="rte-modal__spacer" />
      <button type="button" class="rte-button" @click="emit('update:modelValue', false)">
        {{ t('common_cancel') }}
      </button>
      <button type="button" class="rte-button rte-button--primary" @click="insert">
        {{ t('common_apply') }}
      </button>
    </template>
  </RteModal>
</template>
