/* laolao-metre-skin —— Metre 不用碧琪的任何视觉（PLAN R6：「不要碧琪 IP 感和视觉，页面参考 Claude，
 * 只保留输出动画和前后端运行时的可视化」；用户 11-14 重申：和 Claude 界面一样，禁止碧琪的任何素材、UI、边框）。
 *
 * 做法：进 Metre 时把碧琪纯装饰的样式表整张停用（link.disabled，不删、不改文件），离开时原样恢复，
 * 所以其他模式的样式一点不变。负责布局和运行时可视化的样式表（侧栏、输入框、过程卡、工具流、状态条、
 * 计划清单、ask_user、模型选择器、工作台……）留着，由 laolao-metre-skin.css 把它们的形状和颜色改成素净的样子。
 * 同步加载（不 defer）：在第一帧之前就停掉，不闪粉色。 */
(() => {
  'use strict';
  if (window.__pinkieMetreSkin) return;
  // 纯装饰：墙纸和玻璃（redesign）、对话分隔星（divider）、碧琪的黑夜配色（night）、小碧琪和气球（companion）、
  // 开场动画（splash）、模式转场和菜单特效、学习台和游戏（Metre 里不出现）。
  const DECOR = /\/laolao-(?:redesign|divider|night|companion|splash|mode-transition-fx|mode-menu-fx|learning-[a-z-]+|study-desk[a-z-]*|desk-[a-z-]+|game-[a-z-]+)\.css(?:\?|$)/;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  let applied = null;
  function apply() {
    const on = isMetre();
    for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) {
      if (!DECOR.test(link.getAttribute('href') || '')) continue;
      if (on && link.dataset.metreKeep === '1') continue;
      if (on && !link.disabled) { link.dataset.metreOff = '1'; link.disabled = true; }
      else if (!on && link.dataset.metreOff === '1') { link.disabled = false; delete link.dataset.metreOff; }
    }
    applied = on;
  }
  new MutationObserver(() => { if (isMetre() !== applied) apply(); })
    .observe(root, {attributes: true, attributeFilter: ['data-laolao-mode']});
  // 后加载的样式表（defer 的那批在本文件之后才插进来）也要拦住。
  // 只看 <head>（样式表都在那里），不看聊天区，避免每条消息都触发。
  new MutationObserver((records) => {
    if (!isMetre()) return;
    if (records.some((r) => [...r.addedNodes].some((n) => n.tagName === 'LINK'))) apply();
  }).observe(document.head || root, {childList: true});
  apply();
  window.addEventListener('laolao:modechange', apply);
  // 从 Metre 切回碧琪的模式时，碧琪的过场覆盖层要靠 laolao-mode-transition-fx.css 才盖得住；
  // 这张表在 Metre 里是停用的，覆盖层就在没样式的情况下“盖好了”，路由先切、浅色的学习页先露出来（11-16 真机逐帧看到）。
  // 所以切换一开始就把它放出来（它的规则全都只作用于过场覆盖层自己的类，不碰 Metre 页面），模式真的变了再按常规处理。
  const TRANSITION_FX = /\/laolao-mode-transition-fx\.css(?:\?|$)/;
  window.addEventListener('laolao:mode-transition-start', (event) => {
    if (!isMetre() || event.detail?.mode === 'metre') return;
    for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) {
      if (!TRANSITION_FX.test(link.getAttribute('href') || '')) continue;
      link.dataset.metreKeep = '1';
      if (link.dataset.metreOff === '1') { link.disabled = false; delete link.dataset.metreOff; }
    }
  });
  const releaseKeep = () => { for (const link of document.querySelectorAll('link[data-metre-keep]')) delete link.dataset.metreKeep; apply(); };
  window.addEventListener('laolao:mode-transition-finished', releaseKeep);
  window.addEventListener('laolao:modechange', () => { if (!isMetre()) releaseKeep(); });
  // 启动闪屏：第一帧之前按上次的模式先打上 data-laolao-splash-metre，Metre 就不露碧琪的闪屏
  // （样式在 laolao-metre-brand.css；laolao-splash.js 算准模式后会再改，闪屏走了就拿掉）。
  try {
    const url = new URL(location.href);
    const switching = url.searchParams.get('laolao-switch') === '1' || sessionStorage.getItem('laolao:skip-entry-splash') === '1';
    let handoff = null;
    try { handoff = JSON.parse(sessionStorage.getItem('laolao:mode-handoff') || 'null'); } catch {}
    const agent = /^agent:([a-z]+):/.exec(url.searchParams.get('session') || '')?.[1];
    const guess = (switching && handoff?.mode) || (agent ? (agent === 'main' ? 'chat' : agent) : localStorage.getItem('laolao:active-mode'));
    if (guess === 'metre') root.setAttribute('data-laolao-splash-metre', '');
  } catch {}

  /* ---------- 弹层的位置（11-16）：输入框那一带的弹层一律不许盖住输入框 ----------
   * 触发键在输入框下面那一排的（模型 / 强度、极致思考、上下文圈）：下面放得下就往下弹，放不下就弹到输入框上沿之上；
   * 触发键在输入框里面的（工具箱）：弹到输入框上沿之上，上面不够再往下。
   * 各自的脚本会反复写行内 top / left，所以这里只把量好的位置写进 CSS 变量，由 laolao-metre-skin.css 里
   * [data-metre-pop] 那条规则（!important）接管；离开 Metre 时把标记拿掉，其他模式的位置不变。 */
  const POPS = [
    {sel: '.laolao-deep-think-menu', trig: '.laolao-deep-think-btn', kind: 'row'},
    {sel: 'details.chat-controls__model[open] > .chat-controls__inline-select-menu--combined', trig: '.chat-composer-model-control', kind: 'row'},
    {sel: 'details.laolao-context-viewer[open] > .laolao-context-viewer__popover, body > .laolao-context-viewer__popover.is-floating', trig: '.laolao-context-viewer > summary', kind: 'row'},
    {sel: 'body > .pinkie-tray', trig: '.pinkie-tray-btn', kind: 'inside'},
  ];
  const GAP = 8, EDGE = 12;
  // A popup can grow after it opened (the model list switches to “全部” and loads 170+ rows).
  // Re-place it whenever its own size changes, or it keeps the old, shorter position and runs off-screen.
  const sizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => queuePops()) : null;
  const sizeWatched = new WeakSet();
  function placeOne(el, trigEl, kind) {
    const box = document.querySelector('.agent-chat__composer-combobox')?.getBoundingClientRect();
    const trig = trigEl?.getBoundingClientRect();
    if (!box || !trig || !trig.width) return;
    el.setAttribute('data-metre-pop', kind);
    if (sizeWatch && !sizeWatched.has(el)) { sizeWatched.add(el); sizeWatch.observe(el); }
    el.style.setProperty('--mp-top', '0px'); el.style.setProperty('--mp-left', '0px'); el.style.setProperty('--mp-max', 'none');
    const zero = el.getBoundingClientRect();                      // top:0 left:0 时它落在视口哪里（包含块可能是带 transform 的祖先）
    const w = zero.width, h = zero.height;
    const rowBottom = Math.max(box.bottom, kind === 'row' ? trig.bottom : box.bottom + 46);
    const below = window.innerHeight - EDGE - (rowBottom + GAP), above = box.top - GAP - EDGE;
    let down = kind === 'row' ? (h <= below || (h > above && below >= above)) : !(h <= above || above >= below);
    const room = down ? below : above;
    const hh = Math.min(h, room);
    const top = down ? rowBottom + GAP : box.top - GAP - hh;
    let left = trig.left + trig.width / 2 > box.left + box.width / 2 ? trig.right - w : trig.left;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - w));
    el.style.setProperty('--mp-top', Math.round(top - zero.top) + 'px');
    el.style.setProperty('--mp-left', Math.round(left - zero.left) + 'px');
    el.style.setProperty('--mp-max', h > room ? Math.floor(room) + 'px' : 'none');
    el.setAttribute('data-metre-pop-dir', down ? 'down' : 'up');
  }
  function placePops() {
    if (!isMetre()) { document.querySelectorAll('[data-metre-pop]').forEach((el) => { el.removeAttribute('data-metre-pop'); el.removeAttribute('data-metre-pop-dir'); }); return; }
    // 上游自带的英文读屏名（别改上游文件，在这里换成中文）
    for (const b of document.querySelectorAll('.callout__dismiss[aria-label="Dismiss error"]')) b.setAttribute('aria-label', '关闭');
    for (const {sel, trig, kind} of POPS) for (const el of document.querySelectorAll(sel)) {
      if (el.hidden || !el.getClientRects().length) continue;
      placeOne(el, document.querySelector(trig), kind);
    }
  }
  let popQueued = false;
  const queuePops = () => { if (popQueued) return; popQueued = true; requestAnimationFrame(() => { popQueued = false; placePops(); setTimeout(placePops, 140); }); };
  const bootPops = () => {
    new MutationObserver(queuePops).observe(document.body, {childList: true});
    const chat = () => document.querySelector('section.card.chat');
    let watched = null;
    const watchChat = () => { const c = chat(); if (c && c !== watched) { watched = c; new MutationObserver(queuePops).observe(c, {childList: true}); } };
    watchChat(); document.addEventListener('click', watchChat, true);
    document.addEventListener('toggle', queuePops, true);
    document.addEventListener('click', queuePops, true);
    document.addEventListener('keyup', queuePops, true);
    window.addEventListener('resize', queuePops);
  };
  if (document.body) bootPops(); else document.addEventListener('DOMContentLoaded', bootPops, {once: true});
  window.addEventListener('laolao:modechange', queuePops);
  /* ---------- 思考强度 = 速度记号（11-16 夜，用户：「思考滑块太过简陋」）----------
   * Metre 里思考强度读成节拍器上的速度：想得越多，拍子越慢、越沉。档位名照旧（High、XHigh……）跟在后面一行小字。
   * Adaptive 对 Rubato（自由速度，随内容伸缩）。只写 data 属性，文字本身仍归 laolao-model-picker.js 管，样式在 laolao-metre-skin.css。 */
  const TEMPO = {off: ['Prestissimo', 208], minimal: ['Presto', 184], low: ['Allegro', 132], medium: ['Moderato', 108], high: ['Andante', 88],
    xhigh: ['Adagio', 66], adaptive: ['Rubato', 0], max: ['Lento', 52], ultra: ['Grave', 40]};
  const LEVEL_OF = {'关闭': 'off', off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', adaptive: 'adaptive', max: 'max', ultra: 'ultra'};
  function tempoOf(text) {
    const level = LEVEL_OF[String(text || '').trim().toLowerCase()] || LEVEL_OF[String(text || '').trim()];
    return level ? {level, name: TEMPO[level][0], bpm: TEMPO[level][1]} : null;
  }
  const tempoWatched = new WeakSet();
  function syncTempo(el) {
    const t = tempoOf(el.textContent);
    if (!t) { el.removeAttribute('data-metre-tempo'); return; }
    const meta = `${t.bpm ? '♩ = ' + t.bpm : '♩ ≈'} · ${el.textContent.trim()}`;
    if (el.getAttribute('data-metre-tempo') !== t.name) el.setAttribute('data-metre-tempo', t.name);
    if (el.getAttribute('data-metre-meta') !== meta) el.setAttribute('data-metre-meta', meta);
  }
  function watchTempo() {
    for (const el of document.querySelectorAll('.pinkie-reasoning-current, .pinkie-effort-trigger .pinkie-external-tier')) {
      syncTempo(el);
      if (tempoWatched.has(el)) continue;
      tempoWatched.add(el);
      new MutationObserver(() => syncTempo(el)).observe(el, {childList: true, characterData: true, subtree: true});
    }
  }
  document.addEventListener('toggle', watchTempo, true);
  document.addEventListener('click', () => setTimeout(watchTempo, 0), true);
  window.addEventListener('laolao:modechange', watchTempo);
  if (document.readyState !== 'loading') setTimeout(watchTempo, 0); else document.addEventListener('DOMContentLoaded', watchTempo, {once: true});

  /* ---------- 悬停不再重复按钮上已经写着的字（11-16 夜，用户：「鼠标靠近显示重复按键介绍，这个没有必要」）----------
   * Metre 里：按钮 / 链接上已经完整显示了文字的，悬停时不弹原生 title 提示（指针进来时先收起 title，出去再放回，
   * 不改别的脚本写的属性，所以它们照常工作）；文字被截断的、只有图标的，照旧有提示。侧栏自己的提示在 laolao-sidebar.js 里同样判断。 */
  function showsItsText(el) {
    const text = String(el.textContent || '').replace(/\s+/g, '');
    if (!text) return false;
    return ![el, ...el.querySelectorAll('*')].some((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'visible');
  }
  let parked = null;
  document.addEventListener('pointerover', (event) => {
    if (!isMetre()) return;
    const el = event.target?.closest?.('[title]');
    if (!el || el === parked || el.tagName === 'CANVAS' || !showsItsText(el)) return;
    if (parked && parked.isConnected && parked.dataset.metreTitle != null) { parked.setAttribute('title', parked.dataset.metreTitle); delete parked.dataset.metreTitle; }
    parked = el; el.dataset.metreTitle = el.getAttribute('title'); el.removeAttribute('title');
  }, true);
  document.addEventListener('pointerout', (event) => {
    if (!parked || parked.contains(event.relatedTarget)) return;
    if (parked.dataset.metreTitle != null && !parked.hasAttribute('title')) parked.setAttribute('title', parked.dataset.metreTitle);
    delete parked.dataset.metreTitle; parked = null;
  }, true);
  window.__pinkieMetreShowsText = showsItsText;

  window.__pinkieMetreSkin = {DECOR, apply, placePops, tempoOf, get on() { return applied; }};
})();
