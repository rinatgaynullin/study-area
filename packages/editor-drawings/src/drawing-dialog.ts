import {
  createDisposer,
  createModal,
  el,
  on,
  sanitizeSvg,
  type DialogComponent,
  type EditorUiContext,
  type Modal,
  type Translate,
  type Unsubscribe,
} from '@rich-editor/core';
import { physicsEditorFactory } from './builders/physics-editor';
import { planimetryEditorFactory } from './builders/planimetry-editor';
import { plotsEditorFactory } from './builders/plots-editor';
import { stereometryEditorFactory } from './builders/stereometry-editor';
import type { RawScene, SceneEditor, SceneEditorFactory } from './builders/types';
import { readScene, renderDrawingPreview } from './paint-drawing';
import { parseSceneJson, stringifyScene } from './scene/json';
import type { DrawingKind, GeometryScene, PhysicsScene } from './scene/types';
import { DRAWING_TEMPLATES } from './templates';
import { geometryToTikz, physicsToTikz } from './tikz';
import type { DrawingPayload } from './types';

export interface DrawingDialogOptions {
  onSave(payload: DrawingPayload): void;
  onRemove(pos: number): void;
  /** Конструкторы по вкладкам; по умолчанию — все встроенные. */
  editors?: SceneEditorFactory[];
  /** Сканы работы ученика рядом с полотном — чтобы перерисовывать «с фото». */
  scans?: () => string[];
}

/** Встроенные конструкторы: вкладки диалога по видам сцен. */
export const DEFAULT_SCENE_EDITORS: SceneEditorFactory[] = [
  planimetryEditorFactory,
  stereometryEditorFactory,
  plotsEditorFactory,
  physicsEditorFactory,
];

/** Счётчик для уникальных id: подсказки, группы радио и вкладки привязаны к полям. */
let drawingDialogCount = 0;

const KINDS: DrawingKind[] = ['geometry', 'physics'];

/** Вкладка JSON всегда последняя: это запасной путь, когда конструктора под сцену нет. */
const JSON_TAB = 'json';

/**
 * Диалог чертежа: вкладки конструкторов и JSON, шаблоны, живое превью и TikZ.
 *
 * Конструктор одной вкладки создаётся при первом открытии вкладки и живёт
 * до уничтожения диалога; сцена переходит между вкладками через JSON. Вид,
 * открытая сцена, активная вкладка, статус и кнопки — общее состояние
 * обработчиков, поэтому класс.
 */
class DrawingDialogController implements DialogComponent<DrawingPayload | null> {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private payload: DrawingPayload | null = null;

  private kind: DrawingKind = 'geometry';

  /** Разобранная сцена текущего JSON; `null` — JSON нечитаем. */
  private scene: GeometryScene | PhysicsScene | null = null;

  private readonly factories: SceneEditorFactory[];

  /** Созданные конструкторы по id вкладки. */
  private readonly editors = new Map<string, SceneEditor>();

  private readonly editorReleases = new Map<string, Unsubscribe>();

  private activeTab = JSON_TAB;

  private readonly modal: Modal;

  private readonly tabList: HTMLElement;

  private readonly editorHost: HTMLElement;

  private readonly jsonPanel: HTMLElement;

  private readonly kindInputs: HTMLInputElement[];

  private readonly kindRow: HTMLElement;

  private readonly codeInput: HTMLTextAreaElement;

  private readonly tikzOutput: HTMLTextAreaElement;

  private readonly templatesRow: HTMLElement;

  private readonly preview: HTMLElement;

  private readonly status: HTMLElement;

  private readonly scansPanel: HTMLElement;

  private readonly removeButton: HTMLButtonElement;

  private readonly saveButton: HTMLButtonElement;

  private readonly idPrefix: string;

  constructor(
    private readonly context: EditorUiContext,
    private readonly options: DrawingDialogOptions,
  ) {
    const { t } = context;

    this.t = t;
    this.factories = options.editors ?? DEFAULT_SCENE_EDITORS;

    drawingDialogCount += 1;
    this.idPrefix = `rte-drawing-${drawingDialogCount}`;

    const hintId = `${this.idPrefix}-hint`;

    this.kindInputs = KINDS.map((kind) =>
      el('input', { attrs: { type: 'radio', name: `${this.idPrefix}-kind`, value: kind } }),
    );

    this.kindRow = el('div', {
      class: 'rte-drawing-dialog__kinds',
      attrs: { role: 'radiogroup' },
      children: this.kindInputs.map((input, index) =>
        el('label', { children: [input, el('span', { text: t(`drawings_insert_${KINDS[index]}`) })] }),
      ),
    });

    this.tabList = el('div', { class: 'rte-drawing-dialog__tabs', attrs: { role: 'tablist' } });
    this.editorHost = el('div', { class: 'rte-drawing-dialog__editor' });

    this.codeInput = el('textarea', {
      class: 'rte-input rte-drawing-dialog__code',
      attrs: {
        rows: 6,
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        'aria-describedby': hintId,
      },
    });

    this.jsonPanel = el('label', {
      class: 'rte-field rte-drawing-dialog__json',
      children: [
        el('span', { class: 'rte-field__label', text: t('drawings_json_label') }),
        this.codeInput,
        el('p', { class: 'rte-drawing-dialog__hint', text: t('drawings_json_hint'), attrs: { id: hintId } }),
      ],
    });

    this.templatesRow = el('div', {
      class: 'rte-drawing-dialog__templates',
      attrs: { role: 'group', 'aria-label': t('drawings_templates') },
    });

    this.status = el('p', { class: 'rte-drawing-dialog__status', attrs: { role: 'status' } });
    this.preview = el('div', { class: 'rte-drawing-dialog__preview', attrs: { 'aria-hidden': 'true' } });
    this.scansPanel = el('div', { class: 'rte-drawing-dialog__scans' });

    this.tikzOutput = el('textarea', {
      class: 'rte-input rte-drawing-dialog__code rte-drawing-dialog__code--tikz',
      attrs: { rows: 4, readonly: true, spellcheck: 'false' },
    });

    const tikzField = el('label', {
      class: 'rte-field',
      children: [
        el('span', { class: 'rte-field__label', text: t('drawings_tikz_label') }),
        this.tikzOutput,
        el('p', { class: 'rte-drawing-dialog__hint', text: t('drawings_tikz_hint') }),
      ],
    });

    this.modal = createModal({ title: t('drawings_title_insert_geometry'), closeLabel: t('common_close'), wide: true });

    this.modal.body.appendChild(
      el('div', {
        class: 'rte-drawing-dialog',
        children: [
          this.kindRow,
          this.tabList,
          el('div', {
            class: 'rte-drawing-dialog__workspace',
            children: [el('div', { children: [this.editorHost, this.jsonPanel] }), this.scansPanel],
          }),
          el('section', {
            children: [
              el('h3', { class: 'rte-drawing-dialog__section-title', text: t('drawings_templates') }),
              this.templatesRow,
            ],
          }),
          el('section', {
            children: [
              el('h3', { class: 'rte-drawing-dialog__section-title', text: t('drawings_preview') }),
              this.preview,
              this.status,
            ],
          }),
          tikzField,
        ],
      }),
    );

    this.removeButton = el('button', {
      class: 'rte-button rte-button--danger',
      attrs: { type: 'button' },
      text: t('drawings_remove'),
    });

    const cancelButton = el('button', { class: 'rte-button', attrs: { type: 'button' }, text: t('common_cancel') });

    this.saveButton = el('button', {
      class: 'rte-button rte-button--primary',
      attrs: { type: 'button' },
      text: t('drawings_apply_insert'),
    });

    this.modal.footer.append(this.removeButton, el('span', { class: 'rte-modal__spacer' }), cancelButton, this.saveButton);

    this.element = this.modal.element;

    this.disposer.add(on(this.kindRow, 'change', this.onKindChange));
    this.disposer.add(on(this.tabList, 'click', this.onTabClick));
    this.disposer.add(on(this.tabList, 'keydown', this.onTabKeydown));
    this.disposer.add(on(this.codeInput, 'input', this.onCodeInput));
    this.disposer.add(on(this.templatesRow, 'click', this.onTemplatesClick));
    this.disposer.add(on(cancelButton, 'click', this.onCancelClick));
    this.disposer.add(on(this.removeButton, 'click', this.onRemoveClick));
    this.disposer.add(on(this.saveButton, 'click', this.onSaveClick));
  }

  get isVisible(): boolean {
    return this.modal.isVisible;
  }

  /** Открывает диалог: с чертежом из документа — на правку, с `null` — на вставку. */
  open(next: DrawingPayload | null): void {
    const editing = next !== null && next.pos !== null;

    this.payload = next;
    this.kind = next?.kind ?? 'geometry';
    this.saveButton.textContent = this.t(editing ? 'drawings_apply_save' : 'drawings_apply_insert');
    this.removeButton.hidden = !editing;
    // Вид существующего чертежа не меняют: это другой узел.
    this.kindRow.hidden = editing;
    this.kindInputs.forEach((input) => {
      input.checked = input.value === this.kind;
    });
    this.codeInput.value = next?.data ?? '';
    this.renderScans();
    this.applyKind();
    this.modal.open();
    this.editors.get(this.activeTab)?.focus();
  }

  close(): void {
    this.modal.close();
  }

  destroy(): void {
    this.disposer.dispose();
    this.editorReleases.forEach((release) => release());
    this.editors.forEach((editor) => editor.destroy());
    this.editors.clear();
    this.modal.destroy();
  }

  // ------------------------------------------------------------- вкладки

  /** Вкладки под текущий вид: конструкторы этого вида и JSON. */
  private tabsFor(kind: DrawingKind): Array<{ id: string; label: string }> {
    return [
      ...this.factories.filter((factory) => factory.kind === kind).map((factory) => ({ id: factory.id, label: this.t(factory.labelKey) })),
      { id: JSON_TAB, label: this.t('drawings_tab_json') },
    ];
  }

  private renderTabs(): void {
    const tabs = this.tabsFor(this.kind);

    this.tabList.replaceChildren(
      ...tabs.map((tab) =>
        el('button', {
          class: `rte-drawing-dialog__tab${tab.id === this.activeTab ? ' rte-drawing-dialog__tab--active' : ''}`,
          attrs: {
            type: 'button',
            role: 'tab',
            id: `${this.idPrefix}-tab-${tab.id}`,
            'data-tab': tab.id,
            'aria-selected': String(tab.id === this.activeTab),
            tabindex: tab.id === this.activeTab ? 0 : -1,
          },
          text: tab.label,
        }),
      ),
    );
    // Одна вкладка — одна и есть JSON: список не нужен.
    this.tabList.hidden = tabs.length <= 1;
  }

  /** Вид выбран: заголовок, шаблоны, первая подходящая вкладка и превью под него. */
  private applyKind(): void {
    const editing = this.payload !== null && this.payload.pos !== null;

    this.modal.setTitle(this.t(`drawings_title_${editing ? 'edit' : 'insert'}_${this.kind}`));
    this.renderTemplates();

    const raw = parseSceneJson(this.codeInput.value) ?? {};
    const suitable = this.factories.find(
      (factory) => factory.kind === this.kind && (this.codeInput.value.trim() === '' || factory.accepts(raw as RawScene)),
    );

    this.selectTab(suitable ? suitable.id : JSON_TAB, false);
  }

  /** Переключает вкладку; сцена переезжает через JSON, если её редактировали. */
  private selectTab(id: string, fromEditor: boolean): void {
    if (fromEditor && this.activeTab !== JSON_TAB) this.syncCodeFromEditor();

    this.activeTab = id;
    this.renderTabs();

    const editor = id === JSON_TAB ? null : this.ensureEditor(id);

    this.jsonPanel.hidden = editor !== null;
    this.editorHost.replaceChildren(...(editor ? [editor.element] : []));

    if (editor) {
      editor.load((parseSceneJson(this.codeInput.value) as RawScene | null) ?? {});
      this.renderPreviewFrom(editor.getScene());
    } else {
      this.renderPreview();
    }
  }

  private ensureEditor(id: string): SceneEditor | null {
    const existing = this.editors.get(id);

    if (existing) return existing;

    const factory = this.factories.find((candidate) => candidate.id === id);

    if (!factory) return null;

    const editor = factory.create({ t: this.t, scans: this.options.scans?.() });

    this.editors.set(id, editor);
    this.editorReleases.set(
      id,
      editor.onChange(() => {
        if (this.activeTab === id) this.renderPreviewFrom(editor.getScene());
      }),
    );

    return editor;
  }

  private syncCodeFromEditor(): void {
    const editor = this.editors.get(this.activeTab);

    if (editor) this.codeInput.value = JSON.stringify(editor.getScene(), null, 2);
  }

  private readonly onTabClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');

    if (button && button.dataset.tab && button.dataset.tab !== this.activeTab) {
      this.selectTab(button.dataset.tab, true);
      this.tabList.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }
  };

  /** Стрелки ходят по вкладкам (паттерн ARIA tabs). */
  private readonly onTabKeydown = (event: KeyboardEvent): void => {
    const tabs = [...this.tabList.querySelectorAll<HTMLButtonElement>('button[data-tab]')];
    const current = tabs.findIndex((tab) => tab === document.activeElement);

    if (current === -1) return;

    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

    if (step === 0) return;

    event.preventDefault();

    const next = tabs[(current + step + tabs.length) % tabs.length];

    if (next?.dataset.tab) {
      this.selectTab(next.dataset.tab, true);
      this.tabList.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }
  };

  // ------------------------------------------------------------- шаблоны

  private renderTemplates(): void {
    this.templatesRow.replaceChildren(
      ...DRAWING_TEMPLATES.filter((template) => template.kind === this.kind).map((template) =>
        el('button', {
          class: 'rte-drawing-dialog__template',
          attrs: { type: 'button', 'data-template': template.id },
          text: this.t(template.labelKey),
        }),
      ),
    );
  }

  private renderScans(): void {
    const scans = this.options.scans?.() ?? [];

    this.scansPanel.hidden = scans.length === 0;
    this.scansPanel.replaceChildren(
      ...scans.map((src) => {
        const image = el('img', { class: 'rte-drawing-dialog__scan', attrs: { src, alt: '' } });

        return image;
      }),
    );
  }

  // ------------------------------------------------------------- превью

  /** Превью и TikZ по текущему JSON; пустая и нечитаемая сцена объявляются в статусе. */
  private renderPreview(): void {
    const data = this.codeInput.value.trim();

    this.scene = data ? readScene(this.kind, data) : null;
    this.paintPreview(data === '' ? 'empty' : this.scene === null ? 'invalid' : 'ok');
  }

  /** Превью по сцене конструктора: она всегда читаема. */
  private renderPreviewFrom(raw: RawScene): void {
    this.scene = readScene(this.kind, stringifyScene(raw));
    this.paintPreview(this.scene ? 'ok' : 'invalid');
  }

  private paintPreview(state: 'empty' | 'invalid' | 'ok'): void {
    const svg = this.scene ? renderDrawingPreview(this.kind, this.scene) : null;

    this.preview.innerHTML = svg ? sanitizeSvg(svg) : '';
    this.preview.hidden = svg === null;
    this.tikzOutput.value = this.scene ? this.buildTikz(this.scene) : '';

    if (state === 'empty') this.setStatus(this.t('drawings_empty'), false);
    else if (state === 'invalid') this.setStatus(this.t('drawings_invalid'), true);
    else if (svg === null) this.setStatus(this.t('drawings_placeholder'), false);
    else this.setStatus('', false);

    // Нечитаемый JSON всё же можно сохранить: узел покажет плейсхолдер, данные
    // не потеряются. А вот пустую сцену конструктора вставлять незачем.
    this.saveButton.disabled = state === 'empty' || (this.activeTab !== JSON_TAB && svg === null);
  }

  private buildTikz(scene: GeometryScene | PhysicsScene): string {
    return scene.type === 'physics' ? physicsToTikz(scene) : geometryToTikz(scene);
  }

  private setStatus(text: string, isError: boolean): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
    this.status.classList.toggle('rte-drawing-dialog__status--error', isError);
  }

  // ------------------------------------------------------------- события

  private readonly onKindChange = (): void => {
    const checked = this.kindInputs.find((input) => input.checked);

    if (!checked) return;

    if (this.activeTab !== JSON_TAB) this.syncCodeFromEditor();

    this.kind = checked.value as DrawingKind;
    this.applyKind();
  };

  private readonly onCodeInput = (): void => {
    this.renderPreview();
  };

  private readonly onTemplatesClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-template]');
    const template = DRAWING_TEMPLATES.find((candidate) => candidate.id === button?.dataset.template);

    if (!template) return;

    this.codeInput.value = JSON.stringify(template.scene, null, 2);

    const editor = this.editors.get(this.activeTab);

    if (editor && this.activeTab !== JSON_TAB) {
      const factory = this.factories.find((candidate) => candidate.id === this.activeTab);

      // Шаблон другого вида сцены открывает подходящую вкладку.
      if (factory && !factory.accepts(template.scene)) {
        this.applyKind();

        return;
      }

      editor.load(template.scene);
      this.renderPreviewFrom(editor.getScene());
      editor.focus();

      return;
    }

    this.renderPreview();
    this.codeInput.focus();
  };

  private readonly onCancelClick = (): void => {
    this.close();
  };

  private readonly onRemoveClick = (): void => {
    if (this.payload?.pos !== null && this.payload?.pos !== undefined) this.options.onRemove(this.payload.pos);

    this.close();
  };

  private readonly onSaveClick = (): void => {
    const editor = this.activeTab === JSON_TAB ? null : this.editors.get(this.activeTab);
    const data = editor ? stringifyScene(editor.getScene()) : this.codeInput.value.trim();

    if (!data) return;

    // Разобранную сцену сохраняем компактно и без правок; нечитаемую — как есть.
    const raw = editor ? null : parseSceneJson(data);

    this.options.onSave({
      kind: this.kind,
      data: raw === null ? data : stringifyScene(raw),
      tikz: this.scene ? this.buildTikz(this.scene) : (this.payload?.tikz ?? ''),
      pos: this.payload?.pos ?? null,
    });
    this.close();
  };
}

export const createDrawingDialog = (
  context: EditorUiContext,
  options: DrawingDialogOptions,
): DialogComponent<DrawingPayload | null> => new DrawingDialogController(context, options);
