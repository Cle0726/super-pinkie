// Pure level vocabulary for 凝视. Kept free of DOM and CSS imports so tests can import it
// directly and so the picker, the eye and the label can never disagree about a level.

export const LEVELS = {
  off: {open: 0, tier: 'Off', zh: '关闭', hint: '不思考，直接回答'},
  minimal: {open: .18, tier: 'Minimal', zh: '极浅', hint: '几乎不展开推理'},
  low: {open: .34, tier: 'Low', zh: '浅', hint: '想一下就答'},
  medium: {open: .52, tier: 'Medium', zh: '中', hint: '把题看清再答'},
  high: {open: .68, tier: 'High', zh: '高', hint: '认真推敲'},
  xhigh: {open: .82, tier: 'XHigh', zh: '很高', hint: '反复推敲每一步'},
  max: {open: .93, tier: 'Max', zh: '最高', hint: '尽可能深地想，答完核对'},
  ultra: {open: 1, tier: 'Ultra', zh: '极限', hint: '最深的思考，最慢'},
  adaptive: {open: .58, tier: 'Adaptive', zh: '自适应', hint: '难题多想，简单题少想', adaptive: true},
  fast: {open: .44, tier: 'Fast', zh: '快速', hint: '快速模式，不展开推理'},
};

// The native label is localized (zh-CN renders 高 / 最高), while data-chat-thinking-value
// carries the real id. Aliases cover both, so a translated label can never lose the level.
const ALIASES = {
  'extra high': 'xhigh', 'x-high': 'xhigh', 'extra-high': 'xhigh', 'very high': 'xhigh',
  none: 'off', disabled: 'off', auto: 'adaptive', dynamic: 'adaptive', standard: 'medium',
  关闭: 'off', 关: 'off', 无: 'off', 极浅: 'minimal', 最低: 'minimal', 浅: 'low', 低: 'low',
  中: 'medium', 中等: 'medium', 标准: 'medium', 高: 'high', 较高: 'high', 很高: 'xhigh',
  极高: 'xhigh', 最高: 'max', 极限: 'ultra', 最大: 'ultra', 自适应: 'adaptive', 快速: 'fast',
};

export function levelOf(text) {
  const t = String(text || '').trim().toLowerCase();
  if (ALIASES[t]) return ALIASES[t];
  if (t.endsWith('档')) { const bare = t.slice(0, -1); if (ALIASES[bare]) return ALIASES[bare]; }
  return LEVELS[t] ? t : null;
}

export const tierLabel = (level) => (LEVELS[level] || LEVELS.medium).tier;
export const tierWord = (level) => (LEVELS[level] || LEVELS.medium).zh;

// A cat's eye, 24×24. open 0 = a closed lid; 1 = wide, with a halo. The closed lid keeps
// three lashes so "off" still reads as an eye at 20px instead of a stray dash.
export function eyeSvg(level) {
  const L = LEVELS[level] || LEVELS.medium;
  const o = L.open;
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  if (o === 0) {
    return `<svg ${NS} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.2 11.2C7 15.6 17 15.6 20.8 11.2"/><path d="M6.4 14.2 5.5 16M12 15.4V17.3M17.6 14.2l.9 1.8" stroke-width="1.2"/></svg>`;
  }
  // a predator's almond: inner corner low, outer corner raised and pointed, flat upper lid
  const up = 1.4 + 4.6 * o, down = 1.2 + 3.4 * o;
  const S = '2.4 13.4', E = '21.6 9.6';
  const lidUp = `M${S}C7 ${(13.4 - up * 1.15).toFixed(2)} 15.5 ${(9.6 - up * 1.05).toFixed(2)} ${E}`;
  const lidDown = `M${S}C8 ${(13.4 + down * .95).toFixed(2)} 16 ${(9.6 + down * 1.15).toFixed(2)} ${E}`;
  const clip = `M${S}C7 ${(13.4 - up * 1.15).toFixed(2)} 15.5 ${(9.6 - up * 1.05).toFixed(2)} ${E}C16 ${(9.6 + down * 1.15).toFixed(2)} 8 ${(13.4 + down * .95).toFixed(2)} ${S}Z`;
  const irisR = (2.8 + 1.7 * o).toFixed(2);
  const pupilW = (1.5 - 1.0 * o).toFixed(2);              // the deeper the gaze, the thinner the slit
  const lit = o >= .8;                                     // fully looking: the iris takes the gaze colour
  const id = `e${level}`;
  return `<svg ${NS} viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
<defs><clipPath id="${id}"><path d="${clip}"/></clipPath></defs>
<g clip-path="url(#${id})"><circle cx="12.3" cy="11.5" r="${irisR}" class="cle-eye__iris" ${lit ? '' : 'fill="currentColor" fill-opacity=".2"'}/><ellipse cx="12.3" cy="11.5" rx="${pupilW / 2}" ry="${(+irisR * .95).toFixed(2)}" fill="currentColor"/></g>
<path d="${lidUp}" stroke="currentColor" stroke-width="1.45"/><path d="${lidDown}" stroke="currentColor" stroke-width=".95"/>
${o >= 1 ? '<path d="M8.6 5.2 8.1 3.6M12.4 4.4V2.6M16 5 16.7 3.5" stroke="currentColor" stroke-width="1" class="cle-eye__halo"/>' : ''}
${L.adaptive ? '<path d="M19.6 2.4v3M18.1 3.9h3" stroke="currentColor" stroke-width="1"/>' : ''}
</svg>`.replace(/\n/g, '');
}

/* Map a native slider position onto an index in its own value list. The native control
   can expose three stops or nine; the index is computed from the real min/max/step, never
   from a fixed ladder, so a model with fewer levels is never shown as reaching Ultra. */
export function stopIndex(range) {
  const min = Number(range?.min ?? 0);
  const max = Number(range?.max ?? 0);
  const span = max - min;
  const count = Number(range?.count ?? 0);
  if (!(count > 1)) return 0;
  if (!(span > 0)) return 0;
  const ratio = (Number(range?.value ?? 0) - min) / span;
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}
