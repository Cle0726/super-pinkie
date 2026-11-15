/* laolao-metre-backdrop —— Metre 对话页 / 首页的像素场景（11-15 第十稿「月夜」）。
 *
 * 用户拿参考视频截图对比：「从像素点的密度就知道」差距——参考是实心、有明暗的像素画（约 4px 一格、抖动渐变、实心剪影、光晕），
 * 不是稀疏的点阵线条。这一稿照参考的质量和题材画（月亮、山、草、星星）；之后试过 Metre 自己的「谱之路」（用户：「好丑」）
 * 和不放场景的「安静」，用户最后定：「就之前那个」——也就是这一稿。Metre 自己的部分：
 *   山上一排电线杆，杆间五根下垂的线是一行五线谱，音符像鸟一样停在上面、每半拍往左挪一格，走到月亮前面的那一个亮成钴蓝；
 *   月亮打拍子：每拍光晕里亮起一圈，往外走，四拍一轮；正文那一栏不放星星，字周围留白（这两处是 11-15 用户说「自己调整修改一些」后加的）。
 *   近山顶上坐着 Metre 的黑猫，剪影衬在夜色里，眼睛钴蓝，每 8 拍眨一次眼；草尖随拍子晃；萤火虫是钴蓝的点。
 *   深色是夜里；浅色是谱纸色的清晨：太阳是淡的暖色圆盘，没有星星，山和草是暖灰。
 * 画法：每 4 个 CSS 像素一格，整张图先画进一块低分辨率的 ImageData（静的部分算一次，会动的每步叠上去），
 *   最近邻放大贴到画布上，格与格之间压一条很淡的暗缝（LED 屏的颗粒感）。渐变用 4×4 Bayer 抖动，不出色带。
 * 首页：看板三块的图画在山坡上（.pk-metre-quick__art 的位置），鼠标移上去那一块变亮；
 *   引导语上面速度记号的四个拍点也由这里每拍更新（data-beat）。
 * 资源（批 6「不留常驻动画」）：只在 Metre 的对话页 / 首页、窗口可见时跑；一个 setTimeout 每半拍（♩=72）走一步；
 *   标志页开着时停；减少动态效果时只画一帧。不在 Metre 时画布直接拿掉，根元素上的 data-pk-metre-backdrop 也拿掉。 */
(() => {
  'use strict';
  if (window.__pinkieMetreBackdrop) return;
  const root = document.documentElement;
  const BPM = 72;
  const STEP = 60_000 / BPM / 2;          // 半拍走一步
  const PX = 4;                           // 一格 4 个 CSS 像素
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const isHome = () => root.getAttribute('data-laolao-startup-home') === '1';
  const isDark = () => root.getAttribute('data-theme') === 'dark' || root.hasAttribute('data-pinkie-night');
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const mainEl = () => document.querySelector('main.content.content--chat');
  let canvas = null, ctx = null, grid = null, timer = 0, step = 0, observed = null, lastKey = '', hovered = -1;
  const mainClass = new MutationObserver(() => queue());
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (canvas) { layout(); draw(true); } }) : null;

  // ---------- 小工具 ----------
  function hash(n) {
    let x = (n | 0) * 374761393 + 668265263;
    x = (x ^ (x >>> 13)) * 1274126177;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }
  // 一维平滑噪声（山脊用）
  function noise(x, seed) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return hash(i * 131 + seed) * (1 - u) + hash((i + 1) * 131 + seed) * u;
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pack = (c) => (255 << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0]);   // ImageData 是小端 ABGR

  const PALETTES = {
    dark: {
      skyTop: '#0F1018', skyLow: '#3A3463', halo: '#3A3B63', moon: '#E4E1D2', moonShade: '#BDB9A8', star: '#C9CCDD', starDim: '#6E7192',
      wire: '#363759', note: '#9DA1C4', far: '#1A1A2B', farRim: '#34345A', pole: '#0E0E17', near: '#121220', nearRim: '#24243B',
      grass: '#2A3F37', grassTip: '#6E9A86', fly: '#93A5EE', accent: '#93A5EE', cat: '#060608', eye: '#93A5EE',
      panel: '#151514', art: '#5E5B54', artPast: '#33322F', artInk: '#C9C5BB', artLine: '#2A2927',
    },
    light: {
      skyTop: '#F7F6F3', skyLow: '#EEE7DA', halo: '#F2E9D6', moon: '#F4DFB8', moonShade: '#ECD2A3', star: '#F7F6F3', starDim: '#F7F6F3',
      wire: '#CDC6B7', note: '#8F8A80', far: '#E6E0D3', farRim: '#F0EBE0', pole: '#BDB5A5', near: '#D7D0C1', nearRim: '#E1DBCE',
      grass: '#C9CBB8', grassTip: '#A9B39B', fly: '#2F4BB0', accent: '#2F4BB0', cat: '#1B1A18', eye: '#2F4BB0',
      panel: '#F7F6F3', art: '#6E6A62', artPast: '#BEB7A9', artInk: '#2B2925', artLine: '#CFC8BA',
    },
  };

  // ---------- 画布 ----------
  function mount() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'pk-metre-backdrop';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    root.setAttribute('data-pk-metre-backdrop', '');
  }
  function unmount() {
    stop();
    if (observed && ro) ro.unobserve(observed);
    observed = null;
    mainClass.disconnect();
    canvas?.remove();
    canvas = null; ctx = null; grid = null; lastKey = '';
    root.removeAttribute('data-pk-metre-backdrop');
  }

  // 静的部分：天空、月亮和光晕、远山、电线杆和五线谱电线、近山、草根、猫。算一次存进 base（Uint32，一格一个颜色）
  function layout() {
    const main = mainEl();
    if (!canvas || !main) return;
    const rect = main.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width)), hgt = Math.max(1, Math.round(window.innerHeight - rect.top));
    Object.assign(canvas.style, {left: Math.round(rect.left) + 'px', top: Math.round(rect.top) + 'px', width: w + 'px', height: hgt + 'px'});
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(hgt * ratio);
    ctx = canvas.getContext('2d');
    const cols = Math.ceil(w / PX), rows = Math.ceil(hgt / PX);
    const pal = isDark() ? PALETTES.dark : PALETTES.light;
    const C = Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, rgb(v)]));
    const P = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, pack(v)]));
    const home = isHome();
    const base = new Uint32Array(cols * rows);
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < cols && y < rows) base[y * cols + x] = c; };

    // 月亮：右上；首页放低一点、靠右，让开引导语
    const moon = {x: Math.round(cols * (home ? 0.86 : 0.8)), y: Math.round(rows * (home ? 0.2 : 0.17)), r: Math.max(9, Math.round(Math.min(cols, rows) * 0.07))};
    // 山脊：远山在 70% 高附近起伏，近山在 83% 附近；一格一格的台阶
    const farY = (x) => Math.round(rows * 0.7 - noise(Math.floor(x / 3) * 0.09, 7) * rows * 0.13 - noise(x * 0.02, 3) * rows * 0.05);
    const nearY = (x) => Math.round(rows * 0.83 - noise(Math.floor(x / 2) * 0.07, 19) * rows * 0.1);
    // 猫坐在近山的一个高处（月亮那一侧）
    let catX = Math.round(cols * 0.68), catTop = rows;
    for (let x = Math.round(cols * 0.58); x < Math.round(cols * 0.8); x++) if (nearY(x) < catTop) { catTop = nearY(x); catX = x; }
    const horizon = rows * 0.72;

    for (let y = 0; y < rows; y++) {
      const t = Math.min(1, Math.pow(y / horizon, 1.25));
      for (let x = 0; x < cols; x++) {
        // 天空：从上到地平线渐变，Bayer 抖动在相邻两档之间取
        const levels = 6, v = t * levels, lo = Math.floor(v), frac = v - lo;
        let c = mix(C.skyTop, C.skyLow, Math.min(1, (lo + (frac > bayer(x, y) ? 1 : 0)) / levels));
        // 月亮的光晕：内圈实、外圈抖动着淡出
        const d = Math.hypot(x - moon.x, (y - moon.y) * 1.05);
        if (d > moon.r && d < moon.r * 3) {
          const g = 1 - (d - moon.r) / (moon.r * 2);
          if (d < moon.r * 1.35) c = mix(c, C.halo, 0.85);
          else if (g * g * 1.1 > bayer(x, y)) c = mix(c, C.halo, 0.5 + g * 0.3);
        }
        base[y * cols + x] = pack(c);
      }
    }
    // 月亮本体：左下一道暗边，三个坑（浅色是太阳，没有坑）
    for (let y = moon.y - moon.r; y <= moon.y + moon.r; y++) for (let x = moon.x - moon.r; x <= moon.x + moon.r; x++) {
      const dx = x - moon.x, dy = y - moon.y;
      if (dx * dx + dy * dy > moon.r * moon.r) continue;
      const rim = Math.hypot(dx + moon.r * 0.18, dy - moon.r * 0.18) / moon.r;
      let c = rim > 1.02 ? C.moonShade : rim > 0.94 && bayer(x, y) > 0.5 ? C.moonShade : C.moon;
      if (isDark()) for (const [cx, cy, cr] of [[-0.3, -0.15, 0.24], [0.32, 0.28, 0.17], [0.05, 0.5, 0.11]]) {
        if (Math.hypot(dx - cx * moon.r, dy - cy * moon.r) < cr * moon.r) c = mix(C.moon, C.moonShade, 0.8);
      }
      set(x, y, pack(c));
    }
    // 远山：实心，顶上一行亮边
    for (let x = 0; x < cols; x++) {
      const fy = farY(x);
      for (let y = fy; y < rows; y++) set(x, y, y === fy ? P.farRim : P.far);
    }
    // 五线谱电线：远山上一排电线杆，杆和杆之间挂五根下垂的线（线距 2 格），音符像鸟一样停在上面
    const poleGap = Math.max(60, Math.round(cols / 3.2));
    const poleTop = (x) => farY(x) - Math.round(rows * 0.1);
    const poles = [];
    for (let x = Math.round(poleGap * 0.35); x < cols + poleGap; x += poleGap) poles.push(x);
    const wireTopAt = (x) => {
      const i = Math.max(0, Math.min(poles.length - 2, Math.floor((x - poles[0]) / poleGap)));
      const a = poles[i], b = poles[i + 1], f = (x - a) / (b - a);
      const ya = poleTop(a) + 1, yb = poleTop(Math.min(cols - 1, b)) + 1;
      return Math.round(ya + (yb - ya) * f + Math.sin(Math.PI * Math.max(0, Math.min(1, f))) * rows * 0.03);
    };
    const wireY = (i, x) => wireTopAt(x) + i * 2;
    for (let x = 0; x < cols; x++) for (let i = 0; i < 5; i++) {
      const y = wireY(i, x);
      if (y < farY(x)) set(x, y, P.wire);
    }
    for (const px of poles) {
      if (px >= cols) continue;
      const top = poleTop(px);
      for (let y = top - 1; y < farY(px); y++) set(px, y, P.pole);
      for (let x = px - 2; x <= px + 2; x++) { set(x, top, P.pole); set(x, top + 4, P.pole); }
    }
    // 近山：实心，顶上一行亮边，越往下越深（抖动）
    for (let x = 0; x < cols; x++) {
      const ny = nearY(x);
      for (let y = ny; y < rows; y++) {
        const deep = (y - ny) / Math.max(1, rows - ny);
        set(x, y, y === ny ? P.nearRim : pack(deep * 0.6 > bayer(x, y) ? mix(C.near, C.skyTop, 0.35) : C.near));
      }
    }
    // 草根：近山顶上一排草（会动的草尖每步再叠）
    const blades = [];
    for (let x = 0; x < cols; x++) {
      if (hash(x * 7 + 1) < 0.42) continue;
      const hgtB = 2 + Math.floor(hash(x * 13 + 5) * (hash(Math.floor(x / 7)) < 0.4 ? 8 : 4));
      blades.push({x, y: nearY(x), h: hgtB});
      for (let k = 1; k < hgtB; k++) set(x, nearY(x) - k, P.grass);
    }
    // 猫：坐姿，一个像素一格，剪影；眼睛钴蓝
    const SIT = window.LaolaoMetreCat?.STATES?.idle?.frames?.[0];
    const cat = SIT ? {x: catX - 6, y: catTop - 15} : null;
    if (cat) SIT.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'K') set(cat.x + x, cat.y + y, P.cat);
      else if (ch === 'E' || ch === 'H') set(cat.x + x, cat.y + y, P.eye);
    }));
    // 星星（深色才有）：位置固定，亮度不一，只放在山以上、月亮以外
    // 正文那一栏（引导语、对话、输入框那一竖条）不放星星，字周围留白
    const colNode = document.querySelector('.agent-chat__input');
    const cr = colNode?.getBoundingClientRect();
    const textCol = cr && cr.width ? [Math.floor((cr.left - rect.left) / PX) - 6, Math.ceil((cr.right - rect.left) / PX) + 6] : [-1, -1];
    const stars = [];
    if (isDark()) for (let i = 0; i < Math.round(cols * rows / 380); i++) {
      const x = Math.floor(hash(i * 3 + 11) * cols), y = Math.floor(hash(i * 5 + 17) * rows * 0.62);
      if (Math.hypot(x - moon.x, y - moon.y) < moon.r * 2.4) continue;
      if (x >= textCol[0] && x <= textCol[1]) continue;
      stars.push({x, y, big: hash(i * 7 + 23) < 0.08, twinkle: hash(i * 11 + 29) < 0.35, seed: i});
    }
    // 首页看板的三块图：画在山坡上，对齐到格子，不画框
    const arts = home ? [...document.querySelectorAll('.pk-metre-quick__art')].map((node, index) => {
      const r = node.getBoundingClientRect();
      if (r.width < PX * 16 || r.height < PX * 8) return null;
      const x0 = Math.ceil((r.left - rect.left) / PX), y0 = Math.ceil((r.top - rect.top) / PX);
      return {index, kind: ['sessions', 'memory', 'runtime'][index] || 'memory', x0, y0, w: Math.floor((r.right - rect.left) / PX) - x0, h: Math.floor((r.bottom - rect.top) / PX) - y0};
    }).filter(Boolean) : [];
    const low = document.createElement('canvas');
    low.width = cols; low.height = rows;
    grid = {cols, rows, ratio, base, low, lowCtx: low.getContext('2d'), C, P, moon, stars, blades, wireY, farY, arts, cat, SIT};
    lastKey = '';
  }

  // ---------- 会动的部分 ----------
  const NOTE = ['.##', '.#.', '.#.', '##.', '##.'];   // 四分音符：符头在下，符干朝上（3×5）
  function dynamic(buf, put) {
    const {cols, rows, C, P, moon, stars, blades, wireY, farY} = grid;
    const still = reduced();
    // 星星闪：一部分星星按自己的节奏亮灭；大星星是十字
    for (const s of stars) {
      const on = !s.twinkle || still || hash(s.seed * 97 + Math.floor((step + s.seed) / 3)) > 0.35;
      const c = on ? (s.big ? P.star : pack(mix(C.starDim, C.star, hash(s.seed) * 0.6))) : P.starDim;
      put(s.x, s.y, c);
      if (s.big && on) { put(s.x - 1, s.y, P.starDim); put(s.x + 1, s.y, P.starDim); put(s.x, s.y - 1, P.starDim); put(s.x, s.y + 1, P.starDim); }
    }
    // 音符停在电线上，每半拍往左一格；走到月亮前面的那一个是钴蓝
    const gap = 17, travel = still ? 0 : step;
    for (let k = -1; k < cols / gap + 2; k++) {
      const id = k + Math.floor(travel / gap);
      const x = k * gap - (travel % gap) + Math.floor(hash(id * 7) * 10);
      const line = Math.floor(hash(id * 13 + 3) * 5);
      const yLine = wireY(line, Math.max(0, Math.min(cols - 1, x + 1)));
      if (yLine >= farY(Math.max(0, Math.min(cols - 1, x))) - 1 || yLine < 4) continue;
      const lit = Math.abs(x + 1 - moon.x) <= moon.r * 0.6;
      const c = lit ? P.accent : P.note;
      NOTE.forEach((row, y) => [...row].forEach((ch, dx) => { if (ch === '#') put(x + dx, yLine - 3 + y, c); }));
    }
    // 月亮打拍子：每拍光晕里亮起一圈，一拍一拍往外走，四拍一轮（Metre 自己的东西）
    if (!still) {
      const k = Math.floor(step / 2) % 4;
      const r = moon.r * (1.25 + k * 0.45);
      const ring = pack(mix(C.halo, C.moon, isDark() ? 0.28 - k * 0.05 : 0.5 - k * 0.08));
      const n = Math.ceil(r * 6.3);
      for (let i = 0; i < n; i += 2) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.round(moon.x + Math.cos(a) * r), y = Math.round(moon.y + Math.sin(a) * r / 1.05);
        if (y < farY(Math.max(0, Math.min(cols - 1, x)))) put(x, y, ring);
      }
    }
    // 草尖：每拍左右晃一格
    const sway = still ? 0 : (Math.floor(step / 2) % 2 ? 1 : -1);
    for (const b of blades) {
      if (b.h < 2) continue;
      const lean = hash(b.x * 3) < 0.5 ? sway : 0;
      put(b.x + lean, b.y - b.h, P.grassTip);
    }
    // 萤火虫：几颗钴蓝的点在近山上方慢慢飘
    if (isDark()) for (let i = 0; i < 9; i++) {
      const t = (still ? 0 : step) * 0.25 + i * 40;
      const x = Math.round((hash(i * 17) * cols + t * (hash(i) < 0.5 ? 1 : -1) + cols * 4) % cols);
      const y = Math.round(rows * 0.78 + Math.sin(t * 0.6 + i) * rows * 0.04 - hash(i * 5) * rows * 0.06);
      if ((Math.floor(t) + i) % 5 !== 0) put(x, y, P.fly);
    }
    // 猫：每 8 拍眨一次眼
    if (grid.cat && !still && Math.floor(step / 2) % 8 === 7) grid.SIT.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'E' || ch === 'H') put(grid.cat.x + x, grid.cat.y + y, P.cat); }));
    for (const a of grid.arts) artScene(a, put);
  }

  // 看板的图：在一块 w×h 格的屏里，用 2×2 格当一个「点」画
  function artScene(a, put) {
    const {P} = grid;
    const hot = a.index === hovered;
    const W = Math.floor(a.w / 2), H = Math.floor(a.h / 2);
    const ink = {note: hot ? P.artInk : P.art, past: P.artPast, line: P.artLine, accent: P.accent};
    const dot = (x, y, kind) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const c = ink[kind];
      put(a.x0 + x * 2, a.y0 + y * 2, c);
      put(a.x0 + x * 2 + 1, a.y0 + y * 2, c);
      put(a.x0 + x * 2, a.y0 + y * 2 + 1, c);
      put(a.x0 + x * 2 + 1, a.y0 + y * 2 + 1, c);
    };
    const beat = reduced() ? 0 : Math.floor(step / 2);
    const mid = Math.floor(H / 2);
    if (a.kind === 'sessions') {
      const lanes = [[[0, 0.3], [0.34, 0.14]], [[0.08, 0.2], [0.32, 0.36]], [[0.14, 0.16], [0.34, 0.1], [0.46, 0.22]], [[0.62, 0.2], [0.86, 0.12]]];
      const head = 1 + beat % Math.max(4, W - 2);
      const top = Math.max(1, mid - 3);
      lanes.forEach((blocks, i) => {
        for (const [from, len] of blocks) {
          const x0 = Math.round(from * W), x1 = Math.max(x0 + 1, Math.round((from + len) * W));
          for (let x = x0; x < x1; x++) dot(x, top + i * 2, x < head ? 'note' : 'past');
        }
      });
      for (let y = top - 1; y <= top + 7; y++) dot(head, y, 'accent');
    } else if (a.kind === 'memory') {
      const top = Math.max(1, mid - 3);
      [0.82, 0.6, 0.44, 0.26].forEach((f, i) => {
        const y = top + i * 2;
        for (let x = 1; x < 4; x++) dot(x, y, 'past');
        const end = 6 + Math.round((W - 7) * f);
        for (let x = 6; x < W - 1; x++) dot(x, y, x < end ? 'note' : 'line');
        if (i === 0) dot(end - 1, y, 'accent');
      });
    } else {
      const r = Math.min(3.2, (H - 2) / 2), cx = Math.round(r) + 1.5, cy = mid + 0.5;
      for (let y = 0; y < H; y++) for (let x = 0; x < Math.ceil(r * 2) + 3; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (Math.abs(Math.hypot(dx, dy) - r) > 0.62) continue;
        const ang = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
        dot(x, y, ang < Math.PI * 2 * 0.38 ? 'accent' : 'line');
      }
      const x0 = Math.ceil(r * 2) + 5;
      let prev = null;
      for (let x = x0; x < W - 1; x++) {
        const v = hash(x - x0 + beat) * 0.6 + hash((x - x0 + beat) * 3 + 11) * 0.4;
        const y = 1 + Math.round((1 - v) * (H - 3));
        if (prev != null) for (let yy = Math.min(prev, y) + 1; yy < Math.max(prev, y); yy++) dot(x, yy, 'past');
        dot(x, y, x === W - 2 ? 'accent' : 'note');
        prev = y;
      }
    }
  }

  function draw(force = false) {
    if (!ctx || !grid) return;
    const key = `${step},${grid.cols},${grid.rows},${hovered}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const tempo = document.querySelector('.pk-metre-tempo');
    if (tempo) tempo.dataset.beat = String(reduced() ? 0 : Math.floor(step / 2) % 4);
    const {cols, rows, ratio, base, low, lowCtx} = grid;
    const img = lowCtx?.createImageData?.(cols, rows);
    if (!img?.data) return;
    const buf = new Uint32Array(img.data.buffer);
    buf.set(base);
    const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < cols && y < rows) buf[y * cols + x] = c; };
    dynamic(buf, put);
    lowCtx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cell = PX * ratio;
    ctx.drawImage(low, 0, 0, cols * cell, rows * cell);
    // 每格挖一条 1px 的缝（右边和下边），像 LED 屏
    const gapPx = Math.max(1, Math.round(ratio));
    // 缝不挖空，只把那一条压暗一点（LED 屏的颗粒感），不然整片天空像一张网
    ctx.fillStyle = isDark() ? 'rgba(0, 0, 0, 0.32)' : 'rgba(60, 50, 30, 0.05)';
    for (let x = 1; x <= cols; x++) ctx.fillRect(x * cell - gapPx, 0, gapPx, canvas.height);
    for (let y = 1; y <= rows; y++) ctx.fillRect(0, y * cell - gapPx, canvas.width, gapPx);
  }
  function tick() {
    timer = 0;
    if (!running()) return;
    step++;
    draw();
    timer = setTimeout(tick, STEP);
  }
  const running = () => Boolean(canvas) && !document.hidden && !window.__pinkieMetreBrand?.isOpen && !reduced();
  function start() { if (!timer && running()) timer = setTimeout(tick, STEP); }
  function stop() { clearTimeout(timer); timer = 0; }

  // ---------- 什么时候有 ----------
  function sync() {
    const main = isMetre() ? mainEl() : null;
    if (!main) { unmount(); return; }
    mount();
    if (observed !== main) {
      if (observed && ro) ro.unobserve(observed);
      observed = main;
      ro?.observe(main);
      mainClass.disconnect();
      mainClass.observe(main, {attributes: true, attributeFilter: ['class']});
    }
    layout();
    draw(true);
    if (running()) start(); else stop();
  }
  let queued = false;
  const queue = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; sync(); }, 150); } };

  function boot() {
    new MutationObserver(queue).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-laolao-startup-home', 'data-theme', 'data-pinkie-night', 'data-pinkie-reduce-motion']});
    const shell = document.querySelector('openclaw-app') || document.body;
    // 换页（对话 ↔ 设置等）时 main 的 class 会变；只看结构变化，不看对话流里的字
    new MutationObserver((records) => {
      if (!isMetre() && !canvas) return;
      if (records.some((r) => !(r.target instanceof Element) || !r.target.closest('.chat-thread, .pk-metre-board, .pk-metre-brand'))) queue();
    }).observe(shell, {childList: true, subtree: true});
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else queue(); });
    // 首页看板：鼠标在哪张卡片上，那一块点阵就亮一档
    document.addEventListener('pointerover', (event) => {
      if (!canvas || !grid?.arts?.length) return;
      const card = event.target instanceof Element ? event.target.closest('.pk-metre-quick__card') : null;
      const index = card ? [...card.parentElement.children].indexOf(card) : -1;
      if (index !== hovered) { hovered = index; draw(true); }
    }, true);
    window.addEventListener('resize', queue);
    // 标志页开关：它开着时停，关了接着走
    document.addEventListener('keydown', () => setTimeout(() => { if (canvas) { if (running()) start(); else stop(); } }, 0), true);
    document.addEventListener('click', () => setTimeout(() => { if (canvas) { if (running()) start(); else stop(); } }, 0), true);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();

  window.__pinkieMetreBackdrop = Object.freeze({
    get mounted() { return Boolean(canvas); },
    get running() { return Boolean(timer); },
    get step() { return step; },
    sync,
  });
})();
