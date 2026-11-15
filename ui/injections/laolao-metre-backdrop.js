/* laolao-metre-backdrop —— Metre 对话页 / 首页的像素场景（11-15 第八稿「谱之路」）。
 *
 * 用户拿参考视频截图对比：「从像素点的密度就知道」差距——参考是实心、有明暗的像素画（约 4px 一格、抖动渐变、实心剪影），
 * 不是稀疏的点阵线条。第七稿照着画了月亮、山、草、星星，用户：「干嘛抄别人的，自己设计不行吗」。
 * 这一稿只学密度和手法，画面是 Metre 自己的：
 *   一条「谱之路」——五线谱像一条路一样铺在地上，从眼前一直透视到地平线；
 *   地平线上的消失点立着 Metre 的标志（像素 M 节拍器）当纪念碑，背后一片抖动的光，摆杆每半拍跳一格（左-中-右-中），摆锤钴蓝；
 *   音符沿着谱线一拍一拍朝你走过来，越近越大；离眼前不远有一根钴蓝的「此刻线」（指挥线），音符走过它的那一下亮成钴蓝；
 *   小节线一格一格往前推。天空只有渐变和光，没有月亮、山、草、星星。
 *   深色是夜里的蓝紫；浅色是谱纸色，光是暖的。
 * 画法：每 4 个 CSS 像素一格，整张图先画进一块低分辨率的 ImageData（静的部分算一次，会动的每步叠上去），
 *   最近邻放大贴到画布上，每格之间压一条 1px 的暗缝，像 LED 屏。渐变用 4×4 Bayer 抖动，不出色带。
 * 首页：看板三块的图画在路面上（.pk-metre-quick__art 的位置），鼠标移上去那一块变亮；
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
      skyTop: '#0E0F16', skyLow: '#242244', glow: '#3E3C70', glowHot: '#5B5A98',
      groundFar: '#1A1A2A', groundNear: '#0C0C13', line: '#3A3B62', lineNear: '#4D4F80', bar: '#26273F',
      note: '#A3A7CC', noteFar: '#4B4D73', now: '#3D4A86', accent: '#93A5EE',
      mono: '#06060A', monoRim: '#6A6CA6', ghost: '#1C1C2E',
      panel: '#151514', art: '#8A87A6', artPast: '#2E2E45', artInk: '#D7D5E6', artLine: '#202033',
    },
    light: {
      skyTop: '#F7F6F3', skyLow: '#EFE6D6', glow: '#F1DFBF', glowHot: '#EBCF9E',
      groundFar: '#E8E1D3', groundNear: '#DDD4C3', line: '#C3BAA8', lineNear: '#ABA290', bar: '#D5CDBD',
      note: '#6E6A62', noteFar: '#BDB5A5', now: '#A9B6E2', accent: '#2F4BB0',
      mono: '#262420', monoRim: '#F7F1E4', ghost: '#D8CDB8',
      panel: '#F7F6F3', art: '#6E6A62', artPast: '#C7BFB0', artInk: '#2B2925', artLine: '#D7CFC0',
    },
  };
  // 像素 M（和 laolao-metre-brand.js 的 LOGO 同一张图；@ = 摆锤）
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

  // 静的部分：天空和光、地面、五线谱路、纪念碑（不含摆杆）。算一次存进 base（Uint32，一格一个颜色）
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

    // 消失点：偏右，正好在输入框那一栏的右边，纪念碑不被正文和输入框挡住
    const input = document.querySelector('.agent-chat__input')?.getBoundingClientRect();
    const rightEdge = input && input.width ? (input.right - rect.left) / PX : cols * 0.7;
    const vx = Math.round(Math.min(cols - 14, Math.max(cols * 0.72, rightEdge + (cols - rightEdge) / 2)));
    const vy = Math.round(rows * (home ? 0.6 : 0.56));
    const M = Math.max(2, Math.min(3, Math.round(rows / 70)));            // 纪念碑：一个标志格 = M×M 格
    const mono = {x: vx - Math.round(6.5 * M), y: vy - 11 * M, M};
    const glow = {x: vx, y: vy - Math.round(5.5 * M), r: Math.round(M * 16)};

    // 天空：渐变 + 纪念碑背后的光（抖动成一圈一圈往外淡）
    for (let y = 0; y < vy; y++) {
      const t = Math.pow(y / vy, 1.35);
      for (let x = 0; x < cols; x++) {
        const v = t * 6, lo = Math.floor(v);
        let c = mix(C.skyTop, C.skyLow, Math.min(1, (lo + (v - lo > bayer(x, y) ? 1 : 0)) / 6));
        const d = Math.hypot(x - glow.x, (y - glow.y) * 1.6) / glow.r;
        if (d < 1) {
          const g = 1 - d;
          if (g * 1.3 > bayer(x + 2, y + 1)) c = mix(c, C.glow, 0.55 + g * 0.35);
          if (g > 0.55 && (g - 0.55) * 2.6 > bayer(x, y + 3)) c = mix(c, C.glowHot, 0.7);
        }
        base[y * cols + x] = pack(c);
      }
    }
    // 地面的颜色（抖动渐变 + 纪念碑的光在地上拖出的倒影，往下、往两边淡出）
    function groundAt(x, y) {
      const t = (y - vy) / Math.max(1, rows - vy);
      const v = t * 5, lo = Math.floor(v);
      let c = mix(C.groundFar, C.groundNear, Math.min(1, (lo + (v - lo > bayer(x, y) ? 1 : 0)) / 5));
      const rd = Math.hypot((x - vx) / (glow.r * 1.1), (y - vy) / (glow.r * 0.45));
      if (rd < 1 && (1 - rd) * 1.1 > bayer(x + 1, y)) c = mix(c, C.glow, 0.35 * (1 - rd) + 0.15);
      return pack(c);
    }
    // 地面：靠近地平线淡、越近越深；五线谱的五根线从消失点铺开，靠近眼前的那一段更亮
    const spread = cols * 0.13;                 // 到底边时相邻两根线隔多少格
    const swingTo = cols * 0.5 - vx;            // 路朝眼前弯向画面中间偏左，不只占右下角
    const lineX = (i, y) => { const t = (y - vy) / (rows - vy); return vx + ((i - 2) * spread + swingTo * 1.2) * t; };
    for (let y = vy; y < rows; y++) {
      const t = (y - vy) / Math.max(1, rows - vy);
      for (let x = 0; x < cols; x++) base[y * cols + x] = groundAt(x, y);
      for (let i = 0; i < 5; i++) {
        const x = lineX(i, y), x0 = Math.round(x), width = t > 0.55 ? 2 : 1;
        const c = t > 0.4 ? P.lineNear : P.line;
        for (let k = 0; k < width; k++) set(x0 + k, y, c);
      }
    }
    for (let x = 0; x < cols; x++) set(x, vy, pack(mix(C.skyLow, C.glow, Math.max(0, 1 - Math.abs(x - vx) / (glow.r * 1.4)))));
    // 纪念碑：像素 M 的剪影，顶边一圈亮边（朝光那一侧）；中间的 V 是摆过的残影；摆杆和摆锤每步再画
    const at = (gx, gy) => (LOGO[gy] && LOGO[gy][gx]) || '.';
    for (let gy = 0; gy < 11; gy++) for (let gx = 0; gx < 13; gx++) {
      const ch = at(gx, gy);
      if (ch === '.' || ch === '@') continue;
      const inner = gx >= 5 && gx <= 7 && gy >= 3 && gy <= 9;
      for (let sy = 0; sy < M; sy++) for (let sx = 0; sx < M; sx++) {
        const edgeTop = sy === 0 && (at(gx, gy - 1) === '.' || at(gx, gy - 1) === '@');
        const c = inner ? P.ghost : edgeTop ? P.monoRim : P.mono;
        set(mono.x + gx * M + sx, mono.y + gy * M + sy, c);
      }
    }
    // 首页看板的三块图：画在路面上（.pk-metre-quick__art 的位置），对齐到格子
    const arts = home ? [...document.querySelectorAll('.pk-metre-quick__art')].map((node, index) => {
      const r = node.getBoundingClientRect();
      if (r.width < PX * 16 || r.height < PX * 8) return null;
      const x0 = Math.ceil((r.left - rect.left) / PX), y0 = Math.ceil((r.top - rect.top) / PX);
      return {index, kind: ['sessions', 'memory', 'runtime'][index] || 'memory', x0, y0, w: Math.floor((r.right - rect.left) / PX) - x0, h: Math.floor((r.bottom - rect.top) / PX) - y0};
    }).filter(Boolean) : [];
    // 看板整张卡片（图和两行字）、输入框那一块下面只留地面，不画谱线，字读得清楚；不画框
    const quiet = [];
    // 也让开输入框和它下面那一排（Baton / 模型），那一排没有底色
    const quietNodes = [...document.querySelectorAll('.agent-chat__composer-shell')].filter((n) => n.getClientRects().length);
    if (home) quietNodes.push(...document.querySelectorAll('.pk-metre-quick__card'));
    for (const node of quietNodes) {
      const r = node.getBoundingClientRect();
      const x0 = Math.floor((r.left - rect.left) / PX) - 2, x1 = Math.ceil((r.right - rect.left) / PX) + 2;
      const y0 = Math.floor((r.top - rect.top) / PX) - 2, y1 = Math.ceil((r.bottom - rect.top) / PX) + 2;
      quiet.push([x0, y0, x1, y1]);
      for (let y = Math.max(vy + 1, y0); y < Math.min(rows, y1); y++) for (let x = Math.max(0, x0); x < Math.min(cols, x1); x++) set(x, y, groundAt(x, y));
    }
    const low = document.createElement('canvas');
    low.width = cols; low.height = rows;
    // 此刻线：离眼前不远的那一行（首页让到看板上面）
    const nowY = Math.round(home ? vy + (rows - vy) * 0.38 : vy + (rows - vy) * 0.62);
    grid = {cols, rows, ratio, base, low, lowCtx: low.getContext('2d'), C, P, vx, vy, spread, lineX, mono, nowY, arts, quiet};
    lastKey = '';
  }

  // ---------- 会动的部分 ----------
  // 透视：地面上一行 y 对应的「远近」z = K / (y - vy)；z 越小越近
  function dynamic(buf, rawPut) {
    const {cols, rows, C, P, vx, vy, lineX, mono, nowY, quiet} = grid;
    // 路上的东西不进看板卡片那几块
    const put = (x, y, c) => { for (const q of quiet) if (x >= q[0] && x < q[2] && y >= q[1] && y < q[3]) return; rawPut(x, y, c); };
    const still = reduced();
    const K = (rows - vy) * 8;
    const zOf = (y) => K / Math.max(0.5, y - vy);
    const yOf = (z) => vy + K / z;
    const zNow = zOf(nowY);
    // 一小节 = 4 拍 = 8 步；走一步，所有东西往眼前挪 1/8 小节
    const BARZ = 24, travel = still ? 0 : step * (BARZ / 8);
    // 小节线：横过五根线
    for (let j = 0; j < 40; j++) {
      const z = (j + 1) * BARZ - (travel % BARZ);
      const y = Math.round(yOf(z + zNow * 0.4));
      if (y <= vy + 1 || y >= rows) continue;
      const x0 = Math.round(lineX(0, y)), x1 = Math.round(lineX(4, y));
      for (let x = x0; x <= x1; x++) if (x >= 0 && x < cols) put(x, y, P.bar);
    }
    // 此刻线：钴蓝，横过整条路；有音符正走过时亮
    let hit = false;
    // 音符：每小节四拍，每拍一个（有的拍空着），在某根线或某个间上
    const barNow = Math.floor(travel / BARZ);
    for (let b = barNow - 1; b < barNow + 26; b++) {
      for (let q = 0; q < 4; q++) {
        if (hash(b * 31 + q * 7 + 3) < 0.25) continue;
        const z = (b * BARZ + q * (BARZ / 4)) - travel + zNow;
        if (z <= zNow * 0.55) continue;
        const y = yOf(z);
        if (y <= vy + 1 || y >= rows + 6) continue;
        const pos = Math.floor(hash(b * 13 + q * 5 + 1) * 9) / 2;      // 0..4，半步 = 间
        const x = lineX(pos, y);
        const near = (y - vy) / (rows - vy);
        const size = Math.max(1, Math.round(near * 4));
        const crossing = Math.abs(z - zNow) < BARZ / 8;
        if (crossing) hit = true;
        const c = crossing ? P.accent : near < 0.25 ? P.noteFar : P.note;
        // 符头：椭圆；符干朝上
        const rx = size * 1.3, ry = size * 0.9;
        for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) put(Math.round(x + dx), Math.round(y - ry + dy), c);
        }
        if (size >= 2) for (let k = 0; k < size * 4; k++) put(Math.round(x + rx), Math.round(y - ry - k), c);
      }
    }
    {
      const x0 = Math.max(0, Math.round(lineX(0, nowY)) - 2), x1 = Math.min(cols - 1, Math.round(lineX(4, nowY)) + 2);
      for (let x = x0; x <= x1; x++) put(x, nowY, hit ? P.accent : P.now);
      if (hit) for (let x = x0; x <= x1; x += 2) { put(x, nowY - 1, P.now); put(x, nowY + 1, P.now); }
    }
    // 纪念碑的摆：支点在底座上沿正中，每半拍跳一格（左-中-右-中）
    const swing = still ? 0 : [-1, 0, 1, 0][step % 4] * 0.34;
    const M = mono.M;
    const px = mono.x + 6.5 * M, py = mono.y + 10 * M, len = 8 * M;
    for (let r = 0; r <= len; r += 0.5) {
      const x = Math.round(px + Math.sin(swing) * r - 0.5), y = Math.round(py - Math.cos(swing) * r);
      for (let k = 0; k < Math.max(1, M - 1); k++) put(x + k, y, P.mono);
    }
    const bx = Math.round(px + Math.sin(swing) * len * 0.82), by = Math.round(py - Math.cos(swing) * len * 0.82);
    const half = Math.ceil(M * 0.75);
    for (let dy = -half; dy < half; dy++) for (let dx = -half; dx < half; dx++) put(bx + dx, by + dy, P.accent);
    for (const a of grid.arts) artScene(a, rawPut);
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
