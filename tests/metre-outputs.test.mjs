// T3 #23（L35）：Metre 工作台「本会话文件」页（ui/injections/laolao-metre-outputs.js）。
// 用极简假 DOM + 假工作台跑，不起浏览器。复发防护：
//   1. 整段会话里改过的文件只认改文件工具参数里的结构化路径；出错的调用、读文件、正文里的路径、exec 命令都不算；
//      内部消息（子会话简报等）不算新的一轮；最后改的在上面。
//   2. 作品库只取当前会话（sessionKey），和聊天里的同一个文件按路径合并成一行；换会话不带上一个会话的作品。
//   3. 点一行：图片 / PDF 进作品库查看器，改过的进差异视图（项目相对路径），只在作品库里的文本文件开标签。
//   4. 只在 Metre：别的模式状态栏不出键、不开页、不建任何节点、不调网关（反例）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const SRC = read('ui/injections/laolao-metre-outputs.js');
const CSS = read('ui/injections/laolao-metre-outputs.css');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const plain = v => JSON.parse(JSON.stringify(v));   // vm 里造的对象原型不同，转一次再比

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.className = ''; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this.dataset = {}; this.title = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...kids) { for (const k of kids) this.children.push(k); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  fire(t) { for (const f of this.listeners[t] || []) f({stopPropagation() {}, preventDefault() {}}); }
  get text() { return this.textContent + this.children.map(c => c.text).join(''); }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  byClass(c) { return this.all(n => n.className.split(/\s+/).includes(c)); }
  button(label) { return this.all(n => n.tagName === 'BUTTON' && n.text === label)[0] || null; }
}

const t = text => [{type: 'text', text}];
const call = (id, name, args) => ({type: 'toolCall', id, name, arguments: args});
const HISTORY = [
  {role: 'user', content: t('写个 README，再加一张图'), timestamp: 1},
  {role: 'assistant', content: [call('w1', 'write', {path: '/proj/README.md'}), call('r1', 'read', {path: '/proj/src/app.js'}), call('w2', 'write', {path: '/proj/broken.txt'})], timestamp: 2},
  {role: 'toolResult', toolCallId: 'w1', toolName: 'write', content: t('ok'), timestamp: 3},
  {role: 'toolResult', toolCallId: 'r1', toolName: 'read', content: t('x'), timestamp: 4},
  {role: 'toolResult', toolCallId: 'w2', toolName: 'write', isError: true, content: t('EACCES'), timestamp: 5},
  {role: 'assistant', content: [call('x1', 'exec', {command: 'python gen.py > /proj/out.png'}), ...t('写好了 /proj/mention.md')], timestamp: 6},
  {role: 'user', content: t('【子会话简报】子任务做完了'), timestamp: 7},
  {role: 'assistant', content: [call('w3', 'edit', JSON.stringify({path: '/proj/src/app.js', oldText: 'a', newText: 'b'}))], timestamp: 8},
  {role: 'user', content: t('README 再改一下'), timestamp: 9},
  {role: 'assistant', content: [call('w4', 'edit', {file_path: '/proj/README.md'}), call('w5', 'apply_patch', {path: '/proj/README.md'})], timestamp: 10},
  {role: 'user', content: t('谢谢'), timestamp: 11},
  {role: 'assistant', content: t('不客气。'), timestamp: 12},
];
const ARTIFACTS = [
  {id: 'a1', path: '/proj/README.md', kind: 'doc', title: 'README.md', exists: true},
  {id: 'a2', path: '/proj/out.png', kind: 'image', title: 'out.png', exists: true},
  {id: 'a3', path: '/proj/notes.csv', kind: 'sheet', title: 'notes.csv', exists: false},
];

function env({mode = 'metre', history = HISTORY, artifacts = ARTIFACTS, key = 'agent:metre:s1'} = {}) {
  const calls = [], opened = [], viewed = [], winListeners = {};
  let current = mode, created = 0, page = null, box = null;
  const paneEl = {state: {sessionKey: key, chatMessages: history}};
  const draw = () => { if (!page) return; box = new El('div'); page.render(box); };
  const wb = {extraStatus: new Map(), state: {visible: true, active: ''}, renderStatus() {},
    rel: p => (String(p).startsWith('/proj/') ? String(p).slice(6) : String(p)),
    rpc: async (m, p) => { calls.push([m, plain(p)]); return m === 'pinkie.artifacts.list' ? {ok: true, items: (artifacts[p.sessionKey] || (Array.isArray(artifacts) ? artifacts : []))} : {}; },
    open: async (f, o) => { opened.push(['open', f, plain(o)]); },
    diff: async f => { opened.push(['diff', f]); },
    show: async () => true,
    openPage: async (id, title, icon, render) => { page = {id, title, icon, render}; wb.state.active = 'page:' + id; draw(); },
    refreshPage: id => { if (wb.state.active === 'page:' + id) draw(); }};
  const doc = {documentElement: {getAttribute: k => (k === 'data-laolao-mode' ? current : null)},
    createElement: tag => { created++; return new El(tag); }, addEventListener() {},
    querySelector: sel => (/openclaw-chat-pane/.test(sel) ? paneEl : null)};
  const win = {__pinkieWorkbench: wb, PinkieArtifacts: {openViewer: id => viewed.push(id)},
    addEventListener: (type, f) => { (winListeners[type] ||= []).push(f); }};
  vm.runInNewContext(SRC, {window: win, document: doc, location: {search: ''}, URLSearchParams, console});
  const fire = (type, detail) => { for (const f of winListeners[type] || []) f({type, detail}); };
  return {win, wb, calls, opened, viewed, paneEl, fire, box: () => box, page: () => page, created: () => created,
    setMode: m => { current = m; }, api: win.Pinkie.metreOutputs};
}
const rows = box => box.byClass('pk-mout__row').map(r => [r.dataset.path, r.byClass('pk-mout__name')[0].text, r.byClass('pk-mout__dir')[0].text, r.byClass('pk-mout__when')[0].text]);

test('整段会话里改过的文件：只认改文件工具的结构化路径；出错 / 读 / exec / 正文不算；内部消息不算新一轮；最后改的在上面', () => {
  const {api} = env();
  assert.deepEqual(plain(api.sessionOutputs(HISTORY)), [
    {path: '/proj/README.md', edits: 3, turns: [1, 2]},
    {path: '/proj/src/app.js', edits: 1, turns: [1]},
  ]);
  assert.deepEqual(plain(api.sessionOutputs([])), []);
  assert.deepEqual(plain(api.sessionOutputs(null)), []);
  const win = [{role: 'user', content: t('x')}, {role: 'assistant', content: [call('a', 'write', {path: 'F:\\p\\a.txt'}), call('b', 'write', '{bad json'), call('c', 'edit', {path: 'a\nb'})]}];
  assert.deepEqual(plain(api.sessionOutputs(win)), [{path: 'F:/p/a.txt', edits: 1, turns: [1]}], 'Windows 路径换成 /，坏参数和控制字符不算');
});

test('只在 Metre：状态栏一颗「文件 N」，点了开「本会话文件」页，作品库按当前会话取', async () => {
  const e = env();
  const item = e.wb.extraStatus.get('outputs');
  assert.equal(typeof item, 'function');
  const b = item();
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.text, '文件 2', '还没取作品库时，数的是聊天里改过的');
  b.fire('click'); await flush();
  assert.equal(e.page().id, 'outputs');
  assert.equal(e.page().title, '本会话文件');
  assert.deepEqual(e.calls, [['pinkie.artifacts.list', {sessionKey: 'agent:metre:s1', mode: 'all', limit: 200}]]);
  assert.deepEqual(rows(e.box()), [
    ['/proj/README.md', 'README.md', '', '第 2 轮 · 改了 3 次'],
    ['/proj/src/app.js', 'app.js', 'src', '第 1 轮'],
    ['/proj/out.png', 'out.png', '', '作品库'],
    ['/proj/notes.csv', 'notes.csv', '', '作品库 · 原文件已不在'],
  ], '作品库里的 README 和聊天里的合成一行；脚本生成的图片只在作品库里也列出来');
  assert.match(e.box().text, /4 个文件/);
  assert.equal(e.wb.extraStatus.get('outputs')().text, '文件 4');
});

test('点一行：图片进作品库查看器；改过的进差异视图（项目相对路径）；只在作品库里的文本文件开标签', async () => {
  const e = env();
  await e.api.open(); await flush();
  const name = file => e.box().byClass('pk-mout__row').find(r => r.dataset.path === file).byClass('pk-mout__name')[0];
  name('/proj/out.png').fire('click'); await flush();
  name('/proj/README.md').fire('click'); await flush();
  name('/proj/notes.csv').fire('click'); await flush();
  assert.deepEqual(e.viewed, ['a2']);
  assert.deepEqual(plain(e.opened), [['diff', 'README.md'], ['open', 'notes.csv', {pinned: true}]]);
  assert.equal(name('/proj/src/app.js').attrs['aria-label'], '看改动 /proj/src/app.js');
});

test('一轮结束才更新；别的会话的事件不算；换会话不带上一个会话的作品', async () => {
  const e = env({artifacts: {'agent:metre:s1': ARTIFACTS, 'agent:metre:s2': []}});
  await e.api.open(); await flush();
  assert.equal(e.calls.length, 1);
  e.fire('pinkie:gateway-event', {event: 'agent', payload: {sessionKey: 'agent:metre:other', stream: 'lifecycle', data: {phase: 'end'}}});
  e.fire('pinkie:gateway-event', {event: 'agent', payload: {sessionKey: 'agent:metre:s1', stream: 'tool', data: {phase: 'start', name: 'write'}}});
  await flush();
  assert.equal(e.calls.length, 1, '别的会话结束、工具开始都不取');
  e.fire('pinkie:gateway-event', {event: 'agent', payload: {sessionKey: 'agent:metre:s1', stream: 'lifecycle', data: {phase: 'end'}}});
  await flush();
  assert.equal(e.calls.length, 2, '页开着时一轮结束再取一次');
  e.paneEl.state = {sessionKey: 'agent:metre:s2', chatMessages: []};
  e.fire('pinkie:session-selected', {});
  await flush();
  assert.deepEqual(e.calls.at(-1), ['pinkie.artifacts.list', {sessionKey: 'agent:metre:s2', mode: 'all', limit: 200}]);
  assert.deepEqual(rows(e.box()), []);
  assert.match(e.box().text, /这个会话还没有写过或改过文件/);
  assert.equal(e.wb.extraStatus.get('outputs')().text, '文件');
});

test('作品库取不到：说一句，聊天里改过的照样列', async () => {
  const e = env();
  e.wb.rpc = async () => { throw new Error('还没连上网关'); };
  await e.api.open(); await flush();
  assert.match(e.box().text, /作品库没取到.*还没连上网关/);
  assert.deepEqual(rows(e.box()).map(r => r[0]), ['/proj/README.md', '/proj/src/app.js']);
});

test('其他模式一个字不动（反例）：不出键、不开页、不建节点、不调网关', async () => {
  const e = env({mode: 'project'});
  const item = e.wb.extraStatus.get('outputs');
  assert.equal(item(), null);
  assert.equal(await e.api.open(), false);
  e.fire('pinkie:gateway-event', {event: 'agent', payload: {sessionKey: 'agent:metre:s1', stream: 'lifecycle', data: {phase: 'end'}}});
  e.fire('laolao:modechange', {});
  await flush();
  assert.equal(e.page(), null);
  assert.equal(e.calls.length, 0);
  assert.equal(e.created(), 0, '不在 Metre 时一个节点都不建');
  e.setMode('metre');
  assert.equal(item().text, '文件 2', '回到 Metre 照常');
});

test('登记：头片段在 laolao-metre-pr.js 后面、归 metre 区域；不加观察器 / 定时器 / window.__ 全局名 / !important；CSS 只在 Metre', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  const at = name => head.indexOf(`/${name}?v=@hash`);
  assert.ok(at('laolao-metre-outputs.css') > at('laolao-metre-pr.js') && at('laolao-metre-pr.js') > at('laolao-workbench.js'));
  assert.ok(at('laolao-metre-outputs.js') > at('laolao-metre-outputs.css'));
  const regions = JSON.parse(read('ui/injections/regions.json'));
  const metre = Object.values(regions.regions || regions).find(r => r?.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-outputs.js') && metre.files.includes('laolao-metre-outputs.css'));
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setInterval|setTimeout|requestAnimationFrame|MutationObserver|ResizeObserver|IntersectionObserver/);
  assert.doesNotMatch(code, /window\.__\w+\s*=/);
  assert.doesNotMatch(CSS, /!important/);
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.trim().replace(/^@media[^{]*\{\s*/, '')).filter(Boolean);
  assert.ok(rules.length >= 15);
  for (const rule of rules) {
    // 只按顶层逗号切（:is(a, b) 里的逗号不切）
    // 每个选择器都以 Metre 开头，真正被画的那一节（最后一节）是本文件自己的 .pk-mout 类
    for (const sel of rule.split('{')[0].split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean)) {
      assert.match(sel, /^html\[data-laolao-mode="metre"\] /, sel);
      assert.match(sel.replace(/\([^)]*\)/g, '()').split(/\s+[~>+]?\s*/).at(-1), /^\.pk-mout/, sel);
    }
  }
  // 工作台状态栏放不下时 fitStatus 藏「PR」，「文件 N」跟着藏，不留半截（workbench-status-fit-real.test.mjs 在 CI 上抓到的）
  assert.match(CSS, /\.pk-wb-status__item\[data-opt="pr"\]\[style\*="display: none"\] ~ \.pk-mout__status \{ display: none; \}/);
});
