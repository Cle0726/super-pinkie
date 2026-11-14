/* laolao-cle-stage:v3 —— C.le. 动画放进工作过程的标题行（像 Claude Code 的状态行）
 *
 *   [C.le. 动画]  正在执行 `ls ~/.openclaw/workspace`  12 秒   ›
 *
 * - 运行状态以网关事件为准（pinkie:gateway-event：lifecycle / thinking / tool / assistant），
 *   界面上的 data-live 在历史重绘时会闪，只在没收到事件时（例如运行中刷新了页面）兜底。
 * - 运行中的那张卡片：标题行左侧是 C.le. 三维粒子迷你版（全页唯一的 WebGL 上下文），
 *   跟着当前步骤变形；动作词带扫光，正在跑的命令 / 文件用等宽小签标出来。
 *   结束时在小标里落款（卡片被历史重绘换掉也会接到新卡片上），然后换回静态签名。
 * - 其余卡片：左侧是一枚静态的矢量签名小标（不耗性能）。
 * - 工具调用的参数（命令、路径）按 toolCallId 记在本机：历史记录里只有工具结果，没有参数，
 *   展开卡片时把「执行命令 · Exec  date」补回来。
 * - 运行期间 html[data-cle-live]：其他焦点退后（见 css）。
 * - WebGL 不可用、「减少动态效果」或软件渲染（html[data-pinkie-lite]）：只用静态签名小标，不压暗界面。
 */
import {CleSpace} from './laolao-cle-space.js?v=6';

if (!window.__laolaoCleStage) {
  window.__laolaoCleStage = true;

  const root = document.documentElement;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  const VERB = {think: '思考中', read: '正在读取', write: '正在写入', edit: '正在修改', exec: '正在执行', ask: '等你确认', plan: '正在更新计划', reply: '正在回复', image: '图片生成中', done: '完成', stopped: '已中断',
    search: '正在搜索', fetch: '正在看网页', browse: '正在用浏览器', find: '正在查代码', test: '正在跑测试',
    quiz: '正在出题', lab: '正在搭小互动', grade: '正在批改', note: '正在记进手账', memory: '正在翻记忆',
    session: '正在安排子会话', show: '正在打开工作台', computer: '正在操作电脑', webgpt: '正在和网页 GPT 协作',
    cron: '正在设定时', tool: '正在用工具',
    // PLAN 2.8 补全（和 laolao-tool-kind.js 的 ING 一致，tests/tool-kind-words.test.cjs 守着）
    create: '正在创建', delete: '正在删除', move: '正在移动', install: '正在安装', build: '正在构建', git: '正在提交',
    download: '正在下载', view: '正在看图片', shot: '正在截图', dispatch: '正在派发', wait: '在等子会话', review: '正在验收',
    manage: '正在整理会话', models: '正在看可用模型'};
  // 工具名 → 类别。类别决定标题行的动作词、展开后那一行的说法和色点。
  // 碧琪自己的工具（services/mode-architecture 里注册的）和 OpenClaw 原生工具都在这里；
  // 不认识的工具归「tool」，不再一律当成「运行命令」。
  const TOOL_KIND = {
    read: 'read', workbench_read: 'read', learning_library: 'read', learning_material: 'read', memory_get: 'memory',
    write: 'write', edit: 'edit', apply_patch: 'edit', code_edit: 'edit', multiedit: 'edit',
    exec: 'exec', bash: 'exec', process: 'exec', code_check: 'exec', run_tests: 'test',
    code_search: 'find', code_refs: 'find', grep: 'find', glob: 'find',
    web_search: 'search', pinkie_search: 'search', web_fetch: 'fetch',
    browser: 'browse', app_browser: 'browse',
    image: 'image', image_generate: 'image', imagegen: 'image',
    plan_update: 'plan', update_plan: 'plan',
    ask_user: 'ask', pinkie_mode_ask: 'ask',
    learning_activity: 'quiz', learning_desk: 'note',
    clekk_memory: 'memory', memory_search: 'memory',
    pinkie_session_start: 'session', pinkie_sessions: 'manage', pinkie_models: 'models', pinkie_session_message: 'session', pinkie_session_list: 'session', pinkie_session_title: 'session',
    sessions_spawn: 'session', sessions_send: 'session', subagents: 'session',
    workbench_show: 'show', computer: 'computer', computer_flow: 'computer', web_gpt_activity: 'webgpt', cron: 'cron',
  };
  const QUIZ_KINDS = /^(?:single_choice|multiple_choice|fill_blank|short_answer|batch)$/;
  const normTool = (s) => String(s || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
  // 一次工具调用归哪一类：看名字；出题工具再看它这次是出题、批改还是搭互动
  function kindOfCall(name, args, trace) {
    const k = TOOL_KIND[normTool(name)];
    // 细分（创建 / 删除 / 安装 / 看图片 / 截图 / 派发…）：判定不了就是原来的类别
    if (k && k !== 'quiz') return window.__pinkieToolKind ? window.__pinkieToolKind.refine(k, normTool(name), args, trace) : k;
    if (k !== 'quiz') return k || '';
    const a = args && typeof args === 'object' ? args : {};
    if (a.action && a.action !== 'present') return 'grade';
    return !a.kind || QUIZ_KINDS.test(String(a.kind)) ? 'quiz' : 'lab';
  }
  const STOPPED = /中断|失败|出错|错误|取消|interrupt|abort|fail|error|cancel/i;
  const DONE_HOLD = 6900;      // 落款全长（含回到签名）
  const NS = 'http://www.w3.org/2000/svg';
  const ARGS_KEY = 'laolao:cle-tool-args:v1';
  const ARGS_MAX = 600;
  const MIN_STEP = 1400;       // 很快跑完的工具（几十毫秒）也要在状态行上停留一下，不然根本看不到

  let space = null, glyph = null, owner = null;   // owner：当前持有动画小标的卡片
  let live = null, finishing = null, finishInfo = null, liveSince = 0, tick = 0, doneTimer = 0;
  // 本轮运行（来自网关事件）。seen：这一轮收到过事件，之后就只信事件
  const run = {on: false, seen: false, since: 0, endedAt: 0, stopped: false, queue: [], cur: null, bg: 'think', pumpT: 0, kind: 'think', text: '', mono: false, quiet: 0};

  const canAnimate = () => !(reduce && reduce.matches) && !root.hasAttribute('data-pinkie-lite') && webglOK();
  function webglOK() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
  }

  function kindOf(text) {
    const byName = kindOfCall(text);
    if (byName) return byName;
    // 标签上是中文名（laolao-phrases 把工具名换成了中文）：反查工具名
    const labels = window.__pinkieToolLabels || {};
    const label = String(text || '').trim();
    for (const name of Object.keys(labels)) if (labels[name] === label && TOOL_KIND[name]) return kindOfCall(name);
    const s = String(text || '').toLowerCase();
    // 原生标签里夹着工具名（「网页搜索 · web_search」、「Web Search」）
    for (const name of Object.keys(TOOL_KIND)) if (name.length > 4 && normTool(s).includes(name)) return TOOL_KIND[name];
    if (/plan_update|更新工作计划/.test(s)) return 'plan';
    if (/apply_patch|\bpatch\b|\bedit\b|multiedit|replace|修改|编辑|替换|补丁/.test(s)) return 'edit';
    if (/\bwrite\b|\bcreate\b|notebook|写入|新建|创建|保存/.test(s)) return 'write';
    if (/\bread\b|fetch|search|grep|glob|\blist\b|\bls\b|browse|web|查看|读取|搜索|浏览|查找|检索/.test(s)) return 'read';
    return 'exec';
  }

  /* ── 工具参数：按 toolCallId 记在本机 ── */
  let ARGS = {};
  try { ARGS = JSON.parse(localStorage.getItem(ARGS_KEY) || '{}') || {}; } catch { ARGS = {}; }
  let argsTimer = 0;
  function saveArgs() {
    clearTimeout(argsTimer);
    argsTimer = setTimeout(() => {
      const ids = Object.keys(ARGS);
      if (ids.length > ARGS_MAX) ids.sort((a, b) => (ARGS[a].at || 0) - (ARGS[b].at || 0)).slice(0, ids.length - ARGS_MAX).forEach((id) => delete ARGS[id]);
      try { localStorage.setItem(ARGS_KEY, JSON.stringify(ARGS)); } catch {}
    }, 500);
  }
  const MODE_CN = {chat: '唠嗑模式', ideas: '想法模式', project: '项目模式', learning: '学习模式', unrestricted: '无限制模式', metre: 'Metre'};
  const firstLine = (s) => String(s == null ? '' : s).split('\n').map((x) => x.trim()).find(Boolean) || '';
  const homeless = (p) => String(p).replace(/^\/Users\/[^/]+/, '~');
  // 状态行里要能一眼看出「在跑什么」：命令原文、文件路径、搜索词、网址
  function argText(name, args, meta) {
    const a = args && typeof args === 'object' ? args : {};
    let t = '', mono = true;
    const path = a.path || a.file_path || a.filePath || a.file;
    // 计划：状态行上显示正在做的那一项
    if (name === 'plan_update' && Array.isArray(a.items)) {
      const item = a.items.find((x) => x && x.status === 'in_progress') || a.items.find((x) => x && x.status !== 'completed');
      return {text: item ? firstLine(item.text) : '全部完成', mono: false};
    }
    // 派发：状态行说派给了哪个模式
    if (name === 'pinkie_session_start' && MODE_CN[a.mode]) return {text: MODE_CN[a.mode], mono: false};
    if (a.command || a.cmd) t = firstLine(a.command || a.cmd);
    else if (path) {
      t = homeless(path);
      const from = Number(a.offset || a.start_line || 0), n = Number(a.limit || 0);
      if (from || n) t += ':' + (from || 1) + (n ? '–' + ((from || 1) + n - 1) : '');
    } else if (a.query || a.q) { t = firstLine(a.query || a.q); mono = false; }
    else if (a.url) t = a.url;
    else if (meta) { t = firstLine(meta); mono = false; }
    else {
      // 先找像标题、题干的字段；action / kind 这类开关值（present、list…）不当说明
      const keys = ['title', 'question', 'stem', 'prompt', 'topic', 'task', 'message', 'text', 'name', 'label'];
      const skip = /^(?:action|kind|mode|area|type|status|format|lesson_phase|activity_id|id)$/;
      const v = keys.map((k) => a[k]).find((x) => typeof x === 'string' && x.trim())
        || Object.entries(a).filter(([k]) => !skip.test(k)).map(([, x]) => x).find((x) => typeof x === 'string' && x.trim());
      t = firstLine(v); mono = false;
    }
    if (!t && meta) { t = firstLine(meta); mono = false; }
    return {text: t.length > 160 ? t.slice(0, 159) + '…' : t, mono};
  }
  function callIdOf(row) {
    const host = row.closest('[data-message-id]');
    const m = host && /^tool:[^:]+:([^:]+)/.exec(host.dataset.messageId || '');
    if (m) return m[1];
    // 时间线排法（工具调用嵌在助手消息里）：到消息列表里找
    const tk = window.__pinkieToolKind;
    return tk && tk.rowCallId ? tk.rowCallId(row) : '';
  }

  // 先看工具名（「执行命令 · Exec」），判断不了才看模型写的说明文字
  function kindOfRow(row) {
    const rec = ARGS[callIdOf(row)];
    if (rec && rec.k) return rec.k;
    const label = row.querySelector('.chat-tool-msg-summary__label');
    const byName = label ? kindOf(label.textContent) : 'exec';
    // 后端记录说这次读到了图片：读文件 → 看图片
    const traced = window.__pinkieToolImages && window.__pinkieToolImages.traces[callIdOf(row)];
    if (byName === 'read' && traced && traced.images && traced.images.length) return 'view';
    if (byName === 'exec' && label && /exec|执行|命令|bash|shell|terminal/i.test(label.textContent)) {
      // 换了浏览器 / 清过本机记录时没有参数：用行上显示的命令原文细分（删除 / 安装 / git…），认不出就还是「命令」
      const names = row.querySelector('.chat-tool-msg-summary__names');
      const tk = window.__pinkieToolKind;
      return (tk && names && tk.ofCommand(names.textContent)) || byName;
    }
    if (byName !== 'exec') return byName;
    return kindOf(row.textContent);
  }

  function cards() { return document.querySelectorAll('.chat-group--process details.pinkie-process'); }
  function lastCard() { const all = cards(); return all[all.length - 1] || null; }

  // 「停止」按钮只在本轮可中止时出现（语音输入也借用这个样式，排除掉）
  function busy() {
    return [...document.querySelectorAll('.chat-send-btn--stop')]
      .some((b) => !/语音|voice|听写|dictat/i.test(b.getAttribute('aria-label') || ''));
  }

  // 最近一轮（最后一条用户消息之后）里的最后一张工作过程卡片
  function turnCard() {
    const groups = document.querySelectorAll('.chat-thread-inner > .chat-group');
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g.classList.contains('user')) return null;
      if (g.classList.contains('chat-group--process')) {
        const d = g.querySelector('details.pinkie-process');
        if (d) return d;
      }
    }
    return null;
  }

  function sessionKey() {
    const routed = new URL(location.href).searchParams.get('session') || '';
    if (routed) return routed;
    const active = document.querySelector('.sidebar-recent-session--active[data-session-key]');
    return active ? active.dataset.sessionKey || '' : '';
  }

  /* ── 静态签名小标（所有卡片） ── */
  let staticSVG = '';
  function staticGlyph() {
    if (!staticSVG && window.CleSignature) {
      const host = document.createElementNS(NS, 'svg');
      host.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
      document.body.appendChild(host);
      const paths = window.CleSignature.outline(host).map((d) => '<path d="' + d + '"/>').join('');
      host.remove();
      staticSVG = '<svg viewBox="0 0 200 96" aria-hidden="true" fill="currentColor">' + paths + '</svg>';
    }
    const s = document.createElement('span');
    s.className = 'cle-glyph cle-glyph--static';
    s.innerHTML = staticSVG;
    return s;
  }

  /* ── 动画小标（全页一个） ── */
  function animGlyph() {
    if (glyph) return glyph;
    if (!canAnimate()) return null;
    glyph = document.createElement('span');
    glyph.className = 'cle-glyph cle-glyph--live';
    try {
      space = new CleSpace(glyph, {palette: 'cle', count: 1100, size: .17, fitW: 10.2, fitH: 5.4, interactive: false});
    } catch (err) {
      console.warn('[cle-stage] WebGL 不可用，退回静态签名', err);
      glyph = null;
      return null;
    }
    return glyph;
  }

  function summaryOf(details) { return details.querySelector(':scope > .pinkie-process__summary'); }

  // 卡片 meta「6 个步骤 · 用时 47 秒 · 已中断」→ {text: '6 个步骤 · 用时 47 秒', stopped: true}
  function metaOf(details) {
    const sum = summaryOf(details);
    const meta = sum && sum.querySelector('.pinkie-process__meta');
    const raw = meta ? meta.textContent.replace(/\s+/g, ' ').trim() : '';
    const stopped = STOPPED.test(raw);
    return {text: stopped ? raw.split('·').map((x) => x.trim()).filter((x) => x && !STOPPED.test(x)).join(' · ') : raw, stopped};
  }

  function write(lab, kind, text, right, mono) {
    if (lab.dataset.kind !== kind) lab.dataset.kind = kind;
    const b = lab.querySelector('b'), span = lab.querySelector('span'), em = span.querySelector('em'), i = lab.querySelector('i');
    const verb = (kind === 'git' && window.__pinkieToolKind ? window.__pinkieToolKind.ing('git', text) : VERB[kind]) || VERB.think;
    if (b.textContent !== verb) b.textContent = verb;
    if (em.textContent !== (text || '')) em.textContent = text || '';
    span.toggleAttribute('data-mono', !!(mono && text));
    span.hidden = !text;
    if (i.textContent !== (right || '')) i.textContent = right || '';
  }

  // 每张卡片的标题行：左侧小标 + 状态文字槽
  function decorate(details) {
    const sum = summaryOf(details);
    if (!sum) return null;
    if (!sum.querySelector(':scope > .cle-glyph')) sum.prepend(staticGlyph());
    let lab = sum.querySelector(':scope > .cle-status');
    if (!lab) {
      lab = document.createElement('span');
      lab.className = 'cle-status';
      lab.innerHTML = '<b></b><span><em></em></span><i></i>';
      sum.querySelector(':scope > .cle-glyph').after(lab);
    }
    // 不在运行中的卡片：一行写「完成 · N 个步骤 · 用时」
    if (details !== live && details !== finishing) {
      details.removeAttribute('data-cle-run');
      const m = metaOf(details);
      const images = details === latestCard() ? pendingImages() : null;
      if (images && !m.stopped) write(lab, 'image', '已发起 ' + images + ' 张 · 好了会自动发出来', '', false);
      else write(lab, m.stopped ? 'stopped' : 'done', m.text, '', false);
    }
    return sum;
  }

  // image_generate 发起后台任务后这一轮就结束了，图片要再等一两分钟才会由
  // 完成事件发回来。这段时间不能把最后一张卡片写成「完成」，否则先生会以为
  // 碧琪忘了发图。依据：先生最后一句话之后，已发起的后台生图多于已交付的
  // MEDIA 行。10 分钟后不再提示，免得失败的任务把状态永远挂住。
  function messageText(m) {
    const c = m && m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
    return '';
  }
  function pendingImages() {
    const BG_STARTED = /Background task started for \w+ generation\b/;
    const INTERNAL_USER = /^(?:A background task completed|<<<BEGIN_OPENCLAW_INTERNAL|\[pinkie-|\u2063|\[chat\.history omitted|\[System\])/;
    const BG_HINT_MAX_MS = 10 * 60 * 1000;
    const pane = document.querySelector('openclaw-chat-pane');
    const msgs = pane && pane.state && pane.state.chatMessages;
    if (!Array.isArray(msgs) || !msgs.length) return 0;
    let start = 0;
    for (let k = msgs.length - 1; k >= 0; k--) {
      const m = msgs[k];
      if (m && m.role === 'user' && !INTERNAL_USER.test(messageText(m).trim())) { start = k + 1; break; }
    }
    let started = 0, delivered = 0, since = 0;
    for (let k = start; k < msgs.length; k++) {
      const m = msgs[k], t = messageText(m);
      if (m.role === 'toolResult' && BG_STARTED.test(t)) {
        started++;
        if (!since) since = Number(m.timestamp) || Date.now();
      } else if (m.role === 'assistant') {
        delivered += (t.match(/^MEDIA:/gm) || []).length;
      }
    }
    if (!started || delivered >= started || Date.now() - since > BG_HINT_MAX_MS) return 0;
    return started - delivered;
  }
  function latestCard() {
    const all = document.querySelectorAll('.chat-group--process details.pinkie-process');
    return all.length ? all[all.length - 1] : null;
  }
  setInterval(() => {
    const card = latestCard();
    if (card && card !== live && card !== finishing) decorate(card);
  }, 2000);

  // 把动画小标交给某张卡片（替换它的静态小标）
  function claim(details) {
    const g = animGlyph();
    if (!g) return false;
    if (owner && owner !== details) release();
    const sum = decorate(details);
    if (!sum) return false;
    const old = sum.querySelector(':scope > .cle-glyph--static');
    if (old) old.replaceWith(g);
    else if (g.parentNode !== sum) sum.prepend(g);
    owner = details;
    details.setAttribute('data-cle-active', '');
    return true;
  }

  function release() {
    if (!owner) return;
    const sum = summaryOf(owner);
    owner.removeAttribute('data-cle-active');
    if (glyph && glyph.parentNode) glyph.replaceWith(staticGlyph());
    else if (sum && !sum.querySelector(':scope > .cle-glyph')) sum.prepend(staticGlyph());
    owner = null;
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + ' 秒' : Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
  }

  function status(details, kind, text, right, mono) {
    const sum = decorate(details);
    if (sum) write(sum.querySelector(':scope > .cle-status'), kind, text, right, mono);
  }

  // 没收到网关事件时，从卡片里最后一行推断当前步骤
  function domStep(details) {
    if (details.dataset.live !== '1') return {kind: 'reply', text: ''};
    if (details.querySelector('.pinkie-thinking.is-live')) return {kind: 'think', text: ''};
    const rows = details.querySelectorAll('.pinkie-process__rows .chat-tool-msg-summary');
    if (!rows.length) return {kind: 'think', text: ''};
    const last = rows[rows.length - 1];
    const rec = ARGS[callIdOf(last)];
    if (rec) return {kind: rec.k, text: rec.t, mono: rec.m};
    const names = last.querySelector('.chat-tool-msg-summary__names');
    return {kind: kindOfRow(last), text: names ? names.textContent.replace(/\s+/g, ' ').trim() : ''};
  }

  // 本轮焦点：触发它的那条用户消息起，往后都保持明亮
  function markFocus(details) {
    document.querySelectorAll('[data-cle-focus]').forEach((n) => n.removeAttribute('data-cle-focus'));
    let g = details.closest('.chat-group');
    let anchor = g;
    while (g && g.previousElementSibling) {
      g = g.previousElementSibling;
      if (g.classList.contains('user')) { anchor = g; break; }
    }
    if (anchor) anchor.setAttribute('data-cle-focus', '');
  }

  /* ── 运行中 ── */
  function begin(details) {
    clearTimeout(doneTimer);
    if (finishing) { const f = finishing; finishing = null; finishInfo = null; if (f !== details) decorate(f); }
    live = details;
    liveSince = liveSince || (run.on && run.since) || Date.now();   // 事件还没到时别拿上一轮的起点
    decorate(details);
    details.setAttribute('data-cle-run', '');
    if (claim(details)) {
      root.setAttribute('data-cle-live', '');
      markFocus(details);
    }
    sync();
    clearInterval(tick);
    tick = setInterval(scan, 1000);                 // 每秒刷新用时；结束信号也可能不在聊天区里
  }

  function sync() {
    if (!live) return;
    const step = run.on ? run : domStep(live);
    if (space && owner === live) space.set(step.kind === 'ask' ? 'think' : step.kind === 'exec' || step.kind === 'reply' || step.kind === 'plan' ? 'write' : step.kind);
    status(live, step.kind, step.text, fmt(Date.now() - liveSince), step.mono);
  }

  function showFinish(d) {
    const m = metaOf(d);
    const steps = d.querySelectorAll('.pinkie-process__rows .chat-tool-msg-summary').length;
    status(d, finishInfo.stopped ? 'stopped' : 'done', m.text || (steps ? steps + ' 个步骤' : ''), m.text ? '' : finishInfo.took, false);
  }

  function finish() {
    const d = live;
    if (!d) return;
    clearInterval(tick);
    live = null;
    const stopped = run.seen && !run.on ? run.stopped : metaOf(d).stopped;
    d.setAttribute('data-cle-ended', '');
    finishInfo = {stopped, took: liveSince ? fmt(Date.now() - liveSince) : ''};
    liveSince = 0;
    finishing = d;
    showFinish(d);
    // 被中断的不落款，安静地回到签名
    const animated = !!(space && owner === d) && !stopped;
    if (space && owner === d) space.set(stopped ? 'idle' : 'done');
    doneTimer = setTimeout(endHold, animated ? DONE_HOLD : 1200);
  }

  function endHold() {
    const f = finishing;
    finishing = null;
    finishInfo = null;
    root.removeAttribute('data-cle-live');
    release();
    if (f) { f.removeAttribute('data-cle-run'); if (f.isConnected) decorate(f); }
  }

  // 结束后 App 会用历史记录重渲染整段对话，原卡片被换掉 —— 落款接到替身上继续，不重播
  function adopt(twin) {
    if (!twin || twin === finishing) return;
    if (owner === finishing) owner = null;
    finishing = twin;
    twin.setAttribute('data-cle-run', '');
    twin.setAttribute('data-cle-ended', '');
    claim(twin);
    markFocus(twin);
    // 重绘出来的历史才是定论：模型最后没给出回复（空回复 / 出错）时 App 会标「已中断」，
    // 这时不再落款，安静地回到签名，免得先写「完成」过几秒又变「已中断」
    if (finishInfo && !finishInfo.stopped && metaOf(twin).stopped) {
      finishInfo.stopped = true;
      if (space && owner === twin) space.set('idle');
      clearTimeout(doneTimer);
      doneTimer = setTimeout(endHold, 1200);
    }
    showFinish(twin);
  }

  /* ── 网关事件 ── */
  // Gemini 这类模型会先安静地想十几秒，再把「说明 + 工具 + 结果」在几十毫秒内一起吐出来。
  // 工具步骤先排队，状态行逐个播放，每步至少停留 MIN_STEP，动画才有机会被看见。
  function show(step) {
    Object.assign(run, {kind: step.kind, text: step.text || '', mono: !!step.mono});
    schedule();
  }
  function pump() {
    clearTimeout(run.pumpT);
    const now = Date.now(), c = run.cur;
    if (c && now - c.at < MIN_STEP) { run.pumpT = setTimeout(pump, c.at + MIN_STEP - now); return; }
    if (run.queue.length) {
      run.cur = run.queue.shift();
      run.cur.at = now;
      show(run.cur);
      run.pumpT = setTimeout(pump, MIN_STEP);
      return;
    }
    if (c && !c.done) return;                       // 工具还在跑，等它的结果
    run.cur = null;
    show({kind: run.bg});
  }
  function resetSteps(bg) {
    clearTimeout(run.pumpT);
    Object.assign(run, {queue: [], cur: null, bg: bg || 'think'});
  }
  function stepDone(id) {
    const all = run.cur ? [run.cur, ...run.queue] : run.queue;
    const st = all.find((x) => x.id === id);
    if (st) st.done = true;
    pump();
  }

  function onEvent(e) {
    const {event: name, payload: p} = (e && e.detail) || {};
    if (!p) return;
    if (p.sessionKey && p.sessionKey !== sessionKey()) return;
    const d = p.data || {};
    if (name === 'agent' || name === 'session.tool') {
      const stream = p.stream;
      if (stream === 'lifecycle') {
        if (d.phase === 'start') {
          Object.assign(run, {on: true, seen: true, since: Date.now(), stopped: false, quiet: 0});
          resetSteps('think');
          show({kind: 'think'});
        } else if (d.phase === 'end' || d.phase === 'error') {
          run.on = false;
          run.endedAt = Date.now();
          run.stopped = d.aborted === true || d.phase === 'error' || /abort|error/i.test(String(d.stopReason || ''));
          resetSteps('think');
          schedule();
        }
        return;
      }
      if (stream === 'thinking' || stream === 'assistant' || stream === 'tool') {
        // 运行中途打开 / 刷新页面：没有 start，见到第一条事件就接上
        if (!run.on) {
          if (Date.now() - run.endedAt < 3000) return;
          Object.assign(run, {on: true, seen: true, since: Date.now(), stopped: false, quiet: 0});
          resetSteps('think');
        }
        if (stream === 'tool') {
          const id = d.toolCallId || '';
          if (d.phase === 'start') {
            const k = kindOfCall(d.name, d.args) || kindOf(d.name);
            const a = argText(d.name, d.args, d.meta);
            if (id) { ARGS[id] = {k, t: a.text, m: a.mono, n: normTool(d.name), at: Date.now()}; saveArgs(); }
            run.queue.push({id, kind: d.name === 'ask_user' ? 'ask' : k, text: a.text, mono: a.mono, done: false});
            pump();
          } else if (d.phase === 'result') {
            stepDone(id);
          }
        } else {
          run.bg = stream === 'thinking' ? 'think' : 'reply';
          pump();
        }
        return;
      }
      if (stream === 'item' && d.kind === 'tool' && d.phase === 'start' && d.toolCallId && ARGS[d.toolCallId] && !ARGS[d.toolCallId].t && d.meta) {
        ARGS[d.toolCallId].t = firstLine(d.meta);
        saveArgs();
      }
      return;
    }
    if (/^(?:exec|plugin)\.approval\.requested$/.test(String(name))) { run.queue.push({id: 'approval', kind: 'ask', text: '', done: false}); pump(); return; }
    if (/^(?:exec|plugin)\.approval\.resolved$/.test(String(name))) { stepDone('approval'); return; }
    if (name === 'chat' && ['aborted', 'error'].includes(p.state) && run.on) {
      run.on = false; run.endedAt = Date.now(); run.stopped = true; resetSteps('think'); schedule();
    }
  }
  window.addEventListener('pinkie:gateway-event', onEvent);
  // 后端（tool-trace.mjs）查过的事实：写入前路径不存在 → 「创建」；读到了图片 → 「看图片」。
  // laolao-tool-images 拿到后逐条广播；没有记录的调用保持原来的说法，不猜。
  window.addEventListener('pinkie:tool-trace', (e) => {
    const {callId, trace} = (e && e.detail) || {};
    if (!callId || !trace) return;
    const tk = window.__pinkieToolKind;
    const rec = ARGS[callId];
    let k = '', t = '';
    if (rec) {
      // 本机记过参数（运行时看到的）：只在后端事实上细分
      k = tk ? tk.refine(rec.k === 'create' ? 'write' : rec.k, rec.n || '', null, trace) : rec.k;
      if (k === rec.k) return;
    } else if (trace.created === true || trace.created === false) {
      k = trace.created ? 'create' : 'write'; t = trace.name || '';
    } else if (trace.command) {
      // 换了浏览器、历史里没有参数：后端记下的命令原文
      k = (tk && tk.ofCommand(trace.command)) || 'exec'; t = trace.command;
    } else {
      // 只有图片：交给 kindOfRow 按行上的工具名判断（读文件 → 看图片；生图仍是生图）
      document.querySelectorAll('.pinkie-process .chat-tool-msg-summary[data-tool-kind]').forEach((b) => { if (callIdOf(b) === callId) b.removeAttribute('data-tool-kind'); });
      schedule();
      return;
    }
    ARGS[callId] = {...(rec || {t, m: true, at: Date.now()}), k};
    saveArgs();
    const all = run.cur ? [run.cur, ...run.queue] : run.queue;
    const step = all.find((x) => x.id === callId);
    if (step) { step.kind = k; if (run.cur === step) show(step); }
    schedule();
  });
  window.addEventListener('pinkie:session-selected', () => {
    if (live) { live.removeAttribute('data-cle-run'); live = null; }
    clearInterval(tick);
    clearTimeout(doneTimer);
    endHold();
    liveSince = 0;
    document.querySelectorAll('[data-cle-focus]').forEach(n => n.removeAttribute('data-cle-focus'));
    Object.assign(run, {on: false, seen: false, since: 0, kind: 'think', text: '', quiet: 0});
    resetSteps('think');
    schedule();
  });

  /* ── 展开后的过程：说明照常显示，连续的工具收成一行「已运行 2 个命令 ›」 ── */
  // 每类工具做完之后怎么说（「搜了 2 次网页」「出了一道练习」）
  const cnNum = (n) => (n === 1 ? '一' : n === 2 ? '两' : String(n));
  const DONE_WORD = {
    exec: (n) => `运行了 ${n} 个命令`, read: (n) => `读了 ${n} 个文件`, write: (n) => `写了 ${n} 个文件`,
    edit: (n) => `改了 ${n} 个文件`, plan: (n) => (n > 1 ? `更新了 ${n} 次计划` : '更新了计划'),
    search: (n) => `搜了 ${n} 次网页`, fetch: (n) => `看了 ${n} 个网页`, browse: (n) => `用浏览器看了 ${n} 次`,
    find: (n) => `查了 ${n} 次代码`, test: (n) => `跑了 ${n} 次测试`,
    quiz: (n) => `出了${cnNum(n)}道练习`, lab: (n) => `做了${cnNum(n)}个小互动`, grade: (n) => `批改了 ${n} 次`,
    note: (n) => `记了 ${n} 条手账`, memory: (n) => `翻了 ${n} 次记忆`, session: (n) => `安排了 ${n} 次子会话`,
    show: (n) => `在工作台打开了 ${n} 个文件`, computer: (n) => `操作了 ${n} 次电脑`, webgpt: (n) => `和网页 GPT 协作了 ${n} 次`,
    image: (n) => `生成了 ${n} 张图`, ask: (n) => `问了你 ${n} 次`, cron: (n) => `设了 ${n} 个定时`, tool: (n) => `用了 ${n} 个工具`,
    // PLAN 2.8 补全：一次时说清对象（「创建了 a.txt」），多次时说个数
    create: (n, w) => (n === 1 && window.__pinkieToolKind ? window.__pinkieToolKind.done('create', w) : `创建了 ${n} 个文件`),
    delete: (n, w) => (n === 1 && window.__pinkieToolKind ? window.__pinkieToolKind.done('delete', w) : `删除了 ${n} 次`),
    move: (n, w) => (n === 1 && window.__pinkieToolKind ? window.__pinkieToolKind.done('move', w) : `移动了 ${n} 次`),
    install: (n, w) => (n === 1 && window.__pinkieToolKind ? window.__pinkieToolKind.done('install', w) : `安装了 ${n} 次`),
    build: (n) => (n === 1 ? '构建完成' : `构建了 ${n} 次`),
    git: (n, w) => (n === 1 && window.__pinkieToolKind ? window.__pinkieToolKind.done('git', w) : `git 操作了 ${n} 次`),
    download: (n, w) => (n === 1 && window.__pinkieToolKind ? window.__pinkieToolKind.done('download', w) : `下载了 ${n} 个文件`),
    view: (n, w) => (n === 1 && window.__pinkieToolKind ? window.__pinkieToolKind.done('view', w) : `看了 ${n} 张图片`),
    shot: (n) => (n === 1 ? '截了一张图' : `截了 ${n} 张图`),
    dispatch: (n, w) => (n === 1 && window.__pinkieToolKind ? window.__pinkieToolKind.done('dispatch', w) : `派出了 ${n} 个子会话`),
    wait: () => '等子会话', review: () => '验收了',
    manage: (n) => (n === 1 ? '整理了会话' : `整理了 ${n} 次会话`), models: () => '看了可用模型',
  };
  const openRuns = new Set();         // 用户点开的工具组（按第一步的 toolCallId 记，重绘后照样展开）
  const seenSteps = new WeakSet();    // 已经出场过的步骤；运行中新来的依次淡入

  function argsOf(row) {
    const rec = ARGS[callIdOf(row)];
    if (rec && rec.t) return rec;
    const names = row.querySelector('.chat-tool-msg-summary__names');
    return names ? {t: names.textContent.replace(/\s+/g, ' ').trim(), m: false} : null;
  }

  function runLabel(rows) {
    const count = {};
    rows.forEach((r) => { const k = r.getAttribute('data-tool-kind') || 'exec'; count[k] = (count[k] || 0) + 1; });
    const kinds = Object.keys(count);
    const said = kinds.slice(0, 2).map((k) => {
      const one = count[k] === 1 ? rows.find((r) => (r.getAttribute('data-tool-kind') || 'exec') === k) : null;
      const a = one && typeof argsOf === 'function' ? argsOf(one) : null;
      return (DONE_WORD[k] || DONE_WORD.tool)(count[k], a ? a.t : '');
    }).join('，');
    return kinds.length > 2 ? said + '，共 ' + rows.length + ' 步' : said;
  }

  function shapeRows() {
    document.querySelectorAll('.pinkie-process .chat-tool-msg-summary').forEach((b) => {
      // 类别可能在后端记录到达后被细分（写入 → 创建）：有记录的每次以记录为准，没有的只算一次
      const known = ARGS[callIdOf(b)];
      if (known && known.k) { if (b.getAttribute('data-tool-kind') !== known.k) b.setAttribute('data-tool-kind', known.k); }
      else if (!b.hasAttribute('data-tool-kind')) b.setAttribute('data-tool-kind', kindOfRow(b));
      if (b.querySelector(':scope > .cle-args')) return;
      const rec = ARGS[callIdOf(b)];
      if (!rec || !rec.t) return;
      const s = document.createElement('span');
      s.className = 'cle-args';
      if (rec.m) s.setAttribute('data-mono', '');
      s.textContent = rec.t;
      b.append(s);
    });
    document.querySelectorAll('.pinkie-process .pinkie-process__rows').forEach((box) => {
      const card = box.closest('details.pinkie-process');
      const liveCard = !!card && card.dataset.live === '1' && !card.hasAttribute('data-cle-ended');
      const kids = [...box.children].filter((g) => g.classList.contains('chat-group'));
      // 新出场的步骤：运行中依次淡入（同一时刻到的错开 0.28 秒），历史与重绘不动
      let enter = 0;
      kids.forEach((g) => {
        if (seenSteps.has(g)) return;
        seenSteps.add(g);
        if (liveCard && box.dataset.cleSeen) { g.style.animationDelay = (enter++ * 280) + 'ms'; g.setAttribute('data-cle-enter', ''); }
      });
      if (!box.dataset.cleSeen) box.dataset.cleSeen = '1';
      // 连续的工具 → 一组
      const runs = [];
      let cur = null;
      kids.forEach((g) => {
        if (g.classList.contains('tool')) { if (!cur) runs.push(cur = []); cur.push(g); } else cur = null;
      });
      runs.forEach((list) => {
        const head = list[0];
        const rows = list.flatMap((g) => [...g.querySelectorAll('.chat-tool-msg-summary')]);
        const key = (rows[0] && callIdOf(rows[0])) || '';
        const open = openRuns.has(key);
        list.forEach((g) => {
          if (g.hasAttribute('data-cle-folded') === open) g.toggleAttribute('data-cle-folded', !open);
          if (g !== head && !g.hasAttribute('data-cle-member')) g.setAttribute('data-cle-member', '');
        });
        if (head.hasAttribute('data-cle-member')) head.removeAttribute('data-cle-member');
        let btn = head.querySelector(':scope > .cle-run');
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cle-run';
          btn.innerHTML = '<i></i><b></b><span></span>';
          head.prepend(btn);
        }
        if (btn.dataset.key !== key) btn.dataset.key = key;
        if (btn.getAttribute('aria-expanded') !== String(open)) btn.setAttribute('aria-expanded', String(open));
        const lastRow = rows[rows.length - 1];
        const kind = lastRow ? lastRow.getAttribute('data-tool-kind') || 'exec' : 'exec';
        if (btn.dataset.kind !== kind) btn.dataset.kind = kind;
        const label = runLabel(rows);
        const b = btn.querySelector('b');
        if (b.textContent !== label) {
          if (b.textContent && liveCard) { btn.removeAttribute('data-bump'); void btn.offsetWidth; btn.setAttribute('data-bump', ''); }
          b.textContent = label;
        }
        const a = lastRow && argsOf(lastRow);
        const span = btn.querySelector('span');
        const text = a ? a.t : '';
        if (span.textContent !== text) span.textContent = text;
        span.toggleAttribute('data-mono', !!(a && a.m));
        // 正在进行的这一组（运行中、且是过程里最后一段）：圆点呼吸
        const active = liveCard && list[list.length - 1] === kids[kids.length - 1];
        if (btn.hasAttribute('data-active') !== active) btn.toggleAttribute('data-active', active);
      });
    });
  }
  /* 长篇推演收进「思路」。模型常把几千字的需求分析、模块设计、代码草稿写在调用工具前的正文里，
     摊在过程里就找不到碧琪正在做哪一步。最后一段（碧琪接下来要做什么）照常显示，前面的推演收成
     一行「思路 · N 字 ›」，点开再看；运行中正在写的那一段也照常显示。一两句的说明不受影响。 */
  const PLAN_MIN = 240;               // 整段超过这么多字才考虑收
  const PLAN_TAIL = 400;              // 最后一段不超过这么长就留在外面当「说明」
  const openPlans = new Set();        // 用户点开的思路（按开头文字记，流式输出时也稳定）
  const planWords = (n) => n < 10000 ? n.toLocaleString('zh-CN') + ' 字' : (n / 10000).toFixed(1) + ' 万字';
  function shapePlans() {
    document.querySelectorAll('.pinkie-process .pinkie-process__rows > .chat-group.assistant .chat-text').forEach((box) => {
      const blocks = [...box.children].filter((c) => !c.classList.contains('cle-plan'));
      const len = (el) => (el.textContent || '').replace(/\s+/g, '').length;
      const total = blocks.reduce((n, b) => n + len(b), 0);
      const last = blocks[blocks.length - 1];
      const tail = last && len(last) <= PLAN_TAIL ? last : null;
      const plan = tail ? blocks.slice(0, -1) : blocks;
      const planLen = plan.reduce((n, b) => n + len(b), 0);
      let btn = box.querySelector(':scope > .cle-plan');
      if (total <= PLAN_MIN || blocks.length < 2 || planLen < 160) {
        if (btn) btn.remove();
        if (box.hasAttribute('data-cle-planfold')) box.removeAttribute('data-cle-planfold');
        blocks.forEach((b) => b.hasAttribute('data-cle-plan') && b.removeAttribute('data-cle-plan'));
        return;
      }
      const key = blocks.map((b) => b.textContent || '').join('').replace(/\s+/g, '').slice(0, 64);
      const open = openPlans.has(key);
      blocks.forEach((b) => { const want = plan.includes(b); if (b.hasAttribute('data-cle-plan') !== want) b.toggleAttribute('data-cle-plan', want); });
      const state = open ? 'open' : 'folded';
      if (box.getAttribute('data-cle-planfold') !== state) box.setAttribute('data-cle-planfold', state);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cle-run cle-plan';
        btn.dataset.kind = 'plan';
        btn.innerHTML = '<i></i><b>思路</b><span></span>';
      }
      if (box.firstElementChild !== btn) box.prepend(btn);
      if (btn.dataset.key !== key) btn.dataset.key = key;
      if (btn.getAttribute('aria-expanded') !== String(open)) btn.setAttribute('aria-expanded', String(open));
      const words = planWords(planLen);
      const span = btn.querySelector('span');
      if (span.textContent !== words) span.textContent = words;
    });
  }
  document.addEventListener('click', (e) => {
    const plan = e.target.closest && e.target.closest('.cle-plan');
    if (plan) {
      e.preventDefault();
      e.stopPropagation();
      const key = plan.dataset.key || '';
      if (openPlans.has(key)) openPlans.delete(key); else openPlans.add(key);
      shapePlans();
      return;
    }
    const btn = e.target.closest && e.target.closest('.cle-run');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.key || '';
      if (openRuns.has(key)) openRuns.delete(key); else openRuns.add(key);
      shapeRows();
      return;
    }
    // 状态行本身不再折叠整段过程（过程常显，像 Claude Code）
    const sum = e.target.closest && e.target.closest('.pinkie-process > .pinkie-process__summary');
    if (sum && sum.querySelector('.cle-status')) e.preventDefault();
  }, true);

  /* ── 观察 ── */
  let pending = false, host = null;
  function scan() {
    pending = false;
    shapeRows();
    shapePlans();
    cards().forEach(decorate);
    // 动画小标被重渲染冲掉时补回
    if (owner && glyph && !glyph.isConnected && owner.isConnected) {
      const sum = summaryOf(owner);
      const st = sum && sum.querySelector(':scope > .cle-glyph--static');
      if (st) st.replaceWith(glyph); else if (sum) sum.prepend(glyph);
    }
    const tc = turnCard();
    // 安全阀：漏掉了结束事件（断线重连等）——停止按钮没了、卡片也不在跑，5 秒后收尾
    if (run.on) {
      if (!busy() && !(tc && tc.dataset.live === '1')) {
        if (!run.quiet) run.quiet = Date.now();
        else if (Date.now() - run.quiet > 5000) { run.on = false; run.endedAt = Date.now(); run.stopped = metaOf(tc || lastCard() || document.body).stopped; }
      } else run.quiet = 0;
    }
    // 发送后卡片先出现，网关的 start 事件晚一两秒才到：界面信号先接上，事件到了再细化。
    // 刚结束的那张卡片（和它的替身）不会再被当成新一轮。
    const domLive = !!(tc && tc.dataset.live === '1' && busy() && !tc.hasAttribute('data-cle-ended'));
    const running = run.on || (domLive && (!run.seen || Date.now() - run.endedAt > 2500));
    if (running && tc) {
      if (tc !== live) begin(tc); else sync();
    } else if (running && live && !live.isConnected) {
      // 卡片正被重绘，等新卡片出现
    } else if (!running && live) {
      finish();
    }
    if (finishing && !finishing.isConnected) adopt(tc || lastCard());
    if (root.hasAttribute('data-cle-live')) {
      const current = live?.isConnected ? live : finishing?.isConnected ? finishing : null;
      if (current) markFocus(current);
    }
  }
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(scan, 120);                          // 不用 rAF：窗口在后台时也要跟上状态
  }
  const mo = new MutationObserver(schedule);
  function attach() {
    const h = document.querySelector('.chat-thread-inner');
    if (h === host) return;
    mo.disconnect();
    host = h;
    if (h) mo.observe(h, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-live', 'class']});
    schedule();
  }
  setInterval(attach, 300);
  attach();
  window.addEventListener('pagehide', () => mo.disconnect());

  window.__cleStage = {
    get run() { return run; },
    get space() { return space; },
    args: ARGS,
  };
}
