import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VoiceRecorder,
  createI18n,
  isRecordingSupported,
  pickAudioMimeType,
  type RichEditorError,
} from '../src';

/** Minimal MediaRecorder stand-in: jsdom ships neither it nor getUserMedia. */
class MockMediaRecorder extends EventTarget {
  static supported = ['audio/webm;codecs=opus', 'audio/webm'];

  static instances: MockMediaRecorder[] = [];

  static isTypeSupported(type: string): boolean {
    return MockMediaRecorder.supported.includes(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';

  mimeType: string;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    super();
    this.mimeType = options?.mimeType ?? 'audio/webm';
    MockMediaRecorder.instances.push(this);
  }

  /** Как настоящий MediaRecorder: вызов не из того состояния — исключение. */
  private assertState(expected: MockMediaRecorder['state'], method: string): void {
    if (this.state !== expected) {
      throw new DOMException(`${method}() in state ${this.state}`, 'InvalidStateError');
    }
  }

  start(): void {
    this.assertState('inactive', 'start');
    this.state = 'recording';
  }

  pause(): void {
    this.assertState('recording', 'pause');
    this.state = 'paused';
  }

  resume(): void {
    this.assertState('paused', 'resume');
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') {
      throw new DOMException('stop() in state inactive', 'InvalidStateError');
    }

    this.state = 'inactive';
    this.dispatchEvent(new Event('stop'));
  }

  /** Браузер остановил запись сам: трек оборвался. Наш stop() не вызывался. */
  endedByBrowser(): void {
    this.state = 'inactive';
    this.dispatchEvent(new Event('stop'));
  }

  /** Simulates the recorder handing over an encoded chunk. */
  emitChunk(size: number): void {
    const event = new Event('dataavailable') as Event & { data: Blob };

    Object.defineProperty(event, 'data', {
      value: new Blob([new Uint8Array(size)], { type: this.mimeType }),
    });

    this.dispatchEvent(event);
  }
}

const { t } = createI18n();
const tracks = [{ stop: vi.fn() }];

const installMocks = (): void => {
  MockMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) },
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  installMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const createRecorder = (overrides: Partial<ConstructorParameters<typeof VoiceRecorder>[0]> = {}) =>
  new VoiceRecorder({
    t,
    maxDurationSec: 5,
    maxSizeBytes: 1024,
    ...overrides,
  });

describe('feature detection', () => {
  it('reports support when MediaRecorder and getUserMedia are present', () => {
    expect(isRecordingSupported()).toBe(true);
  });

  it('reports no support when MediaRecorder is missing', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(isRecordingSupported()).toBe(false);
  });

  it('picks the first container the browser reports as supported', () => {
    expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');

    MockMediaRecorder.supported = ['audio/mp4'];
    expect(pickAudioMimeType()).toBe('audio/mp4');

    MockMediaRecorder.supported = [];
    expect(pickAudioMimeType()).toBeUndefined();

    MockMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm'];
  });

  it('fails with a localized error when recording is unsupported', async () => {
    vi.stubGlobal('MediaRecorder', undefined);

    const onError = vi.fn();

    await expect(createRecorder({ onError }).start()).rejects.toMatchObject({
      code: 'recorder-unsupported',
    });

    expect((onError.mock.calls[0][0] as RichEditorError).message).toContain('Запись звука');
  });

  it('distinguishes a denied microphone from other failures', async () => {
    const denied = new Error('denied');

    denied.name = 'NotAllowedError';

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(denied)) },
    });

    await expect(createRecorder().start()).rejects.toMatchObject({
      code: 'recorder-permission-denied',
    });
  });
});

describe('recording lifecycle', () => {
  it('produces a blob, duration and peaks on stop', async () => {
    const recorder = createRecorder();

    await recorder.start();
    expect(recorder.getState()).toBe('recording');

    MockMediaRecorder.instances[0].emitChunk(64);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await recorder.stop();

    expect(result.blob.size).toBe(64);
    expect(result.mime).toContain('audio/webm');
    expect(result.duration).toBeGreaterThanOrEqual(2);
    expect(recorder.getState()).toBe('stopped');
  });

  it('excludes paused time from the reported duration', async () => {
    const recorder = createRecorder();

    await recorder.start();

    await vi.advanceTimersByTimeAsync(1000);
    recorder.pause();
    expect(recorder.getState()).toBe('paused');

    await vi.advanceTimersByTimeAsync(3000);
    recorder.resume();
    await vi.advanceTimersByTimeAsync(1000);

    MockMediaRecorder.instances[0].emitChunk(16);

    const result = await recorder.stop();

    expect(result.duration).toBeGreaterThanOrEqual(2);
    expect(result.duration).toBeLessThan(3);
  });

  it('survives the browser ending the recording on its own', async () => {
    const onError = vi.fn();
    const recorder = createRecorder({ onError });

    await recorder.start();
    MockMediaRecorder.instances[0].emitChunk(40);
    // Трек оборвался: микрофон отключили или отозвали разрешение. Настоящий
    // MediaRecorder переходит в inactive без нашего участия, и pause()/stop()
    // на нём бросают InvalidStateError.
    MockMediaRecorder.instances[0].endedByBrowser();

    // Пауза по пределу не должна упасть в таймере, где её никто не поймает.
    await vi.advanceTimersByTimeAsync(5400);
    expect(recorder.getState()).toBe('paused');

    // А stop() отдаёт то, что успело записаться, и освобождает микрофон.
    const result = await recorder.stop();

    expect(result.blob.size).toBe(40);
    expect(recorder.getState()).toBe('stopped');
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('releases the microphone when cancelled', async () => {
    const recorder = createRecorder();

    await recorder.start();
    recorder.cancel();

    expect(recorder.getState()).toBe('idle');
    expect(tracks[0].stop).toHaveBeenCalled();
  });
});

describe('configured limits', () => {
  it('stops recording once the duration limit is reached', async () => {
    const onStateChange = vi.fn();
    const recorder = createRecorder({ maxDurationSec: 2, onStateChange });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(2400);

    // The recorder pauses itself at the cap rather than running past it.
    expect(recorder.getState()).toBe('paused');
    expect(recorder.getElapsed()).toBeLessThan(3);
  });

  it('reports which limit stopped the recording', async () => {
    const onLimit = vi.fn();
    const recorder = createRecorder({ maxDurationSec: 1, maxSizeBytes: 100, onLimit });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(1200);
    expect(onLimit).toHaveBeenCalledWith('duration');

    // Пауза по пределу и пауза руками для рекордера одно и то же состояние —
    // различить их вызывающий может только по этому колбэку.
    const another = createRecorder({ maxSizeBytes: 100, onLimit });

    await another.start();
    MockMediaRecorder.instances[1].emitChunk(150);
    expect(onLimit).toHaveBeenLastCalledWith('size');
  });

  it('finalizes a take stopped right inside onLimit', async () => {
    // Диалог финализирует дубль прямо из колбэка предела. К этому моменту
    // MediaRecorder уже должен стоять на паузе, иначе stop() наложится на
    // pause() и один из них бросит InvalidStateError.
    const recorder = createRecorder({
      maxDurationSec: 1,
      onLimit: () => {
        recorder.stop();
      },
    });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTimersAsync();

    expect(recorder.getState()).toBe('stopped');
  });

  it('honours a duration limit raised through options', async () => {
    const recorder = createRecorder({ maxDurationSec: 10 });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(4000);

    expect(recorder.getState()).toBe('recording');
  });

  it('reports an error and stops when the size limit is exceeded', async () => {
    const onError = vi.fn();
    const recorder = createRecorder({ maxSizeBytes: 100, onError });

    await recorder.start();
    MockMediaRecorder.instances[0].emitChunk(150);

    expect(onError).toHaveBeenCalledTimes(1);

    const error = onError.mock.calls[0][0] as RichEditorError;

    expect(error.code).toBe('file-too-large');
    // Про размер, а не про длительность: текст должен называть настоящий предел.
    expect(error.message).toContain('100 B');
    expect(recorder.getState()).toBe('paused');
  });

  it('keeps recording while chunks stay within the size limit', async () => {
    const onError = vi.fn();
    const recorder = createRecorder({ maxSizeBytes: 1000, onError });

    await recorder.start();
    MockMediaRecorder.instances[0].emitChunk(400);
    MockMediaRecorder.instances[0].emitChunk(400);

    expect(onError).not.toHaveBeenCalled();
    expect(recorder.getState()).toBe('recording');
  });

  it('reports elapsed time through onTick', async () => {
    const onTick = vi.fn();
    const recorder = createRecorder({ onTick });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(600);

    expect(onTick).toHaveBeenCalled();
    expect(onTick.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
  });
});
