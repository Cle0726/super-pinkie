/* laolao-metre-backdrop —— Metre 对话页的像素背景（11-15）。
 *
 * 用户给的参考视频里，「主题」是一张铺满窗口、会慢慢动的像素画，对话浮在上面；画面一格一格拼成，动起来按格子跳。
 * Metre 的意象是音乐，所以这里是一块 LED 点阵屏：
 *   熄灭的点铺满对话区当底纹（很淡）；
 *   底部一行五线谱从右往左走（每半拍挪一格，♩=72），音符、符杠、小节线全是点亮的点；
 *   左边一根固定的「指挥线」，走过它的那个音符亮成旧铜色，走过去的变淡；指挥线上方四个拍点跟着拍子亮（强-弱-弱-弱）。
 * 配色守「石墨」：中性灰阶 + 一个低饱和旧铜，不发光、不用渐变；正文、输入框、总控台在上面，可读性第一。
 *
 * 资源（批 6「不留常驻动画」）：只在 Metre、对话页（含首页、新会话页）、窗口可见时跑；一个 setTimeout 每半拍走一格，
 * 只在换格时重画（熄灭的点和谱线离屏画一次）；标志页开着时停；减少动态效果时只画一帧。
 * 不在 Metre 时画布直接拿掉，根元素上的 data-pk-metre-backdrop 也拿掉，什么都不剩。 */
(() => {
  'use strict';
  if (window.__pinkieMetreBackdrop) return;

  const root = document.documentElement;
  const BPM = 72;
  const STEP = 60_000 / BPM / 2;          // 半拍挪一格
  const PITCH = 8;                        // 一格 8 个 CSS 像素
  const SPACE = 3;                        // 五线谱两线之间 3 格
  const NOTE_GAP = 7;                     // 四分音符之间 7 格
  const BAR = NOTE_GAP * 4 + 3;           // 一小节的宽度（四拍 + 小节线前后的空）

  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const mainEl = () => document.querySelector('main.content.content--chat');

  let canvas = null, ctx = null, grid = null, timer = 0, step = 0, observed = null, lastKey = '';
  const mainClass = new MutationObserver(() => queue());
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (canvas) { layout(); draw(true); } }) : null;

  // ---------- 谱子：按小节编号算出来，同一小节每次都一样 ----------
  // 音高 pos：0 = 最下面那条线，每升一级 +1（偶数在线上，奇数在间里），用 1..7。
  function hash(n) {
    let x = (n | 0) * 374761393 + 668265263;
    x = (x ^ (x >>> 13)) * 1274126177;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }
  const RHYTHMS = [
    ['q', 'q', 'q', 'q'],
    ['q', 'ee', 'q', 'q'],
    ['q', 'q', 'ee', 'q'],
    ['h', 'q', 'q'],
    ['ee', 'q', 'ee', 'q'],
    ['q', 'q', 'h'],
  ];
  const barCache = new Map();
  function bar(index) {
    if (barCache.has(index)) return barCache.get(index);
    const rhythm = RHYTHMS[Math.floor(hash(index * 7 + 1) * RHYTHMS.length)];
    let pos = 2 + Math.floor(hash(index * 13 + 5) * 4);
    const notes = [];
    let col = 2;
    let k = 0;
    const next = () => {
      const r = hash(index * 31 + k++ * 17 + 3);
      pos = Math.max(1, Math.min(7, pos + (r < 0.2 ? -2 : r < 0.45 ? -1 : r < 0.55 ? 0 : r < 0.8 ? 1 : 2)));
      return pos;
    };
    for (const v of rhythm) {
      if (v === 'ee') {
        notes.push({col, pos: next(), beam: 'start'});
        notes.push({col: col + 4, pos: next(), beam: 'end'});
        col += NOTE_GAP;
      } else if (v === 'h') {
        notes.push({col, pos: next(), open: true});
        col += NOTE_GAP * 2;
      } else {
        notes.push({col, pos: next()});
        col += NOTE_GAP;
      }
    }
    if (barCache.size > 64) barCache.clear();
    barCache.set(index, notes);
    return notes;
  }

  // ---------- 画布 ----------
  const css = (name, fallback) => (canvas && getComputedStyle(canvas).getPropertyValue(name).trim()) || fallback;

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
    const cols = Math.ceil(w / PITCH), rows = Math.ceil(hgt / PITCH);
    // 五线谱：最下面那条线离底边 7 格。输入框那一竖条（左右各留 3 格）让开，谱子只在两边的空地上露出来，
    // 输入框、它下面的模型 / Baton 那一行和小猫周围都干净。指挥线放在左边那块空地的正中；左边放不下就放右边，都放不下就不画谱。
    const staffBottom = rows - 7;
    const staffTop = staffBottom - SPACE * 4;
    const input = document.querySelector('.agent-chat__input');
    const ir = input?.getBoundingClientRect();
    let clear = [cols, cols];
    if (ir && ir.width > 0) clear = [Math.floor((ir.left - rect.left) / PITCH) - 3, Math.ceil((ir.right - rect.left) / PITCH) + 3];
    const leftRoom = clear[0], rightRoom = cols - clear[1];
    const conductor = leftRoom >= 14 ? Math.round(leftRoom / 2) : rightRoom >= 14 ? clear[1] + Math.round(rightRoom / 2) : -1;
    const open = (x) => conductor >= 0 && (x < clear[0] || x >= clear[1]);
    const colors = {
      off: css('--bd-off', '#1F1F23'),
      line: css('--bd-line', '#2A2A2F'),
      note: css('--bd-note', '#4A4A52'),
      past: css('--bd-past', '#323238'),
      accent: css('--bd-accent', '#C8A15E'),
    };
    // 熄灭的点 + 五线谱 + 指挥线：离屏画一次
    const base = document.createElement('canvas');
    base.width = canvas.width; base.height = canvas.height;
    const b = base.getContext('2d');
    b.setTransform(ratio, 0, 0, ratio, 0, 0);
    const dot = (g, x, y, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(x * PITCH + PITCH / 2, y * PITCH + PITCH / 2, r, 0, Math.PI * 2); g.fill(); };
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) dot(b, x, y, PITCH * 0.16, colors.off);
    for (let i = 0; i < 5; i++) for (let x = 0; x < cols; x++) if (open(x)) dot(b, x, staffTop + i * SPACE, PITCH * 0.24, colors.line);
    if (conductor >= 0) for (let y = staffTop - 3; y <= staffBottom + 2; y++) dot(b, conductor, y, PITCH * 0.24, colors.line);
    grid = {cols, rows, ratio, base, staffTop, staffBottom, conductor, colors, dot, open};
    lastKey = '';
  }

  // 一帧里点亮哪些格：key "x,y" → 'note' | 'past' | 'accent' | 'line'
  function scene() {
    const {cols, staffTop, staffBottom, conductor, open} = grid;
    const lit = new Map();
    if (conductor < 0) return lit;
    const put = (x, y, kind) => { if (x >= 0 && x < cols && open(x)) { const k = x + ',' + y; if (lit.get(k) !== 'accent') lit.set(k, kind); } };
    const lineRow = (pos) => staffBottom - (pos / 2) * SPACE;   // pos 偶数时是整数行
    // 谱带从右往左走：屏幕第 x 列对应谱上第 x + step 格
    const first = Math.floor(step / BAR) - 1, last = Math.floor((step + cols) / BAR) + 1;
    for (let i = first; i <= last; i++) {
      const x0 = i * BAR - step;
      // 小节线
      if (i !== first) for (let y = staffTop; y <= staffBottom; y++) put(x0, y, x0 < conductor ? 'past' : 'line');
      const notes = bar(i);
      const stems = [];
      for (const n of notes) {
        const x = x0 + n.col;
        const here = x <= conductor && conductor <= x + 2;
        const kind = here ? 'accent' : x + 2 < conductor ? 'past' : 'note';
        // 符头：在线上 3×3（缺四角，像个圆点），在间里 3×2；二分音符中间空心
        let rowsOf;
        if (n.pos % 2 === 0) rowsOf = [lineRow(n.pos) - 1, lineRow(n.pos), lineRow(n.pos) + 1];
        else { const below = lineRow(n.pos - 1); rowsOf = [below - 2, below - 1]; }
        rowsOf.forEach((y, ry) => {
          for (let dx = 0; dx < 3; dx++) {
            const corner = rowsOf.length === 3 && ry !== 1 && dx !== 1;
            if (corner) continue;
            if (n.open && dx === 1 && (rowsOf.length === 2 || ry === 1)) continue;
            put(x + dx, y, kind);
          }
        });
        // 符干：高音朝下、低音朝上，7 格
        const up = n.pos < 4;
        const sx = up ? x + 2 : x;
        const from = up ? rowsOf[0] - 1 : rowsOf[rowsOf.length - 1] + 1;
        const to = up ? from - 6 : from + 6;
        for (let y = Math.min(from, to); y <= Math.max(from, to); y++) put(sx, y, kind);
        stems.push({n, sx, end: to, kind});
      }
      // 八分音符一对：符杠连起两根符干的端点（取更远的那一端，两根一起拉齐）
      for (let s = 0; s < stems.length - 1; s++) {
        if (stems[s].n.beam !== 'start') continue;
        const a = stems[s], c = stems[s + 1];
        const up = a.end < lineRow(a.n.pos);
        const row = up ? Math.min(a.end, c.end) : Math.max(a.end, c.end);
        for (const st of [a, c]) for (let y = Math.min(st.end, row); y <= Math.max(st.end, row); y++) put(st.sx, y, st.kind);
        const kind = a.kind === 'accent' || c.kind === 'accent' ? 'accent' : a.kind;
        for (let x = a.sx; x <= c.sx; x++) { put(x, row, kind); put(x, row + (up ? 1 : -1), kind); }
      }
    }
    // 四个拍点：指挥线上方，强拍大一点；当前那一拍是旧铜色
    const beat = reduced() ? 0 : Math.floor(step / 2) % 4;
    const by = staffTop - 7;
    [[-4, 2], [-1, 1], [1, 1], [3, 1]].forEach(([off, size], i) => {
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) put(conductor + off + dx, by + dy - (size - 1), i === beat ? 'accent' : 'line');
    });
    return lit;
  }

  function draw(force = false) {
    if (!ctx || !grid) return;
    const key = `${step},${grid.cols},${grid.rows}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const {base, ratio, colors, dot} = grid;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (const [k, kind] of scene()) {
      const [x, y] = k.split(',').map(Number);
      dot(ctx, x, y, PITCH * 0.34, colors[kind]);
    }
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
    new MutationObserver(queue).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-theme', 'data-pinkie-night', 'data-pinkie-reduce-motion']});
    const shell = document.querySelector('openclaw-app') || document.body;
    // 换页（对话 ↔ 设置等）时 main 的 class 会变；只看结构变化，不看对话流里的字
    new MutationObserver((records) => {
      if (!isMetre() && !canvas) return;
      if (records.some((r) => !(r.target instanceof Element) || !r.target.closest('.chat-thread, .pk-metre-board, .pk-metre-brand'))) queue();
    }).observe(shell, {childList: true, subtree: true});
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else queue(); });
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
