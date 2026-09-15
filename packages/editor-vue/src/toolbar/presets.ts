export type ToolbarItemId =
  | 'undo'
  | 'redo'
  | 'heading'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'subscript'
  | 'superscript'
  | 'textColor'
  | 'highlight'
  | 'clearFormat'
  | 'align'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'code'
  | 'codeBlock'
  | 'horizontalRule'
  | 'link'
  | 'table'
  | 'image'
  | 'audio'
  | 'file'
  | 'formulaMath'
  | 'formulaChem';

export interface ToolbarGroup {
  id: string;
  items: ToolbarItemId[];
  /** Moved into the overflow menu when the toolbar runs out of room. */
  collapsible?: boolean;
}

export type ToolbarPreset = 'full' | 'standard' | 'minimal';
export type ToolbarConfig = ToolbarPreset | ToolbarGroup[];

/** Grouping mirrors Quasar's QEditor: history, text, paragraph, insert. */
export const TOOLBAR_PRESETS: Record<ToolbarPreset, ToolbarGroup[]> = {
  full: [
    { id: 'history', items: ['undo', 'redo'], collapsible: true },
    { id: 'heading', items: ['heading'] },
    { id: 'format', items: ['bold', 'italic', 'underline', 'strike'] },
    { id: 'script', items: ['subscript', 'superscript'], collapsible: true },
    { id: 'color', items: ['textColor', 'highlight'], collapsible: true },
    { id: 'align', items: ['align'], collapsible: true },
    { id: 'list', items: ['bulletList', 'orderedList'] },
    { id: 'block', items: ['blockquote', 'code', 'codeBlock', 'horizontalRule'], collapsible: true },
    { id: 'insert', items: ['link', 'table', 'image', 'audio', 'file'] },
    { id: 'formula', items: ['formulaMath', 'formulaChem'] },
    { id: 'clear', items: ['clearFormat'], collapsible: true },
  ],
  standard: [
    { id: 'history', items: ['undo', 'redo'], collapsible: true },
    { id: 'heading', items: ['heading'] },
    { id: 'format', items: ['bold', 'italic', 'underline'] },
    { id: 'list', items: ['bulletList', 'orderedList'] },
    { id: 'insert', items: ['link', 'image', 'audio'], collapsible: true },
    { id: 'formula', items: ['formulaMath', 'formulaChem'] },
  ],
  minimal: [
    { id: 'format', items: ['bold', 'italic', 'underline'] },
    { id: 'list', items: ['bulletList', 'orderedList'] },
    { id: 'insert', items: ['link'] },
  ],
};

export function resolveToolbar(config: ToolbarConfig | undefined): ToolbarGroup[] {
  if (!config) return TOOLBAR_PRESETS.full;
  if (typeof config === 'string') return TOOLBAR_PRESETS[config] ?? TOOLBAR_PRESETS.full;
  return config;
}
