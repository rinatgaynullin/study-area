import { RichEditorError, type Translate } from '../types';

/** Reads a text file as UTF-8. Rejects with a localized editor error on failure. */
export async function readTextFile(file: File, t: Translate): Promise<string> {
  try {
    return await file.text();
  } catch (cause) {
    throw new RichEditorError(
      'file-read-failed',
      t('errors.fileReadFailed', { name: file.name }),
      cause,
    );
  }
}

/**
 * Splits plain text into paragraph strings. Markdown files are inserted as
 * plain text on purpose — the editor never interprets Markdown syntax, so what
 * the user sees in the file is what lands in the document.
 */
export function textToParagraphs(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}
