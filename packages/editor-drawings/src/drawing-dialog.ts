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
import { hasDrawableContent } from './scene/normalize';
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
  /**
   * Вкладка JSON, образцы сцен, предпросмотр и поле TikZ. По умолчанию их нет:
   * школьнику достаточно конструкторов, а это инструменты для отладки.
   */
  json?: boolean;
}

/** Встроенные конструкторы: вкладки диалога по видам сцен. */
export const DEFAULT_SCENE_EDITORS: SceneEditorFactory[] = [
  planimetryEditorFactory,
  stereometryEditorFactory,
  plotsEditorFactory,
  physicsEditorFactory,
];

/** Счётчик для уникальных id: подсказки и вкладки привязаны к полям. */
let drawingDialogCount = 0;

/** Вкладка JSON всегда последняя: это запасной путь, когда конструктора под сцену нет. */
const JSON_TAB = 'json';

/**
 * Диалог чертежа: вкладки конструкторов, а с опцией `json` — ещё вкладка
 * JSON, шаблоны, живое превью и TikZ в сворачиваемом блоке.
 *
 * Вид нового чертежа (геометрия или физика) задаёт выбранная вкладка; у
 * существующего чертежа — только вкладки его вида. Конструктор одной вкладки
 * создаётся при первом открытии вкладки и живёт до уничтожения диалога;
 * сцена переходит между вкладками через JSON. Вид, открытая сцена, активная
 * вкладка, статус и кнопки — общее состояние обработчиков, поэтому класс.
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

  private readonly root: HTMLElement;

  /** Строка над рабочей областью; сейчас в ней только вкладки. */
  private readonly head: HTMLElement;

  private readonly tabList: HTMLElement;

  private readonly editorHost: HTMLElement;

  private readonly jsonPanel: HTMLElement;

  /** Сворачиваемый блок «Шаблоны, предпросмотр и код TikZ»; без опции `json` его нет. */
  private readonly more: HTMLDetailsElement | null;

  /** Поле JSON есть всегда: через него сцена переходит между вкладками. */
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

    this.modal = createModal({ title: t('drawings_title_insert_geometry'), closeLabel: t('common_close'), fill: true });

    // Служебное — образцы, предпросмотр, TikZ — под одной свёрнутой строкой,
    // чтобы полотно занимало окно; статус остаётся снаружи, ошибку видно всегда.
    this.more = options.json
      ? el('details', {
          class: 'rte-drawing-dialog__more',
          children: [
            el('summary', { class: 'rte-drawing-dialog__more-title', text: t('drawings_more') }),
            el('section', {
              children: [
                el('h3', { class: 'rte-drawing-dialog__section-title', text: t('drawings_templates') }),
                this.templatesRow,
              ],
            }),
            el('section', {
              children: [el('h3', { class: 'rte-drawing-dialog__section-title', text: t('drawings_preview') }), this.preview],
            }),
            tikzField,
          ],
        })
      : null;

    this.head = el('div', { class: 'rte-drawing-dialog__head', children: [this.tabList] });

    this.root = el('div', {
      class: 'rte-drawing-dialog',
      children: [
        this.head,
        el('div', {
          class: 'rte-drawing-dialog__workspace',
          children: [
            el('div', {
              class: 'rte-drawing-dialog__main',
              children: options.json ? [this.editorHost, this.jsonPanel] : [this.editorHost],
            }),
            this.scansPanel,
          ],
        }),
        this.status,
        ...(this.more ? [this.more] : []),
      ],
    });

    this.modal.body.appendChild(this.root);

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
    this.payload = next;
    this.kind = next?.kind ?? 'geometry';
    this.saveButton.textContent = this.t(this.isEditing ? 'drawings_apply_save' : 'drawings_apply_insert');
    this.removeButton.hidden = !this.isEditing;
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

  private get isEditing(): boolean {
    return this.payload !== null && this.payload.pos !== null;
  }

  /**
   * Вкладки диалога: у нового чертежа — все конструкторы, вид задаёт вкладка;
   * у существующего — только его вида, потому что другой вид — другой узел.
   * JSON — последней и только с опцией `json`.
   */
  private tabs(): Array<{ id: string; label: string }> {
    const factories = this.isEditing ? this.factories.filter((factory) => factory.kind === this.kind) : this.factories;

    return [
      ...factories.map((factory) => ({ id: factory.id, label: this.t(factory.labelKey) })),
      ...(this.options.json ? [{ id: JSON_TAB, label: this.t('drawings_tab_json') }] : []),
    ];
  }

  private renderTabs(): void {
    const tabs = this.tabs();

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
    // Одна вкладка — выбирать не из чего: список не нужен, а пустая строка
    // не должна отнимать высоту у полотна.
    this.tabList.hidden = tabs.length <= 1;
    this.head.hidden = this.tabList.hidden;
  }

  /** Вид чертежа: заголовок и шаблоны следуют за ним. */
  private setKind(kind: DrawingKind): void {
    this.kind = kind;
    this.modal.setTitle(this.t(`drawings_title_${this.isEditing ? 'edit' : 'insert'}_${kind}`));
    this.renderTemplates();
  }

  /** Сцена открыта: первая подходящая вкладка её вида и превью под неё. */
  private applyKind(): void {
    this.setKind(this.kind);

    const data = this.codeInput.value.trim();
    const raw = parseSceneJson(data);
    const suitable = this.factories.find(
      (factory) => factory.kind === this.kind && (data === '' || factory.accepts((raw ?? {}) as RawScene)),
    );
    const broken = data !== '' && (raw === null || suitable === undefined);

    if (this.options.json) {
      this.selectTab(suitable ? suitable.id : JSON_TAB, false);

      return;
    }

    // Без вкладки JSON нечитаемую сцену не поправить: открываем конструктор
    // вида с чистым полотном и честно говорим, что чертёж придётся нарисовать
    // заново. «Вставить» заменит узел новым чертежом.
    const fallback = this.factories.find((factory) => factory.kind === this.kind) ?? this.factories[0];
    const target = broken ? fallback : (suitable ?? fallback);

    if (broken) this.codeInput.value = '';

    if (target) this.selectTab(target.id, false);

    if (broken) this.setStatus(this.t('drawings_unreadable'), true);
  }

  /** Переключает вкладку; сцена переезжает через JSON, если её редактировали. */
  private selectTab(id: string, fromEditor: boolean): void {
    if (fromEditor && this.activeTab !== JSON_TAB) this.syncCodeFromEditor();

    this.activeTab = id;

    const factory = this.factories.find((candidate) => candidate.id === id);

    // Вкладка нового чертежа задаёт его вид; JSON вид не меняет.
    if (factory && factory.kind !== this.kind) this.setKind(factory.kind);

    this.renderTabs();

    const editor = id === JSON_TAB ? null : this.ensureEditor(id);

    this.jsonPanel.hidden = editor !== null;
    this.editorHost.replaceChildren(...(editor ? [editor.element] : []));
    this.root.classList.toggle('rte-drawing-dialog--json', editor === null);
    // Служебный блок раскрыт там, где он нужен, — на вкладке JSON.
    if (this.more) this.more.open = editor === null;

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
    if (!this.options.json) return;

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
    const drawable = this.scene !== null && hasDrawableContent(this.scene);

    // Предпросмотр и TikZ на экране — только с опцией `json`; TikZ для узла
    // всё равно считается при вставке.
    if (this.options.json) {
      const svg = this.scene ? renderDrawingPreview(this.kind, this.scene) : null;

      this.preview.innerHTML = svg ? sanitizeSvg(svg) : '';
      this.preview.hidden = svg === null;
      this.tikzOutput.value = this.scene ? this.buildTikz(this.scene) : '';
    }

    // Пустое полотно конструктора говорит само за себя: строка статуса
    // отняла бы высоту у полотна. О пустом JSON сообщаем — его не видно.
    if (state === 'empty') this.setStatus(this.t('drawings_empty'), false);
    else if (state === 'invalid') this.setStatus(this.t('drawings_invalid'), true);
    else if (!drawable && this.activeTab === JSON_TAB) this.setStatus(this.t('drawings_placeholder'), false);
    else this.setStatus('', false);

    // Нечитаемый JSON всё же можно сохранить: узел покажет плейсхолдер, данные
    // не потеряются. А вот пустую сцену конструктора вставлять незачем.
    this.saveButton.disabled = state === 'empty' || (this.activeTab !== JSON_TAB && !drawable);
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
