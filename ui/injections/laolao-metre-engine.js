/* laolao-metre-engine —— Metre 的「引擎台」（briefs/metre-engines-1122 PLAN 3.3、3.5）。
 *
 * 用户 11-22：「做融合……Metre 没有的就做一个 Metre UI 覆盖」「本质上也是完善 Metre 所有功能」。
 * 所以这里不嵌 T3 的页面，而是 Metre 自己画：功能照 T3 Code（引擎和模型、中途递话、审批、提问、改动、置顶归档、额度）
 * 和 OpenMausBot（放手程度四档）来，样子是 Metre 的（谱纸配色、衬线斜体的音乐用词、像素记号）。
 *
 *   - Metre 输入框下面多一颗「引擎」按钮：Metre（默认）/ Claude Code / Codex / Antigravity，带登录和额度状态，再选模型。
 *   - 选了外部引擎，这个 Metre 会话的正文区换成引擎台：对话流、自己的输入框、待批准和提问卡片、右侧改动面板。
 *   - 数据全走网关：pinkie.engines.session / choose / say / respond / stop / organize / diff / catalog / enable / signin。
 *   - 刷新：引擎台开着时在跑 1 秒一次、闲着 4 秒一次；页面藏起来时不拉。 */
(() => {
  'use strict';
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const rpc = (method, params = {}, timeout = 15000) => typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(method, params, timeout) : Promise.reject(new Error('还没连上碧琪'));
  const sessionKey = () => {
    try { const key = new URL(location.href).searchParams.get('session') || ''; return /^agent:metre:/.test(key) ? key : ''; }
    catch { return ''; }
  };
  const esc = text => String(text ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const h = (tag, cls, html) => { const node = document.createElement(tag); if (cls) node.className = cls; if (html != null) node.innerHTML = html; return node; };
  const pad = n => String(n).padStart(2, '0');
  const when = at => {
    if (!at) return '';
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === today.toDateString() ? `今天 ${clock}` : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${clock}`;
  };
  const toast = text => {
    if (typeof window.__laolaoToast === 'function') { window.__laolaoToast(text); return; }
    window.__laolaoSidebar?.toast?.(text);
  };

  const LEVEL_SHORT = {'full-access': '全放手', auto: '自己判断', 'auto-accept-edits': '改文件不问', 'approval-required': '每步都问'};
  const ENGINE_NAMES = {metre: 'Metre', claudeAgent: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity'};
  const STATUS_WORD = {idle: '', running: '在奏', waiting: '等你', done: '奏完', failed: '没奏成', stopped: '收住了'};
  // 像素记号（9×9，和 Metre 的像素 M 同一套画法）：一个休止符——引擎台还没开始的样子。
  const REST = ['..##.....', '...##....', '....##...', '...##....', '..##.....', '...##....', '....###..', '.....##..', '....#....'];
  const pixel = (rows, cls) => {
    let dots = '';
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') dots += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
    return `<svg class="${cls}" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${dots}</svg>`;
  };

  // ---------- C.le. 思考动画（用户 11-22：「记得保留 C.le. 思考动画 three.js」） ----------
  // 和 Metre 原生对话的工作过程标题行是同一个 three.js 粒子签名（laolao-cle-space.js），地址和 laolao-cle-stage.js 的动态 import 一字不差，
  // 所以是同一份模块；引擎在跑时在对话最下面一行动，每一步换一个形状，做完落款再换回静态签名，然后把 WebGL 上下文还回去。
  const CLE_SPACE = '/laolao-cle-space.js?v=8';
  const CLE_HOLD = 6900;
  const CLE_VERB = {think: '思考中', read: '正在读取', write: '正在写入', edit: '正在修改', exec: '正在执行', ask: '等你确认', plan: '正在更新计划',
    reply: '正在回复', search: '正在搜索', find: '正在查代码', test: '正在跑测试', tool: '正在用工具', done: '完成', stopped: '已中断', fail: '没奏成'};
  const cle = {Space: null, loading: null, space: null, glyph: null, kind: '', finishing: 0, svg: '', gl: null};
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const webglOK = () => {
    if (cle.gl == null) { try { const c = document.createElement('canvas'); cle.gl = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { cle.gl = false; } }
    return cle.gl;
  };
  const canAnimate = () => !reduceMotion?.matches && !root.hasAttribute('data-pinkie-lite') && webglOK();
  function loadCle() {
    if (cle.Space) return Promise.resolve(cle.Space);
    return cle.loading ||= Promise.resolve(window.__pinkieQuiet?.loadSignature?.()).then(() => import(CLE_SPACE))
      .then(mod => (cle.Space = mod.CleSpace)).catch(() => { cle.loading = null; return null; });
  }
  function staticGlyph() {
    if (!cle.svg && window.CleSignature?.outline) {
      const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      host.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
      document.body.append(host);
      try { cle.svg = '<svg viewBox="0 0 200 96" aria-hidden="true" fill="currentColor">' + window.CleSignature.outline(host).map(d => `<path d="${d}"/>`).join('') + '</svg>'; } catch {}
      host.remove();
    }
    if (!cle.svg) loadCle();
    return h('span', 'cle-glyph cle-glyph--static', cle.svg);
  }
  function liveGlyph() {
    if (cle.glyph) return cle.glyph;
    if (!canAnimate()) return null;
    if (!cle.Space) { loadCle(); return null; }
    const glyph = h('span', 'cle-glyph cle-glyph--live');
    try { cle.space = new cle.Space(glyph, {palette: 'cle', count: 1100, size: .17, fitW: 10.2, fitH: 5.4, interactive: false}); }
    catch { return null; }
    cle.glyph = glyph;
    return glyph;
  }
  function dropCle() {
    clearTimeout(cle.finishing);
    cle.finishing = 0;
    try { cle.space?.dispose(); } catch {}
    cle.space = null; cle.glyph?.remove(); cle.glyph = null; cle.kind = '';
  }
  // 此刻在做的那一步 → C.le. 的步骤类别和标题行的内容。
  function stepOf(summary) {
    if (summary?.pending?.length) return {kind: 'ask', text: ''};
    const item = [...(summary?.items || [])].reverse().find(row => row.kind !== 'note') || null;
    switch (item?.kind) {
      case 'thinking': return {kind: 'think', text: ''};
      case 'command': return {kind: /\b(?:test|jest|vitest|pytest|cargo test|go test)\b/.test(item.command) ? 'test' : 'exec', text: item.command.split('\n')[0].slice(0, 80), mono: true};
      case 'edit': return {kind: 'edit', text: item.file.split(/[\\/]/).pop(), mono: true};
      case 'search': return {kind: 'find', text: item.text};
      case 'web': return {kind: 'search', text: item.text};
      case 'tool': return {kind: 'tool', text: item.name};
      case 'todo': case 'plan': return {kind: 'plan', text: ''};
      case 'reply': return {kind: item.streaming ? 'reply' : 'think', text: ''};
      default: return {kind: 'think', text: ''};
    }
  }
  const secondsBetween = (from, to) => { const a = Date.parse(from), b = to ? Date.parse(to) : Date.now(); return a && b >= a ? Math.round((b - a) / 1000) : 0; };
  const spanText = s => !(s > 0) ? '' : s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;

  // ---------- 小号 markdown：先转义，再认几种常用写法。不放任何 HTML 进来。 ----------
  function inline(text) {
    return esc(text)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function md(text) {
    const out = [];
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let list = null, para = [];
    const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
    const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`); list = null; };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = /^\s*```(\S*)/.exec(line);
      if (fence) {
        flushPara(); flushList();
        const code = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
        out.push(`<pre class="pk-eng-code"><code>${esc(code.join('\n'))}</code></pre>`);
        continue;
      }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (heading) { flushPara(); flushList(); out.push(`<h${Math.min(6, heading[1].length + 2)}>${inline(heading[2])}</h${Math.min(6, heading[1].length + 2)}>`); }
      else if (bullet || number) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (list?.tag !== tag) { flushList(); list = {tag, items: []}; }
        list.items.push((bullet || number)[1]);
      } else if (!line.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
    return out.join('');
  }
  function diffHtml(text) {
    return String(text || '').split('\n').slice(0, 4000).map(line => {
      const cls = /^(diff --git|index |---|\+\+\+)/.test(line) ? 'meta' : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
      return `<span class="pk-eng-diff__l${cls ? ' pk-eng-diff__l--' + cls : ''}">${esc(line) || ' '}</span>`;
    }).join('');
  }

  // ---------- 状态 ----------
  const state = {key: '', view: null, catalog: null, catalogAt: 0, loading: false, sending: false, enabling: false,
    open: new Set(), think: new Map(), diff: {open: false, data: null, at: 0}, lastSig: '', mode: 'queue', nodes: new Map(), timer: 0};

  async function loadCatalog(force = false) {
    if (!force && state.catalog && Date.now() - state.catalogAt < 15000) return state.catalog;
    try { state.catalog = await rpc('pinkie.engines.catalog', {refresh: force}, force ? 30000 : 15000); state.catalogAt = Date.now(); }
    catch (error) { state.catalog = state.catalog || {engines: [], levels: [], error: error.message}; }
    return state.catalog;
  }
  const engineRow = id => (state.catalog?.engines || []).find(row => row.id === id) || null;
  const pref = () => state.view?.pref || {engine: 'metre'};
  const external = () => pref().engine && pref().engine !== 'metre';

  function engineNote(row) {
    if (!state.catalog?.enabled && !state.catalog?.running) return '外部引擎没打开';
    if (!row) return '还没装';
    if (!row.enabled) return '在引擎服务里还没启用';
    if (!row.installed) return '这台电脑还没装';
    if (row.quota?.state === 'out') return '额度用完了' + (row.quota.resetAt ? ` · ${when(row.quota.resetAt)} 恢复` : '');
    if (!row.signedIn) return '还没登录';
    const parts = [row.plan, row.quota?.text, row.version ? 'v' + row.version : ''].filter(Boolean);
    return parts.join(' · ') || '可以用';
  }
  const ready = row => Boolean(row && row.enabled && row.installed && row.signedIn && row.quota?.state !== 'out');

  // ---------- 引擎菜单（输入框下面的按钮和引擎台里的按钮共用） ----------
  let menu = null;
  function closeMenu() { menu?.remove(); menu = null; document.removeEventListener('pointerdown', outside, true); }
  function outside(event) { if (menu && !menu.contains(event.target) && !event.target.closest?.('.pk-eng-chip')) closeMenu(); }
  // 菜单开在按钮上方（放不下才放下方）；内容读回来变高以后再摆一次。
  function position(anchor, node) {
    const r = anchor.getBoundingClientRect();
    const w = node.offsetWidth, hgt = node.offsetHeight;
    const left = Math.max(12, Math.min(innerWidth - w - 12, r.left));
    const top = r.top - hgt - 8 > 12 ? r.top - hgt - 8 : Math.max(12, Math.min(innerHeight - hgt - 12, r.bottom + 8));
    Object.assign(node.style, {left: left + 'px', top: top + 'px'});
  }
  function place(anchor, node) {
    document.body.append(node);
    position(anchor, node);
    menu = node;
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }

  async function openEngineMenu(anchor, step = 'engines', engineId = '') {
    closeMenu();
    const key = state.key || sessionKey();
    if (!key) return;
    const node = h('div', 'pk-eng-menu');
    node.setAttribute('role', 'menu');
    node.innerHTML = '<div class="pk-eng-menu__head"><span class="pk-eng-menu__title">Engine</span><span class="pk-eng-menu__sub">这段对话交给谁来做</span></div><div class="pk-eng-menu__body"><div class="pk-eng-menu__wait">正在读引擎状态…</div></div>';
    place(anchor, node);
    const catalog = await loadCatalog(false);
    if (menu !== node) return;
    const body = node.querySelector('.pk-eng-menu__body');
    body.replaceChildren();
    if (step === 'models') {
      const row = engineRow(engineId);
      node.querySelector('.pk-eng-menu__sub').textContent = `${ENGINE_NAMES[engineId] || row?.name || engineId} 用哪个模型`;
      const back = h('button', 'pk-eng-menu__back', '‹ 换引擎');
      back.onclick = () => openEngineMenu(anchor);
      body.append(back);
      for (const model of row?.models || []) {
        const item = h('button', 'pk-eng-menu__item', `<span class="pk-eng-menu__name">${esc(model.name)}</span><span class="pk-eng-menu__note">${esc(model.slug)}${model.isDefault ? ' · 默认' : ''}</span>`);
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(pref().engine === engineId && pref().model === model.slug));
        item.onclick = () => { closeMenu(); choose({engine: engineId, model: model.slug}); };
        body.append(item);
      }
      if (!(row?.models || []).length) body.append(h('div', 'pk-eng-menu__wait', '这个引擎还没报上来能用的模型：先登录或者在引擎设置里启用它。'));
      position(anchor, node);
      return;
    }
    if (!catalog.enabled) {
      const off = h('div', 'pk-eng-menu__off', '<span>外部引擎没打开。打开后才会下载（约 170MB）和启动，只在这台电脑上跑。</span>');
      const on = h('button', 'pk-eng-btn pk-eng-btn--primary', '打开外部引擎');
      on.onclick = () => { closeMenu(); enableEngines(); };
      off.append(on);
      body.append(off);
    }
    const options = [{id: 'metre', name: 'Metre', note: '默认 · 用碧琪里配好的模型，能派活、能记项目'}]
      .concat(['claudeAgent', 'codex', 'antigravity'].map(id => ({id, name: ENGINE_NAMES[id], note: engineNote(engineRow(id)), row: engineRow(id)})));
    for (const option of options) {
      const current = (pref().engine || 'metre') === option.id;
      const item = h('button', 'pk-eng-menu__item' + (option.id !== 'metre' && !ready(option.row) ? ' pk-eng-menu__item--dim' : ''),
        `<span class="pk-eng-menu__name">${esc(option.name)}</span><span class="pk-eng-menu__note">${esc(option.note)}</span>`);
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(current));
      item.onclick = () => {
        if (option.id === 'metre') { closeMenu(); choose({engine: 'metre'}); return; }
        const models = option.row?.models || [];
        if (models.length) openEngineMenu(anchor, 'models', option.id);
        else { closeMenu(); choose({engine: option.id, model: ''}); }
      };
      body.append(item);
    }
    const levels = h('div', 'pk-eng-menu__levels');
    levels.innerHTML = '<div class="pk-eng-menu__label">放手程度</div>';
    for (const level of catalog.levels || []) {
      const seg = h('button', 'pk-eng-seg', esc(level.name));
      seg.title = level.hint;
      seg.setAttribute('aria-pressed', String((pref().level || 'full-access') === level.id));
      seg.onclick = () => { closeMenu(); choose({level: level.id}); };
      levels.append(seg);
    }
    body.append(levels);
    position(anchor, node);
  }

  function openLevelMenu(anchor) {
    closeMenu();
    const node = h('div', 'pk-eng-menu');
    node.innerHTML = '<div class="pk-eng-menu__head"><span class="pk-eng-menu__title">Permissions</span><span class="pk-eng-menu__sub">引擎动手之前要不要先问你</span></div>';
    const body = h('div', 'pk-eng-menu__body');
    for (const level of state.catalog?.levels || []) {
      const item = h('button', 'pk-eng-menu__item', `<span class="pk-eng-menu__name">${esc(level.name)}</span><span class="pk-eng-menu__note">${esc(level.hint)}</span>`);
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String((pref().level || 'full-access') === level.id));
      item.onclick = () => { closeMenu(); choose({level: level.id}); };
      body.append(item);
    }
    node.append(body);
    place(anchor, node);
  }

  async function choose(patch) {
    const key = state.key || sessionKey();
    if (!key) return;
    try {
      state.view = await rpc('pinkie.engines.choose', {sessionKey: key, ...patch}, 30000);
      if (patch.engine && patch.engine !== 'metre') toast(`这个会话交给 ${ENGINE_NAMES[patch.engine] || patch.engine}`);
      if (patch.engine === 'metre') toast('回到 Metre 自己来做');
      if (patch.level) toast('放手程度：' + (LEVEL_SHORT[patch.level] || patch.level));
    } catch (error) { toast(error.message); }
    paint();
  }

  async function enableEngines() {
    if (state.enabling) return;
    state.enabling = true;
    paint();
    try {
      await rpc('pinkie.engines.enable', {on: true}, 20 * 60_000);
      await loadCatalog(true);
      toast('外部引擎已经打开');
    } catch (error) { toast('没能打开外部引擎：' + error.message); }
    finally { state.enabling = false; paint(); refresh(); }
  }

  // ---------- 输入框下面那颗按钮 ----------
  function chip() {
    const btn = h('button', 'pk-eng-chip');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.dataset.pinkieTooltip = '引擎：这段对话由 Metre 自己做，还是交给 Claude Code、Codex、Antigravity';
    btn.innerHTML = `<span class="pk-eng-chip__name">${esc(ENGINE_NAMES[pref().engine] || 'Metre')}</span><svg class="pk-eng-chip__caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.2 3.8L5 6.5l2.8-2.7"/></svg>`;
    btn.onclick = event => { event.preventDefault(); event.stopPropagation(); menu ? closeMenu() : openEngineMenu(btn); };
    return btn;
  }
  function paintComposerChip() {
    const controls = document.querySelector('.chat-main .agent-chat__composer-controls');
    const old = controls?.querySelector(':scope > .pk-eng-chip');
    if (!controls || !isMetre() || !sessionKey()) { old?.remove(); return; }
    const name = ENGINE_NAMES[pref().engine] || 'Metre';
    if (old && old.querySelector('.pk-eng-chip__name')?.textContent === name) return;
    const next = chip();
    const baton = controls.querySelector(':scope > .pinkie-baton');
    if (old) old.replaceWith(next); else if (baton) baton.after(next); else controls.append(next);
  }

  // ---------- 引擎台 ----------
  let stage = null;
  function mountStage() {
    const host = document.querySelector('.chat-main');
    if (!host) return null;
    if (stage && stage.parentElement === host) return stage;
    stage = h('section', 'pk-eng-stage');
    stage.setAttribute('aria-label', '引擎台');
    stage.innerHTML = `
      <div class="pk-eng-scroll"><div class="pk-eng-col"><div class="pk-eng-banner"></div><div class="pk-eng-feed" role="log" aria-live="polite"></div><div class="pk-eng-live" hidden><span class="cle-glyph"></span><span class="cle-status"><b></b><span><em></em></span><i></i></span></div></div></div>
      <div class="pk-eng-dock">
        <div class="pk-eng-input">
          <textarea rows="1" placeholder="要做什么？" aria-label="对引擎说"></textarea>
          <div class="pk-eng-input__actions">
            <button type="button" class="pk-eng-mode" aria-pressed="false" data-pinkie-tooltip="引擎正在做的时候：排队＝等这一步做完再说；插话＝马上递给它，不打断">排队</button>
            <button type="button" class="pk-eng-stop" hidden aria-label="停下">${pixel(['#######', '#######', '#######', '#######', '#######', '#######', '#######'], 'pk-eng-stop__ic')}</button>
            <button type="button" class="pk-eng-send" aria-label="发送"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15.5v-11M5.5 9L10 4.5 14.5 9"/></svg></button>
          </div>
        </div>
        <div class="pk-eng-controls">
          <span class="pk-eng-controls__left"></span>
          <span class="pk-eng-controls__right"></span>
        </div>
      </div>
      <aside class="pk-eng-drawer" hidden aria-label="改动"><header class="pk-eng-drawer__head"><span class="pk-eng-drawer__title">Changes</span><span class="pk-eng-drawer__sum"></span><button type="button" class="pk-eng-drawer__close" aria-label="关上">×</button></header><div class="pk-eng-drawer__files"></div><pre class="pk-eng-diff"></pre></aside>`;
    host.append(stage);
    const area = stage.querySelector('textarea');
    area.addEventListener('input', () => { area.style.height = 'auto'; area.style.height = Math.min(220, area.scrollHeight) + 'px'; });
    area.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); }
    });
    stage.querySelector('.pk-eng-send').onclick = () => send();
    stage.querySelector('.pk-eng-stop').onclick = () => stop();
    stage.querySelector('.pk-eng-mode').onclick = event => {
      state.mode = state.mode === 'steer' ? 'queue' : 'steer';
      event.currentTarget.textContent = state.mode === 'steer' ? '插话' : '排队';
      event.currentTarget.setAttribute('aria-pressed', String(state.mode === 'steer'));
    };
    stage.querySelector('.pk-eng-drawer__close').onclick = () => { state.diff.open = false; paint(); };
    stage.querySelector('.pk-eng-scroll').addEventListener('scroll', event => {
      const el = event.currentTarget;
      state.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    });
    state.stick = true;
    state.nodes.clear();
    state.lastSig = '';
    return stage;
  }
  function unmountStage() { dropCle(); stage?.remove(); stage = null; state.nodes.clear(); root.removeAttribute('data-pk-engine'); }

  async function send() {
    const area = stage?.querySelector('textarea');
    const text = area?.value.trim();
    if (!text || state.sending) return;
    const key = state.key;
    if (!pref().model) { toast('先在引擎按钮里选一个模型'); return; }
    state.sending = true;
    area.value = '';
    area.style.height = 'auto';
    paintDock();
    try {
      state.view = await rpc('pinkie.engines.say', {sessionKey: key, text, mode: state.mode}, 180000);
      state.stick = true;
    } catch (error) {
      area.value = text;
      toast(error.message);
    } finally { state.sending = false; paint(); schedule(400); }
  }
  async function stop() {
    const threadId = pref().threadId;
    if (!threadId) return;
    try { await rpc('pinkie.engines.stop', {threadId}, 30000); toast('已经叫它停下'); } catch (error) { toast(error.message); }
    refresh();
  }
  async function respond(item, params) {
    try {
      const summary = await rpc('pinkie.engines.respond', {threadId: pref().threadId, requestId: item.requestId, ...params}, 30000);
      if (state.view) state.view.summary = summary;
      paint();
    } catch (error) { toast(error.message); }
    schedule(300);
  }
  async function organize(action) {
    try { await rpc('pinkie.engines.organize', {threadId: pref().threadId, action}, 20000); toast(action === 'pin' ? '已置顶' : action === 'archive' ? '已归档' : '好了'); }
    catch (error) { toast(error.message); }
  }
  async function signin(engine, open) {
    try {
      const info = await rpc('pinkie.engines.signin', {engine, open}, 20000);
      if (info.opened) toast('登录窗口打开了：在浏览器里登录你自己的账号，回来点「我登录好了」');
      return info;
    } catch (error) { toast(error.message); return null; }
  }
  async function loadDiff(force = false) {
    const threadId = pref().threadId;
    if (!threadId || (!force && state.diff.data && Date.now() - state.diff.at < 4000)) return;
    try { state.diff.data = await rpc('pinkie.engines.diff', {threadId}, 30000); state.diff.at = Date.now(); }
    catch (error) { state.diff.data = {diff: '', changes: [], error: error.message}; }
    paintDrawer();
  }

  // ---------- 画 ----------
  function rowFor(item, summary) {
    const node = h('div', `pk-eng-row pk-eng-row--${item.kind}`);
    node.dataset.id = item.id;
    const open = state.open.has(item.id);
    const toggle = (label, inner, extra = '') => {
      node.innerHTML = `<button type="button" class="pk-eng-line" aria-expanded="${open}">${label}</button>${open ? `<div class="pk-eng-more">${inner}</div>` : ''}${extra}`;
      node.querySelector('.pk-eng-line').onclick = () => { open ? state.open.delete(item.id) : state.open.add(item.id); replaceRow(item, summary); };
    };
    const dot = item.status === 'completed' || item.status === 'done' ? (item.failed ? 'fail' : 'ok') : /run|progress|pending|stream/.test(item.status) ? 'run' : item.failed ? 'fail' : 'ok';
    switch (item.kind) {
      case 'you': node.innerHTML = `<div class="pk-eng-you">${esc(item.text).replace(/\n/g, '<br>')}</div>`; break;
      case 'reply': node.innerHTML = `<div class="pk-eng-reply">${md(item.text)}${item.streaming ? '<span class="pk-eng-caret"></span>' : ''}</div>`; break;
      case 'thinking': {
        // 「思考了」的规矩（用户 11-05、11-21）：想的时候整段放出来；这一段放完、再停一小会儿，自己收成「思考了 N 秒」；
        // 点开再看。打开页面时已经想完的一开始就是收着的。每一段思考单独一块。
        const mark = state.think.get(item.id) || {};
        state.think.set(item.id, mark);
        const secs = secondsBetween(item.startedAt, item.completedAt);
        if (item.streaming) {
          mark.live = true;
          node.innerHTML = `<div class="pk-eng-think pk-eng-think--live"><span class="pk-eng-think__label">思考中</span><div class="pk-eng-think__text">${esc(item.text)}</div></div>`;
        } else if (mark.live && !mark.folded) {
          if (!mark.timer) mark.timer = setTimeout(() => { mark.folded = true; paint(); }, Math.min(3600, 1800 + item.text.length * 3));
          node.innerHTML = `<div class="pk-eng-think"><span class="pk-eng-think__label">思考了${secs ? ' ' + spanText(secs) : ''}</span><div class="pk-eng-think__text pk-eng-think__text--full">${esc(item.text)}</div></div>`;
        } else toggle(`<span class="pk-eng-think__label">思考了${secs ? ' ' + spanText(secs) : ''}</span>`, `<div class="pk-eng-think__text">${esc(item.text)}</div>`);
        break;
      }
      case 'command': toggle(`<i class="pk-eng-dot pk-eng-dot--${dot}"></i><span class="pk-eng-verb">跑</span><code class="pk-eng-line__code">${esc(item.command.split('\n')[0].slice(0, 120))}</code>${item.exitCode != null ? `<span class="pk-eng-line__meta">退出码 ${item.exitCode}</span>` : ''}`,
        `<pre class="pk-eng-out"><span class="pk-eng-out__cmd">$ ${esc(item.command)}</span>\n${esc(item.output || '（没有输出）')}</pre>`); break;
      case 'edit': toggle(`<i class="pk-eng-dot pk-eng-dot--${dot}"></i><span class="pk-eng-verb">改</span><span class="pk-eng-line__file">${esc(item.file)}</span>${item.additions != null ? `<span class="pk-eng-add">+${item.additions}</span>` : ''}${item.deletions != null ? `<span class="pk-eng-del">−${item.deletions}</span>` : ''}`,
        item.diff ? `<pre class="pk-eng-diff pk-eng-diff--inline">${diffHtml(item.diff)}</pre>` : '<div class="pk-eng-quiet">这次没有带差异，打开右边的「改动」看整段对话的改动。</div>'); break;
      case 'search': case 'web': node.innerHTML = `<div class="pk-eng-line pk-eng-line--flat"><i class="pk-eng-dot pk-eng-dot--${dot}"></i><span class="pk-eng-verb">${item.kind === 'web' ? '查网页' : '找'}</span><span class="pk-eng-line__text">${esc(item.text)}</span>${item.count ? `<span class="pk-eng-line__meta">${item.count} 条</span>` : ''}</div>`; break;
      case 'tool': toggle(`<i class="pk-eng-dot pk-eng-dot--${dot}"></i><span class="pk-eng-verb">用</span><span class="pk-eng-line__text">${esc(item.name)}</span>`, `<pre class="pk-eng-out">${esc(item.text)}</pre>`); break;
      case 'todo': node.innerHTML = `<div class="pk-eng-todo"><div class="pk-eng-todo__head">Plan</div>${item.explanation ? `<p class="pk-eng-quiet">${esc(item.explanation)}</p>` : ''}<ol>${item.steps.map(step => `<li class="pk-eng-todo__step pk-eng-todo__step--${esc(step.status)}">${esc(step.text)}</li>`).join('')}</ol></div>`; break;
      case 'plan': {
        node.innerHTML = `<div class="pk-eng-score"><div class="pk-eng-score__head">Score <span>方案</span></div><div class="pk-eng-reply">${md(item.text)}</div></div>`;
        if (!item.streaming && summary?.thread?.plan && summary.items.at(-1)?.id === item.id) {
          const go = h('button', 'pk-eng-btn pk-eng-btn--primary', '照这个方案做');
          go.onclick = async () => { await choose({plan: false}); stage.querySelector('textarea').value = '照这个方案开始做。'; send(); };
          node.querySelector('.pk-eng-score').append(go);
        }
        break;
      }
      case 'approval': {
        const card = h('div', 'pk-eng-card pk-eng-card--ask' + (item.open ? '' : ' pk-eng-card--closed'));
        card.innerHTML = `<div class="pk-eng-card__head">${item.open ? '等你点头' : '已处理'}<span>${esc(item.requestKind === 'file_change' || item.requestKind === 'apply_patch' ? '改文件' : item.requestKind === 'command' || item.requestKind === 'exec' ? '跑命令' : item.app || item.requestKind || '')}</span></div>
          ${item.prompt ? `<pre class="pk-eng-card__prompt">${esc(item.prompt)}</pre>` : ''}${item.reason ? `<p class="pk-eng-quiet">${esc(item.reason)}</p>` : ''}`;
        if (item.open) {
          const acts = h('div', 'pk-eng-card__acts');
          const options = item.options?.length ? item.options : [{decision: 'accept', label: '批准'}, {decision: 'acceptForSession', label: '这次对话都批准'}, {decision: 'decline', label: '不行'}];
          const note = h('input', 'pk-eng-card__note');
          note.placeholder = '不行的话，可以附一句为什么（可不填）';
          for (const option of options) {
            const word = {accept: '批准', acceptForSession: '这次对话都批准', acceptAlways: '以后都批准', decline: '不行', cancel: '取消这一步'}[option.decision] || option.label;
            const btn = h('button', 'pk-eng-btn' + (option.decision === 'accept' ? ' pk-eng-btn--primary' : ''), esc(word));
            if (option.warning) btn.title = option.warning;
            btn.onclick = () => respond(item, {decision: option.decision, ...(note.value.trim() && /decline|cancel/.test(option.decision) ? {feedback: note.value.trim()} : {})});
            acts.append(btn);
          }
          card.append(acts, note);
        }
        node.append(card);
        break;
      }
      case 'question': {
        const card = h('div', 'pk-eng-card pk-eng-card--ask' + (item.open ? '' : ' pk-eng-card--closed'));
        card.innerHTML = `<div class="pk-eng-card__head">${item.open ? '它想问你' : '已回答'}</div>`;
        const picks = {};
        for (const q of item.questions) {
          const block = h('div', 'pk-eng-q', `<div class="pk-eng-q__head">${esc(q.header)}</div><p>${esc(q.question)}</p>`);
          if (item.open) {
            const opts = h('div', 'pk-eng-q__opts');
            for (const option of q.options) {
              const btn = h('button', 'pk-eng-btn', `${esc(option.label)}${option.description ? `<small>${esc(option.description)}</small>` : ''}`);
              btn.setAttribute('aria-pressed', 'false');
              btn.onclick = () => {
                const list = picks[q.id] ||= [];
                const at = list.indexOf(option.value);
                if (q.multiSelect) { at >= 0 ? list.splice(at, 1) : list.push(option.value); }
                else { list.splice(0, list.length, option.value); for (const other of opts.children) other.setAttribute('aria-pressed', 'false'); }
                btn.setAttribute('aria-pressed', String(list.includes(option.value)));
              };
              opts.append(btn);
            }
            block.append(opts);
            if (q.allowCustom) { const own = h('input', 'pk-eng-card__note'); own.placeholder = '或者自己写'; own.dataset.q = q.id; block.append(own); }
          }
          card.append(block);
        }
        if (item.open) {
          const submit = h('button', 'pk-eng-btn pk-eng-btn--primary', '回答它');
          submit.onclick = () => {
            const answers = {};
            for (const q of item.questions) {
              const own = card.querySelector(`input[data-q="${CSS.escape(q.id)}"]`)?.value.trim();
              const chosen = picks[q.id] || [];
              answers[q.id] = own ? (q.multiSelect ? [...chosen, own] : own) : q.multiSelect ? chosen : chosen[0] ?? '';
            }
            respond(item, {answers});
          };
          card.append(submit);
        }
        node.append(card);
        break;
      }
      case 'error': {
        const name = summary?.thread?.engineName || '引擎';
        const said = item.failureClass === 'usage_limit' ? `${name} 的额度用完了` + (item.resetAt ? `，${when(item.resetAt)} 恢复。这期间可以换一个引擎，或者回到 Metre 自己做。` : '。')
          : /^还没登录/.test(item.text) ? `${name} 还没登录（或者登录过期了）。点「去登录」，用你自己的账号登录，登录好了再说一遍。` : item.text;
        const card = h('div', 'pk-eng-card pk-eng-card--warn', `<div class="pk-eng-card__head">没奏成</div><p>${esc(said)}</p>${item.detail && item.detail !== said ? `<details class="pk-eng-detail"><summary>引擎的原话</summary><p>${esc(item.detail)}</p></details>` : ''}`);
        if (/^还没登录/.test(item.text) && summary?.thread?.engine) {
          const login = h('button', 'pk-eng-btn pk-eng-btn--primary', '去登录');
          login.onclick = () => paintSignin(summary.thread.engine, true);
          card.append(login);
        }
        node.append(card);
        break;
      }
      default: node.innerHTML = `<div class="pk-eng-note">${esc(item.text || '')}</div>`;
    }
    return node;
  }
  const sigOf = item => JSON.stringify([item.kind, item.status, item.open, item.streaming, (item.text || item.output || item.diff || item.prompt || '').length, item.exitCode, state.open.has(item.id), item.steps?.map(s => s.status), state.think.get(item.id)?.folded]);
  function replaceRow(item, summary) {
    const old = state.nodes.get(item.id);
    const next = rowFor(item, summary);
    next.dataset.sig = sigOf(item);
    old?.node.replaceWith(next);
    state.nodes.set(item.id, {node: next, sig: next.dataset.sig});
  }

  function paintFeed() {
    const feed = stage.querySelector('.pk-eng-feed');
    const summary = state.view?.summary;
    const items = summary?.items || [];
    const seen = new Set();
    let prev = null;
    for (const item of items) {
      seen.add(item.id);
      const sig = sigOf(item);
      let entry = state.nodes.get(item.id);
      if (!entry || entry.sig !== sig) {
        const node = rowFor(item, summary);
        node.dataset.sig = sig;
        if (entry) entry.node.replaceWith(node);
        entry = {node, sig};
        state.nodes.set(item.id, entry);
      }
      const want = prev ? prev.nextSibling : feed.firstChild;
      if (entry.node !== want) feed.insertBefore(entry.node, want);
      prev = entry.node;
    }
    for (const [id, entry] of state.nodes) if (!seen.has(id)) { entry.node.remove(); state.nodes.delete(id); }
    if (state.stick) { const scroll = stage.querySelector('.pk-eng-scroll'); scroll.scrollTop = scroll.scrollHeight; }
  }

  function paintSignin(engine, open) {
    const banner = stage?.querySelector('.pk-eng-banner');
    if (!banner) return;
    const row = engineRow(engine);
    const name = ENGINE_NAMES[engine] || engine;
    const box = h('div', 'pk-eng-card pk-eng-card--setup');
    const how = row?.signin || {};
    box.innerHTML = how.how === 'terminal'
      ? `<div class="pk-eng-card__head">登录 ${esc(name)}</div><p>用你自己的账号登录，碧琪不经手账号和密码。点下面的按钮会打开一个命令行窗口，里面运行 <code>${esc(how.command)}</code>，按提示在浏览器里登录；登录完回到这里点「我登录好了」。</p>`
      : `<div class="pk-eng-card__head">登录 ${esc(name)}</div><p>${esc(name)} 的运行包和 Google 登录在引擎设置里完成（第一次要装运行包）。碧琪不经手账号和密码。</p>`;
    const acts = h('div', 'pk-eng-card__acts');
    if (how.how === 'terminal') {
      const go = h('button', 'pk-eng-btn pk-eng-btn--primary', '打开登录窗口');
      go.onclick = () => signin(engine, true);
      acts.append(go);
    }
    const again = h('button', 'pk-eng-btn', '我登录好了，重新检查');
    again.onclick = async () => { again.disabled = true; await loadCatalog(true); again.disabled = false; paint(); toast(engineRow(engine)?.signedIn ? `${name} 已经登录` : `${name} 还是没登录上`); };
    acts.append(again);
    box.append(acts);
    banner.replaceChildren(box);
    if (open) stage.querySelector('.pk-eng-scroll').scrollTop = 0;
  }

  function paintBanner() {
    const banner = stage.querySelector('.pk-eng-banner');
    const p = pref();
    const row = engineRow(p.engine);
    const catalog = state.catalog;
    const summary = state.view?.summary;
    banner.replaceChildren();
    if (state.enabling) { banner.append(h('div', 'pk-eng-card pk-eng-card--setup', '<div class="pk-eng-card__head">正在准备外部引擎</div><p>第一次要下载约 170MB 并校验，网慢的话要几分钟。好了会自动接上。</p>')); return; }
    if (catalog && !catalog.enabled && !catalog.running) {
      const box = h('div', 'pk-eng-card pk-eng-card--setup', `<div class="pk-eng-card__head">外部引擎没打开</div><p>打开以后碧琪才会下载（约 170MB）并在这台电脑上启动引擎服务；关着的时候什么都不下载、不运行。</p>`);
      const on = h('button', 'pk-eng-btn pk-eng-btn--primary', '打开外部引擎');
      on.onclick = () => enableEngines();
      box.append(on);
      banner.append(box);
      return;
    }
    if (row && !row.signedIn && catalog?.source === 'live' && !summary?.items?.length) { paintSignin(p.engine); return; }
    if (row?.quota?.state === 'out') banner.append(h('div', 'pk-eng-card pk-eng-card--warn', `<div class="pk-eng-card__head">${esc(ENGINE_NAMES[p.engine])} 额度用完了</div><p>${row.quota.resetAt ? esc(when(row.quota.resetAt)) + ' 恢复。' : ''}这期间可以换一个引擎，或者回到 Metre 自己来做。</p>`));
    if (!p.model) banner.append(h('div', 'pk-eng-card pk-eng-card--setup', '<div class="pk-eng-card__head">还没选模型</div><p>点下面的引擎按钮，选一个模型。</p>'));
    if (!summary?.items?.length && !banner.childElementCount) {
      banner.append(h('div', 'pk-eng-empty', `${pixel(REST, 'pk-eng-empty__glyph')}<div><div class="pk-eng-empty__title">${esc(ENGINE_NAMES[p.engine] || p.engine)}<span>${esc(p.model || '')}</span></div><p>说要做什么，它会在${state.view?.pref?.folder ? ' <code>' + esc(state.view.pref.folder) + '</code> 里' : '这个会话绑定的项目文件夹里（没绑就在一个草稿文件夹里）'}动手。放手程度：${esc(LEVEL_SHORT[p.level || 'full-access'])}。</p></div>`));
    }
  }

  function paintDock() {
    if (!stage) return;
    const summary = state.view?.summary;
    const status = summary?.status || 'idle';
    const busy = status === 'running' || status === 'waiting';
    stage.querySelector('.pk-eng-stop').hidden = !busy;
    stage.querySelector('.pk-eng-mode').hidden = !busy;
    stage.querySelector('.pk-eng-send').disabled = state.sending;
    stage.querySelector('textarea').placeholder = busy ? (state.mode === 'steer' ? '递一句话给它（不打断）' : '接着说（等这一步做完再交给它）') : '要做什么？';
    const left = stage.querySelector('.pk-eng-controls__left');
    const right = stage.querySelector('.pk-eng-controls__right');
    const p = pref();
    const engineBtn = h('button', 'pk-eng-chip', `<span class="pk-eng-chip__name">${esc(ENGINE_NAMES[p.engine] || p.engine)}</span><span class="pk-eng-chip__model">${esc(p.model || '选模型')}</span><svg class="pk-eng-chip__caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.2 3.8L5 6.5l2.8-2.7"/></svg>`);
    engineBtn.onclick = () => (menu ? closeMenu() : openEngineMenu(engineBtn));
    const levelBtn = h('button', 'pk-eng-chip pk-eng-chip--level', `<span class="pk-eng-chip__name">${esc(LEVEL_SHORT[p.level || 'full-access'])}</span>`);
    levelBtn.dataset.pinkieTooltip = '放手程度：引擎动手之前要不要先问你';
    levelBtn.onclick = () => (menu ? closeMenu() : openLevelMenu(levelBtn));
    const planBtn = h('button', 'pk-eng-chip pk-eng-chip--plan', '<span class="pk-eng-chip__name">先出方案</span>');
    planBtn.setAttribute('aria-pressed', String(p.plan === true));
    planBtn.dataset.pinkieTooltip = '打开后它先写方案给你看，你点「照这个方案做」才动手';
    planBtn.onclick = () => choose({plan: p.plan !== true});
    left.replaceChildren(engineBtn, levelBtn, planBtn);
    const parts = [];
    if (summary) {
      const word = STATUS_WORD[status] ?? status;
      if (word) parts.push(h('span', `pk-eng-state pk-eng-state--${status}`, `<i></i>${esc(word)}`));
      const add = summary.changes.reduce((n, c) => n + c.additions, 0), del = summary.changes.reduce((n, c) => n + c.deletions, 0);
      const changes = h('button', 'pk-eng-chip pk-eng-chip--changes', summary.changes.length ? `<span class="pk-eng-chip__name">${summary.changes.length} 个文件</span><span class="pk-eng-add">+${add}</span><span class="pk-eng-del">−${del}</span>` : '<span class="pk-eng-chip__name">改动</span>');
      changes.setAttribute('aria-pressed', String(state.diff.open));
      changes.onclick = () => { state.diff.open = !state.diff.open; paint(); if (state.diff.open) loadDiff(true); };
      const more = h('button', 'pk-eng-chip pk-eng-chip--more', '<span class="pk-eng-chip__name">···</span>');
      more.setAttribute('aria-label', '更多');
      more.onclick = () => {
        closeMenu();
        const node = h('div', 'pk-eng-menu');
        const body = h('div', 'pk-eng-menu__body');
        for (const [label, action] of [['置顶这段对话', 'pin'], ['归档这段对话', 'archive']]) {
          const item = h('button', 'pk-eng-menu__item', `<span class="pk-eng-menu__name">${label}</span>`);
          item.onclick = () => { closeMenu(); organize(action); };
          body.append(item);
        }
        const fresh = h('button', 'pk-eng-menu__item', '<span class="pk-eng-menu__name">换一段新的对话</span><span class="pk-eng-menu__note">同一个引擎，从头开始（旧的留在引擎里）</span>');
        fresh.onclick = () => { closeMenu(); detachThread(); };
        body.append(fresh);
        node.append(body);
        place(more, node);
      };
      parts.push(changes, more);
    }
    right.replaceChildren(...parts);
  }
  async function detachThread() {
    try { state.view = await rpc('pinkie.engines.choose', {sessionKey: state.key, newThread: true}, 20000); } catch (error) { toast(error.message); }
    state.nodes.clear(); stage?.querySelector('.pk-eng-feed')?.replaceChildren(); paint();
  }

  function paintDrawer() {
    if (!stage) return;
    const drawer = stage.querySelector('.pk-eng-drawer');
    drawer.hidden = !state.diff.open;
    stage.classList.toggle('pk-eng-stage--drawer', state.diff.open);
    if (!state.diff.open) return;
    const data = state.diff.data;
    const changes = data?.changes || state.view?.summary?.changes || [];
    drawer.querySelector('.pk-eng-drawer__sum').textContent = changes.length ? `${changes.length} 个文件` : '';
    drawer.querySelector('.pk-eng-drawer__files').innerHTML = changes.map(c => `<div class="pk-eng-drawer__file"><span>${esc(c.file)}</span><span class="pk-eng-add">+${c.additions}</span><span class="pk-eng-del">−${c.deletions}</span></div>`).join('')
      || '<div class="pk-eng-quiet">这段对话还没有改过文件。</div>';
    drawer.querySelector('.pk-eng-diff').innerHTML = data?.error ? esc('读不到改动：' + data.error) : data?.diff ? diffHtml(data.diff) : data ? '' : '正在读改动…';
  }

  // 对话最下面那一行：[C.le. 动画] 正在执行 `npm test`  12 秒——和 Metre 原生工作过程的标题行一个样子。
  function paintLive() {
    const line = stage?.querySelector('.pk-eng-live');
    if (!line) return;
    const summary = state.view?.summary;
    const status = summary?.status;
    if (!summary || !summary.items.length) { line.hidden = true; dropCle(); return; }
    line.hidden = false;
    const busy = status === 'running' || status === 'waiting';
    let kind, text = '', mono = false;
    if (busy) {
      clearTimeout(cle.finishing); cle.finishing = 0;
      ({kind, text = '', mono = false} = stepOf(summary));
      const glyph = liveGlyph();
      if (glyph && cle.kind !== kind) { cle.space.set(kind); cle.kind = kind; }
      const slot = line.querySelector('.cle-glyph');
      if (glyph && slot !== glyph) slot.replaceWith(glyph);
      else if (!glyph && !slot.classList.contains('cle-glyph--static')) slot.replaceWith(staticGlyph());
    } else {
      kind = status === 'failed' ? 'fail' : status === 'stopped' ? 'stopped' : 'done';
      // 刚做完：在小标里落款，落完换回静态签名、拆掉 WebGL。
      if (cle.space && !cle.finishing) {
        cle.space.set('done');
        cle.finishing = setTimeout(() => { const slot = stage?.querySelector('.pk-eng-live .cle-glyph'); dropCle(); slot?.replaceWith(staticGlyph()); }, CLE_HOLD);
      } else if (!cle.space && !line.querySelector('.cle-glyph--static')) line.querySelector('.cle-glyph').replaceWith(staticGlyph());
    }
    const secs = secondsBetween(summary.runStartedAt, busy ? null : summary.runCompletedAt);
    line.dataset.kind = kind;
    line.querySelector('.cle-status b').textContent = CLE_VERB[kind] || CLE_VERB.think;
    const em = line.querySelector('.cle-status em');
    em.textContent = text;
    em.parentElement.hidden = !text;
    em.parentElement.toggleAttribute('data-mono', mono && Boolean(text));
    line.querySelector('.cle-status i').textContent = spanText(secs);
  }

  function paint() {
    paintComposerChip();
    const show = isMetre() && sessionKey() && external();
    if (!show) { if (stage) unmountStage(); return; }
    if (!mountStage()) return;
    root.setAttribute('data-pk-engine', 'on');
    paintBanner();
    paintFeed();
    paintLive();
    paintDock();
    paintDrawer();
  }

  // ---------- 刷新 ----------
  function schedule(ms) { clearTimeout(state.timer); state.timer = setTimeout(refresh, ms); }
  async function refresh() {
    clearTimeout(state.timer);
    const key = sessionKey();
    if (!isMetre() || !key) { state.key = ''; state.view = null; paint(); schedule(3000); return; }
    if (document.hidden) { schedule(4000); return; }
    if (key !== state.key) { state.key = key; state.view = null; state.open.clear(); state.diff = {open: false, data: null, at: 0}; unmountStage(); }
    if (state.loading) { schedule(500); return; }
    state.loading = true;
    try {
      const view = await rpc('pinkie.engines.session', {sessionKey: key}, 15000);
      if (state.key === key) state.view = view;
      if (external()) await loadCatalog(false);
    } catch (error) {
      if (state.view) state.view.error = error.message;
    } finally { state.loading = false; }
    if (state.key === key) {
      paint();
      if (state.diff.open) loadDiff(false);
    }
    const status = state.view?.summary?.status;
    schedule(external() ? (status === 'running' ? 1000 : status === 'waiting' ? 2000 : 4000) : 5000);
  }

  window.addEventListener('pinkie:composer-chips', () => paintComposerChip());
  window.addEventListener('popstate', () => schedule(50));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(50); });
  schedule(800);
})();
