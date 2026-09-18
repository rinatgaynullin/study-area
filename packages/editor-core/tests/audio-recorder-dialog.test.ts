import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRichEditor, ru, type RichEditorUi } from '../src';

/**
 * Диалог записи поверх ванильной оболочки. Сам рекордер покрыт своими тестами;
 * здесь проверяется связка: то, что рекордер сообщает о пределе, диалог
 * действительно превращает в готовый дубль, а не оставляет «идёт запись».
 */
class MockMediaRecorder extends EventTarget {
  static instances: MockMediaRecorder[] = [];

  static isTypeSupported(): boolean {
    return true;
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';

  constructor() {
    super();
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

  emitChunk(size: number): void {
    const event = new Event('dataavailable') as Event & { data: Blob };
    Object.defineProperty(event, 'data', {
      value: new Blob([new Uint8Array(size)], { type: this.mimeType }),
    });
    this.dispatchEvent(event);
  }
}

let ui: RichEditorUi | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  MockMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  });
});

afterEach(() => {
  ui?.destroy();
  ui = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function openDialog(): HTMLElement {
  [...document.querySelectorAll<HTMLButtonElement>('.rte-toolbar button')]
    .find((button) => button.getAttribute('aria-label') === ru.toolbar_audio)!
    .click();

  return document.querySelector<HTMLElement>('.rte-modal:not([hidden])')!;
}

function openRecorder(options: Record<string, unknown> = {}): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  ui = createRichEditor({ element: host, ...options });
  return openDialog();
}

function control(dialog: HTMLElement, label: string): HTMLButtonElement {
  const found = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Нет кнопки «${label}»`);
  return found;
}

describe('диалог записи и пределы редактора', () => {
  it('видит пределы, изменённые после создания редактора', async () => {
    const dialog = openRecorder({ limits: { maxAudioDurationSec: 30 } });
    expect(dialog.querySelector('.rte-recorder__limit')?.textContent).toContain('30');
    dialog.querySelector<HTMLButtonElement>('.rte-modal__close')!.click();

    // Хост поменял пределы у живого редактора — снимок при создании диалога
    // оставил бы здесь 30 и остановил бы запись не там, где обещано.
    ui!.setLimits({ maxAudioDurationSec: 7 });

    const reopened = openDialog();
    expect(reopened.querySelector('.rte-recorder__limit')?.textContent).toContain('7');

    control(reopened, ru.audio_record).click();
    await vi.advanceTimersByTimeAsync(7400);
    await vi.runAllTimersAsync();
    expect(control(reopened, ru.audio_insert).disabled).toBe(false);
  });
});

describe('диалог записи на пределах', () => {
  it('на пределе длительности сам финализирует дубль', async () => {
    const dialog = openRecorder({ limits: { maxAudioDurationSec: 1 } });
    const insert = control(dialog, ru.audio_insert);

    control(dialog, ru.audio_record).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(insert.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(1400);
    await vi.runAllTimersAsync();

    expect(insert.disabled).toBe(false);
    expect(control(dialog, ru.audio_stop).hidden).toBe(true);
  });

  it('на пределе размера тоже финализирует, а не показывает «идёт запись»', async () => {
    const onError = vi.fn();
    const dialog = openRecorder({ limits: { maxAudioSizeBytes: 100 }, onError });
    const insert = control(dialog, ru.audio_insert);

    control(dialog, ru.audio_record).click();
    await vi.advanceTimersByTimeAsync(0);

    // Раньше рекордер вставал на паузу молча, и диалог оставался в фазе
    // записи: индикатор горел, кнопка «Стоп» ждала, вставить было нельзя.
    MockMediaRecorder.instances[0].emitChunk(150);
    await vi.runAllTimersAsync();

    expect(insert.disabled).toBe(false);
    expect(control(dialog, ru.audio_stop).hidden).toBe(true);
    expect(dialog.querySelector('.rte-recorder__indicator--live')).toBeNull();
    // Причина остановки остаётся на экране рядом с готовым дублем.
    expect(dialog.querySelector<HTMLElement>('.rte-field__error:not([hidden])')?.textContent).toBe(
      (onError.mock.calls[0][0] as Error).message,
    );
  });
});

describe('диалог записи с клавиатуры', () => {
  it('фокус переходит на кнопку новой фазы, когда нажатая прячется', async () => {
    const dialog = openRecorder();
    // Модалка отдаёт фокус помеченной кнопке в следующем кадре.
    await vi.advanceTimersByTimeAsync(50);

    const record = control(dialog, ru.audio_record);
    expect(document.activeElement).toBe(record);

    // «Записать» спряталась — фокус ушёл бы в никуда, а кольцо модалки
    // с ним. Он должен оказаться на «Остановить».
    record.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(record.hidden).toBe(true);
    expect(document.activeElement).toBe(control(dialog, ru.audio_stop));

    // Дубль записан — «Остановить» прячется, фокус переходит на «Записать заново».
    MockMediaRecorder.instances[0].emitChunk(150);
    control(dialog, ru.audio_stop).click();
    await vi.runAllTimersAsync();
    expect(control(dialog, ru.audio_stop).hidden).toBe(true);
    expect(document.activeElement).toBe(control(dialog, ru.audio_rerecord));
  });

  it('ошибка объявляется сразу, индикатор для читалки не существует', () => {
    const dialog = openRecorder();
    expect(dialog.querySelector('.rte-field__error:not([hidden])')).toBeNull();
    expect(
      [...dialog.querySelectorAll('.rte-field__error')].some((p) => p.getAttribute('role') === 'alert'),
    ).toBe(true);
    expect(dialog.querySelector('.rte-recorder__indicator')?.getAttribute('aria-hidden')).toBe('true');
  });
});
