/* laolao-metre-transition —— 切换进 Metre 的过场（11-24 第八版「起拍」：协调者验收后加重落拍的分量）。一张总谱，一支钴蓝指挥棒，♩=72。
 *   合上（0–320ms）：上下两半谱纸合到中缝。谱纸中间有一束舞台光、四边暗下去，谱线淡淡印在上面。起拍（320–1030ms）：很大的钴蓝指挥棒从右下抬起，停在画面正中上方半拍（417ms）。
 *   落拍（≈1100ms，高潮）：棒子砸到画面正中，拖着一道连贯的拖影；棒尖一闪，迸出钴蓝像素点，三圈像素环从棒尖往外扩、越扩越稀越淡，中间那行五线谱用钴蓝墨色、加粗地从棒尖向两侧弹开
 *   （冲过头再回弹），上下几行谱表依次铺开。亮灯：四盏谱台灯按三十二分音符一盏盏亮，灯罩先冲亮再稳住，在谱面上投下一锥暖光和一圈光晕。
 *   落位：像素 M 当谱号落到谱表左端、轻轻回弹。翻开（380ms）：新页面好了，谱纸从中缝上下翻开，同时发 pinkie:metre-sweep；没好就停在整页谱面上等。
 * 总长约 1.98 秒（第六版 2.0 秒）。小猫不再出现（用户 11-23）。一张全屏 canvas 按像素格画（短边 / 140，至少 4px），没有图片和 WebGL，只在过场期间有 rAF。
 * 减少动态效果、或画不了 canvas 时返回 null，切换器照原来的方式原地换。对外：window.PinkieMetreTransition.play() → {overlay, ready, covered, waiting(), finish(), abort()}。 */
(() => {
  'use strict';
  if (window.PinkieMetreTransition) return;
  const root = document.documentElement;
  // 13×11 的像素 M（和 laolao-metre-brand.js 的 LOGO 同一张图；@ = 摆锤，强调色）
  const LOGO = ['...##...##...', '...##...##...', '...##...##...', '..#..#.@@.#..', '..#..#.@@.#..', '..#..#.#..#..',
    '..#...#...#..', '.#....#....#.', '.#....#....#.', '.#....#....#.', '#############'];
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dark = () => root.getAttribute('data-theme') === 'dark' || root.hasAttribute('data-pinkie-night')
    || (!root.getAttribute('data-theme') && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches));
  const palette = () => dark()
    ? {bg: '#151514', glow: '#25262F', edge: '#0B0B0A', ghost: '#3A3A42', line: '#77746B', on: '#ECEAE4', dim: '#3A3935', accent: '#93A5EE', ink: '#B4C1F6', lamp: '#E9C77A', hot: '#FFE6A8', warm: '255,214,140', night: true}
    : {bg: '#F7F6F3', glow: '#FFFDF7', edge: '#E6E1D6', ghost: '#CCC6B9', line: '#8E8A81', on: '#1B1A18', dim: '#D6D2C9', accent: '#2F4BB0', ink: '#26408F', lamp: '#D89A2C', hot: '#FFCF6E', warm: '232,168,60', night: false};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // 窗口在后台时 requestAnimationFrame 不走，切换会卡住；那时退回定时器
  const frame = () => document.hidden ? wait(32) : new Promise((resolve) => requestAnimationFrame(resolve));
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3), easeIn = (t) => t * t * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const backOut = (t, s = 1.4) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  const rnd = (i, s = 1) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); }, lerp = (a, b, u) => a + (b - a) * u;
  // 时间线（毫秒，从合上开始算）
  const COVER = 320, LIFT = 620, ICTUS = 1097, SPREAD = 360, LAMP0 = ICTUS + 40, LAMP_STEP = 104, CLEF = 1380, CLEF_MS = 180, HOLD = 1600, OPEN = 380;

  function play() {
    if (reduced()) return null;
    const overlay = document.createElement('section');
    overlay.className = 'pk-metre-transition'; overlay.setAttribute('role', 'status'); overlay.setAttribute('aria-live', 'polite'); overlay.setAttribute('aria-label', '正在切换到 Metre');
    const canvas = document.createElement('canvas'), g = canvas.getContext?.('2d');
    if (!g) return null;
    overlay.append(canvas);
    Object.assign(overlay.style, {position: 'fixed', inset: '0', zIndex: '2147483000', pointerEvents: 'auto', background: 'transparent'});
    Object.assign(canvas.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block'});
    document.body.append(overlay);

    const W = window.innerWidth, H = window.innerHeight, ratio = Math.min(2, window.devicePixelRatio || 1), S = Math.min(W, H);
    canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio); g.setTransform(ratio, 0, 0, ratio, 0, 0);
    const C = palette();
    const P = Math.max(4, Math.round(S / 140));                  // 像素格（860 高时 6px）
    const sn = (v) => Math.round(v / P) * P;
    const GAP = 3 * P, TH = Math.max(3, Math.round(P * 0.67)), TH2 = Math.max(2, Math.round(P / 3));   // 谱线间距、主谱表线粗、其余谱表线粗
    const mid = sn(H / 2), cx = sn(W / 2);                       // 中缝 = 中间那行谱的第三线；棒尖落在画面正中
    const sx0 = sn(W * 0.06), sx1 = sn(W * 0.94);
    // 整页谱面：中间一行（主谱表）+ 上下各几行，行距 = 9 个谱线间距
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
    // 谱纸：中间一束舞台光、四边暗下去（画一次，每帧贴上去）
    const paper = document.createElement('canvas'); paper.width = canvas.width; paper.height = canvas.height;
    { const pg = paper.getContext('2d'); pg.setTransform(ratio, 0, 0, ratio, 0, 0);
      const gr = pg.createRadialGradient(cx, mid - S * 0.1, S * 0.05, cx, mid, Math.hypot(W, H) * 0.62);
      gr.addColorStop(0, C.glow); gr.addColorStop(0.55, C.bg); gr.addColorStop(1, C.edge); pg.fillStyle = gr; pg.fillRect(0, 0, W, H); }

    // 指挥棒：棒尖的位置 + 棒身朝向（从棒尖指向棒尾的角度）。棒长是短边的三成，落拍时落在画面正中。
    const BL = S * 0.36;
    const REST = {x: cx + S * 0.16, y: mid + S * 0.34, a: 0.95}, TOP = {x: cx + S * 0.03, y: mid - S * 0.33, a: 1.2}, HIT = {x: cx, y: mid, a: 0.62};
    function baton(t) {
      if (t < COVER - 140) return null;
      let p, alpha = clamp((t - COVER + 140) / 140);
      if (t < COVER) p = REST;
      else if (t < LIFT) { const e = easeOut((t - COVER) / (LIFT - COVER)); p = {x: lerp(REST.x, TOP.x, e), y: lerp(REST.y, TOP.y, e), a: lerp(REST.a, TOP.a, e)}; }
      else if (t < ICTUS - 70) { const u = (t - LIFT) / (ICTUS - 70 - LIFT); p = {...TOP, y: TOP.y - Math.sin(u * Math.PI / 2) * P * 1.5}; }   // 停半拍，吸一口气
      else if (t < ICTUS) { const e = easeIn((t - ICTUS + 70) / 70); p = {x: lerp(TOP.x, HIT.x, e), y: lerp(TOP.y - P * 1.5, HIT.y, e), a: lerp(TOP.a, HIT.a, e)}; }
      else { const u = clamp((t - ICTUS) / 320), e = easeOut(u); p = {x: HIT.x + S * 0.02 * e, y: HIT.y - S * 0.07 * Math.sin(Math.min(1, u * 1.4) * Math.PI / 2), a: HIT.a + 0.2 * e}; alpha = t - ICTUS < 120 ? 1 : 1 - clamp((t - ICTUS - 120) / 200); }
      return {...p, alpha};
    }
    function drawBaton(b, alpha) {
      const dx = Math.cos(b.a), dy = Math.sin(b.a), n = Math.ceil(BL / (P / 2));
      g.globalAlpha = alpha;
      for (let i = 0; i <= n; i++) {
        const f = i / n, x = b.x + dx * BL * f, y = b.y + dy * BL * f;
        const grip = f > 0.76, w = grip ? 4 * P : Math.max(P, Math.round(P * (1.4 + f * 1.6)));
        box(sn(x) - w / 2, sn(y) - w / 2, w, w, grip ? C.on : C.accent);
        if (!grip && f > 0.06) box(sn(x) - w / 2, sn(y) - w / 2, Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(w / 3)), C.night ? '#D6DEFF' : '#6F86D8');   // 棒身的高光
      }
      box(sn(b.x) - P, sn(b.y) - P, 2 * P, 2 * P, C.accent);
      g.globalAlpha = 1;
    }

    function content(t) {
      const d = t - ICTUS;   // 0. 谱纸上淡淡印着的谱线（合上以后就在，页面不是一张白纸）
      g.globalAlpha = clamp((t - COVER + 200) / 400) * (d > 0 ? 1 - clamp(d / SPREAD) : 1);
      for (const s of staves) for (const y of s.lines) box(sx0, y, sx1 - sx0, 1, C.ghost);
      g.globalAlpha = 1;
      // 0.5 起拍到落拍之间：一束追光打在棒尖上，跟着棒尖走（页面中段不再是一张空纸）
      const bb = d < 0 ? baton(t) : null;
      if (bb && t > COVER) { const gr = g.createRadialGradient(bb.x, bb.y, 0, bb.x, bb.y, S * 0.3), a = (C.night ? 0.34 : 0.5) * clamp((t - COVER) / 300);
        gr.addColorStop(0, `rgba(${C.warm},${a})`); gr.addColorStop(1, `rgba(${C.warm},0)`); g.fillStyle = gr; g.fillRect(bb.x - S * 0.3, bb.y - S * 0.3, S * 0.6, S * 0.6); }
      // 1. 落拍那一下的光：棒尖一闪，一圈暖白的光
      if (d >= 0 && d < 220) { const gr = g.createRadialGradient(HIT.x, HIT.y, 0, HIT.x, HIT.y, S * 0.24); const a = 0.5 * (1 - d / 220);
        gr.addColorStop(0, C.night ? `rgba(180,196,255,${a})` : `rgba(47,75,176,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(HIT.x - S * 0.24, HIT.y - S * 0.24, S * 0.48, S * 0.48); }
      // 2. 谱表：从棒尖 (cx) 向两侧弹开，冲过头再回来；主谱表钴蓝墨色、加粗，稳住后变成深一点的墨色
      for (const s of staves) {
        const p = clamp((d - Math.abs(s.k) * 45) / SPREAD); if (p <= 0) continue;
        const e = backOut(p, 1.9), a = Math.max(sx0 - 4 * P, cx - (cx - sx0) * e), b = Math.min(sx1 + 4 * P, cx + (sx1 - cx) * e);
        const isMain = s === main, th = isMain ? TH + (d < 120 ? 2 : 0) : TH2;
        const bounce = isMain && d < 300 ? Math.round(Math.sin((d / 300) * Math.PI * 2) * P * 0.6 * (1 - d / 300)) : 0;
        const color = isMain ? (d < 260 ? C.accent : C.ink) : C.line;
        for (const y of s.lines) box(a, y + bounce - Math.floor(th / 2), b - a, th, color);
        if (p >= 1) {
          const top = s.lines[0] - Math.floor(th / 2), h = 4 * GAP + th;
          box(sx0, top, th, h, color);                                                      // 起始线
          for (const x of bars) box(x, top, Math.max(2, th - 1), h, color);                 // 小节线
          box(sx1 - 3 * P, top, th, h, color); box(sx1 - P, top, P + 1, h, color);          // 终止线
        }
      }
      // 3. 落拍的波：从棒尖往外扩的三圈像素环（像谱线的波纹），里圈实、外圈越扩越稀、越淡，边上的像素有虚有实；再加二十道迸出的像素点
      if (d >= 0 && d < 360) {
        for (let k = 0; k < 3; k++) {
          const u = clamp((d - k * 55) / 300); if (u <= 0 || u >= 1) continue;
          const rx = easeOut(u) * S * (0.2 + k * 0.08), ry = rx * 0.62, n = Math.max(12, Math.ceil((Math.PI * 2 * rx) / (P * 1.25))), keep = 0.92 - u * 0.55 - k * 0.12;
          for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, q = rnd(i, k + 7); if (q > keep) continue;
            g.globalAlpha = (1 - u) * (0.35 + 0.65 * q / Math.max(0.01, keep)) * (k ? 0.75 : 1); const sz = k === 0 && u < 0.5 ? 2 * P : P;
            box(sn(HIT.x + Math.cos(a) * rx) - sz / 2, sn(HIT.y + Math.sin(a) * ry) - sz / 2, sz, sz, k === 1 ? C.ink : C.accent); }
        }
        g.globalAlpha = 1 - clamp(d / 280);
        for (let i = 0; i < 20; i++) {
          const ang = (i / 20) * Math.PI * 2 + 0.16, ux = Math.cos(ang), uy = Math.sin(ang) * 0.72, jitter = 0.8 + 0.45 * rnd(i, 3);
          for (let k = 0; k < 3; k++) { const rr = easeOut(clamp(d / (200 + k * 60))) * S * (0.07 + k * 0.06) * jitter, sz = [2 * P, Math.round(1.5 * P), P][k]; box(sn(HIT.x + ux * rr) - sz / 2, sn(HIT.y + uy * rr) - sz / 2, sz, sz, i % 5 === 2 ? C.lamp : C.accent); }
        }
        g.globalAlpha = 1;
      }
      // 4. 谱台灯：中间那行上方四盏，三十二分音符一盏；灯罩先冲亮再稳住，在谱面上投下一锥暖光和一圈光晕
      if (main) for (const l of lamps) {
        if (t < ICTUS + 100) continue;
        const on = t >= l.at, sy = main.lines[0] - 6 * P, k = on ? (t - l.at < 90 ? 1.5 : 1) : 0;
        box(l.x - P / 2, sy - 4 * P, Math.max(2, P / 2), 4 * P, C.line);                    // 灯杆
        if (on) {
          const cone = g.createLinearGradient(0, sy, 0, main.lines[4] + 3 * P);
          cone.addColorStop(0, `rgba(${C.warm},${0.42 * k})`); cone.addColorStop(1, `rgba(${C.warm},0.04)`);
          g.fillStyle = cone; g.beginPath(); g.moveTo(l.x - 3 * P, sy + 2 * P); g.lineTo(l.x + 3 * P, sy + 2 * P); g.lineTo(l.x + 9 * P, main.lines[4] + 3 * P); g.lineTo(l.x - 9 * P, main.lines[4] + 3 * P); g.closePath(); g.fill();
          const halo = g.createRadialGradient(l.x, sy + 2 * P, 0, l.x, sy + 2 * P, 11 * P);
          halo.addColorStop(0, `rgba(${C.warm},${0.6 * k})`); halo.addColorStop(1, `rgba(${C.warm},0)`); g.fillStyle = halo; g.fillRect(l.x - 11 * P, sy - 9 * P, 22 * P, 22 * P);
        }
        box(l.x - 3 * P, sy, 6 * P, 2 * P, on ? (k > 1 ? C.hot : C.lamp) : C.dim);             // 灯罩
        box(l.x - 2 * P, sy - P, 4 * P, P, on ? C.lamp : C.dim);
      }
      // 5. 谱号 = 像素 M：最后从上面落到谱表左端，轻轻回弹一下停住（中间的 V 常暗，摆锤是强调色）
      if (t >= CLEF) {
        const q = clamp((t - CLEF) / CLEF_MS), dy = sn(-(1 - backOut(q, 2.2)) * 5 * GAP);
        g.globalAlpha = clamp(q * 3);
        for (let gy = 0; gy < 11; gy++) for (let gx = 0; gx < 13; gx++) {
          const c = LOGO[gy][gx]; if (c === '.') continue;
          const inner = gx >= 5 && gx <= 7 && gy >= 3 && gy <= 9;
          box(lx + gx * LS, ly + gy * LS + dy, LS, LS, c === '@' ? C.accent : inner ? C.dim : C.on);
        }
        g.font = `600 ${Math.max(10, Math.round(P * 2.2))}px ui-monospace, "Cascadia Mono", Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillStyle = C.line; g.fillText('♩ = 72', lx + (13 * LS) / 2, mid + 2 * GAP + 3 * P + dy);
        g.globalAlpha = 1;
      }
      // 6. 落下时的拖影：一道连贯的扇面（把最近 80ms 里棒身扫过的地方连起来，离现在越远越淡），然后是指挥棒本身
      if (d > -70 && d < 90) for (const [span, a] of [[90, 0.3], [40, 0.22]]) {
        const pts = Array.from({length: 10}, (_, k) => baton(t - (span * k) / 9)).filter(Boolean); if (pts.length < 2) continue;
        const o = pts[pts.length - 1], fade = g.createLinearGradient(o.x, o.y, pts[0].x, pts[0].y); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, C.accent);   // 越早越淡，尾巴化进纸里
        g.globalAlpha = a * (d > 0 ? 1 - d / 90 : 1); g.fillStyle = fade; g.beginPath();
        pts.forEach((q, k) => (k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); for (const q of pts.reverse()) g.lineTo(q.x + Math.cos(q.a) * BL * 0.76, q.y + Math.sin(q.a) * BL * 0.76);
        g.closePath(); g.fill(); g.globalAlpha = 1;
      } const b = baton(t); if (b && b.alpha > 0) drawBaton(b, b.alpha);
    }
    function paint() {
      const t = st.t; g.clearRect(0, 0, W, H);
      for (const [dy, y0, h] of [[st.dyTop, 0, mid], [st.dyBot, mid, H - mid]]) {
        g.save(); g.translate(0, sn(dy)); g.beginPath(); g.rect(0, y0, W, h); g.clip();
        g.drawImage(paper, 0, y0 * ratio, W * ratio, h * ratio, 0, y0, W, h);
        box(0, y0 === 0 ? mid - 1 : mid, W, 1, C.dim);   // 谱纸的折缝
        content(t);
        g.restore();
      }
    }

    let alive = true, leaving = false, t0 = 0; const ready = frame();
    // 合上：按时间推进，慢机器上跳几帧也准时盖满
    const covered = (async () => {
      await ready; t0 = performance.now();
      while (alive && st.t < COVER) {
        st.t = performance.now() - t0; const e = easeInOut(clamp(st.t / COVER)); st.dyTop = -mid * (1 - e); st.dyBot = (H - mid) * (1 - e);
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
      leaving = true; await counted;
      if (!alive) return;
      window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: OPEN}}));   // 翻开：页面里的进场跟着这一拍起（laolao-metre-home.js）
      const o0 = performance.now(); let d;
      while (alive && (d = performance.now() - o0) < OPEN) {
        const e = easeInOut(d / OPEN); st.t = performance.now() - t0; st.dyTop = -mid * e; st.dyBot = (H - mid) * e;
        paint(); await frame();
      }
      alive = false; overlay.remove();
    }
    function abort() { alive = false; overlay.remove(); }
    return {overlay, ready, covered, waiting() {}, finish, abort};
  }

  window.PinkieMetreTransition = Object.freeze({play});
})();
