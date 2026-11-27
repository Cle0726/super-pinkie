// T3 #22（L34）：Metre 引擎台「改动」面板里的提交 / 开 PR 按钮（ui/injections/laolao-metre-ship.js）的契约测试。
// 极简假 DOM + 假网关在 vm 里跑，不起浏览器：只在 Metre、面板开着才读状态；不能点的按钮灰着并写原因；
// 「提交…」「开 PR…」点了只出确认框，不调网关；「取消」什么都不做；「确认」才调，并把 status 给的 token 原样带回；
// 不加定时器 / 观察器 / window.__ 全局名（发现面板走共用的 Pinkie.domWatch.watch）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'ui/injections/laolao-metre-ship.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

class El {
  constructor(tag) { Object.assign(this, {tagName: tag.toUpperCase(), className: '', children: [], attrs: {}, listeners: {}, own: '', parentElement: null, disabled: false, hidden: false, value: '', checked: false}); }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.own = String(v); this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) { k.remove(); k.parentElement = this; this.children.push(k); } }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; } }
  replaceChildren(...kids) { for (const c of this.children) c.parentElement = null; this.children = []; this.append(...kids); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  fire(t) { for (const f of this.listeners[t] || []) f({preventDefault() {}, stopPropagation() {}}); }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  byClass(c) { return this.all((n) => String(n.className).split(/\s+/).includes(c)); }
  querySelector(sel) { return sel.startsWith('.') ? this.byClass(sel.slice(1))[0] || null : null; }
  button(label) { return this.all((n) => n.tagName === 'BUTTON' && n.textContent === label)[0] || null; }
  tag(name) { return this.all((n) => n.tagName === name.toUpperCase()); }
}

const HEAD = 'abc1234def5678abc1234def5678abc1234def56';
const DIRTY = {ready: true, why: '', folder: '/proj', busy: false, branch: 'feat/x', head: HEAD, remote: true, pr: null,
  files: [{status: 'M', file: 'src/a.js'}, {status: '??', file: 'notes.md'}],
  canCommit: true, commitWhy: '', commitToken: 'commit@0123456789abcdef', canPr: false, prWhy: '还有没提交的改动，先提交。', prToken: ''};
const CLEAN = {...DIRTY, files: [], canCommit: false, commitWhy: '没有要提交的改动。', commitToken: '', canPr: true, prWhy: '', prToken: `pr@feat/x@${HEAD}`};

function env({mode = 'metre', session = 'agent:metre:ship', status = DIRTY, commit, openPr} = {}) {
  const calls = [];
  let watcher = null, current = mode, statusCalls = 0;
  const handlers = {
    'pinkie.engines.ship.status': () => (typeof status === 'function' ? status(statusCalls++) : status),
    'pinkie.engines.ship.commit': (p) => (commit ? commit(p) : {committed: true, head: 'f00dfeed1234', files: 2}),
    'pinkie.engines.ship.openPr': (p) => (openPr ? openPr(p) : {opened: true, url: 'https://example.test/pull/9', draft: p.draft !== false}),
  };
  const win = {
    location: {href: 'http://pinkie.test/chat?session=' + encodeURIComponent(session)},
    __laolaoSidebar: {gwRequest: async (m, p) => { calls.push([m, JSON.parse(JSON.stringify(p))]); const r = handlers[m]?.(p); if (r instanceof Error) throw r; return r; }},
    Pinkie: {domWatch: {watch: (sel, fn, opts) => { watcher = {sel, fn, opts}; return {disconnect() {}}; }}},
  };
  const doc = {documentElement: {getAttribute: (k) => (k === 'data-laolao-mode' ? current : null)}, createElement: (t) => new El(t), addEventListener() {}};
  vm.runInNewContext(SRC, {window: win, document: doc, URL, console});
  const drawer = new El('aside');
  drawer.className = 'pk-eng-drawer';
  const sum = new El('span');
  sum.className = 'pk-eng-drawer__sum';
  sum.textContent = '2 个文件';
  drawer.append(sum);
  const kick = async () => { watcher.fn([drawer]); await flush(); };
  const bar = () => drawer.byClass('pk-ship')[0] || null;
  const shipCalls = (m) => calls.filter((c) => c[0] === m);
  return {win, calls, shipCalls, drawer, sum, kick, bar, watcher: () => watcher, setMode: (m) => { current = m; }};
}

test('只在 Metre：用共用观察器找面板；不在 Metre / 不是 Metre 会话不加按钮、不读状态', async () => {
  const e = env();
  assert.equal(e.watcher().sel, '.pk-eng-drawer');
  assert.equal(e.watcher().opts.immediate, true);
  assert.equal(typeof e.win.Pinkie.metre.ship.decorate, 'function');
  const off = env({mode: 'project'});
  await off.kick();
  assert.equal(off.bar(), null);
  assert.deepEqual(off.calls, []);
  const other = env({session: 'agent:project:x'});
  await other.kick();
  assert.equal(other.bar(), null);
  assert.deepEqual(other.calls, []);
  await e.kick();
  assert.ok(e.bar());
  e.setMode('project');
  await e.kick();
  assert.equal(e.bar(), null, '切出 Metre 就拿掉');
});

test('面板关着不读；打开读一次；同一会话文件数没变不重复读，变了再读', async () => {
  const e = env();
  e.drawer.hidden = true;
  await e.kick();
  assert.deepEqual(e.shipCalls('pinkie.engines.ship.status'), []);
  e.drawer.hidden = false;
  await e.kick();
  await e.kick();
  assert.deepEqual(e.shipCalls('pinkie.engines.ship.status'), [['pinkie.engines.ship.status', {sessionKey: 'agent:metre:ship'}]]);
  e.sum.textContent = '3 个文件';
  await e.kick();
  assert.equal(e.shipCalls('pinkie.engines.ship.status').length, 2);
});

test('不能点的按钮灰着，下面写为什么', async () => {
  const e = env();
  await e.kick();
  const bar = e.bar();
  assert.equal(bar.button('提交…').disabled, false);
  assert.equal(bar.button('开 PR…').disabled, true);
  assert.match(bar.textContent, /开 PR：还有没提交的改动，先提交。/);
  assert.match(bar.textContent, /feat\/x · 2 个文件没提交/);
  const c = env({status: CLEAN});
  await c.kick();
  assert.equal(c.bar().button('提交…').disabled, true);
  assert.match(c.bar().textContent, /提交：没有要提交的改动。/);
  const no = env({status: {...DIRTY, ready: false, why: '这个文件夹不是 git 仓库。'}});
  await no.kick();
  assert.equal(no.bar().button('提交…'), null);
  assert.match(no.bar().textContent, /不是 git 仓库/);
  const bad = env({status: new Error('外部引擎还没打开')});
  await bad.kick();
  assert.match(bad.bar().textContent, /读不到 git 状态：外部引擎还没打开/);
});

test('提交：点「提交…」只出确认框（写着几个文件、哪个分支），不调网关；取消也不调；灰着时硬点也不出', async () => {
  const e = env();
  await e.kick();
  e.bar().button('提交…').fire('click');
  await flush();
  assert.deepEqual(e.shipCalls('pinkie.engines.ship.commit'), []);
  assert.match(e.bar().textContent, /把这 2 个文件提交到 feat\/x？/);
  assert.match(e.bar().textContent, /M src\/a\.js/);
  assert.equal(e.bar().button('确认提交').disabled, true, '没写说明不能确认');
  e.bar().button('取消').fire('click');
  await flush();
  assert.equal(e.bar().button('确认提交'), null);
  assert.deepEqual(e.shipCalls('pinkie.engines.ship.commit'), []);
  const c = env({status: CLEAN});
  await c.kick();
  c.bar().button('提交…').fire('click');
  await flush();
  assert.equal(c.bar().button('确认提交'), null);
});

test('提交：写了说明、点「确认提交」才调 commit，confirm 是 status 给的 token；完了重读状态并写结果', async () => {
  const e = env({status: (n) => (n === 0 ? DIRTY : CLEAN)});
  await e.kick();
  e.bar().button('提交…').fire('click');
  await flush();
  const msg = e.bar().tag('textarea')[0];
  msg.value = '修好登录按钮';
  msg.fire('input');
  assert.equal(e.bar().button('确认提交').disabled, false);
  e.bar().button('确认提交').fire('click');
  await flush();
  assert.deepEqual(e.shipCalls('pinkie.engines.ship.commit'), [['pinkie.engines.ship.commit', {sessionKey: 'agent:metre:ship', message: '修好登录按钮', confirm: 'commit@0123456789abcdef'}]]);
  assert.equal(e.shipCalls('pinkie.engines.ship.status').length, 2);
  assert.match(e.bar().textContent, /已提交 f00dfeed（2 个文件）。/);
  assert.equal(e.bar().button('开 PR…').disabled, false);
  const conflict = env({commit: () => Object.assign(new Error('改动变了或没确认，重新看一眼再提交。'), {code: 'CONFLICT'})});
  await conflict.kick();
  conflict.bar().button('提交…').fire('click');
  const m2 = conflict.bar().tag('textarea')[0];
  m2.value = 'x'; m2.fire('input');
  conflict.bar().button('确认提交').fire('click');
  await flush();
  assert.match(conflict.bar().textContent, /没提交：改动变了或没确认/);
});

test('开 PR：点「开 PR…」只出确认框（写着推哪个分支、不强推、不合并）；填标题、点「确认开 PR」才调，默认草稿、带 prToken；结果给链接', async () => {
  const e = env({status: CLEAN});
  await e.kick();
  e.bar().button('开 PR…').fire('click');
  await flush();
  assert.deepEqual(e.shipCalls('pinkie.engines.ship.openPr'), []);
  assert.match(e.bar().textContent, /把 feat\/x 推到 origin（普通推送，不强推），再开一个 PR？不会合并。/);
  assert.equal(e.bar().button('确认开 PR').disabled, true, '没标题不能确认');
  const title = e.bar().tag('input').find((n) => n.type === 'text');
  title.value = '登录按钮'; title.fire('input');
  const body = e.bar().tag('textarea')[0];
  body.value = '改了颜色'; body.fire('input');
  assert.equal(e.bar().tag('input').find((n) => n.type === 'checkbox').checked, true, '默认开成草稿');
  e.bar().button('确认开 PR').fire('click');
  await flush();
  assert.deepEqual(e.shipCalls('pinkie.engines.ship.openPr'), [['pinkie.engines.ship.openPr', {sessionKey: 'agent:metre:ship', title: '登录按钮', body: '改了颜色', draft: true, confirm: `pr@feat/x@${HEAD}`}]]);
  const link = e.bar().tag('a')[0];
  assert.equal(link.href, 'https://example.test/pull/9');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.match(e.bar().textContent, /已开草稿 PR：/);
  const off = env({status: CLEAN});
  await off.kick();
  off.bar().button('开 PR…').fire('click');
  const t2 = off.bar().tag('input').find((n) => n.type === 'text');
  t2.value = 'x'; t2.fire('input');
  const box = off.bar().tag('input').find((n) => n.type === 'checkbox');
  box.checked = false; box.fire('change');
  off.bar().button('取消').fire('click');
  await flush();
  assert.deepEqual(off.shipCalls('pinkie.engines.ship.openPr'), [], '取消不开');
});

test('不加定时器、观察器、window.__ 全局名；不调合并', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setInterval|setTimeout|MutationObserver|requestAnimationFrame/);
  assert.doesNotMatch(code, /\bwindow\s*\.\s*__[\w$]+\s*=(?!=)/);
  assert.doesNotMatch(code, /pr\.merge|ship\.merge/);
});
