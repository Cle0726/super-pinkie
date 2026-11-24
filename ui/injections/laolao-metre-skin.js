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
      window.Pinkie?.domWatch?.createObserver(() => syncTempo(el))?.watch(el, {childList: true, characterData: true});
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

// ---- Metre 里不出现「碧琪」：设置、工作台、链接预览等共用界面的措辞 ----
// 这些界面所有模式共用，源码里写的是碧琪。在 Metre 里就地换成 Metre 的说法，离开时原样换回；
// 只看这几个界面的根节点，不碰聊天内容。只在 Metre 里挂观察器，空闲时没有开销。
(() => {
  'use strict';
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const SCOPE = '#laolao-user-settings, #pinkie-schedules, #pinkie-connectors, #pinkie-model-setup, .pk-wb, #laolao-link-viewer, openclaw-config-page';
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-pinkie-tooltip'];
  // 先处理说的是别的模式或产品本身的句子（碧琪就是那些模式，去掉称呼即可），最后才把助手的称呼换成 Metre。
  const RULES = [
    [/超[級级]碧琪/g, 'Metre'],
    [/碧琪的常用设置/g, '常用设置'],
    [/碧琪工作台/g, '工作台'],
    [/碧琪的链接预览/g, '链接预览'],
    [/碧琪的?回收站/g, '回收站'],
    [/碧琪经典/g, '经典'],
    [/由碧琪自动选择/g, '自动选择'],
    [/这台碧琪/g, '这台电脑'],
    [/连接碧琪(?=[^，。]*模式)/g, '连接'],
    [/，碧琪用(?=[^，。]*模式)/g, '，用'],
    [/(还没|暂时没有)连上碧琪/g, '$1连上后台'],
    [/，碧琪照常可用/g, '，照常可用'],
    [/用哪个模式的碧琪/g, '用哪个模式'],
    [/碧琪/g, 'Metre'],
  ]; const LINKS = {'Configure →': '设置 →', 'Manage →': '管理 →', 'Browse →': '浏览 →', 'Connect →': '连接 →'}; const hit = (v) => v.includes('碧琪') || Object.hasOwn(LINKS, v.trim());
  const word = (text) => {
    if (text && Object.hasOwn(LINKS, text.trim())) return text.replace(text.trim(), LINKS[text.trim()]);   // 11-24 ui2 缺陷 5：原生设置页写死的英文链接键
    if (!text || !text.includes('碧琪')) return text;
    let out = text;
    for (const [pattern, to] of RULES) out = out.replace(pattern, to);
    return out.replace(/她/g, '它');
  };
  // 记下换过的地方：节点 → {原文, 换后}；离开 Metre 时只还原没被模块重新写过的。
  const texts = new Map();
  const attrs = new Map();
  function rewriteText(node) {
    const value = node.nodeValue;
    const next = word(value);
    if (next === value) return;
    texts.set(node, {original: value, rewritten: next});
    node.nodeValue = next;
  }
  function rewriteAttrs(el) {
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      const next = word(value);
      if (next === value) continue;
      let saved = attrs.get(el);
      if (!saved) attrs.set(el, saved = {});
      saved[name] = {original: value, rewritten: next};
      el.setAttribute(name, next);
    }
  }
  function rewrite(scope) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) if (hit(node.nodeValue)) rewriteText(node);
    rewriteAttrs(scope);
    for (const el of scope.querySelectorAll('[title],[aria-label],[placeholder],[alt],[data-pinkie-tooltip]')) rewriteAttrs(el);
  }
  const watched = new Map();
  function onChange(records) {
    for (const record of records) {
      if (record.type === 'characterData') { if (hit(record.target.nodeValue)) rewriteText(record.target); }
      else if (record.type === 'attributes') rewriteAttrs(record.target);
      else for (const node of record.addedNodes) {
        if (node.nodeType === 3) { if (hit(node.nodeValue)) rewriteText(node); }
        else if (node.nodeType === 1) rewrite(node);
      }
    }
  }
  function attach() {
    if (!isMetre()) return;
    for (const scope of document.querySelectorAll(SCOPE)) {
      if (watched.has(scope)) continue;
      rewrite(scope);
      const observer = window.Pinkie?.domWatch?.createObserver(onChange);
      observer?.watch(scope, {childList: true, characterData: true, attributes: true, attributeFilter: ATTRS});
      watched.set(scope, observer);
    }
    titleOn();
  }
  function detach() {
    for (const observer of watched.values()) observer.disconnect();
    watched.clear();
    for (const [node, {original, rewritten}] of texts) if (node.nodeValue === rewritten) node.nodeValue = original;
    for (const [el, saved] of attrs) for (const [name, {original, rewritten}] of Object.entries(saved)) if (el.getAttribute(name) === rewritten) el.setAttribute(name, original);
    texts.clear(); attrs.clear();
    titleOff();
  }
  // 窗口 / 标签页标题：Metre 里叫 Metre（保留跑完提示的 ✓ ! ? 前缀）。
  let titleObserver = null;
  const titleWord = (title) => title.replace(/超[級级]碧琪|碧琪/g, 'Metre');
  function fixTitle() { const next = titleWord(document.title); if (next !== document.title) document.title = next; }
  function titleOn() {
    fixTitle();
    const el = document.querySelector('title');
    if (el && !titleObserver) { titleObserver = window.Pinkie?.domWatch?.createObserver(fixTitle); titleObserver?.watch(el, {childList: true, characterData: true}); }
  }
  function titleOff() {
    titleObserver?.disconnect(); titleObserver = null;
    if (/Metre$/.test(document.title)) document.title = document.title.replace(/Metre$/, '超級碧琪');
  }
  const sync = () => (isMetre() ? attach() : detach());
  new MutationObserver(sync).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode']});
  window.addEventListener('laolao:modechange', sync);
  // 设置页、工作台、链接预览都是点出来的：点完再找一次新出现的根节点。
  document.addEventListener('click', () => { if (isMetre()) for (const ms of [0, 250, 700]) setTimeout(attach, ms); }, true);   // 原生设置页点完约 170ms 才出来
  window.addEventListener('popstate', () => { if (isMetre()) setTimeout(attach, 0); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, {once: true}); else sync();
  window.__pinkieMetreWords = {word, attach, detach};
})();
