/* laolao-tool-images:v1 —— 读图小框（PLAN 2.9，所有模式）
 *
 *   ● 看了 截图 1.png        [▣][▣][▣][▣] +1  截图 1.png
 *
 * - 数据：网关 pinkie.toolTrace.list（services/mode-architecture/tool-trace.mjs）。后端在 after_tool_call
 *   记下工具确实读过 / 产出的图片，按会话存盘，所以刷新、重开会话后还在；图片地址带一次性 key，
 *   不接收路径（没被工具读过的图取不到）。
 * - 过程里那一行（展开后的每一步，和折起来的「● 看了 2 张图片」那一行）右侧放 40 像素缩略图和文件名，
 *   最多 4 张，其余写「+N」。点缩略图用 laolao-image-viewer 打开大图。
 * - 图片已经不在磁盘上：灰框「图片已不在」，不发请求，控制台不报错。
 * - 同一份记录里的「写入前路径不存在」逐条广播 pinkie:tool-trace，laolao-cle-stage 据此把「写入」改叫「创建」。
 * - 不挂 MutationObserver：跟着网关事件刷新，另外每 1.5 秒对一遍（幂等、只碰过程卡里的工具行）。 */
(() => {
  'use strict';
  if (window.__pinkieToolImages) return;

  const MAX_SHOWN = 4;
  const request = (method, params, timeout = 8000) => {
    const gw = window.__laolaoSidebar?.gwRequest;
    return typeof gw === 'function' ? gw(method, params, timeout) : Promise.reject(new Error('gateway unavailable'));
  };
  const sessionKey = () => new URLSearchParams(location.search).get('session') || '';

  let traces = {};          // toolCallId → {created?, name?, images?: [{name, url, exists}]}
  let tracesFor = '';
  const sent = new Map();   // toolCallId → 上次广播的内容（只广播变化）
  let inflight = null, again = false, timer = 0;

  /** 一组图片 → 小框的描述（纯函数，测试直接验）。 */
  function stripModel(images) {
    const list = Array.isArray(images) ? images.filter((img) => img && img.url) : [];
    const shown = list.slice(0, MAX_SHOWN).map((img) => ({name: String(img.name || ''), url: String(img.url), gone: img.exists === false}));
    return {shown, more: Math.max(0, list.length - MAX_SHOWN), name: shown.length ? shown[0].name : '', key: list.map((img) => img.url + (img.exists === false ? '#gone' : '')).join('|')};
  }

  async function refresh() {
    const key = sessionKey();
    if (!key) return;
    if (inflight) { again = true; return inflight; }
    inflight = (async () => {
      try {
        const result = await request('pinkie.toolTrace.list', {sessionKey: key});
        if (key !== sessionKey()) return;
        if (tracesFor !== key) sent.clear();
        tracesFor = key;
        traces = result && result.calls && typeof result.calls === 'object' ? result.calls : {};
        for (const [callId, trace] of Object.entries(traces)) {
          const sig = JSON.stringify(trace);
          if (sent.get(callId) === sig) continue;
          sent.set(callId, sig);
          window.dispatchEvent(new CustomEvent('pinkie:tool-trace', {detail: {callId, trace, sessionKey: key}}));
        }
        paint();
      } catch { /* 网关没起来、旧版后端没有这个方法：不显示小框，不报错 */ }
    })();
    try { await inflight; } finally {
      inflight = null;
      if (again) { again = false; void refresh(); }
    }
  }
  function later(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), ms);
  }

  function callIdOf(row) {
    const tk = window.__pinkieToolKind;
    if (tk && tk.rowCallId) return tk.rowCallId(row);
    const host = row.closest('[data-message-id]');
    const m = host && /^tool:[^:]+:([^:]+)/.exec(host.dataset.messageId || '');
    return m ? m[1] : '';
  }

  function render(strip, model) {
    strip.textContent = '';
    for (const img of model.shown) {
      const cell = document.createElement('span');
      cell.className = 'pinkie-tool-thumb';
      if (img.gone) {
        cell.classList.add('is-gone');
        cell.title = '图片已不在';
        cell.textContent = '图片已不在';
      } else {
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        cell.title = img.name ? '看大图：' + img.name : '看大图';
        cell.dataset.src = img.url;
        cell.dataset.name = img.name;
        const pic = document.createElement('img');
        pic.alt = img.name;
        pic.decoding = 'async';
        pic.loading = 'lazy';
        pic.addEventListener('error', () => {
          // 列表之后才被删掉：换成灰框
          cell.classList.add('is-gone');
          cell.removeAttribute('role');
          cell.title = '图片已不在';
          pic.remove();
          cell.textContent = '图片已不在';
        }, {once: true});
        pic.src = img.url;
        cell.append(pic);
      }
      strip.append(cell);
    }
    if (model.more) {
      const more = document.createElement('span');
      more.className = 'pinkie-tool-thumbs__more';
      more.textContent = '+' + model.more;
      strip.append(more);
    }
    if (model.name) {
      const name = document.createElement('span');
      name.className = 'pinkie-tool-thumbs__name';
      name.textContent = model.name;
      strip.append(name);
    }
  }

  function ensure(host, images) {
    let strip = host.querySelector(':scope > .pinkie-tool-thumbs');
    const model = stripModel(images);
    if (!model.shown.length) { if (strip) strip.remove(); return; }
    if (strip && strip.dataset.key === model.key) return;
    if (!strip) {
      strip = document.createElement('span');
      strip.className = 'pinkie-tool-thumbs';
      host.append(strip);
    }
    strip.dataset.key = model.key;
    render(strip, model);
  }

  function imagesOf(row) {
    const trace = traces[callIdOf(row)];
    return trace && Array.isArray(trace.images) ? trace.images : [];
  }

  function paint() {
    if (tracesFor !== sessionKey()) return;
    // 展开后的每一步
    document.querySelectorAll('.chat-tool-msg-summary').forEach((row) => ensure(row, imagesOf(row)));
    // 折起来的那一行（laolao-cle-stage 的「● 看了 2 张图片 ›」）：这一组里所有步骤的图
    document.querySelectorAll('.pinkie-process .cle-run:not(.cle-plan)').forEach((btn) => {
      const head = btn.parentElement;
      const groups = [head];
      for (let g = head && head.nextElementSibling; g && g.hasAttribute('data-cle-member'); g = g.nextElementSibling) groups.push(g);
      const images = groups.flatMap((g) => g ? [...g.querySelectorAll('.chat-tool-msg-summary')].flatMap(imagesOf) : []);
      ensure(btn, images);
    });
  }

  // 点缩略图：比过程卡、工具行自己的点击（展开 / 折叠）先接住
  function openThumb(event) {
    const cell = event.target.closest && event.target.closest('.pinkie-tool-thumb[data-src]:not(.is-gone)');
    if (!cell) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const viewer = window.__laolaoImageViewer;
    if (viewer && typeof viewer.open === 'function') viewer.open(cell.dataset.src, cell.dataset.name || '');
    return true;
  }
  window.addEventListener('click', (event) => {
    if (event.button !== 0) return;
    openThumb(event);
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    openThumb(event);
  }, true);

  window.addEventListener('pinkie:gateway-event', (e) => {
    const {event: name, payload: p} = (e && e.detail) || {};
    if (!p || (p.sessionKey && p.sessionKey !== sessionKey())) return;
    if (name !== 'agent' && name !== 'session.tool') return;
    const d = p.data || {};
    if (p.stream === 'tool' && d.phase === 'start' && /^write$/i.test(String(d.name || ''))) later(250);
    else if (p.stream === 'tool' && d.phase === 'result') later(400);
    else if (p.stream === 'lifecycle' && (d.phase === 'end' || d.phase === 'error')) later(600);
  });
  window.addEventListener('pinkie:session-selected', () => {
    traces = {}; tracesFor = '';
    document.querySelectorAll('.pinkie-tool-thumbs').forEach((n) => n.remove());
    later(300);
  });

  function start() {
    later(800);
    setInterval(paint, 1500);
    // 地址栏换了会话但没有 session-selected（直接改 URL、历史前进后退）
    let last = sessionKey();
    setInterval(() => { const now = sessionKey(); if (now !== last) { last = now; traces = {}; tracesFor = ''; later(200); } }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();

  window.__pinkieToolImages = {refresh, paint, stripModel, get traces() { return traces; }};
})();
