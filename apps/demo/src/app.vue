<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue';
import {
  RichContent,
  RichEditor,
  latexToMathML,
  type Messages,
  type RichEditorError,
  type UploadAdapter,
  type UploadResult,
} from '@rich-editor/vue';
import enMessages from './locales/en.json';
import { HTML_SAMPLES, type HtmlSample } from './samples';

type UploadMode = 'local' | 'mock-server';

const html = ref('');
const ready = ref(false);
const locale = ref<'ru' | 'en'>('ru');
const uploadMode = ref<UploadMode>('local');
const editable = ref(true);
const mobilePreview = ref(false);
const isLegacyEnabled = ref(false);
const toolbarPreset = ref<'full' | 'standard' | 'minimal'>('full');
const outputTab = ref<'preview' | 'source' | 'input'>('preview');
const log = ref<string[]>([]);

const draftHtml = ref('');
const draftHint = ref('');
const appliedReport = ref('');

const editorRef = shallowRef<InstanceType<typeof RichEditor> | null>(null);

const messages = computed<Record<string, Messages>>(() => ({
  en: enMessages as Messages,
}));

const limits = {
  maxAudioDurationSec: 120,
  maxAudioSizeBytes: 8 * 1024 * 1024,
  maxImageSizeBytes: 5 * 1024 * 1024,
  maxFileSizeBytes: 2 * 1024 * 1024,
};

/**
 * Stand-in for a host application's storage API: it waits like a real upload
 * and hands back an https URL, exactly what the adapter contract expects.
 */
function createMockAdapter(kind: string): UploadAdapter {
  return async (file): Promise<UploadResult> => {
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 600));

    const url = `https://cdn.example.com/${kind}/${Date.now()}-${encodeURIComponent(file.name)}`;
    log.value.unshift(
      `POST /api/${kind} · ${file.name} · ${(file.size / 1024).toFixed(1)} KB · ` +
        `${Math.round(performance.now() - started)} ms → ${url}`,
    );
    return { url, name: file.name, mime: file.type, size: file.size };
  };
}

const adapters = computed(() =>
  uploadMode.value === 'mock-server'
    ? {
        uploadImage: createMockAdapter('images'),
        uploadAudio: createMockAdapter('audio'),
        uploadFile: createMockAdapter('files'),
      }
    : {},
);

function onError(error: RichEditorError): void {
  log.value.unshift(`⚠ ${error.code}: ${error.message}`);
}

async function buildSampleContent(): Promise<string> {
  const [pythagoras, integral, water, decay] = await Promise.all([
    latexToMathML('a^2+b^2=c^2', 'math'),
    latexToMathML('\\int_{0}^{\\infty}e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}', 'math'),
    latexToMathML('2\\mathrm{H}_2+\\mathrm{O}_2\\rightarrow 2\\mathrm{H}_2\\mathrm{O}', 'chem'),
    latexToMathML(
      '{\\,}^{238}_{92}\\mathrm{U}\\rightarrow{\\,}^{234}_{90}\\mathrm{Th}+{\\,}^{4}_{2}\\mathrm{He}',
      'chem',
    ),
  ]);

  const formula = (mathml: string, type: string) =>
    `<span data-formula="true" data-formula-type="${type}" data-mathml="${mathml.replace(/"/g, '&quot;')}" contenteditable="false"></span>`;

  return `
    <h2>Редактор формул и медиа</h2>
    <p>Теорема Пифагора: ${formula(pythagoras, 'math')} — кликните по формуле, чтобы открыть редактор.</p>
    <p>Интеграл Гаусса: ${formula(integral, 'math')}</p>
    <h3>Химия</h3>
    <p>Горение водорода: ${formula(water, 'chem')}</p>
    <p>Альфа-распад: ${formula(decay, 'chem')}</p>
    <h3>Форматирование</h3>
    <p><strong>жирный</strong>, <em>курсив</em>, <u>подчёркнутый</u>, <s>зачёркнутый</s>,
      <code>inline code</code>, H<sub>2</sub>O, x<sup>2</sup>,
      <span style="color: #d32f2f">цветной</span>, <mark data-color="#fff59d" style="background-color: #fff59d">выделенный</mark>.</p>
    <ul><li><p>маркированный список</p></li><li><p>второй пункт</p></li></ul>
    <blockquote><p>Цитата с <a href="https://example.com" rel="noopener noreferrer">ссылкой</a>.</p></blockquote>
    <table><tbody>
      <tr><th><p>Величина</p></th><th><p>Значение</p></th></tr>
      <tr><td><p>Ускорение</p></td><td><p>9.81</p></td></tr>
    </tbody></table>
  `;
}

onMounted(async () => {
  html.value = await buildSampleContent();
  ready.value = true;
});

/**
 * `setHTML` deliberately does not emit an update, so the model still holds the
 * raw sample string. Once MathJax has rendered, pull the editor's own export so
 * the preview below shows self-contained HTML with the formula SVGs inlined.
 */
async function onReady(core: { whenFormulasReady(): Promise<void>; getHTML(): string }): Promise<void> {
  await core.whenFormulasReady();
  html.value = core.getHTML();
}

/**
 * Feeds arbitrary HTML through the editor's import path, then reads back what
 * the editor actually kept — which is the interesting part, since sanitization
 * and schema parsing both run on the way in.
 */
async function applyDraft(): Promise<void> {
  const input = draftHtml.value;
  html.value = input;

  await nextTick();
  const editor = editorRef.value;
  if (!editor) return;

  await editor.whenFormulasReady();
  const kept = editor.getHTML();
  html.value = kept;

  appliedReport.value =
    `На входе ${input.length} символов → редактор сохранил ${kept.length}. ` +
    'Что именно осталось — на вкладке «Исходник».';
}

function useSample(sample: HtmlSample): void {
  draftHtml.value = sample.html;
  draftHint.value = sample.hint;
  appliedReport.value = '';
}

function takeCurrentHtml(): void {
  draftHtml.value = html.value;
  draftHint.value = '';
  appliedReport.value = '';
}

function clearContent(): void {
  html.value = '<p></p>';
}

async function reloadSample(): Promise<void> {
  html.value = await buildSampleContent();
}
</script>

<template>
  <main class="demo">
    <header class="demo__header">
      <h1>@rich-editor/vue</h1>
      <p class="demo__subtitle">
        Rich text editor на Vue 3 с формулами (MathML + MathJax), изображениями,
        голосовыми сообщениями и i18n.
      </p>
    </header>

    <section class="demo__controls">
      <label>
        Локаль
        <select v-model="locale">
          <option value="ru">Русский (по умолчанию)</option>
          <option value="en">English (messages.json)</option>
        </select>
      </label>

      <label>
        Toolbar
        <select v-model="toolbarPreset">
          <option value="full">full</option>
          <option value="standard">standard</option>
          <option value="minimal">minimal</option>
        </select>
      </label>

      <label>
        Загрузка файлов
        <select v-model="uploadMode">
          <option value="local">Локально (blob URL)</option>
          <option value="mock-server">Mock upload adapter (https URL)</option>
        </select>
      </label>

      <label class="demo__check">
        <input v-model="editable" type="checkbox" />
        Редактируемый
      </label>

      <label class="demo__check">
        <input v-model="mobilePreview" type="checkbox" />
        Мобильный viewport (390px)
      </label>

      <label class="demo__check">
        <input v-model="isLegacyEnabled" type="checkbox" />
        Legacy-контент (Froala)
      </label>

      <button type="button" @click="reloadSample">Пример</button>
      <button type="button" @click="clearContent">Очистить</button>
    </section>

    <p v-if="uploadMode === 'mock-server'" class="demo__note">
      Mock-адаптер возвращает несуществующий <code>https://cdn.example.com/…</code>,
      как это делал бы реальный бэкенд. Сами картинки не загрузятся — в документ
      попадает именно та ссылка, которую вернул адаптер (см. журнал ниже).
    </p>

    <section class="demo__editor" :class="{ 'demo__editor--mobile': mobilePreview }">
      <RichEditor
        v-if="ready"
        ref="editorRef"
        :key="isLegacyEnabled ? 'legacy' : 'default'"
        v-model="html"
        :locale="locale"
        :messages="messages"
        :limits="limits"
        :editable="editable"
        :legacy="isLegacyEnabled"
        :toolbar="toolbarPreset"
        :upload-image="adapters.uploadImage"
        :upload-audio="adapters.uploadAudio"
        :upload-file="adapters.uploadFile"
        min-height="320px"
        @error="onError"
        @ready="onReady"
      />
    </section>

    <section class="demo__output">
      <div class="demo__tabs">
        <button
          type="button"
          :class="{ 'demo__tab--active': outputTab === 'preview' }"
          @click="outputTab = 'preview'"
        >
          Экспортированный HTML (рендер)
        </button>
        <button
          type="button"
          :class="{ 'demo__tab--active': outputTab === 'source' }"
          @click="outputTab = 'source'"
        >
          Исходник
        </button>
        <button
          type="button"
          :class="{ 'demo__tab--active': outputTab === 'input' }"
          @click="outputTab = 'input'"
        >
          Вставить HTML
        </button>
      </div>

      <!-- Read-only viewer: no toolbar, no ProseMirror, no MathLive. Formulas
           exported by the editor already carry their SVG, so nothing extra
           loads; MathML-only formulas are rendered on the fly. -->
      <RichContent
        v-if="outputTab === 'preview'"
        class="demo__preview"
        :html="html"
        :legacy="isLegacyEnabled"
      />
      <pre v-else-if="outputTab === 'source'" class="demo__source">{{ html }}</pre>

      <div v-else class="demo__input">
        <p class="demo__input-lead">
          Вставьте произвольный HTML и примените — он пройдёт через тот же путь
          импорта, что и <code>setHTML()</code>: санитизация, затем разбор по схеме
          редактора.
        </p>

        <div class="demo__samples">
          <button
            v-for="sample in HTML_SAMPLES"
            :key="sample.id"
            type="button"
            @click="useSample(sample)"
          >
            {{ sample.label }}
          </button>
        </div>

        <p v-if="draftHint" class="demo__input-hint">{{ draftHint }}</p>

        <textarea
          v-model="draftHtml"
          class="demo__textarea"
          spellcheck="false"
          placeholder="<p>Вставьте сюда HTML…</p>"
        />

        <div class="demo__input-actions">
          <button type="button" class="demo__primary" @click="applyDraft">
            Применить в редактор
          </button>
          <button type="button" @click="takeCurrentHtml">Подставить текущий</button>
          <button type="button" @click="draftHtml = ''">Очистить поле</button>
        </div>

        <p v-if="appliedReport" class="demo__input-report">{{ appliedReport }}</p>
      </div>
    </section>

    <section v-if="log.length" class="demo__log">
      <h2>Журнал загрузок</h2>
      <ul>
        <li v-for="(entry, index) in log" :key="index">{{ entry }}</li>
      </ul>
    </section>
  </main>
</template>
