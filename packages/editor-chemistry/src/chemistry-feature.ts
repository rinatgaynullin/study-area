// Стили диалога едут вместе с возможностью, как у ядра: хосту с бандлером
// подключать нечего. Стили узла приезжают через документную часть.
import './editor.css';
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
import { CHEMISTRY_SANITIZER_RULES, hydrateChemistry } from './chemistry-content';
import { createChemistryDialog } from './chemistry-dialog';
import { ChemistryNode } from './chemistry-node';
import { CHEMISTRY_MESSAGES } from './messages';
import { CHEMISTRY_NODE_NAME, type ChemistryPayload } from './types';

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

// Бензольное кольцо: иконка регистрируется в общем наборе ядра.
ICONS.chemistry =
  `<polygon points="12,3 19.8,7.5 19.8,16.5 12,21 4.2,16.5 4.2,7.5" ${STROKE} />`
  + `<circle cx="12" cy="12" r="4.2" ${STROKE} />`;

export interface ChemistryFeatureOptions {
  /** Пункт тулбара не нужен — например, структуры вставляет только импорт. */
  toolbarItem?: boolean;
}

/**
 * Возможность «Структурная формула»: узел, кнопка тулбара, диалог, подписи,
 * правила санитайзера и гидрация во вьюере — одним объявлением.
 *
 * Класс, потому что диалог пересоздаётся при каждой смене языка, а узел и
 * кнопка должны открывать именно текущий: ссылка на него — общее состояние.
 */
class ChemistryFeature implements EditorFeature {
  readonly id = CHEMISTRY_NODE_NAME;

  readonly messages: Record<string, Messages> = CHEMISTRY_MESSAGES;

  readonly sanitize: SanitizerRules = CHEMISTRY_SANITIZER_RULES;

  readonly hydrate = hydrateChemistry;

  private dialog: DialogComponent<ChemistryPayload | null> | null = null;

  constructor(private readonly options: ChemistryFeatureOptions = {}) {}

  readonly extensions = ({ t, formulaScale }: FeatureBuildOptions): unknown[] => [
    ChemistryNode.configure({
      t,
      scale: formulaScale,
      onEdit: (payload) => this.dialog?.open(payload),
    }),
  ];

  readonly toolbarItems = (): ToolbarItemDescriptor[] =>
    this.options.toolbarItem === false
      ? []
      : [
          {
            id: CHEMISTRY_NODE_NAME,
            icon: 'chemistry',
            labelKey: 'chemistry_insert',
            kind: 'button',
            isActive: (editor: Editor) => editor.isActive(CHEMISTRY_NODE_NAME),
            run: () => this.dialog?.open(null),
          },
        ];

  readonly dialogs = (context: EditorUiContext): DialogComponent<ChemistryPayload | null>[] => {
    const { editor } = context;

    this.dialog = createChemistryDialog(context, {
      onSave: (payload) => {
        if (payload.pos === null) {
          editor.chain().focus().insertChemistry({ code: payload.code, type: payload.type }).run();
        } else {
          editor.chain().focus().updateChemistry({ pos: payload.pos, code: payload.code }).run();
        }
      },
      onRemove: (pos) => {
        editor.chain().focus().deleteChemistryAt(pos).run();
      },
    });

    return [this.dialog];
  };
}

/** Подключается `createRichEditor({ features: [createChemistryFeature()] })`. */
export const createChemistryFeature = (options: ChemistryFeatureOptions = {}): EditorFeature =>
  new ChemistryFeature(options);
