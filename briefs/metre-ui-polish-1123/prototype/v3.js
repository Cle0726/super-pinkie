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
    const catFrames = window.LaolaoMetreCat?.STATES?.idle?.frames || [];
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
  window.PinkieMetreTransition = Object.freeze({play});

  // ================= 2. 换会话：翻到下一小节 =================
  let turning = false, bar = 1;
  window.addEventListener('pinkie:session-selected', () => {
    if (!metre() || reduced() || turning || document.querySelector('.pk-metre-transition')) return;
    const r = document.querySelector('main.content')?.getBoundingClientRect();
    if (!r || r.width < 80 || r.height < 80) return;
    void turn(r);
  });
  async function turn(r) {
    turning = true;
    const cv = document.createElement('canvas');
    try {
      const C = palette();
      const bg = getComputedStyle(root).backgroundColor || C.bg;
      const w = r.width, h = r.height, P = 4, sn = (v) => Math.round(v / P) * P;
      cv.className = 'pv3-turn'; cv.setAttribute('aria-hidden', 'true');
      Object.assign(cv.style, {position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: w + 'px', height: h + 'px', zIndex: '45', pointerEvents: 'none'});
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      document.body.append(cv);
      const before = document.querySelector('.chat-thread .chat-group');
      // ① 这一小节让出去：往左挪、淡掉（十六分音符 208ms）
      const old = document.querySelector('.pk-metre-prompt') || document.querySelector('.chat-thread');
      const out = old?.animate([{transform: 'none', opacity: 1}, {transform: 'translateX(-24px)', opacity: 0}], {duration: S16, easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'forwards'});
      await sleep(S16);
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      out?.cancel();
      const w0 = performance.now();
      while (performance.now() - w0 < 420) { const now = document.querySelector('.chat-thread .chat-group'); if (now && now !== before) break; await frame(); }
      // ② 小节线从右往左划过：线右边是新的一小节，新内容从右边进来落定
      bar += 1;
      const next = document.querySelector('.pk-metre-prompt') || document.querySelector('.chat-thread');
      next?.animate([{transform: 'translateX(32px)', opacity: 0}, {transform: 'none', opacity: 1}], {duration: Q * 0.75, easing: 'cubic-bezier(.16,1,.3,1)'});
      const SW = 520, t0 = performance.now();
      let t;
      while ((t = performance.now() - t0) < SW) {
        const x = sn(w * (1 - easeInOut(t / SW)));
        g.clearRect(0, 0, w, h);
        g.fillStyle = bg; g.fillRect(0, 0, x, h);
        g.fillStyle = C.on; g.fillRect(x, 0, 2, h);
        g.fillStyle = C.line; g.font = mono(11); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(String(bar), x + 6, 12);   // 小节号
        await frame();
      }
    } finally { cv.remove(); turning = false; }
  }

  // ================= 3. 首页画带：开演前亮灯 =================
  let lighting = false;
  new MutationObserver(() => {
    if (root.getAttribute('data-metre-enter') === 'home' && metre() && !reduced()) void lights();
  }).observe(root, {attributes: true, attributeFilter: ['data-metre-enter']});
  async function lights() {
    const src = document.querySelector('canvas.pk-metre-backdrop');
    if (lighting || !src || !src.width) return;
    lighting = true;
    const dpr = window.devicePixelRatio || 1, cellDev = Math.max(2, Math.round(2 * dpr)), cellCss = cellDev / dpr;
    const cols = Math.round(src.width / cellDev), rows = Math.round(src.height / cellDev);
    const cv = document.createElement('canvas');
    cv.className = 'pv3-lights'; cv.setAttribute('aria-hidden', 'true'); cv.width = cols; cv.height = rows;
    Object.assign(cv.style, {position: 'fixed', left: src.style.left, top: src.style.top, bottom: src.style.bottom, width: src.style.width, height: src.style.height, zIndex: '-1', pointerEvents: 'none', imageRendering: 'pixelated'});
    src.after(cv);
    const g = cv.getContext('2d', {willReadFrequently: true});
    const low = document.createElement('canvas'); low.width = cols; low.height = rows;
    const lg = low.getContext('2d', {willReadFrequently: true}); lg.imageSmoothingEnabled = false;
    const [br, bgc, bb] = (getComputedStyle(root).backgroundColor.match(/[\d.]+/g) || [247, 246, 243]).map(Number);
    const bandCss = parseFloat(getComputedStyle(root).getPropertyValue('--metre-band')) || rows * cellCss * 0.4;
    const bandRows = Math.round(bandCss / cellCss), y0 = rows - bandRows, floorY = y0 + Math.round(bandRows * 0.4);
    const cx = cols / 2, OFF = 0.12, PODIUM = Q * 1.5;
    // 地平线以上（后墙、舞台口、天幕）：从中间往两边慢慢亮。
    // 地平线以下：一盏盏灯，每盏照出一圈光（中间最亮、往外三档变淡，像素的台阶不糊），8 盏按三十二分音符依次亮；
    // 正中间指挥台那一盏最后亮、最大；它一亮，整个舞台的灯全开。
    const floorH = rows - floorY, fy = floorY + floorH * 0.55;
    // 指挥台在哪：地板那一截里「和底色差得最多」的一段（指挥台是整块实心的，比谱台、椅子都重）；找不到就当在正中
    let podX = cx;
    {
      lg.clearRect(0, 0, cols, rows); lg.drawImage(src, 0, 0, cols * cellDev, rows * cellDev, 0, 0, cols, rows);
      const d0 = lg.getImageData(0, 0, cols, rows).data, Lb = (0.2126 * br + 0.7152 * bgc + 0.0722 * bb) / 255;
      const colSum = new Float32Array(cols);
      for (let y = floorY; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4; if (!d0[i + 3]) continue;
        colSum[x] += Math.abs((0.2126 * d0[i] + 0.7152 * d0[i + 1] + 0.0722 * d0[i + 2]) / 255 - Lb);
      }
      const win = Math.max(4, Math.round(cols * 0.06)); let best = -1, acc = 0;
      for (let x = 0; x < cols; x++) { acc += colSum[x] - (x >= win ? colSum[x - win] : 0); if (x >= win - 1 && acc > best) { best = acc; podX = x - win / 2; } }
    }
    const lamps = Array.from({length: 8}, (_, k) => ({x: ((k + 0.5) / 8) * cols, y: fy, rx: (cols / 8) * 0.9, ry: floorH * 0.9, at: E8 + k * S32}))
      .filter((l) => Math.abs(l.x - podX) > cols * 0.08);
    lamps.push({x: podX, y: fy, rx: cols * 0.1, ry: floorH * 1.05, at: PODIUM});
    const N = cols * rows, zone = new Uint8Array(N), wallAt = new Float32Array(N);
    const near = new Uint8Array(N), dist = new Float32Array(N);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const p = y * cols + x;
      if (y < floorY) { wallAt[p] = (Math.abs(x - cx) / cx) * 260; continue; }
      zone[p] = 1;
      let best = 9, bi = 0;
      lamps.forEach((l, i) => { const d = Math.hypot((x - l.x) / l.rx, (y - l.y) / l.ry); if (d < best) { best = d; bi = i; } });
      near[p] = bi; dist[p] = best;
    }
    const soft = (d) => (d < 0 ? OFF : d < 70 ? 0.4 : d < 140 ? 0.75 : 1);
    const pop = (d) => (d < 0 ? 0 : d < 50 ? 0.6 : d < 130 ? 1.25 : 1);            // 灯一亮先冲一下再稳住
    const pool = (d) => (d < 0.45 ? 1 : d < 0.75 ? 0.62 : d < 1 ? 0.34 : 0);        // 一圈光的三档
    const mix = (c, b, f) => Math.max(0, Math.min(255, b + (c - b) * f));
    src.style.opacity = '0';
    const t0 = performance.now(), END = PODIUM + 380;
    try {
      let t;
      while ((t = performance.now() - t0) < END && metre()) {
        lg.clearRect(0, 0, cols, rows);
        lg.drawImage(src, 0, 0, cols * cellDev, rows * cellDev, 0, 0, cols, rows);
        const img = lg.getImageData(0, 0, cols, rows), d = img.data;
        for (let p = 0, i = 0; p < cols * rows; p++, i += 4) {
          if (!d[i + 3]) continue;
          let f;
          if (!zone[p]) f = soft(t - wallAt[p]);
          else {
            const all = clamp((t - PODIUM - 60) / 240);                            // 指挥台亮了以后，整台灯全开
            const l = lamps[near[p]];
            f = Math.max(OFF + (1 - OFF) * all, OFF + (1 - OFF) * pool(dist[p]) * pop(t - l.at));
          }
          if (f === 1) continue;
          d[i] = mix(d[i], br, f); d[i + 1] = mix(d[i + 1], bgc, f); d[i + 2] = mix(d[i + 2], bb, f);
        }
        g.putImageData(img, 0, 0);
        await frame();
      }
    } finally { src.style.opacity = ''; cv.remove(); lighting = false; }
  }

  // ================= 4. 引导语：先停在不同音高，再按拍子落回原位 =================
  let watched = null, lineObs = null, had = false;
  const PUNCT = /[，。、！？；：,.!?…—]/;
  function melody(line) {
    if (reduced()) return;
    const chars = [...line.querySelectorAll('.pk-metre-ch')];
    if (!chars.length) return;
    const words = []; let cur = [], curKw = null;
    const flush = () => { if (cur.length) words.push(cur); cur = []; curKw = null; };
    chars.forEach((ch) => {
      const kw = ch.parentElement?.classList.contains('pk-metre-kw') ? ch.parentElement : null;
      if (kw) { if (curKw !== kw) { flush(); curKw = kw; } cur.push(ch); return; }
      if (curKw) flush();
      cur.push(ch);
      if (PUNCT.test(ch.textContent) || cur.length >= 2 + (words.length % 2)) flush();
    });
    flush();
    // 原文照常排版，先藏起来；在每个字的位置上放一份拷贝来动，落定后换回原文
    document.querySelectorAll('.pv3-fly').forEach((n) => n.remove());
    clearTimeout(line._pv3Timer);
    const layer = document.createElement('div');
    layer.className = 'pv3-fly'; layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
    line.style.visibility = 'hidden';
    const STEP = 6;                                          // 音高一级 6px（三个背景像素格）
    const step = Math.min(S32, 900 / Math.max(1, words.length));
    const fallStart = words.length * 30 + 280;
    let total = 0;
    words.forEach((w, i) => {
      const y = -(Math.round(rnd(i, 13) * 4) + 1) * STEP;
      const appear = i * 30, fall = fallStart + i * step, land = fall + 190, settle = land + 90;
      total = Math.max(total, settle);
      const Y = `translateY(${y}px)`;
      w.forEach((ch) => {
        const r = ch.getBoundingClientRect(), cs = getComputedStyle(ch);
        if (!r.width) return;
        const c = document.createElement('span');
        c.textContent = ch.textContent;
        Object.assign(c.style, {position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', lineHeight: r.height + 'px',
          font: cs.font, color: cs.color, letterSpacing: cs.letterSpacing, whiteSpace: 'pre'});
        layer.append(c);
        c.animate([
          {offset: 0, opacity: 0, transform: Y},
          {offset: appear / settle, opacity: 0, transform: Y},
          {offset: (appear + 80) / settle, opacity: 1, transform: Y},
          {offset: fall / settle, opacity: 1, transform: Y, easing: 'cubic-bezier(.55,0,1,.45)'},
          {offset: land / settle, opacity: 1, transform: 'translateY(2px)', easing: 'ease-out'},
          {offset: 1, opacity: 1, transform: 'none'},
        ], {duration: settle, fill: 'both'});
      });
    });
    line.style.setProperty('--metre-reveal', Math.round(total) + 'ms');   // 关键词下面那排点（音符）在整句落定后亮
    line._pv3Timer = setTimeout(() => { line.style.visibility = ''; layer.remove(); }, total + 30);
  }
  function hook() {
    const line = document.querySelector('.pk-metre-prompt__text');
    if (line === watched) return;
    lineObs?.disconnect(); watched = line; had = false;
    if (!line) return;
    lineObs = new MutationObserver((records) => {
      const has = line.classList.contains('is-enter') && !line.classList.contains('is-wait');
      if (has && (!had || records.some((r) => r.type === 'childList'))) melody(line);
      had = has;
    });
    lineObs.observe(line, {attributes: true, attributeFilter: ['class'], childList: true});
    if (line.classList.contains('is-enter') && !line.classList.contains('is-wait')) { had = true; melody(line); }
  }
  setInterval(hook, 400);
})();
