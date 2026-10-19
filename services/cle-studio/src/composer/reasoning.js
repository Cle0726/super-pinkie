// The reasoning slider is a rail of living material (reasoning.css): every level has its own
// matter, moving on its own, filled up to the thumb. This module only tells the CSS where the
// thumb is (--cle-fill), which level it is on (data-cle-level) and which stops it has passed.
// The native input keeps every behaviour.
import './reasoning.css';
import './polish.css';   // last: the experience-pass corrections win over earlier sheets
import {levelOf} from './gaze-levels.js';

const RANGE = 'input.chat-controls__reasoning-range';

const levelAt = (range) => {
  const values = (range.dataset.chatThinkingValues || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!values.length) return null;
  const min = Number(range.min || 0), max = Number(range.max || values.length - 1);
  const ratio = Math.max(0, Math.min(1, (Number(range.value) - min) / Math.max(1, max - min)));
  const index = Math.round(ratio * (values.length - 1));
  const raw = values[index];
  const level = {max: 'ultra', adaptive: 'medium', fast: 'low'}[raw] || levelOf(raw) || 'medium';
  return {level, index, ratio};
};

export function mountReasoning(signal) {
  const show = (range) => {
    const panel = range.closest('.chat-controls__reasoning-panel');
    const slider = range.closest('.chat-controls__reasoning-slider');
    const at = panel && slider && levelAt(range);
    if (!at) return;
    slider.style.setProperty('--cle-fill', at.ratio.toFixed(3));
    if (panel.dataset.cleLevel !== at.level) panel.dataset.cleLevel = at.level;
    slider.querySelectorAll('.chat-controls__reasoning-dot').forEach((dot, i) => dot.toggleAttribute('data-cle-past', i <= at.index));
    for (const stop of panel.querySelectorAll('.cle-gaze-stop')) {
      const i = Number(stop.dataset.stop);
      stop.toggleAttribute('data-current', i === at.index);
      stop.toggleAttribute('data-past', i < at.index);
    }
  };
  const sync = () => document.querySelectorAll(RANGE).forEach(show);
  const onInput = (event) => { const range = event.target?.closest?.(RANGE); if (range) show(range); };
  document.addEventListener('input', onInput, {capture: true, signal});
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {childList: true, subtree: true});
  sync();
  signal.addEventListener('abort', () => {
    mo.disconnect();
    document.querySelectorAll('.chat-controls__reasoning-panel[data-cle-level]').forEach((p) => delete p.dataset.cleLevel);
  }, {once: true});
}
