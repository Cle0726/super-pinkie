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

  bench.term = Object.freeze({STORE_KEY, MAX_PER_WINDOW, BUSY_MS, TEXT, shellKind, cdCommand, maskEnv, createRegistry, noticeForError});
})();
