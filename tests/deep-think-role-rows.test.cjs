// P6（重复代码合一，不改行为）：深思状态面板 renderRoleDetails 的行为锁。
// 角色循环里原来手写了一遍「找已有行，没有就建一行」，和同函数里的 ensureRow 逐句相同；
// 合成一个之前先把行为钉住：行的顺序、文字、复用同一个节点（不重建）、多余的行删掉、
// 补位重试那一行。直接取 ui/injections/laolao-deep-think.js 里真实的 setText / renderRoleDetails 来跑，
// 合并前后这个文件里的用例都应该是绿的。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-deep-think.js'), 'utf8');
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return source.slice(start, end);
};
const ROLE = 'laolao-deep-think-status__role';
const RETRY = 'laolao-deep-think-status__retry';

class Node {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.className = ''; this.dataset = {}; this.children = []; this.parent = null; this._text = ''; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  set textContent(v) { this.children = []; this._text = String(v); this.writes = (this.writes || 0) + 1; }
  get firstElementChild() { return this.children[0] || null; }
  append(...nodes) { for (const n of nodes) { n.parent?.children.splice(n.parent.children.indexOf(n), 1); n.parent = this; this.children.push(n); } }
  prepend(n) { n.parent?.children.splice(n.parent.children.indexOf(n), 1); n.parent = this; this.children.unshift(n); }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  querySelectorAll(sel) { const cls = sel.replace(/^\./, ''); const out = []; const walk = (n) => { for (const c of n.children) { if (c.className.split(' ').includes(cls)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function load() {
  const created = [];
  const document = {createElement: (tag) => { const n = new Node(tag); created.push(n); return n; }};
  const code = `(() => { ${between('const setText = ', 'const renderRoleDetails = ')} ${between('const renderRoleDetails = ', '\n  };\n') + '\n  };'} return renderRoleDetails; })()`;
  const render = vm.runInNewContext(code, {document, Map, Set, Array, Number, String}, {filename: 'laolao-deep-think.js'});
  return {render, created};
}

const rows = (details) => details.children.map((row) => row.className === RETRY
  ? ['retry', row.textContent]
  : [row.dataset.role, row.children[0].textContent, row.children[1].textContent]);

const WORKFLOW = {kindLabel: '网页', label: '深度研究', stages: [{label: '检索', used: true}, {label: '核对', used: false}]};

test('流程行在前、角色行按顺序跟上，文字照原样', () => {
  const {render} = load();
  const details = new Node('div');
  render(details, [{role: 'writer', label: '写手', completed: 1, required: 2, pending: 1}, {label: '审稿', completed: 5, required: 3}], 0, WORKFLOW);
  assert.deepEqual(rows(details), [
    ['workflow-kind', '活儿种类', '网页'],
    ['workflow-route', '本次流程', '深度研究'],
    ['workflow-stages', '已用 / 待用', '检索 / 核对'],
    ['writer', '写手', '1/2 · 1 进行中'],
    ['审稿', '审稿', '3/3'],
  ]);
});

test('再渲染一次：同 key 复用原来的节点，不重建、不重写没变的文字', () => {
  const {render, created} = load();
  const details = new Node('div');
  const roles = [{role: 'writer', label: '写手', completed: 0, required: 2}, {role: 'checker', label: '核对', completed: 0, required: 1}];
  render(details, roles, 0, WORKFLOW);
  const before = [...details.children];
  const made = created.length;
  const writes = before.map((row) => row.children.map((c) => c.writes));
  render(details, roles, 0, WORKFLOW);
  assert.equal(created.length, made, '第二次不应再建节点');
  assert.deepEqual(details.children, before, '还是原来那几个节点、原来的顺序');
  assert.deepEqual(before.map((row) => row.children.map((c) => c.writes)), writes, '文字没变就不写');
  render(details, [{role: 'writer', label: '写手', completed: 2, required: 2}, roles[1]], 0, WORKFLOW);
  assert.equal(created.length, made);
  assert.equal(details.children[3], before[3]);
  assert.equal(details.children[3].children[1].textContent, '2/2');
});

test('角色或流程没了就删对应的行；新角色追加在后面', () => {
  const {render} = load();
  const details = new Node('div');
  render(details, [{role: 'a', completed: 0, required: 1}, {role: 'b', completed: 0, required: 1}], 0, WORKFLOW);
  const b = details.children.find((row) => row.dataset.role === 'b');
  render(details, [{role: 'b', completed: 1, required: 1}, {role: 'c', completed: 0, required: 4}], 0, {label: '深度研究', stages: []});
  assert.deepEqual(rows(details), [
    ['workflow-route', '本次流程', '深度研究'],
    ['workflow-stages', '已用 / 待用', '无 / 无'],
    ['b', 'b', '1/1'],
    ['c', 'c', '0/4'],
  ]);
  assert.equal(details.children[2], b, '留下的角色还是原节点');
  render(details, [], 0, null);
  assert.deepEqual(rows(details), []);
});

test('种类和流程名一样只显示一行；种类行总在最前', () => {
  const {render} = load();
  const details = new Node('div');
  render(details, [{role: 'x', completed: 0, required: 1}], 0, null);
  render(details, [{role: 'x', completed: 0, required: 1}], 0, {kindLabel: 'PPT', label: 'PPT', stages: [{label: '排版', used: true}]});
  assert.deepEqual(rows(details), [
    ['workflow-kind', '活儿种类', 'PPT'],
    ['x', 'x', '0/1'],
    ['workflow-stages', '已用 / 待用', '排版 / 无'],
  ]);
});

test('没有 role / label 的角色记成「协作」；补位重试行出现、更新、消失', () => {
  const {render} = load();
  const details = new Node('div');
  render(details, [{completed: 'x', required: '2'}], 2, null);
  assert.deepEqual(rows(details), [['协作', '协作', '0/2'], ['retry', '2 项已自动补位重试']]);
  const retry = details.children[1];
  render(details, [{completed: 1, required: 2}], 3, null);
  assert.equal(details.children[1], retry);
  assert.equal(retry.textContent, '3 项已自动补位重试');
  render(details, [{completed: 1, required: 2}], 0, null);
  assert.deepEqual(rows(details), [['协作', '协作', '1/2']]);
});
