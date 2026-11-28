/* laolao-metre-find —— 界面计划 T3 #3「会话内查找」（L19，linux2，11-27），只在 Metre 生效。
 * 原生 Ctrl/⌘+F（chat-page 里 section.card.chat 的 keydown）切的是「过滤消息」搜索条：没命中的消息整条藏掉，
 * 没有高亮、没有上一条 / 下一条和 n/m 计数，输入框里按 Esc 不关，焦点不在对话区时快捷键不生效。
 * Metre 下换成浏览器式的查找条：
 *   Ctrl+F（Mac ⌘F）在页面任意处唤出（工作台编辑器里不抢，Monaco 有自己的查找）；已开着再按就选中输入框里的字。
 *   命中用 CSS Custom Highlight API 高亮（不改消息 DOM、不往消息里加节点），当前那条换一种颜色并滚到视口中间；
 *   Enter 下一条、Shift+Enter 上一条，到头回绕；Esc 或 × 关闭、清掉高亮、焦点还回去；
 *   没有命中时计数位写「无匹配」（role=status，读屏会播报）。
 * 只查对话区已经画出来的消息正文（.chat-thread .chat-text）；更早的历史要先点顶上的「更早的消息」载入。
 * 内容变了（回答流进来、换会话）跟着 laolao-run-status 发的 pinkie:run-view / pinkie:session-selected 重算，
 * 不自己开定时器、DOM 观察器，不加 window.__ 全局名；对外只挂 window.Pinkie.metreFind。
 * 其他五个模式一个字不动：不拦按键、不建节点，原生过滤搜索照旧。样式在 laolao-metre-find.css。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreFind) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const THREAD = '.chat-thread';
  const SCOPE = '.chat-thread .chat-text';
  const BAR = '.pk-metre-find';
  const EDITOR = '.monaco-editor, .monaco-diff-editor, .cm-editor, .pk-wb, .pk-wb-host, [data-workbench-editor]';
  const HL = 'pk-metre-find';
  const HL_CUR = 'pk-metre-find-current';
  const MAX = 1000;   // 再多就只标前 1000 处，计数写成「n/1000+」
  const SKIP = /^(SCRIPT|STYLE|TEMPLATE)$/;
  const svg = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON = Object.freeze({prev: svg('M4 10l4-4 4 4'), next: svg('M4 6l4 4 4-4'), close: svg('M4.5 4.5l7 7M11.5 4.5l-7 7')});

  // ---------- 纯函数：text 里 query 出现的位置（不分大小写、不重叠），[[起, 止), …] ----------
  // 转小写后长度变了（个别字母）就退回原样比，免得位置对不上。
  const fold = (s) => { const low = s.toLowerCase(); return low.length === s.length ? low : s; };
  function positions(text, query) {
    const q = fold(String(query ?? ''));
    const out = [];
    if (!q.trim()) return out;
    const hay = fold(String(text ?? ''));
    for (let at = hay.indexOf(q); at >= 0 && out.length < MAX; at = hay.indexOf(q, at + q.length)) out.push([at, at + q.length]);
    return out;
  }

  // ---------- 在对话区里找：每块正文的文本节点连起来找，命中可以跨节点（**粗体**、`代码` 拆开的字也算） ----------
  function textNodes(node, out = []) {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) { if (child.data) out.push(child); }
      else if (child.nodeType === 1 && !SKIP.test(child.tagName || '')) textNodes(child, out);
    }
    return out;
  }
  function collect(q) {
    const found = [];
    for (const block of document.querySelectorAll(SCOPE)) {
      const nodes = textNodes(block);
      if (!nodes.length) continue;
      const starts = [];
      let text = '';
      for (const n of nodes) { starts.push(text.length); text += n.data; }
      // 起点落在「从它开始」的节点里；终点可以停在前一个节点的末尾。
      const at = (pos, end) => {
        let i = nodes.length - 1;
        while (i > 0 && (end ? starts[i] >= pos : starts[i] > pos)) i -= 1;
        return [nodes[i], pos - starts[i]];
      };
      for (const [s, e] of positions(text, q)) {
        if (found.length >= MAX) return found;
        const range = document.createRange();
        range.setStart(...at(s, false));
        range.setEnd(...at(e, true));
        found.push(range);
      }
    }
    return found;
  }

  // ---------- 状态与画面 ----------
  let bar = null, input = null, count = null, prevBtn = null, nextBtn = null;
  let matches = [], current = -1, query = '', returnTo = null, frame = 0;

  const registry = () => (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function' ? CSS.highlights : null);
  function clearMarks() { const reg = registry(); reg?.delete(HL); reg?.delete(HL_CUR); }
  function paint() {
    const reg = registry();
    const hit = matches[current] || null;
    if (reg) {
      const rest = matches.filter((_, i) => i !== current);
      if (rest.length) reg.set(HL, new Highlight(...rest)); else reg.delete(HL);
      if (hit) reg.set(HL_CUR, new Highlight(hit)); else reg.delete(HL_CUR);
    } else if (hit) {
      // 没有 Highlight API 的老内核：至少把当前那条选中，看得见在哪。
      try { const sel = window.getSelection?.(); sel?.removeAllRanges?.(); sel?.addRange?.(hit); } catch {}
    }
    if (!bar) return;
    const has = matches.length > 0, asked = Boolean(query.trim());
    count.textContent = has ? `${current + 1}/${matches.length}${matches.length >= MAX ? '+' : ''}` : asked ? '无匹配' : '';
    bar.dataset.state = has ? 'hit' : asked ? 'none' : '';
    prevBtn.disabled = !has;
    nextBtn.disabled = !has;
    input.setAttribute('aria-invalid', String(asked && !has));
  }
  function reveal() {
    const node = matches[current]?.startContainer;
    const host = node?.nodeType === 3 ? node.parentElement : node;
    host?.scrollIntoView?.({block: 'center', inline: 'nearest'});
  }
  // 新查一个词时从「第一处没在视口上方」的命中开始（浏览器查找也这样），不从头跳回最早那条。
  function firstVisible() {
    const top = document.querySelector(THREAD)?.getBoundingClientRect?.().top ?? 0;
    const i = matches.findIndex((r) => (r.getBoundingClientRect?.().bottom ?? 0) > top);
    return i < 0 ? 0 : i;
  }
  function run(fresh) {
    matches = query.trim() ? collect(query) : [];
    if (!matches.length) current = -1;
    else if (fresh) current = firstVisible();
    else current = Math.min(Math.max(current, 0), matches.length - 1);
    paint();
    if (fresh && current >= 0) reveal();
  }
  function step(dir) {
    if (matches.some((r) => r.startContainer && r.startContainer.isConnected === false)) run(false);   // 原生重画过，旧范围作废
    if (!matches.length) return false;
    current = (current + dir + matches.length) % matches.length;
    paint();
    reveal();
    return true;
  }

  // ---------- 查找条 ----------
  function button(act, label, icon) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pk-metre-find__btn';
    b.dataset.find = act;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    return b;
  }
  function build() {
    bar = document.createElement('div');
    bar.className = 'pk-metre-find';
    bar.hidden = true;
    bar.setAttribute('role', 'search');
    bar.setAttribute('aria-label', '在会话中查找');
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'pk-metre-find__input';
    input.placeholder = '在会话中查找';
    input.spellcheck = false;
    input.setAttribute('aria-label', '在会话中查找');
    input.setAttribute('autocomplete', 'off');
    count = document.createElement('span');
    count.className = 'pk-metre-find__count';
    count.setAttribute('role', 'status');
    count.setAttribute('aria-live', 'polite');
    prevBtn = button('prev', '上一条（Shift+Enter）', ICON.prev);
    nextBtn = button('next', '下一条（Enter）', ICON.next);
    const closeBtn = button('close', '关闭查找（Esc）', ICON.close);
    bar.append(input, count, prevBtn, nextBtn, closeBtn);
    input.addEventListener('input', () => { query = input.value; run(true); });
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229 || event.key !== 'Enter') return;
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    });
    bar.addEventListener('click', (event) => {
      const b = event.target?.closest?.('[data-find]');
      if (!b || b.disabled) return;
      event.preventDefault();
      if (b.dataset.find === 'close') { close(); return; }
      step(b.dataset.find === 'prev' ? -1 : 1);
      input.focus();
    });
    document.body.append(bar);
  }
  // 贴在对话区右上角（fixed，不进原生模板管的节点，原生重画碰不到它）。
  function place() {
    const r = document.querySelector(THREAD)?.getBoundingClientRect?.();
    if (!bar || !r) return;
    bar.style.top = Math.round(Math.max(r.top, 0) + 8) + 'px';
    bar.style.right = Math.round(Math.max((window.innerWidth || 0) - r.right, 0) + 16) + 'px';
  }
  function open() {
    if (!isMetre()) return false;
    if (!bar) build();
    if (bar.hidden) {
      const active = document.activeElement;
      returnTo = active && !active.closest?.(BAR) ? active : null;
      // 先选中了一小段字再按 Ctrl+F：拿它当查找词（浏览器也这样）。
      const picked = String(window.getSelection?.()?.toString?.() || '').trim();
      if (picked && picked.length <= 200 && !/\n/.test(picked)) input.value = picked;
      bar.hidden = false;
    }
    place();
    query = input.value;
    input.focus();
    input.select?.();
    run(true);
    return true;
  }
  function close() {
    if (!bar || bar.hidden) return false;
    bar.hidden = true;
    matches = [];
    current = -1;
    clearMarks();
    const back = returnTo;
    returnTo = null;
    if (back && back.isConnected !== false && typeof back.focus === 'function') back.focus();
    return true;
  }

  // ---------- 按键：window 捕获阶段，先于原生 section.card.chat 的过滤搜索和 laolao-sidebar 的 Esc ----------
  const isFindKey = (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.code === 'KeyF' || String(e.key || '').toLowerCase() === 'f');
  function onKey(event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && bar && !bar.hidden && event.target?.closest?.(BAR)) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!isMetre() || !isFindKey(event) || event.target?.closest?.(EDITOR) || !document.querySelector(THREAD)) return;
    event.preventDefault();
    event.stopPropagation();
    open();
  }

  const refresh = () => {
    if (!bar || bar.hidden || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!isMetre()) { close(); return; }
      place();
      run(false);
    });
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pinkie:run-view', refresh);
  window.addEventListener('pinkie:session-selected', refresh);
  window.addEventListener('laolao:modechange', () => { if (!isMetre()) close(); });
  window.addEventListener('resize', () => { if (bar && !bar.hidden) place(); });

  ns.metreFind = Object.freeze({
    HL, HL_CUR, MAX,
    positions, open, close, step,
    refresh: () => { if (bar && !bar.hidden) run(false); },
    state: () => ({open: Boolean(bar && !bar.hidden), query, total: matches.length, current, label: count ? count.textContent : ''}),
  });
})();
