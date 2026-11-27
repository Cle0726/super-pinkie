/* laolao-metre-files —— R5 ①：Metre 回答下面「文件」一行，点了在工作台打开（11-26，设计稿 docs/redesign/R5-FILE-PREVIEW-EDIT.md 第二节 1）。
 *
 * 这一轮里 Metre 读过 / 改过的文件，各出一个签条：读的点了开标签；改的点了进差异视图（上次提交 ↔ 现在），看 Metre 改了什么。
 * 路径只认工具调用参数里的结构化字段（path / file_path / filePath），不在正文里用正则猜；出错的工具调用不出签。
 * 只读 / 可写不在这里判：路径原样交给工作台，标签的只读标记以后端 pinkie.fs.read 的 readOnly 为准（项目外只读）。
 * 工作台不在（窗口 < 600、不在 /chat、开着分屏）时不硬挤出来，签条行里说一句为什么；只读预览面板是 ③ 的事。
 * 只读本会话历史：不调网关、不加定时器、不自动打开。离开 Metre 整行拿掉，其他模式一个字不动。
 * R5 ②（设计稿第二节 2）：这一轮 Metre 正在改的文件，工作台里临时只读（填工作台公开的 held 表），回合结束放开并按磁盘重读。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreFiles) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  // 和 laolao-metre-preview.js 判断「这一轮从哪条用户消息开始」同一条规则。
  const INTERNAL = /^\s*(?:【子会话简报】|【来自关联会话的消息】|【就在这里继续】|NO_REPLY\s*$|HEARTBEAT_OK\s*$|\[Pinkie|\[CLE|<\w+-context)/u;
  // 名单是 laolao-metre-cat.js 的 READ_TOOLS / WRITE_TOOLS 里对单个文件的那几个（code_search / grep / ls 给的是目录或模式，不出签）。
  const READ = /^(?:read|workbench_read)$/;
  const WRITE = /^(?:write|edit|apply_patch|code_edit|multi_edit)$/;
  const MAX = 6;
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const pane = () => document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
  const textOf = item => {
    const content = item?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return typeof item?.text === 'string' ? item.text : '';
    return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  };

  // ---------- 认文件 ----------
  const CALL = /^(?:toolCall|tool_call|toolUse|tool_use|functionCall)$/;
  function argsOf(part) {
    let args = part.arguments ?? part.args ?? part.input ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return {}; } }
    return args && typeof args === 'object' ? args : {};
  }
  function pathOf(args) {
    const raw = [args.path, args.file_path, args.filePath].find(v => typeof v === 'string' && v.trim());
    if (!raw || raw.length > 1024 || /[\u0000-\u001f]/.test(raw)) return '';
    return raw.trim().replace(/\\/g, '/');
  }
  const callIdOf = part => String(part.id || part.callId || part.toolCallId || part.tool_call_id || '');
  function filesFor(history, index) {
    let start = index;
    for (; start > 0; start--) {
      const item = history[start - 1];
      if (item?.role === 'user' && textOf(item).trim() && !INTERNAL.test(textOf(item))) break;
    }
    const failed = new Set();
    for (let i = start; i <= index; i++) {
      const item = history[i];
      if (/^toolresult$/i.test(String(item?.role || '')) && item.isError === true) failed.add(String(item.toolCallId || item.tool_call_id || ''));
    }
    const files = [];
    for (let i = start; i <= index; i++) {
      const item = history[i];
      if (item?.role !== 'assistant' || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (!part || !CALL.test(String(part.type || ''))) continue;
        const name = String(part.name || '');
        const write = WRITE.test(name);
        if (!write && !READ.test(name)) continue;
        const id = callIdOf(part);
        if (id && failed.has(id)) continue;
        const path = pathOf(argsOf(part));
        if (!path) continue;
        const known = files.find(f => f.path === path);
        if (known) { known.changed ||= write; continue; }
        files.push({path, changed: write});
      }
    }
    return files;
  }
  const baseName = path => path.split('/').filter(Boolean).pop() || path;

  // ---------- 文件行 ----------
  function groupIndex(group, history) {
    const last = [...group.querySelectorAll('.chat-bubble[data-message-id]')].at(-1);
    const item = last ? window.__pinkieMessageActions?.historyItem?.(last.dataset.messageId, history) : null;
    return item ? history.indexOf(item) : -1;
  }
  function buildRow(files) {
    const row = el('div', 'pk-mfile-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', '这一轮的文件');
    row.append(el('span', 'pk-mfile-row__label', '文件'));
    for (const file of files.slice(0, MAX)) {
      const chip = el('button', 'pk-mfile-chip');
      chip.type = 'button';
      chip.dataset.path = file.path;
      chip.dataset.action = file.changed ? 'diff' : 'open';
      chip.title = file.changed ? `在工作台看改动：${file.path}` : `在工作台打开：${file.path}`;
      chip.setAttribute('aria-label', file.changed ? `看改动 ${file.path}` : `打开 ${file.path}`);
      chip.append(el('span', 'pk-mfile-chip__text', baseName(file.path)));
      if (file.changed) chip.append(el('span', 'pk-mfile-chip__tag', '改动'));
      row.append(chip);
    }
    if (files.length > MAX) row.append(el('span', 'pk-mfile-row__more', `还有 ${files.length - MAX} 个`));
    return row;
  }
  function paint() {
    const p = pane();
    const history = p?.state?.chatMessages;
    if (!Array.isArray(history) || !history.length) return;
    for (const group of p.querySelectorAll('.chat-group.assistant')) {
      const index = groupIndex(group, history);
      const files = index < 0 ? [] : filesFor(history, index);
      const old = group.querySelector('.pk-mfile-row');
      const signature = files.map(f => (f.changed ? '*' : '') + f.path).join('|');
      if (!files.length) { old?.remove(); continue; }
      if (old?.dataset.pkFiles === signature) continue;
      const row = buildRow(files);
      row.dataset.pkFiles = signature;
      if (old) { old.replaceWith(row); continue; }
      const footer = group.querySelector('.chat-group-footer');
      if (footer) footer.before(row); else (group.querySelector('.chat-group-messages') || group).append(row);
    }
  }
  const restore = () => { for (const row of document.querySelectorAll('.pk-mfile-row')) row.remove(); };

  // ---------- 打开：交给工作台 ----------
  function say(row, text) {
    let note = row.querySelector('.pk-mfile-row__note');
    if (!note) { note = el('span', 'pk-mfile-row__note'); note.setAttribute('role', 'status'); row.append(note); }
    note.textContent = text;
    clearTimeout(note._timer);
    note._timer = setTimeout(() => note.remove(), 4000);
  }
  async function openChip(chip) {
    const bench = window.__pinkieWorkbench;
    const row = chip.closest('.pk-mfile-row');
    if (!bench || typeof bench.show !== 'function' || !(await bench.show())) {
      if (row) say(row, '工作台现在打不开：放宽窗口，或回到聊天页再点');
      return 'unavailable';
    }
    const path = bench.rel ? bench.rel(chip.dataset.path) : chip.dataset.path;
    if (chip.dataset.action === 'diff' && typeof bench.diff === 'function') { await bench.diff(path); return 'diff'; }
    await bench.open(path, {pinned: true});
    return 'open';
  }
  document.addEventListener('click', event => {
    if (event.button !== 0 || !isMetre()) return;
    const chip = event.target.closest?.('.pk-mfile-chip');
    if (!chip) return;
    event.preventDefault();
    void openChip(chip);
  });

  // ---------- R5 ②：回合中只读 ----------
  // 这一轮 Metre 的改文件工具一开始（tool start），工作台里这个文件临时只读，顶上一条说明；回合结束（lifecycle end / error）、
  // 状态条说已经不在跑、离开 Metre、换会话，全部放开并按磁盘重读一次。没在改的文件不锁；读文件工具不锁；别的会话（含子会话）的事件不算。
  const HOLD = 'Metre 正在改这个文件，这一轮结束后可以编辑';
  const holding = new Set();
  const sessionNow = () => pane()?.state?.sessionKey || new URLSearchParams(location.search).get('session') || '';
  // 工作台的标签路径：项目里是相对路径，项目外是绝对路径；held 用同一种写法当键。改完重画当前标签（锁、顶上说明、编辑器只读都在 activate 里）。
  // focus: false——回合进行中用户可能正在输入框里打字，不能把焦点抢到编辑器。
  function redraw(bench) { const active = bench.state?.active; if (active && bench.state.visible) void bench.open(active, {focus: false}); }
  function releaseAll() {
    const bench = window.__pinkieWorkbench;
    if (!holding.size || !bench?.held) { holding.clear(); return; }
    for (const key of holding) bench.held.delete(key);
    holding.clear();
    redraw(bench);
    // 按磁盘重读一次：工作台自己的 mtime 检查（refresh 末尾 checkOpenFiles），没改动的标签直接换成 Metre 写的内容，有没存改动的走冲突提示。
    void bench.refresh?.();
  }
  window.addEventListener('pinkie:gateway-event', event => {
    const {event: name, payload} = event.detail || {};
    if (!payload || !isMetre() || (name !== 'agent' && name !== 'session.tool')) return;
    const key = String(payload.sessionKey || '');
    if (key && key !== sessionNow()) return;
    const data = payload.data || {};
    if (payload.stream === 'lifecycle' && (data.phase === 'end' || data.phase === 'error')) { releaseAll(); return; }
    if (payload.stream !== 'tool' || data.phase !== 'start' || !WRITE.test(String(data.name || data.toolName || ''))) return;
    const path = pathOf(argsOf({args: data.args ?? data.arguments ?? data.input}));
    const bench = window.__pinkieWorkbench;
    if (!path || !(bench?.held instanceof Map)) return;
    const tabKey = bench.rel ? bench.rel(path) : path;
    if (!tabKey || holding.has(tabKey)) return;
    holding.add(tabKey);
    bench.held.set(tabKey, HOLD);
    redraw(bench);
  });
  window.addEventListener('pinkie:run-view', event => { if (holding.size && event.detail?.live && event.detail.live.active === false) releaseAll(); });
  window.addEventListener('pinkie:session-selected', releaseAll);

  // ---------- 什么时候重画 ----------
  let frame = 0;
  const tick = () => {
    frame = 0;
    if (isMetre()) paint();
    else { releaseAll(); if (document.querySelector('.pk-mfile-row')) restore(); }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(tick); };
  window.Pinkie?.domWatch?.watch('.chat-group.assistant', schedule, {immediate: true});
  window.addEventListener('laolao:modechange', schedule);
  window.addEventListener('pinkie:session-selected', schedule);

  ns.metreFiles = Object.freeze({filesFor, paint: schedule, openChip});
})();
