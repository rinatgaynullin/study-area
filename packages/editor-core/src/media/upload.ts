import {
  RichEditorError,
  type EditorLimits,
  type Translate,
  type UploadAdapter,
  type UploadKind,
  type UploadResult,
} from '../types';
import { formatBytes } from '../utils/format';

/** Extensions accepted by the text-file plugin alongside `text/*` MIME types. */
export const TEXT_FILE_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.log',
  '.xml',
  '.yml',
  '.yaml',
];

export const TEXT_FILE_ACCEPT = [...TEXT_FILE_EXTENSIONS, 'text/plain', 'text/markdown'].join(',');
export const IMAGE_ACCEPT = 'image/*';

export interface UploadPipelineOptions {
  limits: EditorLimits;
  t: Translate;
  adapters: Partial<Record<UploadKind, UploadAdapter | undefined>>;
  onError?: (error: RichEditorError) => void;
}

function hasTextExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isTextFile(file: File): boolean {
  return file.type.startsWith('text/') || file.type === 'application/json' || hasTextExtension(file.name);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/');
}

function limitFor(kind: UploadKind, limits: EditorLimits): number {
  if (kind === 'image') return limits.maxImageSizeBytes;
  if (kind === 'audio') return limits.maxAudioSizeBytes;
  return limits.maxFileSizeBytes;
}

function matchesKind(kind: UploadKind, file: File): boolean {
  if (kind === 'image') return isImageFile(file);
  if (kind === 'audio') return isAudioFile(file);
  return isTextFile(file);
}

/**
 * Turns a `File` into a URL the document can reference. With no adapter the
 * file stays local as an object URL; with one, the host stores it and the
 * returned URL is what lands in the HTML.
 */
export class UploadPipeline {
  private objectUrls = new Set<string>();
  private controller = new AbortController();

  constructor(private options: UploadPipelineOptions) {}

  setOptions(options: Partial<UploadPipelineOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /** Validates and uploads. Returns `null` when the file was rejected. */
  async upload(kind: UploadKind, file: File): Promise<UploadResult | null> {
    const { t, limits } = this.options;

    if (!matchesKind(kind, file)) {
      this.fail(
        new RichEditorError(
          'unsupported-type',
          t('errors.unsupportedType', { type: file.type || file.name }),
        ),
      );
      return null;
    }

    const max = limitFor(kind, limits);
    if (file.size > max) {
      this.fail(
        new RichEditorError(
          'file-too-large',
          t('errors.fileTooLarge', {
            name: file.name,
            size: formatBytes(file.size),
            max: formatBytes(max),
          }),
        ),
      );
      return null;
    }

    const adapter = this.options.adapters[kind];
    if (!adapter) return this.toObjectUrl(file);

    try {
      const result = await adapter(file, {
        kind,
        signal: this.controller.signal,
        t,
      });
      if (!result?.url) throw new Error('Upload adapter returned no URL');
      return {
        name: file.name,
        mime: file.type,
        size: file.size,
        ...result,
      };
    } catch (cause) {
      this.fail(
        new RichEditorError('upload-failed', t('errors.uploadFailed', { name: file.name }), cause),
      );
      return null;
    }
  }

  /** Local fallback pipeline: an object URL owned by this editor instance. */
  toObjectUrl(file: Blob, name?: string, mime?: string): UploadResult {
    const url = URL.createObjectURL(file);
    this.objectUrls.add(url);
    return {
      url,
      name: name ?? (file instanceof File ? file.name : undefined),
      mime: mime ?? file.type,
      size: file.size,
    };
  }

  private fail(error: RichEditorError): void {
    this.options.onError?.(error);
  }

  /** Aborts in-flight uploads and releases every object URL this editor created. */
  destroy(): void {
    this.controller.abort();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }
}
