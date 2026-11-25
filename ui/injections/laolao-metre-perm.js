/* laolao-metre-perm —— Metre 第五批「权限、计划、用量」（build\quick-run\对比-主流-Metre-1124.md 第五批）。只在 Metre 里起作用，其他五个模式一字不变。
 * 全部用原生已有的网关方法和碧琪插件已有的方法，不动内核：
 *   P1 审批卡：原生 openclaw-exec-approval（modal）。Metre 下换皮（laolao-metre-perm.css）＋中文标题；决定值照原生三个（允许一次 / 始终允许 / 拒绝）。
 *   P4 待批汇总：原生卡片只露第一条和「N 个待处理」。Metre 下在卡片里列出其余几条，每条单独「允许一次 / 拒绝」（exec / plugin.approval.resolve）。
 *      原生弹层是 showModal，弹着的时候页面别处点不到，所以汇总放在卡片里。
 *   P2 放手程度：exec.approvals.get / set（带 baseHash，整份写回）只改 agents.metre 的 security / ask。三档：自动（默认，full / off）、
 *      问我（allowlist / on-miss：不在允许清单里的命令先问）、不跑命令（deny）。不读写 allowlist——清单归 ui2 的 P3（status\engines.md 写了分界）。
 *      baseHash 对不上（别人刚写过）就重新 get、在新文件上只改这两项再写，最多试 3 次。
 *   N1 等你批时提醒：laolao-run-notify.js 只认五个碧琪模式的会话（SESSION 正则没有 metre），Metre 的审批不提醒。不改那个共用文件：
 *      这里收到 Metre 会话的 exec / plugin.approval.requested，照它对外的 decide() 判断，走同样的原生壳接口（标题「? 」、任务栏、系统通知）。
 *   I4 先出方案：pinkie.metre.planMode.get / set（services/mode-architecture/metre-plan-mode.mjs）。开着而且已经有计划时多一个「照这个方案做」。
 *   R3 计划进度、U2 额度、U3 本会话花费、R1 会话详情：按键行里一个状态键（计划 3 / 5、额度剩多少），点开是会话详情
 *      （模型、开始时间、工作目录、令牌、花费、计划、额度）。数据：pinkie.plan.get、usage.status、sessions.usage、pinkie.project.bind。
 *   A2 额度用完后自动接着做（并入 T3#14）：这一轮失败且 pinkie.model.failure 说是额度用完、给了恢复时间，就显示「几点恢复」，
 *      到点（加 20 秒）自动发一句「接着做」；用户自己先发了话、或点了「不自动接着做」就取消。
 * 按键行放不下时一步步收拢（见 build / fit），不把原生的键挤到下一行。重画时机：pinkie:run-view、pinkie:composer-chips、换会话、换模式、网关事件、窗口尺寸；额度每 5 分钟取一次（setTimeout 链）。不加循环定时器和观察器。 */
(() => {
  'use strict';
  if (window.PinkieMetrePerm) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const METRE = /^agent:metre:/;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const rpc = (method, params, ms = 12000) => {
    const r = window.__laolaoSidebar?.gwRequest;
    return r ? r(method, params || {}, ms) : Promise.reject(new Error('还没连上网关'));
  };
  const pane = () => document.querySelector('openclaw-chat-pane');
  const currentKey = () => {
    const k = pane()?.state?.sessionKey;
    if (k) return String(k);
    try { return new URL(location.href).searchParams.get('session') || ''; } catch { return ''; }
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
  const clip = (s, n) => { const a = [...String(s || '').replace(/\s+/g, ' ').trim()]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };
  const two = (n) => String(n).padStart(2, '0');
  const when = (ms) => {
    const d = new Date(ms); if (!Number.isFinite(d.getTime())) return '';
    const t = two(d.getHours()) + ':' + two(d.getMinutes());
    return d.toDateString() === new Date().toDateString() ? t : (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + t;
  };
  const tokens = (n) => (!Number.isFinite(n) ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
  const money = (n) => (!Number.isFinite(n) ? '—' : '$' + n.toFixed(n < 0.1 ? 3 : 2));

  // ---------- P2 放手程度 ----------
  const LEVELS = [
    {id: 'auto', name: '自动', hint: '命令直接跑（默认，和 Metre 一直以来一样）', security: 'full', ask: 'off'},
    {id: 'ask', name: '问我', hint: '不在允许清单里的命令，先弹出来问你', security: 'allowlist', ask: 'on-miss'},
    {id: 'off', name: '不跑命令', hint: '可以看、可以写方案，不跑任何命令', security: 'deny', ask: 'off'},
  ];
  function levelOf(file) {
    const a = file?.agents?.metre || {}, d = file?.defaults || {};
    const security = a.security ?? d.security ?? 'full', ask = a.ask ?? d.ask ?? 'off';
    return (LEVELS.find((l) => l.security === security && l.ask === ask) || {id: 'custom'}).id;
  }
  // 本批自己的读取哪几项没读到（网关没回 / 报错）：状态键说「没读到」，详情里列出来、对应行写「没读到」，并能重试。
  // 读到了但确实没有（没绑文件夹、账号没给额度数据）是常态，照旧那样写，不算没读到。
  const fails = new Set();
  async function loadLevel() {
    fails.delete('放手程度');
    try { state.level = levelOf((await rpc('exec.approvals.get', {}, 10000))?.file); } catch { state.level = null; fails.add('放手程度'); }
  }
  async function setLevel(id) {
    const lv = LEVELS.find((l) => l.id === id); if (!lv) throw new Error('没有这一档：' + id);
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = await rpc('exec.approvals.get', {}, 10000);
      const file = JSON.parse(JSON.stringify(snap?.file || {version: 1}));
      file.agents = file.agents && typeof file.agents === 'object' ? file.agents : {};
      file.agents.metre = {...(file.agents.metre || {}), security: lv.security, ask: lv.ask};
      try {
        await rpc('exec.approvals.set', {file, ...(snap?.hash ? {baseHash: snap.hash} : {})}, 10000);
        state.level = lv.id; paint(true); return lv.id;
      } catch (error) {
        last = error;
        if (!/changed since last load|base hash/i.test(String(error?.message || error))) break;   // 别人刚写过：重读再写
      }
    }
    throw last || new Error('没写进去');
  }

  // ---------- 状态 ----------
  const state = {key: '', level: null, planOn: false, plan: null, quota: null, usage: null, folder: '', resume: null, error: ''};
  const RESUME_OFF = 'pinkie.metre.autoResume.off';
  // 存储读不了（隐私模式、无源页面）就当没关过自动接着做，不让整段失效
  const resumeOff = () => { try { return localStorage.getItem(RESUME_OFF) === '1'; } catch { return false; } };
  const setResumeOff = (on) => { try { if (on) localStorage.setItem(RESUME_OFF, '1'); else localStorage.removeItem(RESUME_OFF); } catch {} };
  async function loadPlanMode(key) { fails.delete('先出方案'); try { state.planOn = (await rpc('pinkie.metre.planMode.get', {sessionKey: key}, 8000))?.on === true; } catch { state.planOn = false; fails.add('先出方案'); } }
  async function loadPlan(key) { try { state.plan = (await rpc('pinkie.plan.get', {sessionKey: key}, 8000))?.plan || null; } catch { state.plan = null; } }
  async function loadUsage(key) {
    fails.delete('用量');
    try {
      const res = await rpc('sessions.usage', {key}, 15000);
      const s = (res?.sessions || []).find((x) => x?.key === key) || res?.sessions?.[0] || null;
      state.usage = s ? {model: s.model || s.modelOverride || '', provider: s.modelProvider || s.providerOverride || '', ...(s.usage || {})} : null;
    } catch { state.usage = null; fails.add('用量'); }
    fails.delete('工作目录');
    try { state.folder = String((await rpc('pinkie.project.bind', {key}, 8000))?.binding?.root || ''); } catch { state.folder = ''; fails.add('工作目录'); }
  }
  async function loadQuota() {
    fails.delete('额度');
    try {
      const res = await rpc('usage.status', {}, 10000);
      let best = null;
      for (const p of res?.providers || []) for (const w of p?.windows || []) {
        if (!Number.isFinite(w?.usedPercent)) continue;
        const remaining = Math.max(0, Math.round(100 - w.usedPercent));
        if (!best || remaining < best.remaining) best = {provider: p.displayName || p.provider || '', label: w.label || '', remaining, resetAt: w.resetAt || null};
      }
      state.quota = best;
    } catch { state.quota = null; fails.add('额度'); }
  }
  let quotaTimer = 0;
  const quotaLoop = () => { clearTimeout(quotaTimer); quotaTimer = setTimeout(async () => { if (isMetre()) { await loadQuota(); paint(true); } quotaLoop(); }, 5 * 60_000); };

  async function refresh() {
    const key = currentKey();
    if (!isMetre() || !METRE.test(key)) { state.key = key; paint(true); return; }
    if (key !== state.key) { state.key = key; state.plan = null; state.usage = null; state.folder = ''; }
    await Promise.all([loadLevel(), loadPlanMode(key), loadPlan(key), loadQuota(), loadUsage(key)]);
    paint(true);
  }

  // ---------- A2 额度用完后到点接着做 ----------
  function cancelResume(why) {
    if (!state.resume) return;
    clearTimeout(state.resume.timer); state.resume = why === 'off' ? {...state.resume, timer: 0, off: true} : null; paint(true);
  }
  function scheduleResume(key, at) {
    if (state.resume?.timer) clearTimeout(state.resume.timer);
    const off = resumeOff();
    const fire = async () => {
      const r = state.resume; if (!r || r.key !== key || r.off) return;
      state.resume = null; paint(true);
      try { await rpc('chat.send', {sessionKey: key, message: '额度恢复了，接着做刚才没做完的。', idempotencyKey: uid()}, 30000); } catch {}
    };
    state.resume = {key, at, off, timer: off ? 0 : setTimeout(fire, Math.max(0, at - Date.now()) + 20_000)};
    paint(true);
  }
  async function checkFailure(key) {
    try {
      const f = (await rpc('pinkie.model.failure', {sessionKey: key}, 10000))?.failure;
      const at = Date.parse(f?.resetAt || '');
      if (f && f.kind === 'account' && Number.isFinite(at) && at > Date.now()) scheduleResume(key, at);
    } catch {}
  }

  // ---------- N1 等你批时提醒（Metre 会话） ----------
  let titled = false; const toldIds = new Set();
  function setAskTitle() { if (!String(document.title).startsWith('? ')) document.title = '? ' + String(document.title).replace(/^[✓!?] /, ''); titled = true; }
  function clearAskTitle() { if (titled && String(document.title).startsWith('? ')) document.title = String(document.title).slice(2); titled = false; }
  function sessionName(key) {
    const row = [...document.querySelectorAll('[data-session-key]')].find((n) => n.dataset.sessionKey === key);
    return clip(row?.querySelector('.sidebar-recent-session__name')?.textContent || '', 30) || 'Metre';
  }
  function notifyAsk(id, key, command) {
    const rn = window.__pinkieRunNotify;
    if (!rn?.decide || (id && toldIds.has(id))) return;
    if (id) { toldIds.add(id); if (toldIds.size > 200) toldIds.delete(toldIds.values().next().value); }
    const plan = rn.decide({outcome: 'ask', isVisible: !document.hidden, isCurrent: key === currentKey(), durationMs: 0, prefs: rn.prefs, notify: rn.notify});
    if (plan.title) setAskTitle();
    if (plan.attention) {
      try { window.webkit?.messageHandlers?.laolaoWindowControl?.postMessage({action: 'attention', kind: 'ask'}); } catch {}
      try { window.pywebview?.api?.request_attention?.('ask'); } catch {}
    }
    if (plan.system) {
      const body = command ? '要跑一条命令，等你批：' + clip(command, 40) : 'Metre 在等你批一下';
      const native = window.webkit?.messageHandlers?.pinkieNotify || (typeof window.pywebview?.api?.notify === 'function' ? {postMessage: (m) => window.pywebview.api.notify(m)} : null);
      if (native) { try { native.postMessage({title: sessionName(key), body, sessionKey: key}); } catch {} }
      else if (typeof window.Notification === 'function' && window.Notification.permission === 'granted') {
        try { const n = new window.Notification(sessionName(key), {body, tag: 'pinkie-approval-' + key}); n.onclick = () => { try { window.focus(); } catch {} window.__laolaoSidebar?.navigateSession?.(key); }; } catch {}
      }
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) clearAskTitle(); });

  // ---------- P1 / P4 审批卡 ----------
  const approvalHost = () => document.querySelector('openclaw-exec-approval');
  const META_ZH = Object.freeze({
    key: {CWD: '工作目录', cwd: '工作目录', '已解析': '实际程序'},
    '安全': {full: '不限', allowlist: '只跑允许清单里的', deny: '不跑命令'},
    '询问策略': {off: '不问', 'on-miss': '不在清单里就问', always: '每次都问'},
    '代理': {metre: 'Metre'},
  });
  // 副标题：原生按 Ns / Nm / Nh 拼「{time} 后过期」（中文包里单位也是英文缩写），这里给中文别名，只改显示
  const UNIT_ZH = Object.freeze({s: '秒', m: '分钟', h: '小时'});
  const subZh = (t) => { const m = t.match(/^(?:expires in )?(\d+)([smh])(?: 后过期)?$/); return m ? `${m[1]} ${UNIT_ZH[m[2]]}后过期` : /^(?:expired|已过期)$/.test(t) ? '已过期' : ''; };
  async function decide(item, decision, row) {
    row?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await rpc(item.kind === 'plugin' ? 'plugin.approval.resolve' : 'exec.approval.resolve', {id: item.id, decision}, 15000);
      if (row) row.querySelector('.pk-perm-q__acts').replaceChildren(el('span', 'pk-perm-q__done', decision === 'deny' ? '已拒绝' : '已允许'));
    } catch (error) {
      row?.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      if (row) row.dataset.error = '没批成：' + clip(error?.message || error, 40);
    }
  }
  function paintApproval() {
    const host = approvalHost(), card = host?.querySelector('.exec-approval-card');
    if (!card) return;
    const mine = card.querySelector(':scope > .pk-perm-q');
    if (!isMetre()) { mine?.remove(); return; }
    const queue = Array.isArray(host.props?.queue) ? host.props.queue : [];
    const title = card.querySelector('.exec-approval-title');
    if (title && queue[0]) title.dataset.pkTitle = queue[0].kind === 'plugin' ? '一个插件在等你批' : '要跑一条命令，等你批';
    const sub = card.querySelector('.exec-approval-sub');
    if (sub) { const z = subZh(sub.textContent.trim()); if (z) sub.dataset.pkZh = z; else delete sub.dataset.pkZh; }
    // 详情区的英文标签和值：按当前文字给中文别名（每次重画都重算，原生换了下一条也跟着对）
    for (const r of card.querySelectorAll('.exec-approval-meta-row')) {
      const [k, v] = r.children; if (!k || !v) continue;
      const kt = k.textContent.trim(), vt = v.textContent.trim();
      const alias = (e, a) => { if (a) e.dataset.pkZh = a; else delete e.dataset.pkZh; };
      alias(k, META_ZH.key[kt]); alias(v, (META_ZH[kt] || {})[vt]);
    }
    const rest = queue.slice(1);
    if (!rest.length) { mine?.remove(); return; }
    const sig = rest.map((q) => q.id).join('|');
    if (mine?.dataset.sig === sig) return;
    const box = el('section', 'pk-perm-q'); box.dataset.sig = sig; box.setAttribute('aria-label', '其余在等你批的');
    box.append(el('div', 'pk-perm-q__head', `还有 ${rest.length} 处在等你批`));
    for (const q of rest) {
      const row = el('div', 'pk-perm-q__row');
      const text = q.kind === 'plugin' ? (q.pluginTitle || '插件审批') : (q.request?.command || '');
      const who = q.request?.sessionKey ? sessionName(q.request.sessionKey) : '';
      const info = el('div', 'pk-perm-q__info');
      info.append(el('code', 'pk-perm-q__cmd', clip(text, 80)));
      if (who) info.append(el('span', 'pk-perm-q__who', who));
      const acts = el('div', 'pk-perm-q__acts');
      const allowed = q.request?.allowedDecisions?.length ? q.request.allowedDecisions : ['allow-once', 'deny'];
      if (allowed.includes('allow-once')) { const b = el('button', 'pk-perm-q__btn pk-perm-q__btn--yes', '允许一次'); b.type = 'button'; b.onclick = () => void decide(q, 'allow-once', row); acts.append(b); }
      if (allowed.includes('deny')) { const b = el('button', 'pk-perm-q__btn', '拒绝'); b.type = 'button'; b.onclick = () => void decide(q, 'deny', row); acts.append(b); }
      row.append(info, acts); box.append(row);
    }
    if (mine) mine.replaceWith(box);
    else card.querySelector('.exec-approval-actions')?.before(box);
  }
  // 卡片开着时每秒对一次过期时间（一次性 setTimeout 链；卡片关了、离开 Metre 就停，不加循环定时器和观察器）
  let subTimer = 0;
  const subTick = () => { clearTimeout(subTimer); if (!isMetre() || !approvalHost()?.querySelector('.exec-approval-card')) return; paintApproval(); subTimer = setTimeout(subTick, 1000); };
  const approvalSoon = () => { for (const ms of [30, 250, 800]) setTimeout(paintApproval, ms); setTimeout(subTick, 900); };
  document.addEventListener('animationstart', (e) => { if (e.animationName === 'pk-perm-born') approvalSoon(); }, true);

  // ---------- 按键行 ----------
  let menu = null;
  function closeMenu() { menu?.remove(); menu = null; document.querySelectorAll('.pk-perm-chip[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
  function place(pop, anchor) {
    document.body.append(pop);
    const a = anchor.getBoundingClientRect(), r = pop.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, innerWidth - r.width - 8));
    const top = a.top - r.height - 8 >= 8 ? a.top - r.height - 8 : Math.min(a.bottom + 8, innerHeight - r.height - 8);
    pop.style.left = Math.round(left) + 'px'; pop.style.top = Math.round(top) + 'px';
  }
  function openLevelMenu(btn) {
    closeMenu();
    menu = el('div', 'pk-perm-pop pk-perm-pop--menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '放手程度');
    menu.append(el('div', 'pk-perm-pop__title', '放手程度'), el('div', 'pk-perm-pop__sub', '只管 Metre 跑命令要不要先问你；允许清单在设置里'));
    for (const lv of LEVELS) {
      const item = el('button', 'pk-perm-pop__item'); item.type = 'button'; item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', String(state.level === lv.id));
      item.append(el('span', 'pk-perm-pop__name', lv.name), el('span', 'pk-perm-pop__hint', lv.hint));
      item.onclick = async () => {
        item.disabled = true;
        try { await setLevel(lv.id); closeMenu(); window.__laolaoSidebar?.toast?.('放手程度：' + lv.name); }
        catch (error) { item.disabled = false; window.__laolaoSidebar?.toast?.('没改成：' + clip(error?.message || error, 50)); }
      };
      menu.append(item);
    }
    btn.setAttribute('aria-expanded', 'true'); place(menu, btn);
    menu.querySelector('[aria-checked="true"], .pk-perm-pop__item')?.focus();
  }
  function detailRow(name, value) { const r = el('div', 'pk-perm-pop__row'); r.append(el('span', 'pk-perm-pop__k', name), el('span', 'pk-perm-pop__v', value || '—')); return r; }
  function planCounts(plan) {
    const items = Array.isArray(plan?.items) ? plan.items : [];
    return {total: items.length, done: items.filter((i) => i?.status === 'completed').length, now: items.find((i) => i?.status === 'in_progress')?.text || ''};
  }
  function openDetail(btn) {
    closeMenu();
    menu = el('div', 'pk-perm-pop pk-perm-pop--detail'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '会话详情');
    menu.append(el('div', 'pk-perm-pop__title', '会话详情'));
    if (fails.size) {
      const bad = el('div', 'pk-perm-pop__fail');
      // 清单用详情里看得到的行名：「用量」一项对应模型、开始、令牌、花费四行（look.py 场景三轮：清单写「用量」、行里写模型 / 开始，对不上）
      const shown = {用量: '会话信息（模型、开始、令牌、花费）'};
      bad.append(el('span', '', [...fails].map((k) => shown[k] || k).join('、') + '没读到（网关没回）'));
      const again = el('button', 'pk-perm-pop__btn', '重试'); again.type = 'button';
      again.onclick = async () => { again.disabled = true; await refresh(); const now = document.querySelector('.pk-perm-chip--stat'); if (now) openDetail(now); else closeMenu(); };
      bad.append(again); menu.append(bad);
    }
    const u = state.usage || {};
    const miss = (k) => fails.has(k) ? '没读到' : '';
    const pc = planCounts(state.plan);
    if (pc.total) {
      const plan = el('div', 'pk-perm-pop__plan');
      plan.append(el('div', 'pk-perm-pop__k', `计划 ${pc.done} / ${pc.total}` + (pc.now ? ' · ' + clip(pc.now, 28) : '')));
      const bar = el('div', 'pk-perm-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(pc.total)); bar.setAttribute('aria-valuenow', String(pc.done));
      const fill = el('i'); fill.style.width = Math.round(pc.done / pc.total * 100) + '%'; bar.append(fill); plan.append(bar); menu.append(plan);
    }
    menu.append(
      detailRow('模型', miss('用量') || [u.provider, u.model].filter(Boolean).join(' / ')),
      detailRow('开始', miss('用量') || (Number.isFinite(u.firstActivity) ? when(u.firstActivity) : '')),
      detailRow('工作目录', miss('工作目录') || state.folder || '没绑文件夹'),
      detailRow('本会话令牌', miss('用量') || tokens(u.totalTokens) + (Number.isFinite(u.input) ? `（读 ${tokens(u.input)} · 写 ${tokens(u.output)}）` : '')),
      detailRow('本会话花费', miss('用量') || money(u.totalCost) + (Number.isFinite(u.totalCost) ? '（估算）' : '')),
      detailRow('额度', miss('额度') || (state.quota ? `${state.quota.provider} ${state.quota.label} 还剩 ${state.quota.remaining}%` + (state.quota.resetAt ? ` · ${when(state.quota.resetAt)} 重置` : '') : '这个账号没给额度数据')),
    );
    if (fold >= 2) {
      const lv = LEVELS.find((l) => l.id === state.level);
      const go = state.planOn && pc.total > 0;
      const acts = el('div', 'pk-perm-pop__acts');
      const lvb = el('button', 'pk-perm-pop__btn', '放手程度：' + (lv ? lv.name : state.level === 'custom' ? '自定义' : '未知')); lvb.type = 'button';
      lvb.setAttribute('aria-haspopup', 'menu'); lvb.onclick = () => openLevelMenu(btn);
      const pb = el('button', 'pk-perm-pop__btn', '先出方案：' + (state.planOn ? '开' : '关')); pb.type = 'button'; pb.setAttribute('aria-pressed', String(state.planOn));
      pb.onclick = async () => { pb.disabled = true; await togglePlan(); const now = document.querySelector('.pk-perm-chip--stat'); if (now) openDetail(now); };
      acts.append(lvb, pb);
      if (go) { const g = el('button', 'pk-perm-pop__btn pk-perm-pop__btn--go', '照这个方案做'); g.type = 'button'; g.onclick = () => { closeMenu(); void approvePlan(); }; acts.append(g); }
      menu.insertBefore(acts, menu.children[1] || null);
    }
    const r = state.resume;
    if (r && r.key === state.key) {
      const box = el('div', 'pk-perm-pop__resume');
      box.append(el('span', '', r.off ? `额度用完了，${when(r.at)} 恢复（不自动接着做）` : `额度用完了，${when(r.at)} 恢复后自动接着做`));
      const b = el('button', 'pk-perm-pop__btn', r.off ? '到点自动接着做' : '不自动接着做'); b.type = 'button';
      b.onclick = () => {
        if (r.off) { setResumeOff(false); scheduleResume(r.key, r.at); }
        else { setResumeOff(true); cancelResume('off'); }
        openDetail(btn);
      };
      box.append(b); menu.append(box);
    }
    btn.setAttribute('aria-expanded', 'true'); place(menu, btn);
  }
  async function togglePlan() {
    const key = state.key; if (!METRE.test(key)) return;
    try { state.planOn = (await rpc('pinkie.metre.planMode.set', {sessionKey: key, on: !state.planOn}, 8000))?.on === true; }
    catch (error) { window.__laolaoSidebar?.toast?.('没改成：' + clip(error?.message || error, 50)); }
    paint(true);
  }
  async function approvePlan() {
    const key = state.key;
    try {
      await rpc('pinkie.metre.planMode.set', {sessionKey: key, on: false}, 8000); state.planOn = false; paint(true);
      await rpc('chat.send', {sessionKey: key, message: '照这个方案做。', idempotencyKey: uid()}, 30000);
    } catch (error) { window.__laolaoSidebar?.toast?.('没发出去：' + clip(error?.message || error, 50)); }
  }
  function chip(cls, label, tip, onclick) {
    const b = el('button', 'pk-eng-chip pk-perm-chip ' + cls); b.type = 'button';
    b.append(el('span', 'pk-eng-chip__name', label));
    if (tip) { b.dataset.pinkieTooltip = tip; b.setAttribute('aria-label', label + '：' + tip); }
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onclick(b); };
    return b;
  }
  function statText() {
    const r = state.resume;
    if (r && r.key === state.key) return {text: `${when(r.at)} 恢复`, tone: 'warn'};
    if (fails.size) return {text: '没读到', tone: 'warn'};
    const pc = planCounts(state.plan), q = state.quota;
    const parts = [];
    if (pc.total) parts.push(`计划 ${pc.done} / ${pc.total}`);
    if (q) parts.push(`额度 ${q.remaining}%`);
    return {text: parts.join(' · ') || '详情', tone: q && q.remaining <= 10 ? 'danger' : q && q.remaining <= 25 ? 'warn' : ''};
  }
  // 按键行的宽度预算：输入框下这一行还有原生的模型键、碧琪的 Baton / Virtuoso 键（1280 宽真页面上 Metre 键和模型键之间只剩约 50px）。
  // 本批的键不许把原生的键挤到下一行、让输入框往上跳。插进去以后量输入框高度，变高了就一步步收拢：
  //   0 全露 → 1 状态键只留「详情」→ 2 只留「详情」一个键（放手程度、先出方案、照这个方案做挪进会话详情）→ 3 只留「⋯」→ 4 连「⋯」都放不下就整组藏起来（linux 字体更宽，CI 真页面 1280 宽「⋯」也放不下；宽度够了下次重量自动展开）。
  let sig = '', fold = 0;
  function build(f) {
    if (f >= 4) { const b = el('span', 'pk-perm-chips'); b.dataset.fold = '4'; b.setAttribute('aria-hidden', 'true'); return b; }
    const lv = LEVELS.find((l) => l.id === state.level);
    const pc = planCounts(state.plan), st = statText();
    const go = state.planOn && pc.total > 0;
    const box = el('span', 'pk-perm-chips'); box.dataset.fold = String(f);
    if (f < 2) {
      const level = chip('pk-perm-chip--level', lv ? lv.name : state.level === 'custom' ? '自定义' : '放手程度', '放手程度：Metre 跑命令之前要不要先问你', openLevelMenu);
      level.setAttribute('aria-haspopup', 'menu'); level.setAttribute('aria-expanded', 'false');
      const plan = chip('pk-perm-chip--plan', '先出方案', '打开后 Metre 先写方案给你看，你点「照这个方案做」才动手', () => void togglePlan());
      plan.setAttribute('aria-pressed', String(state.planOn));
      box.append(level, plan);
      // 多出「照这个方案做」时状态键只留「详情」两个字
      if (go) box.append(chip('pk-perm-chip--go', '照这个方案做', '关掉「先出方案」，让 Metre 照计划动手', () => void approvePlan()));
    }
    const label = f >= 3 ? '⋯' : (f >= 1 || go) ? '详情' : st.text;
    const tip = f >= 2 ? '会话详情：放手程度、先出方案、模型、开始时间、工作目录、令牌、花费、计划和额度' : '会话详情：模型、开始时间、工作目录、令牌、花费、计划和额度';
    const stat = chip('pk-perm-chip--stat', label, tip, openDetail);
    if (st.tone) stat.dataset.tone = st.tone;
    stat.setAttribute('aria-haspopup', 'dialog'); stat.setAttribute('aria-expanded', 'false');
    box.append(stat);
    return box;
  }
  // 按键行里各键同为 order 6，按 DOM 先后排。引擎台的 Metre 键可能比本批晚插进来（时序竞争：先画的本批键落到 Baton / Metre 前面），
  // 所以每次画、每次延后重量都核对一次：Metre 键在就紧跟在它后面。
  function seat(controls, box) {
    const eng = controls.querySelector(':scope > .pk-eng-chip');
    if (eng) { if (eng.nextElementSibling !== box) eng.after(box); }
    else if (box.parentElement !== controls) controls.append(box);
  }
  function fit() {
    const controls = document.querySelector('.chat-main .agent-chat__composer-controls');
    const box = controls?.querySelector(':scope > .pk-perm-chips'), input = controls?.closest('.agent-chat__input');
    if (box) seat(controls, box);
    if (!box || !input || (box.dataset.fold !== '4' && getComputedStyle(box).display === 'none')) return;
    // 这一行只有本批的键时（别的键都没出来），多出来的高度是本行自己的，不是换行：全露、不收拢
    const others = [...controls.children].some((c) => c !== box && c.getBoundingClientRect().height > 0);
    if (!others) { if (fold !== 0 || box.dataset.fold !== '0') { const nb = build(0); box.replaceWith(nb); } fold = 0; return; }
    const h = () => input.getBoundingClientRect().height;
    box.style.display = 'none'; const h0 = h(); box.style.display = '';
    if (fold === 0 && h() <= h0 + 1) return;
    let cur = box;
    for (let f = 0; f <= 4; f++) {
      if (f !== Number(cur.dataset.fold)) { const nb = build(f); cur.replaceWith(nb); cur = nb; }
      fold = f;
      if (h() <= h0 + 1) break;
    }
  }
  // 原生模型名是后到的、思考档位键第一次点页面会变宽：画完以后隔一会儿再量几次（一次性的 setTimeout，不加循环定时器和观察器）
  function fitSoon() { for (const ms of [60, 400, 1500]) setTimeout(fit, ms); }
  function paint(force) {
    const controls = document.querySelector('.chat-main .agent-chat__composer-controls');
    const old = controls?.querySelector(':scope > .pk-perm-chips');
    if (!controls || !isMetre() || !METRE.test(state.key || currentKey())) { old?.remove(); sig = ''; return; }
    const pc = planCounts(state.plan);
    const next = JSON.stringify([state.level, state.planOn, pc.total > 0, statText()]);
    if (!force && old && next === sig) return;
    sig = next;
    const box = build(fold);
    if (old) old.replaceWith(box);
    seat(controls, box);
    fit(); fitSoon();
  }

  // ---------- 事件 ----------
  document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest?.('.pk-perm-chip')) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) { closeMenu(); e.stopPropagation(); } }, true);
  window.addEventListener('pinkie:gateway-event', (event) => {
    const {event: name, payload} = event.detail || {};
    if (!payload) return;
    if (/^(?:exec|plugin)\.approval\.(?:requested|resolved)$/.test(String(name))) {
      approvalSoon();
      const key = String(payload.request?.sessionKey || payload.sessionKey || '');
      if (/requested$/.test(name) && METRE.test(key)) notifyAsk(String(payload.id || ''), key, payload.request?.command || '');
      return;
    }
    const key = String(payload.sessionKey || '');
    if (!METRE.test(key)) return;
    const data = payload.data || {};
    if ((name === 'agent' || name === 'session.tool') && payload.stream === 'tool' && /plan_update|update_plan/.test(String(data.name || data.toolName || ''))) {
      if (key === state.key) setTimeout(async () => { await loadPlan(key); paint(); }, 300);
    }
    if (name === 'agent' && payload.stream === 'lifecycle' && data.phase === 'start' && state.resume?.key === key && state.resume.timer) cancelResume();
    if (name === 'chat' && payload.state === 'error') void checkFailure(key);
    if (name === 'chat' && payload.state === 'final' && key === state.key) setTimeout(async () => { await loadUsage(key); paint(); }, 600);
  });
  window.addEventListener('pinkie:run-view', () => paint());
  window.addEventListener('pinkie:composer-chips', () => paint(true));
  window.addEventListener('pinkie:session-selected', () => { closeMenu(); void refresh(); });
  window.addEventListener('laolao:modechange', () => { closeMenu(); void refresh(); approvalSoon(); });
  window.addEventListener('pinkie:sidebar-gateway-ready', () => void refresh());
  window.addEventListener('resize', () => { closeMenu(); fitSoon(); });
  document.addEventListener('pointerup', () => fitSoon(), {once: true, capture: true});
  setTimeout(() => void refresh(), 600);
  quotaLoop();

  window.PinkieMetrePerm = Object.freeze({refresh, paint, fit, paintApproval, setLevel, levelOf, LEVELS, scheduleResume, notifyAsk, snapshot: () => JSON.parse(JSON.stringify({...state, resume: state.resume && {key: state.resume.key, at: state.resume.at, off: !!state.resume.off, armed: !!state.resume.timer}}))});
})();
