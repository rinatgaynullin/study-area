// Стили едут вместе с возможностью, как у ядра: хосту не нужен отдельный импорт.
import './styles.css';
import { ICONS, type DialogComponent, type EditorFeature } from '@rich-editor/core';
import { createGeometryDialog } from './geometry-dialog';
import { GEOMETRY_NODE_NAME, GeometryNode } from './geometry-node';
import type { GeometryPayload } from './types';

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

// Оси с графиком и точкой на нём: иконка регистрируется в общем наборе ядра.
ICONS.geometry = `<line x1="4" y1="19" x2="21" y2="19" ${STROKE} /><line x1="5" y1="20" x2="5" y2="3" ${STROKE} /><path d="M6 15c3-9 6-9 9-2s3 3 5 1" ${STROKE} /><circle cx="12" cy="9.5" r="1.9" fill="currentColor" />`;

export interface GeometryFeatureOptions {
  onError?(error: unknown): void;
}

/**
 * Возможность «Геометрия»: узел на JSXGraph, кнопка тулбара и диалог.
 *
 * Подключается `createRichEditor({ features: [geometryFeature()] })`; подписи
 * хост добавляет через `messages` из `GEOMETRY_MESSAGES`.
 */
export const geometryFeature = (options: GeometryFeatureOptions = {}): EditorFeature => {
  let dialog: DialogComponent<GeometryPayload | null> | null = null;

  return {
    id: GEOMETRY_NODE_NAME,
    extensions: ({ t }) => [
      GeometryNode.configure({
        t,
        onEdit: (payload) => dialog?.open(payload),
        onError: options.onError ?? null,
      }),
    ],
    toolbarItems: () => [
      {
        id: GEOMETRY_NODE_NAME,
        icon: 'geometry',
        labelKey: 'geometry_insert',
        kind: 'button',
        isActive: (editor) => editor.isActive(GEOMETRY_NODE_NAME),
        run: () => dialog?.open(null),
      },
    ],
    dialogs: (context) => {
      dialog = createGeometryDialog(context);

      return [dialog];
    },
  };
};
