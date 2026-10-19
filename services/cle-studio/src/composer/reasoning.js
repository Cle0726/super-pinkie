// The reasoning slider is how hard he looks. Above the track sits a strip of his painted eyes
// (static/art/think/*), closed at Off and blazing at Ultra; dragging the thumb crossfades the
// strip live, so the eyes open as you pull. The track's lit part, the passed notches and the
// thumb follow the same intensity (see reasoning.css). The native input keeps every behaviour.
import './reasoning.css';
import './polish.css';   // last: the experience-pass corrections win over earlier sheets
import {LEVELS, levelOf} from './gaze-levels.js';

const ART = {off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'ultra', ultra: 'ultra', adaptive: 'medium', fast: 'low'};
const src = (level) => `/cle/static/art/think/${ART[level] || 'medium'}.webp?v=20261019`;
const RANGE = 'input.chat-controls__reasoning-range';

const levelAt = (range) => {
  const values = (range.dataset.chatThinkingValues || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!values.length) return null;
  const min = Number(range.min || 0), max = Number(range.max || values.length - 1);
  const i = Math.max(0, Math.min(values.length - 1, Math.round((Number(range.value) - min) / Math.max(1, max - min) * (values.length - 1))));
  return {level: levelOf(values[i]) || 'medium', index: i};
};

export function mountReasoning(signal) {
  const warm = new Set();
  const preload = () => { for (const l of Object.values(ART)) if (!warm.has(l)) { warm.add(l); const i = new Image(); i.decoding = 'async'; i.src = src(l); } };

  const show = (panel, level, index) => {
    let strip = panel.querySelector(':scope > .cle-reason-eyes');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'cle-reason-eyes';
      strip.setAttribute('aria-hidden', 'true');
      strip.innerHTML = '<i></i><i></i><b></b>';
      panel.prepend(strip);
      preload();
    }
    const p = (LEVELS[level] || LEVELS.medium).open;
    panel.style.setProperty('--cle-r', p.toFixed(2));
    panel.dataset.cleLevel = level;
    for (const stop of panel.querySelectorAll('.cle-gaze-stop')) {
      const i = Number(stop.dataset.stop);
      stop.toggleAttribute('data-current', i === index);
      stop.toggleAttribute('data-past', i < index);
    }
    if (strip.dataset.level === level) return;
    const layers = strip.querySelectorAll('i');
    const front = strip.dataset.front === '1' ? 1 : 0;
    const next = layers[front ^ 1], prev = layers[front];
    next.style.backgroundImage = `url("${src(level)}")`;
    // the eyes open (or close) toward the new level: the next layer settles in from a breath of scale
    next.classList.remove('is-front'); void next.offsetWidth;
    next.classList.add('is-front'); prev.classList.remove('is-front');
    strip.dataset.front = String(front ^ 1);
    strip.dataset.level = level;
    strip.classList.toggle('is-blaze', p >= .9);
  };

  const sync = () => {
    for (const range of document.querySelectorAll(RANGE)) {
      const panel = range.closest('.chat-controls__reasoning-panel');
      const at = panel && levelAt(range);
      if (at) show(panel, at.level, at.index);
    }
  };
  const onInput = (event) => {
    const range = event.target?.closest?.(RANGE);
    if (!range) return;
    const panel = range.closest('.chat-controls__reasoning-panel');
    const at = panel && levelAt(range);
    if (at) show(panel, at.level, at.index);
  };
  document.addEventListener('input', onInput, {capture: true, signal});
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {childList: true, subtree: true});
  sync();
  signal.addEventListener('abort', () => { mo.disconnect(); document.querySelectorAll('.cle-reason-eyes').forEach((n) => n.remove()); }, {once: true});
}
