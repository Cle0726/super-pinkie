// Clin d'œil — the room transition. A blink, told with restraint: two veils of frosted paper close
// over the room from above and below and meet at a hairline of his ice-blue gaze. On the closed
// lids his face is drawn, line by line, in the state of the next room, with the room's name set
// beneath it; when the room is ready the veils part from that hairline and the new room is there.
// No cut-outs, no cards: the room itself stays visible, blurred, behind the veils.
import {roomArt} from './rooms.js';
import {lineArt, loadLine} from '../line/line.js';
import {artStyle} from '../core/modes.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const anim = (el, frames, opts) => el.animate(frames, {fill: 'forwards', ...opts}).finished.catch(() => {});
const EASE_CLOSE = 'cubic-bezier(.62,0,.78,.24)';      // a lid falls, it is not pulled
const EASE_OPEN = 'cubic-bezier(.16,.84,.3,1)';        // and lifts slowly at the end
const EASE_SOFT = 'cubic-bezier(.2,.7,0,1)';

let layer = null;
function ensureLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'cle-blink';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<div class="cle-blink__veil cle-blink__veil--top"><i></i></div><div class="cle-blink__veil cle-blink__veil--bottom"><i></i></div>`
    + `<div class="cle-blink__seam"></div>`
    + `<div class="cle-blink__face"><div class="cle-blink__drawing"></div>`
    + `<div class="cle-blink__fr"></div><div class="cle-blink__zh"></div><div class="cle-blink__rule"></div><div class="cle-blink__line"></div></div>`;
  document.body.append(layer);
  return layer;
}

export async function blink(room, during) {
  if (reduce()) { await during(); return; }
  const el = ensureLayer();
  const $ = (s) => el.querySelector(s);
  const top = $('.cle-blink__veil--top'), bottom = $('.cle-blink__veil--bottom'), seam = $('.cle-blink__seam');
  const face = $('.cle-blink__face'), drawing = $('.cle-blink__drawing');
  const lineMode = artStyle() === 'line' && await Promise.race([loadLine(`mode-${room.id}`), wait(120).then(() => null)]);

  // what is drawn on the closed lids: his face in this room's state (线描), or the room's painting
  // seen as a wash through the paper (油画) — never a picture pasted on top
  drawing.replaceChildren();
  el.style.removeProperty('--cle-blink-wash');
  if (!lineMode) el.style.setProperty('--cle-blink-wash', `url("${roomArt(room.id)}")`);
  el.dataset.style = lineMode ? 'line' : 'oil';
  // the painting must already be decoded when the lids meet, or they close on an empty frame
  if (!lineMode) { const img = new Image(); img.src = roomArt(room.id); await Promise.race([img.decode?.().catch(() => {}), wait(260)]); }
  $('.cle-blink__fr').textContent = room.fr;
  $('.cle-blink__zh').textContent = room.zh;
  $('.cle-blink__line').textContent = room.line || '';
  el.dataset.room = room.id;
  el.classList.add('is-on');

  // 1 · the lids close (the gaze narrows to a line)
  const close = {duration: 280, easing: EASE_CLOSE};
  anim(seam, [{opacity: 0, transform: 'scaleX(.15)'}, {opacity: 1, transform: 'scaleX(1)'}], {duration: 300, easing: EASE_SOFT});
  await Promise.all([
    anim(top, [{transform: 'translateY(-100%)'}, {transform: 'translateY(0)'}], close),
    anim(bottom, [{transform: 'translateY(100%)'}, {transform: 'translateY(0)'}], close),
  ]);
  // the hairline sinks into the closed lids
  anim(seam, [{opacity: 1}, {opacity: .0}], {duration: 360, easing: 'ease-out'});

  // 2 · in the dark of the closed eye, the next room is drawn
  let drawn = Promise.resolve();
  if (lineMode) {
    const art = lineArt(`mode-${room.id}`, {draw: true, speed: 900});
    drawing.append(art);
    // the lids stay closed until his eyes have lit (bounded, so a slow decode never holds the room)
    drawn = Promise.race([wait(1500), (async () => { while (!art.__anims) await wait(16); await Promise.all(art.__anims.map((a) => a.finished.catch(() => {}))); })()]);
  }
  anim(face, [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 380, delay: 60, easing: EASE_SOFT});
  anim($('.cle-blink__rule'), [{transform: 'scaleX(0)'}, {transform: 'scaleX(1)'}], {duration: 520, delay: 220, easing: EASE_SOFT});
  anim($('.cle-blink__zh'), [{opacity: 0, letterSpacing: '.62em'}, {opacity: 1, letterSpacing: '.38em'}], {duration: 640, delay: 140, easing: EASE_SOFT});
  anim($('.cle-blink__line'), [{opacity: 0}, {opacity: 1}], {duration: 420, delay: 420, easing: 'ease-out'});

  const shownAt = performance.now();
  try { await during(); } catch (e) { console.warn('[cle] room switch', e); }
  // long enough for the face to be drawn and the name read, even when the room is instant
  const held = performance.now() - shownAt;
  const hold = 640;
  if (held < hold) await wait(hold - held);
  await drawn;
  await wait(lineMode ? 160 : 0);

  // 3 · the lids lift from the hairline; the drawing recedes into the room
  anim(seam, [{opacity: 0, transform: 'scaleX(1)'}, {opacity: 1, offset: .25}, {opacity: 0, transform: 'scaleX(1.08)'}], {duration: 520, easing: EASE_SOFT});
  anim(face, [{opacity: 1, transform: 'none', filter: 'blur(0)'}, {opacity: 0, transform: 'scale(.97)', filter: 'blur(3px)'}], {duration: 300, easing: 'ease-in'});
  const open = {duration: 640, delay: 90, easing: EASE_OPEN};
  await Promise.all([
    anim(top, [{transform: 'translateY(0)'}, {transform: 'translateY(-100%)'}], open),
    anim(bottom, [{transform: 'translateY(0)'}, {transform: 'translateY(100%)'}], open),
  ]);
  el.classList.remove('is-on');
  drawing.replaceChildren();
}
