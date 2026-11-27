// 热点 laolao-session-list.js 复发锁：三处已上 main、此前没有自动化测试会在「只回退修复」时变红的修复。
//   cf5d78fe 搜索/作品等快捷入口直接挂在侧栏区块下、紧贴在会话列表上方，不跟着列表滚走；
//            原生区块被 Lit 重建、入口组被挪走或摘掉后，下一次绘制把它找回原位，不会多出第二组。
//   0a746650 会话搜索打开命中：摘录首尾的「…」和空白差异不妨碍定位；只命中标题的结果不去滚动找消息。
//   03dc495b 原生渲染的消息 ID 和历史条目 ID 不一样时，经 PinkieSessionCards.forkEntryId 对上号再定位。
// 都直接跑 ui/injections/laolao-session-list.js 里的真实代码（node:vm + 最小假 DOM），不改产品代码，不开浏览器。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const {FakeElement, createDocument} = require('./fixtures/mini-dom.cjs');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-session-list.js'), 'utf8');
const cardsSource = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-session-cards.js'), 'utf8');
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return source.slice(start, end);
};
const settle = () => new Promise(resolve => setImmediate(resolve));

/* ── 快捷入口的位置（cf5d78fe）──────────────────────────────────────── */

// mini-dom 的 insertBefore 先算下标再摘节点，同一父节点里往前挪会落错位；这里按浏览器语义补齐，
// 再补上侧栏绘制要用到的 replaceWith / hasAttribute / `:not(...)`。
class Node extends FakeElement {
  insertBefore(node, reference) {
    node.parentElement?.removeChild(node);
    const index = reference ? this.children.indexOf(reference) : -1;
    node.parentElement = this;
    node.isConnected = true;
    if (index < 0) this.children.push(node); else this.children.splice(index, 0, node);
    return node;
  }
  replaceWith(next) {
    if (!this.parentElement) return;
    this.parentElement.insertBefore(next, this);
    this.remove();
  }
  hasAttribute(name) { return this.attributes.has(name); }
  querySelectorAll(selector) {
    const not = /^(.*):not\((.*)\)$/.exec(selector.trim());
    if (!not) return super.querySelectorAll(selector);
    return super.querySelectorAll(not[1]).filter(node => !(not[2] === ':disabled' ? node.disabled : node.matches(not[2])));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function mountSidebar() {
  const document = createDocument();
  document.createElement = tag => new Node(tag, document);
  document.createElementNS = (_, tag) => document.createElement(tag);
  document.documentElement.hasAttribute = name => document.documentElement.attributes.has(name);
  const window = {addEventListener() {}, dispatchEvent() {}};
  vm.runInNewContext(source, {window, document, navigator: {platform: 'Linux'},
    setTimeout: () => 0, clearTimeout() {}, setInterval() {}, console});
  // 原生侧栏区块：Lit 画的原生会话列表一直挂着，碧琪的列表另起一个宿主节点。
  const section = document.createElement('section');
  section.id = 'sidebar';
  const native = document.createElement('div');
  native.className = 'sidebar-recent-sessions';
  section.append(native);
  document.body.append(section);
  const toasts = [];
  const key = 'agent:main:dashboard:a';
  const api = {mode: 'chat', agentId: 'main', currentKey: '',
    state: {pins: [], collapsed: {}, projects: {}, projectFolders: {}},
    gwRequest: async method => method === 'sessions.list'
      ? {sessions: [{key, label: '侧栏搜索入口检查', lastMessagePreview: '好', updatedAt: Date.now()}]}
      : method === 'pinkie.session.lineage' ? {children: {}, states: {}} : {rows: {}},
    toast: message => toasts.push(message)};
  return {section, key, toasts, render: () => window.PinkieSessionList.render(section, api)};
}

function assertShortcutsAboveList(section, why) {
  const host = section.querySelector('#laolao-session-manager');
  const controls = section.querySelectorAll('.laolao-session-controls');
  assert.ok(host, '碧琪的列表宿主已挂上');
  assert.equal(controls.length, 1, `${why}：只有一组快捷入口`);
  // DOM 节点互相引用，只比身份、不让断言去展开整棵树。
  assert.ok(controls[0].parentElement === section, `${why}：入口直接挂在侧栏区块下，不在滚动的列表里`);
  assert.ok(section.children[section.children.indexOf(controls[0]) + 1] === host, `${why}：入口紧贴在列表上方`);
  assert.ok(controls[0].querySelector('.pinkie-sidebar-entry--search'), `${why}：「搜索」入口还在`);
  assert.ok(controls[0].querySelector('.pinkie-sidebar-entry--artifacts'), `${why}：「作品」入口还在`);
  return controls[0];
}

test('the sidebar shortcuts sit right above the scrolling list, outside it (cf5d78fe)', async () => {
  const h = mountSidebar();
  h.render();
  await settle(); await settle();
  assert.deepEqual(h.toasts, []);
  assert.ok(h.section.querySelector('#laolao-session-manager .session-row-host'), '会话行画进了列表宿主');
  const controls = assertShortcutsAboveList(h.section, '首次绘制');
  assert.ok(controls.parentElement.querySelector('#laolao-session-manager .laolao-session-controls') === null,
    '列表宿主里没有入口组（否则会跟着列表一起滚走）');
});

test('after the native section is rebuilt the shortcuts come back above the list, never twice (cf5d78fe)', async () => {
  const h = mountSidebar();
  h.render();
  await settle(); await settle();
  const first = assertShortcutsAboveList(h.section, '首次绘制');
  // Lit 重排原生区块，把入口组挪到了列表后面；数据没变，绘制签名相同，也得把它放回去。
  h.section.append(first);
  h.render();
  assert.ok(assertShortcutsAboveList(h.section, '入口组被挪到列表后面之后') === first, '找回原来那组，不另建');
  // Lit 整个重建时把入口组摘掉了：下一次绘制重新建一组，照样放在列表上方。
  first.remove();
  h.render();
  assert.ok(assertShortcutsAboveList(h.section, '入口组被摘掉之后') !== first, '摘掉的那组不会被复用');
  assert.deepEqual(h.toasts, []);
});

/* ── 搜索命中的定位（0a746650 / 03dc495b）──────────────────────────── */

const cardsWindow = {};
vm.runInNewContext(cardsSource, {window: cardsWindow});

const message = (id, text) => {
  const node = {dataset: {messageId: id, messageText: text}, scrolled: 0, classes: new Set()};
  node.scrollIntoView = () => { node.scrolled += 1; };
  node.classList = {add: name => node.classes.add(name), remove: name => node.classes.delete(name)};
  return node;
};

// 只取 scrollToSearchHit 本体来跑：会话已经切过去，聊天面板里是给定的消息；计时器由测试手动推进。
function searchHit(result, {messages = [], history = []} = {}) {
  const timers = [], toasts = [];
  const pane = {active: true, state: {sessionKey: result.key, chatMessages: history},
    querySelectorAll: selector => (selector === '[data-message-id]' ? messages : []),
    querySelector: () => null};
  const context = {
    current: {api: {currentKey: result.key}},
    location: {href: 'http://127.0.0.1/chat?session=' + encodeURIComponent(result.key)},
    URL,
    document: {querySelectorAll: selector => (selector === 'openclaw-chat-pane' ? [pane] : []),
      querySelector: selector => (selector === 'openclaw-chat-pane' ? pane : null)},
    window: cardsWindow,
    setTimeout: (callback, ms) => { timers.push({callback, ms}); return timers.length; },
  };
  const run = vm.runInNewContext(`(() => { ${between('function scrollToSearchHit(api, result) {', '\n  function openSearch(')} return scrollToSearchHit; })()`, context);
  run({toast: text => toasts.push(text)}, result);
  return {timers, toasts, tick() { const next = timers.shift(); next?.callback(); return Boolean(next); }};
}

test('a search excerpt with … ends and different spacing still finds its message (0a746650)', () => {
  // 原生消息 ID 和搜索返回的条目 ID 对不上，只能靠摘录找；摘录首尾带「…」、空白也和渲染的不一样。
  const other = message('msg:native-1', '别的话');
  const hit = message('msg:native-2', '今天我们 把 侧栏的\n\n搜索修好 了');
  const h = searchHit({key: 'agent:main:dashboard:s', entryId: 'entry-42', snippet: '…把  侧栏的\n搜索修好…'},
    {messages: [other, hit]});
  assert.ok(h.tick(), '打开会话后去找命中的消息');
  assert.equal(hit.scrolled, 1, '滚到摘录所在的那条消息');
  assert.ok(hit.classes.has('pinkie-search-hit'), '命中的消息亮一下');
  assert.equal(other.scrolled, 0);
  assert.deepEqual(h.timers.map(item => item.ms), [3000], '只剩 3 秒后取消高亮，不再重试');
  assert.deepEqual(h.toasts, []);
});

test('a title-only search result opens the session without hunting for a message (0a746650)', () => {
  // 只命中标题时没有 entryId；摘录是标题本身，不能拿它去滚到某条恰好提到标题的消息。
  const mention = message('msg:native-3', '项目检查做完了');
  const h = searchHit({key: 'agent:main:dashboard:t', entryId: '', snippet: '项目检查'}, {messages: [mention]});
  assert.equal(h.timers.length, 0, '不安排任何查找');
  assert.equal(h.tick(), false);
  assert.equal(mention.scrolled, 0, '不会跳到提到标题的消息上');
  assert.deepEqual(h.toasts, []);
});

test('a rendered message id that differs from the history entry id is matched through forkEntryId (03dc495b)', () => {
  // 原生渲染器给消息编的是「msg:角色:时间戳:序号」，搜索返回的是历史条目 ID；没有摘录可兜底。
  const history = [{role: 'user', timestamp: 400, __openclaw: {id: 'entry-6'}},
    {role: 'assistant', timestamp: 456, __openclaw: {id: 'entry-7'}}];
  const question = message('msg:user:400:0', '问题');
  const answer = message('msg:assistant:456:1', '回答');
  const h = searchHit({key: 'agent:main:dashboard:f', entryId: 'entry-7', snippet: ''},
    {messages: [question, answer], history});
  assert.ok(h.tick());
  assert.equal(answer.scrolled, 1, '经条目 ID 对上号，滚到那条回答');
  assert.equal(question.scrolled, 0);
  assert.ok(answer.classes.has('pinkie-search-hit'));
  assert.deepEqual(h.timers.map(item => item.ms), [3000]);
});
