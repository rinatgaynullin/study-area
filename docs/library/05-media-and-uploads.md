# 5. Медиа и загрузки

## Назначение

Картинки, голосовые сообщения и текстовые файлы попадают в документ через
адаптеры загрузки хоста: редактор отдаёт `File`, ждёт URL и вставляет его.
Без адаптера файл остаётся локальным `blob:` URL — годится для прототипа,
исчезает при перезагрузке. Пределы размеров и длительности проверяются до
вызова адаптера; ошибки приходят в `onError` с кодом и локализованным текстом.

## Когда использовать

- Адаптеры — всегда, когда документ сохраняется: иначе медиа не переживут
  перезагрузку страницы.
- `UploadPipeline`, `VoiceRecorder` и утилиты напрямую — только для своего
  интерфейса поверх `RichEditorCore`.

## Интерфейс

Сигнатуры — [14-api-reference.md](14-api-reference.md#медиа).

### Адаптер

`UploadAdapter = (file: File, context: UploadContext) => Promise<UploadResult>`.
Передаётся опциями `uploadImage`, `uploadAudio`, `uploadFile` (ядро,
`createRichEditor`, пропы `RichEditor`).

| Поле | Тип | Что это |
| --- | --- | --- |
| `context.kind` | `'image'`, `'audio'`, `'file'` | Какой адаптер вызван |
| `context.signal` | `AbortSignal` | Отменяется при `destroy()` редактора во время загрузки |
| `context.t` | `Translate` | Переводчик активной локали — для своих сообщений |
| `result.url` | `string` | Обязательное: что попадёт в документ |
| `result.name`, `result.mime`, `result.size` | `string`, `string`, `number` | Необязательные; подставляются из файла, если не вернуть |
| `result.meta` | `Record<string, unknown>` | Редактор игнорирует; для учёта на стороне хоста |

Исключение адаптера или пустой `url` → ошибка `upload-failed`, в документ
ничего не вставляется. События `onUpload` (`{ kind, file, phase }`, фаза
`'start'`, `'done'`, `'failed'`) приходят только для загрузок через адаптер.

### Лимиты

`limits: Partial<EditorLimits>` поверх `DEFAULT_LIMITS`; меняются у живого
редактора через `setLimits()` или проп `limits`.

| Поле | По умолчанию | Что ограничивает |
| --- | --- | --- |
| `maxAudioDurationSec` | `300` | Длительность записи; на пределе рекордер ставится на паузу, запись цела |
| `maxAudioSizeBytes` | `10 МБ` | Размер записи и аудиофайла |
| `maxImageSizeBytes` | `10 МБ` | Размер картинки |
| `maxFileSizeBytes` | `5 МБ` | Размер текстового файла (вложение и вставка содержимого) |

Файл больше предела отвергается до вызова адаптера. Серверные умолчания
`django-rich-editor` другие ([10](10-standalone-and-django.md#контракт-клиент--сервер)).

### Ошибки: `RichEditorError`

`RichEditorError extends Error` с полем `code`; `message` локализован ключами
`error_*`; `cause` — исходная ошибка. Доставляется в `onError`, строку статуса
и событие `error` Vue-компонента.

| `code` | Когда |
| --- | --- |
| `file-too-large` | Размер больше предела; у записи — превышен `maxAudioSizeBytes` |
| `unsupported-type` | Тип файла не подходит адаптеру (`image/*`, `audio/*`, текстовый) |
| `upload-failed` | Адаптер бросил исключение или не вернул `url` |
| `recorder-unsupported` | Нет `MediaRecorder` или `getUserMedia` |
| `recorder-permission-denied` | Пользователь не дал доступ к микрофону |
| `recorder-failed` | Любая другая ошибка записи |
| `file-read-failed` | Не удалось прочитать текстовый файл |
| `invalid-mathml` | `insertFormula` / `updateFormulaAt` с непригодным MathML |

### Картинки

Источники: кнопка `image`, перетаскивание, вставка из буфера. Вставляются как
`<img class="rte-image" src alt>`, `alt` — имя файла. Размер меняется ручками по
углам с сохранением пропорций и записывается в `width`/`height`. `data:image/*`
в `src` проходит санитайзер.

### Голосовые сообщения

Запись идёт в диалоге `audio` через `MediaRecorder`: пауза и продолжение,
индикатор уровня, предпросмотр. Результат вставляется методом
`insertRecording(blob, { duration, peaks })` — узел с осциллограммой и нативным
`<audio controls>` в экспорте. Для своего интерфейса экспортируется класс `VoiceRecorder`:

| Член | Что делает |
| --- | --- |
| `new VoiceRecorder({ t, maxDurationSec, maxSizeBytes, onTick?, onStateChange?, onLimit?, onLevel?, onError? })` | Создаёт рекордер |
| `start()`, `pause()`, `resume()`, `cancel()` | Управление; `start()` запрашивает микрофон |
| `stop()` | `Promise<RecordingResult>`: `blob`, `mime`, `duration`, `peaks` |
| `getState()`, `getElapsed()` | `'idle'`, `'recording'`, `'paused'`, `'stopped'`; секунды без пауз |
| `isRecordingSupported()`, `pickAudioMimeType()` | Есть ли `MediaRecorder`; лучший поддерживаемый контейнер |

### Текстовые файлы

| Пункт меню `file` | Метод ядра | Результат |
| --- | --- | --- |
| «Прикрепить файлом» (и перетаскивание) | `attachTextFile(file)` | Загрузка через адаптер `file`, чип-вложение с `<a download>` |
| «Вставить содержимое как текст» | `insertTextFileContent(file)` | Текст абзацами (разбивка по строкам); Markdown не разбирается |

Текстовым считается файл с MIME `text/*`, `application/json` или расширением
из `TEXT_FILE_EXTENSIONS` (`.txt .md .markdown .csv .tsv .json .log .xml .yml .yaml`).
`TEXT_FILE_ACCEPT` и `IMAGE_ACCEPT` — значения `accept` для `<input type="file">`.

### Утилиты

`isImageFile(file)`, `isAudioFile(file)`, `isTextFile(file)` — проверки вида;
`formatBytes(1536)` → `'1.5 KB'`; `formatDuration(93)` → `'1:33'`;
`readTextFile(file, t)` и `textToParagraphs(text)` — чтение и разбивка текста.

## Пример

```ts
import type { UploadAdapter } from '@rich-editor/core';

const createUploader = (endpoint: string): UploadAdapter => async (file, ctx) => {
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('kind', ctx.kind);

  const response = await fetch(endpoint, { method: 'POST', body, signal: ctx.signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const data = (await response.json()) as { url: string; id: string };
  return { url: data.url, name: file.name, mime: file.type, size: file.size, meta: { id: data.id } };
};

createRichEditor({
  element,
  uploadImage: createUploader('/api/uploads/image'),
  uploadAudio: createUploader('/api/uploads/audio'),
  uploadFile: createUploader('/api/uploads/file'),
  limits: { maxImageSizeBytes: 5 * 1024 * 1024 },
  onError: (error) => toast(error.message),
});
```

## Ограничения

- Транскодирования нет: контейнер записи зависит от браузера (WebM/Opus, Ogg,
  MP4/AAC, MP3). Нормализуйте на сервере, если нужен один формат.
- Осциллограмма есть только у записанного в редакторе аудио; у файла,
  вставленного перетаскиванием, `duration` и `peaks` пустые.
- Нет UI для alt-текста, подписи и кадрирования картинок.
- Перетащенный текстовый файл всегда становится вложением, не текстом.

## См. также

- [02-core.md](02-core.md#поля-и-методы) — методы вставки медиа.
- [10-standalone-and-django.md](10-standalone-and-django.md) — готовые вьюхи
  загрузок для Django.
- [13-recipes.md](13-recipes.md#свой-адаптер-загрузки).
