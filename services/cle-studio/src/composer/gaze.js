// 凝视 — the thinking level as a gaze. The native effort picker keeps its behaviour; we
// replace its gauge with an eye that opens with the level, and give each level a word.
const LEVELS = {
  off: {open: 0, word: '合眼', hint: '不思考，直接回答'},
  minimal: {open: .16, word: '一瞥', hint: '几乎不想'},
  low: {open: .32, word: '看一眼', hint: '想一下就答'},
  medium: {open: .5, word: '端详', hint: '把题看清再答'},
  high: {open: .66, word: '凝视', hint: '认真推敲'},
  xhigh: {open: .8, word: '审视', hint: '反复推敲每一步'},
  max: {open: .92, word: '洞察', hint: '尽可能深地想'},
  ultra: {open: 1, word: '目不转睛', hint: '最深的思考，最慢'},
  adaptive: {open: .55, word: '随机应变', hint: '难的题多想，简单的少想', adaptive: true},
};
const ALIASES = {'extra high': 'xhigh', 'x-high': 'xhigh', xhigh: 'xhigh', 关闭: 'off', 自适应: 'adaptive'};
export function levelOf(text) {
  const t = String(text || '').trim().toLowerCase();
  return ALIASES[t] || (LEVELS[t] ? t : null);
}

// A cat's eye, 24×24. open 0 = a closed lid; 1 = wide, with a halo ring.
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

export function mountGaze(signal) {
  const decorate = (root = document) => {
    for (const summary of root.querySelectorAll('.chat-controls__effort-trigger')) {
      const label = summary.querySelector('.chat-controls__inline-select-label');
      const level = levelOf(label?.textContent);
      if (!level) continue;
      if (summary.dataset.cleLevel === level && summary.querySelector('.cle-eye')) continue;
      summary.dataset.cleLevel = level;
      summary.dataset.cleWord = LEVELS[level].word;
      label.dataset.cleWord = LEVELS[level].word;
      summary.title = `思考深度 · ${LEVELS[level].word}：${LEVELS[level].hint}`;
      const gauge = summary.querySelector('.chat-controls__effort-gauge') || summary;
      let eye = gauge.querySelector('.cle-eye');
      if (!eye) { eye = document.createElement('span'); eye.className = 'cle-eye'; gauge.append(eye); }
      eye.innerHTML = eyeSvg(level);
      eye.dataset.lit = String(LEVELS[level].open >= .8);
    }
    // inside the open menu: each stop gets its eye, the heading its word
    for (const panel of root.querySelectorAll('.chat-controls__reasoning-panel')) {
      const value = panel.querySelector('.chat-controls__effort-value');
      const level = levelOf(value?.firstElementChild?.textContent);
      if (level) { panel.dataset.cleWord = LEVELS[level].word; panel.dataset.cleHint = LEVELS[level].hint; }
    }
  };
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; decorate(); }); } };
  decorate();
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {subtree: true, childList: true, characterData: true});
  signal.addEventListener('abort', () => mo.disconnect(), {once: true});
}
