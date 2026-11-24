/* 预览用（不进仓库）：Metre 整页动画第三版——「总谱」语言。
 * 全部用 Metre 自己已有的东西：五线谱、小节线、音符、指挥棒、像素 M（当谱号）、谱台灯、小黑猫；节奏按 ♩=72 细分。
 *   1. 切进 Metre（预备拍）：上下两半谱纸合上 → 五线从左往右划出、M 当谱号亮起 → 指挥棒每拍落在一个音符上，拍与拍之间往上弹，
 *      小猫坐在第一线上跟拍 → 落拍时谱纸从中缝上下翻开，页面从中间露出来（总长和原来基本一样）。
 *   2. 换会话 = 翻到下一小节：旧内容往左让开、淡掉 → 一根小节线从右往左划过，新内容从右边进来落定。
 *   3. 首页画带：像素舞台不改，进场像开演前亮灯：天幕从中间往两边亮 → 谱台灯一组组跟拍亮 → 最后指挥台亮。
 *   4. 引导语：每个词先停在高低不同的位置（像音高），再按拍子一个个落回原位。
 * sessionStorage pv-ver=1 时什么都不做（= 旧版）。减少动态效果时都不做。 */
(() => {
  'use strict';
  let ver = '3';
  try { ver = sessionStorage.getItem('pv-ver') || '3'; } catch {}
  if (ver === '1') return;
  const root = document.documentElement;
  root.setAttribute('data-pv3', '');
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dark = () => root.getAttribute('data-theme') === 'dark' || root.hasAttribute('data-pinkie-night');
  const metre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const frame = () => new Promise((r) => (document.hidden ? setTimeout(r, 32) : requestAnimationFrame(r)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const rnd = (i, s = 1) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  const Q = 60000 / 72;            // ♩=72：一拍 833ms
  const E8 = Q / 2, S16 = Q / 4, S32 = Q / 8;   // 417 / 208 / 104
  const mono = (px) => `600 ${px}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  const palette = () => (dark()
    ? {bg: '#151514', line: '#5E5B54', on: '#ECEAE4', dim: '#34332F', accent: '#93A5EE'}
    : {bg: '#F7F6F3', line: '#9C988F', on: '#1B1A18', dim: '#DDDAD3', accent: '#2F4BB0'});

  // ================= 1. 切进 Metre：预备拍 =================
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
  const HEAD = ['.##.', '####', '.##.'];
  const COVER = 380, OPEN = 420, B = 250, FIRST = 450, HOLD = 1250;
  function play() {
    if (reduced()) return null;
    const overlay = document.createElement('section');
    overlay.className = 'pk-metre-transition';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', '正在切换到 Metre');
    const cv = document.createElement('canvas');
    const g = cv.getContext?.('2d');
    if (!g) return null;
    overlay.append(cv);
    Object.assign(overlay.style, {position: 'fixed', inset: '0', zIndex: '2147483000', pointerEvents: 'auto', background: 'transparent'});
    Object.assign(cv.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block'});
    document.body.append(overlay);
    const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = palette();
    const P = Math.max(4, Math.round(Math.min(W, H) / 140));      // 像素格（860 高时 6px）
    const sn = (v) => Math.round(v / P) * P;
    const GAP = 3 * P, TH = Math.max(1, Math.round(P / 2));       // 谱线间距、线粗
    const mid = sn(H / 2);                                       // 第三线 = 谱纸的中缝
    const lineY = [-2, -1, 0, 1, 2].map((k) => mid + k * GAP);
    const sx0 = sn(W * 0.16), sx1 = sn(W * 0.84);
    const LS = Math.max(2, Math.round((4 * GAP + 2 * P) / 11));  // 谱号 M 的一格
    const lx = sx0 + 2 * P, ly = Math.round(mid - (11 * LS) / 2);
    const clefEnd = lx + 13 * LS + 3 * P;
    const barX = sn(clefEnd + (sx1 - clefEnd) * 0.7);
    const notesX = [0, 1, 2, 3].map((k) => sn(clefEnd + ((barX - clefEnd) * (k + 0.5)) / 4));
    const PITCH = [1, 3, 5, 7];                                  // 一拍一个音，往上走
    const noteY = PITCH.map((p) => sn(lineY[4] - (p * GAP) / 2));
    const ictus = [0, 1, 2, 3].map((k) => FIRST + k * B);
    const catFrames = [];   // 对比图：第 1 版去掉小猫
    const CP = Math.max(2, Math.round(P * 0.75));
    const catRows = catFrames[0]?.length || 0;
    const catX = barX + 4 * P, catY = lineY[0] - catRows * CP;  // 脚踩在第一线上
    const trail = [];
    const st = {t: 0, dyTop: -mid, dyBot: H - mid, open: 0};
    const box = (x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x, y, w, h); };

    // 指挥棒：预备从左上落下，每拍落在一个音符上（拍点），两拍之间往上弹；数完以后停在小节线右上方
    const pts = [{x: clefEnd - P, y: lineY[0] - 5 * GAP, t: COVER}, ...ictus.map((ti, k) => ({x: notesX[k], y: noteY[k] - 2 * P, t: ti})), {x: barX + 2 * P, y: lineY[0] - 4 * GAP, t: ictus[3] + B}];
    function batonAt(t) {
      if (t < pts[0].t) return null;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (t > b.t) continue;
        const u = (t - a.t) / (b.t - a.t);
        const x = a.x + (b.x - a.x) * easeInOut(u);
        const y = i === 0 ? a.y + (b.y - a.y) * u * u : a.y + (b.y - a.y) * u - Math.sin(Math.PI * u) * 3 * GAP;
        return {x: sn(x), y: sn(y)};
      }
      const last = pts[pts.length - 1];
      return {x: last.x, y: sn(last.y + Math.sin(((t - last.t) / B) * Math.PI) * P)};
    }

    function content(t) {
      const fade = 1 - clamp(st.open / 0.35);        // 翻开时指挥棒先收
      // 五线：盖满以后从左往右一笔划出（每根晚 24ms）
      let drawn = 0;
      lineY.forEach((y, k) => {
        const p = easeOut(clamp((t - COVER - k * 24) / 260));
        if (k === 4) drawn = p;
        if (p > 0) box(sx0, y - Math.floor(TH / 2), sn((sx1 - sx0) * p), TH, C.line);
      });
      if (drawn > 0) box(sx0, lineY[0] - Math.floor(TH / 2), TH, 4 * GAP + TH, C.line);                       // 起始线
      if (drawn * (sx1 - sx0) > barX - sx0) box(barX, lineY[0] - Math.floor(TH / 2), TH, 4 * GAP + TH, C.line); // 小节线
      if (drawn >= 1) { box(sx1 - 3 * P, lineY[0], TH, 4 * GAP, C.line); box(sx1 - P, lineY[0], P, 4 * GAP + TH, C.line); } // 终止线
      // 谱号 = 像素 M：一列一列亮；中间的 V 常暗
      const lit = clamp(Math.ceil(((t - 260) / 240) * 13), 0, 13);
      if (t > 260) for (let gy = 0; gy < 11; gy++) for (let gx = 0; gx < 13; gx++) {
        const c = LOGO[gy][gx];
        if (c === '.' || c === '@') continue;
        const inner = gx >= 5 && gx <= 7 && gy >= 3 && gy <= 9;
        box(lx + gx * LS, ly + gy * LS, LS, LS, !inner && gx < lit ? C.on : C.dim);
      }
      if (lit >= 13) {   // 摆：每个拍点摆到一头
        const a = t < FIRST ? 0 : 0.36 * Math.cos((Math.PI * (t - FIRST)) / B);
        const px = lx + 6.5 * LS, py = ly + 10 * LS, L = 8 * LS, q = Math.max(2, Math.round(LS * 0.5));
        for (let i = 0; i <= 16; i++) { const f = i / 16; box(Math.round((px + Math.sin(a) * L * f) / q) * q - q / 2, Math.round((py - Math.cos(a) * L * f) / q) * q - q / 2, q, q, C.on); }
        box(Math.round(px + Math.sin(a) * L - LS), Math.round(py - Math.cos(a) * L - LS), 2 * LS, 2 * LS, C.accent);
      }
      g.font = mono(Math.max(10, Math.round(P * 2.4))); g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillStyle = t > 700 ? C.on : C.dim; g.fillText('METRE', lx + (13 * LS) / 2, lineY[4] + 4 * P);
      // 音符：拍点那一刻落到谱上（先高两格、再一格、再落定）；刚落的那个是钴蓝
      ictus.forEach((ti, k) => {
        if (t < ti) return;
        const d = t - ti, drop = d < 50 ? -2 * P : d < 90 ? -P : 0;
        const color = d < B ? C.accent : C.on;
        const hx = notesX[k] - 2 * P, hy = sn(noteY[k] - 1.5 * P) + drop;
        HEAD.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === '#') box(hx + rx * P, hy + ry * P, P, P, color); }));
        if (PITCH[k] < 4) box(hx + 3 * P + P - TH, hy - 6 * P, TH, 7 * P, color);
        else box(hx, hy + P, TH, 7 * P, color);
      });
      // 小猫：坐在小节线后面的第一线上，每拍换一帧
      if (catRows && t > 640) {
        const rows = Math.ceil(clamp((t - 640) / 150) * catRows);
        const fr = catFrames[(t < FIRST ? 0 : Math.floor((t - FIRST) / B)) % catFrames.length];
        fr.forEach((row, y) => { if (y < catRows - rows) return; [...row].forEach((c, x) => {
          const color = c === 'K' ? C.on : c === 'E' || c === 'H' ? C.accent : c === 'S' ? C.dim : '';
          if (color) box(catX + x * CP, catY + y * CP, CP, CP, color);
        }); });
      }
      // 指挥棒的轨迹（最近 260ms）和棒尖
      if (fade > 0) {
        g.globalAlpha = fade;
        for (const p of trail) { const age = t - p.t; g.globalAlpha = fade * clamp(1 - age / 260) * 0.8; box(p.x, p.y, P, P, C.accent); }
        const tip = trail[trail.length - 1];
        if (tip) { g.globalAlpha = fade; box(tip.x - P / 2, tip.y - P / 2, 2 * P, 2 * P, C.accent); }
        g.globalAlpha = 1;
      }
    }
    function paint() {
      const t = st.t;
      const tip = batonAt(t);
      if (tip) { const last = trail[trail.length - 1]; if (!last || last.x !== tip.x || last.y !== tip.y) trail.push({...tip, t}); }
      while (trail.length && t - trail[0].t > 260) trail.shift();
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
    const counted = (async () => {
      try { await covered; } catch { return; }
      while (alive) { st.t = performance.now() - t0; if (leaving && st.t >= HOLD) return; paint(); await frame(); }
    })();
    async function finish() {
      leaving = true;
      await counted;
      if (!alive) return;
      window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: OPEN}}));   // 落拍：页面进场跟着这一拍起
      const o0 = performance.now();
      let d;
      while (alive && (d = performance.now() - o0) < OPEN) {
        const e = easeInOut(d / OPEN);
        st.open = d / OPEN; st.t = performance.now() - t0;
        st.dyTop = -mid * e; st.dyBot = (H - mid) * e;
        paint(); await frame();
      }
      alive = false; overlay.remove();
    }
    function abort() { alive = false; overlay.remove(); }
    return {overlay, ready, covered, waiting() {}, finish, abort};
  }
  window.PinkieMetreTransitionV1 = Object.freeze({play});

})();
