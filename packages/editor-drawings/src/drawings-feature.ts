// Стили диалога едут вместе с возможностью, как у ядра; стили карточки
// приезжают через документную часть.
import './editor.css';
import './builders/builders.css';
import {
  ICONS,
  type DialogComponent,
  type EditorFeature,
  type EditorUiContext,
  type FeatureBuildOptions,
  type Messages,
  type SanitizerRules,
  type ToolbarItemDescriptor,
} from '@rich-editor/core';
import type { Editor } from '@tiptap/core';
import type { SceneEditorFactory } from './builders/types';
import { createDrawingDialog } from './drawing-dialog';
import { GeometryNode, PhysicsNode } from './drawing-node';
import { DRAWINGS_SANITIZER_RULES, hydrateDrawings } from './drawings-content';
import { DRAWINGS_MESSAGES } from './messages';
import { DRAWINGS_FEATURE_ID, GEOMETRY_NODE_NAME, PHYSICS_NODE_NAME, type DrawingPayload } from './types';

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

// Треугольник с отметкой прямого угла и брусок со стрелкой силы: иконки
// регистрируются в общем наборе ядра.
ICONS.geometry =
  `<polygon points="5,19 19,19 5,6" ${STROKE} />`
  + `<polyline points="5,15 9,15 9,19" ${STROKE} />`;
ICONS.physics =
  `<line x1="3" y1="18" x2="21" y2="18" ${STROKE} />`
  + `<rect x="6" y="10" width="8" height="8" rx="1" ${STROKE} />`
  + `<line x1="14" y1="14" x2="21" y2="14" ${STROKE} /><polyline points="18,11 21,14 18,17" ${STROKE} />`;

export interface DrawingsFeatureOptions {
  /** Пункты тулбара не нужны — например, чертежи вставляет только импорт. */
  toolbarItems?: boolean;
  /** Конструкторы во вкладках диалога; по умолчанию — все встроенные. */
  editors?: SceneEditorFactory[];
  /** Сканы работы ученика для панели рядом с полотном: адреса картинок. */
  scans?: () => string[];
}

/**
 * Возможность «Чертежи»: узлы геометрии и физики, две кнопки тулбара, один
 * диалог, подписи, правила санитайзера и гидрация во вьюере.
 *
 * Класс, потому что диалог пересоздаётся при каждой смене языка, а узлы и
 * кнопки должны открывать именно текущий: ссылка на него — общее состояние.
 */
class DrawingsFeature implements EditorFeature {
  readonly id = DRAWINGS_FEATURE_ID;

  readonly messages: Record<string, Messages> = DRAWINGS_MESSAGES;

  readonly sanitize: SanitizerRules = DRAWINGS_SANITIZER_RULES;

  private dialog: DialogComponent<DrawingPayload | null> | null = null;

  /** Язык редактора: заголовки карточек во вьюере должны ему соответствовать. */
  private locale = 'ru';

  constructor(private readonly options: DrawingsFeatureOptions = {}) {}

  readonly hydrate = (root: HTMLElement, context: { formulaScale: number }): void => {
    hydrateDrawings(root, context, this.locale);
  };

  readonly extensions = ({ t, formulaScale }: FeatureBuildOptions): unknown[] => {
    const onEdit = (payload: DrawingPayload): void => this.dialog?.open(payload);

    return [
      GeometryNode.configure({ t, scale: formulaScale, onEdit }),
      PhysicsNode.configure({ t, scale: formulaScale, onEdit }),
    ];
  };

  readonly toolbarItems = (): ToolbarItemDescriptor[] =>
    this.options.toolbarItems === false
      ? []
      : [
          {
            id: GEOMETRY_NODE_NAME,
            icon: 'geometry',
            labelKey: 'drawings_insert_geometry',
            kind: 'button',
            isActive: (editor: Editor) => editor.isActive(GEOMETRY_NODE_NAME),
            run: () => this.dialog?.open({ kind: 'geometry', data: '', tikz: '', pos: null }),
          },
          {
            id: PHYSICS_NODE_NAME,
            icon: 'physics',
            labelKey: 'drawings_insert_physics',
            kind: 'button',
            isActive: (editor: Editor) => editor.isActive(PHYSICS_NODE_NAME),
            run: () => this.dialog?.open({ kind: 'physics', data: '', tikz: '', pos: null }),
          },
        ];

  readonly dialogs = (context: EditorUiContext): DialogComponent<DrawingPayload | null>[] => {
    const { editor } = context;

    this.dialog = createDrawingDialog(context, {
      onSave: (payload) => {
        const content = { data: payload.data, tikz: payload.tikz };
        const chain = editor.chain().focus();

        if (payload.pos === null) {
          (payload.kind === 'physics' ? chain.insertPhysics(content) : chain.insertGeometry(content)).run();
        } else {
          const target = { ...content, pos: payload.pos };

          (payload.kind === 'physics' ? chain.updatePhysics(target) : chain.updateGeometry(target)).run();
        }
      },
      onRemove: (pos) => {
        editor.chain().focus().deleteDrawingAt(pos).run();
      },
      editors: this.options.editors,
      scans: this.options.scans,
    });

    return [this.dialog];
  };
}

/** Подключается `createRichEditor({ features: [createDrawingsFeature()] })`. */
export const createDrawingsFeature = (options: DrawingsFeatureOptions = {}): EditorFeature =>
  new DrawingsFeature(options);
