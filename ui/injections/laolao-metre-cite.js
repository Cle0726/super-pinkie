/* laolao-metre-cite —— M13：Metre 里网页来源的角标和引用卡（11-24）。
 *
 * 共用的 laolao-session-tools.js 已经把回答里的 [n] 换成角标、在回答下面列出一行来源。在 Metre 里补三件事，其他模式一个字不动：
 *   1. 编号按这一轮工具结果出现的先后排。模型是照搜索结果的顺序写 [n] 的；共用模块倒着收集，
 *      同一个网址先搜到、后来又打开过一次，就被挤到最后，[1] 指到了第二条结果上（11-24 预览页复现）。
 *   2. 悬停或键盘聚焦角标 / 来源，弹一张引用卡：网站、标题、摘要。共用的悬停提示只在侧栏里画，对话里悬停什么都不出。
 *   3. 来源行换成 Metre 的样子；点了交给应用内浏览器（没有就交给系统浏览器），不再把整个页面导航到外站。
 * 只读本会话的历史（pane.state.chatMessages），不调网关、不加定时器。离开 Metre 时改过的地方原样换回。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreCite) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const WEB_TOOLS = new Set(['web_search', 'web_fetch', 'pinkie_search']);
  // 和 laolao-session-tools.js 判断「这一轮从哪条用户消息开始」用同一条规则，收到的来源集合才一样。
  const INTERNAL = /^\s*(?:【子会话简报】|【来自关联会话的消息】|【就在这里继续】|NO_REPLY\s*$|HEARTBEAT_OK\s*$|\[Pinkie|\[CLE|<\w+-context)/u;
  const MAX = 12;
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const pane = () => document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
  const clip = (value, n) => {
    const text = String(value || '').replace(/<<<[^>]*>>>/g, ' ').replace(/\s+/g, ' ').trim();
    const chars = [...text];
    return n && chars.length > n ? chars.slice(0, n - 1).join('') + '…' : text;
  };
  const textOf = item => {
    const content = item?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return typeof item?.text === 'string' ? item.text : '';
    return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  };

  // ---------- 来源：这一轮的工具结果，按出现先后，同一网址只算第一次 ----------
  const parsedResults = new WeakMap();   // 历史条目不变，解析一次就够（流式输出时每帧都会重画）
  function fromResult(item) {
    if (parsedResults.has(item)) return parsedResults.get(item);
    const found = parseResult(item);
    parsedResults.set(item, found);
    return found;
  }
  function parseResult(item) {
    const text = textOf(item);
    const found = [];
    const push = (url, title, snippet) => {
      let parsed;
      try { parsed = new URL(url); } catch { return; }
      if (!/^https?:$/.test(parsed.protocol)) return;
      const old = found.find(entry => entry.url === parsed.href);
      if (old) { old.title ||= clip(title, 160); old.snippet ||= clip(snippet, 280); return; }
      found.push({url: parsed.href, host: parsed.hostname.replace(/^www\./, ''), title: clip(title, 160), snippet: clip(snippet, 280)});
    };
    try {
      const walk = (value, depth = 0) => {
        if (!value || depth > 5) return;
        if (Array.isArray(value)) { value.forEach(entry => walk(entry, depth + 1)); return; }
        if (typeof value !== 'object') return;
        const url = value.url || value.link || value.href || value.finalUrl;
        if (typeof url === 'string') push(url, value.title || value.name, value.snippet || value.description || value.summary);
        for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, depth + 1);
      };
      walk(JSON.parse(text));
    } catch {
      for (const match of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) push(match[0], '', '');
    }
    return found;
  }
  function sourcesFor(history, index) {
    let start = index;
    for (; start > 0; start--) {
      const item = history[start - 1];
      if (item?.role === 'user' && textOf(item).trim() && !INTERNAL.test(textOf(item))) break;
    }
    const sources = [];
    for (let i = start; i <= index; i++) {
      const item = history[i];
      if (!/^toolresult$/i.test(String(item?.role || '')) || !WEB_TOOLS.has(item.toolName)) continue;
      for (const source of fromResult(item)) {
        const old = sources.find(entry => entry.url === source.url);
        if (old) { old.title ||= source.title; old.snippet ||= source.snippet; } else sources.push({...source});
      }
    }
    return sources.slice(0, MAX);
  }

  // ---------- 改角标和来源行（离开 Metre 时换回） ----------
  const groupSources = new WeakMap();
  function groupIndex(group, history) {
    const last = [...group.querySelectorAll('.chat-bubble[data-message-id]')].at(-1);
    const item = last ? window.__pinkieMessageActions?.historyItem?.(last.dataset.messageId, history) : null;
    return item ? history.indexOf(item) : -1;
  }
  function fixCite(cite, sources) {
    const n = Number(cite.dataset.pkCiteN || cite.textContent.trim());
    const source = sources[n - 1];
    if (!source) return;
    if (!cite.hasAttribute('data-pk-cite-href')) {
      cite.dataset.pkCiteHref = cite.getAttribute('href') || '';
      cite.dataset.pkCiteLabel = cite.getAttribute('aria-label') || '';
    }
    // 只在值真的变了时才写：共用观察器连属性变化也看，写同样的值也会再触发一次重画，转成死循环。
    if (cite.dataset.pkCiteN !== String(n)) cite.dataset.pkCiteN = String(n);
    if (cite.getAttribute('href') !== source.url) cite.setAttribute('href', source.url);
    const label = `来源 ${n}：${source.title ? source.title + '，' : ''}${source.host}`;
    if (cite.getAttribute('aria-label') !== label) cite.setAttribute('aria-label', label);
  }
  function buildRow(row, sources) {
    row.textContent = '';
    row.classList.add('pk-mcite-row');
    row.setAttribute('role', 'list');
    row.setAttribute('aria-label', `来源，共 ${sources.length} 处`);
    row.append(el('span', 'pinkie-sources__label pk-mcite-row__label', 'Sources'));
    sources.forEach((source, i) => {
      const chip = el('a', 'pinkie-sources__item pk-mcite-chip');
      chip.href = source.url;
      chip.setAttribute('role', 'listitem');
      chip.dataset.pkCiteN = String(i + 1);
      chip.setAttribute('aria-label', `来源 ${i + 1}：${source.title ? source.title + '，' : ''}${source.host}`);
      chip.append(el('span', 'pk-mcite-chip__n', String(i + 1)), el('span', 'pk-mcite-chip__title', source.title || source.host));
      if (source.title) chip.append(el('span', 'pk-mcite-chip__host', source.host));
      row.append(chip);
    });
  }
  function paint() {
    const p = pane();
    const history = p?.state?.chatMessages;
    if (!Array.isArray(history) || !history.length) return;
    for (const group of p.querySelectorAll('.chat-group.assistant')) {
      const row = group.querySelector('.pinkie-sources');
      const cites = group.querySelectorAll('.chat-bubble .pinkie-cite');
      if (!row && !cites.length) continue;
      const index = groupIndex(group, history);
      if (index < 0) continue;
      const sources = sourcesFor(history, index);
      if (!sources.length) continue;
      groupSources.set(group, sources);
      for (const cite of cites) fixCite(cite, sources);
      const signature = sources.map(source => source.url + '\u0001' + source.title).join('|');
      if (row && row.dataset.pkCite !== signature) { row.dataset.pkCite = signature; buildRow(row, sources); }
    }
  }
  function restore() {
    hideCard();
    for (const cite of document.querySelectorAll('.pinkie-cite[data-pk-cite-href]')) {
      cite.setAttribute('href', cite.dataset.pkCiteHref);
      if (cite.dataset.pkCiteLabel) cite.setAttribute('aria-label', cite.dataset.pkCiteLabel); else cite.removeAttribute('aria-label');
      delete cite.dataset.pkCiteHref; delete cite.dataset.pkCiteLabel; delete cite.dataset.pkCiteN;
    }
    // 来源行整行拿掉，并清掉共用模块的签名，它下一次重画时按原样重建。
    for (const row of document.querySelectorAll('.pk-mcite-row')) {
      const group = row.closest('.chat-group');
      if (group) delete group.dataset.pinkieSources;
      row.remove();
    }
  }

  // ---------- 引用卡 ----------
  let card = null, cardFor = null;
  function lookup(anchor) {
    const group = anchor.closest('.chat-group.assistant');
    const n = Number(anchor.dataset.pkCiteN || 0);
    const source = group && n ? groupSources.get(group)?.[n - 1] : null;
    return source ? {n, source} : null;
  }
  function hideCard() { card?.remove(); card = null; if (cardFor) cardFor.removeAttribute('aria-describedby'); cardFor = null; }
  function showCard(anchor) {
    if (anchor === cardFor) return;
    const info = lookup(anchor);
    hideCard();
    if (!info) return;
    const {n, source} = info;
    card = el('div', 'pk-mcite-card');
    card.id = 'pk-mcite-card';
    card.setAttribute('role', 'tooltip');
    if (reduced()) card.dataset.still = '1';
    const head = el('div', 'pk-mcite-card__head');
    head.append(el('span', 'pk-mcite-card__n', String(n)), el('span', 'pk-mcite-card__host', source.host));
    card.append(head);
    if (source.title) card.append(el('div', 'pk-mcite-card__title', source.title));
    if (source.snippet) card.append(el('p', 'pk-mcite-card__snippet', source.snippet));
    card.append(el('div', 'pk-mcite-card__foot', '点一下打开原网页'));
    document.body.append(card);
    cardFor = anchor;
    anchor.setAttribute('aria-describedby', card.id);
    const a = anchor.getBoundingClientRect(), c = card.getBoundingClientRect();
    const gap = 8, margin = 8;
    const below = a.bottom + gap + c.height <= innerHeight - margin || a.top - gap - c.height < margin;
    const top = below ? a.bottom + gap : a.top - gap - c.height;
    const left = Math.min(Math.max(margin, a.left + a.width / 2 - c.width / 2), innerWidth - margin - c.width);
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(Math.max(margin, top)) + 'px';
    card.dataset.side = below ? 'below' : 'above';
  }
  const anchorOf = target => (isMetre() ? target?.closest?.('.pinkie-cite[data-pk-cite-n], .pk-mcite-chip') : null);
  document.addEventListener('pointerover', event => { const anchor = anchorOf(event.target); if (anchor) showCard(anchor); }, true);
  document.addEventListener('pointerout', event => {
    if (cardFor && cardFor.contains(event.target) && !cardFor.contains(event.relatedTarget)) hideCard();
  }, true);
  document.addEventListener('focusin', event => { const anchor = anchorOf(event.target); if (anchor) showCard(anchor); else if (cardFor) hideCard(); }, true);
  document.addEventListener('focusout', event => { if (cardFor && event.target === cardFor) hideCard(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && card) { hideCard(); event.stopPropagation(); } }, true);
  document.addEventListener('scroll', () => { if (card) hideCard(); }, true);
  window.addEventListener('resize', () => { if (card) hideCard(); });

  // ---------- 打开来源 ----------
  // 和 laolao-link-viewer.js 走同一条路：Mac 的应用内浏览器，Windows 的应用内浏览器或系统浏览器；都没有（纯网页）就开新标签页。
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
  // 角标在回答正文里，链接预览模块已经接管点击；来源行在正文外面，这里接住，免得整页被导航走。
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !isMetre()) return;
    const chip = event.target.closest?.('.pk-mcite-chip[href]');
    if (!chip) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hideCard();
    openUrl(chip.href);
  }, true);

  // ---------- 什么时候重画 ----------
  let frame = 0;
  const tick = () => {
    frame = 0;
    if (isMetre()) paint();
    else if (document.querySelector('.pk-mcite-row, .pinkie-cite[data-pk-cite-href]')) restore();
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(tick); };
  window.Pinkie?.domWatch?.watch('.pinkie-sources, .pinkie-cite, .pk-mcite-row', schedule, {immediate: true});
  window.addEventListener('laolao:modechange', schedule);
  window.addEventListener('pinkie:session-selected', () => { hideCard(); schedule(); });

  ns.metreCite = Object.freeze({sourcesFor, paint: schedule, openUrl, get card() { return card; }});
})();
