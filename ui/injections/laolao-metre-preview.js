/* laolao-metre-preview —— R4：Metre 里「预览本地服务」（11-24）。
 *
 * 代理在这一轮里起了开发服务（工具输出里出现 http://localhost:5173 这类地址），回答下面列一行「预览」签条，
 * 点了交给碧琪自己的浏览器打开（Mac 侧栏浏览器 / Windows 应用内浏览器；都没有就新标签页）。
 * OpenClaw 原生没有网页预览（原生工作区侧栏的「浏览器」是文件浏览器），所以这里不是露出原生部件，而是复用碧琪的浏览器。
 * 只读本会话历史里的工具结果文本：不探测端口、不发请求、不加定时器；不自动打开。
 * 不出签：18789（正式网关）和当前页面自己的地址。离开 Metre 时整行拿掉，其他模式一个字不动。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metrePreview) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  // 和 laolao-session-tools.js 判断「这一轮从哪条用户消息开始」同一条规则。
  const INTERNAL = /^\s*(?:【子会话简报】|【来自关联会话的消息】|【就在这里继续】|NO_REPLY\s*$|HEARTBEAT_OK\s*$|\[Pinkie|\[CLE|<\w+-context)/u;
  const MAX = 3;
  const BLOCKED_PORTS = new Set(['18789']);
  const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{1,5})?(?:\/[^\s"'`<>()\[\]{}\\]*)?/gi;
  const SERVING_RE = /\bServing HTTP on (?:0\.0\.0\.0|127\.0\.0\.1|::|localhost) port (\d{1,5})\b/gi;
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const pane = () => document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
  const textOf = item => {
    const content = item?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return typeof item?.text === 'string' ? item.text : '';
    return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  };

  // ---------- 认地址 ----------
  function normalize(raw) {
    let parsed;
    try { parsed = new URL(raw.replace(/[.,;:!?。，；：]+$/u, '')); } catch { return null; }
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (Number(port) < 1 || Number(port) > 65535 || BLOCKED_PORTS.has(port)) return null;
    if (parsed.hostname === '0.0.0.0' || parsed.hostname === '[::]') parsed.hostname = '127.0.0.1';
    // 碧琪自己的界面（预览页、网关页）也在本机某个端口上，那个地址不出签。
    const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
    if (LOOPBACK.test(location.hostname) && LOOPBACK.test(parsed.hostname) && parsed.port === location.port) return null;
    parsed.hash = '';
    return parsed;
  }
  const found = new WeakMap();   // 历史条目不变，解析一次就够
  function fromResult(item) {
    if (found.has(item)) return found.get(item);
    const text = textOf(item).replace(/\u001b\[[0-9;]*m/g, '');
    const list = [];
    const push = parsed => { if (parsed && !list.some(u => u.href === parsed.href)) list.push(parsed); };
    for (const match of text.matchAll(URL_RE)) push(normalize(match[0]));
    for (const match of text.matchAll(SERVING_RE)) push(normalize(`http://127.0.0.1:${match[1]}/`));
    found.set(item, list);
    return list;
  }
  function urlsFor(history, index) {
    let start = index;
    for (; start > 0; start--) {
      const item = history[start - 1];
      if (item?.role === 'user' && textOf(item).trim() && !INTERNAL.test(textOf(item))) break;
    }
    const urls = [];
    for (let i = start; i <= index; i++) {
      const item = history[i];
      if (!/^toolresult$/i.test(String(item?.role || ''))) continue;
      for (const url of fromResult(item)) if (!urls.some(u => u.href === url.href)) urls.push(url);
    }
    return urls.slice(0, MAX);
  }
  const label = url => url.host + (url.pathname === '/' ? '' : url.pathname) + url.search;

  // ---------- 预览行 ----------
  function groupIndex(group, history) {
    const last = [...group.querySelectorAll('.chat-bubble[data-message-id]')].at(-1);
    const item = last ? window.__pinkieMessageActions?.historyItem?.(last.dataset.messageId, history) : null;
    return item ? history.indexOf(item) : -1;
  }
  function buildRow(urls) {
    const row = el('div', 'pk-mprev-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', '预览本地服务');
    row.append(el('span', 'pk-mprev-row__label', '预览'));
    for (const url of urls) {
      const chip = el('a', 'pk-mprev-chip');
      chip.href = url.href;
      chip.title = `在碧琪的浏览器里打开 ${url.href}`;
      chip.append(el('span', 'pk-mprev-chip__dot'), el('span', 'pk-mprev-chip__text', label(url)));
      row.append(chip);
    }
    return row;
  }
  function paint() {
    const p = pane();
    const history = p?.state?.chatMessages;
    if (!Array.isArray(history) || !history.length) return;
    for (const group of p.querySelectorAll('.chat-group.assistant')) {
      const index = groupIndex(group, history);
      const urls = index < 0 ? [] : urlsFor(history, index);
      const old = group.querySelector(':scope > .pk-mprev-row');
      const signature = urls.map(u => u.href).join('|');
      if (!urls.length) { old?.remove(); continue; }
      if (old?.dataset.pkPreview === signature) continue;
      const row = buildRow(urls);
      row.dataset.pkPreview = signature;
      if (old) { old.replaceWith(row); continue; }
      const footer = group.querySelector(':scope > .chat-group-footer');
      if (footer) footer.before(row); else group.append(row);
    }
  }
  const restore = () => { for (const row of document.querySelectorAll('.pk-mprev-row')) row.remove(); };

  // ---------- 打开：和 laolao-link-viewer.js 同一条路 ----------
  function openUrl(url) {
    const mac = window.webkit?.messageHandlers?.laolaoBrowserWorkspace;
    if (mac) { mac.postMessage({action: 'open', url}); return 'app-browser'; }
    const api = window.pywebview?.api;
    if (root.dataset.pinkiePlatform === 'windows') {
      if (typeof api?.browser_workspace === 'function') { api.browser_workspace({action: 'open', url}); return 'app-browser'; }
      if (typeof api?.open_external === 'function') { api.open_external(url); return 'system-browser'; }
    }
    window.open(url, '_blank', 'noopener');
    return 'tab';
  }
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !isMetre()) return;
    const chip = event.target.closest?.('.pk-mprev-chip[href]');
    if (!chip) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openUrl(chip.href);
  }, true);

  // ---------- 什么时候重画 ----------
  let frame = 0;
  const tick = () => {
    frame = 0;
    if (isMetre()) paint();
    else if (document.querySelector('.pk-mprev-row')) restore();
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(tick); };
  window.Pinkie?.domWatch?.watch('.chat-group.assistant', schedule, {immediate: true});
  window.addEventListener('laolao:modechange', schedule);
  window.addEventListener('pinkie:session-selected', schedule);

  ns.metrePreview = Object.freeze({urlsFor, paint: schedule, openUrl});
})();
