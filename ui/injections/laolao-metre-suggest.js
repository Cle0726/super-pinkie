/* laolao-metre-suggest —— Metre 的「下一句建议」（「以后」S 级 I8，m5，11-25）。设计和调研见 build\quick-run\设计-I8.md。
 * 原生没有回答后的建议：欢迎页那四条（agent-chat__suggestions）点了直接发送；内核的 [[quick_replies: …]] 只给 LINE 频道。
 * 所以在壳里按本地规则拼 2–3 条（不调模型，同一条回答结果总一样）：
 *   回答里有 [[quick_replies: …]] 先用它；问句结尾带编号选项 → 每项一条，或「A 还是 B」→ 两条；有代码块 → 解释 / 写测试；
 *   很长 → 总结成三点；不够两条用「继续」「换个说法」补。
 * 出：对话面板从忙变闲、最后一条是 assistant、输入框空着。收：开始打字、换会话、新一轮开始、切出 Metre、设置里关掉。
 * 点一条只填进输入框并聚焦，**不发送**（handleChatDraftChange，没有就改 state.chatMessage，和 laolao-metre-queue.js 一样）。
 * 放在 .agent-chat__composer-shell 前面（输入框上方，不进原生模板管的节点里），原生重画把它挤掉了就放回去。
 * 刷新挂在 laolao-run-status 发的 pinkie:run-view 上（原生面板每次更新都发），不加定时器、观察器和 window.__ 全局名。
 * 开关：pinkie.metre.prefs.nextSuggest（off = 关，默认开），在 Metre 设置弹层「对话」卡片里（laolao-metre-prefs.js）。 */
(() => {
  'use strict';
  const KEY = 'pinkie.metre.prefs.nextSuggest';
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const pane = () => document.querySelector('openclaw-chat-pane');
  const enabled = () => { try { return window.localStorage?.getItem(KEY) !== 'off'; } catch { return true; } };
  const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const clip = (s, n) => ([...s].length > n ? [...s].slice(0, n).join('') + '…' : s);
  const textOf = (m) => (typeof m?.content === 'string' ? m.content
    : Array.isArray(m?.content) ? m.content.filter((c) => c?.type === 'text').map((c) => c.text || '').join('\n') : String(m?.text ?? ''));
  const busy = (st) => Boolean(st?.chatRunId || st?.chatSending || st?.chatStream);
  const lastOf = (st) => { const ms = Array.isArray(st?.chatMessages) ? st.chatMessages : []; return ms[ms.length - 1]; };
  const method = (p, name) => { for (const o of [p?.state, p, p?.controller]) if (typeof o?.[name] === 'function') return o[name].bind(o); return null; };

  // 规则：给一条回答的正文，返回 2–3 条建议（字符串）。
  function pick(reply) {
    const text = String(reply ?? ''), out = [];
    const add = (s) => { s = squash(s).replace(/[*_`]/g, ''); if (s && !out.includes(s) && out.length < 3) out.push(s); };
    const qr = text.match(/\[\[quick_replies:\s*([^\]]+)\]\]/i);
    if (qr) for (const s of qr[1].split(/[,，]/)) add(clip(squash(s), 40));
    const body = text.replace(/```[\s\S]*?```/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ').trim();
    if (/[?？]\s*$/.test(body)) {
      const opts = [...body.matchAll(/^\s*(\d+)[.、)）]\s*(.+)$/gm)].slice(0, 3);
      for (const [, n, t] of opts) add(`选 ${n}：${clip(squash(t), 24)}`);
      const either = opts.length ? null : body.match(/([^\s，,。？?]{1,16})\s*还是\s*([^\s，,。？?]{1,16})\s*[?？]\s*$/);
      if (either) { add(either[1]); add(either[2]); }
    }
    if (/```/.test(text)) { add('解释一下这段代码'); add('给它写个测试'); }
    if ([...body].length > 600) add('总结成三点');
    for (const s of ['继续', '换个说法']) if (out.length < 2) add(s);
    return out;
  }

  let row = null, wasBusy = false, session = '';
  const hide = () => { row?.remove(); row = null; };
  function place(p) {
    const shell = p?.querySelector('.agent-chat__composer-shell');
    if (row && shell && row.nextElementSibling !== shell) shell.before(row);
  }
  function fill(text) {
    const p = pane(); if (!p?.state) return;
    const set = method(p, 'handleChatDraftChange'); if (set) set(text); else p.state.chatMessage = text;
    p.state.requestUpdate?.(); p.requestUpdate?.();
    hide();
    requestAnimationFrame(() => { const ta = p.querySelector('.agent-chat__composer-combobox textarea'); if (ta) { ta.focus(); ta.setSelectionRange?.(ta.value.length, ta.value.length); } });
  }
  function show(p, list) {
    hide();
    if (list.length < 2) return;
    row = document.createElement('div');
    row.className = 'pk-metre-suggest';
    row.setAttribute('role', 'group'); row.setAttribute('aria-label', '下一句建议');
    for (const s of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pk-metre-suggest__chip'; b.textContent = s; b.dataset.suggest = s;
      b.setAttribute('aria-label', '填进输入框：' + s);
      row.append(b);
    }
    row.addEventListener('click', (e) => { const b = e.target.closest?.('.pk-metre-suggest__chip'); if (b) { e.preventDefault(); fill(b.dataset.suggest); } });
    place(p);
  }
  // 每次 pinkie:run-view 看一眼：忙 → 记下、收起；刚从忙变闲且最后一条是回答、输入框空 → 出建议。
  function check() {
    const p = pane(), st = p?.state;
    if (!isMetre() || !enabled() || !st) { wasBusy = false; hide(); return; }
    const key = String(st.sessionKey ?? '');
    if (key !== session) { session = key; wasBusy = false; hide(); }
    if (busy(st)) { wasBusy = true; hide(); return; }
    if (squash(st.chatMessage)) { hide(); wasBusy = false; return; }
    if (!wasBusy) { place(p); return; }
    wasBusy = false;
    const m = lastOf(st);
    if (m?.role === 'assistant') show(p, pick(textOf(m)));
  }

  window.addEventListener('pinkie:run-view', check);
  window.addEventListener('pinkie:session-selected', () => { session = ''; check(); });
  window.addEventListener('laolao:modechange', check);
  // 开始打字就收起（输入框是原生的，只看 input 事件，不拦）。
  document.addEventListener('input', (e) => { if (row && e.target?.matches?.('.agent-chat__composer-combobox textarea') && squash(e.target.value)) hide(); }, true);
  if (window.Pinkie) window.Pinkie.metreSuggest = Object.freeze({pick, check, KEY});
})();
