<script setup lang="ts">
// Единая таблица стилей пакета. Импорт живёт в компонентах, а не в index.ts,
// который по соглашению содержит только реэкспорты.
import '../styles/index.css';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRef, watch } from 'vue';
import {
  IMAGE_ACCEPT,
  RichEditorCore,
  TEXT_FILE_ACCEPT,
  type EditorLimits,
  type FormulaPayload,
  type FormulaType,
  type Messages,
  type RichEditorError,
  type UploadAdapter,
} from '@rich-editor/core';

import EditorToolbar from './editor-toolbar.vue';
import LinkDialog from './dialogs/link-dialog.vue';
import LinkPopover from './link-popover.vue';
import TableDialog from './dialogs/table-dialog.vue';
import FormulaDialog from './dialogs/formula-dialog.vue';
import AudioRecorderDialog from './dialogs/audio-recorder-dialog.vue';
import { useEditorI18n } from '../composables/use-editor-i18n';
import { emptyToolbarState, readToolbarState, type ToolbarState } from '../composables/toolbar-state';
import { resolveToolbar, type ToolbarConfig } from '../toolbar/presets';
import { DEFAULT_LINK_STYLES, type LinkStyle } from '../link-styles';

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
    linkStyles: () => DEFAULT_LINK_STYLES,
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
const core = shallowRef<RichEditorCore | null>(null);
const state = ref<ToolbarState>(emptyToolbarState());

const imageInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const fileMode = ref<'attach' | 'insert'>('attach');

const isLinkVisible = ref(false);
const isTableVisible = ref(false);
const isFormulaVisible = ref(false);
const isRecorderVisible = ref(false);
const formulaPayload = ref<FormulaPayload | null>(null);

const isLinkPopoverVisible = ref(false);
const linkAnchor = ref<DOMRect | null>(null);
const linkText = ref('');
const linkClass = ref('');

const { t } = useEditorI18n(toRef(props, 'locale'), toRef(props, 'messages'));
const groups = computed(() => resolveToolbar(props.toolbar));
const limits = computed(() => core.value?.getLimits());

/** Guards against the v-model watcher re-applying content we just emitted. */
let lastEmitted = '';

function syncState(): void {
  if (!core.value) return;
  state.value = readToolbarState(core.value.editor);
  syncLinkPopover();
}

onMounted(() => {
  if (!host.value) return;

  const instance = new RichEditorCore({
    element: host.value,
    content: props.modelValue,
    editable: props.editable,
    locale: props.locale,
    messages: props.messages,
    limits: props.limits,
    placeholder: props.placeholder,
    formulaScale: props.formulaScale,
    legacy: props.legacy,
    uploadImage: props.uploadImage,
    uploadAudio: props.uploadAudio,
    uploadFile: props.uploadFile,
    onChange: (html) => {
      lastEmitted = html;
      emit('update:modelValue', html);
      emit('change', html);
    },
    onTransaction: syncState,
    onFocus: () => emit('focus'),
    onBlur: () => emit('blur'),
    onError: (error) => emit('error', error),
    onFormulaEdit: (payload) => {
      formulaPayload.value = payload;
      isFormulaVisible.value = true;
    },
  });

  core.value = instance;
  syncState();
  emit('ready', instance);
});

onBeforeUnmount(() => {
  core.value?.destroy();
  core.value = null;
});

watch(
  () => props.modelValue,
  (html) => {
    const instance = core.value;
    if (!instance || html === lastEmitted || html === instance.getHTML()) return;
    instance.setHTML(html ?? '');
    syncState();
  },
);

// Dialogs take focus away from the editor; hand it back when the last one
// closes so selection-based keyboard actions keep working.
watch(
  () => [isLinkVisible.value, isTableVisible.value, isFormulaVisible.value, isRecorderVisible.value],
  (flags, previous) => {
    if (previous?.some(Boolean) && !flags.some(Boolean)) core.value?.focus();
  },
);

watch(() => props.editable, (editable) => core.value?.setEditable(editable));
watch(() => props.locale, (locale) => core.value?.setLocale(locale));
watch(() => props.messages, (messages) => core.value?.setMessages(messages), { deep: true });
watch(() => props.limits, (next) => next && core.value?.setLimits(next), { deep: true });

// ------------------------------------------------------------------ commands

function chain() {
  return core.value!.editor.chain().focus();
}

const SIMPLE_COMMANDS: Record<string, () => void> = {
  bold: () => chain().toggleBold().run(),
  italic: () => chain().toggleItalic().run(),
  underline: () => chain().toggleUnderline().run(),
  strike: () => chain().toggleStrike().run(),
  code: () => chain().toggleCode().run(),
  codeBlock: () => chain().toggleCodeBlock().run(),
  blockquote: () => chain().toggleBlockquote().run(),
  bulletList: () => chain().toggleBulletList().run(),
  orderedList: () => chain().toggleOrderedList().run(),
  subscript: () => chain().toggleSubscript().run(),
  superscript: () => chain().toggleSuperscript().run(),
  horizontalRule: () => chain().setHorizontalRule().run(),
  undo: () => chain().undo().run(),
  redo: () => chain().redo().run(),
  clearFormat: () => chain().unsetAllMarks().clearNodes().run(),
};

function onCommand(id: string, payload?: unknown): void {
  const instance = core.value;
  if (!instance) return;

  const simple = SIMPLE_COMMANDS[id];
  if (simple) {
    simple();
    return;
  }

  if (id === 'heading') {
    const level = payload as number;
    if (level === 0) chain().setParagraph().run();
    else chain().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    return;
  }

  if (id === 'align') {
    chain().setTextAlign(payload as string).run();
    return;
  }

  if (id === 'textColor') {
    if (payload === null) chain().unsetColor().run();
    else chain().setColor(payload as string).run();
    return;
  }

  if (id === 'highlight') {
    if (payload === null) chain().unsetHighlight().run();
    else chain().setHighlight({ color: payload as string }).run();
    return;
  }

  if (id === 'link') {
    isLinkVisible.value = true;
    return;
  }

  if (id === 'table:insert') {
    isTableVisible.value = true;
    return;
  }

  if (id.startsWith('table:')) {
    const action = id.slice('table:'.length) as 'addRowBefore';
    const commands = chain() as unknown as Record<string, () => { run: () => boolean }>;
    commands[action]?.().run();
    return;
  }

  if (id === 'image') {
    imageInput.value?.click();
    return;
  }

  if (id === 'file' || id === 'file:attach') {
    fileMode.value = 'attach';
    fileInput.value?.click();
    return;
  }

  if (id === 'file:insert') {
    fileMode.value = 'insert';
    fileInput.value?.click();
    return;
  }

  if (id === 'audio') {
    isRecorderVisible.value = true;
    return;
  }

  if (id === 'formulaMath' || id === 'formulaChem') {
    formulaPayload.value = {
      mathml: '',
      type: id === 'formulaChem' ? 'chem' : 'math',
      pos: null,
    };
    isFormulaVisible.value = true;
  }
}

// ------------------------------------------------------------------- dialogs

function applyLink(payload: { href: string; targetBlank: boolean }): void {
  chain()
    .extendMarkRange('link')
    .setLink({ href: payload.href, target: payload.targetBlank ? '_blank' : null })
    .run();
}

/**
 * Открывает поповер, когда курсор оказался внутри ссылки, и закрывает, когда
 * вышел. Опираемся на настоящий DOM-элемент ссылки: `coordsAtPos` даёт позицию
 * каретки, а панель должна стоять у всей ссылки целиком.
 */
function syncLinkPopover(): void {
  const instance = core.value;
  if (!instance) return;

  const { editor } = instance;
  if (!editor.isEditable || !editor.isActive('link')) {
    isLinkPopoverVisible.value = false;
    linkAnchor.value = null;
    return;
  }

  const element = editor.view.domAtPos(editor.state.selection.from).node;
  const anchorElement =
    element instanceof HTMLElement
      ? element.closest('a')
      : (element.parentElement?.closest('a') ?? null);

  if (!anchorElement) {
    isLinkPopoverVisible.value = false;
    return;
  }

  const attributes = editor.getAttributes('link');
  linkAnchor.value = anchorElement.getBoundingClientRect();
  linkText.value = anchorElement.textContent ?? '';
  linkClass.value = (attributes.class as string) ?? '';
  isLinkPopoverVisible.value = true;
}

/**
 * Применяет правки из поповера.
 *
 * Подпись меняется заменой содержимого всей марки: иначе новый текст встанет
 * рядом со старым, а не вместо него.
 */
function applyLinkEdit(payload: { href: string; text: string; linkClass: string }): void {
  const instance = core.value;
  if (!instance) return;

  const attrs = {
    href: payload.href,
    target: instance.editor.getAttributes('link').target ?? '_blank',
    class: payload.linkClass || null,
  };

  const command = chain().extendMarkRange('link');
  const nextText = payload.text.trim();

  if (nextText && nextText !== linkText.value.trim()) {
    command.insertContent({
      type: 'text',
      text: nextText,
      marks: [{ type: 'link', attrs }],
    });
  } else {
    command.setLink(attrs);
  }

  command.run();
}

function removeLink(): void {
  chain().extendMarkRange('link').unsetLink().run();
}

function insertTable(payload: { rows: number; cols: number; withHeaderRow: boolean }): void {
  chain().insertTable(payload).run();
}

async function saveFormula(payload: {
  mathml: string;
  type: FormulaType;
  pos: number | null;
}): Promise<void> {
  const instance = core.value;
  if (!instance) return;

  if (payload.pos === null) instance.insertFormula(payload.mathml, payload.type);
  else instance.updateFormulaAt(payload.pos, payload.mathml, payload.type);

  await instance.whenFormulasReady();
  // The node view paints from cache; re-emitting keeps v-model's SVG current.
  await nextTick();
  const html = instance.getHTML();
  lastEmitted = html;
  emit('update:modelValue', html);
  emit('change', html);
}

function removeFormula(pos: number): void {
  core.value?.deleteFormulaAt(pos);
}

async function onImagePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) await core.value?.insertImageFile(file);
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (fileMode.value === 'insert') await core.value?.insertTextFileContent(file);
  else await core.value?.attachTextFile(file);
}

async function onRecordingReady(payload: {
  blob: Blob;
  duration: number;
  peaks: string;
}): Promise<void> {
  await core.value?.insertRecording(payload.blob, {
    duration: payload.duration,
    peaks: payload.peaks,
  });
}

// -------------------------------------------------------------------- expose

defineExpose({
  getHTML: () => core.value?.getHTML() ?? '',
  setHTML: (html: string) => core.value?.setHTML(html),
  getJSON: () => core.value?.getJSON(),
  getText: () => core.value?.getText() ?? '',
  focus: () => core.value?.focus(),
  isEmpty: () => core.value?.isEmpty() ?? true,
  insertFormula: (mathml: string, type: FormulaType = 'math') =>
    core.value?.insertFormula(mathml, type) ?? false,
  whenFormulasReady: () => core.value?.whenFormulasReady() ?? Promise.resolve(),
  get editor() {
    return core.value?.editor ?? null;
  },
  get core() {
    return core.value;
  },
});
</script>

<template>
  <div class="rte-root" :class="{ 'rte-root--readonly': !editable }">
    <EditorToolbar
      v-if="editable"
      :t="t"
      :state="state"
      :groups="groups"
      :disabled="!core"
      @command="onCommand"
    />

    <div class="rte-surface" :style="{ minHeight }">
      <div ref="host" class="rte-host" />
    </div>

    <input
      ref="imageInput"
      type="file"
      class="rte-hidden-input"
      :accept="IMAGE_ACCEPT"
      @change="onImagePicked"
    />
    <input
      ref="fileInput"
      type="file"
      class="rte-hidden-input"
      :accept="TEXT_FILE_ACCEPT"
      @change="onFilePicked"
    />

    <LinkPopover
      v-model="isLinkPopoverVisible"
      :t="t"
      :anchor="linkAnchor"
      :href="state.linkHref"
      :text="linkText"
      :link-class="linkClass"
      :styles="linkStyles"
      @apply="applyLinkEdit"
      @remove="removeLink"
    />

    <LinkDialog
      v-model="isLinkVisible"
      :t="t"
      :href="state.linkHref"
      :target-blank="state.linkTargetBlank"
      :can-remove="state.link"
      @apply="applyLink"
      @remove="removeLink"
    />

    <TableDialog v-model="isTableVisible" :t="t" @insert="insertTable" />

    <FormulaDialog
      v-model="isFormulaVisible"
      :t="t"
      :payload="formulaPayload"
      :fonts-directory="mathliveFontsDirectory"
      :locale="locale"
      @save="saveFormula"
      @remove="removeFormula"
    />

    <AudioRecorderDialog
      v-if="limits"
      v-model="isRecorderVisible"
      :t="t"
      :max-duration-sec="limits.maxAudioDurationSec"
      :max-size-bytes="limits.maxAudioSizeBytes"
      @insert="onRecordingReady"
      @error="emit('error', $event)"
    />
  </div>
</template>
