// Clin d'œil — the room transition. Two lids close (fast, decisive) and meet at a sapphire hairline.
// In the dark an almond opens — his eye — and through it you see the next room's painting; the room's
// name settles under it while the room loads, then the lids part and the room is there.
import {roomArt} from './rooms.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const anim = (el, frames, opts) => el.animate(frames, {fill: 'forwards', ...opts}).finished.catch(() => {});

let layer = null;
function ensureLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'cle-blink';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<div class="cle-blink__lid cle-blink__lid--top"></div><div class="cle-blink__lid cle-blink__lid--bottom"></div>`
    + `<div class="cle-blink__seam"></div><div class="cle-blink__vision"><i></i></div>`
    + `<div class="cle-blink__card"><span class="cle-blink__zh"></span><span class="cle-blink__fr"></span></div>`;
  document.body.append(layer);
  return layer;
}

export async function blink(room, during) {
  if (reduce()) { await during(); return; }
  const el = ensureLayer();
  const $ = (s) => el.querySelector(s);
  const top = $('.cle-blink__lid--top'), bottom = $('.cle-blink__lid--bottom'), seam = $('.cle-blink__seam');
  const vision = $('.cle-blink__vision'), card = $('.cle-blink__card');
  vision.firstElementChild.style.backgroundImage = `url("${roomArt(room.id)}")`;
  $('.cle-blink__zh').textContent = room.zh;
  $('.cle-blink__fr').textContent = room.fr;
  el.dataset.room = room.id;
  el.classList.add('is-on');

  const close = {duration: 300, easing: 'cubic-bezier(.55,0,.75,.2)'};
  await Promise.all([
    anim(top, [{transform: 'translateY(-101%)'}, {transform: 'translateY(0)'}], close),
    anim(bottom, [{transform: 'translateY(101%)'}, {transform: 'translateY(0)'}], close),
  ]);
  // the seam flares, then becomes the edge of the opening eye
  anim(seam, [{transform: 'scaleX(0)', opacity: 0}, {transform: 'scaleX(1)', opacity: 1, offset: .35}, {transform: 'scaleX(1.05)', opacity: 0}], {duration: 620, easing: 'cubic-bezier(.2,.7,0,1)'});
  anim(vision, [{transform: 'scale(.6, 0)', opacity: 0}, {transform: 'scale(.92, .5)', opacity: 1, offset: .45}, {transform: 'scale(1, 1)', opacity: 1}], {duration: 560, delay: 80, easing: 'cubic-bezier(.2,.7,0,1)'});
  anim(vision.firstElementChild, [{transform: 'scale(1.18)'}, {transform: 'scale(1.04)'}], {duration: 1400, delay: 80, easing: 'cubic-bezier(.2,.7,0,1)'});
  anim(card, [{opacity: 0, transform: 'translateY(8px)', letterSpacing: '.5em'}, {opacity: 1, transform: 'none', letterSpacing: '.32em'}], {duration: 420, delay: 220, easing: 'cubic-bezier(.2,.7,0,1)'});

  const shownAt = performance.now();
  try { await during(); } catch (e) { console.warn('[cle] room switch', e); }
  // let the painting and the name be seen even when the room is instant
  const held = performance.now() - shownAt;
  if (held < 640) await wait(640 - held);

  const open = {duration: 520, easing: 'cubic-bezier(.2,.7,0,1)'};
  anim(card, [{opacity: 1}, {opacity: 0}], {duration: 160, easing: 'ease-out'});
  // the eye widens into the room as the lids part
  anim(vision, [{transform: 'scale(1, 1)', opacity: 1}, {transform: 'scale(2.6, 3.4)', opacity: 0}], {duration: 520, easing: 'cubic-bezier(.4,0,.2,1)'});
  await Promise.all([
    anim(top, [{transform: 'translateY(0)'}, {transform: 'translateY(-101%)'}], open),
    anim(bottom, [{transform: 'translateY(0)'}, {transform: 'translateY(101%)'}], open),
  ]);
  el.classList.remove('is-on');
}
