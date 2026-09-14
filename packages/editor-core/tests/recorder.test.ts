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

  start(): void {
    this.state = 'recording';
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  stop(): void {
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

const t = createI18n().t;
const tracks = [{ stop: vi.fn() }];

function installMocks(): void {
  MockMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  installMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createRecorder(overrides: Partial<ConstructorParameters<typeof VoiceRecorder>[0]> = {}) {
  return new VoiceRecorder({
    t,
    maxDurationSec: 5,
    maxSizeBytes: 1024,
    ...overrides,
  });
}

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
    expect((onError.mock.calls[0][0] as RichEditorError).code).toBe('file-too-large');
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
