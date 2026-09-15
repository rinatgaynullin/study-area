import type { Editor } from '@tiptap/core';

/** Kind of asset an upload adapter is being asked to handle. */
export type UploadKind = 'image' | 'audio' | 'file';

/** Result the host application returns after storing a file on its own backend. */
export interface UploadResult {
  url: string;
  name?: string;
  mime?: string;
  size?: number;
  /** Free-form metadata; ignored by the editor but kept for host bookkeeping. */
  meta?: Record<string, unknown>;
}

export interface UploadContext {
  kind: UploadKind;
  /** Aborted when the editor is destroyed while an upload is in flight. */
  signal: AbortSignal;
  /** Translator bound to the active locale, so hosts can localize their own errors. */
  t: Translate;
}

export type UploadAdapter = (file: File, ctx: UploadContext) => Promise<UploadResult>;

export interface EditorLimits {
  maxAudioDurationSec: number;
  maxAudioSizeBytes: number;
  maxImageSizeBytes: number;
  maxFileSizeBytes: number;
}

export const DEFAULT_LIMITS: EditorLimits = {
  maxAudioDurationSec: 300,
  maxAudioSizeBytes: 10 * 1024 * 1024,
  maxImageSizeBytes: 10 * 1024 * 1024,
  maxFileSizeBytes: 5 * 1024 * 1024,
};

/** Flat translation table: `lower_snake` key to translated string. */
export interface Messages {
  [key: string]: string;
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export type FormulaType = 'math' | 'chem';

export interface FormulaPayload {
  /** MathML source of truth. */
  mathml: string;
  type: FormulaType;
  /** Document position of the node being edited; `null` when inserting a new formula. */
  pos: number | null;
}

export type RichEditorErrorCode =
  | 'file-too-large'
  | 'audio-too-long'
  | 'unsupported-type'
  | 'upload-failed'
  | 'recorder-unsupported'
  | 'recorder-permission-denied'
  | 'recorder-failed'
  | 'file-read-failed'
  | 'invalid-mathml'
  | 'formula-render-failed';

export class RichEditorError extends Error {
  readonly code: RichEditorErrorCode;

  constructor(code: RichEditorErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'RichEditorError';
    this.code = code;
  }
}

export interface AudioAttributes {
  src: string;
  name?: string | null;
  mime?: string | null;
  /** Duration in seconds; `null` when unknown (e.g. a remote URL without metadata). */
  duration?: number | null;
  /** Compact waveform peaks, comma-separated integers 0..99. */
  peaks?: string | null;
}

export interface AttachmentAttributes {
  href: string;
  name: string;
  size?: number | null;
  mime?: string | null;
}

export interface RichEditorCoreOptions {
  /** Element the editor mounts into. Must exist in a DOM — call only on the client. */
  element: HTMLElement;
  content?: string;
  editable?: boolean;
  placeholder?: string;
  locale?: string;
  messages?: Record<string, Messages>;
  limits?: Partial<EditorLimits>;
  uploadImage?: UploadAdapter;
  uploadAudio?: UploadAdapter;
  uploadFile?: UploadAdapter;
  /** Scale applied to MathJax SVG output; 1 keeps MathJax's own sizing. */
  formulaScale?: number;
  /** Extra TipTap extensions appended to the built-in set. */
  extensions?: unknown[];
  /**
   * Включает разбор разметки старого редактора (Froala + Wiris). Выключено по
   * умолчанию: хостам без legacy-данных незачем платить разбором документа на
   * каждом `setHTML`.
   */
  legacy?: boolean;
  onChange?: (html: string) => void;
  onSelectionUpdate?: (editor: Editor) => void;
  onTransaction?: (editor: Editor) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Invoked when the user asks to insert or re-edit a formula. */
  onFormulaEdit?: (payload: FormulaPayload) => void;
  onError?: (error: RichEditorError) => void;
}
