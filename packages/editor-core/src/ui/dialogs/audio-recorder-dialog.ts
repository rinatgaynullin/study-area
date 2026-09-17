import { VoiceRecorder, isRecordingSupported } from '../../media/recorder';
import type { RichEditorError } from '../../types';
import { formatDuration } from '../../utils/format';
import { createDisposer, el, icon, on } from '../dom';
import { createModal } from '../modal';
import type { DialogComponent, EditorUiContext } from '../types';

/** Готовая запись, которую диалог отдаёт наружу. */
export interface AudioRecorderResult {
  blob: Blob;
  duration: number;
  /** Пики осциллограммы для плеера: целые 0..99 через запятую. */
  peaks: string;
}

export interface AudioRecorderDialogOptions {
  onInsert(payload: AudioRecorderResult): void;
  /** Ошибки рекордера: нет разрешения, не поддерживается, превышен предел. */
  onError(error: RichEditorError): void;
}

/** Что показывает диалог прямо сейчас. Интерфейсом объединение не выразить. */
type RecorderPhase = 'idle' | 'recording' | 'paused' | 'ready';

interface ControlOptions {
  labelKey: string;
  /** Имя иконки из встроенного набора. Без неё кнопка остаётся текстовой. */
  iconName?: string;
  primary?: boolean;
  autofocus?: boolean;
}

/**
 * Диалог записи голосового сообщения.
 *
 * Сама запись живёт в `VoiceRecorder`: диалог только рисует её состояние и
 * отдаёт готовую дорожку наружу. Ограничение длительности тоже не его забота —
 * рекордер на пределе встаёт на паузу, сохраняя всё записанное, а диалог лишь
 * финализирует дубль, чтобы им можно было пользоваться.
 */
export function createAudioRecorderDialog(
  context: EditorUiContext,
  options: AudioRecorderDialogOptions,
): DialogComponent<void> {
  const { t } = context;
  const disposer = createDisposer();

  /**
   * Пределы читаем у контекста при каждом обращении, а не один раз: хост
   * меняет их у живого редактора, и снимок оставил бы рекордер со старыми.
   */
  const limits = () => context.limits;

  /** Возможности браузера в рантайме не меняются — хватает одной проверки. */
  const supported = isRecordingSupported();

  let phase: RecorderPhase = 'idle';
  let elapsed = 0;
  let message = '';
  let previewUrl = '';
  let recorder: VoiceRecorder | null = null;
  let result: AudioRecorderResult | null = null;
  /** Имя иконки в кружке: пересобираем её только при смене, а не каждый тик. */
  let indicatorIcon = '';

  function createControl(control: ControlOptions): HTMLButtonElement {
    return el('button', {
      class: control.primary ? 'rte-button rte-button--primary' : 'rte-button',
      attrs: { type: 'button', 'data-autofocus': control.autofocus ?? false },
      // Текст отдельным узлом: `text` затёр бы иконку.
      children: [
        control.iconName ? icon(control.iconName, 16) : null,
        document.createTextNode(t(control.labelKey)),
      ],
    });
  }

  const indicator = el('div', { class: 'rte-recorder__indicator' });
  const timeText = el('span', { class: 'rte-recorder__time' });
  const limitText = el('span', { class: 'rte-recorder__limit' });

  const recorderRow = el('div', {
    class: 'rte-recorder',
    children: [
      indicator,
      el('div', { class: 'rte-recorder__meta', children: [timeText, limitText] }),
    ],
  });

  const hintText = el('p', { class: 'rte-recorder__hint', text: t('audio_permission_hint') });
  const errorText = el('p', { class: 'rte-field__error' });
  const unsupportedText = el('p', { class: 'rte-field__error', text: t('audio_unsupported') });

  const preview = el('audio', { class: 'rte-recorder__preview', attrs: { controls: true } });

  const recordButton = createControl({
    labelKey: 'audio_record',
    iconName: 'record',
    primary: true,
    autofocus: supported,
  });
  const pauseButton = createControl({ labelKey: 'audio_pause', iconName: 'pause' });
  const resumeButton = createControl({ labelKey: 'audio_resume', iconName: 'play' });
  const stopButton = createControl({ labelKey: 'audio_stop', iconName: 'stop', primary: true });
  const rerecordButton = createControl({ labelKey: 'audio_rerecord' });

  const controls = el('div', {
    class: 'rte-recorder__controls',
    children: [recordButton, pauseButton, resumeButton, stopButton, rerecordButton],
  });

  const cancelButton = createControl({ labelKey: 'audio_cancel' });
  const insertButton = createControl({ labelKey: 'audio_insert', primary: true });

  const modal = createModal({
    title: t('audio_title'),
    closeLabel: t('common_close'),
    // Закрыли диалог любым способом — гасим микрофон и забываем дубль.
    onClose: reset,
  });

  modal.body.append(unsupportedText, recorderRow, hintText, errorText, preview, controls);
  modal.footer.append(el('span', { class: 'rte-modal__spacer' }), cancelButton, insertButton);

  /** Живая осциллограмма: кружок дышит в такт входному сигналу. */
  function setLevel(level: number): void {
    indicator.style.setProperty('--rte-level', String(0.6 + level * 0.6));
  }

  function setIndicatorIcon(name: string): void {
    if (indicatorIcon === name) return;
    indicatorIcon = name;
    indicator.replaceChildren(icon(name, 28));
  }

  function render(): void {
    if (!supported) return;

    const isActive = phase === 'recording' || phase === 'paused';

    indicator.classList.toggle('rte-recorder__indicator--live', phase === 'recording');
    setIndicatorIcon(phase === 'recording' ? 'record' : 'audio');

    timeText.textContent = formatDuration(elapsed);
    limitText.textContent = isActive
      ? t('audio_remaining', {
          time: formatDuration(Math.max(0, limits().maxAudioDurationSec - elapsed)),
        })
      : t('audio_duration_limit', { seconds: limits().maxAudioDurationSec });

    hintText.hidden = phase !== 'idle' || Boolean(message);
    errorText.textContent = message;
    errorText.hidden = !message;
    preview.hidden = !previewUrl;

    recordButton.hidden = phase !== 'idle';
    pauseButton.hidden = phase !== 'recording';
    resumeButton.hidden = phase !== 'paused';
    stopButton.hidden = !isActive;
    rerecordButton.hidden = phase !== 'ready';
    insertButton.disabled = phase !== 'ready';
  }

  function createRecorder(): VoiceRecorder {
    return new VoiceRecorder({
      t,
      maxDurationSec: limits().maxAudioDurationSec,
      maxSizeBytes: limits().maxAudioSizeBytes,
      onTick: (value) => {
        elapsed = value;
        render();
      },
      onLimit: () => {
        // Предел длительности или размера: рекордер уже на паузе, записанное
        // цело. Финализируем дубль сами — продолжать пользователю нечего, а
        // «стоп» руками был бы лишним шагом. Ошибку размера рекордер уже
        // сообщил через onError, и она останется на экране рядом с дублем.
        phase = 'paused';
        void stop();
      },
      onLevel: setLevel,
      onError: (error) => {
        message = error.message;
        options.onError(error);
        render();
      },
    });
  }

  async function start(): Promise<void> {
    message = '';
    releasePreview();

    const instance = createRecorder();
    recorder = instance;

    try {
      await instance.start();
      phase = 'recording';
      elapsed = 0;
    } catch {
      // Локализованную ошибку рекордер уже отдал через onError.
      phase = 'idle';
      recorder = null;
    }

    render();
  }

  function pause(): void {
    recorder?.pause();
    phase = 'paused';
    render();
  }

  function resume(): void {
    recorder?.resume();
    phase = 'recording';
    render();
  }

  async function stop(): Promise<void> {
    const instance = recorder;
    if (!instance) return;

    try {
      const recording = await instance.stop();
      result = recording;
      previewUrl = URL.createObjectURL(recording.blob);
      preview.src = previewUrl;
      elapsed = recording.duration;
      phase = 'ready';
    } catch {
      // Рекордер уже сообщил об ошибке через onError.
      phase = 'idle';
    } finally {
      recorder = null;
      render();
    }
  }

  function insert(): void {
    if (!result) return;
    options.onInsert(result);
    modal.close();
  }

  function releasePreview(): void {
    if (previewUrl) {
      // Плеер должен отпустить ссылку до отзыва, иначе останется с битым src.
      preview.pause();
      preview.removeAttribute('src');
      preview.load();
      URL.revokeObjectURL(previewUrl);
      previewUrl = '';
    }

    result = null;
  }

  function reset(): void {
    // cancel() останавливает поток микрофона и таймеры: без него индикатор
    // записи в браузере продолжит гореть после закрытия диалога.
    recorder?.cancel();
    recorder = null;
    releasePreview();
    phase = 'idle';
    elapsed = 0;
    message = '';
    setLevel(0);
    render();
  }

  disposer.add(on(recordButton, 'click', () => void start()));
  disposer.add(on(rerecordButton, 'click', () => void start()));
  disposer.add(on(pauseButton, 'click', pause));
  disposer.add(on(resumeButton, 'click', resume));
  disposer.add(on(stopButton, 'click', () => void stop()));
  disposer.add(on(cancelButton, 'click', () => modal.close()));
  disposer.add(on(insertButton, 'click', insert));

  // Браузер не умеет записывать — показываем только объяснение.
  unsupportedText.hidden = supported;
  recorderRow.hidden = !supported;
  hintText.hidden = !supported;
  errorText.hidden = true;
  preview.hidden = true;
  controls.hidden = !supported;
  insertButton.disabled = true;

  setLevel(0);
  render();

  return {
    element: modal.element,
    open: () => {
      // Пределы могли смениться с прошлого открытия — подпись должна быть свежей.
      render();
      modal.open();
    },
    close: () => modal.close(),
    get isVisible() {
      return modal.isVisible;
    },
    destroy: () => {
      reset();
      disposer.dispose();
      modal.destroy();
    },
  };
}
