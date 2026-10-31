// How hard he is looking. The thinking level is not just a word on a picker: changing it kindles
// gold leaf off the eye control (more, farther and brighter as the level rises, with an ice-blue
// ring of attention), and while a run is thinking the composer's rim turns into living gold leaf
// and flakes drift up from the eye, at a rate set by the level. One shared canvas, idle when calm.
import {LEVELS} from '../composer/gaze-levels.js';

const TRIGGER = '.chat-controls__effort-trigger[data-cle-level], .chat-controls__model-trigger[data-cle-level], summary[data-cle-level]';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const intensity = (level) => (LEVELS[level] || LEVELS.medium).open;

export function mountGazeFx(signal) {
  const canvas = document.createElement('canvas');
  canvas.className = 'cle-gazefx';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  let dpr = 1, W = 0, H = 0;
  const size = () => { dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; canvas.width = W * dpr; canvas.height = H * dpr; };
  size(); addEventListener('resize', size, {signal});

  const flakes = [];   // {x,y,vx,vy,r,rot,vr,flip,vf,life,max,kind}
  const rings = [];    // {x,y,t,max,a}
  const night = () => document.documentElement.hasAttribute('data-pinkie-night');

  const spawn = (x, y, n, power, drift = false) => {
    for (let i = 0; i < n; i++) {
      const a = drift ? -Math.PI / 2 + (Math.random() - .5) * 1.1 : Math.random() * Math.PI * 2;
      const sp = drift ? 10 + Math.random() * 18 : (40 + Math.random() * 120) * (.5 + power);
      flakes.push({x: x + (Math.random() - .5) * 10, y: y + (Math.random() - .5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (drift ? 6 : 20),
        r: .9 + Math.random() * (1.3 + power * 1.5), rot: Math.random() * 6.28, vr: (Math.random() - .5) * 6,
        flip: Math.random() * 6.28, vf: 4 + Math.random() * 7, life: 0, max: (drift ? 2.2 : 1.1) + Math.random() * (.6 + power),
        kind: Math.random() < .14 + power * .12 ? 'gaze' : 'gold'});
    }
  };

  // a flake of gold leaf: an irregular quad that catches the light as it turns
  const drawFlake = (f, k) => {
    const shine = .55 + .45 * Math.cos(f.flip);
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(1, Math.max(.18, Math.abs(Math.cos(f.flip))));
    ctx.globalAlpha = k;
    if (f.kind === 'gaze') {
      ctx.fillStyle = night() ? 'rgba(120,190,255,.95)' : 'rgba(42,99,232,.9)';
      ctx.shadowColor = 'rgba(90,168,255,.8)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(.5, f.r * .55), 0, 6.28); ctx.fill();
    } else {
      const g = ctx.createLinearGradient(-f.r, -f.r, f.r, f.r);
      g.addColorStop(0, `rgba(${Math.round(150 + 105 * shine)},${Math.round(112 + 90 * shine)},${Math.round(40 + 70 * shine)},1)`);
      g.addColorStop(1, `rgba(${Math.round(120 + 60 * shine)},${Math.round(86 + 50 * shine)},28,1)`);
      ctx.fillStyle = g; ctx.shadowColor = `rgba(255,214,140,${.35 * shine})`; ctx.shadowBlur = 3;
      ctx.beginPath(); ctx.moveTo(-f.r * 1.4, -f.r * .25); ctx.quadraticCurveTo(0, -f.r * .9, f.r * 1.5, -f.r * .1);
      ctx.lineTo(f.r * 1.1, f.r * .45); ctx.quadraticCurveTo(-f.r * .2, f.r * .7, -f.r * 1.4, -f.r * .25); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  };

  let raf = 0, last = 0;
  const kick = () => { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const frame = (now) => {
    raf = 0;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt; if (r.t < 0) continue; const p = r.t / .9; if (p >= 1) { rings.splice(i, 1); continue; }
      ctx.save(); ctx.globalAlpha = (1 - p) * r.a; ctx.strokeStyle = night() ? 'rgba(110,185,255,1)' : 'rgba(42,99,232,1)';
      ctx.lineWidth = 1.2; ctx.shadowColor = 'rgba(90,168,255,.7)'; ctx.shadowBlur = 8;
      const rad = Math.max(1, 10 + p * r.max); ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * .42, 0, 0, 6.28); ctx.stroke(); ctx.restore();
    }
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i]; f.life += dt; if (f.life >= f.max) { flakes.splice(i, 1); continue; }
      f.vx *= .985; f.vy = f.vy * .985 + 26 * dt; f.vx += Math.sin(f.life * 3 + f.rot) * 6 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; f.flip += f.vf * dt;
      const k = Math.min(1, f.life / .12) * (1 - f.life / f.max);
      drawFlake(f, k);
    }
    if (emitting()) kick(); else if (flakes.length || rings.length) kick();
  };

  // ---- level changes: kindle ----
  const seen = new WeakMap();
  const kindle = (trigger, level) => {
    if (reduce()) return;
    const p = intensity(level), r = trigger.getBoundingClientRect();
    if (!r.width) return;
    const eye = trigger.querySelector('.cle-eye')?.getBoundingClientRect(); const x = eye?.width ? eye.left + eye.width / 2 : r.left + 12, y = eye?.width ? eye.top + eye.height / 2 : r.top + r.height / 2;
    rings.push({x, y, t: 0, max: 26 + p * 70, a: .35 + p * .6});
    if (p >= .9) rings.push({x, y, t: -.14, max: 40 + p * 90, a: .4});
    spawn(x, y, Math.round(3 + p * 20), p);
    const composer = trigger.closest('.cle-composer');
    if (composer && p >= .66) { composer.classList.remove('cle-kindled'); void composer.offsetWidth; composer.classList.add('cle-kindled'); setTimeout(() => composer.classList.remove('cle-kindled'), 1400); }
    kick();
  };

  // ---- while thinking: the rim lives, flakes drift up from the eye ----
  let busy = [];
  const emitting = () => busy.length > 0 && !reduce();
  let emitTimer = 0;
  const emit = () => {
    for (const {trigger, p} of busy) {
      const r = trigger.getBoundingClientRect(); if (!r.width) continue;
      const e = trigger.querySelector('.cle-eye')?.getBoundingClientRect(); if (Math.random() < .25 + p * .9) spawn(e?.width ? e.left + e.width / 2 : r.left + 12, (e?.width ? e.top : r.top) + 2, 1 + (p > .85 ? 1 : 0), p * .4, true);
    }
    if (busy.length) kick();
  };

  const sync = () => {
    busy = [];
    for (const trigger of document.querySelectorAll(TRIGGER)) {
      const level = trigger.dataset.cleLevel;
      const pane = trigger.closest('.chat-pane-cache__pane');
      const composer = trigger.closest('.cle-composer');
      const p = intensity(level);
      if (composer) {
        composer.style.setProperty('--cle-gaze-int', p.toFixed(2));
        composer.dataset.cleLevel = level;
      }
      const prev = seen.get(trigger);
      if (prev && prev !== level) kindle(trigger, level);
      seen.set(trigger, level);
      const running = Boolean(pane?.querySelector('.chat-working-indicator')) && pane.classList.contains('chat-pane-cache__pane--visible') !== false;
      composer?.classList.toggle('cle-thinking', running);
      if (running && trigger.offsetParent) busy.push({trigger, p});
    }
    clearInterval(emitTimer);
    if (busy.length && !reduce()) emitTimer = setInterval(emit, 140);
  };

  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-cle-level']});
  sync();
  signal.addEventListener('abort', () => { mo.disconnect(); clearInterval(emitTimer); cancelAnimationFrame(raf); canvas.remove();
    document.querySelectorAll('.cle-composer').forEach((c) => { c.classList.remove('cle-thinking', 'cle-kindled'); c.style.removeProperty('--cle-gaze-int'); }); }, {once: true});
}
