<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import RteToolbarButton from './RteToolbarButton.vue';

withDefaults(
  defineProps<{ icon?: string; label: string; active?: boolean; disabled?: boolean }>(),
  { active: false, disabled: false },
);

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function close(): void {
  open.value = false;
}

function onDocumentPointerDown(event: MouseEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('mousedown', onDocumentPointerDown);
    document.addEventListener('keydown', onKeydown);
  } else {
    document.removeEventListener('mousedown', onDocumentPointerDown);
    document.removeEventListener('keydown', onKeydown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeydown);
});

defineExpose({ close });
</script>

<template>
  <div ref="root" class="rte-dropdown">
    <RteToolbarButton
      :icon="icon"
      :label="label"
      :active="active || open"
      :disabled="disabled"
      has-menu
      @click="open = !open"
    >
      <slot name="button" />
    </RteToolbarButton>

    <div v-if="open" class="rte-dropdown__panel" role="menu">
      <slot :close="close" />
    </div>
  </div>
</template>
