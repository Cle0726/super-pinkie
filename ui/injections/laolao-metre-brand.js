/* laolao-metre-brand —— Metre 的标志和标志页（11-15，用户：「需要你设计一个 Metre 的 Logo……也做一个页面」）。
 *
 * 标志：一个 M。两条外腿是节拍器机身的两侧，中间的 V 是摆杆荡到两边的位置，在底下的支点交汇；
 * 正中是此刻的摆杆，琥珀色的摆锤；底下一横是底座。静态版在 ui/assets/metre-logo.svg。
 * 标志页：铺满窗口的深色页，背景是几行慢慢起伏的谱线和在线上走的音符（每个声部一个颜色），
 * 正中是会摆的标志，摆杆按 ♩=72 摆，下面一排「强-弱-弱-弱」四个拍点跟着亮。
 *
 * 入口：首页引导语上方的小标志（点开）；`window.__pinkieMetreBrand.open()`。只在 Metre 模式出现。
 * 资源：动画只在标志页开着、窗口在前台时跑；关掉或切走就停（批 6 的约定：Metre 里不留常驻动画）。
 * 「减少动态效果」打开时只画一帧静态图。 */
(() => {
  'use strict';
  if (window.__pinkieMetreBrand) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const h = (tag, cls, html) => { const node = document.createElement(tag); if (cls) node.className = cls; if (html != null) node.innerHTML = html; return node; };

  // 静态：M 的四笔一样实，琥珀摆锤停在 V 右边那一笔的上段（摆杆刚荡到右边）。
  // 会动（标志页）：V 变成摆动的残影，正中那根摆杆带着摆锤绕支点 (24, 36) 左右摆，荡到两边正好落在 V 上（±13.6°）。
  function mark({live = false, title = 'Metre'} = {}) {
    const label = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"';
    return `<svg class="pk-metre-logo${live ? ' is-live' : ''}" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round" ${label}>
  <path d="M10.5 40 17 8.5M37.5 40 31 8.5M7.5 40.5h33" stroke="currentColor" stroke-width="3.2"/>
  <path class="pk-metre-logo__v" d="M17 8.5 24 36 31 8.5" stroke="currentColor" stroke-width="3.2"/>
  ${live ? '<g class="pk-metre-logo__arm"><path d="M24 36V10" stroke="currentColor" stroke-width="2.6"/><circle class="pk-metre-logo__bob" cx="24" cy="17.5" r="3.8"/></g>'
    : '<circle class="pk-metre-logo__bob" cx="28.9" cy="17.2" r="3.9"/>'}
</svg>`;
  }

  // ---------- 标志页 ----------
  let page = null, canvas = null, ctx = null, frame = 0, lastFocus = null, startAt = 0, lastDraw = 0;
  const BPM = 72;
  const BEAT = 60_000 / BPM;

  function build() {
    page = h('section', 'pk-metre-brand');
    page.id = 'pk-metre-brand';
    page.setAttribute('role', 'dialog');
    page.setAttribute('aria-modal', 'true');
    page.setAttribute('aria-label', '关于 Metre');
    page.tabIndex = -1;
    page.hidden = true;
    page.style.setProperty('--pk-beat', BEAT + 'ms');
    canvas = h('canvas', 'pk-metre-brand__staff');
    canvas.setAttribute('aria-hidden', 'true');
    const close = h('button', 'pk-metre-brand__close', '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>');
    close.type = 'button'; close.title = '关闭（Esc）'; close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => api.close());
    const beats = [0, 1, 2, 3].map((i) => `<i class="pk-metre-brand__beat${i === 0 ? ' is-down' : ''}" style="animation-delay:${i * BEAT}ms"></i>`).join('');
    const body = h('div', 'pk-metre-brand__body', `
      <div class="pk-metre-brand__mark">${mark({live: true})}</div>
      <h1 class="pk-metre-brand__word">Metre</h1>
      <div class="pk-metre-brand__beats" aria-hidden="true">${beats}</div>
      <p class="pk-metre-brand__lede">把一件事，按<em>拍子</em>做完。</p>
      <p class="pk-metre-brand__sub">读懂你要什么，拆成几个声部，交给合适的模型；自己守着拍子，一块一块验收，最后交回一份你能直接用的结果。</p>
      <ul class="pk-metre-brand__parts">
        <li><b><em>Baton</em></b><span>指挥：拆开、分派、验收</span></li>
        <li><b><em>Virtuoso</em></b><span>独奏：一个人从头做到尾</span></li>
        <li><b><em>Score</em></b><span>总控台：谁在跑、卡在哪</span></li>
      </ul>
      <button type="button" class="pk-metre-brand__go">开始</button>
      <p class="pk-metre-brand__foot"><span>4/4</span><span>♩ = ${BPM}</span><span>Esc 关闭</span></p>`);
    body.querySelector('.pk-metre-brand__go').addEventListener('click', () => {
      api.close();
      document.querySelector('.agent-chat__composer-combobox textarea')?.focus();
    });
    page.append(canvas, close, body);
    document.body.append(page);
  }

  // 背景：三组五线谱，线条慢慢起伏；音符沿线走，颜色是总控台里四种状态色。
  const NOTE_COLORS = ['--metre-v1', '--metre-v2', '--metre-v3', '--metre-v4'];
  let notes = [];
  function seedNotes(width) {
    notes = Array.from({length: 14}, (_, i) => ({
      staff: i % 3, line: (i * 7) % 5, x: (i / 14) * width, speed: 14 + (i % 5) * 5, color: NOTE_COLORS[i % 4], size: 3 + (i % 3),
    }));
  }
  function resize() {
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    seedNotes(canvas.clientWidth);
  }
  function draw(now) {
    if (!ctx) return;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    const t = (now - startAt) / 1000;
    const style = getComputedStyle(page);
    ctx.clearRect(0, 0, w, hgt);
    const staffs = [0.2, 0.5, 0.8].map((f) => f * hgt);
    const gap = Math.max(9, Math.min(14, hgt / 70));
    const wave = (x, s) => Math.sin(x / 260 + t * 0.35 + s * 1.7) * 18 + Math.sin(x / 120 - t * 0.22 + s) * 6;
    ctx.lineWidth = 1;
    staffs.forEach((y0, s) => {
      ctx.strokeStyle = style.getPropertyValue('--brand-staff').trim() || 'rgba(233,231,242,0.08)';
      for (let l = 0; l < 5; l++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12) {
          const y = y0 + (l - 2) * gap + wave(x, s);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    });
    // 拍点：每拍一次，音符轻轻亮一下
    const pulse = 1 - ((now - startAt) % BEAT) / BEAT;
    for (const n of notes) {
      const x = (n.x + t * n.speed) % (w + 40) - 20;
      const y = staffs[n.staff] + (n.line - 2) * gap + wave(x, n.staff);
      const color = style.getPropertyValue(n.color).trim() || '#F2B35B';
      ctx.globalAlpha = 0.55 + pulse * 0.35;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, n.size * 1.25, n.size, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.18 * pulse;
      ctx.beginPath();
      ctx.arc(x, y, n.size * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function loop(now) {
    frame = 0;
    if (!page || page.hidden || document.hidden) return;
    if (now - lastDraw > 33) { draw(now); lastDraw = now; }   // 约 30 帧，够了
    frame = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (frame) return;
    if (reduced()) { draw(startAt + BEAT * 0.2); return; }
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
      // 摆杆、拍点（CSS）和背景（画布）从同一刻起拍
      page.classList.remove('is-playing'); void page.offsetWidth; page.classList.add('is-playing');
      startAt = performance.now();
      resize();
      startLoop();
      page.focus({preventScroll: true});
      return true;
    },
    close() {
      if (!page || page.hidden) return;
      page.hidden = true;
      page.classList.remove('is-playing');
      stopLoop();
      lastFocus?.focus?.({preventScroll: true});
    },
  };

  // 首页引导语上方的小标志：点开标志页。
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
    new MutationObserver((records) => {
      if (!isMetre()) return;
      if (records.some((r) => !(r.target instanceof Element) || !r.target.closest('.chat-thread, .pk-metre-board, .pk-metre-brand'))) queue();
    }).observe(shell, {childList: true, subtree: true});
    new MutationObserver(queue).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-laolao-startup-home']});
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && api.isOpen) { event.stopPropagation(); api.close(); } }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else if (api.isOpen) startLoop(); });
    window.addEventListener('resize', () => { if (api.isOpen) resize(); });
    queue();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();

  window.__pinkieMetreBrand = api;
})();
