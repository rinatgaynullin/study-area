<script setup lang="ts">
// Единая таблица стилей пакета. Импорт живёт в компонентах, а не в index.ts,
// который по соглашению содержит только реэкспорты.
import '../styles/index.css';
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { createRichContent, type EditorTheme, type RichContent } from '@rich-editor/core';

/**
 * Обёртка над ванильным вьюером `createRichContent`.
 *
 * Сам вьюер живёт в ядре: санитизация, отрисовка формул без SVG, масштаб.
 * Компоненту остаются пропы и событие. Создаётся при монтировании — на
 * сервере санитайзеру негде работать, поэтому под SSR компонент отдаёт пустую
 * оболочку и наполняет её на клиенте.
 */
const props = withDefaults(
  defineProps<{
    html?: string;
    /** Scales formulas relative to the surrounding text. */
    formulaScale?: number;
    /** Разбирать разметку старого редактора (Froala + Wiris). */
    legacy?: boolean;
    /** Тема: светлая, тёмная или как в системе. */
    theme?: EditorTheme;
  }>(),
  { html: '', formulaScale: 1, legacy: false, theme: 'light' },
);

const emit = defineEmits<{ (event: 'rendered'): void }>();

const root = ref<HTMLElement | null>(null);
const viewer = shallowRef<RichContent | null>(null);

onMounted(() => {
  if (!root.value) return;
  viewer.value = createRichContent({
    element: root.value,
    html: props.html,
    formulaScale: props.formulaScale,
    legacy: props.legacy,
    theme: props.theme,
    onRendered: () => emit('rendered'),
  });
});

onBeforeUnmount(() => {
  viewer.value?.destroy();
  viewer.value = null;
});

watch(
  () => [props.html, props.formulaScale, props.legacy, props.theme] as const,
  ([html, formulaScale, legacy, theme]) => {
    void viewer.value?.update({ html, formulaScale, legacy, theme });
  },
);

defineExpose({
  renderPendingFormulas: () => viewer.value?.renderPendingFormulas() ?? Promise.resolve(),
});

// Содержимое ставит ядро; классы темы стоят и в шаблоне, чтобы серверная
// оболочка под SSR уже несла их. Комментариев в шаблоне нет намеренно: рядом с
// корневым элементом они делают компонент фрагментом, и класс с хоста
// перестаёт проваливаться на корень.
</script>

<template>
  <div ref="root" class="rte-content-root rte-content" :class="{ 'rte-legacy': legacy }" />
</template>
