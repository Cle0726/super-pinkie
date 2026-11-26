// 工作台「每个聊天会话一个终端」（R2，briefs/program-1120/设计-R2.md）的纯逻辑：
// 会话 ↔ 终端对应表、LRU 停放上限、按 shell 生成 cd、上报前的环境变量打码。挂在 window.Pinkie.workbench.term。
// 人手敲的终端不走 P2 / P3 审批；这里不给模型任何往终端里输入的路径。模型要跑命令走 I6 的 pinkie.shell.run，
// 不直接调 terminal.input——以后要让模型「在终端里打字」，也必须转到 pinkie.shell.run 那条路。
(() => {
  const ns = (window.Pinkie = window.Pinkie || {});
  const bench = (ns.workbench = ns.workbench || {});
  if (bench.term) return;

  const STORE_KEY = 'pinkie.terminal.bySession.v1';
  const MAX_PER_WINDOW = 8;
  // 最近这么久内有输出就算「在跑」，LRU 不关它。
  const BUSY_MS = 5000;
  const TEXT = Object.freeze({
    open: '打开终端',
    title: folder => `本会话终端 · ${folder}`,
    evicted: name => `已关闭 ${name} 的终端（最久未用）`,
    full: '终端开太多了，先关一个',
    sandboxed: '当前会话在沙箱里运行，终端不可用',
    manualCd: '路径含特殊字符，请手动 cd',
  });

  // cd 按 terminal.open 返回的 result.shell 判断，不看界面所在平台（远端网关可能是另一台系统）。换行统一 \r。
  function shellKind(shell) {
    const s = String(shell || '').trim().toLowerCase().replace(/^"|"$/g, '');
    if (/(^|[\\/])cmd(\.exe)?$/.test(s)) return 'cmd';
    if (/pwsh|powershell/.test(s)) return 'powershell';
    return 'posix';
  }
  function cdCommand(shell, root) {
    const dir = String(root ?? '');
    const kind = shellKind(shell);
    if (!dir) return {kind, text: null, refuse: null};
    if (kind === 'cmd') {
      if (/[%"]/.test(dir)) return {kind, text: null, refuse: TEXT.manualCd};
      return {kind, text: `cd /d "${dir}" && cls\r`, refuse: null};
    }
    if (kind === 'powershell') return {kind, text: `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'; Clear-Host\r`, refuse: null};
    return {kind, text: `cd -- '${dir.replace(/'/g, "'\\''")}' && clear\r`, refuse: null};
  }

  // 上报给模型之前打码：NAME=value 里 NAME 含这些词（不分大小写）就只留名字。内核侧过滤（patch/apply-terminal-env.mjs）这一版不做。
  const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;
  function maskEnv(text) {
    return String(text ?? '').replace(/^([ \t]*(?:export[ \t]+|set[ \t]+|\$env:)?)([A-Za-z_][A-Za-z0-9_]*)([ \t]*=[ \t]*)(.*)$/gm,
      (line, lead, name, eq, value) => (SECRET_NAME.test(name) && value !== '' ? `${lead}${name}${eq}***` : line));
  }

  // 对应表：sessionKey → {id, root, name, seenAt, outputAt}，只存 sessionStorage。
  // 原生 terminal.list 是哪些终端还活着的唯一事实来源：恢复时先 reconcile 一遍，不在的删掉。
  function createRegistry({storage = window.sessionStorage, max = MAX_PER_WINDOW, now = () => Date.now()} = {}) {
    const map = new Map();
    try {
      const raw = JSON.parse(storage?.getItem(STORE_KEY) || '{}');
      for (const [key, item] of Object.entries(raw || {})) if (key && item && typeof item.id === 'string' && item.id) map.set(key, {...item});
    } catch {}
    const save = () => { try { storage?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(map))); } catch {} };
    const keyOfId = id => { for (const [key, item] of map) if (item.id === id) return key; return null; };
    const idle = item => !(now() - (item.outputAt || 0) < BUSY_MS);
    return {
      get: key => (map.has(key) ? {...map.get(key)} : null),
      keyOf: keyOfId,
      size: () => map.size,
      entries: () => [...map].map(([key, item]) => ({key, ...item})),
      set(key, id, {root = '', name = ''} = {}) {
        const old = keyOfId(id);
        if (old && old !== key) map.delete(old);
        map.set(key, {id, root, name, seenAt: now(), outputAt: 0});
        save();
      },
      touch(key) { const item = map.get(key); if (item) { item.seenAt = now(); save(); } },
      noteOutput(id) { const key = keyOfId(id); if (key) map.get(key).outputAt = now(); },
      remove(key) { const item = map.get(key); if (!item) return null; map.delete(key); save(); return item.id; },
      removeId(id) { const key = keyOfId(id); if (key) { map.delete(key); save(); } return key; },
      reconcile(liveIds) {
        const live = new Set((liveIds || []).map(String));
        const dropped = [];
        for (const [key, item] of map) if (!live.has(item.id)) { map.delete(key); dropped.push(key); }
        if (dropped.length) save();
        return dropped;
      },
      // 给 key 开新终端之前调用：没满 → ok；满了 → 关最久没看的空闲那个；全在跑 → 不关，给提示。
      makeRoom(key) {
        if (map.has(key) || map.size < max) return {ok: true, evict: null, notice: null};
        const victim = [...map].filter(([k, item]) => k !== key && idle(item)).sort((a, b) => (a[1].seenAt || 0) - (b[1].seenAt || 0))[0];
        if (!victim) return {ok: false, evict: null, notice: TEXT.full};
        const [vKey, vItem] = victim;
        map.delete(vKey);
        save();
        return {ok: true, evict: {key: vKey, id: vItem.id}, notice: TEXT.evicted(vItem.name || vKey)};
      },
    };
  }

  // 原生报 terminal session limit reached / 沙箱拒绝时落成面板上的一行提示，不弹框。
  function noticeForError(error) {
    const msg = String(error?.message || error || '');
    if (/terminal session limit reached/i.test(msg)) return TEXT.full;
    if (/sandbox/i.test(msg)) return TEXT.sandboxed;
    return null;
  }

  // 终端现场（从 laolao-workbench.js 搬来）：去掉控制序列、只记已回车的命令、上报前打码；只报本会话那一个。
  const plainText = value => String(value || '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[@-_]/g, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  function createContext({max = 12, now = () => Date.now()} = {}) {
    const items = new Map();
    return {
      get: id => items.get(id) || null,
      // terminal.open / attach 成功：挂在发起请求那一刻的会话上。切会话不改 key（以前 :468-471 会把同文件夹的终端改到新会话上）。
      adopt(id, key, root, initialCwd, buffer) {
        if (!id) return false;
        let item = items.get(id);
        if (!item || item.root !== root || item.key !== key) item = {sessionId: id, key, root, initialCwd, raw: '', draft: '', command: '', exitCode: null, updatedAt: 0};
        if (buffer) { item.raw = String(buffer).slice(-18000); item.updatedAt = now(); }
        items.set(id, item);
        if (items.size > max) items.delete(items.keys().next().value);
        return true;
      },
      // 记录已经回车的命令；未提交的输入不发送给模型。
      input(id, data) {
        const item = items.get(id);
        if (!item) return false;
        for (const ch of String(data).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')) {
          if (ch === '\r' || ch === '\n') {
            if (item.draft.trim()) { item.command = item.draft.trim().slice(-800); item.raw = ''; item.exitCode = null; item.updatedAt = now(); }
            item.draft = '';
          } else if (ch === '\x7f' || ch === '\b') item.draft = item.draft.slice(0, -1);
          else if (ch === '\x03' || ch === '\x15') item.draft = '';
          else if (ch >= ' ') item.draft = (item.draft + ch).slice(-2000);
        }
        return true;
      },
      event(name, payload) {
        const item = items.get(payload?.sessionId);
        if (!item) return false;
        if (name === 'terminal.data' && typeof payload.data === 'string') item.raw = (item.raw + payload.data).slice(-18000);
        else if (name === 'terminal.exit') item.exitCode = Number.isInteger(payload.exitCode) ? payload.exitCode : null;
        else return false;
        item.updatedAt = now();
        return true;
      },
      snapshot: (key, root) => [...items.values()].filter(t => t.key === key && t.root === root && t.updatedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 1)
        .map(t => ({sessionKey: key, sessionId: t.sessionId, initialCwd: t.initialCwd, command: maskEnv(t.command), output: maskEnv(plainText(t.raw)).slice(-6000), exitCode: t.exitCode, updatedAt: t.updatedAt})),
    };
  }

  // 接线（第二步）：工作台把网关请求交进来，这里只做「停放 / 接回 / 新开 / 腾位置」的决定。
  // 原生 openclaw-terminal-panel 挂上时读 sessionStorage 的 PANEL_KEY：里面的 id 先 terminal.list 对一遍再 attach，
  // 一个都没接上就自己新开一个。所以「挂之前按会话写好 PANEL_KEY」就是「接回本会话那一个 / 给本会话新开」。
  // 这里不发按键：cd 只算出文本，由工作台走和人手按键同一条路发出去。
  const PANEL_KEY = 'openclaw.terminal.sessions.v1';
  function createController({request, storage = window.sessionStorage, registry = createRegistry({storage}), nameOf = key => key} = {}) {
    const liveIds = async () => ((await request('terminal.list', {}))?.sessions || []).map(s => String(s?.sessionId || ''));
    return {
      registry,
      // 切走前：记下本会话正在用的那个终端（不关）；没有在线的就从表里拿掉。
      park(key, id, root = '') {
        if (!key) return;
        if (id) registry.set(key, id, {root, name: nameOf(key)});
        else registry.remove(key);
      },
      // 要显示某会话的终端：表里有且 terminal.list 里还在 → attach；没有 / 已被回收 → none（显示「打开终端」，不自动开）。
      async prepare(key) {
        if (!registry.get(key)) return {plan: 'none', ids: []};
        try { registry.reconcile(await liveIds()); } catch { return {plan: 'none', ids: []}; }
        const item = registry.get(key);
        if (!item) return {plan: 'none', ids: []};
        registry.touch(key);
        return {plan: 'attach', ids: [item.id]};
      },
      // 点「打开终端」：满 8 个先关最久没看的空闲那个；全在跑就不开，只给提示。
      async open(key) {
        try { registry.reconcile(await liveIds()); } catch {}
        const room = registry.makeRoom(key);
        if (room.evict) { try { await request('terminal.close', {sessionId: room.evict.id}); } catch {} }
        return {ok: room.ok, notice: room.notice, ids: []};
      },
      // 挂组件前一刻写 PANEL_KEY。
      handoff(ids) { try { storage?.setItem(PANEL_KEY, JSON.stringify(ids || [])); } catch {} },
      // terminal.open 成功：登记在发起时的会话上，并算出进项目文件夹的 cd（cwd 已经是就不发）。
      opened(key, root, result) {
        if (!key || !result?.sessionId) return null;
        registry.set(key, String(result.sessionId), {root, name: nameOf(key)});
        if (!root || result.cwd === root) return {text: null, refuse: null};
        return cdCommand(result.shell, root);
      },
      noteOutput: id => registry.noteOutput(id),
    };
  }

  // 面板一侧的状态机：每个会话 checking → mount（接回或新开）/ idle（显示「打开终端」）/ opening。
  // view(key) 返回 null 表示现在就挂组件（PANEL_KEY 已写好）；否则返回 {busy, notice} 给面板画按钮。
  function createSession({request, toast = () => {}, render = () => {}, nameOf, storage = window.sessionStorage} = {}) {
    const control = createController({request, storage, nameOf});
    let plan = null, want = '';
    function start(key) {
      if (plan?.key === key && plan.step === 'opening') return;
      if (want === key) want = '';
      plan = {key, step: 'opening'};
      void control.open(key).then(r => {
        if (plan?.key !== key) return;
        plan = r.ok ? {key, step: 'mount', ids: []} : {key, step: 'idle', notice: r.notice};
        if (r.notice) toast(r.notice);
        render();
      });
    }
    return {
      control, start,
      park(key, id, root) { plan = null; control.park(key, id, root); },
      // 运行 / 在终端中打开 这类人点出来的动作：本会话还没有终端就当作点了「打开终端」。
      want(key) { want = key; if (plan?.key === key && plan.step === 'idle') start(key); },
      view(key) {
        if (plan?.key !== key) {
          plan = {key, step: 'checking'};
          void control.prepare(key).then(p => {
            if (plan?.key !== key) return;
            plan = {key, step: p.plan === 'attach' ? 'mount' : 'idle', ids: p.ids};
            if (want === key && plan.step === 'idle') start(key); else render();
          });
        }
        if (plan.step === 'mount') { control.handoff(plan.ids); return null; }
        return {busy: plan.step !== 'idle', notice: plan.notice || null};
      },
    };
  }

  bench.term = Object.freeze({STORE_KEY, PANEL_KEY, MAX_PER_WINDOW, BUSY_MS, TEXT, shellKind, cdCommand, maskEnv, plainText, createRegistry, createContext, createController, createSession, noticeForError});
})();
