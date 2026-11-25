/* laolao-metre-allow —— 「以后」S 级 P3 允许清单（ui5，11-25）。只在 Metre 模式显示，其他五个模式一字不变。
 *
 * 放在碧琪设置弹层里（pinkie:settings-ready 挂载，和 capabilities / feedback / #87 的「对话」卡一样），一张「允许的命令」卡片：
 * 列出 metre 代理的 allowlist，能加、能移除。数据全走原生网关已有的 exec.approvals.get / set，不动内核：
 *   - set 要带 baseHash、整份写回；只改 agents.metre.allowlist，别的字段（defaults、其他代理、security / ask）原样带回去。
 *   - security / ask 归第五批 P2「放手程度」（laolao-metre-perm.js，status\engines.md 写了分界），这里只读来显示一句说明。
 *   - baseHash 对不上（别人刚写过，例如 P2 刚换档）就重新 get、在新文件上再改一次，最多 3 次——和 P2 同一套规矩。
 * 拒绝清单：原生没有「按命令拒绝」的列表（deny 只是整个代理的档位），要做得写内核补丁，本文件不做。
 * pattern 的含义照原生 matchAllowlist / compileGlobRegex：不带路径的按可执行文件名匹配（git、npm），带路径的按完整路径；
 * * 不跨文件夹，** 跨任意层，单独一个 * 放行全部（加它要再点一次确认，清单里写成「全部命令」）。原生按小写去重，这里也按小写判重。
 * 这里加的条目不带 argPattern（不限参数）；带参数的条目照原样显示、能移除。
 * 不新增观察器、循环定时器和 window.__ 全局名；弹层重新打开时的刷新走 window.Pinkie.domWatch.poll。 */
(() => {
  'use strict';
  window.Pinkie = window.Pinkie || {};
  if (window.Pinkie.metreAllow) return;
  const S = 'pinkie-user-settings__';
  const AGENT = 'metre';
  const MAX = 200;
  const EXAMPLES = ['pnpm', 'node', 'python', 'cargo', 'go', 'git', 'npm'];
  const isMetre = () => document.documentElement.getAttribute('data-laolao-mode') === 'metre';
  const rpc = (method, params, ms = 10000) => {
    const r = window.__laolaoSidebar?.gwRequest;
    return r ? r(method, params || {}, ms) : Promise.reject(new Error('还没连上网关'));
  };
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const key = (p) => String(p || '').trim().toLowerCase();
  const isAll = (p) => String(p || '').trim() === '*';
  const entriesOf = (file) => {
    const list = file?.agents?.[AGENT]?.allowlist;
    return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object' && typeof e.pattern === 'string' && e.pattern.trim()) : [];
  };
  // 一句话说明清单眼下起不起作用（只读 security / ask，不改）。
  function levelNote(file) {
    const a = file?.agents?.[AGENT] || {}, d = file?.defaults || {};
    const security = a.security ?? d.security ?? 'full', ask = a.ask ?? d.ask ?? 'off';
    if (security === 'deny') return '放手程度现在是「不跑命令」，这份清单暂时不起作用。';
    if (security !== 'allowlist') return '放手程度现在是「自动」：命令都直接跑，这份清单暂时不起作用；换到「问我」才按它放行。';
    if (ask === 'always') return '放手程度现在是每条命令都先问你，清单暂时不起作用。';
    return ask === 'off' ? '清单里的命令直接跑，清单外的不跑。' : '清单里的命令直接跑，清单外的先问你。';
  }
  // 命令名 / 路径：按 / 或 \ 切成段，每段一个 inline-block（laolao-metre-allow.css），长路径只在段与段之间换行，
  // 不在 stable-x86_64 这种连字符中间断；单独一段比整行还宽时才在段内折。复制出来的文字不多任何字符。
  function pathTitle(pattern) {
    const span = node('span', S + 'row-title');
    for (const part of String(pattern).split(/(?<=[\/\\])/)) span.append(node('span', 'pk-metre-allow__seg', part));
    return span;
  }
  function problem(pattern, list) {
    if (!pattern) return '先写一个命令名或路径。';
    if (/[\r\n]/.test(pattern)) return '一次只写一条，不要换行。';
    if ([...pattern].length > MAX) return `太长了（最多 ${MAX} 个字）。`;
    if (list.some((e) => key(e.pattern) === key(pattern))) return '清单里已经有这一条了。';
    return '';
  }

  const state = {file: null, loaded: false, busy: false, error: '', note: '', confirmAll: false};
  let card = null, listEl = null, statusEl = null, input = null, addBtn = null, wasShown = false;

  async function load() {
    try { state.file = (await rpc('exec.approvals.get', {}))?.file || {version: 1}; state.error = ''; }
    catch (error) { state.file = null; state.error = '读不到审批设置：' + String(error?.message || error); }
    state.loaded = true;
    paint();
  }
  // 在网关最新的那份文件上只改 agents.metre.allowlist，带 baseHash 写回；对不上就重读再来，最多 3 次。
  async function mutate(change) {
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = await rpc('exec.approvals.get', {});
      const file = JSON.parse(JSON.stringify(snap?.file || {version: 1}));
      file.agents = file.agents && typeof file.agents === 'object' ? file.agents : {};
      const agent = {...(file.agents[AGENT] || {})};
      const next = change(entriesOf(file));
      if (next.length) agent.allowlist = next; else delete agent.allowlist;
      file.agents[AGENT] = agent;
      try {
        const res = await rpc('exec.approvals.set', {file, ...(snap?.hash ? {baseHash: snap.hash} : {})});
        state.file = res?.file || file;
        return;
      } catch (error) {
        last = error;
        if (!/changed since last load|base hash/i.test(String(error?.message || error))) break;
      }
    }
    throw last || new Error('没写进去');
  }
  async function run(change, done) {
    if (state.busy) return;
    state.busy = true; state.error = ''; paint();
    try { await mutate(change); done?.(); }
    catch (error) { state.error = '没存上：' + String(error?.message || error); }
    state.busy = false;
    paint();
  }
  function add() {
    const pattern = String(input.value || '').trim();
    const why = problem(pattern, entriesOf(state.file));
    if (why) { state.note = why; state.confirmAll = false; paint(); input.focus(); return; }
    // 单独一个 *：等于把「先问你」整个关掉，先说清楚，再点一次才加。
    if (isAll(pattern) && !state.confirmAll) {
      state.confirmAll = true;
      state.note = '单独一个 * 会放行所有命令，以后不再问你。确定的话再点一次「确认放行全部」。';
      paint(); return;
    }
    state.note = ''; state.confirmAll = false;
    run((list) => (list.some((e) => key(e.pattern) === key(pattern)) ? list : [...list, {pattern}]), () => { input.value = ''; });
  }
  function remove(entry) {
    state.note = '';
    run((list) => list.filter((e) => (entry.id ? e.id !== entry.id : key(e.pattern) !== key(entry.pattern))));
  }
  function syncAdd() {
    const list = entriesOf(state.file);
    const typed = String(input.value || '').trim();
    if (state.confirmAll && !isAll(typed)) { state.confirmAll = false; if (/^单独一个/.test(state.note)) state.note = ''; }
    input.placeholder = '例如 ' + (EXAMPLES.find((x) => !list.some((e) => key(e.pattern) === x)) || 'pnpm');
    input.disabled = state.busy || !state.file;
    addBtn.disabled = input.disabled || !typed;
    addBtn.textContent = state.confirmAll ? '确认放行全部' : '加进清单';
  }

  function paint() {
    if (!card) return;
    card.hidden = !isMetre();
    if (card.hidden) return;
    const list = entriesOf(state.file);
    listEl.replaceChildren();
    if (state.loaded && state.file) {
      if (!list.length) listEl.append(node('p', S + 'soft-note', '清单是空的。'));
      for (const entry of list) {
        const all = isAll(entry.pattern);
        const row = node('div', S + 'row pk-metre-allow__item' + (all ? ' pk-metre-allow__item--all' : ''));
        const copy = node('div', S + 'row-copy');
        copy.append(all ? node('span', S + 'row-title', '全部命令（不再询问）') : pathTitle(entry.pattern));
        if (all) copy.append(node('span', S + 'hint', '清单里有单独一个 *：所有命令都直接跑。'));
        if (entry.argPattern) copy.append(node('span', S + 'hint', '参数：' + entry.argPattern));
        const control = node('div', S + 'row-control');
        const btn = node('button', S + 'button ' + S + 'button--small', '移除');
        btn.type = 'button'; btn.disabled = state.busy;
        btn.setAttribute('aria-label', '从允许清单里移除 ' + (all ? '全部命令' : entry.pattern));
        btn.addEventListener('click', () => remove(entry));
        control.append(btn); row.append(copy, control); listEl.append(row);
      }
    }
    const msg = state.error || state.note || (!state.loaded ? '正在读…' : state.file ? levelNote(state.file) : '');
    statusEl.textContent = msg;
    statusEl.dataset.tone = state.error || state.note ? 'warn' : '';
    syncAdd();
  }
  function mount(target) {
    if (!target || target.querySelector('.pk-metre-allow')) return;
    card = node('section', S + 'card pk-metre-allow');
    const head = node('header', S + 'card-header');
    const icon = node('span', S + 'icon', '♮'); icon.setAttribute('aria-hidden', 'true');
    head.append(icon, node('h3', S + 'card-title', '允许的命令'));
    card.append(head);
    statusEl = node('p', S + 'card-hint pk-metre-allow__status'); statusEl.setAttribute('role', 'status');
    listEl = node('div', 'pk-metre-allow__list'); listEl.setAttribute('aria-label', '允许清单');
    const addRow = node('div', S + 'row pk-metre-allow__add');
    const addCopy = node('div', S + 'row-copy');
    addCopy.append(node('span', S + 'row-title', '新加一条'));
    const addControl = node('div', S + 'row-control');
    input = node('input', S + 'messaging-input pk-metre-allow__input');
    input.type = 'text'; input.maxLength = MAX; input.spellcheck = false;
    input.setAttribute('aria-label', '要允许的命令');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
    input.addEventListener('input', syncAdd);
    addBtn = node('button', S + 'button ' + S + 'button--small', '加进清单'); addBtn.type = 'button';
    addBtn.addEventListener('click', add);
    addControl.append(input, addBtn);
    addRow.append(addCopy, addControl);
    const help = node('p', S + 'soft-note pk-metre-allow__help', '写命令名（git）或完整路径。* 不跨文件夹，** 跨任意层，大小写不分。这里加的不限参数。');
    card.append(statusEl, listEl, addRow, help);
    const footer = target.querySelector('.' + S + 'footer');
    footer ? footer.before(card) : target.append(card);
    paint();
  }
  // 弹层每次重新露出来（或切回 Metre）就重读一遍，别人在别处改过也看得到；看不见的时候什么都不做。
  function check() {
    const shown = Boolean(card && card.isConnected && isMetre() && !card.closest('[hidden]'));
    if (shown && !wasShown && !state.busy) load();
    wasShown = shown;
  }

  window.Pinkie.metreAllow = {reload: load};
  window.addEventListener('pinkie:settings-ready', (event) => { mount(event.detail); check(); });
  window.addEventListener('laolao:modechange', () => { paint(); check(); });
  const ready = () => { mount(document.querySelector('#laolao-user-settings .' + S + 'scroll')); check(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true}); else ready();
  window.Pinkie.domWatch?.poll(check, 1500);
})();
