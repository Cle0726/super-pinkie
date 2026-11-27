/* 并排答（A5）：同一道题让两个模型各答一份，答完选一边留下。
 *
 * 入口两个：输入框旁的「并排答」开关（只管下一发，发出去自动关），和回复动作条上的「并排再答」
 * （laolao-message-actions.js 调 window.Pinkie.sideBySide.start）。比较轮本身在网关
 * （services/mode-architecture/session-side-by-side.mjs 的 pinkie.chat.sideBySide*）：两个临时会话并行答，
 * 这里只画两栏、转发停 / 选 / 都不要；选完让动作条重读历史，出「上一版 / 下一版」。
 *
 * 发送拦截挂在 window 的捕获阶段：比 document 捕获更早，开关打开时这里先拿到这次发送，
 * 不和思考强度（laolao-deep-think.js）抢顺序；开关关着、也不在比较中时一律放行。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.sideBySide) return;
  const root = document.documentElement;
  const BUSY = '这轮跑完再改';
  const WAIT = '先在上面的两栏里选一边，或者都不要，再发下一句';
  const NO_ATTACH = '并排答这一版还不能带附件：先去掉附件，或者关掉并排答';
  const PICK_TWO = '两边要选两个不同的模型';
  const SIDE_KEY = /^agent:[a-z\d][a-z\d_-]*:internal-session-effects:pinkie-side-[0-9a-f-]{36}-(?:left|right)$/i;
  const SIDES = ['left', 'right'];
  const LIVE = new Set(['starting', 'running', 'choosing']);
  const OTHER_SEND = ['chat-send-btn--stop', 'chat-send-btn--voice', 'chat-send-btn--laolao-dictation', 'chat-send-btn--queue'];
  const metre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const words = () => metre()
    ? {hint: '下一拍两个模型对着写', adopt: '留下这一边', discard: '都不留，回到刚才'}
    : {hint: '下一句用两个模型同时答', adopt: '用这一边继续', discard: '都不要，回到刚才'};
  const ICON = '<svg class="pinkie-sbs-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="7.2" height="14" rx="1.8"/><rect x="13.3" y="5" width="7.2" height="14" rx="1.8"/></svg>';
  const toast = text => { if (typeof window.__laolaoToast === 'function') window.__laolaoToast(text); };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  function button(label, className, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); onClick(event); });
    return node;
  }
  async function request(method, params, timeout = 20000) {
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (typeof rpc !== 'function') throw new Error('网关未连接');
    const result = await rpc(method, params, timeout);
    // 网关出错时仍是 respond(true, {ok:false, error})：看 payload 的 ok，把它的文案原样给人看。
    if (result && result.ok === false) throw new Error(result.error || '没有成功，稍后再试');
    return result;
  }
  const activePane = () => {
    const panes = [...document.querySelectorAll('openclaw-chat-pane')];
    return panes.find(pane => pane.active === true) || panes[0] || null;
  };
  const currentKey = pane => new URL(location.href).searchParams.get('session') || pane?.state?.sessionKey || '';
  const running = pane => Boolean(pane?.state?.chatRunId || pane?.state?.chatSending || pane?.state?.chatStream);
  const agentOf = key => (String(key).match(/^agent:([^:]+):/) || [])[1] || 'main';
  const tokens = n => Number(n || 0).toLocaleString('zh-CN');
  const textOf = message => {
    if (!message) return '';
    if (typeof message === 'string') return message;
    if (typeof message.text === 'string') return message.text;
    const content = message.content;
    if (typeof content === 'string') return content;
    return Array.isArray(content) ? content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('') : '';
  };
  const pairOk = pick => Boolean(pick?.[0] && pick?.[1] && pick[0] !== pick[1]);

  const sessions = new Map();
  const state = key => {
    if (!sessions.has(key)) {
      sessions.set(key, {armed: false, armedAt: 0, pick: ['', ''], view: null, texts: {left: '', right: ''}, fetched: {},
        checked: false, polledAt: 0, busy: false, epoch: 0, picking: null, anchor: null, question: ''});
    }
    return sessions.get(key);
  };
  const active = key => LIVE.has(sessions.get(key)?.view?.phase);
  const changed = () => { schedule(); window.__pinkieMessageActions?.paint?.(); };

  // 每个模式记住最近用过的一对。
  const pairKey = () => 'pinkie.sideBySide.pair.' + (root.getAttribute('data-laolao-mode') || 'default');
  const remembered = () => {
    try {
      const pair = JSON.parse(localStorage.getItem(pairKey()) || 'null');
      return Array.isArray(pair) && pair.length === 2 ? pair.map(String) : null;
    } catch { return null; }
  };
  const remember = pair => { try { localStorage.setItem(pairKey(), JSON.stringify(pair)); } catch { /* 存不了就下次重选 */ } };

  // 模型目录和模型选择器同一份（不可用的模型 load 时已经滤掉）。
  const catalogs = new Map(), names = new Map();
  function options(key) {
    const agent = agentOf(key);
    if (!catalogs.has(agent)) {
      const catalog = window.__laolaoModelPickerCatalog;
      const promise = (catalog ? catalog.load(agent) : Promise.reject(new Error('模型目录暂时不可用')))
        .then(models => (catalog.present ? catalog.present(models) : models).map(model => {
          const value = `${model.provider}/${model.id}`;
          const label = model.name || model.id;
          names.set(value, label);
          return {value, label};
        }))
        .catch(error => { catalogs.delete(agent); throw error; });
      catalogs.set(agent, promise);
    }
    return catalogs.get(agent);
  }
  window.addEventListener('pinkie:models-changed', () => catalogs.clear());
  async function currentModel(key) {
    const selected = document.querySelector('[data-chat-model-option][aria-selected="true"]')?.getAttribute('data-chat-model-option');
    if (selected) return selected;
    try {
      const list = await request('sessions.list', {}, 10000);
      const session = (list?.sessions || []).find(item => item.key === key);
      return session?.model ? `${session.modelProvider || ''}/${session.model}`.replace(/^\//, '') : '';
    } catch { return ''; }
  }
  function picker(key, pick, onChange, className = '') {
    const box = el('span', ('pinkie-sbs-pick ' + className).trim());
    const make = index => {
      const select = el('select', 'pinkie-sbs-pick__select');
      select.setAttribute('aria-label', index ? '右边的模型' : '左边的模型');
      select.append(new Option(index ? '选右边的模型…' : '选左边的模型…', ''));
      select.addEventListener('change', () => { pick[index] = select.value; onChange(); });
      return select;
    };
    const selects = [make(0), make(1)];
    box.append(selects[0], el('span', 'pinkie-sbs-pick__vs', 'vs'), selects[1]);
    void options(key).then(list => {
      const values = new Set(list.map(option => option.value));
      for (const [index, select] of selects.entries()) {
        if (pick[index] && !values.has(pick[index])) select.append(new Option(names.get(pick[index]) || pick[index], pick[index]));
        for (const option of list) select.append(new Option(option.label, option.value));
        select.value = pick[index] || '';
      }
    }, error => toast(error.message));
    return box;
  }

  // ── 输入框：开关、两个模型位子、发送键 ──
  async function arm(key, on = !state(key).armed) {
    const s = state(key);
    if (!on) { s.armed = false; schedule(); return false; }
    if (active(key)) { toast(WAIT); return false; }
    const last = remembered() || ['', ''];
    const left = (await currentModel(key)) || last[0];
    s.pick = [left, last.find(model => model && model !== left) || ''];
    s.armed = true; s.armedAt = Date.now();
    schedule();
    activePane()?.querySelector('.agent-chat__composer-combobox textarea')?.focus();
    return true;
  }
  function paintToggle(toggle, key, pane) {
    const s = key ? state(key) : null;
    const on = Boolean(s?.armed);
    const why = !key ? '先打开一个会话' : active(key) ? WAIT : running(pane) && !on ? BUSY : '';
    const tip = why || (on ? '下一句会让两个模型同时答（再点一下取消）' : words().hint);
    toggle.disabled = Boolean(why);
    if (toggle.dataset.pinkieTooltip !== tip) { toggle.dataset.pinkieTooltip = tip; toggle.title = tip; }
    if (toggle.getAttribute('aria-pressed') !== String(on)) toggle.setAttribute('aria-pressed', String(on));
    toggle.classList.toggle('is-on', on);
  }
  function paintSend(send, armed, comparing) {
    if (OTHER_SEND.some(name => send.classList.contains(name))) return;
    const label = comparing ? WAIT : armed ? '并排发送' : '';
    if (label) {
      if (!('pinkieSbsLabel' in send.dataset)) send.dataset.pinkieSbsLabel = send.getAttribute('aria-label') || '';
      if (send.getAttribute('aria-label') !== label) { send.setAttribute('aria-label', label); send.title = label; }
    } else if ('pinkieSbsLabel' in send.dataset) {
      send.setAttribute('aria-label', send.dataset.pinkieSbsLabel);
      send.removeAttribute('title');
      delete send.dataset.pinkieSbsLabel;
    }
  }
  function mountComposer(pane, key) {
    const s = key ? state(key) : null;
    for (const actions of document.querySelectorAll('.agent-chat__input .agent-chat__composer-actions')) {
      let toggle = actions.querySelector(':scope > .pinkie-sbs-toggle');
      if (!toggle) {
        toggle = button('', 'pinkie-sbs-toggle', () => {
          const target = currentKey(activePane());
          if (target && !toggle.disabled) void arm(target);
        });
        toggle.innerHTML = ICON + '<span>并排答</span>';
        toggle.setAttribute('aria-label', '并排答');
        actions.append(toggle);
      }
      paintToggle(toggle, key, pane);
      let row = actions.querySelector(':scope > .pinkie-sbs-models');
      const want = s?.armed ? key + '|' + s.armedAt : '';
      if (row && row.dataset.signature !== want) { row.remove(); row = null; }
      if (want && !row) {
        row = el('span', 'pinkie-sbs-models');
        const hint = el('span', 'pinkie-sbs-models__hint');
        const check = () => {
          const same = Boolean(s.pick[0] && s.pick[0] === s.pick[1]);
          hint.textContent = same ? PICK_TWO : !s.pick[1] ? '再选右边的模型' : '';
          row.classList.toggle('is-invalid', same);
        };
        row.append(picker(key, s.pick, check), hint);
        row.dataset.signature = want;
        check();
        toggle.after(row);
      }
      for (const send of actions.closest('.agent-chat__input')?.querySelectorAll('.chat-send-btn') || []) paintSend(send, Boolean(s?.armed), Boolean(key && active(key)));
    }
  }
  function clearDraft(pane, input) {
    const owner = [pane?.state, pane, pane?.controller].find(item => typeof item?.handleChatDraftChange === 'function');
    if (owner) owner.handleChatDraftChange(''); else if (pane?.state) pane.state.chatMessage = '';
    if (input && input.value) { input.value = ''; input.dispatchEvent(new Event('input', {bubbles: true, composed: true})); }
    pane?.requestUpdate?.();
  }
  function intercept(event) {
    const pane = (event.composedPath?.() || []).find(node => node?.matches?.('openclaw-chat-pane')) || event.target?.closest?.('openclaw-chat-pane');
    if (!pane) return;
    const key = currentKey(pane), s = sessions.get(key);
    const comparing = active(key);
    if (!comparing && !s?.armed) return;
    let input;
    if (event.type === 'click') {
      const send = event.target?.closest?.('.chat-send-btn');
      if (!send || OTHER_SEND.some(name => send.classList.contains(name))) return;
      input = send.closest('.agent-chat__input')?.querySelector('.agent-chat__composer-combobox textarea');
    } else {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      input = event.target?.closest?.('.agent-chat__composer-combobox textarea');
      if (!input) return;
    }
    const text = String(input?.value ?? pane.state?.chatMessage ?? '').trim();
    if (!text) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (comparing) { toast(WAIT); return; }
    if (running(pane)) { toast(BUSY); return; }
    if (pane.state?.chatAttachments?.length) { toast(NO_ATTACH); return; }
    if (!pairOk(s.pick)) { toast(PICK_TWO); return; }
    s.armed = false;
    clearDraft(pane, input);
    void start({pane, key, text, models: [...s.pick]});
  }
  window.addEventListener('click', intercept, true);
  window.addEventListener('keydown', intercept, true);

  // ── 比较轮 ──
  async function start({pane = activePane(), key = currentKey(pane), entryId, text, anchor, models} = {}) {
    if (!key) { toast('先打开一个会话'); return null; }
    const s = state(key);
    if (active(key)) { toast(WAIT); return null; }
    if (running(pane)) { toast(BUSY); return null; }
    let pair = models;
    if (!pair) {
      // 动作条入口：左边是这个会话现在的模型，右边是上次并排用过的另一个；缺一个就让人挑。
      const left = await currentModel(key);
      const right = (remembered() || []).find(model => model && model !== left) || '';
      if (!left || !right) { s.picking = {entryId, text, pick: [left, right]}; s.anchor = anchor || null; schedule(); return null; }
      pair = [left, right];
    }
    if (!pairOk(pair)) { toast(PICK_TWO); return null; }
    s.picking = null; s.anchor = anchor || null; s.question = entryId ? '' : String(text || '');
    s.texts = {left: '', right: ''}; s.fetched = {}; s.polledAt = Date.now(); s.epoch++;
    s.view = {phase: 'starting', models: pair, sides: {left: {model: pair[0], status: 'running'}, right: {model: pair[1], status: 'running'}}};
    changed();
    try {
      const view = await request('pinkie.chat.sideBySide', entryId ? {key, models: pair, entryId} : {key, models: pair, text}, 30000);
      if (s.view?.phase === 'starting') s.view = view;
      remember(pair);
      return view;
    } catch (error) {
      s.view = null;
      toast(error.message);
      return null;
    } finally { changed(); }
  }
  async function refresh(key) {
    const s = state(key), epoch = s.epoch;
    s.polledAt = Date.now(); s.checked = true;
    let view;
    try { view = await request('pinkie.chat.sideBySide.status', {key}, 15000); } catch { return; }
    if (epoch !== s.epoch || s.view?.phase === 'starting') return;
    const was = active(key);
    s.view = LIVE.has(view?.phase) || view?.phase === 'lost' ? view : null;
    if (was !== active(key)) changed(); else schedule();
    if (active(key)) for (const side of SIDES) void fill(key, side);
  }
  // 重启后、或流式事件漏了的时候，从临时会话的历史里补上那一边的全文。
  async function fill(key, side) {
    const s = state(key), info = s.view?.sides?.[side];
    if (!info?.key || info.status === 'running' || s.fetched[side] === info.key) return;
    s.fetched[side] = info.key;
    try {
      const history = await request('chat.history', {sessionKey: info.key, limit: 6}, 20000);
      const last = (history?.messages || []).filter(item => (item?.role || item?.message?.role) === 'assistant').at(-1);
      const text = textOf(last?.message || last);
      if (text) { s.texts[side] = text; schedule(); }
    } catch { delete s.fetched[side]; }
  }
  async function act(key, method, params, after) {
    const s = state(key);
    if (s.busy) return;
    s.busy = true; s.epoch++; schedule();
    try {
      const result = await request(method, {key, ...params}, 30000);
      s.epoch++;
      await after?.(result, s);
    } catch (error) { toast(error.message); }
    finally { s.busy = false; changed(); }
  }
  const abort = (key, side) => act(key, 'pinkie.chat.sideBySide.abort', side ? {side} : {}, () => refresh(key));
  const choose = (key, side) => act(key, 'pinkie.chat.sideBySide.adopt', {side}, async (result, s) => {
    s.view = null; s.texts = {left: '', right: ''};
    changed();
    if (result?.modelSaved === false) toast('这一边的模型没存成这个会话的模型，下一句还用原来的');
    await window.__pinkieMessageActions?.reloadHistory?.(activePane(), key, result?.leaf);
  });
  const drop = key => act(key, 'pinkie.chat.sideBySide.discard', {}, (result, s) => { s.view = null; });

  window.addEventListener('pinkie:gateway-event', event => {
    const payload = event.detail?.payload;
    if (event.detail?.event !== 'chat' || !SIDE_KEY.test(payload?.sessionKey || '')) return;
    for (const [key, s] of sessions) {
      const side = SIDES.find(name => s.view?.sides?.[name]?.key === payload.sessionKey);
      if (!side) continue;
      const text = textOf(payload.message);
      if (text) s.texts[side] = text;
      if (payload.state === 'delta') schedule(); else void refresh(key);
    }
  });

  // ── 两栏 ──
  function panelFor(key, s) {
    const w = words(), view = s.view;
    const box = el('section', 'pinkie-sbs' + (metre() ? ' pinkie-sbs--metre' : ''));
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', '并排答');
    box.dataset.key = key;
    if (!view && s.picking) {
      box.dataset.phase = 'pick';
      let go = null;
      const row = picker(key, s.picking.pick, () => { go.disabled = !pairOk(s.picking?.pick); }, 'pinkie-sbs__pick');
      go = button('开始', 'pinkie-sbs__btn pinkie-sbs__go', () => {
        const {pick, ...rest} = s.picking;
        s.picking = null;
        void start({...rest, key, anchor: s.anchor, models: [...pick]});
      });
      go.disabled = !pairOk(s.picking.pick);
      box.append(el('p', 'pinkie-sbs__lead', '选两个模型，对这一题各答一份'), row, go,
        button('取消', 'pinkie-sbs__btn', () => { s.picking = null; schedule(); }));
      return box;
    }
    box.dataset.phase = view.phase;
    if (view.phase === 'lost') {
      box.append(el('p', 'pinkie-sbs__lost', view.message || view.error || ''),
        button('知道了', 'pinkie-sbs__btn', () => { s.view = null; schedule(); }));
      return box;
    }
    const ready = view.phase !== 'starting';
    const head = el('div', 'pinkie-sbs__head');
    head.append(el('span', 'pinkie-sbs__title', '并排答'));
    if (s.question) head.append(el('span', 'pinkie-sbs__ask', s.question));
    if (ready && SIDES.some(side => view.sides?.[side]?.status === 'running')) {
      head.append(button('两边都停', 'pinkie-sbs__btn pinkie-sbs__stop-all', () => void abort(key)));
    }
    const cols = el('div', 'pinkie-sbs__cols');
    const usage = view.usage, total = usage?.total?.totalTokens || 0;
    SIDES.forEach((side, index) => {
      const info = view.sides?.[side] || {}, model = info.model || view.models?.[index] || '';
      const status = info.status || 'running', failed = status === 'error' || status === 'aborted';
      const col = el('article', 'pinkie-sbs__col');
      col.dataset.side = side; col.dataset.status = status;
      const top = el('header', 'pinkie-sbs__col-head');
      top.append(el('span', 'pinkie-sbs__model', names.get(model) || model),
        el('span', 'pinkie-sbs__state', status === 'final' ? '答完了' : failed ? '未完成' : '答着…'));
      if (ready && status === 'running') top.append(button('停', 'pinkie-sbs__btn pinkie-sbs__stop', () => void abort(key, side)));
      const text = el('div', 'pinkie-sbs__text');
      text.dataset.side = side;
      col.append(top, text);
      if (failed) col.append(el('p', 'pinkie-sbs__why', status === 'error' ? `这一边没答完：${info.error || '出错了'}` : '这一边停下了，没答完'));
      const foot = el('footer', 'pinkie-sbs__col-foot');
      const used = usage?.sides?.[side];
      if (used) {
        foot.append(el('span', 'pinkie-sbs__usage', `输入 ${tokens(used.inputTokens)} · 输出 ${tokens(used.outputTokens)} 令牌`));
        const meter = el('span', 'pinkie-sbs__meter'), bar = el('i');
        bar.style.width = (total ? Math.round(100 * (used.totalTokens || 0) / total) : 0) + '%';
        meter.append(bar);
        foot.append(meter);
      }
      const adopt = button(w.adopt, 'pinkie-sbs__btn pinkie-sbs__adopt', () => void choose(key, side));
      adopt.disabled = s.busy || !ready || status !== 'final';
      foot.append(adopt);
      col.append(foot);
      cols.append(col);
    });
    const bottom = el('footer', 'pinkie-sbs__foot');
    if (usage?.total) {
      bottom.append(el('span', 'pinkie-sbs__total',
        `这一题两边一共 ${tokens(usage.total.totalTokens)} 令牌（输入 ${tokens(usage.total.inputTokens)} · 输出 ${tokens(usage.total.outputTokens)}）`));
    }
    const discard = button(w.discard, 'pinkie-sbs__btn pinkie-sbs__discard', () => void drop(key));
    discard.disabled = s.busy || !ready;
    bottom.append(discard);
    box.append(head, cols, bottom);
    return box;
  }
  function placePanel(pane, key) {
    for (const old of document.querySelectorAll('.pinkie-sbs')) if (old.dataset.key !== key || !pane?.contains(old)) old.remove();
    const thread = pane?.querySelector('.chat-thread-inner');
    const s = key ? sessions.get(key) : null;
    let panel = thread?.querySelector(':scope > .pinkie-sbs') || null;
    if (!thread || !s || (!s.view && !s.picking)) { panel?.remove(); return; }
    const view = s.view;
    const signature = JSON.stringify([metre(), s.busy, Boolean(s.picking), s.question, names.size, view && [view.phase, view.message,
      SIDES.map(side => [view.sides?.[side]?.model, view.sides?.[side]?.status, view.sides?.[side]?.error]), view.usage]]);
    if (!panel || panel.dataset.signature !== signature) {
      const next = panelFor(key, s);
      next.dataset.signature = signature;
      if (panel) panel.replaceWith(next); else thread.append(next);
      panel = next;
    }
    // 动作条发起的挂在那道题的回复下面；输入框发起的挂在最后。
    let anchor = s.anchor?.isConnected ? s.anchor : null;
    while (anchor && anchor.parentElement !== thread) anchor = anchor.parentElement;
    if (anchor) { if (anchor.nextElementSibling !== panel) anchor.after(panel); }
    else if (thread.lastElementChild !== panel) thread.append(panel);
    for (const node of panel.querySelectorAll('.pinkie-sbs__text[data-side]')) {
      const text = s.texts[node.dataset.side] || '';
      if (node.textContent !== text) node.textContent = text;
    }
  }

  let frame = 0;
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  function paint() {
    frame = 0;
    const pane = activePane();
    let key = currentKey(pane);
    if (SIDE_KEY.test(key)) key = '';
    mountComposer(pane, key);
    placePanel(pane, key);
    const s = key ? sessions.get(key) : null;
    const mark = active(key) ? 'comparing' : s?.armed ? 'armed' : null;
    if (root.getAttribute('data-pinkie-sbs') !== mark) {
      if (mark) root.setAttribute('data-pinkie-sbs', mark); else root.removeAttribute('data-pinkie-sbs');
    }
  }
  function tick() {
    const key = currentKey(activePane());
    if (key && !SIDE_KEY.test(key)) {
      const s = state(key);
      if (!s.checked) void refresh(key);
      else if (!s.busy && s.view?.phase === 'running' && Date.now() - s.polledAt > 2000) void refresh(key);
    }
    schedule();
  }
  window.addEventListener('laolao:modechange', schedule);
  window.addEventListener('pinkie:session-selected', schedule);
  window.Pinkie?.domWatch?.poll(tick, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, {once: true}); else tick();

  ns.sideBySide = Object.freeze({
    start, arm, active, refresh,
    armed: key => Boolean(sessions.get(key)?.armed),
    view: key => sessions.get(key)?.view || null,
    paint: schedule,
  });
})();
