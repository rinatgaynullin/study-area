<script setup lang="ts">
import { computed } from 'vue';
import { ICONS } from './icons';

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });

// Static markup from our own constant map — never user-supplied.
const markup = computed(() => ICONS[props.name] ?? '');
</script>

<template>
  <svg
    class="rte-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    v-html="markup"
  />
</template>
