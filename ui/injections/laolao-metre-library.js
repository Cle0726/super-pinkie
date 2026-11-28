/* laolao-metre-library —— R5 ③：作品库「在工作台打开」+ 工作台不在时的只读预览面板（11-26，设计稿 docs/redesign/R5-FILE-PREVIEW-EDIT.md 第二节 1、3、4）。
 *
 * 作品库 = 产出物和它的版本（快照）；工作台 = 磁盘上的现在。这里只加一个入口，不复制查看器：
 *   - 作品库查看器（pinkie:art-viewer 事件，和 laolao-desktop-apps.js 同一个口子）里，路径在当前项目文件夹里的文本类作品（md / csv / txt）
 *     多一个「在工作台打开」。打开的是磁盘上的原文件，不是作品库里的某个快照；查看器停在旧版本时键上写「打开当前文件（作品库里看的是第 N 版）」。
 *     图片 / PDF / HTML 仍走作品库自己的查看器，不出这个键。
 *   - 工作台出不来（窗口 < 600、不在 /chat、开着分屏）时，不硬挤出来，改开只读预览面板：文本只显示前 256 KB（pinkie.fs.read 的 maxBytes），
 *     图片内联，其他（二进制、太大）说一句并给「用系统默认程序打开」的去处说明。
 *   - 用户在工作台存了作品库里的文件，作品库不会自动记一版（artifacts.mjs 只在代理的改文件工具后和「恢复」时记），这里不改，写在 PR 里给协调者定。
 * 只在 Metre 生效；不加观察器、定时器、window 全局名。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreLibrary) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const TEXT = /\.(?:md|markdown|csv|txt)$/i;
  const PREVIEW_BYTES = 256 * 1024;
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const pane = () => document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
  const sessionNow = () => pane()?.state?.sessionKey || new URLSearchParams(location.search).get('session') || '';
  const request = (method, params, timeout = 20000) => {
    const gw = window.__laolaoSidebar?.gwRequest;
    return typeof gw === 'function' ? gw(method, {sessionKey: sessionNow(), ...params}, timeout) : Promise.reject(new Error('还没连上网关'));
  };
  // 路径比较：反斜杠换成 /，Windows 盘符路径不分大小写
  const norm = p => { const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:\//i.test(s) ? s.toLowerCase() : s; };
  const insideRoot = (file, dir) => { const f = norm(file), d = norm(dir); return Boolean(d) && f.startsWith(d + '/'); };

  // ---------- 项目根：工作台读到了就用它的，没读到就问一次（按会话缓存） ----------
  const roots = new Map();
  async function projectRoot() {
    const bench = window.__pinkieWorkbench;
    if (bench?.state?.info?.root && bench.state.key === sessionNow()) return bench.state.info.root;
    const key = sessionNow();
    if (!roots.has(key)) roots.set(key, request('pinkie.fs.status', {}).then(r => r?.root || '').catch(() => ''));
    return roots.get(key);
  }

  // ---------- 只读预览面板 ----------
  let panel = null, returnFocus = null;
  function closePanel() {
    if (!panel) return;
    panel.remove(); panel = null;
    window.removeEventListener('keydown', onPanelKey, true);
    returnFocus?.focus?.(); returnFocus = null;
  }
  // 挂在 window 捕获阶段：比作品库查看器挂在 document 上的 Esc 先跑，一次 Esc 只关预览，不连查看器一起关
  function onPanelKey(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePanel(); } }
  // opener：谁打开的就回到谁。WebKit / WKWebView 鼠标点按钮不给焦点，document.activeElement 那时是 body（B63）
  async function openPreview(path, opener) {
    closePanel();
    returnFocus = opener || document.activeElement;
    panel = el('div', 'pk-mlib-preview');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const name = String(path).split(/[\\/]/).filter(Boolean).pop() || String(path);
    panel.setAttribute('aria-label', name + ' 只读预览');
    const box = el('section', 'pk-mlib-preview__box');
    const head = el('header', 'pk-mlib-preview__head');
    const title = el('strong', 'pk-mlib-preview__title', name);
    title.title = path;
    const tag = el('span', 'pk-mlib-preview__tag', '当前文件 · 只读');   // 背后的查看器可能停在旧版本：写明这是磁盘上的现在
    const close = el('button', 'pk-mlib-preview__close', '×');
    close.type = 'button'; close.setAttribute('aria-label', '关闭预览'); close.addEventListener('click', closePanel);
    head.append(title, tag, close);
    const body = el('div', 'pk-mlib-preview__body');
    const note = el('p', 'pk-mlib-preview__note', '正在读…');
    note.setAttribute('role', 'status');
    box.append(head, note, body);
    panel.append(box);
    panel.addEventListener('click', event => { if (event.target === panel) closePanel(); });
    document.body.append(panel);
    window.addEventListener('keydown', onPanelKey, true);
    close.focus();
    const mine = panel;
    let result;
    try { result = await request('pinkie.fs.read', {path, maxBytes: PREVIEW_BYTES}, 30000); }
    catch (error) { if (panel === mine) note.textContent = '读不到这个文件：' + (error.message || '不知道为什么'); return 'error'; }
    if (panel !== mine) return 'closed';
    if (result?.kind === 'text') {
      const pre = el('pre', 'pk-mlib-preview__text', result.content || '');
      pre.tabIndex = 0;
      body.append(pre);
      note.textContent = result.truncated ? '只显示前 256 KB，完整内容请在工作台或系统程序里打开' : '';
      note.hidden = !result.truncated;
      return result.truncated ? 'text-truncated' : 'text';
    }
    if (result?.kind === 'image' && result.dataUrl) {
      const img = el('img', 'pk-mlib-preview__image'); img.src = result.dataUrl; img.alt = name;
      body.append(img); note.hidden = true;
      return 'image';
    }
    note.textContent = result?.kind === 'too-large' ? '文件太大，这里不预览；请用系统默认程序打开' : '这不是文本或图片，这里不预览；请用系统默认程序打开';
    return result?.kind || 'other';
  }

  // ---------- 打开：工作台在就开标签，不在就只读预览 ----------
  async function openInBench(path, opener) {
    const bench = window.__pinkieWorkbench;
    if (bench && typeof bench.show === 'function' && (await bench.show())) {
      const slash = String(path).replace(/\\/g, '/');   // 只换斜杠，大小写原样（norm 的小写只用来比较）
      await bench.open(bench.rel ? bench.rel(slash) : slash, {pinned: true});
      return 'bench';
    }
    return openPreview(path, opener).then(() => 'preview');
  }

  // ---------- 作品库查看器里的键 ----------
  // 查看器停在旧版本时返回版本序号，否则 0
  function oldVersion(viewer) {
    const m = /版本\s*(\d+)\s*\/\s*(\d+)/.exec(viewer?.querySelector('.pinkie-art-versions__label')?.textContent || '');
    return m && Number(m[1]) < Number(m[2]) ? Number(m[1]) : 0;
  }
  // 键上只放短字（窄窗口也放得下）；看的是哪一版写在左边的说明里，完整说法留在 aria-label
  function paintStrip(strip, key, view) {
    const v = oldVersion(view);
    key.textContent = v ? '打开当前文件' : '在工作台打开';
    key.setAttribute('aria-label', v ? `打开当前文件（作品库里看的是第 ${v} 版）` : '在工作台打开');
    strip.querySelector('.pk-mlib-strip__note').textContent = v
      ? `作品库里看的是第 ${v} 版；磁盘上的文件可能已经改过`
      : '这个文件在当前项目里，可以在工作台里看、改';
  }
  window.addEventListener('pinkie:art-viewer', event => {
    const {item, actions} = event.detail || {};
    if (!isMetre() || !item?.path || !actions || !TEXT.test(item.path)) return;
    void projectRoot().then(dir => {
      const view = actions.closest('.pinkie-art-view');
      const head = actions.parentElement;
      if (!insideRoot(item.path, dir) || !actions.isConnected || !view || !head || view.querySelector('.pk-mlib-strip')) return;
      // 不往查看器头部塞键：头部 820 时就满了，再塞 × 会被挤出纸面。单起一条，放在头部下面
      const strip = el('div', 'pk-mlib-strip');
      const note = el('span', 'pk-mlib-strip__note');
      const key = el('button', 'pk-mlib-open');   // 不挂 pinkie-art-btn：Metre 皮肤会把它压成灰字描边，主键自带样式
      key.type = 'button';
      key.dataset.path = item.path;
      key.title = '打开的是磁盘上的当前文件，不是作品库里的快照';
      strip.append(note, key);
      const relabel = () => paintStrip(strip, key, view);
      relabel();
      // 工作台出来了就收起查看器（全屏遮罩会盖住工作台）；走查看器自己的「点遮罩关闭」，让它的 finish() 收掉 Esc 监听
      key.addEventListener('click', () => void openInBench(item.path, key).then(where => {
        const mask = actions.closest('.pinkie-art-viewer');
        if (where === 'bench' && mask?.isConnected) mask.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
      }));
      head.after(strip);
      // 换版本（‹ ›、左右键、恢复）后说明和键跟着改
      const viewer = actions.closest('.pinkie-art-viewer');
      viewer?.addEventListener('click', () => requestAnimationFrame(relabel));
      viewer?.addEventListener('keyup', () => requestAnimationFrame(relabel));
    });
  });

  ns.metreLibrary = Object.freeze({openInBench, openPreview, closePanel, insideRoot});
})();
