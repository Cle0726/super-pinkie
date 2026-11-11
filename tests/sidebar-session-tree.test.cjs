const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const window = {addEventListener() {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-session-list.js'), 'utf8'), {window, setInterval() {}});
const build = (rows, options) => JSON.parse(JSON.stringify(window.PinkieSessionList.buildTree(rows, options)));
const parent = 'agent:main:parent', child = 'agent:main:pinkie-child:child';
const worker = 'agent:main:subagent:worker';
const row = (key, label, values = {}) => ({key, label, lastMessagePreview: '会话记录', ...values});

test('child and deep-thinking workers stay grouped under the parent with role names', () => {
  const tree = build([
    row(parent, '项目检查'),
    row(child, '独立验证', {lineage: {parentKey: parent, detached: false}}),
    row(worker, '求解·1', {spawnedBy: parent}),
    row(worker + '-2', '批评·2', {parentSessionKey: parent}),
    row(worker + '-3', '仲裁', {spawnedBy: worker}),
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].session.key, parent);
  assert.equal(tree[0].children[0].session.key, child);
  assert.deepEqual(tree[0].workers.map(row => row.label), ['求解·1', '批评·2', '仲裁']);
});

test('detaching puts a child at the top, and an archived parent hides its attached children', () => {
  const root = row(parent, '项目检查', {archived: true});
  const attached = row(child, '独立验证', {lineage: {parentKey: parent}, parentArchived: true});
  assert.equal(build([attached]).length, 0);
  assert.equal(build([root, attached], {archive: true})[0].children.length, 1);
  assert.equal(build([row(child, '独立验证', {lineage: {parentKey: parent, detached: true}})])[0].session.key, child);
});

test('blank and internal sessions stay out of the active list except for the current blank session', () => {
  const empty = row('agent:main:empty', 'C.le.console · 新会话', {lastMessagePreview: undefined});
  const mystery = row('agent:main:unknown', '[pinkie-watchdog] 续跑');
  const internal = row('agent:main:another', '记录内容', {meta: {internal: true}});
  assert.equal(build([empty, mystery, internal]).length, 0);
  assert.equal(build([empty, mystery, internal], {currentKey: empty.key})[0].session.key, empty.key);
  assert.equal(build([mystery, internal], {archive: true, query: '后台记录'}).length, 2);
});

test('search can find a child or a worker by name without making workers normal results', () => {
  const rows = [row(parent, '项目检查'), row(child, '独立验证', {parentSessionKey: parent}),
    row(worker, '仲裁', {parentSessionKey: parent})];
  assert.equal(build(rows, {query: '独立验证'})[0].children[0].session.key, child);
  assert.equal(build(rows, {query: '项目检查'})[0].workers.length, 0);
  assert.equal(build(rows, {query: '仲裁'})[0].workers[0].key, worker);
  assert.equal(build(rows, {query: 'worker'}).length, 0);
});

test('run state takes precedence over waiting and terminal errors', () => {
  const {sessionStatus} = window.PinkieSessionList;
  assert.equal(sessionStatus({hasActiveRun: true, phase: 'error'}), 'running');
  assert.equal(sessionStatus({hasActiveSubagentRun: true, phase: 'waiting'}), 'running');
  assert.equal(sessionStatus({phase: 'waiting'}), 'waiting');
  assert.equal(sessionStatus({status: 'failed'}), 'error');
  assert.equal(sessionStatus({status: 'aborted'}), '');
});
