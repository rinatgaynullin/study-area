<script setup lang="ts">
import RteIcon from './rte-icon.vue';

withDefaults(
  defineProps<{
    icon?: string;
    label: string;
    active?: boolean;
    disabled?: boolean;
    /** Renders a caret, signalling the button opens a panel. */
    hasMenu?: boolean;
  }>(),
  { active: false, disabled: false, hasMenu: false },
);

defineEmits<{ (event: 'click', payload: MouseEvent): void }>();
</script>

<template>
  <button
    type="button"
    class="rte-btn"
    :class="{ 'rte-btn--active': active }"
    :disabled="disabled"
    :title="label"
    :aria-label="label"
    :aria-pressed="active"
    @mousedown.prevent
    @click="$emit('click', $event)"
  >
    <RteIcon v-if="icon" :name="icon" />
    <slot />
    <RteIcon v-if="hasMenu" name="chevronDown" :size="14" class="rte-btn__caret" />
  </button>
</template>
