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
  function placeOne(el, trigEl, kind) {
    const box = document.querySelector('.agent-chat__composer-combobox')?.getBoundingClientRect();
    const trig = trigEl?.getBoundingClientRect();
    if (!box || !trig || !trig.width) return;
    el.setAttribute('data-metre-pop', kind);
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
  window.__pinkieMetreSkin = {DECOR, apply, placePops, get on() { return applied; }};
})();
