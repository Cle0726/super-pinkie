/* laolao-metre-transition —— 切换进 Metre 的过场（11-15，第六版）。
 *
 * 碧琪的几个模式切换用的是插画场景 + 进度条；Metre 原来什么都不放，路由原地一换。用户要「一样的像素动态风格，但有独立的视觉语言」。
 * Metre 的语言是「预备拍」（乐队开演前指挥数的 1、2、3、4）：
 *   盖上：从左下角的模式按钮那里起，一圈一圈方形的波按格子往外推，每个格子先亮成一颗点，再长成一整格，把旧页面盖住（约 0.36 秒）。
 *   数拍：盖满后屏上是一整块熄灯的点阵（♩=200，数一遍 1.2 秒）：
 *         像素 M 的框一列一列点亮，中间的摆杆和摆锤真的在摆，每拍摆到一头，从摆锤推出一圈方形的「声波」；
 *         下面点阵字 METRE 逐字亮起，再下面 1 2 3 4 跟拍子亮；小黑猫（批 4 的像素猫，每个像素一颗点）从右边跑进来，第四拍坐在字旁边。
 *         新页面还没好就接着数（摆接着摆，猫坐着甩尾巴），不给进度条、不写俏皮话。
 *   落拍：数完、新页面也好了，一根竖的「指挥线」从左往右按格子扫过去，扫过的格子缩成点再熄掉，露出 Metre（约 0.4 秒）。
 * 画法：一张全屏 canvas，按格子画（12px 一格）。盖满的那一块是一个方形（波是按格子的方形），所以先离屏画好一整张熄灯点阵，
 *   每帧只按方形 / 指挥线右边那块整块贴上去，再逐格画波的前沿两圈和指挥线附近四列；按时间推进，只在换格时重画。没有图片、没有 WebGL。
 * 减少动态效果、或画不了 canvas 时返回 null，切换器照原来的方式原地换。
 * 对外：window.PinkieMetreTransition.play() → {overlay, ready, covered, waiting(), finish(), abort()}，和 PinkieModeTransitionFx 一个形状。 */
(() => {
  'use strict';
  if (window.PinkieMetreTransition) return;
  const root = document.documentElement;
  const CELL = 12;
  const BEAT = 300;            // 预备拍 ♩=200
  const COVER_MS = 380;        // 盖上：波推到最远的角用 0.38 秒
  const SWEEP_MS = 420;        // 落拍：指挥线扫过整屏用 0.42 秒
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
    ? {bg: '#151514', off: '#262523', on: '#ECEAE4', dim: '#4A4844', accent: '#93A5EE'}
    : {bg: '#F7F6F3', off: '#E4E2DB', on: '#1B1A18', dim: '#C9C6BE', accent: '#2F4BB0'};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // 窗口在后台时 requestAnimationFrame 不走，切换会卡住；那时退回定时器
  const frame = () => document.hidden ? wait(32) : new Promise((resolve) => requestAnimationFrame(resolve));

  function play() {
    if (reduced()) return null;
    const overlay = document.createElement('section');
    overlay.className = 'pk-metre-transition';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', '正在切换到 Metre');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return null;
    overlay.append(canvas);
    Object.assign(overlay.style, {position: 'fixed', inset: '0', zIndex: '2147483000', pointerEvents: 'auto', background: 'transparent'});
    Object.assign(canvas.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block'});
    document.body.append(overlay);

    const W = window.innerWidth, H = window.innerHeight;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
    const colors = palette();
    const center = (x) => x * CELL + CELL / 2;
    const dot = (g, x, y, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(center(x), center(y), r, 0, Math.PI * 2); g.fill(); };
    // 盖满以后的样子：底色 + 一整张熄灯的点（离屏画一次）
    const pattern = document.createElement('canvas');
    pattern.width = canvas.width; pattern.height = canvas.height;
    const pg = pattern.getContext('2d');
    pg.setTransform(ratio, 0, 0, ratio, 0, 0);
    pg.fillStyle = colors.bg; pg.fillRect(0, 0, W, H);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) dot(pg, x, y, CELL * 0.14, colors.off);
    const blit = (x0, y0, x1, y1) => {   // 格子范围 [x0, x1) × [y0, y1)
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(cols, x1); y1 = Math.min(rows, y1);
      if (x1 <= x0 || y1 <= y0) return;
      const sx = x0 * CELL, sy = y0 * CELL, sw = (x1 - x0) * CELL, sh = (y1 - y0) * CELL;
      ctx.drawImage(pattern, sx * ratio, sy * ratio, sw * ratio, sh * ratio, sx, sy, sw, sh);
    };
    // 波从模式按钮那里起；找不到就从正中起
    const button = [...document.querySelectorAll('.laolao-mode-switcher')].find((node) => node.getClientRects().length);
    const br = button?.getBoundingClientRect();
    const ox = br && br.width ? Math.floor((br.left + br.width / 2) / CELL) : Math.floor(cols / 2);
    const oy = br && br.width ? Math.floor((br.top + br.height / 2) / CELL) : Math.floor(rows / 2);
    const far = Math.max(ox, cols - ox, oy, rows - oy) + 3;
    // ---------- 构图（格子坐标）----------
    // 像素 M（一格 = 2×2 个点阵格），下面点阵字 METRE（5×7），再下面 1 2 3 4 四个数拍的数字（3×5）；小黑猫从右边跑进来坐在字的右边。
    // 字和数字用半格的细点（6px 一颗；用户 11-15：「Metre字太大了」），整格画太抢 M。
    const S = 2;
    const FINE = CELL / 2;
    const blockH = 11 * S + 2 + 4 + 2 + 3;
    // 猫坐在 M 右边（16 格宽 + 3 格空），整组往左让半只猫，M + 猫合起来居中
    const mx = Math.floor(cols / 2) - Math.floor((13 * S) / 2) - 9;
    const my = Math.max(2, Math.floor(rows / 2) - Math.floor(blockH / 2) - 1);
    // 字和数字的位置用 CSS 像素（细点）；M 的中线和整块的中线对齐
    const midPx = (mx + 6.5 * S) * CELL;
    const wordW = (5 * 6 - 1) * FINE;
    const wordX = Math.round(midPx - wordW / 2), wordY = (my + 11 * S + 2) * CELL;
    const digitsW = (4 * 5 - 2) * FINE;
    const digitsX = Math.round(midPx - digitsW / 2), digitsY = wordY + 7 * FINE + 2 * CELL;
    const catFinalX = mx + 13 * S + 3, catY = my + 11 * S - 16;
    // 摆：支点在底座上沿正中，摆杆长 8 个标志格；拍子落在两头（像真节拍器，每拍摆到一边「嗒」一下）
    const pivot = {x: mx + 6.5 * S, y: my + 10 * S};
    const ROD = 8 * S, SWING = 0.36;

    // cover = 波推到第几圈；lit = M 亮到第几列；beat = 当前拍；sweep = 指挥线到第几列（-1 = 还没落拍）；t = 从开始算的毫秒
    const state = {cover: -1, lit: 0, beat: -1, sweep: -1, t: 0, letters: 0, catX: cols + 2, catFrame: 0, sitting: false, ripple: -1};
    function cellState(x, y) {
      // 0 = 没盖（透明）；1 = 刚亮的点；2 = 半格；3 = 整格
      const age = state.cover - Math.max(Math.abs(x - ox), Math.abs(y - oy));
      let s = age < 0 ? 0 : age === 0 ? 1 : age === 1 ? 2 : 3;
      if (state.sweep >= 0) {
        const past = state.sweep - x;
        if (past >= 3) s = 0; else if (past === 2) s = Math.min(s, 1); else if (past >= 0) s = Math.min(s, 2);
      }
      return s;
    }
    function cell(x, y) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const s = cellState(x, y);
      if (s === 3) blit(x, y, x + 1, y + 1);
      else if (s === 2) { ctx.fillStyle = colors.bg; ctx.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4); dot(ctx, x, y, CELL * 0.14, colors.off); }
      else if (s === 1) dot(ctx, x, y, CELL * 0.3, colors.dim);
    }
    function ring(d) {
      if (d < 0) return;
      if (d === 0) { cell(ox, oy); return; }
      for (let x = ox - d; x <= ox + d; x++) { cell(x, oy - d); cell(x, oy + d); }
      for (let y = oy - d + 1; y <= oy + d - 1; y++) { cell(ox - d, y); cell(ox + d, y); }
    }
    const DIGITS = {
      1: ['.#.', '##.', '.#.', '.#.', '###'],
      2: ['##.', '..#', '.#.', '#..', '###'],
      3: ['##.', '..#', '.#.', '..#', '##.'],
      4: ['#.#', '#.#', '###', '..#', '..#'],
    };
    const FONT = {
      M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
      E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
      T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
      R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    };
    const cat = window.LaolaoMetreCat;
    const runFrames = cat?.STATES?.exec?.frames || [];
    const sitFrames = cat?.STATES?.idle?.frames || [];
    // 摆杆的角度：每拍摆到一头；还没开始数时停在正中
    const angle = () => state.beat < 0 ? 0 : SWING * Math.cos(Math.PI * (state.t / BEAT));
    let lastKey = '';
    function draw() {
      const a = angle();
      const tipX = Math.round(pivot.x + Math.sin(a) * ROD), tipY = Math.round(pivot.y - Math.cos(a) * ROD);
      const key = `${state.cover},${state.lit},${state.beat},${state.sweep},${tipX},${tipY},${state.letters},${state.catX},${state.catFrame},${state.sitting},${state.ripple}`;
      if (key === lastKey) return;
      lastKey = key;
      ctx.clearRect(0, 0, W, H);
      const k = state.cover - 2;
      const left = state.sweep >= 0 ? state.sweep + 1 : 0;
      if (k >= 0) blit(Math.max(ox - k, left), oy - k, ox + k + 1, oy + k + 1);
      ring(state.cover); ring(state.cover - 1);
      if (state.sweep >= 0) for (let x = state.sweep - 2; x <= state.sweep; x++) for (let y = 0; y < rows; y++) cell(x, y);
      // 下面的东西只画在整格盖着的地方
      const covered = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && cellState(x, y) === 3;
      const lit = (x, y, color, r = 0.36) => { if (covered(x, y)) dot(ctx, x, y, CELL * r, color); };
      // 细点：(px, py) 是 CSS 像素；它落在哪个整格，那一格盖着才画
      const fine = (px, py, color, r) => {
        if (!covered(Math.floor(px / CELL), Math.floor(py / CELL))) return;
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px + FINE / 2, py + FINE / 2, FINE * r, 0, Math.PI * 2); ctx.fill();
      };
      // 每拍从摆锤那里推出一圈声波（方的，按格子走），越远越淡
      if (state.ripple >= 2) {
        const d = state.ripple;
        ctx.globalAlpha = Math.max(0, 1 - d / 22);
        for (let x = tipX - d; x <= tipX + d; x++) { lit(x, tipY - d, colors.dim, 0.22); lit(x, tipY + d, colors.dim, 0.22); }
        for (let y = tipY - d + 1; y <= tipY + d - 1; y++) { lit(tipX - d, y, colors.dim, 0.22); lit(tipX + d, y, colors.dim, 0.22); }
        ctx.globalAlpha = 1;
      }
      // M 的框（不含中间的 V、摆杆和摆锤）：一列一列点亮；V 两条是摆过的残影，常暗
      for (let gy = 0; gy < 11; gy++) for (let gx = 0; gx < 13; gx++) {
        const c = LOGO[gy][gx];
        if (c === '.' || c === '@') continue;
        const inner = gx >= 5 && gx <= 7 && gy >= 3 && gy <= 9;
        const on = !inner && gx < state.lit;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) lit(mx + gx * S + sx, my + gy * S + sy, on ? colors.on : colors.dim, on ? 0.36 : 0.2);
      }
      // 摆杆 + 摆锤（亮完以后才出现）
      if (state.lit >= 13) {
        const steps = ROD * 2;
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          lit(Math.round(pivot.x + (tipX - pivot.x) * f), Math.round(pivot.y + (tipY - pivot.y) * f), colors.on);
        }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) lit(tipX + dx, tipY + dy, colors.accent, 0.42);
      }
      // METRE：一个字母一个字母亮起来
      [...'METRE'].forEach((ch, i) => FONT[ch].forEach((row, y) => [...row].forEach((c, x) => {
        if (c === '#') fine(wordX + (i * 6 + x) * FINE, wordY + y * FINE, i < state.letters ? colors.on : colors.dim, i < state.letters ? 0.4 : 0.24);
      })));
      // 1 2 3 4：当前那一拍是强调色
      for (let n = 0; n < 4; n++) DIGITS[n + 1].forEach((row, y) => [...row].forEach((c, x) => {
        if (c === '#') fine(digitsX + (n * 5 + x) * FINE, digitsY + y * FINE, n === state.beat ? colors.accent : colors.dim, n === state.beat ? 0.42 : 0.26);
      }));
      // 落拍时扫过去的那根「指挥棒」：一整列钴蓝的点
      if (state.sweep >= 0) for (let y = 0; y < rows; y++) if (covered(state.sweep + 1, y)) dot(ctx, state.sweep + 1, y, CELL * 0.3, colors.accent);
      // 小黑猫：每个像素一颗点，身体用字色，眼睛用强调色
      const frameRows = state.sitting ? sitFrames[state.catFrame % Math.max(1, sitFrames.length)] : runFrames[state.catFrame % Math.max(1, runFrames.length)];
      if (frameRows) frameRows.forEach((row, y) => [...row].forEach((c, x) => {
        if (c === 'K') lit(state.catX + x, catY + y, colors.on, 0.4);
        else if (c === 'E' || c === 'H') lit(state.catX + x, catY + y, colors.accent, 0.4);
        else if (c === 'S') lit(state.catX + x, catY + y, colors.dim, 0.24);
      }));
    }

    let alive = true, leaving = false;
    const ready = frame();
    // 盖上：按时间推进，慢机器上跳几圈也准时盖满
    const covered = (async () => {
      await ready;
      const t0 = performance.now();
      while (alive && state.cover < far) {
        state.cover = Math.min(far, Math.floor(((performance.now() - t0) / COVER_MS) * far));
        draw();
        await frame();
      }
      if (!alive) throw new Error('aborted');
    })();
    // 数拍：和盖上同时开始。第一拍 M 的框一列一列亮；第二、三拍 METRE 逐字亮；猫从右边跑进来，第四拍坐下。
    // 数完之前不落拍，之后新页面好了就落拍，没好就接着数（摆接着摆，猫坐着甩尾巴）。
    const counted = (async () => {
      await ready;
      const t0 = performance.now();
      const run = 4 * BEAT - 120;
      for (let n = 0; alive; n++) {
        if (n >= 4 && leaving) return;
        state.beat = n % 4;
        const until = t0 + (n + 1) * BEAT;
        while (alive && performance.now() < until) {
          const t = performance.now() - t0;
          state.t = t;
          state.lit = Math.min(13, Math.ceil((t / (BEAT * 1.2)) * 13));
          state.letters = Math.max(0, Math.min(5, Math.floor((t - BEAT * 0.9) / (BEAT * 0.36)) + 1));
          state.ripple = Math.floor((t - n * BEAT) / 22);
          if (t < run) {
            state.sitting = false;
            state.catX = Math.round(cols + 2 - (cols + 2 - catFinalX) * (t / run));
            state.catFrame = Math.floor(t / 80);
          } else {
            state.sitting = true;
            state.catX = catFinalX;
            state.catFrame = Math.floor((t - run) / 260);
          }
          draw();
          await frame();
        }
      }
    })();

    async function finish() {
      leaving = true;
      await counted;
      if (!alive) return;
      state.beat = 0;
      const t0 = performance.now();
      while (alive && state.sweep <= cols + 2) {
        state.sweep = Math.floor(((performance.now() - t0) / SWEEP_MS) * (cols + 3));
        draw();
        await frame();
      }
      alive = false;
      overlay.remove();
    }
    function abort() { alive = false; overlay.remove(); }
    return {overlay, ready, covered, waiting() {}, finish, abort};
  }

  window.PinkieMetreTransition = Object.freeze({play});
})();
