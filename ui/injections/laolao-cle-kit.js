/* cle-kit:v1 —— C.le. 连笔动画的底层：签名拆笔、取样、画笔
 *
 * 每颗粒子一辈子属于签名的同一笔、同一段（part / u / order）。所有形态都按这个身份摆放，
 * 所以任意两个形态之间插值，都是一根墨线在弯，不是一团粉末在换位置。
 * 这里没有 DOM、没有 three：tests/cle-ink.test.mjs 直接在 node 里跑。
 */
export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const fract = (x) => x - Math.floor(x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const bump = (x, w) => Math.exp(-(x / w) * (x / w));
/** 0 → 1 → 2 → 1 → 0：三个位置来回走，不从头跳回去。返回连续的位置。 */
export function pingPong3(t) {
  const k = ((t % 4) + 4) % 4, i = Math.floor(k), e = smooth(.3, 1, k - i);
  return i < 2 ? i + e : 4 - i - e;
}

// 签名画布 200×96 ↔ three 世界坐标
export const VIEW = {cx: 96, cy: 54, scale: 19};
export const viewX = (x) => x * VIEW.scale + VIEW.cx;
export const viewY = (y) => VIEW.cy - y * VIEW.scale;
export const worldX = (x) => (x - VIEW.cx) / VIEW.scale;
export const worldY = (y) => -(y - VIEW.cy) / VIEW.scale;

// 每颗粒子每帧的 8 个量
export const X = 0, Y = 1, Z = 2, W = 3, GLOW = 4, ALPHA = 5, SIZE = 6, RED = 7, STRIDE = 8;
// 签名的 6 个部件
export const PART = {C: 0, DOT1: 1, L: 2, E: 3, TAIL: 4, DOT2: 5};
// 「l·e·花式下划线」这一笔里 l、e 各在哪里结束（按弧长）
export const L_END = .3236, E_END = .5493;

/* ── 画笔 ── */
// 只认签名用到的写法：M x y (C x1 y1 x2 y2 x y)*
function flatten(d) {
  const n = (d.match(/-?(?:\d+\.?\d*|\.\d+)/g) || []).map(Number);
  const out = [n[0], n[1]];
  let x = n[0], y = n[1];
  for (let j = 2; j + 5 < n.length; j += 6) {
    for (let k = 1; k <= 48; k++) {
      const t = k / 48, m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, e = t * t * t;
      out.push(a * x + b * n[j] + c * n[j + 2] + e * n[j + 4], a * y + b * n[j + 1] + c * n[j + 3] + e * n[j + 5]);
    }
    x = n[j + 4]; y = n[j + 5];
  }
  return out;
}

/** 折线按弧长取点：u ∈ [0, 1] → 写进 to[0..1]。 */
export function polyline(flat) {
  const n = flat.length / 2, acc = new Float64Array(n);
  for (let k = 1; k < n; k++) acc[k] = acc[k - 1] + Math.hypot(flat[k * 2] - flat[k * 2 - 2], flat[k * 2 + 1] - flat[k * 2 - 1]);
  const length = acc[n - 1];
  const at = (u, to) => {
    const s = clamp(u) * length;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (acc[mid] <= s) lo = mid; else hi = mid; }
    const f = clamp((s - acc[lo]) / ((acc[hi] - acc[lo]) || 1));
    to[0] = lerp(flat[lo * 2], flat[hi * 2], f);
    to[1] = lerp(flat[lo * 2 + 1], flat[hi * 2 + 1], f);
    return to;
  };
  return {length, at};
}

/** 和 CleSignature.centerline 同一支笔（12° 斜度、下重上轻、入锋与出锋），但不需要 DOM。 */
export function centerline(SIG, stroke, step = .5) {
  const line = polyline(flatten(stroke.d)), L = line.length, n = Math.max(24, Math.round(L / step)), pts = [], a = [0, 0], b = [0, 0];
  for (let k = 0; k <= n; k++) {
    const last = k === n;
    line.at(k / n, a);
    line.at((last ? Math.max(0, L - .7) : Math.min(L, (k / n) * L + .7)) / L, b);
    const p = SIG.skew(a[0], a[1]), q = SIG.skew(b[0], b[1]);
    let tx = last ? p.x - q.x : q.x - p.x, ty = last ? p.y - q.y : q.y - p.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    pts.push({x: p.x, y: p.y, nx: -ty, ny: tx, t: k / n, w: SIG.width(stroke.w, ty, k / n, stroke.id === 'le')});
  }
  return {pts, len: L};
}

/** 一笔 → [x, y, 笔宽] × n，给形态反复取样用。hair：末端拖成发丝（和花式下划线一样）。 */
export function pen(SIG, d, w, hair) {
  const {pts} = centerline(SIG, {d, w, id: hair ? 'le' : 'form'});
  const out = new Float32Array(pts.length * 3);
  pts.forEach((p, k) => out.set([p.x, p.y, p.w], k * 3));
  return out;
}

/* ── 签名几何与笔顺时间线 ── */
export function buildSignature(SIG, line = (s) => centerline(SIG, s)) {
  const segs = SIG.strokes.map((s, i) => {
    if (s.dot) return {i, dot: true, c: SIG.skew(s.dot[0], s.dot[1]), r: s.r, letter: 3, len: 16};
    const cl = line(s);
    return {i, dot: false, pts: cl.pts, letter: s.id === 'C' ? 0 : 1, len: cl.len};
  });
  const total = segs.reduce((a, s) => a + s.len, 0);
  let acc = 0;
  segs.forEach((s) => { s.o0 = acc / total; acc += s.len; s.o1 = acc / total; });
  return {segs, total};
}

/* 落笔时长按笔画长度分配；段间提笔划弧；点用「顿」 */
export function buildTimeline(sig, speed, loop) {
  const DRAW = 3.4 / speed, AIR = .22 / speed, DAB = .28 / speed;
  const steps = [];
  let t = .3;
  steps.push({kind: 'enter', t0: 0, t1: t});
  sig.segs.forEach((s, i) => {
    if (i) { steps.push({kind: 'air', t0: t, t1: t + AIR, from: i - 1, to: i}); t += AIR; }
    const d = s.dot ? DAB : DRAW * (s.len / sig.total) * 1.3;
    steps.push({kind: s.dot ? 'dab' : 'draw', seg: i, t0: t, t1: t + d});
    t += d;
  });
  const end = t;
  if (loop) {
    steps.push({kind: 'hold', t0: t, t1: t + .9}); t += .9;
    steps.push({kind: 'leave', t0: t, t1: t + .45}); t += .45;
    steps.push({kind: 'fade', t0: t, t1: t + .55}); t += .55;
  } else {
    steps.push({kind: 'hold', t0: t, t1: t + 99});
  }
  return {steps, period: loop ? t : Infinity, end};
}

/* ── 粒子 ── */
export function buildParticles(sig, n, random = Math.random) {
  const f32 = (k = 1) => new Float32Array(n * k), u8 = () => new Uint8Array(n);
  const P = {
    n,
    part: u8(), letter: u8(), quill: u8(),
    u: f32(),              // 在这个部件里的位置
    order: f32(),          // 在整枚签名里的笔顺
    local: f32(),          // 在这一笔里的位置
    cx: f32(), cy: f32(),  // 笔画中心线（画布坐标）
    off: f32(), width: f32(),
    text: f32(3),          // 落在签名笔画里的原位（世界坐标）
    seed: f32(4),
    discX: f32(), discY: f32(),
    size: f32(), alpha: f32(),
    before: new Int32Array(n), after: new Int32Array(n), // 算法向用的前后邻居
  };
  for (let i = 0; i < n; i++) {
    const o = (i + random() * .5) / n;
    const seg = sig.segs.find((s) => o <= s.o1 + 1e-6) || sig.segs[sig.segs.length - 1];
    const local = (o - seg.o0) / (seg.o1 - seg.o0);
    let x, y, cx, cy, letter = seg.letter;
    if (seg.dot) {
      const th = random() * TAU, r = seg.r * Math.sqrt(random());
      x = seg.c.x + Math.cos(th) * r; y = seg.c.y + Math.sin(th) * r * .86; cx = seg.c.x; cy = seg.c.y;
      P.part[i] = seg.i === 1 ? PART.DOT1 : PART.DOT2;
    } else {
      const f = local * (seg.pts.length - 1), j = Math.floor(f), m = f - j;
      const p = seg.pts[j], q = seg.pts[Math.min(seg.pts.length - 1, j + 1)];
      cx = lerp(p.x, q.x, m); cy = lerp(p.y, q.y, m);
      P.width[i] = lerp(p.w, q.w, m);
      P.off[i] = random() - .5;
      x = cx + p.nx * P.off[i] * P.width[i]; y = cy + p.ny * P.off[i] * P.width[i];
      if (seg.i === 2 && cx > 100) letter = 2;           // e 及之后
      P.part[i] = seg.i === 0 ? PART.C : local < L_END ? PART.L : local < E_END ? PART.E : PART.TAIL;
    }
    P.text.set([worldX(x), worldY(y), (random() - .5) * .05], i * 3);
    P.cx[i] = cx; P.cy[i] = cy; P.order[i] = o; P.local[i] = local; P.letter[i] = letter;
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) P.seed[i * 4 + k] = random();
    P.quill[i] = random() < .34 ? 1 : 0;
  }
  // 部件内的序号、圆盘里的位置、点大小与透明度
  const size = [0, 0, 0, 0, 0, 0], seen = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) size[P.part[i]]++;
  const reach = Math.max(1, Math.round(n / 365));          // 1100 颗时 ±3
  for (let i = 0; i < n; i++) {
    const p = P.part[i], k = seen[p]++;
    P.u[i] = k / Math.max(1, size[p] - 1);
    P.before[i] = i - Math.min(reach, k);
    P.after[i] = i + Math.min(reach, size[p] - 1 - k);
    const a = P.seed[i * 4] * TAU, r = Math.sqrt(P.seed[i * 4 + 1]), w = P.seed[i * 4 + 3];
    P.discX[i] = Math.cos(a) * r; P.discY[i] = Math.sin(a) * r * .86;
    P.size[i] = .55 + w * .9; P.alpha[i] = .55 + .45 * w;
  }
  return P;
}

/**
 * 同一堆点，只换「哪颗粒子去哪个点」：members 按笔顺排着，seeds 按形状上的先后排好，一一对应。
 * 停下来看到的点一个不差，变形时却是连着的。
 */
export function assign(perm, members, key) {
  const sorted = members.map((i) => [key(i), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  members.forEach((i, k) => { perm[i] = sorted[k][1]; });
}
