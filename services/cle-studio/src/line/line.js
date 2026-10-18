// Li An in line: continuous-line drawings (traced to pen strokes by tools/lineart.py) that draw themselves.
// A stroke is drawn at a steady pen speed, strokes follow in the order a hand would make them, and the eyes
// light up — sapphire — only once the drawing is finished.
const NS = 'http://www.w3.org/2000/svg';
const cache = new Map();
const BASE = '/cle/static/art/line/';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function loadLine(name) {
  if (!cache.has(name)) cache.set(name, fetch(`${BASE}${name}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(name);
}

// <span class="cle-line" data-line="tier-base"></span> → an svg that draws itself when shown
export function lineArt(name, {weight = 1, draw = true, speed = 140, eyes = true} = {}) {
  const host = document.createElement('span');
  host.className = 'cle-line'; host.dataset.line = name; host.setAttribute('aria-hidden', 'true');
  loadLine(name).then((data) => {
    if (!data) { host.classList.add('is-missing'); return; }
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', data.viewBox);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'cle-line__ink');
    g.setAttribute('stroke-width', String(Math.max(.9, data.width) * weight));
    for (const s of data.strokes) {
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', s.d); p.dataset.len = s.len; g.append(p);
    }
    svg.append(g);
    if (eyes) for (const d of data.eyes) { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); e.setAttribute('class', 'cle-line__eye'); svg.append(e); }
    host.append(svg);
    host.__strokes = [...g.children]; host.__eyes = [...svg.querySelectorAll('.cle-line__eye')]; host.__speed = speed;
    if (draw) drawLine(host);
  });
  host.addEventListener('pointerenter', () => drawLine(host, {quick: true}));
  return host;
}

export function drawLine(host, {quick = false} = {}) {
  const strokes = host.__strokes; if (!strokes) return;
  host.__anims?.forEach((a) => a.cancel());
  if (reduce()) return;
  const speed = host.__speed * (quick ? 2.2 : 1);           // viewBox units per second
  let t = 0; const anims = [];
  for (const p of strokes) {
    const len = p.getTotalLength?.() || Number(p.dataset.len) || 50;
    const dur = Math.max(90, (len / speed) * 1000);
    p.style.strokeDasharray = `${len} ${len}`;
    anims.push(p.animate([{strokeDashoffset: len}, {strokeDashoffset: 0}], {duration: dur, delay: t, easing: 'cubic-bezier(.4,.05,.3,1)', fill: 'both'}));
    t += dur * .92;                                        // the next stroke begins as the pen lifts
  }
  for (const e of host.__eyes) anims.push(e.animate([{opacity: 0, transform: 'scale(.6)'}, {opacity: 1, transform: 'scale(1)'}], {duration: 420, delay: t, easing: 'cubic-bezier(.2,.7,0,1)', fill: 'both'}));
  host.__anims = anims;
}
