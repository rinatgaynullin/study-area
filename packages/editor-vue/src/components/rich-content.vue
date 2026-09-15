<script setup lang="ts">
// Единая таблица стилей пакета. Импорт живёт в компонентах, а не в index.ts,
// который по соглашению содержит только реэкспорты.
import '../styles/index.css';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { prepareIncomingHtml, renderMathML } from '@rich-editor/core';

/**
 * Read-only viewer for documents produced by `<RichEditor />`.
 *
 * It loads none of the editing stack — no ProseMirror, no MathLive — and simply
 * renders sanitized HTML. Formulas exported by the editor already carry their
 * MathJax SVG, so nothing extra loads for them; formulas that arrive with only
 * `data-mathml` (for example from a backend that stores just the source) are
 * rendered on the fly from that MathML.
 *
 * Rendering happens on the client: sanitization needs a DOM, so under SSR the
 * component renders an empty shell and fills it on hydration.
 */
const props = withDefaults(
  defineProps<{
    html?: string;
    /** Scales formulas relative to the surrounding text. */
    formulaScale?: number;
    /** Разбирать разметку старого редактора (Froala + Wiris). */
    legacy?: boolean;
  }>(),
  { html: '', formulaScale: 1, legacy: false },
);

const emit = defineEmits<{ (event: 'rendered'): void }>();

const root = ref<HTMLElement | null>(null);
const mounted = ref(false);

// `prepareIncomingHtml` needs a DOM, so it must not run during SSR.
const safeHtml = computed(() =>
  mounted.value ? prepareIncomingHtml(props.html, { legacy: props.legacy }) : '',
);

async function renderPendingFormulas(): Promise<void> {
  const container = root.value;
  if (!container) return;

  const formulas = Array.from(container.querySelectorAll<HTMLElement>('span[data-formula]'));

  await Promise.all(
    formulas.map(async (formula) => {
      const host =
        formula.querySelector<HTMLElement>('[data-render-host]') ??
        formula.appendChild(createRenderHost());

      if (props.formulaScale !== 1) host.style.fontSize = `${props.formulaScale}em`;
      // An SVG that travelled with the document needs no re-render.
      if (host.childElementCount > 0) return;

      const svg = await renderMathML(formula.getAttribute('data-mathml') ?? '');
      if (svg) host.innerHTML = svg;
    }),
  );

  emit('rendered');
}

function createRenderHost(): HTMLElement {
  const host = document.createElement('span');
  host.className = 'rte-formula__render';
  host.setAttribute('data-render-host', 'true');
  return host;
}

onMounted(() => {
  mounted.value = true;
});

watch(
  [safeHtml, () => props.formulaScale],
  async () => {
    // v-html replaces the subtree, so re-render after Vue has patched it.
    await nextTick();
    await renderPendingFormulas();
  },
  { immediate: true },
);

defineExpose({ renderPendingFormulas });
</script>

<template>
  <div
    ref="root"
    class="rte-content-root rte-content"
    :class="{ 'rte-legacy': legacy }"
    v-html="safeHtml"
  />
</template>
