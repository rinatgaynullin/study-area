<script setup lang="ts">
// Единая таблица стилей пакета. Импорт живёт в компонентах, а не в index.ts,
// который по соглашению содержит только реэкспорты.
import '../styles/index.css';
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  createRichEditor,
  type EditorLimits,
  type FormulaType,
  type LinkStyle,
  type Messages,
  type RichEditorCore,
  type RichEditorError,
  type RichEditorUi,
  type ToolbarConfig,
  type UploadAdapter,
} from '@rich-editor/core';

/**
 * Обёртка над ванильным редактором.
 *
 * Интерфейс — тулбар, диалоги, поповеры — целиком живёт в ядре и собран на
 * голом DOM. Компонент его монтирует и занимается только тем, ради чего нужен
 * фреймворк: реактивными пропами, `v-model` и событиями. Интерфейс не
 * дублируется, поэтому обёртки под другие фреймворки не расходятся с этой.
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string;
    locale?: string;
    messages?: Record<string, Messages>;
    uploadImage?: UploadAdapter;
    uploadAudio?: UploadAdapter;
    uploadFile?: UploadAdapter;
    limits?: Partial<EditorLimits>;
    editable?: boolean;
    toolbar?: ToolbarConfig;
    placeholder?: string;
    /** Scales MathJax output relative to the surrounding text. */
    formulaScale?: number;
    /** Варианты оформления ссылки, доступные в поповере. */
    linkStyles?: LinkStyle[];
    /**
     * Разбирать разметку старого редактора (Froala + Wiris).
     *
     * Читается один раз при создании: режим меняет схему документа, а её
     * нельзя переключить у живого редактора. Чтобы сменить режим на лету,
     * пересоздайте компонент через `:key`.
     */
    legacy?: boolean;
    /** Passed to `MathfieldElement.fontsDirectory`. */
    mathliveFontsDirectory?: string | null;
    minHeight?: string;
  }>(),
  {
    modelValue: '',
    locale: 'ru',
    editable: true,
    toolbar: 'full',
    formulaScale: 1,
    legacy: false,
    mathliveFontsDirectory: null,
    minHeight: '220px',
  },
);

const emit = defineEmits<{
  (event: 'update:modelValue', html: string): void;
  (event: 'change', html: string): void;
  (event: 'focus'): void;
  (event: 'blur'): void;
  (event: 'error', error: RichEditorError): void;
  (event: 'ready', core: RichEditorCore): void;
}>();

const host = ref<HTMLElement | null>(null);
const ui = shallowRef<RichEditorUi | null>(null);

/** Защита от того, чтобы watcher модели не переприменял только что отданный HTML. */
let lastEmitted = '';

onMounted(() => {
  if (!host.value) return;

  const instance = createRichEditor({
    element: host.value,
    content: props.modelValue,
    editable: props.editable,
    locale: props.locale,
    messages: props.messages,
    limits: props.limits,
    placeholder: props.placeholder,
    formulaScale: props.formulaScale,
    legacy: props.legacy,
    toolbar: props.toolbar,
    linkStyles: props.linkStyles,
    mathliveFontsDirectory: props.mathliveFontsDirectory,
    minHeight: props.minHeight,
    uploadImage: props.uploadImage,
    uploadAudio: props.uploadAudio,
    uploadFile: props.uploadFile,
    onChange: (html) => {
      lastEmitted = html;
      emit('update:modelValue', html);
      emit('change', html);
    },
    onFocus: () => emit('focus'),
    onBlur: () => emit('blur'),
    onError: (error) => emit('error', error),
  });

  ui.value = instance;
  emit('ready', instance.core);
});

onBeforeUnmount(() => {
  ui.value?.destroy();
  ui.value = null;
});

watch(
  () => props.modelValue,
  (html) => {
    // Пришло то же, что мы сами только что отдали — переприменять нечего.
    if (html === lastEmitted) return;
    ui.value?.core.setHTML(html);
  },
);

// Режим чтения и локаль меняют не только документ, но и тулбар, поэтому
// идут через оболочку, а не напрямую в движок.
watch(() => props.editable, (editable) => ui.value?.setEditable(editable));
watch(() => props.locale, (locale) => ui.value?.setLocale(locale));
watch(
  () => props.messages,
  (messages) => {
    ui.value?.core.setMessages(messages);
    ui.value?.refreshLabels();
  },
  { deep: true },
);
watch(() => props.limits, (limits) => limits && ui.value?.core.setLimits(limits), { deep: true });

defineExpose({
  getHTML: () => ui.value?.core.getHTML() ?? '',
  setHTML: (html: string) => ui.value?.core.setHTML(html),
  getJSON: () => ui.value?.core.getJSON(),
  getText: () => ui.value?.core.getText() ?? '',
  focus: () => ui.value?.core.focus(),
  isEmpty: () => ui.value?.core.isEmpty() ?? true,
  insertFormula: (mathml: string, type: FormulaType = 'math') =>
    ui.value?.core.insertFormula(mathml, type) ?? false,
  whenFormulasReady: () => ui.value?.core.whenFormulasReady() ?? Promise.resolve(),
  get editor() {
    return ui.value?.core.editor ?? null;
  },
  get core() {
    return ui.value?.core ?? null;
  },
});
</script>

<template>
  <!-- Разметку строит ядро; компоненту нужна только точка монтирования. -->
  <div ref="host" class="rte-mount" />
</template>
