<script setup lang="ts">
import { ref } from 'vue';
import type { Translate } from '@rich-editor/core';
import RteIcon from './rte-icon.vue';

const props = defineProps<{ t: Translate; value: string; swatches: string[] }>();

const emit = defineEmits<{
  (event: 'select', color: string): void;
  (event: 'reset'): void;
}>();

const custom = ref(props.value || '#000000');
</script>

<template>
  <div class="rte-colors">
    <div class="rte-colors__grid">
      <button
        v-for="color in swatches"
        :key="color"
        type="button"
        class="rte-colors__swatch"
        :class="{ 'rte-colors__swatch--active': value === color }"
        :style="{ background: color }"
        :title="color"
        :aria-label="color"
        @click="emit('select', color)"
      />
    </div>

    <div class="rte-colors__actions">
      <button type="button" class="rte-colors__reset" @click="emit('reset')">
        <RteIcon name="noColor" :size="16" />
        <span>{{ t('color_reset') }}</span>
      </button>

      <label class="rte-colors__custom">
        <span>{{ t('color_custom') }}</span>
        <input v-model="custom" type="color" @change="emit('select', custom)" />
      </label>
    </div>
  </div>
</template>
