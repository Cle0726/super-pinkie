// 热点（ui/injections/laolao-process-card.js）复发锁：近 60 天已上 main、此前没有行为测试抓的修复。
//   b9b58ad0 状态表情改回站点根路径（3033008b 曾改成 ./，在 /settings/… 下 404）。
//   43192d2d 刷新后进行中的卡仍显示状态且不乱计时；停下的卡恢复「停下来了」；进行中状态发布给工具流。
//   a2514d6e 中途打开的页面错过 lifecycle.start 也能接上这一轮；思考不会迁进别的会话的卡。
//   fe03b2e1 思考时间从这一轮开始 / 上一个工具结果算起（有的模型憋完一次性送来）。
//   c092fc4b 卡片元素换键后旧键不再指向它，进行中的一轮跟着卡的现键走。
// 另有一条 test.todo：fe03b2e1 的「完成贴纸跟着换键走」在没有思考记录时疑似已回归（见该条注释）。
// 全部在 node:vm + 最小假 DOM 里直接跑真实脚本，不启动浏览器，不改产品代码。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');

const script = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-process-card.js'), 'utf8');
const SESSION = 'agent:main:test';
const chatHref = (session = SESSION, page = '/chat') => `http://localhost${page}?session=${encodeURIComponent(session)}`;
const cardKey = (id, session = SESSION) => `pinkie:process:${session}:${id}`;

function harness({href = chatHref()} = {}) {
  const document = createDocument();
  const proto = Object.getPrototypeOf(document.createElement('div'));
  if (!Object.getOwnPropertyDescriptor(proto, 'parentNode')) {
    Object.defineProperty(proto, 'parentNode', {get() { return this.parentElement; }});
  }
  // 假时钟：Date.now 与 performance.now 都走它，思考时长可以精确断言。
  const clock = {t: 1_800_000_000_000};
  class FakeDate extends Date { static now() { return clock.t; } }
  const frames = [], images = [], listeners = new Map();
  let observer = null;
  const location = {href};
  const window = {
    addEventListener(name, handler) { listeners.set(name, handler); },
    Pinkie: {domWatch: {createObserver(fn) { observer = fn; return {watch() {}}; }, poll: () => ({stop() {}})}},
    __pinkieChatViewport: {preserve(_pane, change) { return change(); }},
  };
  vm.runInNewContext(script, {window, document, location, URL, console,
    localStorage: {getItem: () => '{}', setItem() {}},
    Image: class { set src(value) { images.push(value); } },
    CSS: {escape: value => value}, Date: FakeDate,
    performance: {now: () => clock.t},
    matchMedia: () => ({matches: true}), // 减少动效：思考文字一次画完，不走打字机
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() {}});
  const api = window.__laolaoProcessCard;
  const flush = () => { for (let i = 0; i < 8 && frames.length; i++) for (const fn of frames.splice(0)) fn(); };
  const render = () => { api.schedule(); flush(); };
  // 原生渲染器的 DOM 变化经共享观察器送进来；这里手动投递同样的记录。
  const notify = record => { observer([{addedNodes: [], removedNodes: [], ...record}]); flush(); };
  const setLive = ({details, status}, live) => {
    if (live) { details.dataset.live = '1'; status.dataset.live = '1'; }
    else { delete details.dataset.live; delete status.dataset.live; }
  };
  // 一张时间线补丁画出来的过程卡：状态位 + 顶部思考位（都是 Lit 管的静态位置）。
  function addCard(key, {live = false, state = ''} = {}) {
    const card = document.createElement('div');
    card.className = 'chat-group chat-group--process';
    card.dataset.pinkieProcess = key; card.dataset.pinkieRowCount = '0';
    const details = document.createElement('details'); details.className = 'pinkie-process';
    const status = document.createElement('div'); status.dataset.pinkieStatus = key;
    if (state) status.dataset.state = state;
    // mini-dom 不认 :not(...)，这一处按原意手动找。
    const find = status.querySelector.bind(status);
    status.querySelector = selector => selector === '.pinkie-status:not(.is-gone)'
      ? status.children.find(n => n.classList.contains('pinkie-status') && !n.classList.contains('is-gone')) || null
      : find(selector);
    const top = document.createElement('div'); top.dataset.pinkieThinking = key; top.dataset.pinkieThinkingSeg = '0';
    details.append(status, top); card.append(details); document.body.append(card);
    const parts = {card, details, status, top};
    setLive(parts, live);
    notify({type: 'childList', target: document.body, addedNodes: [card]});
    return parts;
  }
  // 原生列表按位置复用元素：同一个元素改画另一轮（换键）。
  function rekey(parts, key, live) {
    parts.card.dataset.pinkieProcess = key; parts.top.dataset.pinkieThinking = key; parts.status.dataset.pinkieStatus = key;
    if (live !== undefined) setLive(parts, live);
    notify({type: 'attributes', target: parts.card});
  }
  function removeCard(parts) {
    parts.card.remove();
    notify({type: 'childList', target: document.body, removedNodes: [parts.card]});
  }
  function send(stream, data) {
    const sessionKey = new URL(location.href).searchParams.get('session');
    listeners.get('pinkie:gateway-event')({detail: {event: 'agent', payload: {sessionKey, stream, data}}});
    flush();
  }
  const pill = parts => parts.status.querySelector('.pinkie-status:not(.is-gone)');
  return {api, window, location, clock, images, render, addCard, rekey, removeCard, send, pill};
}

/* ── b9b58ad0：状态表情的路径 ───────────────────────────────────────── */

test('b9b58ad0：状态表情走站点根路径，在 /settings/… 页面下也能加载', () => {
  const h = harness({href: chatHref(SESSION, '/settings/tuning')});
  const resolved = src => new URL(src, h.location.href).pathname;
  // 脚本加载时预取的六张。
  assert.deepEqual(h.images.map(resolved),
    ['thinking', 'working', 'writing', 'asking', 'done', 'oops'].map(state => `/laolao-pinkie-status-${state}.png`));
  // 进行中的一轮实际画出来的那张。
  h.send('lifecycle', {phase: 'start'});
  const card = h.addCard(cardKey('run-1'), {live: true});
  const img = h.pill(card)?.querySelector('img.is-current');
  assert.ok(img, '进行中的卡没有画出状态表情');
  assert.equal(resolved(img.src), '/laolao-pinkie-status-thinking.png');
});

/* ── 43192d2d：刷新后的状态位 ───────────────────────────────────────── */

test('43192d2d：刷新后进行中的卡仍显示「在动小脑瓜」且不显示从 0 起的计时', () => {
  const h = harness(); // 页面刚刷新：脚本里没有任何进行中的一轮
  const card = h.addCard(cardKey('run-live'), {live: true});
  const pill = h.pill(card);
  assert.ok(pill, '刷新后进行中的卡丢了状态');
  assert.equal(pill.dataset.state, 'thinking');
  assert.equal(pill.querySelector('.pinkie-status__time').textContent, '', '刷新后不知道开始时间，不能显示 0s');
});

test('43192d2d：刷新后停下来的那一轮恢复「停下来了」占位', () => {
  const h = harness();
  const card = h.addCard(cardKey('run-stopped'), {state: 'oops'});
  const pill = h.pill(card);
  assert.equal(pill?.dataset.state, 'oops');
  assert.equal(pill.querySelector('.pinkie-status__phrase').textContent, '这一轮停下来了，做到一半的记录都留着');
});

test('43192d2d：进行中的状态按会话发布给工具流，结束后撤下', () => {
  const h = harness();
  h.addCard(cardKey('run-1'), {live: true});
  h.send('lifecycle', {phase: 'start'});
  assert.equal(h.window.__pinkieActiveChatRuns?.get(SESSION), true);
  h.send('lifecycle', {phase: 'end'});
  assert.equal(h.window.__pinkieActiveChatRuns.get(SESSION), false);
});

/* ── a2514d6e：中途打开 / 跨会话 ───────────────────────────────────── */

test('a2514d6e：中途打开的页面错过 lifecycle.start，也能接上这一轮并在结束时收尾', () => {
  const h = harness();
  const key = cardKey('run-mid');
  const card = h.addCard(key, {live: true});
  h.send('thinking', {delta: '页面打开前就开始的思考'});
  assert.ok(h.api.run.startedAt > 0, '没有接上进行中的这一轮');
  assert.equal(h.window.__pinkieActiveChatRuns?.get(SESSION), true);
  h.send('lifecycle', {phase: 'end'});
  assert.equal(h.window.__pinkieActiveChatRuns.get(SESSION), false, '结束后进行中状态没撤下');
  assert.equal(h.api.run.doneKey, key);
  assert.equal(h.pill(card)?.dataset.state, 'done');
});

test('a2514d6e：一轮结束后换到别的会话，新会话的卡不会被塞进上一轮的思考', () => {
  const h = harness();
  const keyA = cardKey('run-a');
  const a = h.addCard(keyA, {live: true});
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: 'A 会话的思考'});
  h.send('lifecycle', {phase: 'end'});
  assert.equal(h.api.store[keyA]?.text, 'A 会话的思考');
  // 不经过 pinkie:session-selected（例如直接改地址）：A 卡被摘下，B 会话画出自己的卡。
  h.removeCard(a);
  h.location.href = chatHref('agent:main:other');
  const keyB = cardKey('run-b', 'agent:main:other');
  const b = h.addCard(keyB);
  h.render();
  assert.equal(h.api.store[keyB], undefined, '上一轮的思考迁进了别的会话的卡');
  assert.equal(b.card.querySelector('.pinkie-thinking'), null);
});

/* ── fe03b2e1：思考时长的起点 ──────────────────────────────────────── */

test('fe03b2e1：思考时间从这一轮开始 / 上一个工具结果算起，不从思考送达那刻算', () => {
  const h = harness();
  const key = cardKey('run-1');
  h.addCard(key, {live: true});
  h.send('lifecycle', {phase: 'start'});
  h.clock.t += 4000; h.send('thinking', {delta: '憋了四秒一次性送来的思考'});
  h.clock.t += 500; h.send('tool', {phase: 'start', name: 'read'});
  const record = h.api.store[key];
  assert.equal(record.eps[0].ms, 4500, '第一段应从这一轮开始算');
  h.clock.t += 1000; h.send('tool', {phase: 'result', name: 'read'});
  h.clock.t += 3000; h.send('thinking', {delta: '第二段'});
  h.clock.t += 200; h.send('assistant', {delta: '答'});
  assert.equal(record.eps[1].ms, 3200, '第二段应从上一个工具结果算');
  assert.equal(record.ms, 7700);
});

/* ── c092fc4b：卡片元素换键 ────────────────────────────────────────── */

test('c092fc4b：卡片元素换键后旧键不再指向它，进行中的一轮跟着卡的现键走', () => {
  const h = harness();
  const [k1, k2, k3] = ['run-1', 'run-2', 'run-3'].map(id => cardKey(id));
  const w = h.addCard(k2);
  const x = h.addCard(k1);
  // 原生列表按位置复用元素：X 改画进行中的 k2，W 改画 k3。
  h.rekey(x, k2, true);
  h.rekey(w, k3, false);
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '新一轮的思考'});
  assert.equal(h.api.run.key, k2, '进行中的一轮落到了卡片的旧键上');
  assert.equal(h.api.store[k1], undefined);
  assert.deepEqual(Array.from(h.api.store[k2]?.eps || [], ep => ep.text), ['新一轮的思考']); // vm 里的数组跨 realm，先转成本地数组
  assert.equal(x.card.querySelector('.pinkie-thinking__text')?.textContent, '新一轮的思考');
});

/* ── 疑似回归，只标记不修 ──────────────────────────────────────────── */

// fe03b2e1 当时让「完成啦」贴纸在卡片换键时也跟过去，即使这一轮没有记录任何思考
// （finish 不再要求 store[run.key]）。a2514d6e 重写 migrateThinking 后多了 `!record?.text`
// 就提前返回，doneKey 不再跟随。Plan B（0b34a7d8）后卡片按 run id 取键，结束后是否还会换键
// 需要维护者确认；确认是真问题后再修源码，并把这条改成普通 test。
// 不带函数体：tools/release-gate/tap.mjs 只把 # SKIP 排除在失败之外，带失败断言的 todo 会输出
// `not ok … # TODO` 并被发版门禁记成新失败，所以这里只登记，不跑会失败的断言。
// 复现步骤与断言原文（当前 doneKey 停在 optimistic，没跟到 durable）：
//   const h = harness();
//   const card = h.addCard(cardKey('optimistic'), {live: true});
//   h.send('lifecycle', {phase: 'start'});
//   h.send('assistant', {delta: '直接回答，没有思考'});
//   h.send('lifecycle', {phase: 'end'});
//   // 历史同步把乐观的用户行换成正式行：同一张卡换了键，不再是进行中。
//   const durable = cardKey('durable');
//   h.rekey(card, durable, false);
//   h.render();
//   assert.equal(h.api.run.doneKey, durable);
//   assert.equal(h.pill(card)?.dataset.state, 'done');
test.todo('fe03b2e1（疑似已回归）：没有思考记录的一轮，卡片换键后「完成啦」贴纸仍跟到新卡上（待维护者确认后修源码）');
