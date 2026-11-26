// 热点 17（ui/injections/laolao-context-compact.js）复发锁：近 60 天已上 main、此前没有测试会在「只回退这个修复」时变红的修复。
//   cc2c983d Metre 会话（agent:metre:…）的整理事件和当前会话识别都算数。
//   bc7482b2 回复 / 整理一结束就重新取用量，不等 15 秒缓存（另一会话的事件不触发）。
//   b8d1a9e9 整理提示里的署名是「C.le.」（c092fc4b 曾把它改回「碧琪」）。
//   a2514d6e 整理提示只放进本会话的 [data-pinkie-compaction] 槽位；续跑提示只由同一个 run 的结束事件收尾；
//            分隔线只改 Lit 的文字节点，不删原生 details。
//   e8da3a8e 会话的 compactionCount 前进时，进行中的整理提示自己收尾成「整理好了」。
//   86d04f2e / c092fc4b 环形面板里的按钮一下就整理（走 sessions.compact），不再弹第二层确认。
//   8fee2a89 / c092fc4b 面板打开时挂到 <body> 下浮起来；点面板里面不关，点外面才关并收回。
//   c092fc4b 明细行：固定部分估算比真实用量大时按比例缩，不出负数，加起来正好等于已用。
//   4b49bbc6 Metre 模式用「谱纸 / 誊清」的说法，切回别的模式一个字不留。
// 都在 node:vm 里跑真实脚本 + tests/fixtures/mini-dom.cjs 的最小假 DOM，不改产品代码、不开浏览器、不联网。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const {FakeElement, createDocument} = require('./fixtures/mini-dom.cjs');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-context-compact.js'), 'utf8');
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return source.slice(start, end);
};

// mini-dom 没有的三样，只在本文件里补：innerHTML（只认脚本自己写的那几段简单标记）、contains、details 的 open。
Object.defineProperty(FakeElement.prototype, 'innerHTML', {
  configurable: true,
  set(html) {
    this.replaceChildren();
    const stack = [this];
    for (const [, close, tag, attrs, selfClose, text] of String(html).matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
      const top = stack[stack.length - 1];
      if (text !== undefined) { top.append(text); continue; }
      if (close) { stack.pop(); continue; }
      const node = this.ownerDocument.createElement(tag);
      for (const [, name, dq, sq] of attrs.matchAll(/([^\s=/]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) {
        const value = dq ?? sq ?? '';
        if (name === 'class') node.className = value;
        else if (name.startsWith('data-')) node.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
        else node.setAttribute(name, value);
      }
      top.append(node);
      if (!selfClose) stack.push(node);
    }
  },
});
FakeElement.prototype.contains = function contains(node) {
  for (let n = node; n; n = n.parentElement) if (n === this) return true;
  return false;
};
// 关着时是 undefined，好让 mini-dom 的 [open] 选择器只选中真打开的。
Object.defineProperty(FakeElement.prototype, 'open', {configurable: true, get() { return this.attributes.has('open') || undefined; }});

// vm 里造出来的对象原型不同，严格 deepEqual 前先转成本 realm 的普通值。
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function boot({session = 'agent:main:s1', mode = null, sessions = {}} = {}) {
  const document = createDocument();
  document.head = document.createElement('head');
  document.getElementById = (id) => document.body.querySelector(`#${id}`) || document.head.querySelector(`#${id}`);
  if (mode) document.documentElement.setAttribute('data-laolao-mode', mode);
  const el = (tag, cls, parent = document.body) => { const node = document.createElement(tag); if (cls) node.className = cls; parent.append(node); return node; };
  const thread = el('div', 'chat-thread');
  const slot = (key) => { const node = el('div', 'pinkie-chat-compaction', thread); node.dataset.pinkieCompaction = key; return node; };
  const composer = el('div', 'agent-chat__composer');
  const stack = el('div', 'agent-chat__composer-status-stack', composer);
  el('div', 'agent-chat__composer-actions', composer);
  el('div', 'agent-chat__composer-meta', composer);
  const listeners = {};
  const store = new Map();
  const h = {document, sessions, calls: [], compactResult: {ok: true, compacted: true, result: {tokensBefore: 900, tokensAfter: 300}}, stack, slot, el};
  const window = {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach((fn) => fn(event)); },
    Pinkie: {domWatch: {poll(fn) { h.tick = fn; }}},
    __laolaoSidebar: {gwRequest: async (method, params) => {
      h.calls.push([method, params]);
      if (method === 'sessions.list') return {sessions: Object.entries(h.sessions).map(([key, row]) => ({key, ...row})), defaults: {}};
      if (method === 'sessions.compact') return h.compactResult;
      return null;
    }},
  };
  h.window = window;
  h.location = {search: `?session=${encodeURIComponent(session)}`, href: 'http://pinkie.test/chat'};
  vm.runInNewContext(source, {
    window, document, location: h.location, URLSearchParams, URL, Event, CustomEvent, innerWidth: 1024, innerHeight: 768,
    localStorage: {getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k)},
    setTimeout: () => 0, clearTimeout() {},
  });
  h.api = window.__laolaoContextCompact;
  h.emit = (event, payload) => (listeners['pinkie:gateway-event'] || []).forEach((fn) => fn({detail: {event, payload}}));
  h.count = (method) => h.calls.filter(([name]) => name === method).length;
  h.viewer = () => document.querySelector('.laolao-context-viewer');
  h.panel = () => h.viewer().__lcvPanel;
  h.open = () => { h.viewer().setAttribute('open', ''); h.viewer().dispatch('toggle'); };
  h.pointerdown = (target) => document.listeners.get('pointerdown').forEach((fn) => fn({target}));
  return h;
}
const usageRow = (extra = {}) => ({totalTokens: 50000, contextTokens: 200000, ...extra});

test('Metre sessions count: route key is recognised and its compaction events raise the notice (cc2c983d)', () => {
  const key = 'agent:metre:dashboard:x';
  const h = boot({session: key});
  assert.equal(h.api.currentSessionKey(), key, '?session=agent:metre:… 就是当前会话');
  const host = h.slot(key);
  h.emit('agent', {sessionKey: key, runId: 'r1', stream: 'compaction', data: {phase: 'start'}});
  assert.equal(h.api.readCompactionState(key)?.phase, 'active', 'Metre 的整理开始事件没被丢掉');
  assert.ok(host.querySelector('.laolao-compaction-notice'), 'Metre 会话里也看得到整理提示');
});

test('usage is fetched again as soon as a reply or a compaction ends, not after the 15s cache (bc7482b2)', async () => {
  const key = 'agent:main:s1';
  const h = boot({sessions: {[key]: usageRow()}});
  await flush();
  let seen = h.count('sessions.list');
  assert.equal(seen, 1, '启动时取一次');
  const step = async (label, event, payload) => {
    h.emit(event, payload);
    await flush();
    assert.equal(h.count('sessions.list'), seen + 1, `${label} 之后立刻重新取用量`);
    seen += 1;
  };
  await step('回复结束', 'chat', {sessionKey: key, state: 'final', runId: 'r1'});
  await step('手动整理结束', 'session.operation', {sessionKey: key, operation: 'compact', phase: 'end', completed: true});
  await step('自动整理结束', 'agent', {sessionKey: key, runId: 'r2', stream: 'compaction', data: {phase: 'end', completed: true}});
  h.emit('chat', {sessionKey: 'agent:main:other', state: 'final', runId: 'r3'});
  await flush();
  assert.equal(h.count('sessions.list'), seen, '别的会话结束不替当前会话取数');
});

test('the notice goes into this session\'s own slot only, signed C.le., and leaves with the session (a2514d6e, b8d1a9e9)', () => {
  const key = 'agent:main:s1';
  const h = boot();
  const other = h.slot('agent:main:other');
  const mine = h.slot(key);
  h.emit('agent', {sessionKey: key, runId: 'r1', stream: 'compaction', data: {phase: 'start'}});
  const notice = mine.querySelector('.laolao-compaction-notice');
  assert.ok(notice, '提示在本会话的槽位里');
  assert.equal(h.stack.querySelector('.laolao-compaction-notice'), null, '不往输入框的状态栏里塞');
  assert.equal(other.querySelector('.laolao-compaction-notice'), null, '不进别的会话的槽位');
  assert.equal(notice.querySelector('.laolao-compaction-notice__icon').textContent, 'C.le.', '署名是 C.le.，不是碧琪');
  h.location.search = `?session=${encodeURIComponent('agent:main:other')}`;
  h.tick();
  assert.equal(h.document.querySelector('.laolao-compaction-notice'), null, '换到别的会话，提示跟着走');
});

test('a retrying notice is finished only by the terminal event of its own run (a2514d6e)', () => {
  const key = 'agent:main:s1';
  const h = boot();
  h.slot(key);
  h.emit('agent', {sessionKey: key, runId: 'r1', stream: 'compaction', data: {phase: 'start'}});
  h.emit('agent', {sessionKey: key, runId: 'r1', stream: 'compaction', data: {phase: 'end', completed: true, willRetry: true}});
  assert.equal(h.api.readCompactionState(key)?.phase, 'retrying');
  h.emit('chat', {sessionKey: key, state: 'final', runId: 'someone-else'});
  assert.equal(h.api.readCompactionState(key)?.phase, 'retrying', '别的 run 结束不收别人的提示');
  h.emit('agent', {sessionKey: key, runId: 'r1', stream: 'lifecycle', data: {phase: 'end'}});
  assert.equal(h.api.readCompactionState(key)?.phase, 'complete', '同一个 run 结束才收尾');
});

test('the compaction divider swaps only Lit\'s text node and keeps the native details (a2514d6e)', () => {
  const h = boot();
  const divider = h.el('div', 'chat-divider');
  const label = h.el('span', 'chat-divider__label', divider);
  const comment = {nodeType: 8, nodeValue: '?lit$123$'};
  const text = {nodeType: 3, nodeValue: 'Compacted history'};
  label.childNodes = [comment, text];
  const rule = h.el('div', 'chat-divider__rule', divider);
  const details = h.el('details', 'chat-divider__details', divider);
  h.tick();
  assert.equal(text.nodeValue, '前面的对话已整理，原始记录仍保留');
  assert.equal(comment.nodeValue, '?lit$123$', 'Lit 的标记注释原样不动');
  assert.deepEqual(label.childNodes, [comment, text], '不整块替换 label 的子节点');
  assert.equal(details.parentElement, divider, '原生 details 还在（只用样式藏）');
  assert.equal(rule.getAttribute('aria-label'), '前面的对话已整理，原始记录仍保留');
});

test('an in-flight notice completes by itself once the session\'s compactionCount moves on (e8da3a8e)', async () => {
  const key = 'agent:main:s1';
  const h = boot({sessions: {[key]: usageRow({totalTokens: 150000, compactionCount: 2})}});
  h.slot(key);
  await flush();
  h.emit('agent', {sessionKey: key, runId: 'r1', stream: 'compaction', data: {phase: 'start'}});
  await flush();
  assert.equal(h.api.readCompactionState(key)?.phase, 'active');
  // 结束事件丢了，但网关里的会话已经整理过一次。
  h.sessions[key] = usageRow({totalTokens: 40000, compactionCount: 3});
  h.window.dispatchEvent(new Event('laolao:sessions-changed'));
  await flush();
  const state = h.api.readCompactionState(key);
  assert.equal(state?.phase, 'complete', '按会话记录收尾，而不是一直转');
  assert.equal(state.beforeTokens, 150000);
  assert.equal(state.afterTokens, 40000);
});

test('the panel button compacts in one click through sessions.compact, no second confirm (86d04f2e, c092fc4b)', async () => {
  const key = 'agent:main:s1';
  const h = boot({sessions: {[key]: usageRow()}});
  await flush();
  h.open();
  const button = h.panel().querySelector('.laolao-context-viewer__compact');
  assert.equal(button.disabled, false, '有用量、没在回复时按钮可点');
  button.click();
  await flush();
  assert.deepEqual(plain(h.calls.filter(([name]) => name === 'sessions.compact').map(([, params]) => params)), [{key, agentId: 'main'}]);
  assert.equal(h.document.querySelector('#laolao-context-compact-popover'), null, '不再弹「开始整理」确认层');
  assert.equal(h.viewer().open, undefined, '点了就收起面板');
  assert.equal(h.api.readCompactionState(key)?.phase, 'complete');
});

test('the open panel floats under <body>, survives clicks inside it and docks back when closed (8fee2a89, c092fc4b)', async () => {
  const key = 'agent:main:s1';
  const h = boot({sessions: {[key]: usageRow()}});
  await flush();
  const viewer = h.viewer();
  const panel = h.panel();
  assert.equal(panel.parentElement, viewer, '关着时面板在环里');
  h.open();
  assert.equal(panel.parentElement, h.document.body, '打开后挂到 body 下，不被输入框的层叠上下文压住');
  assert.ok(panel.classList.contains('is-floating'));
  assert.notEqual(panel.style.left, undefined, '按环的位置摆好');
  h.pointerdown(panel.querySelector('.lcv-rows'));
  assert.equal(viewer.open, true, '点浮起来的面板里面不算点外面');
  h.pointerdown(h.document.body);
  assert.equal(viewer.open, undefined, '点外面才关');
  viewer.dispatch('toggle');
  assert.equal(panel.parentElement, viewer, '关了收回环里');
  assert.equal(panel.classList.contains('is-floating'), false);
});

test('detail rows never go negative and add up to the real usage when the estimate overshoots (c092fc4b)', () => {
  const {contextRows} = vm.runInNewContext(`(() => { ${between('const estimateTokens', '// Metre 用自己的话')} return {contextRows}; })()`, {});
  const sum = (rows) => rows.filter((row) => !['reserve', 'free'].includes(row.id)).reduce((total, row) => total + row.tokens, 0);
  const capacity = {used: 1000, limit: 10000, compactionBudget: {threshold: 8500}};
  // 固定部分估出 2000，比上一轮写回的 1000 还多（总数过时了）。
  const stale = contextRows(capacity, {tools: 4000, toolCount: 3, rules: 2000, files: 1000, fileCount: 2, skills: 1000});
  assert.ok(stale.every((row) => row.tokens >= 0), `不出负数：${JSON.stringify(stale)}`);
  assert.equal(sum(stale), 1000, '各类加起来就是已用');
  assert.deepEqual(plain(stale.map((row) => [row.id, row.tokens])), [['messages', 0], ['tools', 500], ['rules', 250], ['files', 125], ['skills', 125], ['reserve', 1500], ['free', 7500]]);
  const fresh = contextRows(capacity, {tools: 800, rules: 400, files: 400, skills: 400});
  assert.equal(fresh[0].tokens, 500, '对话 = 已用 − 固定部分');
  assert.equal(sum(fresh), 1000);
});

test('Metre words its panel as 谱纸 / 誊清, and switching back leaves no Metre word behind (4b49bbc6)', async () => {
  const key = 'agent:main:s1';
  const budget = {window: 200000, threshold: 170000, triggerRatio: 0.85};
  const h = boot({mode: 'metre', sessions: {[key]: usageRow({pinkieCompactionBudget: budget})}});
  await flush();
  h.open();
  const text = (selector) => h.panel().querySelector(selector).textContent;
  const labels = () => h.panel().querySelectorAll('.lcv-name').map((node) => node.textContent);
  assert.equal(text('.lcv-head strong'), '谱纸');
  assert.equal(text('.laolao-context-viewer__compact'), '现在誊清');
  assert.deepEqual(labels(), ['已写', '誊清前留白', '空白']);
  assert.match(text('.lcv-note'), /会自动誊清/);
  h.document.documentElement.removeAttribute('data-laolao-mode');
  h.tick();
  assert.equal(text('.lcv-head strong'), '上下文');
  assert.equal(text('.laolao-context-viewer__compact'), '现在整理上下文');
  assert.deepEqual(labels(), ['已使用', '自动整理预留', '剩余空间'], '换模式后明细行重画，不留 Metre 的说法');
  assert.doesNotMatch(text('.lcv-note'), /誊清/);
});
