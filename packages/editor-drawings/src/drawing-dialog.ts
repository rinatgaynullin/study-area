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
import { createBuilderIcon, type BuilderIconId } from './builders/builder-icons';
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

/** Ни одна вкладка не выбрана: диалог только открывается или чертёж здесь не изменить. */
const NO_TAB = '';

/** Сцена из текста; `null` — текст не разобран. */
const readRawScene = (text: string): RawScene | null => parseSceneJson(text) as RawScene | null;

/**
 * Вид сцены по её содержимому: у физической схемы — `type: 'physics'` или
 * список `elements`, у геометрии — свой `type` либо вершины, рёбра, графики.
 * `null` — по тексту не понять: пусто, не разобралось, незнакомые поля.
 */
const kindOfScene = (raw: RawScene | null): DrawingKind | null => {
  if (raw === null) return null;

  if (raw.type === 'physics' || Array.isArray(raw.elements)) return 'physics';

  if (raw.type === '2d' || raw.type === '3d' || raw.type === 'plot_2d') return 'geometry';

  if ('vertices' in raw || 'edges' in raw || 'plots' in raw) return 'geometry';

  return null;
};

/**
 * Черновики вкладок за одно открытие диалога: какие конструкторы уже показаны
 * (повторный показ ничего в них не загружает) и какие пользователь менял с
 * последней синхронизации — загрузки сцены в конструктор или выгрузки его
 * сцены в текст JSON. Здесь же состояние текста JSON: вид его сцены и правил
 * ли его пользователь с последней синхронизации.
 */
class TabDrafts {
  /** Вид сцены в поле JSON; у вкладки JSON вид диалога — этот. */
  codeKind: DrawingKind = 'geometry';

  /** Текст JSON правили (ввод, образец) после последней синхронизации с конструктором. */
  codeEdited = false;

  private readonly shown = new Set<string>();

  private readonly changed = new Set<string>();

  /** Новое открытие диалога: рисунки прошлого открытия не всплывают. */
  reset(codeKind: DrawingKind): void {
    this.codeKind = codeKind;
    this.codeEdited = false;
    this.shown.clear();
    this.changed.clear();
  }

  isShown(id: string): boolean {
    return this.shown.has(id);
  }

  markShown(id: string): void {
    this.shown.add(id);
  }

  isChanged(id: string): boolean {
    return this.changed.has(id);
  }

  markChanged(id: string): void {
    this.changed.add(id);
  }

  /** Сцена конструктора и текст совпали или конструктор загружен заново. */
  markSynced(id: string): void {
    this.changed.delete(id);
  }
}

/**
 * Диалог чертежа: вкладки конструкторов, а с опцией `json` — ещё вкладка
 * JSON, шаблоны, живое превью и TikZ в сворачиваемом блоке.
 *
 * Вид нового чертежа (геометрия или физика) задаёт выбранная вкладка; у
 * существующего чертежа — только вкладки его вида. Конструктор одной вкладки
 * создаётся при первом открытии вкладки и живёт до уничтожения диалога. У
 * каждой вкладки свой черновик: переключение ничего не переносит между
 * конструкторами; с опцией `json` текст JSON обменивается сценой только с тем
 * конструктором, который менял пользователь (см. `TabDrafts`). Вид, открытая
 * сцена, активная вкладка, черновики, статус и кнопки — общее состояние
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

  private activeTab = NO_TAB;

  private readonly drafts = new TabDrafts();

  /** Вкладка, в которую при первом показе загружается открытая сцена. */
  private openingTab: string | null = null;

  private openingScene: RawScene = {};

  /** Узел, для которого нет подходящего конструктора: полотна нет, сохранять нечего. */
  private unavailable = false;

  private readonly modal: Modal;

  private readonly root: HTMLElement;

  /** Строка над рабочей областью; сейчас в ней только вкладки. */
  private readonly head: HTMLElement;

  private readonly tabList: HTMLElement;

  private readonly editorHost: HTMLElement;

  private readonly jsonPanel: HTMLElement;

  /** Сворачиваемый блок «Шаблоны, предпросмотр и код TikZ»; без опции `json` его нет. */
  private readonly more: HTMLDetailsElement | null;

  /** Поле JSON есть всегда: в нём лежит открытая сцена, а с опцией `json` его видно и правят. */
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
    this.drafts.reset(this.kind);
    this.unavailable = false;
    this.openingTab = null;
    this.activeTab = NO_TAB;
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
  private tabs(): Array<{ id: string; label: string; icon?: BuilderIconId }> {
    return [
      ...this.tabFactories().map((factory) => ({ id: factory.id, label: this.t(factory.labelKey), icon: factory.icon })),
      ...(this.options.json ? [{ id: JSON_TAB, label: this.t('drawings_tab_json') }] : []),
    ];
  }

  private tabFactories(): SceneEditorFactory[] {
    return this.isEditing ? this.factories.filter((factory) => factory.kind === this.kind) : this.factories;
  }

  private factoryOf(id: string): SceneEditorFactory | undefined {
    return id === NO_TAB || id === JSON_TAB ? undefined : this.factories.find((candidate) => candidate.id === id);
  }

  /** Значок вкладки скрыт от скринридера: имя вкладки — её подпись. */
  private tabContent(label: string, icon: BuilderIconId | undefined): Node[] {
    const text = el('span', { text: label });

    if (!icon) return [text];

    const svg = createBuilderIcon(icon);

    svg.classList.add('rte-drawing-dialog__tab-icon');

    return [svg, text];
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
          children: this.tabContent(tab.label, tab.icon),
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

  /**
   * Сцена открыта: первая подходящая вкладка её вида и превью под неё. Узел,
   * который ни один конструктор его вида не берёт, не перекрашивается молча в
   * другой вид: без JSON его можно только удалить.
   */
  private applyKind(): void {
    this.setKind(this.kind);

    const data = this.codeInput.value.trim();
    const raw = readRawScene(data);
    const ofKind = this.factories.filter((factory) => factory.kind === this.kind);
    const suitable = ofKind.find((factory) => data === '' || (raw !== null && factory.accepts(raw)));
    const broken = data !== '' && suitable === undefined;

    this.openingScene = raw ?? {};

    // С JSON нечитаемое и чужое открывается текстом как есть: конструктор его
    // не примет, а правка текста не должна потеряться.
    if (this.options.json) {
      this.openingTab = suitable ? suitable.id : null;
      this.selectTab(suitable ? suitable.id : JSON_TAB);

      return;
    }

    if (this.isEditing && (ofKind.length === 0 || (raw !== null && suitable === undefined))) {
      this.showUnavailable();

      return;
    }

    // Без вкладки JSON нечитаемую сцену не поправить: открываем конструктор
    // вида с чистым полотном и честно говорим, что чертёж придётся нарисовать
    // заново. «Вставить» заменит узел новым чертежом.
    const target = suitable ?? ofKind[0] ?? this.factories[0];

    if (broken) {
      this.codeInput.value = '';
      this.openingScene = {};
    }

    if (target) {
      this.openingTab = target.id;
      this.selectTab(target.id);
    }

    if (broken) this.setStatus(this.t('drawings_unreadable'), true);
  }

  /** Чертёж здесь не изменить: ни вкладок, ни полотна; остаются «Удалить» и «Отмена». */
  private showUnavailable(): void {
    this.unavailable = true;
    this.activeTab = NO_TAB;
    this.tabList.replaceChildren();
    this.tabList.hidden = true;
    this.head.hidden = true;
    this.editorHost.replaceChildren();
    this.jsonPanel.hidden = true;
    this.root.classList.remove('rte-drawing-dialog--json');
    this.setStatus(this.t('drawings_unavailable'), true);
    this.saveButton.disabled = true;
  }

  /** Переключает вкладку: у каждого конструктора свой черновик, JSON — свой текст. */
  private selectTab(id: string): void {
    this.leaveTab();
    this.activeTab = id;

    const factory = this.factoryOf(id);

    // Вкладка нового чертежа задаёт его вид; у вкладки JSON вид — вид её текста.
    if (factory && factory.kind !== this.kind) this.setKind(factory.kind);
    else if (!factory && this.drafts.codeKind !== this.kind) this.setKind(this.drafts.codeKind);

    this.renderTabs();

    const editor = factory ? this.ensureEditor(factory) : null;

    this.jsonPanel.hidden = editor !== null;
    this.editorHost.replaceChildren(...(editor ? [editor.element] : []));
    this.root.classList.toggle('rte-drawing-dialog--json', editor === null);
    // Служебный блок раскрыт там, где он нужен, — на вкладке JSON.
    if (this.more) this.more.open = editor === null;

    if (factory && editor) {
      this.enterEditor(factory, editor);
      this.renderPreviewFrom(editor.getScene());
    } else {
      this.renderPreview();
    }
  }

  /**
   * Уход с конструктора (только с опцией `json`): рисунок, который менял
   * пользователь, становится текстом JSON. Конструктор, который только
   * посмотрели, текст не трогает.
   */
  private leaveTab(): void {
    const id = this.activeTab;
    const factory = this.factoryOf(id);
    const editor = this.editors.get(id);

    if (!this.options.json || !factory || !editor) return;

    // У пустого текста своего вида нет: он принимает вид последнего
    // конструктора. Иначе JSON, вставленный сразу после вкладки «Физика»,
    // ушёл бы в документ геометрическим чертежом.
    if (this.codeInput.value.trim() === '') this.drafts.codeKind = factory.kind;

    if (!this.drafts.isChanged(id)) return;

    this.codeInput.value = JSON.stringify(editor.getScene(), null, 2);
    this.drafts.codeKind = factory.kind;
    this.drafts.codeEdited = false;
    this.drafts.markSynced(id);
  }

  /**
   * Вход на конструктор: правленный пользователем текст JSON, если конструктор
   * его берёт; иначе при первом показе — открытая сцена (у своей вкладки) или
   * пустое полотно; при повторном — черновик как оставили.
   */
  private enterEditor(factory: SceneEditorFactory, editor: SceneEditor): void {
    const fromCode = this.editedCodeFor(factory);

    if (fromCode) {
      this.loadInto(factory.id, editor, fromCode);
      this.drafts.codeEdited = false;
    } else if (!this.drafts.isShown(factory.id)) {
      this.loadInto(factory.id, editor, factory.id === this.openingTab ? this.openingScene : {});
    }

    this.drafts.markShown(factory.id);
  }

  /** Сцена из текста JSON для конструктора — только если текст правили и он подходит. */
  /**
   * Вид нового чертежа на вкладке JSON задаёт сам текст: физическую схему
   * могли вставить после вкладки геометрии, и наоборот. У существующего узла
   * вид не меняется никогда.
   */
  private adoptCodeKind(): void {
    if (this.isEditing) return;

    const kind = kindOfScene(readRawScene(this.codeInput.value));

    if (kind === null || kind === this.drafts.codeKind) return;

    this.drafts.codeKind = kind;

    if (this.activeTab === JSON_TAB) this.setKind(kind);
  }

  private editedCodeFor(factory: SceneEditorFactory): RawScene | null {
    if (!this.options.json || !this.drafts.codeEdited || this.drafts.codeKind !== factory.kind) return null;

    const raw = readRawScene(this.codeInput.value);

    return raw !== null && factory.accepts(raw) ? raw : null;
  }

  /** Загрузка — не правка пользователя: признак «изменён» снимается. */
  private loadInto(id: string, editor: SceneEditor, scene: RawScene): void {
    editor.load(scene);
    this.drafts.markSynced(id);
  }

  private ensureEditor(factory: SceneEditorFactory): SceneEditor {
    const { id } = factory;
    const existing = this.editors.get(id);

    if (existing) return existing;

    const editor = factory.create({ t: this.t, scans: this.options.scans?.() });

    this.editors.set(id, editor);
    this.editorReleases.set(
      id,
      editor.onChange(() => {
        this.drafts.markChanged(id);

        if (this.activeTab === id) this.renderPreviewFrom(editor.getScene());
      }),
    );

    return editor;
  }

  private readonly onTabClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');

    if (button && button.dataset.tab && button.dataset.tab !== this.activeTab) {
      this.selectTab(button.dataset.tab);
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
      this.selectTab(next.dataset.tab);
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
    this.drafts.codeEdited = true;
    this.adoptCodeKind();
    this.renderPreview();
  };

  /** Образец — правка текста JSON: грузится в активный конструктор или открывает подходящую вкладку. */
  private readonly onTemplatesClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-template]');
    const template = DRAWING_TEMPLATES.find((candidate) => candidate.id === button?.dataset.template);

    if (!template) return;

    this.codeInput.value = JSON.stringify(template.scene, null, 2);
    this.drafts.codeKind = template.kind;
    this.drafts.codeEdited = true;

    const factory = this.factoryOf(this.activeTab);
    const editor = this.editors.get(this.activeTab);

    if (!factory || !editor) {
      this.renderPreview();
      this.codeInput.focus();

      return;
    }

    if (factory.accepts(template.scene)) {
      this.loadInto(factory.id, editor, template.scene);
      this.drafts.codeEdited = false;
      this.renderPreviewFrom(editor.getScene());
      editor.focus();

      return;
    }

    // Образец другого вида сцены открывает подходящую вкладку (или JSON, если
    // такой нет); черновик текущей вкладки поверх образца не выгружается.
    const target = this.tabFactories().find((candidate) => candidate.kind === template.kind && candidate.accepts(template.scene));

    this.drafts.markSynced(factory.id);
    this.selectTab(target ? target.id : JSON_TAB);
    this.editors.get(this.activeTab)?.focus();
  };

  private readonly onCancelClick = (): void => {
    this.close();
  };

  private readonly onRemoveClick = (): void => {
    if (this.payload?.pos !== null && this.payload?.pos !== undefined) this.options.onRemove(this.payload.pos);

    this.close();
  };

  private readonly onSaveClick = (): void => {
    if (this.unavailable) return;

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
