/* laolao-metre-outputs —— T3 #23（L35）：本会话产出的文件。挂在 Metre 工作台（对话右边那一块）编辑区的一页「本会话文件」。
 * 入口：工作台状态栏右边一颗「文件 N」（wb.extraStatus），点了用 wb.openPage 开一页，和 laolao-metre-pr.js 的「PR」页同一套接口。
 * 列的是这个会话从第一轮到现在 Metre 写过 / 改过的文件，两路合在一起、按路径去重：
 *   - 聊天历史里改文件工具（write / edit / apply_patch / code_edit / multi_edit）参数里的结构化路径
 *     （和 laolao-metre-files.js 同一条规则：只认 path / file_path / filePath，出错的调用不算，正文里的路径不算，读文件不算）；
 *   - 作品库里记在这个会话名下的作品（pinkie.artifacts.list {sessionKey}；后端在改文件工具之后记，含脚本生成的图片等），
 *     只在开页、点「刷新」、页开着时一轮结束各取一次。
 * 每行：文件名、所在目录、最后在第几轮改的、改了几次；点了：图片 / PDF / Office 这类进作品库查看器，改过的进工作台差异视图
 * （没有 git 时工作台自己退回开标签），其余在工作台开标签。
 * 只在 Metre；不开定时器、不加观察器、不加 window.__ 全局名；离开 Metre 状态栏那颗键不出，其他模式一个字不动。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreOutputs) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const PAGE = 'outputs';
  // 和 laolao-metre-files.js / laolao-metre-preview.js 判断「这一轮从哪条用户消息开始」同一条规则：内部消息不算新的一轮。
  const INTERNAL = /^\s*(?:【子会话简报】|【来自关联会话的消息】|【就在这里继续】|NO_REPLY\s*$|HEARTBEAT_OK\s*$|\[Pinkie|\[CLE|<\w+-context)/u;
  const WRITE = /^(?:write|edit|apply_patch|code_edit|multi_edit)$/;
  const CALL = /^(?:toolCall|tool_call|toolUse|tool_use|functionCall)$/;
  // 这几类工作台看不了，交给作品库查看器（只在作品库里有这一件时）
  const VIEWER = /\.(?:png|jpe?g|gif|webp|bmp|pdf|docx|pptx|xlsx|mp4|mov|webm)$/i;
  const s = {art: null, error: '', busy: false};

  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const btn = (label, run, cls = 'pk-mout__btn') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', run); return b; };
  const wb = () => window.__pinkieWorkbench;
  const pane = () => document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
  const sessionNow = () => pane()?.state?.sessionKey || new URLSearchParams(location.search).get('session') || '';
  const historyNow = () => { const h = pane()?.state?.chatMessages; return Array.isArray(h) ? h : []; };
  const textOf = item => {
    const content = item?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return typeof item?.text === 'string' ? item.text : '';
    return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  };
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
  const baseName = path => path.split('/').filter(Boolean).pop() || path;
  const dirName = path => { const parts = path.split('/'); parts.pop(); return parts.join('/') || (path.startsWith('/') ? '/' : ''); };
  const relOf = path => { try { return wb()?.rel ? wb().rel(path) || path : path; } catch { return path; } };
  // 去重用的键：工作台的相对写法 + 反斜杠换成 /；Windows 盘符路径不分大小写
  const keyOf = path => { const p = String(relOf(path) || '').replace(/\\/g, '/'); return /^[a-z]:\//i.test(p) ? p.toLowerCase() : p; };

  // ---------- 纯函数：整段会话里写过 / 改过的文件 ----------
  // 返回 [{path, edits, turns: [第几轮...]}]，最后改的在前；同一轮里按第一次出现的先后。
  function sessionOutputs(history) {
    const list = Array.isArray(history) ? history : [];
    const failed = new Set();
    for (const item of list) {
      if (/^toolresult$/i.test(String(item?.role || '')) && item.isError === true) failed.add(String(item.toolCallId || item.tool_call_id || ''));
    }
    const files = new Map();
    let turn = 0;
    for (const item of list) {
      if (item?.role === 'user') { const text = textOf(item); if (text.trim() && !INTERNAL.test(text)) turn++; continue; }
      if (item?.role !== 'assistant' || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (!part || !CALL.test(String(part.type || '')) || !WRITE.test(String(part.name || ''))) continue;
        const id = callIdOf(part);
        if (id && failed.has(id)) continue;
        const path = pathOf(argsOf(part));
        if (!path) continue;
        const file = files.get(path) || {path, edits: 0, turns: []};
        const at = Math.max(turn, 1);
        file.edits += 1;
        if (file.turns.at(-1) !== at) file.turns.push(at);
        files.set(path, file);
      }
    }
    return [...files.values()].sort((a, b) => b.turns.at(-1) - a.turns.at(-1));
  }

  // 历史 + 作品库，按路径合并。作品库那一路只用当前会话取到的。
  function rowsNow() {
    const rows = sessionOutputs(historyNow()).map(f => ({...f, artifact: null}));
    const byKey = new Map(rows.map(row => [keyOf(row.path), row]));
    const items = s.art && s.art.key === sessionNow() ? s.art.items : [];
    for (const item of items) {
      if (!item || typeof item.path !== 'string' || !item.path) continue;
      const path = item.path.replace(/\\/g, '/');
      const known = byKey.get(keyOf(path));
      if (known) { known.artifact = item; continue; }
      const row = {path, edits: 0, turns: [], artifact: item};
      byKey.set(keyOf(path), row); rows.push(row);
    }
    return rows;
  }

  async function load() {
    const bench = wb(), key = sessionNow();
    if (!bench?.rpc || !key || !isMetre()) return;
    s.busy = true; s.error = ''; bench.refreshPage?.(PAGE);
    try {
      const result = await bench.rpc('pinkie.artifacts.list', {sessionKey: key, mode: 'all', limit: 200}, 15000);
      if (result?.ok === false) throw new Error(result.error || '没有成功');
      if (sessionNow() === key) s.art = {key, items: Array.isArray(result?.items) ? result.items : []};
    } catch (error) { s.error = String(error?.message || error); }
    finally { s.busy = false; }
    bench.refreshPage?.(PAGE); bench.renderStatus?.();
  }

  async function openRow(row) {
    const bench = wb();
    if (!bench) return 'unavailable';
    const viewer = window.PinkieArtifacts?.openViewer;
    if (row.artifact?.id && VIEWER.test(row.path) && typeof viewer === 'function') { viewer(row.artifact.id); return 'viewer'; }
    const path = relOf(row.path);
    if (row.edits && typeof bench.diff === 'function') { await bench.diff(path); return 'diff'; }
    await bench.open?.(path, {pinned: true});
    return 'open';
  }

  function render(box) {
    const page = el('div', 'pk-wb-page pk-mout');
    page.append(el('h1', 'pk-wb-page__title', '本会话文件'));
    const rows = rowsNow();
    const bar = el('div', 'pk-mout__bar');
    bar.append(btn('刷新', () => void load()));
    bar.append(el('span', 'pk-mout__meta', s.busy ? '正在看作品库…' : rows.length ? `${rows.length} 个文件 · 最后改的在上面` : ''));
    page.append(bar);
    if (s.error) page.append(el('p', 'pk-mout__msg pk-mout__msg--error', '作品库没取到，下面只列聊天里改过的文件：' + s.error));
    if (!rows.length) {
      page.append(el('p', 'pk-mout__msg', '这个会话还没有写过或改过文件。Metre 写出、改过的文件会列在这里。'));
      box.append(page); return;
    }
    const list = el('ul', 'pk-mout__list');
    list.setAttribute('aria-label', '本会话产出的文件');
    for (const row of rows) {
      const li = el('li', 'pk-mout__row');
      li.dataset.path = row.path;
      const name = btn(baseName(row.path), () => void openRow(row), 'pk-mout__name');
      name.title = row.path;
      name.setAttribute('aria-label', (row.artifact && VIEWER.test(row.path) ? '在作品库里看 ' : row.edits ? '看改动 ' : '打开 ') + row.path);
      const dir = el('span', 'pk-mout__dir', dirName(relOf(row.path)));
      const bits = [];
      if (row.turns.length) bits.push(`第 ${row.turns.at(-1)} 轮`);
      if (row.edits > 1) bits.push(`改了 ${row.edits} 次`);
      if (!row.turns.length) bits.push('作品库');
      if (row.artifact && row.artifact.exists === false) bits.push('原文件已不在');
      li.append(name, dir, el('span', 'pk-mout__when', bits.join(' · ')));
      list.append(li);
    }
    page.append(list);
    box.append(page);
  }

  async function open() {
    const bench = wb();
    if (!isMetre() || !bench?.openPage) return false;
    if (bench.state && !bench.state.visible && typeof bench.show === 'function' && !(await bench.show())) return false;
    await bench.openPage(PAGE, '本会话文件', 'files', render);
    await load();
    return true;
  }

  // 状态栏入口：只在 Metre。工作台每次重画状态栏都会调这个函数。
  function statusItem() {
    if (!isMetre()) return null;
    const n = rowsNow().length;
    const b = el('button', 'pk-wb-status__item pk-mout__status'); b.type = 'button'; b.title = '本会话产出的文件';
    const i = el('i', 'codicon codicon-files'); i.setAttribute('aria-hidden', 'true');
    b.append(i, el('span', '', n ? `文件 ${n}` : '文件'));
    b.addEventListener('click', e => { e.stopPropagation(); void open(); });
    return b;
  }
  const pageOpen = () => wb()?.state?.active === 'page:' + PAGE;
  const repaint = () => { const bench = wb(); bench?.renderStatus?.(); if (pageOpen()) bench.refreshPage?.(PAGE); };

  // 一轮结束：状态栏的数和页里的列表跟着更新；页开着时再取一次作品库。别的会话（含子会话）的事件不算。
  window.addEventListener('pinkie:gateway-event', event => {
    const {event: name, payload} = event.detail || {};
    if (!payload || !isMetre() || (name !== 'agent' && name !== 'chat')) return;
    const key = String(payload.sessionKey || '');
    if (key && key !== sessionNow()) return;
    const done = (payload.stream === 'lifecycle' && (payload.data?.phase === 'end' || payload.data?.phase === 'error')) || (name === 'chat' && payload.state === 'final');
    if (!done) return;
    if (pageOpen()) void load(); else repaint();
  });
  window.addEventListener('pinkie:session-selected', () => { s.art = null; s.error = ''; if (pageOpen() && isMetre()) void load(); else repaint(); });
  window.addEventListener('laolao:modechange', repaint);

  function attach() { const w = wb(); if (w?.extraStatus && !w.extraStatus.has(PAGE)) { w.extraStatus.set(PAGE, statusItem); w.renderStatus?.(); } }
  ns.metreOutputs = Object.freeze({sessionOutputs, rowsNow, open, openRow, render, state: s});
  attach();
  if (!wb()?.extraStatus) document.addEventListener('DOMContentLoaded', attach, {once: true});
})();
