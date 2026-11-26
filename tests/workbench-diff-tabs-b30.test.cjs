// B30（backlog，uireview #218 记）：工作台差异标签「README.md（上次提交 ↔ 现在）」整串放在一个 span 里一起截，
// 窄的时候连文件名都被截掉；标签多到挤出标签栏时也没有任何提示，看不出右边还有标签。
// 改法：差异标签拆成文件名（不缩）+ 比较说明（先缩、带省略号），全称在 title；标签栏溢出时被挤出的一头淡出，
// 并露出「全部标签」键，点开列出所有标签。
// 这里从源码取出真的 renderTabs() / updateTabsOverflow()，用一个很小的假 DOM 跑。
// 反例：把拆分那一行换回原来的整串标签，文件名和说明又回到同一个 span；把溢出判断去掉，挤出去时没有提示。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui/injections/laolao-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui/injections/laolao-workbench.css'), 'utf8');
const slice = (start, end) => { const i = source.indexOf(start); assert.ok(i >= 0, `源码里找不到 ${start}`); const j = source.indexOf(end, i); assert.ok(j > i, `源码里找不到 ${end}`); return source.slice(i, j); };
const overflowFn = slice('  function updateTabsOverflow() {', '  tabsList.addEventListener(');
const renderFn = slice('  function renderTabs() {', '  function renderCrumbs() {');

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.title = ''; this.textContent = ''; this.hidden = false; this.className = ''; this.scrollWidth = 0; this.clientWidth = 0; this.scrollLeft = 0;
    const self = this; this.classList = {toggle(c, on) { const s = new Set(self.className.split(' ').filter(Boolean)); if (on === undefined) on = !s.has(c); on ? s.add(c) : s.delete(c); self.className = [...s].join(' '); }, add(c) { this.toggle(c, true); }, contains(c) { return self.className.split(' ').includes(c); }}; }
  append(...n) { this.children.push(...n.filter(Boolean)); }
  replaceChildren(...n) { this.children = []; for (const x of n) x && x.tag === '#frag' ? this.children.push(...x.children) : x && this.children.push(x); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
  querySelector() { return null; }
}

function run(tabs, active, transform = (s) => s) {
  const tabsList = new Node('div'), tabsMore = new Node('button'), tabsBar = new Node('div'), tabsActions = new Node('div');
  tabsMore.hidden = true;
  const el = (tag, cls, text) => { const n = new Node(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ctx = {
    state: {tabs, active, git: null, panelOpen: false}, tabsList, tabsMore, tabsBar, tabsActions, actTerminal: new Node('button'),
    el, icon: (name, cls) => el('i', 'codicon codicon-' + name + (cls ? ' ' + cls : '')), fileIcon: () => el('i', 'file'),
    button: (name, title, _fn, cls = 'pk-wb-icon') => { const b = el('button', cls); b.title = title; return b; },
    keyLabel: (k) => k, absolute: (p) => '/root/' + p, fileLocation: (p) => ({relative: p, name: p}), dirname: (p) => p.split('/').slice(0, -1).join('/'),
    closeTab() {}, activate() {}, pinTab() {}, showMenu() {}, openDiff() {}, previewInBrowser() {},
    findTab: (p) => tabs.find((t) => t.path === p), window: {__pinkieWorkbench: {}},
    document: {createDocumentFragment: () => new Node('#frag')},
  };
  vm.runInNewContext(transform(overflowFn + renderFn) + '\nrenderTabs();', ctx);
  return ctx;
}
const spans = (tabNode) => tabNode.children.filter((c) => c.tag === 'span').map((c) => ({cls: c.className, text: c.textContent}));

const DIFFS = [
  {path: 'diff:README.md', name: 'README.md（上次提交 ↔ 现在）', title: 'README.md（上次提交 ↔ 现在）', kind: 'diff', pinned: true, source: 'README.md'},
  {path: 'diff:disk:src/a.js', name: 'a.js（磁盘 ↔ 我的）', title: 'a.js（磁盘 ↔ 我的）', kind: 'diff', pinned: true, source: 'src/a.js'},
];

test('B30 差异标签：文件名和比较说明分开放，全称在 title', () => {
  const ctx = run([...DIFFS, {path: 'src/b.js', name: 'b.js', kind: 'text', pinned: true}], 'diff:README.md');
  const [readme, disk, plain] = ctx.tabsList.children;
  assert.deepEqual(spans(readme), [{cls: 'pk-wb-tab__label', text: 'README.md'}, {cls: 'pk-wb-tab__vs', text: '上次提交 ↔ 现在'}]);
  assert.equal(readme.title, 'README.md（上次提交 ↔ 现在）');
  assert.ok(readme.classList.contains('is-diff'));
  assert.deepEqual(spans(disk), [{cls: 'pk-wb-tab__label', text: 'a.js'}, {cls: 'pk-wb-tab__vs', text: '磁盘 ↔ 我的'}]);
  // 普通文件标签不受影响
  assert.deepEqual(spans(plain), [{cls: 'pk-wb-tab__label', text: 'b.js'}]);
  assert.ok(!plain.classList.contains('is-diff'));
});

test('B30 反例：换回整串标签，文件名和说明又挤在同一个 span 里', () => {
  const ctx = run(DIFFS.slice(0, 1), 'diff:README.md', (s) => s.replace("/^(.*?)（(.+)）$/.exec(tab.title || '')", 'null'));
  assert.deepEqual(spans(ctx.tabsList.children[0]), [{cls: 'pk-wb-tab__label', text: 'README.md（上次提交 ↔ 现在）'}]);
});

test('B30 CSS：文件名不缩，比较说明先缩、带省略号', () => {
  assert.match(css, /\.pk-wb-tab\.is-diff \.pk-wb-tab__label \{[^}]*flex: none/);
  assert.match(css, /\.pk-wb-tab__vs \{[^}]*min-width: 0[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.pk-wb-tabs__list\.is-clip-start \{ --pk-fs: 28px; \}/);
  assert.match(css, /\.pk-wb-tabs__list\.is-clip-end \{ --pk-fe: 28px; \}/);
  assert.match(css, /\.pk-wb-tabs__list\.is-clip-start, \.pk-wb-tabs__list\.is-clip-end \{[^}]*(?<!-webkit-)mask-image: linear-gradient\(to right, transparent, #000 var\(--pk-fs, 0px\), #000 calc\(100% - var\(--pk-fe, 0px\)\), transparent\)/);
  assert.match(css, /\.pk-wb-tabs__more\[hidden\] \{ display: none; \}/);
});

function overflowState(scrollWidth, clientWidth, scrollLeft, transform) {
  const tabs = [{path: 'a.js', name: 'a.js', kind: 'text', pinned: true}];
  const ctx = run(tabs, 'a.js', transform);
  Object.assign(ctx.tabsList, {scrollWidth, clientWidth, scrollLeft});
  vm.runInNewContext('updateTabsOverflow();', ctx);
  return {start: ctx.tabsList.classList.contains('is-clip-start'), end: ctx.tabsList.classList.contains('is-clip-end'), more: !ctx.tabsMore.hidden};
}

test('B30 标签栏溢出：被挤出的一头淡出，并露出「全部标签」键', () => {
  assert.deepEqual(overflowState(400, 400, 0), {start: false, end: false, more: false}, '没溢出：不淡出、不出键');
  assert.deepEqual(overflowState(900, 400, 0), {start: false, end: true, more: true}, '在最左：右边淡出');
  assert.deepEqual(overflowState(900, 400, 250), {start: true, end: true, more: true}, '在中间：两头淡出');
  assert.deepEqual(overflowState(900, 400, 500), {start: true, end: false, more: true}, '滚到最右：左边淡出');
});

test('B30 反例：去掉溢出判断，挤出去时没有任何提示', () => {
  const s = overflowState(900, 400, 0, (src) => src.replace('tabsList.scrollWidth - tabsList.clientWidth > 1', 'false'));
  assert.deepEqual(s, {start: false, end: false, more: false});
});
