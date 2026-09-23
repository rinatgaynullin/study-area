import { VoiceRecorder, isRecordingSupported } from '../../media/recorder';
import { RichEditorError } from '../../types';
import type { EditorLimits, Translate } from '../../types';
import { formatDuration } from '../../utils/format';
import { createDisposer, el, icon, on } from '../dom';
import { createModal } from '../modal';
import type { Modal } from '../modal';
import type { DialogComponent, EditorUiContext } from '../types';

/** Готовая запись, которую диалог отдаёт наружу. */
interface AudioRecorderResult {
  blob: Blob;
  duration: number;
  /** Пики осциллограммы для плеера: целые 0..99 через запятую. */
  peaks: string;
}

interface AudioRecorderDialogOptions {
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
 *
 * Класс, а не набор замыканий: фаза, рекордер и превью — общее изменяемое
 * состояние, а операции над ним (start/stop/reset) ссылаются друг на друга.
 */
class AudioRecorderDialogController implements DialogComponent<void> {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  /** Возможности браузера в рантайме не меняются — хватает одной проверки. */
  private readonly isSupported = isRecordingSupported();

  private phase: RecorderPhase = 'idle';

  private elapsed = 0;

  private message = '';

  private previewUrl = '';

  private recorder: VoiceRecorder | null = null;

  private result: AudioRecorderResult | null = null;

  /** Имя иконки в кружке: пересобираем её только при смене, а не каждый тик. */
  private indicatorIcon = '';

  /** Кружок с иконкой — украшение: состояние читалке сообщают кнопки. */
  private readonly indicator: HTMLElement;

  private readonly timeText: HTMLElement;

  private readonly limitText: HTMLElement;

  private readonly recorderRow: HTMLElement;

  private readonly hintText: HTMLElement;

  /**
   * Ошибка появляется в ответ на действие — объявляется сразу, не дожидаясь,
   * пока до неё дойдут Tab'ом.
   */
  private readonly errorText: HTMLElement;

  private readonly unsupportedText: HTMLElement;

  private readonly preview: HTMLAudioElement;

  private readonly recordButton: HTMLButtonElement;

  private readonly pauseButton: HTMLButtonElement;

  private readonly resumeButton: HTMLButtonElement;

  private readonly stopButton: HTMLButtonElement;

  private readonly rerecordButton: HTMLButtonElement;

  private readonly controls: HTMLElement;

  private readonly cancelButton: HTMLButtonElement;

  private readonly insertButton: HTMLButtonElement;

  private readonly modal: Modal;

  constructor(
    private readonly context: EditorUiContext,
    private readonly options: AudioRecorderDialogOptions,
  ) {
    const { t } = context;

    this.t = t;

    this.indicator = el('div', {
      class: 'rte-recorder__indicator',
      attrs: { 'aria-hidden': 'true' },
    });

    this.timeText = el('span', { class: 'rte-recorder__time' });
    this.limitText = el('span', { class: 'rte-recorder__limit' });

    this.recorderRow = el('div', {
      class: 'rte-recorder',
      children: [
        this.indicator,
        el('div', { class: 'rte-recorder__meta', children: [this.timeText, this.limitText] }),
      ],
    });

    this.hintText = el('p', { class: 'rte-recorder__hint', text: t('audio_permission_hint') });
    this.errorText = el('p', { class: 'rte-field__error', attrs: { role: 'alert' } });
    this.unsupportedText = el('p', { class: 'rte-field__error', text: t('audio_unsupported') });

    this.preview = el('audio', { class: 'rte-recorder__preview', attrs: { controls: true } });

    this.recordButton = this.createControl({
      labelKey: 'audio_record',
      iconName: 'record',
      primary: true,
      autofocus: this.isSupported,
    });

    this.pauseButton = this.createControl({ labelKey: 'audio_pause', iconName: 'pause' });
    this.resumeButton = this.createControl({ labelKey: 'audio_resume', iconName: 'play' });

    this.stopButton = this.createControl({
      labelKey: 'audio_stop',
      iconName: 'stop',
      primary: true,
    });

    this.rerecordButton = this.createControl({ labelKey: 'audio_rerecord' });

    this.controls = el('div', {
      class: 'rte-recorder__controls',
      children: [
        this.recordButton,
        this.pauseButton,
        this.resumeButton,
        this.stopButton,
        this.rerecordButton,
      ],
    });

    this.cancelButton = this.createControl({ labelKey: 'audio_cancel' });
    this.insertButton = this.createControl({ labelKey: 'audio_insert', primary: true });

    this.modal = createModal({
      title: t('audio_title'),
      closeLabel: t('common_close'),
      onClose: this.onModalClose,
    });

    this.modal.body.append(
      this.unsupportedText,
      this.recorderRow,
      this.hintText,
      this.errorText,
      this.preview,
      this.controls,
    );

    this.modal.footer.append(
      el('span', { class: 'rte-modal__spacer' }),
      this.cancelButton,
      this.insertButton,
    );

    this.element = this.modal.element;

    this.disposer.add(on(this.recordButton, 'click', this.onRecordButtonClick));
    this.disposer.add(on(this.rerecordButton, 'click', this.onRerecordButtonClick));
    this.disposer.add(on(this.pauseButton, 'click', this.onPauseButtonClick));
    this.disposer.add(on(this.resumeButton, 'click', this.onResumeButtonClick));
    this.disposer.add(on(this.stopButton, 'click', this.onStopButtonClick));
    this.disposer.add(on(this.cancelButton, 'click', this.onCancelButtonClick));
    this.disposer.add(on(this.insertButton, 'click', this.onInsertButtonClick));

    // Браузер не умеет записывать — показываем только объяснение.
    this.unsupportedText.hidden = this.isSupported;
    this.recorderRow.hidden = !this.isSupported;
    this.hintText.hidden = !this.isSupported;
    this.errorText.hidden = true;
    this.preview.hidden = true;
    this.controls.hidden = !this.isSupported;
    this.insertButton.disabled = true;

    this.setLevel(0);
    this.render();
  }

  /**
   * Пределы читаем у контекста при каждом обращении, а не один раз: хост
   * меняет их у живого редактора, и снимок оставил бы рекордер со старыми.
   */
  private get limits(): EditorLimits {
    return this.context.limits;
  }

  get isVisible(): boolean {
    return this.modal.isVisible;
  }

  /** Показывает диалог. */
  open(): void {
    // Пределы могли смениться с прошлого открытия — подпись должна быть свежей.
    this.render();
    this.modal.open();
  }

  /** Закрывает диалог; микрофон и дубль освобождает `onClose` модалки. */
  close(): void {
    this.modal.close();
  }

  /** Освобождает микрофон, слушатели и разметку. Идемпотентен. */
  destroy(): void {
    this.reset();
    this.disposer.dispose();
    this.modal.destroy();
  }

  private createControl(control: ControlOptions): HTMLButtonElement {
    return el('button', {
      class: control.primary ? 'rte-button rte-button--primary' : 'rte-button',
      attrs: { type: 'button', 'data-autofocus': control.autofocus ?? false },
      // Текст отдельным узлом: `text` затёр бы иконку.
      children: [
        control.iconName ? icon(control.iconName, 16) : null,
        document.createTextNode(this.t(control.labelKey)),
      ],
    });
  }

  /** Живая осциллограмма: кружок дышит в такт входному сигналу. */
  private setLevel(level: number): void {
    this.indicator.style.setProperty('--rte-level', String(0.6 + level * 0.6));
  }

  private setIndicatorIcon(name: string): void {
    if (this.indicatorIcon === name) return;

    this.indicatorIcon = name;
    this.indicator.replaceChildren(icon(name, 28));
  }

  private render(): void {
    if (!this.isSupported) return;

    const { phase, message } = this;
    const isActive = phase === 'recording' || phase === 'paused';

    this.indicator.classList.toggle('rte-recorder__indicator--live', phase === 'recording');
    this.setIndicatorIcon(phase === 'recording' ? 'record' : 'audio');

    this.timeText.textContent = formatDuration(this.elapsed);

    this.limitText.textContent = isActive
      ? this.t('audio_remaining', {
          time: formatDuration(Math.max(0, this.limits.maxAudioDurationSec - this.elapsed)),
        })
      : this.t('audio_duration_limit', { seconds: this.limits.maxAudioDurationSec });

    this.hintText.hidden = phase !== 'idle' || Boolean(message);
    this.errorText.textContent = message;
    this.errorText.hidden = !message;
    this.preview.hidden = !this.previewUrl;

    this.recordButton.hidden = phase !== 'idle';
    this.pauseButton.hidden = phase !== 'recording';
    this.resumeButton.hidden = phase !== 'paused';
    this.stopButton.hidden = !isActive;
    this.rerecordButton.hidden = phase !== 'ready';
    this.insertButton.disabled = phase !== 'ready';

    this.keepFocusVisible();
  }

  /**
   * Кнопки фазы сменяют друг друга: нажали «Записать» — она спряталась, и
   * фокус клавиатуры ушёл бы в никуда, а с ним и кольцо фокуса модалки.
   * Переводим его на первую кнопку новой фазы: «Остановить» после
   * «Записать», «Записать заново» после «Остановить».
   */
  private keepFocusVisible(): void {
    const active = document.activeElement;

    if (
      !(active instanceof HTMLElement)
      || !active.hidden
      || !this.modal.element.contains(active)
    ) {
      return;
    }

    [
      this.stopButton,
      this.pauseButton,
      this.resumeButton,
      this.rerecordButton,
      this.recordButton,
      this.insertButton,
    ]
      .find((button) => !button.hidden && !button.disabled)
      ?.focus();
  }

  private createRecorder(): VoiceRecorder {
    return new VoiceRecorder({
      t: this.t,
      maxDurationSec: this.limits.maxAudioDurationSec,
      maxSizeBytes: this.limits.maxAudioSizeBytes,
      onTick: this.onRecorderTick,
      onLimit: this.onRecorderLimit,
      onLevel: this.onRecorderLevel,
      onError: this.onRecorderError,
    });
  }

  private async start(): Promise<void> {
    this.message = '';
    this.releasePreview();

    const instance = this.createRecorder();

    this.recorder = instance;

    try {
      await instance.start();
      this.phase = 'recording';
      this.elapsed = 0;
    } catch {
      // Локализованную ошибку рекордер уже отдал через onError.
      this.phase = 'idle';
      this.recorder = null;
    }

    this.render();
  }

  private pause(): void {
    this.recorder?.pause();
    this.phase = 'paused';
    this.render();
  }

  private resume(): void {
    this.recorder?.resume();
    this.phase = 'recording';
    this.render();
  }

  private async stop(): Promise<void> {
    const instance = this.recorder;

    if (!instance) return;

    try {
      const recording = await instance.stop();

      this.result = recording;
      this.previewUrl = URL.createObjectURL(recording.blob);
      this.preview.src = this.previewUrl;
      this.elapsed = recording.duration;
      this.phase = 'ready';
    } catch {
      // Рекордер уже сообщил об ошибке через onError.
      this.phase = 'idle';
    } finally {
      this.recorder = null;
      this.render();
    }
  }

  private insert(): void {
    if (!this.result) return;

    this.options.onInsert(this.result);
    this.modal.close();
  }

  private releasePreview(): void {
    if (this.previewUrl) {
      // Плеер должен отпустить ссылку до отзыва, иначе останется с битым src.
      this.preview.pause();
      this.preview.removeAttribute('src');
      this.preview.load();
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }

    this.result = null;
  }

  private reset(): void {
    // cancel() останавливает поток микрофона и таймеры: без него индикатор
    // записи в браузере продолжит гореть после закрытия диалога.
    this.recorder?.cancel();
    this.recorder = null;
    this.releasePreview();
    this.phase = 'idle';
    this.elapsed = 0;
    this.message = '';
    this.setLevel(0);
    this.render();
  }

  /** Закрыли диалог любым способом — гасим микрофон и забываем дубль. */
  private readonly onModalClose = (): void => {
    this.reset();
  };

  private readonly onRecordButtonClick = (): void => {
    this.start().catch(this.onUnexpectedError);
  };

  private readonly onRerecordButtonClick = (): void => {
    this.start().catch(this.onUnexpectedError);
  };

  private readonly onPauseButtonClick = (): void => {
    this.pause();
  };

  private readonly onResumeButtonClick = (): void => {
    this.resume();
  };

  private readonly onStopButtonClick = (): void => {
    this.stop().catch(this.onUnexpectedError);
  };

  private readonly onCancelButtonClick = (): void => {
    this.modal.close();
  };

  private readonly onInsertButtonClick = (): void => {
    this.insert();
  };

  private readonly onRecorderTick = (value: number): void => {
    this.elapsed = value;
    this.render();
  };

  private readonly onRecorderLimit = (): void => {
    // Предел длительности или размера: рекордер уже на паузе, записанное
    // цело. Финализируем дубль сами — продолжать пользователю нечего, а
    // «стоп» руками был бы лишним шагом. Ошибку размера рекордер уже
    // сообщил через onError, и она останется на экране рядом с дублем.
    this.phase = 'paused';
    this.stop().catch(this.onUnexpectedError);
  };

  private readonly onRecorderLevel = (level: number): void => {
    this.setLevel(level);
  };

  private readonly onRecorderError = (error: RichEditorError): void => {
    this.message = error.message;
    this.options.onError(error);
    this.render();
  };

  /**
   * Сбой, которого start/stop не ждали. Свои ошибки рекордер уже отдал через
   * onError и они перехвачены внутри шага; сюда доходит только неожиданное,
   * и оно идёт тем же путём — в строку ошибки и хосту, а не в необработанное
   * отклонение промиса.
   */
  private readonly onUnexpectedError = (cause: unknown): void => {
    this.onRecorderError(
      new RichEditorError('recorder-failed', this.t('error_recorder_failed'), cause),
    );
  };
}

/**
 * Собирает диалог записи голосового сообщения.
 *
 * Тонкая обёртка над {@link AudioRecorderDialogController}: оболочке редактора
 * нужен только контракт `DialogComponent`.
 */
export const createAudioRecorderDialog = (
  context: EditorUiContext,
  options: AudioRecorderDialogOptions,
): DialogComponent<void> => new AudioRecorderDialogController(context, options);
