// 新功能第 5 项「PR 一条龙」② 工作台「PR」页（ui/injections/laolao-metre-pr.js）的契约测试。设计：build/quick-run/设计-PR一条龙.md。
// 用极简假 DOM + 假工作台跑：只在 Metre、没准备好给一句话、审查意见点了跳到文件行、跟进只带勾选的、
// 合并按钮灰着时说为什么、点了「合并」要再确认一次（写着号和头）才调 pinkie.pr.merge、不加定时器 / 观察器 / 全局名。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'ui/injections/laolao-metre-pr.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.className = ''; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...kids) { for (const k of kids) this.children.push(k); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  fire(t) { for (const f of this.listeners[t] || []) f({stopPropagation() {}, preventDefault() {}}); }
  get text() { return this.textContent + this.children.map((c) => c.text).join(''); }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  byClass(c) { return this.all((n) => n.className.split(/\s+/).includes(c)); }
  button(label) { return this.all((n) => n.tagName === 'BUTTON' && n.text === label)[0] || null; }
}

function env({mode = 'metre', status, review, merge} = {}) {
  const calls = [], opened = [];
  let page = null, box = null, current = mode;
  const draw = () => { if (!page) return; box = new El('div'); page.render(box); };
  const handlers = {
    'pinkie.pr.status': () => status,
    'pinkie.pr.review': () => review,
    'pinkie.pr.followUp': (p) => ({number: p.number, ...(p.steps.includes('ci') ? {ci: [{name: 'test', bucket: 'pass'}]} : {})}),
    'pinkie.pr.merge': (p) => (merge ? merge(p) : {number: p.number, merged: true, head: 'abc12345ffff'}),
    'pinkie.pr.stop': () => ({stopped: true}),
  };
  const wb = {extraStatus: new Map(), renderStatus() {},
    rpc: async (m, p) => { calls.push([m, JSON.parse(JSON.stringify(p))]); return handlers[m]?.(p); },
    open: (f, o) => { opened.push([f, JSON.parse(JSON.stringify(o))]); }, // vm 里造的对象原型不同，转一次再比
    openPage: async (id, title, icon, render) => { page = {id, title, icon, render}; draw(); },
    refreshPage: (id) => { if (page?.id === id) draw(); }};
  const doc = {documentElement: {getAttribute: (k) => (k === 'data-laolao-mode' ? current : null)}, createElement: (t) => new El(t), addEventListener() {}};
  const win = {__pinkieWorkbench: wb};
  vm.runInNewContext(SRC, {window: win, document: doc, console});
  return {win, wb, calls, opened, box: () => box, page: () => page, setMode: (m) => { current = m; }};
}

const GREEN = [{name: 'CI', conclusion: 'SUCCESS'}, {name: 'Code health', conclusion: 'SUCCESS'}];
const PR = {number: 7, title: '加一个按钮', state: 'OPEN', isDraft: false, headRefName: 'feat/button', baseRefName: 'main', headRefOid: 'abc12345ffff', statusCheckRollup: GREEN};
const READY = {ready: true, why: '', current: PR, recent: [{number: 7, title: '加一个按钮', headRefName: 'feat/button', isDraft: false}], progress: null};

test('只在 Metre：状态栏挂一颗「PR」，不在 Metre 不出；点了开「PR」页并取状态', async () => {
  const e = env({status: READY});
  const item = e.wb.extraStatus.get('pr');
  assert.equal(typeof item, 'function');
  e.setMode('project');
  assert.equal(item(), null, '不在 Metre 不出');
  await e.win.Pinkie.metrePr.open();
  assert.equal(e.page(), null, '不在 Metre 不开页');
  e.setMode('metre');
  const b = item();
  assert.equal(b.tagName, 'BUTTON'); assert.match(b.text, /PR/);
  b.fire('click'); await flush();
  assert.equal(e.page().id, 'pr');
  assert.deepEqual(e.calls.map((c) => c[0]), ['pinkie.pr.status']);
  assert.match(e.box().text, /feat\/button → main · 头 abc12345 · CI：2 \/ 2 通过/);
});

test('没准备好（不是仓库 / 没登录 gh）只给一句话，没有审查 / 跟进 / 合并', async () => {
  const e = env({status: {ready: false, why: '本机 gh 还没登录：在终端里跑 gh auth login。', progress: null}});
  await e.win.Pinkie.metrePr.open(); await flush();
  assert.match(e.box().text, /gh auth login/);
  assert.equal(e.box().button('合并'), null);
  assert.equal(e.box().button('让引擎审查'), null);
});

test('合并按钮灰着时说为什么：没有 PR / 不是打开的 / 草稿 / CI 没结果 / CI 没全绿；全绿才能点', () => {
  const {mergeBlock} = env().win.Pinkie.metrePr;
  assert.match(mergeBlock(null), /还没有 PR/);
  assert.match(mergeBlock({...PR, state: 'MERGED'}), /不是打开的/);
  assert.match(mergeBlock({...PR, isDraft: true}), /草稿/);
  assert.match(mergeBlock({...PR, statusCheckRollup: []}), /还没有结果/);
  assert.match(mergeBlock({...PR, statusCheckRollup: [GREEN[0], {name: 'x', conclusion: 'FAILURE'}]}), /没全绿/);
  assert.match(mergeBlock({...PR, statusCheckRollup: [{name: 'x', state: 'PENDING'}]}), /没全绿/);
  assert.equal(mergeBlock(PR), '');
});

test('CI 没绿：合并按钮 disabled 并写原因，点了也不调 pinkie.pr.merge', async () => {
  const e = env({status: {...READY, current: {...PR, statusCheckRollup: [{name: 'CI', conclusion: 'FAILURE'}]}}});
  await e.win.Pinkie.metrePr.open(); await flush();
  const m = e.box().button('合并');
  assert.equal(m.disabled, true);
  assert.match(e.box().text, /CI 还没全绿/);
  assert.ok(!e.calls.some((c) => c[0] === 'pinkie.pr.merge'));
});

test('点「合并」先在页里再确认一次（写着号和头），确认才调 pinkie.pr.merge 且 confirm=<号>@<头>；取消不调', async () => {
  const e = env({status: READY});
  await e.win.Pinkie.metrePr.open(); await flush();
  e.box().button('合并').fire('click'); await flush();
  assert.ok(!e.calls.some((c) => c[0] === 'pinkie.pr.merge'), '点「合并」本身不合并');
  assert.match(e.box().text, /把 #7 合并进 main？头 abc12345/);
  e.box().button('取消').fire('click'); await flush();
  assert.ok(!e.calls.some((c) => c[0] === 'pinkie.pr.merge'), '取消不合并');
  e.box().button('合并').fire('click'); await flush();
  e.box().button('确认合并').fire('click'); await flush();
  const merges = e.calls.filter((c) => c[0] === 'pinkie.pr.merge');
  assert.deepEqual(merges, [['pinkie.pr.merge', {number: 7, confirm: '7@abc12345ffff'}]]);
  assert.match(e.box().text, /#7 已合并（头 abc12345）/);
});

test('审查：意见列出，高的默认勾上；点文件在工作台打开并跳到行；跟进只带勾选的意见', async () => {
  const findings = [
    {severity: 'high', file: 'src/a.js', line: 12, title: '会崩', detail: 'x 没定义'},
    {severity: 'low', file: 'README.md', line: 0, title: '错别字', detail: ''},
  ];
  const e = env({status: READY, review: {number: 7, head: PR.headRefOid, findings}});
  await e.win.Pinkie.metrePr.open(); await flush();
  e.box().button('让引擎审查').fire('click'); await flush();
  assert.deepEqual(e.calls.find((c) => c[0] === 'pinkie.pr.review')[1], {number: 7});
  const rows = e.box().byClass('pk-mpr__finding');
  assert.equal(rows.length, 2);
  assert.match(rows[0].text, /高.*src\/a\.js:12.*会崩/);
  assert.deepEqual(rows.map((r) => r.all((n) => n.tagName === 'INPUT')[0].checked), [true, false]);
  e.box().button('src/a.js:12').fire('click');
  assert.deepEqual(e.opened, [['src/a.js', {line: 12}]]);
  const fix = e.box().byClass('pk-mpr__step').find((s) => /按选中的意见改/.test(s.text)).all((n) => n.tagName === 'INPUT')[0];
  fix.checked = true; fix.fire('change'); await flush();
  e.box().button('开始跟进').fire('click'); await flush();
  const f = e.calls.find((c) => c[0] === 'pinkie.pr.followUp')[1];
  assert.deepEqual([...f.steps].sort(), ['ci', 'fix']);
  assert.deepEqual(f.findings.map((x) => x.title), ['会崩'], '只带勾选的意见');
  assert.equal(f.confirm, undefined, '没勾回评论就不带确认');
});

test('回评论：勾了才出正文框，正文和确认一起交给后端；跟进不合并', async () => {
  const e = env({status: READY});
  await e.win.Pinkie.metrePr.open(); await flush();
  assert.equal(e.box().all((n) => n.tagName === 'TEXTAREA').length, 0);
  const reply = e.box().byClass('pk-mpr__step').find((s) => /回一条评论/.test(s.text)).all((n) => n.tagName === 'INPUT')[0];
  reply.checked = true; reply.fire('change'); await flush();
  const ta = e.box().all((n) => n.tagName === 'TEXTAREA')[0];
  ta.value = '改好了，麻烦再看一眼'; ta.fire('input');
  e.box().button('开始跟进').fire('click'); await flush();
  const f = e.calls.find((c) => c[0] === 'pinkie.pr.followUp')[1];
  assert.equal(f.body, '改好了，麻烦再看一眼'); assert.equal(f.confirm, true);
  assert.ok(!e.calls.some((c) => c[0] === 'pinkie.pr.merge'), '跟进不合并');
});

test('推送：勾了才带 push，结果写新头、等 CI；不合并', async () => {
  const e = env({status: READY});
  const orig = e.wb.rpc;
  e.wb.rpc = async (m, p) => {
    if (m !== 'pinkie.pr.followUp') return orig(m, p);
    e.calls.push([m, JSON.parse(JSON.stringify(p))]);
    return {number: p.number, push: {pushed: true, head: 'def67890aaaa'}};
  };
  await e.win.Pinkie.metrePr.open(); await flush();
  const push = e.box().byClass('pk-mpr__step').find((s) => /推送到 PR 分支（不强推/.test(s.text)).all((n) => n.tagName === 'INPUT')[0];
  assert.equal(push.checked, false, '默认不勾推送');
  push.checked = true; push.fire('change'); await flush();
  e.box().button('开始跟进').fire('click'); await flush();
  const f = e.calls.find((c) => c[0] === 'pinkie.pr.followUp')[1];
  assert.deepEqual([...f.steps].sort(), ['ci', 'push']);
  assert.match(e.box().text, /已推到 PR 分支（头 def67890），等 CI/);
  assert.ok(!e.calls.some((c) => c[0] === 'pinkie.pr.merge'));
});

test('不新增定时器、观察器和 window.__ 全局名；界面不出现 Claude / OpenClaw / Copilot', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setInterval|setTimeout|requestAnimationFrame|MutationObserver|ResizeObserver|IntersectionObserver/);
  assert.doesNotMatch(code, /window\.__(?!pinkieWorkbench)/);
  assert.doesNotMatch(SRC, /Claude|OpenClaw|Copilot/i);
});
