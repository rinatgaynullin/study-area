import type { Messages } from '@rich-editor/core';
import { BUILDER_MESSAGES } from './builders/messages';
import { PHYSICS_BUILDER_MESSAGES } from './builders/physics-messages';
import { PLOTS_MESSAGES } from './builders/plots-messages';
import { STEREOMETRY_MESSAGES } from './builders/stereometry-messages';

/** Подписи диалога и карточек; подписи конструкторов — в `builders/messages.ts`. */
const BASE_MESSAGES: Record<string, Messages> = {
  ru: {
    drawings_insert_geometry: 'Чертёж',
    drawings_insert_physics: 'Физическая схема',
    drawings_title_insert_geometry: 'Чертёж',
    drawings_title_edit_geometry: 'Изменить чертёж',
    drawings_title_insert_physics: 'Физическая схема',
    drawings_title_edit_physics: 'Изменить физическую схему',
    drawings_json_label: 'JSON-сцена',
    drawings_json_hint:
      'Формат PinQueen: вершины, рёбра, углы и графики для геометрии; элементы с типом и координатами для физики',
    drawings_tikz_label: 'TikZ',
    drawings_tikz_hint: 'Генерируется из сцены при сохранении',
    drawings_preview: 'Предпросмотр',
    drawings_templates: 'Шаблоны',
    drawings_empty: 'Сцена пуста',
    drawings_invalid: 'JSON не разобран: исправьте скобки и кавычки',
    drawings_apply_insert: 'Вставить',
    drawings_apply_save: 'Сохранить',
    drawings_remove: 'Удалить чертёж',
    drawings_aria_geometry: 'Чертёж',
    drawings_aria_physics: 'Физическая схема',
    drawings_placeholder: 'Пустой чертёж',
    drawings_scene_2d: 'Планиметрия',
    drawings_scene_3d: 'Стереометрия',
    drawings_scene_plot: 'Графики функций',
    drawings_scene_mechanics: 'Механика',
    drawings_scene_thermo: 'Термодинамика',
    drawings_scene_circuit: 'Электрическая цепь',
    drawings_scene_optics: 'Оптика',
    drawings_scene_physics: 'Физическая схема',
    drawings_template_triangle: 'Прямоугольный треугольник',
    drawings_template_pyramid: 'Пирамида',
    drawings_template_parabola: 'Парабола',
    drawings_template_block_force: 'Брусок с силой',
    drawings_template_circuit: 'Цепь с резистором',
    drawings_template_lens: 'Собирающая линза',
    drawings_template_thermo: 'График p(V)',
  },
  en: {
    drawings_insert_geometry: 'Drawing',
    drawings_insert_physics: 'Physics diagram',
    drawings_title_insert_geometry: 'Drawing',
    drawings_title_edit_geometry: 'Edit drawing',
    drawings_title_insert_physics: 'Physics diagram',
    drawings_title_edit_physics: 'Edit physics diagram',
    drawings_json_label: 'Scene JSON',
    drawings_json_hint:
      'PinQueen format: vertices, edges, angles and plots for geometry; typed elements with coordinates for physics',
    drawings_tikz_label: 'TikZ',
    drawings_tikz_hint: 'Generated from the scene on save',
    drawings_preview: 'Preview',
    drawings_templates: 'Templates',
    drawings_empty: 'The scene is empty',
    drawings_invalid: 'The JSON could not be parsed: check brackets and quotes',
    drawings_apply_insert: 'Insert',
    drawings_apply_save: 'Save',
    drawings_remove: 'Remove drawing',
    drawings_aria_geometry: 'Drawing',
    drawings_aria_physics: 'Physics diagram',
    drawings_placeholder: 'Empty drawing',
    drawings_scene_2d: 'Plane geometry',
    drawings_scene_3d: 'Solid geometry',
    drawings_scene_plot: 'Function plots',
    drawings_scene_mechanics: 'Mechanics',
    drawings_scene_thermo: 'Thermodynamics',
    drawings_scene_circuit: 'Electric circuit',
    drawings_scene_optics: 'Optics',
    drawings_scene_physics: 'Physics diagram',
    drawings_template_triangle: 'Right triangle',
    drawings_template_pyramid: 'Pyramid',
    drawings_template_parabola: 'Parabola',
    drawings_template_block_force: 'Block with a force',
    drawings_template_circuit: 'Circuit with a resistor',
    drawings_template_lens: 'Converging lens',
    drawings_template_thermo: 'p(V) diagram',
  },
};

/** Подписи возможности по языкам. Редактор берёт их сам через `EditorFeature.messages`. */
export const DRAWINGS_MESSAGES: Record<string, Messages> = Object.fromEntries(
  Object.keys(BASE_MESSAGES).map((locale) => [
    locale,
    {
      ...BASE_MESSAGES[locale],
      ...BUILDER_MESSAGES[locale],
      ...STEREOMETRY_MESSAGES[locale],
      ...PLOTS_MESSAGES[locale],
      ...PHYSICS_BUILDER_MESSAGES[locale],
    },
  ]),
);
