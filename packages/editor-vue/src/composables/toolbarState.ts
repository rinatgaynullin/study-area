import type { Editor } from '@rich-editor/core';

export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  codeBlock: boolean;
  subscript: boolean;
  superscript: boolean;
  highlight: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  link: boolean;
  linkHref: string;
  linkTargetBlank: boolean;
  headingLevel: number;
  align: 'left' | 'center' | 'right' | 'justify';
  textColor: string;
  highlightColor: string;
  inTable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  formulaSelected: boolean;
}

export function emptyToolbarState(): ToolbarState {
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
    codeBlock: false,
    subscript: false,
    superscript: false,
    highlight: false,
    bulletList: false,
    orderedList: false,
    blockquote: false,
    link: false,
    linkHref: '',
    linkTargetBlank: true,
    headingLevel: 0,
    align: 'left',
    textColor: '',
    highlightColor: '',
    inTable: false,
    canUndo: false,
    canRedo: false,
    formulaSelected: false,
  };
}

function activeHeading(editor: Editor): number {
  for (let level = 1; level <= 6; level += 1) {
    if (editor.isActive('heading', { level })) return level;
  }
  return 0;
}

function activeAlign(editor: Editor): ToolbarState['align'] {
  if (editor.isActive({ textAlign: 'center' })) return 'center';
  if (editor.isActive({ textAlign: 'right' })) return 'right';
  if (editor.isActive({ textAlign: 'justify' })) return 'justify';
  return 'left';
}

/** Snapshot of everything the toolbar highlights for the current selection. */
export function readToolbarState(editor: Editor): ToolbarState {
  const linkAttrs = editor.getAttributes('link');

  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    code: editor.isActive('code'),
    codeBlock: editor.isActive('codeBlock'),
    subscript: editor.isActive('subscript'),
    superscript: editor.isActive('superscript'),
    highlight: editor.isActive('highlight'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    blockquote: editor.isActive('blockquote'),
    link: editor.isActive('link'),
    linkHref: (linkAttrs.href as string) ?? '',
    linkTargetBlank: linkAttrs.target === '_blank',
    headingLevel: activeHeading(editor),
    align: activeAlign(editor),
    textColor: (editor.getAttributes('textStyle').color as string) ?? '',
    highlightColor: (editor.getAttributes('highlight').color as string) ?? '',
    inTable: editor.isActive('table'),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    formulaSelected: editor.isActive('formula'),
  };
}
