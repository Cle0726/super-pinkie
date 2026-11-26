/* 白板（想法模式）：便签、手写、方框、连线，能拖、能缩放；跟着会话存（pinkie.whiteboard.*），能导出 PNG。
   PR ① 是用户手动用的白板；碧琪动手的工具在 PR ②——她改过的元素服务器记成 by=pinkie，这里已经会标出来。
   手写照学习台手绘图标的画法：圆头、圆角拐弯、平滑的单线。
   同时改：每个元素带服务器给的版本号，改动按元素合并；同一元素被别人先改了就换成最新的，不盖掉。
   只在想法模式（agent:thinking:*）出现；全局只挂 window.Pinkie.whiteboard。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.whiteboard) return;
  const SVG = 'http://www.w3.org/2000/svg';
  const POLL_MS = 2000, MIN_Z = 0.25, MAX_Z = 4, MAX_POINTS = 2000;
  const NIGHT = '[data-pinkie-night],[data-theme-mode="dark"]';
  const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  const PALETTE = {
    day: {bg: '#FBFAF7', dot: '#D6D2C8', ink: '#2B2A33', text: '#2B2A33', muted: '#6B675F', box: '#6E6A62', link: '#5E5A66', edge: '#8F897E',
      pick: '#2F5FD0', pinkie: '#B0476E', onPinkie: '#FFFFFF',
      note: {sun: '#FFF1B8', mint: '#D9F2E3', sky: '#DCEBFA', rose: '#FBE0E6', paper: '#FFFFFF'}},
    night: {bg: '#1B1B1E', dot: '#3A3A3F', ink: '#ECEAE4', text: '#F1EFE9', muted: '#A8A49B', box: '#A9A59C', link: '#B9B5C0', edge: '#7A766E',
      pick: '#8FB0FF', pinkie: '#F09AB8', onPinkie: '#1B1B1E',
      note: {sun: '#4A4123', mint: '#203D2E', sky: '#1F3247', rose: '#4A2630', paper: '#2C2C30'}},
  };
  const COLORS = [['sun', '黄'], ['mint', '绿'], ['sky', '蓝'], ['rose', '粉'], ['paper', '白']];
  const TOOLS = [
    {id: 'select', label: '选择', key: 'v', tip: '点选、拖动；拖空白处移动画布'},
    {id: 'note', label: '便签', key: 'n', tip: '点一下放一张便签'},
    {id: 'ink', label: '手写', key: 'p', tip: '按住拖动写字、画线'},
    {id: 'box', label: '方框', key: 'b', tip: '拖出一个方框，用来分组'},
    {id: 'link', label: '连线', key: 'l', tip: '先点一个元素，再点另一个'},
  ];

  // 灵感圆桌页面用 data-host="roundtable" 加载：走圆桌自己的服务（同样的合并规则），不走网关；圆桌只有夜色。
  const HOST = document.currentScript?.dataset?.host === 'roundtable' ? 'roundtable' : 'gateway';
  const RT = {token: ''};
  // 圆桌只有夜色：给根加夜间标记，CSS 和 isNight() 都按夜色走（圆桌自己的样式不看这个属性）。
  if (HOST === 'roundtable') document.documentElement.setAttribute('data-pinkie-night', '');
  async function roundtable(method, params, timeout, retry = true) {
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeout) : undefined;
    if (!RT.token) RT.token = (await (await fetch('/api/bootstrap', {cache: 'no-store', signal})).json()).token || '';
    const base = '/api/sessions/' + encodeURIComponent(params.key) + '/whiteboard';
    const res = method === 'pinkie.whiteboard.get'
      ? await fetch(base + '?since=' + (params.since || 0), {cache: 'no-store', signal})
      : await fetch(base, {method: 'POST', signal, body: JSON.stringify({ops: params.ops}),
        headers: {'Content-Type': 'application/json', 'X-Roundtable-Token': RT.token}});
    if (res.status === 403 && retry) { RT.token = ''; return roundtable(method, params, timeout, false); }
    const value = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(value.error || '圆桌没有回应');
    return value;
  }
  const request = (method, params, timeout = 15000) => {
    if (HOST === 'roundtable') return roundtable(method, params, timeout);
    const rpc = window.__laolaoSidebar?.gwRequest;
    return typeof rpc === 'function' ? rpc(method, params, timeout) : Promise.reject(new Error('网关未连接'));
  };
  const rpc = async (method, params) => {
    const value = await request(method, params);
    if (value?.ok === false) throw new Error(value.error || '没有成功');
    return value;
  };
  const roundtableKey = () => {
    if (!document.querySelector('#app[data-has-session="true"]')) return '';
    try { return localStorage.getItem('roundtable:last') || ''; } catch { return ''; }
  };
  const currentKey = () => {
    if (HOST === 'roundtable') return roundtableKey();
    try { return new URL(location.href).searchParams.get('session') || ''; } catch { return ''; }
  };
  const allowed = key => (HOST === 'roundtable' ? /^[a-f0-9]{32}$/ : /^agent:thinking:/).test(String(key || ''));
  const uid = kind => kind.slice(0, 1) + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const r1 = v => Math.round(v * 10) / 10;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const s = (tag, attrs = {}, text) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const isNight = () => Boolean(document.querySelector(NIGHT));
  const pal = () => PALETTE[isNight() ? 'night' : 'day'];

  const st = {
    key: '', items: new Map(), rev: 0, loaded: false, tool: 'select', color: 'sun', view: {x: 40, y: 40, z: 1},
    selected: '', linkFrom: '', gesture: null, timer: 0, theme: '', chain: Promise.resolve(),
    pending: new Map(), gen: new Map(), lastRev: new Map(), gone: new Set(),
    root: null, scrim: null, svg: null, layer: null, dots: null, editor: null, empty: null, status: null, bar: {},
  };

  // ---------- geometry ----------
  const bbox = it => {
    if (it.kind === 'ink') {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [x, y] of it.points) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
      return {x: a, y: b, w: c - a, h: d - b};
    }
    return it.kind === 'link' ? null : {x: it.x, y: it.y, w: it.w, h: it.h};
  };
  const centre = b => [b.x + b.w / 2, b.y + b.h / 2];
  const edge = (b, tx, ty) => {
    const [cx, cy] = centre(b), dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const k = Math.min((b.w / 2 + 6) / (Math.abs(dx) || 1e-9), (b.h / 2 + 6) / (Math.abs(dy) || 1e-9), 1);
    return [cx + dx * k, cy + dy * k];
  };
  const bounds = () => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const it of st.items.values()) {
      const box = bbox(it); if (!box) continue;
      a = Math.min(a, box.x); b = Math.min(b, box.y); c = Math.max(c, box.x + box.w); d = Math.max(d, box.y + box.h);
    }
    return a === Infinity ? null : {x: a, y: b, w: c - a, h: d - b};
  };
  const inkPath = pts => {
    if (pts.length < 3) return 'M' + pts.map(p => p.join(' ')).join('L');
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i], [nx, ny] = pts[i + 1];
      d += `Q${x} ${y} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
    }
    const last = pts[pts.length - 1];
    return d + `L${last[0]} ${last[1]}`;
  };
  let measurer;
  const wrap = (text, width, maxLines) => {
    measurer ??= document.createElement('canvas').getContext('2d');
    if (measurer) measurer.font = '14px ' + FONT;
    const w = str => (measurer ? measurer.measureText(str).width : str.length * 14);
    const lines = [];
    for (const para of String(text || '').split('\n')) {
      let line = '';
      for (const ch of para) { if (line && w(line + ch) > width) { lines.push(line); line = ch; } else line += ch; }
      lines.push(line);
    }
    if (lines.length <= maxLines) return lines;
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].slice(0, -1) + '…';
    return cut;
  };

  // ---------- drawing ----------
  function itemNode(it, p) {
    const mine = it.by === 'pinkie', picked = st.selected === it.id;
    const g = s('g', {class: 'pk-whiteboard__item' + (mine ? ' is-pinkie' : ''), 'data-id': it.id, 'data-kind': it.kind, 'data-by': it.by || 'user'});
    if (mine) g.append(s('title', {}, '碧琪做的'));
    if (it.kind === 'note') {
      g.append(s('rect', {x: it.x, y: it.y, width: it.w, height: it.h, rx: 6, fill: p.note[it.color] || p.note.sun, stroke: p.edge, 'stroke-width': 1}));
      const t = s('text', {x: it.x + 10, y: it.y + 24, fill: p.text, 'font-size': 14, 'font-family': FONT});
      wrap(it.text, it.w - 20, Math.max(1, Math.floor((it.h - 16) / 20))).forEach((line, i) => t.append(s('tspan', {x: it.x + 10, dy: i ? 20 : 0}, line || ' ')));
      g.append(t);
    } else if (it.kind === 'box') {
      const r = {x: it.x, y: it.y, width: it.w, height: it.h, rx: 12, fill: 'none'};
      g.append(s('rect', {...r, stroke: 'transparent', 'stroke-width': 14, 'pointer-events': 'stroke'}), s('rect', {...r, stroke: mine ? p.pinkie : p.box, 'stroke-width': 1.6, 'pointer-events': 'none'}));
      // 分组名压在上边框上（像表单的组标题），便签放进框里也挡不住；底色描边把框线断开。
      g.append(s('text', {x: it.x + 14, y: it.y + 5, fill: it.label ? p.text : p.muted, stroke: p.bg, 'stroke-width': 6, 'paint-order': 'stroke', 'font-size': 13, 'font-weight': 600, 'font-family': FONT}, it.label || '未命名分组'));
    } else if (it.kind === 'ink') {
      const d = inkPath(it.points);
      g.append(s('path', {d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'stroke-linecap': 'round', 'pointer-events': 'stroke'}),
        s('path', {d, fill: 'none', stroke: picked ? p.pick : mine ? p.pinkie : p.ink, 'stroke-width': it.width || 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none'}));
    } else if (it.kind === 'link') {
      const a = st.items.get(it.from), b = st.items.get(it.to);
      if (!a || !b || a.kind === 'link' || b.kind === 'link') return null;
      const A = bbox(a), B = bbox(b), [x1, y1] = edge(A, ...centre(B)), [x2, y2] = edge(B, ...centre(A));
      const color = picked ? p.pick : mine ? p.pinkie : p.link, ang = Math.atan2(y2 - y1, x2 - x1), L = 10;
      const tip = (da) => `${r1(x2 - L * Math.cos(ang + da))} ${r1(y2 - L * Math.sin(ang + da))}`;
      g.append(s('line', {x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), stroke: 'transparent', 'stroke-width': 14, 'pointer-events': 'stroke'}),
        s('line', {x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'pointer-events': 'none'}),
        s('path', {d: `M${r1(x2)} ${r1(y2)}L${tip(-0.45)}L${tip(0.45)}Z`, fill: color, 'pointer-events': 'none'}));
      if (it.label) g.append(s('text', {x: r1((x1 + x2) / 2), y: r1((y1 + y2) / 2 - 6), 'text-anchor': 'middle', fill: p.text, stroke: p.bg, 'stroke-width': 4, 'paint-order': 'stroke', 'font-size': 12, 'font-family': FONT}, it.label));
    }
    if (mine && (it.kind === 'note' || it.kind === 'box')) {
      const tx = it.x + it.w - 40, ty = it.y - 9;
      g.append(s('rect', {x: tx, y: ty, width: 34, height: 18, rx: 9, fill: p.pinkie}), s('text', {x: tx + 17, y: ty + 13, 'text-anchor': 'middle', fill: p.onPinkie, 'font-size': 11, 'font-weight': 600, 'font-family': FONT}, '碧琪'));
    }
    return g;
  }
  function overlay(p) {
    const g = s('g', {'data-overlay': '1', 'pointer-events': 'none'});
    for (const [id, dash] of [[st.selected, '5 4'], [st.linkFrom, '2 3']]) {
      const it = id && st.items.get(id), b = it && bbox(it);
      if (!b) continue;
      g.append(s('rect', {x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: 8, fill: 'none', stroke: p.pick, 'stroke-width': 1.5 / st.view.z, 'stroke-dasharray': dash}));
      if (id === st.selected && (it.kind === 'note' || it.kind === 'box')) {
        const k = 12 / st.view.z;
        g.append(s('rect', {class: 'pk-whiteboard__handle', 'data-handle': it.id, x: b.x + b.w - k / 2, y: b.y + b.h - k / 2, width: k, height: k, rx: 2, fill: p.pick, 'pointer-events': 'all'}));
      }
    }
    return g;
  }
  function render() {
    if (!st.layer) return;
    const p = pal(), {x, y, z} = st.view;
    st.theme = isNight() ? 'night' : 'day';
    st.bg.setAttribute('fill', p.bg);
    st.dots.setAttribute('fill', p.dot);
    const pat = st.dots.parentNode;
    for (const [k, v] of Object.entries({x: r1(x), y: r1(y), width: r1(24 * z), height: r1(24 * z)})) pat.setAttribute(k, v);
    st.dots.setAttribute('r', Math.max(.6, 1.1 * z));
    st.layer.setAttribute('transform', `translate(${r1(x)} ${r1(y)}) scale(${z})`);
    const order = {box: 0, ink: 1, link: 2, note: 3};
    const nodes = [...st.items.values()].sort((a, b) => order[a.kind] - order[b.kind]).map(it => itemNode(it, p)).filter(Boolean);
    st.layer.replaceChildren(...nodes, overlay(p), st.draft);
    st.bar.zoom.textContent = Math.round(z * 100) + '%';
    st.empty.hidden = !st.loaded || st.items.size > 0;
    updateBar();
  }
  function drawDraft() {
    const g = st.gesture, p = pal();
    if (!g || (g.type !== 'ink' && g.type !== 'box')) return st.draft.replaceChildren();
    if (g.type === 'ink') st.draft.replaceChildren(s('path', {d: inkPath(g.points), fill: 'none', stroke: p.ink, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
    else st.draft.replaceChildren(s('rect', {x: Math.min(g.x0, g.x1), y: Math.min(g.y0, g.y1), width: Math.abs(g.x1 - g.x0), height: Math.abs(g.y1 - g.y0), rx: 12, fill: 'none', stroke: p.box, 'stroke-width': 1.6, 'stroke-dasharray': '6 4'}));
  }
  function updateBar() {
    const it = st.items.get(st.selected);
    for (const b of st.bar.tools) b.setAttribute('aria-pressed', String(b.dataset.tool === st.tool));
    for (const b of st.bar.swatches) {
      b.disabled = it ? it.kind !== 'note' : false;
      b.setAttribute('aria-pressed', String((it?.kind === 'note' ? it.color : st.color) === b.dataset.color));
    }
    st.bar.remove.disabled = !it;
    st.root.dataset.tool = st.tool;
  }
  let sayTimer = 0;
  const say = text => {
    if (!st.status) return;
    st.status.textContent = text;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { if (st.status.textContent === text) st.status.textContent = hint(); }, 6000);
  };
  const hint = () => (TOOLS.find(t => t.id === st.tool)?.tip || '') + ' · Ctrl + 滚轮缩放';

  // ---------- sync ----------
  function take(it, keepLocal = false) {
    st.lastRev.set(it.id, it.rev);
    if (it.deleted) { st.items.delete(it.id); if (st.selected === it.id) st.selected = ''; return; }
    if (st.gone.has(it.id)) return;
    const local = st.items.get(it.id);
    if (keepLocal && local) Object.assign(local, {rev: it.rev, by: it.by, updatedAt: it.updatedAt});
    else st.items.set(it.id, it);
  }
  const busy = id => st.pending.has(id) || st.gesture?.id === id || (!st.editor.hidden && st.editor.dataset.id === id);
  function queue(build, id) {
    const key = st.key, gen = st.gen.get(id) || 0;
    st.pending.set(id, (st.pending.get(id) || 0) + 1);
    st.chain = st.chain.then(async () => {
      try {
        if (key !== st.key || (st.gen.get(id) || 0) !== gen) return;
        const ops = build();
        if (!ops.length) return;
        const r = await rpc('pinkie.whiteboard.apply', {key, ops});
        if (key !== st.key) return;
        for (const it of r.applied || []) take(it, (st.pending.get(it.id) || 0) > 1);
        if (r.conflicts?.length) {
          for (const it of r.conflicts) { st.gen.set(it.id, (st.gen.get(it.id) || 0) + 1); st.gone.delete(it.id); take(it); }
          say('这处刚被改过，已换成最新的，没有盖掉别人的改动');
        }
      } catch (error) {
        if (key === st.key) { say('没存上：' + error.message); await pull(true); }
      } finally {
        const n = (st.pending.get(id) || 1) - 1;
        if (n) st.pending.set(id, n); else st.pending.delete(id);
        render();
      }
    });
    return st.chain;
  }
  const save = id => queue(() => {
    const it = st.items.get(id);
    if (!it || st.gone.has(id)) return [];
    const {rev, by, updatedAt, deleted, ...item} = it;
    return [{op: 'put', baseRev: st.lastRev.get(id) || 0, item}];
  }, id);
  function add(item) { st.items.set(item.id, item); st.selected = item.id; save(item.id); render(); return item; }
  function removeItem(id) {
    if (!st.items.has(id)) return;
    st.items.delete(id); st.gone.add(id);
    for (const l of [...st.items.values()]) if (l.kind === 'link' && (l.from === id || l.to === id)) st.items.delete(l.id);
    if (st.selected === id) st.selected = '';
    queue(() => { const rev = st.lastRev.get(id) || 0; return rev ? [{op: 'del', id, baseRev: rev}] : []; }, id);
    render();
  }
  async function pull(full = false) {
    if (!st.key) return;
    const key = st.key;
    try {
      const r = await rpc('pinkie.whiteboard.get', {key, since: full ? 0 : st.rev});
      if (key !== st.key) return;
      if (full) { st.items.clear(); st.gone.clear(); st.lastRev.clear(); }
      let byPinkie = 0;
      for (const it of r.items || []) {
        if (!full && busy(it.id)) continue;
        if (!full && st.loaded && it.by === 'pinkie') byPinkie++;
        take(it);
      }
      st.rev = full ? r.rev || 0 : Math.max(st.rev, r.rev || 0);
      const first = !st.loaded;
      st.loaded = true;
      if (byPinkie) say(`碧琪刚动了白板上的 ${byPinkie} 处`);
      else if (first) say(hint());
      render();
    } catch (error) { say('白板没连上：' + error.message); }
  }

  // ---------- view ----------
  const viewKey = key => 'pinkie-whiteboard-view:' + key;
  const loadView = key => {
    try {
      const v = JSON.parse(localStorage.getItem(viewKey(key)) || 'null');
      if (v && [v.x, v.y, v.z].every(Number.isFinite)) return {x: v.x, y: v.y, z: Math.min(MAX_Z, Math.max(MIN_Z, v.z))};
    } catch {}
    return {x: 40, y: 40, z: 1};
  };
  const saveView = () => { try { localStorage.setItem(viewKey(st.key), JSON.stringify(st.view)); } catch {} };
  function zoomAt(factor, cx, cy) {
    commitEdit();
    const {x, y, z} = st.view, nz = Math.min(MAX_Z, Math.max(MIN_Z, z * factor)), k = nz / z;
    st.view = {x: cx - (cx - x) * k, y: cy - (cy - y) * k, z: nz};
    saveView(); render();
  }
  const zoomCentre = factor => { const r = st.svg.getBoundingClientRect(); zoomAt(factor, r.width / 2, r.height / 2); };
  function fit() {
    commitEdit();
    const b = bounds(), r = st.svg.getBoundingClientRect();
    if (!b) st.view = {x: 40, y: 40, z: 1};
    else {
      const z = Math.min(MAX_Z, Math.max(MIN_Z, Math.min((r.width - 64) / Math.max(b.w, 1), (r.height - 64) / Math.max(b.h, 1), 1.5)));
      st.view = {x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z, z};
    }
    saveView(); render();
  }
  const toWorld = ev => { const r = st.svg.getBoundingClientRect(), {x, y, z} = st.view; return [(ev.clientX - r.left - x) / z, (ev.clientY - r.top - y) / z]; };
  const hitItem = ev => { const n = ev.target.closest?.('[data-id]'); return n ? st.items.get(n.getAttribute('data-id')) : null; };

  // ---------- editing ----------
  function openEditor(it) {
    const ta = st.editor, b = bbox(it), {x, y, z} = st.view;
    ta.value = it.kind === 'note' ? it.text || '' : it.label || '';
    ta.dataset.id = it.id;
    ta.placeholder = it.kind === 'note' ? '写点什么' : '分组名字';
    ta.setAttribute('aria-label', it.kind === 'note' ? '便签内容' : '分组名字');
    Object.assign(ta.style, {left: r1(b.x * z + x) + 'px', top: r1(b.y * z + y) + 'px', width: r1(Math.max(120, b.w * z)) + 'px',
      height: r1(it.kind === 'note' ? Math.max(60, b.h * z) : 36) + 'px', fontSize: r1(Math.max(12, 14 * z)) + 'px'});
    ta.hidden = false;
    ta.focus({preventScroll: true});
    ta.select();
  }
  function commitEdit(cancel = false) {
    const ta = st.editor;
    if (!ta || ta.hidden) return;
    ta.hidden = true;
    const it = st.items.get(ta.dataset.id);
    if (it && !cancel) {
      const field = it.kind === 'note' ? 'text' : 'label', value = ta.value.slice(0, field === 'text' ? 2000 : 200);
      if (value !== (it[field] || '')) { it[field] = value; save(it.id); }
    }
    render();
    st.root.focus({preventScroll: true});
  }

  // ---------- pointer ----------
  function down(ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1) return;
    // 按下时会重画，按住的那个节点被换掉：浏览器默认的聚焦落到 body（按键跑去聊天输入框），
    // 按下 / 松开的目标也不一样，原生 dblclick 根本不来。所以焦点自己给白板，双击自己认。
    ev.preventDefault();
    commitEdit();
    st.root.focus({preventScroll: true});
    const [wx, wy] = toWorld(ev), item = hitItem(ev), handle = ev.target.closest?.('[data-handle]');
    const now = performance.now(), last = st.press, id = item?.id || '';
    st.press = {t: now, x: ev.clientX, y: ev.clientY, id};
    if (st.tool === 'select' && ev.button === 0 && !handle && last && last.id === id && now - last.t < 450 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 8) {
      st.press = null; st.gesture = null;
      if (item && (item.kind === 'note' || item.kind === 'box')) return openEditor(item);
      if (!item) return openEditor(add({id: uid('note'), kind: 'note', x: r1(wx - 80), y: r1(wy - 60), w: 160, h: 120, text: '', color: st.color}));
      return;
    }
    st.svg.setPointerCapture?.(ev.pointerId);
    if (ev.button === 1 || (st.tool === 'select' && !item && !handle)) {
      if (st.tool === 'select') st.selected = '';
      st.gesture = {type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: st.view.x, vy: st.view.y};
    } else if (st.tool === 'ink') st.gesture = {type: 'ink', points: [[r1(wx), r1(wy)]]};
    else if (st.tool === 'box') st.gesture = {type: 'box', x0: wx, y0: wy, x1: wx, y1: wy};
    else if (st.tool === 'note') {
      const it = add({id: uid('note'), kind: 'note', x: r1(wx - 80), y: r1(wy - 60), w: 160, h: 120, text: '', color: st.color});
      // 按下的默认动作已经拦掉（见上），编辑框开了不会被抢走焦点。
      setTool('select'); openEditor(it);
    } else if (st.tool === 'link') {
      if (!item || item.kind === 'link') { st.linkFrom = ''; say('连线取消了'); }
      else if (!st.linkFrom) { st.linkFrom = item.id; say('再点要连到的那个'); }
      else if (st.linkFrom !== item.id) { add({id: uid('link'), kind: 'link', from: st.linkFrom, to: item.id, label: ''}); st.linkFrom = ''; say('连上了'); }
    } else if (handle) {
      const it = st.items.get(handle.getAttribute('data-handle'));
      if (it) st.gesture = {type: 'resize', id: it.id, sx: ev.clientX, sy: ev.clientY, w0: it.w, h0: it.h};
    } else if (item) {
      st.selected = item.id;
      if (item.kind !== 'link') st.gesture = {type: 'move', id: item.id, sx: ev.clientX, sy: ev.clientY, orig: structuredClone(item)};
    }
    render(); drawDraft();
  }
  function move(ev) {
    const g = st.gesture;
    if (!g) return;
    const z = st.view.z;
    if (g.type === 'pan') { st.view.x = g.vx + ev.clientX - g.sx; st.view.y = g.vy + ev.clientY - g.sy; render(); return; }
    if (g.type === 'ink') {
      const [x, y] = toWorld(ev), last = g.points[g.points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) * z >= 2) g.points.push([r1(x), r1(y)]);
      return drawDraft();
    }
    if (g.type === 'box') { [g.x1, g.y1] = toWorld(ev); return drawDraft(); }
    const it = st.items.get(g.id);
    if (!it) return;
    const dx = (ev.clientX - g.sx) / z, dy = (ev.clientY - g.sy) / z;
    if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 2) g.moved = true;
    if (!g.moved) return;
    if (g.type === 'resize') { it.w = r1(Math.max(48, g.w0 + dx)); it.h = r1(Math.max(32, g.h0 + dy)); }
    else if (it.kind === 'ink') it.points = g.orig.points.map(([x, y]) => [r1(x + dx), r1(y + dy)]);
    else { it.x = r1(g.orig.x + dx); it.y = r1(g.orig.y + dy); }
    render();
  }
  function up() {
    const g = st.gesture;
    st.gesture = null;
    if (!g) return;
    if (g.type === 'pan') saveView();
    else if (g.type === 'ink' && g.points.length >= 2) {
      const step = Math.ceil(g.points.length / MAX_POINTS), pts = g.points.filter((_, i) => i % step === 0 || i === g.points.length - 1);
      add({id: uid('ink'), kind: 'ink', points: pts, width: 2});
      st.selected = '';
    } else if (g.type === 'box') {
      let x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1), w = Math.abs(g.x1 - g.x0), h = Math.abs(g.y1 - g.y0);
      if (w < 24 || h < 24) { x = g.x0; y = g.y0; w = 280; h = 180; }
      const it = add({id: uid('box'), kind: 'box', x: r1(x), y: r1(y), w: r1(w), h: r1(h), label: ''});
      setTool('select'); openEditor(it);
    } else if ((g.type === 'move' || g.type === 'resize') && g.moved) save(g.id);
    drawDraft(); render();
  }

  // ---------- export ----------
  async function exportPng() {
    const b = bounds();
    if (!b) { say('白板还是空的'); return null; }
    const pad = 32, w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2), p = pal();
    const layer = st.layer.cloneNode(true);
    layer.removeAttribute('transform');
    layer.querySelectorAll('[data-overlay]').forEach(n => n.remove());
    layer.lastElementChild?.replaceChildren();
    const out = s('svg', {xmlns: SVG, width: w, height: h, viewBox: `${r1(b.x - pad)} ${r1(b.y - pad)} ${w} ${h}`});
    out.append(s('rect', {x: r1(b.x - pad), y: r1(b.y - pad), width: w, height: h, fill: p.bg}), layer);
    // data: rather than blob: — the roundtable CSP is img-src 'self' data:, the Control UI allows both.
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(out));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(2, 8000 / Math.max(w, h)), canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(v => (v ? resolve(v) : reject(new Error('没导出来'))), 'image/png'));
      const d = new Date(), pad2 = n => String(n).padStart(2, '0');
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = `白板-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.png`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say('已导出 PNG');
      return blob;
    } catch (error) { say('导出没成功：' + error.message); return null; }
  }

  // ---------- shell ----------
  function setTool(id) {
    st.tool = id; st.linkFrom = '';
    if (st.root) { updateBar(); say(hint()); render(); }
  }
  const button = (label, cls, onClick, title) => {
    const b = el('button', 'pk-whiteboard__btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', onClick);
    return b;
  };
  function build() {
    const root = el('section', 'pk-whiteboard');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '白板');
    root.tabIndex = -1;
    root.hidden = true;
    const bar = el('header', 'pk-whiteboard__bar');
    const tools = el('div', 'pk-whiteboard__group pk-whiteboard__tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', '白板工具');
    st.bar.tools = TOOLS.map(t => {
      const b = button(t.label, '', () => setTool(t.id));
      b.dataset.tool = t.id;
      b.title = `${t.tip}（${t.key.toUpperCase()}）`;
      tools.append(b);
      return b;
    });
    const colors = el('div', 'pk-whiteboard__group');
    colors.setAttribute('role', 'group');
    colors.setAttribute('aria-label', '便签颜色');
    st.bar.swatches = COLORS.map(([id, name]) => {
      const b = button('', 'pk-whiteboard__swatch', () => {
        const it = st.items.get(st.selected);
        if (it?.kind === 'note') { it.color = id; save(it.id); }
        st.color = id; render();
      }, name + '色便签');
      b.dataset.color = id;
      b.style.setProperty('--sw', PALETTE.day.note[id]);
      b.style.setProperty('--sw-night', PALETTE.night.note[id]);
      colors.append(b);
      return b;
    });
    st.bar.remove = button('删除', '', () => st.selected && removeItem(st.selected), '删除选中的（Delete）');
    st.bar.remove.textContent = '删除';
    const view = el('div', 'pk-whiteboard__group');
    st.bar.zoom = button('100%', 'pk-whiteboard__zoom', () => { const r = st.svg.getBoundingClientRect(); zoomAt(1 / st.view.z, r.width / 2, r.height / 2); }, '回到 100%');
    st.bar.zoom.textContent = '100%';
    view.append(button('−', '', () => zoomCentre(1 / 1.25), '缩小'), st.bar.zoom, button('+', '', () => zoomCentre(1.25), '放大'), button('全部', '', fit, '显示全部内容'));
    view.lastElementChild.textContent = '全部';
    const actions = el('div', 'pk-whiteboard__group pk-whiteboard__actions');
    const exportBtn = button('导出 PNG', '', exportPng, '导出成 PNG 图片');
    exportBtn.textContent = '导出 PNG';
    const closeBtn = button('关闭', '', close, '关闭白板');
    closeBtn.textContent = '关闭';
    actions.append(exportBtn, closeBtn);
    bar.append(el('strong', 'pk-whiteboard__title', '白板'), tools, colors, st.bar.remove, view, actions);

    const stage = el('div', 'pk-whiteboard__stage');
    const svg = s('svg', {class: 'pk-whiteboard__svg', role: 'img', 'aria-label': '白板画布'});
    const defs = s('defs'), pattern = s('pattern', {id: 'pk-whiteboard-dots', patternUnits: 'userSpaceOnUse', width: 24, height: 24});
    st.dots = s('circle', {cx: 1.5, cy: 1.5, r: 1.1});
    pattern.append(st.dots); defs.append(pattern);
    st.bg = s('rect', {width: '100%', height: '100%'});
    st.layer = s('g');
    st.draft = s('g', {'pointer-events': 'none'});
    svg.append(defs, st.bg, s('rect', {width: '100%', height: '100%', fill: 'url(#pk-whiteboard-dots)', 'pointer-events': 'none'}), st.layer);
    st.svg = svg;
    st.editor = el('textarea', 'pk-whiteboard__edit');
    st.editor.hidden = true;
    st.editor.maxLength = 2000;
    st.editor.addEventListener('blur', () => commitEdit());
    st.editor.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); commitEdit(true); }
      else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey || st.items.get(st.editor.dataset.id)?.kind === 'box')) { ev.preventDefault(); commitEdit(); }
    });
    st.empty = el('p', 'pk-whiteboard__empty', '白板是空的。选「便签」点一下放一张，选「手写」直接写；双击空白处也能放便签。');
    stage.append(svg, st.editor, st.empty);
    st.status = el('p', 'pk-whiteboard__status');
    st.status.setAttribute('role', 'status');
    st.status.setAttribute('aria-live', 'polite');
    root.append(bar, stage, st.status);

    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    // 双击在 down() 里自己认（原生 dblclick 在按下时重画会丢）。
    svg.addEventListener('wheel', ev => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) zoomAt(Math.exp(-ev.deltaY / 300), ev.clientX - r.left, ev.clientY - r.top);
      else { commitEdit(); st.view.x -= ev.deltaX; st.view.y -= ev.deltaY; render(); saveView(); }
    }, {passive: false});
    root.addEventListener('keydown', ev => {
      if (ev.target === st.editor || ev.altKey) return;
      const k = ev.key;
      if (k === 'Escape') { ev.preventDefault(); if (st.linkFrom) { st.linkFrom = ''; render(); } else if (st.selected) { st.selected = ''; render(); } else close(); return; }
      if (ev.target.closest?.('button') && (k === 'Enter' || k === ' ')) return;
      if ((k === 'Delete' || k === 'Backspace') && st.selected) { ev.preventDefault(); removeItem(st.selected); return; }
      if (ev.ctrlKey || ev.metaKey) return;
      const tool = TOOLS.find(t => t.key === k.toLowerCase());
      if (tool) { ev.preventDefault(); setTool(tool.id); }
      else if (k === '+' || k === '=') zoomCentre(1.25);
      else if (k === '-') zoomCentre(1 / 1.25);
      else if (k === '0') fit();
    });
    addEventListener('resize', () => { commitEdit(); if (isOpen()) place(); });
    // 浮层四周留 24px 白边：铺一层实的遮罩（点了不穿透，点它就关），背后的页面设 inert，根标 aria-modal。
    const scrim = el('div', 'pk-whiteboard__scrim');
    scrim.hidden = true;
    scrim.setAttribute('aria-hidden', 'true');
    scrim.addEventListener('click', () => close());
    document.body.append(scrim, root);
    st.scrim = scrim;
    st.root = root;
    updateBar();
  }
  // 桌面壳自己的窗口键 / 拖动条 / 改大小 / 更新提示 / 听写：浮在最上层，白板开着也要能用，不设 inert，白板顶边让到它们下面。
  const NATIVE = /^(pinkie-native-|pinkie-update-|laolao-native-)/;
  function place() {
    if (!st.root) return;
    const bottoms = ['pinkie-native-window-controls', 'pinkie-native-drag-strip']
      .map(id => document.getElementById(id)?.getBoundingClientRect()).filter(r => r && r.height > 0 && r.top < 80).map(r => r.bottom);
    if (bottoms.length) st.root.style.top = Math.ceil(Math.max(...bottoms) + 8) + 'px';
    else st.root.style.removeProperty('top');
  }
  // 打开时把 body 下其余顶层节点设 inert（只记自己设的，关的时候只撤自己设的）。
  const inerted = new Set();
  function setBackdrop(on) {
    if (st.scrim) st.scrim.hidden = !on;
    if (on) {
      place();
      for (const n of document.body.children) {
        if (n === st.root || n === st.scrim || n.inert || NATIVE.test(n.id) || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue;
        n.inert = true;
        inerted.add(n);
      }
    } else {
      for (const n of inerted) n.inert = false;
      inerted.clear();
    }
  }
  const isOpen = () => Boolean(st.root && !st.root.hidden);
  async function open() {
    const key = currentKey();
    if (!allowed(key)) return false;
    if (!st.root) build();
    if (key !== st.key) {
      st.key = key; st.items.clear(); st.gone.clear(); st.lastRev.clear(); st.pending.clear(); st.gen.clear();
      st.rev = 0; st.loaded = false; st.selected = ''; st.linkFrom = ''; st.view = loadView(key);
      say('正在打开白板…');
    }
    st.root.hidden = false;
    setBackdrop(true);
    // 轮询走共用调度器（页面藏起来时自动停），关掉白板就停。
    st.timer?.stop?.();
    st.timer = window.Pinkie.domWatch?.every(POLL_MS, () => {
      if (st.gesture) return;
      if (st.theme !== (isNight() ? 'night' : 'day')) render();
      pull();
    }, {pauseWhenHidden: true}) || null;
    render();
    st.root.focus({preventScroll: true});
    syncEntry();
    await pull(true);
    return true;
  }
  function close() {
    if (!st.root) return;
    commitEdit();
    st.root.hidden = true;
    setBackdrop(false);
    st.timer?.stop?.();
    st.timer = null;
    syncEntry();
    if (entry && !entry.hidden) entry.focus({preventScroll: true});
  }
  const toggle = () => (isOpen() ? close() : open());

  let entry = null;
  function syncEntry() {
    const key = currentKey(), show = allowed(key);
    if (show && !entry) {
      entry = el('button', 'pk-whiteboard-entry');
      entry.type = 'button';
      entry.title = '打开这个会话的白板';
      entry.setAttribute('aria-haspopup', 'dialog');
      entry.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="13" rx="2"/><path d="M7.5 13.5c1.6-2.4 3-3.2 4.3-1.4 1.1 1.5 2.3 1.2 4.4-1.6"/><path d="M9 20.5h6"/></svg><span>白板</span>';
      entry.addEventListener('click', toggle);
      // 圆桌右上角是席位栏，入口放进输入框上面那一行（「直接完成 / 只讨论」后面）。
      const row = HOST === 'roundtable' ? document.querySelector('.compose-context') : null;
      if (row) { entry.classList.add('is-inline'); row.append(entry); } else document.body.append(entry);
    }
    if (entry) { entry.hidden = !show; entry.setAttribute('aria-expanded', String(isOpen())); }
    if (isOpen() && key !== st.key) { if (show) open(); else close(); }
  }

  ns.whiteboard = Object.freeze({open, close, toggle, isOpen, exportPng, allowed});
  if (window.__pinkieQuiet) window.__pinkieQuiet.interval('whiteboard-entry', syncEntry, 1500);
  else window.Pinkie.domWatch?.poll(syncEntry, 1500);
  if (document.body) syncEntry(); else addEventListener('DOMContentLoaded', syncEntry, {once: true});
})();
