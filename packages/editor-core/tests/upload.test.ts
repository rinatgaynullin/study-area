import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RichEditorCore,
  type RichEditorError,
  type UploadAdapter,
  type UploadContext,
} from '../src';

let core: RichEditorCore | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  core?.destroy();
  element?.remove();
  core = undefined;
  element = undefined;
});

const mount = (options: Partial<ConstructorParameters<typeof RichEditorCore>[0]> = {}) => {
  element = document.createElement('div');
  document.body.appendChild(element);
  core = new RichEditorCore({ element, ...options });

  return core;
};

const imageFile = () => new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
const textFile = () => new File(['line one\nline two'], 'notes.txt', { type: 'text/plain' });
const audioFile = () => new File([new Uint8Array([1, 2])], 'voice.webm', { type: 'audio/webm' });

describe('upload adapters', () => {
  it('inserts the URL returned by the image adapter', async () => {
    const uploadImage = vi.fn<UploadAdapter>(async () => ({
      url: 'https://cdn.example.com/images/photo.png',
    }));

    const editor = mount({ uploadImage });

    await editor.insertImageFile(imageFile());

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(uploadImage.mock.calls[0][0].name).toBe('photo.png');
    expect(editor.getHTML()).toContain('https://cdn.example.com/images/photo.png');
  });

  it('passes the upload kind and a translator to the adapter', async () => {
    let received: UploadContext | undefined;

    const uploadFile: UploadAdapter = async (_file, ctx) => {
      received = ctx;

      return { url: 'https://cdn.example.com/files/notes.txt' };
    };

    await mount({ uploadFile }).attachTextFile(textFile());

    expect(received?.kind).toBe('file');
    expect(received?.signal).toBeInstanceOf(AbortSignal);
    expect(typeof received?.t).toBe('function');
  });

  it('inserts the audio URL returned by the adapter', async () => {
    const uploadAudio = vi.fn<UploadAdapter>(async () => ({
      url: 'https://cdn.example.com/audio/voice.webm',
    }));

    const editor = mount({ uploadAudio });

    await editor.insertRecording(audioFile(), { duration: 3.5, peaks: '10,20,30' });

    expect(uploadAudio).toHaveBeenCalledTimes(1);

    const html = editor.getHTML();

    expect(html).toContain('https://cdn.example.com/audio/voice.webm');
    expect(html).toContain('data-duration="3.5"');
    expect(html).toContain('data-peaks="10,20,30"');
  });

  it('falls back to a local object URL when no adapter is supplied', async () => {
    const editor = mount();

    await editor.insertImageFile(imageFile());

    expect(editor.getHTML()).toContain('blob:');
  });

  it('attaches a text file as a downloadable chip', async () => {
    const editor = mount();

    await editor.attachTextFile(textFile());

    const html = editor.getHTML();

    expect(html).toContain('data-attachment="true"');
    expect(html).toContain('notes.txt');
    expect(html).toContain('download="notes.txt"');
  });

  it('inserts text file contents as plain paragraphs, never parsing Markdown', async () => {
    const editor = mount();
    const markdown = new File(['# Heading\n**bold**'], 'readme.md', { type: 'text/markdown' });

    await editor.insertTextFileContent(markdown);

    const html = editor.getHTML();

    expect(html).toContain('# Heading');
    expect(html).toContain('**bold**');
    expect(html).not.toContain('<h1>');
    expect(html).not.toContain('<strong>');
  });

  it('reports a localized error and inserts nothing when the adapter fails', async () => {
    const onError = vi.fn();

    const editor = mount({
      uploadImage: async () => {
        throw new Error('network down');
      },
      onError,
    });

    const inserted = await editor.insertImageFile(imageFile());

    expect(inserted).toBe(false);
    expect(editor.getHTML()).not.toContain('<img');

    const error = onError.mock.calls[0][0] as RichEditorError;

    expect(error.code).toBe('upload-failed');
    expect(error.message).toContain('photo.png');
  });
});

describe('limits', () => {
  it('rejects a file larger than the configured image limit', async () => {
    const onError = vi.fn();

    const uploadImage = vi.fn<UploadAdapter>(async () => ({
      url: 'https://cdn.example.com/x.png',
    }));

    const editor = mount({ limits: { maxImageSizeBytes: 10 }, uploadImage, onError });

    const big = new File([new Uint8Array(64)], 'big.png', { type: 'image/png' });
    const inserted = await editor.insertImageFile(big);

    expect(inserted).toBe(false);
    expect(uploadImage).not.toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as RichEditorError).code).toBe('file-too-large');
  });

  it('rejects a file whose type does not match the requested kind', async () => {
    const onError = vi.fn();
    const editor = mount({ onError });

    const inserted = await editor.insertImageFile(textFile());

    expect(inserted).toBe(false);
    expect((onError.mock.calls[0][0] as RichEditorError).code).toBe('unsupported-type');
  });

  it('applies limits updated after construction', async () => {
    const onError = vi.fn();
    const editor = mount({ onError });

    editor.setLimits({ maxImageSizeBytes: 1 });

    expect(await editor.insertImageFile(imageFile())).toBe(false);
    expect((onError.mock.calls[0][0] as RichEditorError).code).toBe('file-too-large');
  });

  it('localizes the size error through the active locale', async () => {
    const onError = vi.fn();

    const editor = mount({
      locale: 'en',
      messages: { en: { error_file_too_large: 'Too big: {name}' } },
      limits: { maxImageSizeBytes: 1 },
      onError,
    });

    await editor.insertImageFile(imageFile());

    expect((onError.mock.calls[0][0] as RichEditorError).message).toBe('Too big: photo.png');
  });
});
