// Clin d'œil — the room transition. Two lids close (fast, decisive), meet at a blue
// hairline, the new room's name shows in the dark while it loads, then the lids open.
import {FLOWERS} from './flowers.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const anim = (el, frames, opts) => el.animate(frames, {fill: 'forwards', ...opts}).finished.catch(() => {});

let layer = null;
function ensureLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'cle-blink';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<div class="cle-blink__lid cle-blink__lid--top"></div><div class="cle-blink__lid cle-blink__lid--bottom"></div><div class="cle-blink__seam"></div><div class="cle-blink__card"><span class="cle-blink__flower"></span><span class="cle-blink__zh"></span><span class="cle-blink__fr cle-label"></span></div>`;
  document.body.append(layer);
  return layer;
}

export async function blink(room, during) {
  if (reduce()) { await during(); return; }
  const el = ensureLayer();
  const top = el.querySelector('.cle-blink__lid--top');
  const bottom = el.querySelector('.cle-blink__lid--bottom');
  const seam = el.querySelector('.cle-blink__seam');
  const card = el.querySelector('.cle-blink__card');
  el.querySelector('.cle-blink__flower').innerHTML = FLOWERS[room.flower];
  el.querySelector('.cle-blink__zh').textContent = room.zh;
  el.querySelector('.cle-blink__fr').textContent = room.fr;
  el.dataset.room = room.id;
  el.classList.add('is-on');

  const close = {duration: 300, easing: 'cubic-bezier(.55,0,.75,.2)'};
  await Promise.all([
    anim(top, [{transform: 'translateY(-101%)'}, {transform: 'translateY(0)'}], close),
    anim(bottom, [{transform: 'translateY(101%)'}, {transform: 'translateY(0)'}], close),
  ]);
  anim(seam, [{transform: 'scaleX(0)', opacity: 0}, {transform: 'scaleX(1)', opacity: 1, offset: .4}, {transform: 'scaleX(1)', opacity: .0}], {duration: 520, easing: 'cubic-bezier(.2,.7,0,1)'});
  anim(card, [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 260, delay: 60, easing: 'cubic-bezier(.2,.7,0,1)'});

  const shownAt = performance.now();
  try { await during(); } catch (e) { console.warn('[cle] room switch', e); }
  // let the name be read even when the room is instant
  const held = performance.now() - shownAt;
  if (held < 420) await wait(420 - held);

  await anim(card, [{opacity: 1}, {opacity: 0}], {duration: 120, easing: 'ease-out'});
  const open = {duration: 460, easing: 'cubic-bezier(.2,.7,0,1)'};
  await Promise.all([
    anim(top, [{transform: 'translateY(0)'}, {transform: 'translateY(-101%)'}], open),
    anim(bottom, [{transform: 'translateY(0)'}, {transform: 'translateY(101%)'}], open),
  ]);
  el.classList.remove('is-on');
}
