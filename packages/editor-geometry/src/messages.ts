import type { Messages } from '@rich-editor/core';

/** Подписи возможности. Хост передаёт их редактору через `messages`. */
export const GEOMETRY_MESSAGES: Record<string, Messages> = {
  ru: {
    geometry_insert: 'Геометрия',
    geometry_title: 'Построение',
    geometry_edit: 'Изменить построение',
    geometry_script_label: 'Построение на JessieCode',
    geometry_bbox_label: 'Границы: лево верх право низ',
    geometry_preview_label: 'Предпросмотр',
    geometry_save: 'Сохранить',
    geometry_cancel: 'Отмена',
    geometry_error_parse: 'Не удалось разобрать построение',
    geometry_aria_label: 'Интерактивное геометрическое построение',
  },
  en: {
    geometry_insert: 'Geometry',
    geometry_title: 'Construction',
    geometry_edit: 'Edit construction',
    geometry_script_label: 'Construction in JessieCode',
    geometry_bbox_label: 'Bounds: left top right bottom',
    geometry_preview_label: 'Preview',
    geometry_save: 'Save',
    geometry_cancel: 'Cancel',
    geometry_error_parse: 'Could not parse the construction',
    geometry_aria_label: 'Interactive geometric construction',
  },
};
