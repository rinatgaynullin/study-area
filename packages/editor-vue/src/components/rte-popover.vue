<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

/**
 * Панель, привязанная к прямоугольнику в документе.
 *
 * В отличие от модалки не забирает фокус у редактора: поповер сопровождает то,
 * что пользователь сейчас правит, и курсор должен оставаться в тексте.
 * Координаты приходят готовым DOMRect в координатах вьюпорта — считать их умеет
 * только вызывающая сторона, знающая про позицию в документе.
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** Прямоугольник элемента, к которому прижимается панель, в координатах вьюпорта. */
    anchor: DOMRect | null;
    /** Зазор между якорем и панелью. */
    offset?: number;
  }>(),
  { offset: 8 },
);

const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>();

const panel = ref<HTMLElement | null>(null);
const position = ref({ top: 0, left: 0 });

/** Отступ от края окна, ниже которого панель прижимать некрасиво. */
const VIEWPORT_MARGIN = 8;

function reposition(): void {
  const anchor = props.anchor;
  const element = panel.value;
  if (!anchor || !element) return;

  const { width, height } = element.getBoundingClientRect();

  // По горизонтали центрируем по якорю, но не даём вылезти за края окна.
  const centred = anchor.left + anchor.width / 2 - width / 2;
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  const left = Math.min(Math.max(centred, VIEWPORT_MARGIN), Math.max(maxLeft, VIEWPORT_MARGIN));

  // Снизу, если там есть место; иначе сверху — иначе панель уедет под экран.
  const below = anchor.bottom + props.offset;
  const fitsBelow = below + height + VIEWPORT_MARGIN <= window.innerHeight;
  const top = fitsBelow ? below : Math.max(anchor.top - height - props.offset, VIEWPORT_MARGIN);

  position.value = { top, left };
}

function close(): void {
  emit('update:modelValue', false);
}

function onDocumentPointerDown(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (target && panel.value?.contains(target)) return;
  close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  }
}

watch(
  () => props.modelValue,
  async (isVisible) => {
    if (isVisible) {
      document.addEventListener('mousedown', onDocumentPointerDown);
      document.addEventListener('keydown', onKeydown);
      // Ждём кадр: до отрисовки у панели нет размеров, а они нужны для раскладки.
      requestAnimationFrame(reposition);
    } else {
      document.removeEventListener('mousedown', onDocumentPointerDown);
      document.removeEventListener('keydown', onKeydown);
    }
  },
);

// Якорь двигается вместе с текстом — при наборе, скролле и смене размера окна.
watch(() => props.anchor, reposition);

const scrollHandler = (): void => reposition();
window.addEventListener('scroll', scrollHandler, true);
window.addEventListener('resize', scrollHandler);

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('scroll', scrollHandler, true);
  window.removeEventListener('resize', scrollHandler);
});

const style = computed(() => ({
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
}));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      ref="panel"
      class="rte-popover"
      role="dialog"
      :style="style"
      @mousedown.stop
    >
      <slot />
    </div>
  </Teleport>
</template>
