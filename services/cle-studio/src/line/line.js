// Li An in line. What you see is the artist's drawing itself (the ink, every change of weight intact);
// the strokes traced from it by tools/lineart.py are only an invisible pen path — a mask that uncovers the
// drawing in the order a hand would draw it. The eyes light up, sapphire, once the drawing is finished.
const NS = 'http://www.w3.org/2000/svg';
const cache = new Map();
const BASE = '/cle/static/art/line/';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let uid = 0;

export function loadLine(name) {
  if (!cache.has(name)) cache.set(name, fetch(`${BASE}${name}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(name);
}

const el = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

export function lineArt(name, {draw = true, speed = 140, eyes = true} = {}) {
  const host = document.createElement('span');
  host.className = 'cle-line'; host.dataset.line = name; host.setAttribute('aria-hidden', 'true');
  loadLine(name).then((data) => {
    if (!data?.image) { host.classList.add('is-missing'); return; }
    const id = `cle-l${++uid}`, size = data.viewBox.split(' ')[2];
    const svg = el('svg', {viewBox: data.viewBox});
    const defs = el('defs');
    const ink = el('mask', {id: `${id}i`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: size, height: size});
    ink.append(el('image', {href: BASE + data.image, x: 0, y: 0, width: size, height: size, preserveAspectRatio: 'none'}));
    const pen = el('mask', {id: `${id}p`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: size, height: size});
    const penG = el('g', {fill: 'none', stroke: '#fff', 'stroke-width': data.reveal || 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'});
    for (const s of data.strokes) { const p = el('path', {d: s.d, class: 'cle-line__pen'}); p.dataset.len = s.len; penG.append(p); }
    pen.append(penG); defs.append(ink, pen); svg.append(defs);
    const g = el('g', {mask: `url(#${id}p)`});
    g.append(el('rect', {x: 0, y: 0, width: size, height: size, fill: 'currentColor', mask: `url(#${id}i)`}));
    svg.append(g);
    if (eyes) for (const d of data.eyes) svg.append(el('path', {d, class: 'cle-line__eye'}));
    host.append(svg);
    host.__g = g; host.__mask = `url(#${id}p)`;
    host.__strokes = [...penG.children]; host.__eyes = [...svg.querySelectorAll('.cle-line__eye')]; host.__speed = speed;
    if (draw) drawLine(host); else finish(host);
  });
  host.addEventListener('pointerenter', () => drawLine(host, {quick: true}));
  return host;
}

// the finished drawing is the artist's ink, whole — the pen mask only matters while drawing
function finish(host) { host.__g?.removeAttribute('mask'); }

export function drawLine(host, {quick = false} = {}) {
  const strokes = host.__strokes; if (!strokes) return;
  host.__anims?.forEach((a) => a.cancel());
  if (reduce()) { finish(host); return; }
  host.__g?.setAttribute('mask', host.__mask);
  const speed = host.__speed * (quick ? 2.2 : 1);           // viewBox units per second
  let t = 0; const anims = [];
  for (const p of strokes) {
    const len = (p.getTotalLength?.() || Number(p.dataset.len) || 50) + 2;
    const dur = Math.max(90, (len / speed) * 1000);
    p.style.strokeDasharray = `${len} ${len}`;
    anims.push(p.animate([{strokeDashoffset: len}, {strokeDashoffset: 0}], {duration: dur, delay: t, easing: 'cubic-bezier(.4,.05,.3,1)', fill: 'both'}));
    t += dur * .92;
  }
  for (const e of host.__eyes) anims.push(e.animate([{opacity: 0, transform: 'scale(.6)'}, {opacity: 1, transform: 'scale(1)'}], {duration: 420, delay: t, easing: 'cubic-bezier(.2,.7,0,1)', fill: 'both'}));
  // after the last stroke, show the whole drawing (covers any ink the traced path missed)
  const last = anims[anims.length - 1];
  last?.finished.then(() => finish(host)).catch(() => {});
  host.__anims = anims;
}
