// In 线描 mode, the small posters elsewhere in the app (the 思考强度 tiers) become 碧琪 in line too.
import {lineArt, loadLine, drawLine} from './line.js';
import {artStyle, onArtStyle} from '../core/modes.js';

export function mountLineDecor(signal) {
  const sync = () => {
    const line = artStyle() === 'line';
    for (const item of document.querySelectorAll('.laolao-deep-think-menu__item[data-tier]')) {
      const icon = item.querySelector('.laolao-deep-think-menu__icon'); if (!icon) continue;
      const name = `tier-${item.dataset.tier}`;
      let art = icon.querySelector(':scope > .cle-line');
      if (!line) { art?.remove(); icon.classList.remove('is-line'); continue; }
      if (art) continue;
      loadLine(name).then((d) => {
        if (!d || icon.querySelector(':scope > .cle-line') || artStyle() !== 'line') return;
        icon.classList.add('is-line'); icon.prepend(lineArt(name, {speed: 260}));
      });
    }
  };
  let q = false;
  const schedule = () => { if (!q) { q = true; requestAnimationFrame(() => { q = false; sync(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {childList: true, subtree: true});
  const off = onArtStyle(schedule);
  signal.addEventListener('abort', () => { mo.disconnect(); off(); }, {once: true});
}
