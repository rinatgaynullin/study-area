<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import {
  getTemplateCategories,
  latexToMathML,
  mathmlToLatex,
  type FormulaPayload,
  type FormulaTemplate,
  type FormulaType,
  type Translate,
} from '@rich-editor/core';
import RteModal from '../rte-modal.vue';
import RteIcon from '../rte-icon.vue';
import { renderLatexPreview } from '../../composables/use-formula-preview';
import { MATHLIVE_STRINGS } from '../../i18n/mathlive';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    t: Translate;
    payload: FormulaPayload | null;
    /** Where MathLive should load its fonts from; `null` uses already-loaded CSS. */
    fontsDirectory?: string | null;
    /** Language for MathLive's own context menu and tooltips. */
    locale?: string;
  }>(),
  { fontsDirectory: null, locale: 'ru' },
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'save', payload: { mathml: string; type: FormulaType; pos: number | null }): void;
  (event: 'remove', pos: number): void;
}>();

const host = ref<HTMLElement | null>(null);
const mathfield = shallowRef<HTMLElement & { value: string; insert: (s: string, o?: unknown) => void; focus: () => void } | null>(null);
const loading = ref(false);
const failed = ref(false);

/** MathLive holds its locale on the class, so the loaded constructor is kept. */
interface MathfieldCtor {
  locale: string;
}

const mathfieldCtor = shallowRef<MathfieldCtor | null>(null);

function applyLocale(ctor: MathfieldCtor): void {
  mathfieldCtor.value = ctor;
  ctor.locale = props.locale;
}

watch(
  () => props.locale,
  () => {
    if (mathfieldCtor.value) applyLocale(mathfieldCtor.value);
  },
);

const type = ref<FormulaType>('math');
const latex = ref('');
const previewSvg = ref('');
const activeCategory = ref('');
const templatePreviews = ref<Record<string, string>>({});

const isEditing = computed(() => props.payload?.pos !== null && props.payload?.pos !== undefined);
const categories = computed(() => getTemplateCategories(type.value));

const title = computed(() =>
  type.value === 'chem' ? props.t('formula_title_chem') : props.t('formula_title_math'),
);

/** MathLive is browser-only and heavy, so it loads when the dialog first opens. */
async function ensureMathfield(): Promise<void> {
  if (mathfield.value || typeof window === 'undefined') return;

  loading.value = true;
  failed.value = false;
  try {
    const { MathfieldElement } = await import('mathlive');
    MathfieldElement.soundsDirectory = null;
    if (props.fontsDirectory !== undefined) {
      MathfieldElement.fontsDirectory = props.fontsDirectory;
    }

    // MathLive ships no Russian translation, so its menu would stay English.
    // The setter merges, and `localize()` falls back ru-RU → ru → en, so a
    // language-only key covers every region.
    MathfieldElement.strings = MATHLIVE_STRINGS;
    applyLocale(MathfieldElement);

    const field = new MathfieldElement({
      defaultMode: 'math',
      // The dialog is a desktop-style form with a template gallery; MathLive's
      // own on-screen keyboard duplicates it and covers the preview. 'manual'
      // stops it opening on focus — the toggle button is hidden in CSS.
      mathVirtualKeyboardPolicy: 'manual',
    });
    field.className = 'rte-formula-editor__field';
    field.addEventListener('input', () => {
      latex.value = field.value;
    });
    mathfield.value = field as unknown as typeof mathfield.value;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

async function prepareField(): Promise<void> {
  const payload = props.payload;
  type.value = payload?.type ?? 'math';
  activeCategory.value = categories.value[0]?.id ?? '';
  previewSvg.value = '';
  // Кэш превью намеренно переживает закрытие: он зависит только от шаблона и
  // типа формулы, а перерисовывать полтора десятка SVG на каждое открытие —
  // заметная задержка на ровном месте.
  void renderCategoryPreviews();

  await ensureMathfield();

  const field = mathfield.value;
  if (!field) return;

  host.value?.replaceChildren(field);

  // Existing formulas re-open from their stored MathML.
  latex.value = payload?.mathml ? await mathmlToLatex(payload.mathml) : '';
  field.value = latex.value;
  field.focus();
}

watch(
  () => props.modelValue,
  (isVisible) => {
    if (isVisible) void prepareField();
  },
);

watch([latex, type], async ([nextLatex, nextType]) => {
  previewSvg.value = nextLatex.trim()
    ? await renderLatexPreview(nextLatex, nextType)
    : '';
});

/**
 * Рисует превью для видимой категории. Рендерить весь каталог расточительно:
 * категорий полтора десятка, а видна одна.
 *
 * Вызывается явно, а не только из watcher: при повторном открытии диалога
 * категория присваивается та же, что была, watcher на неизменившемся значении
 * не срабатывает — и кнопки остаются с заглушками.
 */
async function renderCategoryPreviews(): Promise<void> {
  const category = categories.value.find((item) => item.id === activeCategory.value);
  if (!category) return;

  const rendered: Record<string, string> = { ...templatePreviews.value };
  await Promise.all(
    category.templates.map(async (template) => {
      if (rendered[template.id]) return;
      rendered[template.id] = await renderLatexPreview(template.preview, category.type);
    }),
  );
  templatePreviews.value = rendered;
}

watch([activeCategory, type], () => void renderCategoryPreviews());

watch(type, () => {
  activeCategory.value = categories.value[0]?.id ?? '';
});

function applyTemplate(template: FormulaTemplate): void {
  const field = mathfield.value;
  if (!field) return;
  field.insert(template.latex, { selectionMode: 'placeholder', focus: true });
  latex.value = field.value;
}

async function save(): Promise<void> {
  const value = latex.value.trim();
  if (!value) return;

  const mathml = await latexToMathML(value, type.value);
  if (!mathml) return;

  emit('save', { mathml, type: type.value, pos: props.payload?.pos ?? null });
  emit('update:modelValue', false);
}

function remove(): void {
  const pos = props.payload?.pos;
  if (typeof pos === 'number') emit('remove', pos);
  emit('update:modelValue', false);
}

onBeforeUnmount(() => {
  mathfield.value?.remove();
  mathfield.value = null;
});
</script>

<template>
  <RteModal
    :model-value="modelValue"
    :title="title"
    :close-label="t('common_close')"
    wide
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="rte-formula-editor">
      <div class="rte-formula-editor__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="rte-formula-editor__tab"
          :class="{ 'rte-formula-editor__tab--active': type === 'math' }"
          :aria-selected="type === 'math'"
          @click="type = 'math'"
        >
          <RteIcon name="formulaMath" :size="16" />
          {{ t('formula_tab_math') }}
        </button>
        <button
          type="button"
          role="tab"
          class="rte-formula-editor__tab"
          :class="{ 'rte-formula-editor__tab--active': type === 'chem' }"
          :aria-selected="type === 'chem'"
          @click="type = 'chem'"
        >
          <RteIcon name="formulaChem" :size="16" />
          {{ t('formula_tab_chem') }}
        </button>
      </div>

      <p v-if="loading" class="rte-formula-editor__status">{{ t('formula_loading') }}</p>
      <p v-else-if="failed" class="rte-formula-editor__status rte-field__error">
        {{ t('formula_invalid') }}
      </p>

      <div class="rte-formula-editor__input">
        <div ref="host" class="rte-formula-editor__host" />
        <p class="rte-formula-editor__hint">{{ t('formula_input_hint') }}</p>
      </div>

      <section class="rte-formula-editor__templates">
        <h3 class="rte-formula-editor__section-title">{{ t('formula_templates') }}</h3>

        <div class="rte-formula-editor__categories" role="tablist">
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            role="tab"
            class="rte-formula-editor__category"
            :class="{ 'rte-formula-editor__category--active': activeCategory === category.id }"
            :aria-selected="activeCategory === category.id"
            @click="activeCategory = category.id"
          >
            {{ t(category.labelKey) }}
          </button>
        </div>

        <div class="rte-formula-editor__gallery">
          <button
            v-for="template in categories.find((c) => c.id === activeCategory)?.templates ?? []"
            :key="template.id"
            type="button"
            class="rte-formula-editor__template"
            @click="applyTemplate(template)"
          >
            <span
              v-if="templatePreviews[template.id]"
              class="rte-formula-editor__template-preview"
              v-html="templatePreviews[template.id]"
            />
            <span v-else class="rte-formula-editor__template-preview">…</span>
          </button>
        </div>
      </section>

      <section class="rte-formula-editor__preview">
        <h3 class="rte-formula-editor__section-title">{{ t('formula_preview') }}</h3>
        <div class="rte-formula-editor__preview-box">
          <span v-if="previewSvg" v-html="previewSvg" />
          <span v-else class="rte-formula-editor__empty">{{ t('formula_empty') }}</span>
        </div>
      </section>
    </div>

    <template #footer>
      <button
        v-if="isEditing"
        type="button"
        class="rte-button rte-button--danger"
        @click="remove"
      >
        {{ t('formula_remove') }}
      </button>
      <span class="rte-modal__spacer" />
      <button type="button" class="rte-button" @click="emit('update:modelValue', false)">
        {{ t('formula_cancel') }}
      </button>
      <button
        type="button"
        class="rte-button rte-button--primary"
        :disabled="!latex.trim()"
        @click="save"
      >
        {{ isEditing ? t('formula_save') : t('formula_insert') }}
      </button>
    </template>
  </RteModal>
</template>
