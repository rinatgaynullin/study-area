import { Node, mergeAttributes } from '@tiptap/core';
import type { AudioAttributes, Translate } from '../types';
import { focusEditorView } from '../utils/focus-editor-view';
import { formatDuration } from '../utils/format';

/** Настройки узла: переводчик подписей плеера и атрибуты обёртки. */
export interface AudioOptions {
  t: Translate;
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    audioMessage: {
      insertAudio: (attributes: AudioAttributes) => ReturnType;
    };
  }
}

/** Имя узла голосового сообщения в схеме. */
export const AUDIO_NODE_NAME = 'audioMessage';

/** Шаг перемотки с клавиатуры, секунды. */
const SEEK_STEP_SEC = 5;

const parsePeaks = (raw: string | null): number[] => {
  if (!raw) return [];

  return raw
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 99);
};

/**
 * Voice message block. Exported HTML carries a plain `<audio controls>` so the
 * document stays playable outside the editor; inside the editor a node view
 * replaces it with the waveform player.
 */
export const AudioNode = Node.create<AudioOptions>({
  name: AUDIO_NODE_NAME,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions: () => ({ t: (key: string) => key, HTMLAttributes: {} }),

  addAttributes: () => ({
    src: {
      default: '',
      parseHTML: (element) =>
        element.getAttribute('data-src')
        ?? element.querySelector('audio')?.getAttribute('src')
        ?? '',
      renderHTML: () => ({}),
    },
    name: {
      default: null,
      parseHTML: (element) => element.getAttribute('data-name'),
      renderHTML: (attributes) =>
        attributes.name ? { 'data-name': attributes.name as string } : {},
    },
    mime: {
      default: null,
      parseHTML: (element) => element.getAttribute('data-mime'),
      renderHTML: (attributes) =>
        attributes.mime ? { 'data-mime': attributes.mime as string } : {},
    },
    duration: {
      default: null,
      parseHTML: (element) => {
        const raw = element.getAttribute('data-duration');
        const value = raw === null ? Number.NaN : Number.parseFloat(raw);

        return Number.isFinite(value) ? value : null;
      },
      renderHTML: (attributes) =>
        attributes.duration === null || attributes.duration === undefined
          ? {}
          : { 'data-duration': String(attributes.duration) },
    },
    peaks: {
      default: null,
      parseHTML: (element) => element.getAttribute('data-peaks'),
      renderHTML: (attributes) =>
        attributes.peaks ? { 'data-peaks': attributes.peaks as string } : {},
    },
  }),

  parseHTML: () => [
    {
      tag: 'div[data-audio]',
      getAttrs: (element) => {
        const el = element as HTMLElement;
        const src = el.getAttribute('data-src') ?? el.querySelector('audio')?.getAttribute('src');

        return src ? null : false;
      },
    },
  ],

  renderHTML({ node, HTMLAttributes }) {
    const src = (node.attrs.src as string) ?? '';

    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-audio': 'true',
        'data-src': src,
        class: 'rte-audio',
      }),
      ['audio', { controls: 'controls', preload: 'metadata', src, class: 'rte-audio__native' }],
    ];
  },

  addNodeView() {
    const { t } = this.options;

    return ({ node, editor }) => {
      const attrs = node.attrs as unknown as AudioAttributes;

      const dom = document.createElement('div');

      dom.className = 'rte-audio';
      dom.setAttribute('data-audio', 'true');
      dom.setAttribute('data-src', attrs.src);
      dom.contentEditable = 'false';
      // Плеер — группа с именем: читалка объявляет, что это за блок, прежде
      // чем читать его кнопку и ползунок.
      dom.setAttribute('role', 'group');
      dom.setAttribute('aria-label', attrs.name || t('audio_title'));

      const audio = new Audio();

      audio.preload = 'metadata';
      audio.src = attrs.src;

      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'rte-audio__toggle';
      button.setAttribute('aria-label', t('audio_play'));
      button.textContent = '▶';

      // Осциллограмма — ползунок: по ней и мышью ищут место, и клавиатурой.
      const waveform = document.createElement('div');

      waveform.className = 'rte-audio__waveform';
      waveform.setAttribute('role', 'slider');
      waveform.setAttribute('tabindex', '0');
      waveform.setAttribute('aria-label', t('audio_position'));
      waveform.setAttribute('aria-valuemin', '0');

      const peaks = parsePeaks(attrs.peaks ?? null);
      const barValues = peaks.length > 0 ? peaks : Array.from({ length: 40 }, () => 30);

      const bars = barValues.map((value) => {
        const bar = document.createElement('span');

        bar.className = 'rte-audio__bar';
        bar.style.height = `${Math.max(8, Math.min(100, value))}%`;
        waveform.appendChild(bar);

        return bar;
      });

      const time = document.createElement('span');

      time.className = 'rte-audio__time';
      time.textContent = formatDuration(attrs.duration ?? 0);

      const name = document.createElement('span');

      name.className = 'rte-audio__name';

      if (attrs.name) name.textContent = attrs.name;

      const controls = document.createElement('div');

      controls.className = 'rte-audio__controls';
      controls.append(button, waveform, time);
      dom.append(controls);

      if (attrs.name) dom.append(name);

      const totalDuration = () => audio.duration || attrs.duration || 0;

      const paintProgress = () => {
        const total = totalDuration();
        const ratio = total > 0 ? audio.currentTime / total : 0;
        const played = Math.round(ratio * bars.length);

        bars.forEach((bar, index) => {
          bar.classList.toggle('rte-audio__bar--played', index < played);
        });

        time.textContent = formatDuration(
          audio.currentTime > 0 ? audio.currentTime : (attrs.duration ?? 0),
        );

        waveform.setAttribute('aria-valuemax', String(Math.round(total)));
        waveform.setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));

        waveform.setAttribute(
          'aria-valuetext',
          `${formatDuration(audio.currentTime)} / ${formatDuration(total)}`,
        );
      };

      const seekTo = (seconds: number) => {
        const total = totalDuration();

        if (total <= 0) return;

        audio.currentTime = Math.min(total, Math.max(0, seconds));
        paintProgress();
      };

      const onToggle = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        if (audio.paused) {
          // play() отклоняется, если браузер запретил воспроизведение или его
          // тут же прервали паузой. Кнопка синхронизируется по событиям
          // play/pause, поэтому ошибку достаточно не выпускать наружу.
          audio.play().catch(() => undefined);
        } else {
          audio.pause();
        }
      };

      const onPlay = () => {
        button.textContent = '❚❚';
        button.setAttribute('aria-label', t('audio_pause'));
      };

      const onPause = () => {
        button.textContent = '▶';
        button.setAttribute('aria-label', t('audio_play'));
      };

      const onEnded = () => {
        onPause();
        audio.currentTime = 0;
        paintProgress();
      };

      const onSeek = (event: MouseEvent) => {
        const rect = waveform.getBoundingClientRect();

        if (rect.width === 0) return;

        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));

        seekTo(ratio * totalDuration());
      };

      // Стрелки перематывают, Home/End — к краям, Escape возвращает каретку в
      // документ. Событие не должно дойти до ProseMirror: там стрелка двигала
      // бы выделение, а не ползунок.
      const onSeekKey = (event: KeyboardEvent) => {
        const moves: Record<string, number | undefined> = {
          ArrowRight: audio.currentTime + SEEK_STEP_SEC,
          ArrowUp: audio.currentTime + SEEK_STEP_SEC,
          ArrowLeft: audio.currentTime - SEEK_STEP_SEC,
          ArrowDown: audio.currentTime - SEEK_STEP_SEC,
          Home: 0,
          End: totalDuration(),
        };

        if (event.key === 'Escape') {
          event.preventDefault();
          focusEditorView(editor);

          return;
        }

        const next = moves[event.key];

        if (next === undefined) return;

        event.preventDefault();
        seekTo(next);
      };

      button.addEventListener('click', onToggle);
      waveform.addEventListener('click', onSeek);
      waveform.addEventListener('keydown', onSeekKey);
      // Ползунок сообщает предел и позицию с первого кадра, не дожидаясь
      // метаданных: длительность известна из атрибутов узла.
      paintProgress();
      audio.addEventListener('timeupdate', paintProgress);
      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('loadedmetadata', paintProgress);

      return {
        dom,
        ignoreMutation: () => true,
        // Клавиши внутри плеера — его: иначе ProseMirror перехватил бы стрелки
        // и Enter на кнопке и ползунке.
        stopEvent: (event) => event instanceof KeyboardEvent,
        destroy: () => {
          audio.pause();
          button.removeEventListener('click', onToggle);
          waveform.removeEventListener('click', onSeek);
          waveform.removeEventListener('keydown', onSeekKey);
          audio.removeEventListener('timeupdate', paintProgress);
          audio.removeEventListener('play', onPlay);
          audio.removeEventListener('pause', onPause);
          audio.removeEventListener('ended', onEnded);
          audio.removeEventListener('loadedmetadata', paintProgress);
          audio.src = '';
        },
      };
    };
  },

  addCommands() {
    const { name } = this;

    return {
      insertAudio:
        (attributes) =>
        ({ commands }) => {
          if (!attributes.src) return false;

          return commands.insertContent({ type: name, attrs: attributes });
        },
    };
  },
});
