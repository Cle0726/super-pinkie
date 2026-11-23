/* laolao-metre-transition —— 切换进 Metre 的过场（11-24，第七版「起拍」）。
 *
 * 碧琪的几个模式切换用的是插画场景 + 进度条；Metre 用自己的语言：一张总谱，一支钴蓝指挥棒，♩=72。
 *   合上（0–320ms）：上下两半谱纸合到中缝，盖住旧页面。
 *   起拍（320–1100ms）：钴蓝指挥棒从下面抬起来，在最高点停半拍（417ms，♩=72）——这是预备拍。
 *   落拍（≈1100ms，整个过场的高潮）：棒子一下砸到中缝，棒尖迸出一圈钴蓝的点；五线谱从棒尖向两侧弹开（带一点回弹），
 *         上下几行谱表依次跟着铺开，成一整页谱面。
 *   亮灯：中间那行谱上方四盏谱台灯按三十二分音符一盏一盏亮（和首页亮灯同一个拍子网格），每盏在谱上照出一块光。
 *   落位：最后像素 M 当谱号从上面落到谱表左端，轻轻回弹一下停住。
 *   翻开（380ms）：新页面好了，谱纸从中缝上下翻开，同时发 pinkie:metre-sweep（页面进场跟着这一拍起）。新页面还没好就停在整页谱面上等。
 * 总长约 1.98 秒，和第六版（2.0 秒）一样长。小猫不再出现（用户 11-23）。
 * 画法：一张全屏 canvas，按像素格画（格子 = 短边 / 140，至少 4px）。没有图片、没有 WebGL；只在过场期间有 rAF。
 * 减少动态效果、或画不了 canvas 时返回 null，切换器照原来的方式原地换。
 * 对外：window.PinkieMetreTransition.play() → {overlay, ready, covered, waiting(), finish(), abort()}，和 PinkieModeTransitionFx 一个形状。 */
(() => {
  'use strict';
  if (window.PinkieMetreTransition) return;
  const root = document.documentElement;
  // 13×11 的像素 M（和 laolao-metre-brand.js 的 LOGO 同一张图；@ = 摆锤，强调色）
  const LOGO = [
    '...##...##...',
    '...##...##...',
    '...##...##...',
    '..#..#.@@.#..',
    '..#..#.@@.#..',
    '..#..#.#..#..',
    '..#...#...#..',
    '.#....#....#.',
    '.#....#....#.',
    '.#....#....#.',
    '#############',
  ];
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dark = () => root.getAttribute('data-theme') === 'dark' || root.hasAttribute('data-pinkie-night')
    || (!root.getAttribute('data-theme') && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches));
  const palette = () => dark()
    ? {bg: '#151514', line: '#77746B', faint: '#3A3935', on: '#ECEAE4', dim: '#34332F', accent: '#93A5EE', lamp: '#E9C77A', pool: 0.1}
    : {bg: '#F7F6F3', line: '#8E8A81', faint: '#DCD9D1', on: '#1B1A18', dim: '#DDDAD3', accent: '#2F4BB0', lamp: '#C9993A', pool: 0.13};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // 窗口在后台时 requestAnimationFrame 不走，切换会卡住；那时退回定时器
  const frame = () => document.hidden ? wait(32) : new Promise((resolve) => requestAnimationFrame(resolve));
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const backOut = (t, s = 1.4) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  // 时间线（毫秒，从合上开始算）
  const COVER = 320, LIFT = 620, ICTUS = 1097, SPREAD = 360, LAMP0 = ICTUS + 40, LAMP_STEP = 104, CLEF = 1380, CLEF_MS = 180, HOLD = 1600, OPEN = 380;

  function play() {
    if (reduced()) return null;
    const overlay = document.createElement('section');
    overlay.className = 'pk-metre-transition';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', '正在切换到 Metre');
    const canvas = document.createElement('canvas');
    const g = canvas.getContext?.('2d');
    if (!g) return null;
    overlay.append(canvas);
    Object.assign(overlay.style, {position: 'fixed', inset: '0', zIndex: '2147483000', pointerEvents: 'auto', background: 'transparent'});
    Object.assign(canvas.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block'});
    document.body.append(overlay);

    const W = window.innerWidth, H = window.innerHeight, ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio); g.setTransform(ratio, 0, 0, ratio, 0, 0);
    const C = palette();
    const P = Math.max(4, Math.round(Math.min(W, H) / 140));      // 像素格（860 高时 6px）
    const sn = (v) => Math.round(v / P) * P;
    const GAP = 3 * P, TH = Math.max(1, Math.round(P / 2));       // 谱线间距、线粗
    const mid = sn(H / 2), cx = sn(W / 2);                       // 中缝 = 中间那行谱的第三线；棒尖落在正中
    const sx0 = sn(W * 0.06), sx1 = sn(W * 0.94);
    // 整页谱面：中间一行（主谱表）+ 上下各几行（淡），行距 = 9 个谱线间距
    const PITCH = 9 * GAP, staves = [];
    for (let k = -6; k <= 6; k++) { const y = mid + k * PITCH; if (y - 2 * GAP > P && y + 2 * GAP < H - P) staves.push({k, y, lines: [-2, -1, 0, 1, 2].map((n) => y + n * GAP)}); }
    const main = staves.find((s) => s.k === 0);
    const LS = Math.max(2, Math.round((4 * GAP + 2 * P) / 11));  // 谱号 M 的一格
    const lx = sx0 + 2 * P, ly = Math.round(mid - (11 * LS) / 2);
    const clefEnd = lx + 13 * LS + 3 * P;
    const bars = [0.25, 0.5, 0.75].map((f) => sn(clefEnd + (sx1 - clefEnd) * f));   // 小节线
    const lamps = [0, 1, 2, 3].map((k) => ({x: sn(clefEnd + ((sx1 - clefEnd) * (k + 0.5)) / 4), at: LAMP0 + k * LAMP_STEP}));
    const st = {t: 0, dyTop: -mid, dyBot: H - mid};
    const box = (x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x, y, w, h); };

    // 指挥棒：棒尖的位置和棒子的朝向（棒尾相对棒尖的偏移）
    const REST = {x: cx - 3 * GAP, y: mid + 5 * GAP}, TOP = {x: cx + GAP, y: mid - 8 * GAP}, HIT = {x: cx, y: mid};
    function baton(t) {
      if (t < COVER - 120) return null;
      let tip, tail = {x: -12 * P, y: 14 * P}, alpha = clamp((t - COVER + 120) / 120);
      if (t < COVER) tip = REST;
      else if (t < LIFT) { const e = easeOut((t - COVER) / (LIFT - COVER)); tip = {x: REST.x + (TOP.x - REST.x) * e, y: REST.y + (TOP.y - REST.y) * e}; tail = {x: -12 * P + 3 * P * e, y: 14 * P - 2 * P * e}; }
      else if (t < ICTUS - 60) tip = TOP, tail = {x: -9 * P, y: 12 * P};                                  // 停半拍
      else if (t < ICTUS) { const e = easeIn((t - ICTUS + 60) / 60); tip = {x: TOP.x + (HIT.x - TOP.x) * e, y: TOP.y + (HIT.y - TOP.y) * e}; tail = {x: -9 * P - 5 * P * e, y: 12 * P - 6 * P * e}; }
      else { const u = clamp((t - ICTUS) / 220), e = easeOut(u); tip = {x: HIT.x + GAP * e, y: HIT.y - 3 * GAP * e}; tail = {x: -14 * P, y: 6 * P}; alpha = 1 - u; }
      return {x: sn(tip.x), y: sn(tip.y), tx: sn(tip.x + tail.x), ty: sn(tip.y + tail.y), alpha};
    }
    const trail = [];

    function content(t) {
      // 1. 谱表：落拍那一刻从棒尖 (cx) 向两侧弹开；离中间越远的那行晚 50ms
      for (const s of staves) {
        const p = clamp((t - ICTUS - Math.abs(s.k) * 50) / SPREAD);
        if (p <= 0) continue;
        const e = backOut(p), a = Math.max(sx0 - P, cx - (cx - sx0) * e), b = Math.min(sx1 + P, cx + (sx1 - cx) * e);
        const color = s === main ? (t - ICTUS < 90 ? C.accent : C.line) : C.faint;
        for (const y of s.lines) box(a, y - Math.floor(TH / 2), b - a, TH, color);
        if (p >= 1) {
          const top = s.lines[0] - Math.floor(TH / 2), h = 4 * GAP + TH;
          box(sx0, top, TH, h, color);                                                      // 起始线
          for (const x of bars) box(x, top, TH, h, color);                                  // 小节线
          box(sx1 - 3 * P, top, TH, h, color); box(sx1 - P, top, P, h, color);              // 终止线
        }
      }
      // 2. 落拍：棒尖迸出一圈钴蓝的点（120ms，八个方向往外）
      const d = t - ICTUS;
      if (d >= 0 && d < 160) {
        g.globalAlpha = 1 - d / 160;
        const r = sn(P + (d / 160) * 5 * GAP);
        for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) box(sn(HIT.x + ux * r) - P / 2, sn(HIT.y + uy * r) - P / 2, P, P, C.accent);
        if (d < 50) box(HIT.x - P, HIT.y - P, 2 * P, 2 * P, C.accent);
        g.globalAlpha = 1;
      }
      // 3. 谱台灯：中间那行上方四盏，三十二分音符一盏；灯一亮先冲一下再稳住，在谱上照出一块光
      if (main) for (const l of lamps) {
        if (t < ICTUS + 120) continue;
        const on = t >= l.at, hy = main.lines[0] - 5 * P;
        box(l.x - P, hy - 3 * P, TH, 3 * P, C.line);                                         // 灯杆
        box(l.x - 2 * P, hy, 4 * P, P, on ? C.lamp : C.dim);                                 // 灯罩
        if (!on) continue;
        const k = t - l.at < 80 ? 1.6 : 1;
        g.globalAlpha = C.pool * k;
        for (let y = hy + P, w = 4 * P; y < main.lines[4] + 2 * P; y += P, w += P) box(l.x - w / 2, y, w, P, C.lamp);
        g.globalAlpha = 1;
      }
      // 4. 谱号 = 像素 M：最后从上面落到谱表左端，轻轻回弹一下停住（中间的 V 常暗，摆锤是强调色）
      if (t >= CLEF) {
        const q = clamp((t - CLEF) / CLEF_MS), dy = sn(-(1 - backOut(q, 2.2)) * 5 * GAP);
        g.globalAlpha = clamp(q * 3);
        for (let gy = 0; gy < 11; gy++) for (let gx = 0; gx < 13; gx++) {
          const c = LOGO[gy][gx];
          if (c === '.') continue;
          const inner = gx >= 5 && gx <= 7 && gy >= 3 && gy <= 9;
          box(lx + gx * LS, ly + gy * LS + dy, LS, LS, c === '@' ? C.accent : inner ? C.dim : C.on);
        }
        g.font = `600 ${Math.max(10, Math.round(P * 2.2))}px ui-monospace, "Cascadia Mono", Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillStyle = C.line; g.fillText('♩ = 72', lx + (13 * LS) / 2, mid + 2 * GAP + 3 * P + dy);
        g.globalAlpha = 1;
      }
      // 5. 指挥棒（钴蓝的棒身 + 棒尾）和落下时的残影
      for (const p of trail) { g.globalAlpha = clamp(1 - (t - p.t) / 180) * 0.6; box(p.x, p.y, P, P, C.accent); }
      g.globalAlpha = 1;
      const b = baton(t);
      if (b && b.alpha > 0) {
        g.globalAlpha = b.alpha;
        const n = Math.max(Math.abs(b.tx - b.x), Math.abs(b.ty - b.y)) / P;
        for (let i = 0; i <= n; i++) { const f = i / Math.max(1, n); box(sn(b.x + (b.tx - b.x) * f) - P / 2, sn(b.y + (b.ty - b.y) * f) - P / 2, P, P, C.accent); }
        box(b.tx - P, b.ty - P, 2 * P, 2 * P, C.on);                                         // 棒尾的软木
        box(b.x - P / 2, b.y - P / 2, P, P, C.accent);
        g.globalAlpha = 1;
      }
    }
    function paint() {
      const t = st.t, b = baton(t);
      if (b && ((t >= ICTUS - 60 && t <= ICTUS) || (t > COVER && t < LIFT))) trail.push({x: b.x - P / 2, y: b.y - P / 2, t});
      while (trail.length && t - trail[0].t > 180) trail.shift();
      g.clearRect(0, 0, W, H);
      for (const [dy, y0, h] of [[st.dyTop, 0, mid], [st.dyBot, mid, H - mid]]) {
        g.save(); g.translate(0, sn(dy)); g.beginPath(); g.rect(0, y0, W, h); g.clip();
        box(0, y0, W, h, C.bg);
        box(0, y0 === 0 ? mid - 1 : mid, W, 1, C.dim);   // 谱纸的折缝
        content(t);
        g.restore();
      }
    }

    let alive = true, leaving = false, t0 = 0;
    const ready = frame();
    // 合上：按时间推进，慢机器上跳几帧也准时盖满
    const covered = (async () => {
      await ready;
      t0 = performance.now();
      while (alive && st.t < COVER) {
        st.t = performance.now() - t0;
        const e = easeInOut(clamp(st.t / COVER));
        st.dyTop = -mid * (1 - e); st.dyBot = (H - mid) * (1 - e);
        paint(); await frame();
      }
      if (!alive) throw new Error('aborted');
      st.dyTop = 0; st.dyBot = 0;
    })();
    // 起拍、落拍、亮灯、落位：和合上接着走；走完之前不翻开，之后新页面好了就翻开，没好就停在整页谱面上
    const counted = (async () => {
      try { await covered; } catch { return; }
      while (alive) { st.t = performance.now() - t0; if (leaving && st.t >= HOLD) return; paint(); await frame(); }
    })();

    async function finish() {
      leaving = true;
      await counted;
      if (!alive) return;
      window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: OPEN}}));   // 翻开：页面里的进场跟着这一拍起（laolao-metre-home.js）
      const o0 = performance.now();
      let d;
      while (alive && (d = performance.now() - o0) < OPEN) {
        const e = easeInOut(d / OPEN);
        st.t = performance.now() - t0;
        st.dyTop = -mid * e; st.dyBot = (H - mid) * e;
        paint(); await frame();
      }
      alive = false;
      overlay.remove();
    }
    function abort() { alive = false; overlay.remove(); }
    return {overlay, ready, covered, waiting() {}, finish, abort};
  }

  window.PinkieMetreTransition = Object.freeze({play});
})();
