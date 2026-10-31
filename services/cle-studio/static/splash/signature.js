// The C.le. signature as a pointed pen writes it: centre lines in stroke order (C → dot →
// l·e with the flourish → dot), pressure from stroke direction (heavy down, hairline up),
// entry/exit tapers. writeSignature(svg, p) draws the signature up to progress p ∈ [0,1].
const VIEW = {w: 200, h: 96};
const SLANT = Math.tan(12 * Math.PI / 180), BASE = 64;
const skew = (x, y) => ({x: x + (BASE - y) * SLANT, y});
const STROKES = [
  {id: 'C', d: 'M55 25C53 17 44 13 34 16C20 20 12 36 15 52C18 67 33 74 47 68C53 65 57 60 59 55', w: 5.2, time: .26},
  {id: 'd1', dot: [67, 64], r: 3.9, time: .05},
  {id: 'le', d: 'M73 64C82 55 95 37 97 24C98.5 14 91 11 88 19C84 30 85 50 88 59C90 65 96 66 102 61C108 56 118 50 118 44C118 39 111 38 107 44C103 51 104 62 113 65C120 67 128 63 134 59C142 54 157 55 161 61C164 66 152 73 120 76.5C88 79.5 50 78 24 84', w: 4.6, time: .6},
  {id: 'd2', dot: [168, 64], r: 3.9, time: .09},
];
const NS = 'http://www.w3.org/2000/svg';

function width(base, dirY, t, tailLong) {
  const down = Math.max(0, dirY);
  let w = base * (.16 + 1.12 * Math.pow(down, 1.4) + .12 * (1 - Math.abs(dirY)));
  w *= .35 + .65 * Math.min(1, t / .06);
  const tail = tailLong ? .58 : .85;
  if (t > tail) w *= 1 - .9 * Math.pow((t - tail) / (1 - tail), 1.2);
  return Math.max(.35, w);
}

let cache = null;
function geometry(svg) {
  if (cache) return cache;
  const probe = document.createElementNS(NS, 'path');
  svg.append(probe);
  cache = STROKES.map((s) => {
    if (s.dot) return s;
    probe.setAttribute('d', s.d);
    const L = probe.getTotalLength(), n = Math.max(40, Math.round(L / .6)), pts = [];
    for (let i = 0; i <= n; i++) {
      const at = (i / n) * L;
      let a = probe.getPointAtLength(at), b = probe.getPointAtLength(Math.min(L, at + .7));
      const c = i === n ? probe.getPointAtLength(Math.max(0, at - .7)) : null;
      a = skew(a.x, a.y); b = skew(b.x, b.y);
      const cc = c ? skew(c.x, c.y) : null;
      let tx = cc ? a.x - cc.x : b.x - a.x, ty = cc ? a.y - cc.y : b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      pts.push({x: a.x, y: a.y, nx: -ty, ny: tx, w: width(s.w, ty, i / n, s.id === 'le')});
    }
    return {...s, pts};
  });
  probe.remove();
  return cache;
}

const dotPath = (s, k) => {
  const r = s.r * k, q = skew(s.dot[0], s.dot[1]);
  return `M${q.x - r} ${q.y}a${r} ${r * .86} -28 1 0 ${2 * r} 0a${r} ${r * .86} -28 1 0 ${-2 * r} 0Z`;
};
function partial(s, f) {
  const m = Math.max(2, Math.round(s.pts.length * f));
  const pts = s.pts.slice(0, m), L = [], R = [];
  pts.forEach((p, i) => {
    // the nib is still on the paper at the leading edge: round it off instead of a flat cut
    const lead = f < 1 ? Math.min(1, (m - 1 - i) / 6) : 1;
    const w = p.w * (.55 + .45 * lead);
    L.push(`${(p.x + p.nx * w / 2).toFixed(2)} ${(p.y + p.ny * w / 2).toFixed(2)}`);
    R.push(`${(p.x - p.nx * w / 2).toFixed(2)} ${(p.y - p.ny * w / 2).toFixed(2)}`);
  });
  return `M${L.join('L')}L${R.reverse().join('L')}Z`;
}

export function createSignature(color = 'currentColor') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW.w} ${VIEW.h}`);
  svg.setAttribute('aria-label', 'C.le.');
  svg.setAttribute('role', 'img');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', color);
  svg.append(path);
  return {svg, write: (p) => writeSignature(svg, p, path)};
}

export function writeSignature(svg, progress, path = svg.querySelector('path')) {
  const g = geometry(svg);
  const total = g.reduce((a, s) => a + s.time, 0);
  let left = Math.max(0, Math.min(1, progress)) * total, d = '';
  for (const s of g) {
    if (left <= 0) break;
    const f = Math.min(1, left / s.time);
    // ease each stroke: the pen accelerates into the stroke and settles at the end
    const e = f < 1 ? 1 - Math.pow(1 - f, 1.6) : 1;
    d += s.dot ? dotPath(s, Math.min(1, e * 1.25)) : partial(s, e);
    left -= s.time;
  }
  path.setAttribute('d', d);
}
