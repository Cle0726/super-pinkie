// T3 #20（#96 L31）：Metre 后台会话做完时的侧栏完成标记 + 系统通知（ui/injections/laolao-metre-notify.js / .css）。
// 改前：laolao-run-notify.js 的会话正则只认五个碧琪模式，Metre 会话做完既不记未读、也不发通知——下面「做完」几条都失败。
// 不起浏览器：把新文件放进极简假 DOM，喂 pinkie:gateway-event，看它调了什么。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));   // objects made inside the vm context have another realm's prototypes
const JS = 'ui/injections/laolao-metre-notify.js';
const CSS = 'ui/injections/laolao-metre-notify.css';
const CUR = 'agent:metre:dashboard:cur1';
const BG = 'agent:metre:dashboard:bg01';

function env({mode = 'metre', hidden = false, current = CUR, runNotify = true, notifyPrefs = {done: true, waiting: true}, native = false, permission = 'granted'} = {}) {
  let clock = 1_800_000_000_000;
  const listen = {wnd: {}, doc: {}};
  const rpc = [], events = [], posted = [], notes = [], timers = [];
  const rowFor = (key, name) => ({dataset: {sessionKey: key}, querySelector: (s) => (s.includes('__name') ? {textContent: name} : null)});
  const rows = [rowFor(CUR, '当前会话'), rowFor(BG, '整理发布清单')];
  class FakeNotification {
    constructor(title, options) { this.title = title; this.options = options; notes.push(this); }
  }
  FakeNotification.permission = permission;
  const document = {
    hidden, title: 'Metre',
    documentElement: {getAttribute: (k) => (k === 'data-laolao-mode' ? mode : null)},
    querySelector: (s) => (s === 'openclaw-chat-pane' ? {state: {sessionKey: current}} : null),
    querySelectorAll: (s) => (s === '[data-session-key]' ? rows : []),
    addEventListener: (t, f) => { (listen.doc[t] ||= []).push(f); },
  };
  const window = {
    Pinkie: {},
    location: {href: `http://127.0.0.1/chat?session=${encodeURIComponent(current)}`},
    addEventListener: (t, f) => { (listen.wnd[t] ||= []).push(f); },
    dispatchEvent: (e) => { events.push(e); return true; },
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    focus: () => posted.push({focus: true}),
    webkit: {messageHandlers: {laolaoWindowControl: {postMessage: (m) => posted.push(m)}}},
    __laolaoSidebar: {gwRequest: (method, params) => { rpc.push({method, params}); return Promise.resolve({ok: true}); }},
    Notification: FakeNotification,
  };
  if (native) window.webkit.messageHandlers.pinkieNotify = {postMessage: (m) => posted.push({native: m})};
  if (runNotify) {
    // laolao-run-notify.js 对外的 decide()，原样拿来（Metre 只借它的判断和开关，不改那个共用文件）
    const ctx = {window: {addEventListener() {}, setTimeout() {}, clearTimeout() {}, location: {href: 'http://x/'}, Pinkie: {}},
      document: {hidden: false, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], title: ''},
      localStorage: {getItem: () => null, setItem() {}}, URL, Map, Set, Date, JSON, Promise, Math, console, CustomEvent: class {}};
    vm.runInNewContext(read('ui/injections/laolao-run-notify.js'), ctx);
    const rn = ctx.window.__pinkieRunNotify;
    window.__pinkieRunNotify = {decide: rn.decide, get prefs() { return rn.prefs; }, notify: notifyPrefs};
  }
  const DateStub = class extends Date { static now() { return clock; } };
  vm.runInNewContext(read(JS), {
    window, document, URL, Map, Set, JSON, Promise, Math, console, Date: DateStub,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
  }, {filename: 'laolao-metre-notify.js'});
  const fire = (event, payload) => (listen.wnd['pinkie:gateway-event'] || []).forEach((f) => f({detail: {event, payload}}));
  const start = (key = BG, runId = 'run-1') => fire('agent', {sessionKey: key, runId, stream: 'lifecycle', data: {phase: 'start'}});
  const final = (key = BG, runId = 'run-1', text = '清单整理好了，放在 docs/release.md。另外补了两条。') =>
    fire('chat', {sessionKey: key, runId, state: 'final', message: {role: 'assistant', content: [{type: 'text', text}]}});
  const flush = () => new Promise((r) => setImmediate(r));
  return {window, document, rpc, events, posted, notes, timers, listen, fire, start, final, flush, tick: (ms) => { clock += ms; },
    unreadPatches: () => rpc.filter((c) => c.method === 'sessions.patch' && c.params.unread === true)};
}

test('a background Metre session finishing while you look at another one: marked unread, nothing else', async () => {
  const h = env();
  h.start(); h.tick(5_000); h.final();
  await h.flush();
  assert.deepEqual(plain(h.unreadPatches().map((c) => c.params)), [{key: BG, agentId: 'metre', unread: true}]);
  assert.ok(h.events.some((e) => e.type === 'laolao:sessions-changed'), 'the sidebar list is told to redraw');
  assert.equal(h.notes.length, 0);
  assert.equal(h.document.title, 'Metre');
  assert.equal(h.posted.filter((m) => m.action === 'attention').length, 0);
});

test('window not visible and the run took over 60 s: one system notification, title mark, taskbar; clicking opens that session', async () => {
  const h = env({hidden: true});
  h.start(); h.tick(61_000); h.final();
  h.final(); // the same run reported twice must not repeat anything
  await h.flush();
  assert.equal(h.unreadPatches().length, 1);
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].title, '整理发布清单');
  assert.equal(h.notes[0].options.body, '清单整理好了，放在 docs/release.md。');
  assert.match(h.document.title, /^✓ Metre$/);
  assert.equal(h.posted.filter((m) => m.action === 'attention').length, 1);
  h.notes[0].onclick();
  const open = h.events.filter((e) => e.type === 'pinkie:open-session-in-mode');
  assert.deepEqual(open.map((e) => e.detail.sessionKey), [BG]);
  // coming back clears the title mark (the sidebar mark goes when the session is opened and marked read)
  h.document.hidden = false;
  h.listen.doc.visibilitychange.forEach((f) => f());
  assert.equal(h.document.title, 'Metre');
});

test('short runs in the background: marked and titled, but no system notification (same 60 s rule as the other modes)', async () => {
  const h = env({hidden: true});
  h.start(); h.tick(10_000); h.final();
  await h.flush();
  assert.equal(h.unreadPatches().length, 1);
  assert.equal(h.notes.length, 0);
  assert.match(h.document.title, /^✓ /);
});

test('the native shell gets the same {title, body, sessionKey} message as the other modes', async () => {
  const h = env({hidden: true, native: true});
  h.start(); h.tick(90_000); h.final();
  await h.flush();
  const sent = h.posted.filter((m) => m.native).map((m) => m.native);
  assert.deepEqual(plain(sent), [{title: '整理发布清单', body: '清单整理好了，放在 docs/release.md。', sessionKey: BG}]);
  assert.equal(h.notes.length, 0, 'no second web notification when the shell handles it');
});

test('an error or abort is reported as not done', async () => {
  const h = env({hidden: true});
  h.start(); h.tick(70_000);
  h.fire('chat', {sessionKey: BG, runId: 'run-1', state: 'error'});
  await h.flush();
  assert.equal(h.notes[0].options.body, 'Metre 这一轮没做完，回来看看');
  assert.match(h.document.title, /^! /);
});

test('lifecycle end without a chat final still settles once after a short wait', async () => {
  const h = env({hidden: true});
  h.start(); h.tick(70_000);
  h.fire('agent', {sessionKey: BG, runId: 'run-1', stream: 'lifecycle', data: {phase: 'end'}});
  assert.equal(h.notes.length, 0, 'waits for the final first');
  h.timers.forEach((f) => f());
  await h.flush();
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].options.body, 'Metre 这一轮做完了');
});

test('a run that ended while offline (pinkie:run-recovered) is reported once', async () => {
  const h = env({hidden: true});
  const detail = {sessionKey: BG, runId: 'run-9', outcome: 'done', text: '都做完了。', startedAt: 1_800_000_000_000 - 120_000};
  h.listen.wnd['pinkie:run-recovered'].forEach((f) => f({detail}));
  h.listen.wnd['pinkie:run-recovered'].forEach((f) => f({detail}));
  await h.flush();
  assert.equal(h.notes.length, 1);
  assert.equal(h.unreadPatches().length, 1);
});

test('looking at that very session: nothing at all', async () => {
  const h = env({current: BG});
  h.start(); h.tick(120_000); h.final();
  await h.flush();
  assert.equal(h.rpc.length, 0);
  assert.equal(h.notes.length, 0);
  assert.equal(h.document.title, 'Metre');
});

test('the notification switch in 设置 → 通知与快捷 is honoured (done off → no system notification)', async () => {
  const h = env({hidden: true, notifyPrefs: {done: false, waiting: true}});
  h.start(); h.tick(120_000); h.final();
  await h.flush();
  assert.equal(h.notes.length, 0);
  assert.equal(h.unreadPatches().length, 1, 'the sidebar mark stays');
});

test('only Metre: other modes and other agents are left to laolao-run-notify', async () => {
  for (const mode of ['chat', 'project', 'thinking', 'learning', 'unrestricted']) {
    const h = env({mode, hidden: true});
    h.start(); h.tick(120_000); h.final();
    await h.flush();
    assert.equal(h.rpc.length + h.notes.length, 0, mode);
  }
  const h = env({hidden: true});
  const other = 'agent:project:dashboard:p1';
  h.start(other); h.tick(120_000); h.final(other);
  h.start('agent:metre:dashboard:x:subagent:1'); h.final('agent:metre:dashboard:x:subagent:1');
  await h.flush();
  assert.equal(h.rpc.length + h.notes.length, 0);
});

test('CSS: one rule, only under Metre, no !important; draws only on an idle dot of an unread row', () => {
  const css = read(CSS).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  assert.doesNotMatch(css, /!important/);
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  assert.deepEqual(selectors, ['html[data-laolao-mode="metre"] aside.sidebar .pk-ml-unread > .pk-ml-dot[data-state="idle"]']);
  assert.match(css, /var\(--metre-accent\)/);
  // the classes it relies on are the ones laolao-metre-list.js writes
  const list = read('ui/injections/laolao-metre-list.js');
  assert.match(list, /classList\.toggle\('pk-ml-unread', Boolean\(s\.unread\)\)/);
  assert.match(list, /dot\.dataset\.state = state \|\| 'idle'/);
});

test('registered once in the head fragment (?v=@hash) and in the metre region; the shared notify file is untouched', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  assert.equal(head.match(/\/laolao-metre-notify\.css\?v=@hash/g)?.length, 1);
  assert.equal(head.match(/\/laolao-metre-notify\.js\?v=@hash/g)?.length, 1);
  const metre = JSON.parse(read('ui/injections/regions.json')).regions.find((r) => r.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-notify.css') && metre.files.includes('laolao-metre-notify.js'));
  assert.match(read('ui/injections/laolao-run-notify.js'), /const SESSION = \/\^agent:\(\?:main\|project\|thinking\|learning\|unrestricted\):\/;/);
  const src = read(JS);
  assert.doesNotMatch(src, /MutationObserver|setInterval|window\.__[a-zA-Z]+\s*=/);
});

// 复发防护（#460 CI 真红）：notify 两行曾插在 metre-list.js 与 S7 worktree 两行中间（拆开 metre-worktree 测试锁的
// 「list → worktree.css → worktree.js」），挪到 worktree.js 后面又拆开了 metre-peek 测试锁的「worktree.js → peek.css → peek.js」。
// 这两段都要求紧挨着，notify 只能排在整条 list → worktree → peek 链之后。
test('head fragment: notify lines sit after the whole list → worktree → peek chain, never inside it', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  assert.match(head, /<script defer src="\/laolao-metre-list\.js\?v=@hash"><\/script>\r?\n<link rel="stylesheet" href="\/laolao-metre-worktree\.css\?v=@hash">\r?\n<script defer src="\/laolao-metre-worktree\.js\?v=@hash"><\/script>\r?\n<link rel="stylesheet" href="\/laolao-metre-peek\.css\?v=@hash">\r?\n<script defer src="\/laolao-metre-peek\.js\?v=@hash"><\/script>\r?\n<link rel="stylesheet" href="\/laolao-metre-notify\.css\?v=@hash">\r?\n<script defer src="\/laolao-metre-notify\.js\?v=@hash"><\/script>/);
});
