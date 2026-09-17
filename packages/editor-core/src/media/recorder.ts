import { RichEditorError, type Translate } from '../types';
import { formatBytes } from '../utils/format';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

/** Какой из пределов остановил запись. */
export type RecorderLimit = 'duration' | 'size';

export interface RecordingResult {
  blob: Blob;
  mime: string;
  /** Seconds of actual recorded audio, excluding paused time. */
  duration: number;
  /** Comma-separated waveform peaks (0..99) for the player. */
  peaks: string;
}

export interface VoiceRecorderOptions {
  t: Translate;
  maxDurationSec: number;
  maxSizeBytes: number;
  onTick?: (elapsedSec: number) => void;
  onStateChange?: (state: RecorderState) => void;
  /**
   * Достигнут предел длительности или размера. К этому моменту рекордер уже
   * встал на паузу и записанное цело; вызывающий решает, финализировать ли
   * дубль или дать пользователю прослушать и переписать.
   */
  onLimit?: (reason: RecorderLimit) => void;
  /** Live input level 0..1, for a recording indicator. */
  onLevel?: (level: number) => void;
  onError?: (error: RichEditorError) => void;
}

/**
 * Candidate containers in preference order. The first one the browser reports
 * as supported wins; if none match we let MediaRecorder pick its own default.
 */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/mpeg',
];

const PEAK_COUNT = 48;

function getMediaRecorder(): typeof MediaRecorder | undefined {
  return (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
}

export function isRecordingSupported(): boolean {
  const Recorder = getMediaRecorder();
  return (
    typeof Recorder === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Picks the best supported container, or `undefined` to use the browser default. */
export function pickAudioMimeType(): string | undefined {
  const Recorder = getMediaRecorder();
  if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return undefined;
  return MIME_CANDIDATES.find((candidate) => Recorder.isTypeSupported(candidate));
}

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private levels: number[] = [];
  private state: RecorderState = 'idle';

  private startedAt = 0;
  private accumulatedMs = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private bytes = 0;

  constructor(private options: VoiceRecorderOptions) {}

  getState(): RecorderState {
    return this.state;
  }

  /** Elapsed recorded seconds, excluding paused time. */
  getElapsed(): number {
    const running = this.state === 'recording' ? Date.now() - this.startedAt : 0;
    return (this.accumulatedMs + running) / 1000;
  }

  async start(): Promise<void> {
    if (!isRecordingSupported()) {
      throw this.fail(
        new RichEditorError('recorder-unsupported', this.options.t('error_recorder_unsupported')),
      );
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      const denied =
        cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');
      throw this.fail(
        new RichEditorError(
          denied ? 'recorder-permission-denied' : 'recorder-failed',
          this.options.t(
            denied ? 'error_recorder_permission_denied' : 'error_recorder_failed',
          ),
          cause,
        ),
      );
    }

    this.stream = stream;
    this.chunks = [];
    this.levels = [];
    this.bytes = 0;
    this.accumulatedMs = 0;

    const Recorder = getMediaRecorder()!;
    const mimeType = pickAudioMimeType();

    try {
      this.recorder = new Recorder(stream, mimeType ? { mimeType } : undefined);
    } catch (cause) {
      this.releaseStream();
      throw this.fail(
        new RichEditorError('recorder-failed', this.options.t('error_recorder_failed'), cause),
      );
    }

    this.recorder.addEventListener('dataavailable', this.onData);
    this.recorder.addEventListener('error', this.onRecorderError);

    this.recorder.start(250);
    this.startedAt = Date.now();
    this.setState('recording');
    this.startTicking();
    this.startLevelMetering(stream);
  }

  pause(): void {
    if (this.state !== 'recording' || !this.recorder) return;
    // Своё состояние и состояние MediaRecorder могут разойтись: браузер
    // останавливает запись сам, когда обрывается трек (микрофон отключили,
    // разрешение отозвали). У неактивного рекордера pause() бросает
    // InvalidStateError, поэтому сверяемся с ним, а не только с собой.
    if (this.recorder.state === 'recording') this.recorder.pause();
    this.accumulatedMs += Date.now() - this.startedAt;
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused' || !this.recorder) return;
    if (this.recorder.state === 'paused') this.recorder.resume();
    this.startedAt = Date.now();
    this.setState('recording');
  }

  /** Stops recording and resolves with the encoded blob, duration and peaks. */
  async stop(): Promise<RecordingResult> {
    const recorder = this.recorder;
    if (!recorder || this.state === 'idle' || this.state === 'stopped') {
      throw this.fail(
        new RichEditorError('recorder-failed', this.options.t('error_recorder_failed')),
      );
    }

    if (this.state === 'recording') this.accumulatedMs += Date.now() - this.startedAt;
    const duration = this.accumulatedMs / 1000;

    const blob = await new Promise<Blob>((resolve) => {
      const finish = (): void => {
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
      };

      // Браузер уже остановил запись сам: события stop не будет, а stop()
      // на неактивном рекордере бросит InvalidStateError. Куски к этому
      // моменту отданы, так что собираем дорожку из того, что есть.
      if (recorder.state === 'inactive') {
        finish();
        return;
      }

      recorder.addEventListener('stop', finish, { once: true });
      recorder.stop();
    });

    this.teardown();
    this.setState('stopped');

    return {
      blob,
      mime: blob.type || recorder.mimeType || 'audio/webm',
      duration,
      peaks: this.buildPeaks(),
    };
  }

  /** Aborts the recording and drops everything captured so far. */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // Already stopped; nothing to clean up beyond teardown below.
      }
    }
    this.chunks = [];
    this.teardown();
    this.setState('idle');
  }

  private onData = (event: Event) => {
    const blobEvent = event as BlobEvent;
    if (!blobEvent.data || blobEvent.data.size === 0) return;

    this.chunks.push(blobEvent.data);
    this.bytes += blobEvent.data.size;

    if (this.bytes > this.options.maxSizeBytes) {
      this.options.onError?.(
        new RichEditorError(
          'file-too-large',
          this.options.t('error_audio_too_large', { max: formatBytes(this.options.maxSizeBytes) }),
        ),
      );
      this.stopAtLimit('size');
    }
  };

  private onRecorderError = (event: Event) => {
    this.options.onError?.(
      new RichEditorError('recorder-failed', this.options.t('error_recorder_failed'), event),
    );
  };

  private startTicking(): void {
    this.stopTicking();
    this.tickTimer = setInterval(() => {
      const elapsed = this.getElapsed();
      this.options.onTick?.(elapsed);
      if (elapsed >= this.options.maxDurationSec) this.stopAtLimit('duration');
    }, 200);
  }

  private stopTicking(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Предел соблюдается паузой, а не остановкой: последующий `stop()` отдаёт
   * всё, что записано до предела. О самом пределе сообщаем отдельно — по
   * паузе вызывающий не отличил бы его от паузы руками.
   */
  private stopAtLimit(reason: RecorderLimit): void {
    if (this.state === 'recording') this.pause();
    this.stopTicking();
    this.options.onLimit?.(reason);
  }

  private startLevelMetering(stream: MediaStream): void {
    const Ctor =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // Waveform is a nicety; recording works without it.

    try {
      this.audioContext = new Ctor();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      const buffer = new Uint8Array(this.analyser.frequencyBinCount);
      this.levelTimer = setInterval(() => {
        if (!this.analyser || this.state !== 'recording') return;
        this.analyser.getByteTimeDomainData(buffer);

        let sum = 0;
        for (const sample of buffer) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / buffer.length);
        this.levels.push(rms);
        this.options.onLevel?.(Math.min(1, rms * 2));
      }, 100);
    } catch {
      this.audioContext = null;
      this.analyser = null;
    }
  }

  /** Downsamples the captured RMS levels to a fixed-width 0..99 peak string. */
  private buildPeaks(): string {
    if (this.levels.length === 0) return '';

    const peaks: number[] = [];
    const bucketSize = this.levels.length / PEAK_COUNT;
    const loudest = Math.max(...this.levels, 0.01);

    for (let index = 0; index < PEAK_COUNT; index += 1) {
      const start = Math.floor(index * bucketSize);
      const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
      const slice = this.levels.slice(start, end);
      const peak = slice.length > 0 ? Math.max(...slice) : 0;
      peaks.push(Math.round(Math.min(99, (peak / loudest) * 99)));
    }

    return peaks.join(',');
  }

  private setState(state: RecorderState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private fail(error: RichEditorError): RichEditorError {
    this.options.onError?.(error);
    return error;
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private teardown(): void {
    this.stopTicking();
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    if (this.recorder) {
      this.recorder.removeEventListener('dataavailable', this.onData);
      this.recorder.removeEventListener('error', this.onRecorderError);
    }
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.analyser = null;
    this.releaseStream();
  }
}
