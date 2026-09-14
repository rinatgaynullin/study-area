<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import {
  VoiceRecorder,
  formatDuration,
  isRecordingSupported,
  type RichEditorError,
  type Translate,
} from '@rich-editor/core';
import RteModal from '../RteModal.vue';
import RteIcon from '../RteIcon.vue';

const props = defineProps<{
  modelValue: boolean;
  t: Translate;
  maxDurationSec: number;
  maxSizeBytes: number;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'insert', payload: { blob: Blob; duration: number; peaks: string }): void;
  (event: 'error', error: RichEditorError): void;
}>();

type Phase = 'idle' | 'recording' | 'paused' | 'ready';

const phase = ref<Phase>('idle');
const elapsed = ref(0);
const level = ref(0);
const message = ref('');
const previewUrl = ref('');

const recorder = shallowRef<VoiceRecorder | null>(null);
const result = shallowRef<{ blob: Blob; duration: number; peaks: string } | null>(null);

const supported = computed(() => isRecordingSupported());
const remaining = computed(() => Math.max(0, props.maxDurationSec - elapsed.value));

function createRecorder(): VoiceRecorder {
  return new VoiceRecorder({
    t: props.t,
    maxDurationSec: props.maxDurationSec,
    maxSizeBytes: props.maxSizeBytes,
    onTick: (value) => {
      elapsed.value = value;
      // The recorder pauses itself at the cap; finalize so the take is usable.
      if (value >= props.maxDurationSec && phase.value === 'recording') void stop();
    },
    onLevel: (value) => {
      level.value = value;
    },
    onError: (error) => {
      message.value = error.message;
      emit('error', error);
    },
  });
}

async function start(): Promise<void> {
  message.value = '';
  releasePreview();

  const instance = createRecorder();
  recorder.value = instance;

  try {
    await instance.start();
    phase.value = 'recording';
    elapsed.value = 0;
  } catch {
    // The recorder already reported a localized error through onError.
    phase.value = 'idle';
    recorder.value = null;
  }
}

function pause(): void {
  recorder.value?.pause();
  phase.value = 'paused';
}

function resume(): void {
  recorder.value?.resume();
  phase.value = 'recording';
}

async function stop(): Promise<void> {
  const instance = recorder.value;
  if (!instance) return;

  try {
    const recording = await instance.stop();
    result.value = recording;
    previewUrl.value = URL.createObjectURL(recording.blob);
    elapsed.value = recording.duration;
    phase.value = 'ready';
  } catch {
    phase.value = 'idle';
  } finally {
    recorder.value = null;
  }
}

function insert(): void {
  if (!result.value) return;
  emit('insert', result.value);
  emit('update:modelValue', false);
}

function releasePreview(): void {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
  result.value = null;
}

function reset(): void {
  recorder.value?.cancel();
  recorder.value = null;
  releasePreview();
  phase.value = 'idle';
  elapsed.value = 0;
  level.value = 0;
  message.value = '';
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) reset();
  },
);

onBeforeUnmount(reset);
</script>

<template>
  <RteModal
    :model-value="modelValue"
    :title="t('audio.title')"
    :close-label="t('common.close')"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p v-if="!supported" class="rte-field__error">{{ t('audio.unsupported') }}</p>

    <template v-else>
      <div class="rte-recorder">
        <div
          class="rte-recorder__indicator"
          :class="{ 'rte-recorder__indicator--live': phase === 'recording' }"
          :style="{ '--rte-level': String(0.6 + level * 0.6) }"
        >
          <RteIcon :name="phase === 'recording' ? 'record' : 'audio'" :size="28" />
        </div>

        <div class="rte-recorder__meta">
          <span class="rte-recorder__time">{{ formatDuration(elapsed) }}</span>
          <span class="rte-recorder__limit">
            {{
              phase === 'recording' || phase === 'paused'
                ? t('audio.remaining', { time: formatDuration(remaining) })
                : t('audio.durationLimit', { seconds: maxDurationSec })
            }}
          </span>
        </div>
      </div>

      <p v-if="phase === 'idle' && !message" class="rte-recorder__hint">
        {{ t('audio.permissionHint') }}
      </p>
      <p v-if="message" class="rte-field__error">{{ message }}</p>

      <audio v-if="previewUrl" class="rte-recorder__preview" :src="previewUrl" controls />

      <div class="rte-recorder__controls">
        <button
          v-if="phase === 'idle'"
          type="button"
          data-autofocus
          class="rte-button rte-button--primary"
          @click="start"
        >
          <RteIcon name="record" :size="16" />
          {{ t('audio.record') }}
        </button>

        <button v-if="phase === 'recording'" type="button" class="rte-button" @click="pause">
          <RteIcon name="pause" :size="16" />
          {{ t('audio.pause') }}
        </button>

        <button v-if="phase === 'paused'" type="button" class="rte-button" @click="resume">
          <RteIcon name="play" :size="16" />
          {{ t('audio.resume') }}
        </button>

        <button
          v-if="phase === 'recording' || phase === 'paused'"
          type="button"
          class="rte-button rte-button--primary"
          @click="stop"
        >
          <RteIcon name="stop" :size="16" />
          {{ t('audio.stop') }}
        </button>

        <button v-if="phase === 'ready'" type="button" class="rte-button" @click="start">
          {{ t('audio.rerecord') }}
        </button>
      </div>
    </template>

    <template #footer>
      <span class="rte-modal__spacer" />
      <button type="button" class="rte-button" @click="emit('update:modelValue', false)">
        {{ t('audio.cancel') }}
      </button>
      <button
        type="button"
        class="rte-button rte-button--primary"
        :disabled="phase !== 'ready'"
        @click="insert"
      >
        {{ t('audio.insert') }}
      </button>
    </template>
  </RteModal>
</template>
