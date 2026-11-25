/* laolao-metre-brand —— Metre 的标志和标志页（11-15）。
 *
 * 用户：「需要你设计一个 Metre 的 Logo……也做一个页面」，参考视频里的画全是像素拼的（「人家全是像素构建的」），
 * 配色要有大厂的感觉，不要「电子垃圾」。所以：
 *   标志 —— 手摆的 13×11 像素 M：顶上两根柱，中间的 V 收拢成一根摆杆落到支点，底下一整排是底座，摆锤 2×2。
 *   标志页 —— 一整块 LED 点阵屏：熄灭的点铺满全屏当底纹，节拍器、点阵字 METRE、四个拍点都靠点亮点来画；
 *   摆杆按格子一步一步摆（♩=72），摆锤是唯一的强调色。中性灰阶，不发光、不用彩色。
 *
 * 入口：首页 / 新会话页引导语上方的小标志（点开）；`window.__pinkieMetreBrand.open()`。只在 Metre 模式出现。
 * 资源：画面只在标志页开着、窗口在前台时更新，而且只在摆杆换格时重画；关掉就停。减少动态效果时只画一帧。 */
(() => {
  'use strict';
  if (window.__pinkieMetreBrand) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const h = (tag, cls, html) => { const node = document.createElement(tag); if (cls) node.className = cls; if (html != null) node.innerHTML = html; return node; };

  // ---------- 像素标志 ----------
  // '#' 实格，'@' 摆锤（强调色）。改图只改这里；ui/assets/metre-logo.svg 是同一张图。
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
  function mark({title = 'Metre'} = {}) {
    const label = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"';
    let ink = '', bob = '';
    LOGO.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === '#') ink += `M${x + 0.06} ${y + 0.06}h0.88v0.88h-0.88z`;
      if (c === '@') bob += `M${x + 0.06} ${y + 0.06}h0.88v0.88h-0.88z`;
    }));
    return `<svg class="pk-metre-logo" viewBox="0 0 13 11" shape-rendering="crispEdges" ${label}><path d="${ink}" fill="currentColor"/><path class="pk-metre-logo__bob" d="${bob}"/></svg>`;
  }

  // ---------- 点阵字（5×7） ----------
  const FONT = {
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  };

  // ---------- 标志页：LED 点阵屏 ----------
  const BPM = 72;
  const BEAT = 60_000 / BPM;
  let page = null, canvas = null, ctx = null, frame = 0, lastFocus = null, startAt = 0, lastKey = '';
  let grid = null;   // {pitch, cols, rows, base: 离屏的熄灭点}

  function build() {
    page = h('section', 'pk-metre-brand');
    page.id = 'pk-metre-brand';
    page.setAttribute('role', 'dialog');
    page.setAttribute('aria-modal', 'true');
    page.setAttribute('aria-label', '关于 Metre');
    page.tabIndex = -1;
    page.hidden = true;
    canvas = h('canvas', 'pk-metre-brand__led');
    canvas.setAttribute('aria-hidden', 'true');
    const close = h('button', 'pk-metre-brand__close', '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>');
    close.type = 'button'; close.title = '关闭（Esc）'; close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => api.close());
    const body = h('div', 'pk-metre-brand__body', `
      <h1 class="pk-metre-brand__sr">Metre</h1>
      <p class="pk-metre-brand__lede">把一件事，按拍子做完。</p>
      <p class="pk-metre-brand__sub">读懂你要什么，拆成几个声部交给合适的模型，自己守着拍子逐块验收。</p>
      <dl class="pk-metre-brand__parts">
        <div><dt>Baton</dt><dd>指挥分派</dd></div>
        <div><dt>Virtuoso</dt><dd>一个人奏完</dd></div>
        <div><dt>Score</dt><dd>总谱</dd></div>
      </dl>
      <div class="pk-metre-brand__actions"><button type="button" class="pk-metre-brand__go">开始</button><span>4/4 · ♩ = ${BPM} · Esc 关闭</span></div>`);
    body.querySelector('.pk-metre-brand__go').addEventListener('click', () => {
      api.close();
      document.querySelector('.agent-chat__composer-combobox textarea')?.focus();
    });
    page.append(canvas, close, body);
    document.body.append(page);
  }

  const css = (name, fallback) => getComputedStyle(page).getPropertyValue(name).trim() || fallback;

  function layout() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(hgt * ratio);
    ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const pitch = Math.max(7, Math.min(11, Math.floor(Math.min(w, hgt) / 82)));
    const cols = Math.ceil(w / pitch), rows = Math.ceil(hgt / pitch);
    // 熄灭的点只画一次，放在离屏画布上
    const base = document.createElement('canvas');
    base.width = canvas.width; base.height = canvas.height;
    const b = base.getContext('2d');
    b.setTransform(ratio, 0, 0, ratio, 0, 0);
    b.fillStyle = css('--led-off', '#1E1E21');
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      b.beginPath(); b.arc(x * pitch + pitch / 2, y * pitch + pitch / 2, pitch * 0.2, 0, Math.PI * 2); b.fill();
    }
    grid = {pitch, cols, rows, base, ratio};
    lastKey = '';
  }

  // 场景（格子坐标）：节拍器在上半屏正中，点阵字在它下面，四个拍点再下面。
  function scene(now) {
    const {cols, rows} = grid;
    const lit = new Map();   // "x,y" → 'ink' | 'dim' | 'bob'
    const put = (x, y, kind = 'ink') => { if (x >= 0 && y >= 0 && x < cols && y < rows) lit.set(x + ',' + y, kind); };
    const line = (x0, y0, x1, y1, kind) => {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) { put(x0, y0, kind); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    };
    const H = Math.max(20, Math.min(30, Math.floor(rows * 0.3)));     // 节拍器高
    const cx = Math.floor(cols / 2);
    const top = Math.max(3, Math.floor(rows * 0.1));
    const bottom = top + H;
    const halfTop = Math.round(H * 0.12), halfBottom = Math.round(H * 0.44);
    // 机身两侧 + 顶 + 两层底座
    line(cx - halfTop, top, cx - halfBottom, bottom, 'ink');
    line(cx + halfTop, top, cx + halfBottom, bottom, 'ink');
    line(cx - halfTop, top, cx + halfTop, top, 'ink');
    line(cx - halfTop + 1, top - 1, cx + halfTop - 1, top - 1, 'ink');   // 机身顶上的帽，两层收窄，不像帐篷
    put(cx, top - 2, 'ink');
    line(cx - halfBottom - 2, bottom + 1, cx + halfBottom + 2, bottom + 1, 'ink');
    line(cx - halfBottom - 2, bottom + 2, cx + halfBottom + 2, bottom + 2, 'ink');
    // 摆杆：支点在底座上方，荡到两边正好落在机身顶角（M 的 V），那两条是暗的残影
    const pivotY = bottom - 2;
    const len = pivotY - top;
    const maxAngle = Math.atan2(halfTop, len);
    line(cx - halfTop, top, cx, pivotY, 'dim');
    line(cx + halfTop, top, cx, pivotY, 'dim');
    const beatPos = reduced() ? 0.5 : (Date.now() % (BEAT * 2)) / (BEAT * 2);   // 一个来回两拍；按 Date.now() 落拍，和背景的摆锤、猫点头同一个钟（11-23）
    const angle = maxAngle * Math.cos(beatPos * Math.PI * 2);
    const tipX = cx + Math.sin(angle) * len, tipY = pivotY - Math.cos(angle) * len;
    line(cx, pivotY, tipX, tipY, 'ink');
    const bx = Math.round(cx + Math.sin(angle) * len * 0.7), by = Math.round(pivotY - Math.cos(angle) * len * 0.7);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(bx + dx, by + dy, 'bob');
    // 点阵字 METRE
    const word = 'METRE';
    const wordW = word.length * 5 + (word.length - 1) * 2;
    let x0 = cx - Math.floor(wordW / 2);
    const wordY = bottom + 5;
    for (const ch of word) {
      FONT[ch].forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') put(x0 + x, wordY + y, 'ink'); }));
      x0 += 7;
    }
    // 四个拍点：强-弱-弱-弱，当前那一拍点亮
    const beat = reduced() ? 0 : Math.floor(Date.now() / BEAT) % 4;
    const beatsY = wordY + 10;
    const starts = [-7, -2, 2, 6];
    starts.forEach((off, i) => {
      const size = i === 0 ? 2 : 1;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) put(cx + off + dx, beatsY + dy, i === beat ? 'bob' : 'dim');
    });
    return {lit, key: `${Math.round(tipX)},${Math.round(tipY)},${bx},${by},${beat}`, textTop: (beatsY + 4) * grid.pitch};
  }

  function draw(now) {
    if (!ctx || !grid) return;
    const s = scene(now);
    if (s.key === lastKey) return;   // 摆杆没换格就不重画
    lastKey = s.key;
    const {pitch, base, ratio} = grid;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const colors = {ink: css('--led-on', '#EDEDEF'), dim: css('--led-dim', '#3A3A40'), bob: css('--led-accent', '#C8A15E')};
    for (const [k, kind] of s.lit) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillStyle = colors[kind];
      ctx.beginPath(); ctx.arc(x * pitch + pitch / 2, y * pitch + pitch / 2, pitch * 0.34, 0, Math.PI * 2); ctx.fill();
    }
    page.style.setProperty('--text-top', s.textTop + 'px');
  }
  function loop(now) {
    frame = 0;
    if (!page || page.hidden || document.hidden) return;
    draw(now);
    frame = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (frame) return;
    if (reduced()) { draw(startAt); return; }
    frame = requestAnimationFrame(loop);
  }
  function stopLoop() { if (frame) cancelAnimationFrame(frame); frame = 0; }

  const api = {
    mark,
    get isOpen() { return Boolean(page && !page.hidden); },
    open() {
      if (!isMetre()) return false;
      if (!page) build();
      if (page.hidden) lastFocus = document.activeElement;
      page.hidden = false;
      startAt = performance.now();
      layout();
      startLoop();
      page.focus({preventScroll: true});
      return true;
    },
    close() {
      if (!page || page.hidden) return;
      page.hidden = true;
      stopLoop();
      lastFocus?.focus?.({preventScroll: true});
    },
  };

  // 首页 / 新会话页引导语上方的小标志：点开标志页。
  function homeMark() {
    const prompt = document.querySelector('.pk-metre-prompt');
    if (!prompt || prompt.querySelector('.pk-metre-home-mark')) return;
    const btn = h('button', 'pk-metre-home-mark', mark());
    btn.type = 'button';
    btn.title = '关于 Metre';
    btn.setAttribute('aria-label', '关于 Metre');
    btn.addEventListener('click', () => api.open());
    prompt.prepend(btn);
  }
  let queued = false;
  const queue = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; if (isMetre()) homeMark(); else api.close(); }, 150); } };
  function start() {
    const shell = document.querySelector('.shell') || document.body;
    window.Pinkie?.domWatch?.createObserver((records) => {
      if (!isMetre()) return;
      if (records.some((r) => !(r.target instanceof Element) || !r.target.closest('.chat-thread, .pk-metre-board, .pk-metre-brand'))) queue();
    })?.watch(shell, {childList: true});
    new MutationObserver(queue).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-laolao-startup-home']});
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && api.isOpen) { event.stopPropagation(); api.close(); } }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else if (api.isOpen) startLoop(); });
    window.addEventListener('resize', () => { if (api.isOpen) { layout(); draw(performance.now()); } });
    queue();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();

  window.__pinkieMetreBrand = api;
})();
