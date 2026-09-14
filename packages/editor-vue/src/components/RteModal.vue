<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import RteIcon from './RteIcon.vue';

const props = withDefaults(
  defineProps<{ modelValue: boolean; title: string; closeLabel?: string; wide?: boolean }>(),
  { closeLabel: 'Close', wide: false },
);

const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>();

const panel = ref<HTMLElement | null>(null);

function close(): void {
  emit('update:modelValue', false);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      document.removeEventListener('keydown', onKeydown, true);
      return;
    }
    document.addEventListener('keydown', onKeydown, true);
    await nextTick();
    // Move focus into the dialog so Escape and tabbing behave predictably.
    panel.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  },
);

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true));
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="rte-modal" role="dialog" aria-modal="true" :aria-label="title">
      <div class="rte-modal__backdrop" @click="close" />
      <div ref="panel" class="rte-modal__panel" :class="{ 'rte-modal__panel--wide': wide }">
        <header class="rte-modal__header">
          <h2 class="rte-modal__title">{{ title }}</h2>
          <button type="button" class="rte-modal__close" :aria-label="closeLabel" @click="close">
            <RteIcon name="close" :size="18" />
          </button>
        </header>

        <div class="rte-modal__body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="rte-modal__footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
