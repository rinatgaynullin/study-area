# 5. Медиа и загрузки

Файлы: `packages/editor-core/src/media/upload.ts`, `media/recorder.ts`,
`media/text-file.ts`, `types.ts`, `utils/format.ts`.

## 5.1. Контракт адаптера

```ts
type UploadKind = 'image' | 'audio' | 'file';

type UploadAdapter = (file: File, context: UploadContext) => Promise<UploadResult>;

interface UploadContext {
  kind: UploadKind;
  signal: AbortSignal;   // отменяется при destroy() редактора во время загрузки
  t: Translate;          // переводчик активной локали — для своих сообщений об ошибках
}

interface UploadResult {
  url: string;           // обязательное: что попадёт в документ
  name?: string;
  mime?: string;
  size?: number;
  meta?: Record<string, unknown>;   // редактор игнорирует; для учёта на стороне хоста
}

interface UploadEvent { kind: UploadKind; file: File; phase: 'start' | 'done' | 'failed' }
```

Адаптеры передаются опциями `uploadImage`, `uploadAudio`, `uploadFile`
(`RichEditorCoreOptions`, `createRichEditor`, пропы `RichEditor`). Без
адаптера файл остаётся локальным `blob:` URL (`URL.createObjectURL`) — годится
для прототипа, исчезает при перезагрузке. Blob-URL отзываются при `destroy()`.

Пример адаптера:

```ts
import type { UploadAdapter } from '@rich-editor/core';

const uploadImage: UploadAdapter = async (file, ctx) => {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch('/api/uploads', { method: 'POST', body, signal: ctx.signal });
  if (!response.ok) throw new Error(ctx.t('error_upload_failed', { name: file.name }));

  const { url } = await response.json();
  return { url, name: file.name, mime: file.type, size: file.size };
};
```

Любое исключение адаптера → `RichEditorError('upload-failed')` с
локализованным сообщением `error_upload_failed` и `cause` = исходная ошибка;
в документ ничего не вставляется. Пустой `url` в ответе считается ошибкой.

## 5.2. `UploadPipeline`

```ts
interface UploadPipelineOptions {
  limits: EditorLimits;
  t: Translate;
  adapters: Partial<Record<UploadKind, UploadAdapter | undefined>>;
  onError?: (error: RichEditorError) => void;
  onUpload?: (event: UploadEvent) => void;
}

class UploadPipeline {
  constructor(options: UploadPipelineOptions);
  setOptions(options: Partial<UploadPipelineOptions>): void;
  upload(kind: UploadKind, file: File): Promise<UploadResult | null>;   // null — файл отвергнут
  toObjectUrl(file: Blob, name?: string, mime?: string): UploadResult;
  destroy(): void;   // abort всех загрузок, revoke всех blob
}
```

`upload(kind, file)` по шагам:

1. **Соответствие вида** — `isImageFile` (`image/*`), `isAudioFile`
   (`audio/*`), `isTextFile` (`text/*`, `application/json` или расширение из
   `TEXT_FILE_EXTENSIONS`). Иначе `unsupported-type` и `null`.
2. **Размер** — против `maxImageSizeBytes` / `maxAudioSizeBytes` /
   `maxFileSizeBytes`. Иначе `file-too-large`
   («Файл «{name}» слишком большой: {size}. Максимум — {max}.») и `null`.
   Адаптер при этом **не вызывается**.
3. **Нет адаптера** → `toObjectUrl(file)` (без событий `onUpload`).
4. **Есть адаптер** → `onUpload({ phase: 'start' })`, вызов адаптера с
   `{ kind, signal, t }`, затем `done` или `failed`. Результат дополняется
   `name/mime/size` из файла, если адаптер их не вернул
   (`{ name: file.name, mime: file.type, size: file.size, ...result }`).

Экспортируемые константы:

```ts
const TEXT_FILE_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.xml', '.yml', '.yaml'];
const TEXT_FILE_ACCEPT = '.txt,.md,…,.yaml,text/plain,text/markdown';   // accept скрытого <input type=file>
const IMAGE_ACCEPT = 'image/*';
const isTextFile: (file: File) => boolean;
const isImageFile: (file: File) => boolean;
const isAudioFile: (file: File) => boolean;
```

## 5.3. Лимиты

```ts
interface EditorLimits {
  maxAudioDurationSec: number;
  maxAudioSizeBytes: number;
  maxImageSizeBytes: number;
  maxFileSizeBytes: number;
}

const DEFAULT_LIMITS: EditorLimits = {
  maxAudioDurationSec: 300,
  maxAudioSizeBytes: 10 * 1024 * 1024,
  maxImageSizeBytes: 10 * 1024 * 1024,
  maxFileSizeBytes: 5 * 1024 * 1024,
};
```

Передаются опцией `limits: Partial<EditorLimits>`; меняются у живого
редактора через `setLimits()` (`RichEditorUi`, `RichEditorCore`) или проп
`limits` (Vue, `deep` watcher). Длительность записи контролирует рекордер
(`maxAudioDurationSec`), размер записи — рекордер по мере поступления чанков
(`maxAudioSizeBytes`) и пайплайн при загрузке через адаптер.

> Серверные умолчания `django-rich-editor` отличаются (аудио и файлы — 20 МБ,
> узкий список MIME для файлов); см. [10-standalone-and-django.md](10-standalone-and-django.md#контракт-клиент--сервер).

## 5.4. Ошибки: `RichEditorError`

```ts
type RichEditorErrorCode =
  | 'file-too-large'              // пайплайн: размер; рекордер: превышен maxAudioSizeBytes
  | 'unsupported-type'            // вид файла не совпал с запрошенным
  | 'upload-failed'               // адаптер бросил исключение или не вернул url
  | 'recorder-unsupported'        // нет MediaRecorder / getUserMedia
  | 'recorder-permission-denied'  // NotAllowedError / SecurityError от getUserMedia
  | 'recorder-failed'             // любая другая ошибка записи
  | 'file-read-failed'            // не удалось прочитать текстовый файл
  | 'invalid-mathml';             // insertFormula/updateFormulaAt с непригодным MathML

class RichEditorError extends Error {
  readonly code: RichEditorErrorCode;
  constructor(code: RichEditorErrorCode, message: string, cause?: unknown);  // name = 'RichEditorError'
}
```

`message` всегда локализован через переводчик (`error_*` ключи). Ошибки
доставляются в `onError` (ядро), дублируются в строку статуса оболочки и в
событие `error` Vue-компонента. Ошибки рекордера возникают в диалоге записи и
идут тем же путём через `reportError` оболочки.

## 5.5. Изображения

- Источники: кнопка `image` (скрытый `<input type="file" accept="image/*">`),
  перетаскивание, вставка из буфера.
- `insertImageFile(file, at?)` → `uploads.upload('image')` →
  `setImage({ src, alt: name ?? '' })`. `alt` берётся из имени файла; UI для
  alt-текста, подписи и кадрирования нет.
- Расширение `@tiptap/extension-image` с `resize.enabled`: ручки по четырём
  углам, пропорции сохраняются всегда, минимум 40×40. Размер записывается в
  атрибуты `width`/`height` `<img>` и переживает экспорт.
- `allowBase64: true` — `data:image/*` в `src` проходит (санитайзер
  разрешает `data:` только для `image|audio|video` на медиа-элементах).
- В legacy-режиме узел инлайновый (см. [02-core.md](02-core.md#что-меняется-в-схеме-при-legacy-true)).

## 5.6. Голосовые сообщения: `VoiceRecorder`

```ts
type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
type RecorderLimit = 'duration' | 'size';

interface RecordingResult { blob: Blob; mime: string; duration: number; peaks: string }

interface VoiceRecorderOptions {
  t: Translate;
  maxDurationSec: number;
  maxSizeBytes: number;
  onTick?: (elapsedSec: number) => void;         // каждые 200 мс
  onStateChange?: (state: RecorderState) => void;
  onLimit?: (reason: RecorderLimit) => void;     // предел достигнут; рекордер уже на паузе
  onLevel?: (level: number) => void;             // уровень 0..1 каждые 100 мс (Web Audio)
  onError?: (error: RichEditorError) => void;
}

class VoiceRecorder {
  constructor(options: VoiceRecorderOptions);
  getState(): RecorderState;
  getElapsed(): number;                 // секунды без пауз
  start(): Promise<void>;               // getUserMedia({ audio: true }); бросает RichEditorError
  pause(): void;
  resume(): void;
  stop(): Promise<RecordingResult>;
  cancel(): void;                       // останавливает и выбрасывает записанное
}

const isRecordingSupported: () => boolean;
const pickAudioMimeType: () => string | undefined;
```

Поведение:

- контейнер выбирается первым поддерживаемым из `audio/webm;codecs=opus`,
  `audio/webm`, `audio/ogg;codecs=opus`, `audio/ogg`,
  `audio/mp4;codecs=mp4a.40.2`, `audio/mp4`, `audio/mpeg`; иначе — умолчание
  браузера. **Транскодирования нет**: Safari и Firefox дадут разные форматы.
- `recorder.start(250)` — чанки каждые 250 мс; при превышении
  `maxSizeBytes` → `onError('file-too-large', error_audio_too_large)` и
  пауза с `onLimit('size')`;
- тик каждые 200 мс; при `elapsed >= maxDurationSec` → пауза с
  `onLimit('duration')`. Предел соблюдается **паузой, а не сбросом**:
  последующий `stop()` отдаёт записанное;
- уровень сигнала через `AnalyserNode` (RMS по 512 сэмплам); из накопленных
  уровней при `stop()` строится 48 пиков 0..99 (`peaks`) для осциллограммы;
- учитывает состояние, когда браузер сам остановил запись (трек оборвался):
  `pause()`/`stop()` не бросают `InvalidStateError`;
- `teardown` закрывает `AudioContext`, останавливает треки микрофона.

Вставка: `core.insertRecording(blob, { duration, peaks })` — файл
`voice-<timestamp>.<ext>`, при наличии `uploadAudio` грузится через пайплайн,
иначе `blob:` URL; узел `audioMessage` получает `duration` и `peaks`. Аудио,
вставленное **файлом** (drag&drop), получает `duration: null`, `peaks: null`
— плеер рисует ровные столбики и берёт длительность из метаданных.

## 5.7. Текстовые файлы

Два режима в меню `file`:

| Пункт | Метод ядра | Результат |
| --- | --- | --- |
| «Прикрепить файлом» (по умолчанию, и при drag&drop) | `attachTextFile(file)` | `uploads.upload('file')` → узел `attachment` (`<a download>`) |
| «Вставить содержимое как текст» | `insertTextFileContent(file)` | `readTextFile` (UTF-8) → `textToParagraphs` (разбивка по `\n`) → абзацы. **Markdown не разбирается** |

```ts
const readTextFile: (file: File, t: Translate) => Promise<string>;   // RichEditorError('file-read-failed')
const textToParagraphs: (text: string) => string[];
```

Размер файла при вставке содержимого сверяется с `maxFileSizeBytes` (через
`uploads.upload` ради той же локализованной ошибки).

## 5.8. Утилиты форматирования

```ts
const formatDuration: (seconds: number) => string;   // 93 → '1:33'; невалидное → '0:00'
const formatBytes: (bytes: number) => string;        // 1536 → '1.5 KB'; ≥10 → без дробной части
```

Используются в плеере, чипе вложения, диалоге записи и сообщениях об ошибках.
