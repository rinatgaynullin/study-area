/**
 * Inline SVG icon set. Drawn from primitives on a 24×24 grid so the package
 * needs no icon font or external asset, and everything inherits `currentColor`.
 */

const S = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"';
const TEXT = 'fill="currentColor" stroke="none" text-anchor="middle" font-family="Georgia, serif"';

function glyph(char: string, attrs = ''): string {
  return `<text x="12" y="17" font-size="16" ${TEXT} ${attrs}>${char}</text>`;
}

function lines(...rows: Array<[number, number, number]>): string {
  return rows.map(([y, x1, x2]) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" ${S} />`).join('');
}

export const ICONS: Record<string, string> = {
  bold: glyph('B', 'font-weight="700"'),
  italic: glyph('I', 'font-style="italic" font-weight="600"'),
  underline: `${glyph('U', 'font-size="14"')}<line x1="6" y1="20" x2="18" y2="20" ${S} />`,
  strike: `${glyph('S', 'font-size="15"')}<line x1="5" y1="12" x2="19" y2="12" ${S} />`,

  heading: glyph('H', 'font-weight="700"'),
  paragraph: glyph('¶'),

  subscript: `<text x="10" y="16" font-size="14" ${TEXT}>x</text><text x="18" y="20" font-size="10" ${TEXT}>2</text>`,
  superscript: `<text x="10" y="18" font-size="14" ${TEXT}>x</text><text x="18" y="11" font-size="10" ${TEXT}>2</text>`,

  bulletList: `<circle cx="5" cy="7" r="1.5" fill="currentColor" /><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="5" cy="17" r="1.5" fill="currentColor" />${lines([7, 10, 20], [12, 10, 20], [17, 10, 20])}`,
  orderedList: `<text x="5" y="9" font-size="7" ${TEXT}>1</text><text x="5" y="14" font-size="7" ${TEXT}>2</text><text x="5" y="19" font-size="7" ${TEXT}>3</text>${lines([7, 10, 20], [12, 10, 20], [17, 10, 20])}`,

  blockquote: `<line x1="5" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="3" stroke-linecap="round" />${lines([8, 10, 19], [12, 10, 19], [16, 10, 16])}`,

  code: `<polyline points="9,8 5,12 9,16" ${S} /><polyline points="15,8 19,12 15,16" ${S} />`,
  codeBlock: `<rect x="3" y="4" width="18" height="16" rx="2" ${S} /><polyline points="10,10 8,12 10,14" ${S} /><polyline points="14,10 16,12 14,14" ${S} />`,

  horizontalRule: `<line x1="4" y1="12" x2="20" y2="12" ${S} />`,

  link: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2" ${S} /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2" ${S} />`,
  unlink: `<path d="M10 14a4 4 0 0 0 5.7 0l1-1" ${S} /><path d="M14 10a4 4 0 0 0-5.7 0l-1 1" ${S} /><line x1="4" y1="4" x2="20" y2="20" ${S} />`,

  table: `<rect x="3" y="4" width="18" height="16" rx="2" ${S} /><line x1="3" y1="9" x2="21" y2="9" ${S} /><line x1="9" y1="9" x2="9" y2="20" ${S} /><line x1="15" y1="9" x2="15" y2="20" ${S} />`,

  alignLeft: lines([6, 4, 20], [10, 4, 14], [14, 4, 18], [18, 4, 12]),
  alignCenter: lines([6, 4, 20], [10, 7, 17], [14, 5, 19], [18, 8, 16]),
  alignRight: lines([6, 4, 20], [10, 10, 20], [14, 6, 20], [18, 12, 20]),
  alignJustify: lines([6, 4, 20], [10, 4, 20], [14, 4, 20], [18, 4, 20]),

  textColor: `<text x="12" y="15" font-size="13" ${TEXT}>A</text><rect x="5" y="18" width="14" height="3" rx="1" fill="currentColor" />`,
  highlight: `<path d="M5 15l6-6 4 4-6 6H5z" ${S} /><line x1="14" y1="7" x2="17" y2="10" ${S} /><rect x="4" y="19" width="16" height="2.5" rx="1" fill="currentColor" />`,

  clearFormat: `<text x="10" y="17" font-size="15" ${TEXT}>A</text><line x1="4" y1="20" x2="20" y2="4" ${S} />`,

  undo: `<path d="M4 11h9a5 5 0 0 1 0 10h-3" ${S} /><polyline points="8,7 4,11 8,15" ${S} />`,
  redo: `<path d="M20 11h-9a5 5 0 0 0 0 10h3" ${S} /><polyline points="16,7 20,11 16,15" ${S} />`,

  image: `<rect x="3" y="5" width="18" height="14" rx="2" ${S} /><circle cx="8.5" cy="10" r="1.5" fill="currentColor" /><polyline points="5,17 10,12 13,15 16,12 19,16" ${S} />`,

  audio: `<rect x="9" y="3" width="6" height="11" rx="3" ${S} /><path d="M5 11a7 7 0 0 0 14 0" ${S} /><line x1="12" y1="18" x2="12" y2="21" ${S} />`,

  file: `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" ${S} /><polyline points="14,3 14,8 19,8" ${S} /><line x1="9" y1="13" x2="15" y2="13" ${S} /><line x1="9" y1="16" x2="13" y2="16" ${S} />`,

  formulaMath: `<path d="M4 13l3 5 4-13h9" ${S} />`,
  formulaChem: `<path d="M10 3v6L4.5 18a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9V3" ${S} /><line x1="9" y1="3" x2="15" y2="3" ${S} /><line x1="7" y1="14" x2="17" y2="14" ${S} />`,

  more: `<circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" />`,
  chevronDown: `<polyline points="6,9 12,15 18,9" ${S} />`,
  close: `<line x1="6" y1="6" x2="18" y2="18" ${S} /><line x1="18" y1="6" x2="6" y2="18" ${S} />`,
  check: `<polyline points="5,13 10,18 19,6" ${S} />`,
  openLink: `<path d="M14 4h6v6" ${S} /><path d="M20 4l-9 9" ${S} /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" ${S} />`,
  trash: `<polyline points="4,7 20,7" ${S} /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" ${S} /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" ${S} />`,

  play: `<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none" />`,
  pause: `<rect x="7" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="13" y="5" width="4" height="14" rx="1" fill="currentColor" />`,
  stop: `<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />`,
  record: `<circle cx="12" cy="12" r="6" fill="currentColor" />`,

  noColor: `<circle cx="12" cy="12" r="8" ${S} /><line x1="6.5" y1="17.5" x2="17.5" y2="6.5" ${S} />`,
};

export type IconName = keyof typeof ICONS;
