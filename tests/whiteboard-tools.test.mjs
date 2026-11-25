import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WhiteboardStore} from '../services/mode-architecture/whiteboard-store.mjs';
import {WhiteboardTool, registerWhiteboardTool, whiteboardTool, TOOL_NAME} from '../services/mode-architecture/whiteboard-tools.mjs';

const KEY = 'agent:thinking:main';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-tool-'));
const setup = () => { const store = new WhiteboardStore(tmp()); return {store, tool: new WhiteboardTool(store)}; };
const userNote = (store, id, extra = {}) => store.apply(KEY, [{op: 'put', baseRev: 0, item: {id, kind: 'note', x: 0, y: 0, w: 160, h: 120, text: '用户写的', ...extra}}], 'user').applied[0];

test('前提：只有想法模式的会话拿得到这个工具', () => {
  const tool = setup().tool;
  assert.equal(whiteboardTool(tool, {sessionKey: KEY}).name, TOOL_NAME);
  for (const key of ['agent:main:main', 'agent:metre:main', 'agent:learning:main', 'agent:project:main', '']) {
    assert.equal(whiteboardTool(tool, {sessionKey: key}), null, key);
  }
  assert.throws(() => tool.run('agent:main:main', {action: 'read'}), /不能开白板/);
  const names = [];
  registerWhiteboardTool({registerTool: (fn, opts) => names.push(opts.name)}, {root: tmp()});
  assert.deepEqual(names, [TOOL_NAME]);
});

test('碧琪加便签、收组、连线：都记成 pinkie，新便签不压住用户的', () => {
  const {store, tool} = setup();
  userNote(store, 'u00001', {x: 0, y: 0, w: 300, h: 200});
  const add = tool.run(KEY, {action: 'add_notes', notes: [{text: '方向一'}, {text: '方向二', color: 'sky'}, {text: '方向三'}]});
  assert.equal(add.changed.length, 3);
  assert.ok(add.changed.every(it => it.by === 'pinkie' && it.kind === 'note' && it.x >= 300));
  assert.equal(add.changed[1].color, 'sky');
  const [a, b, c] = add.changed;
  const g = tool.run(KEY, {action: 'group', label: '先做的', items: [{id: a.id, rev: a.rev}, {id: b.id, rev: b.rev}]});
  const box = g.changed.find(it => it.kind === 'box');
  assert.equal(box.label, '先做的');
  assert.ok(g.changed.filter(it => it.kind === 'note').every(it => it.group === box.id && it.x >= box.x && it.x + it.w <= box.x + box.w && it.y + it.h <= box.y + box.h));
  const l = tool.run(KEY, {action: 'link', from: box.id, to: c.id, label: '然后'});
  assert.equal(l.changed[0].kind, 'link');
  const read = tool.run(KEY, {action: 'read'});
  assert.equal(read.count, 6);
  assert.equal(read.items.find(it => it.id === 'u00001').by, 'user');
  assert.equal(read.items.filter(it => it.by === 'pinkie').length, 5);
});

test('反例：用户刚改过的元素，碧琪拿旧 rev 改 / 收 / 删都不动它', () => {
  const {store, tool} = setup();
  const n = userNote(store, 'u00001');
  const seen = tool.run(KEY, {action: 'read'}).items[0];
  assert.equal(seen.rev, n.rev);
  // 碧琪读完以后，用户改了这张
  store.apply(KEY, [{op: 'put', baseRev: n.rev, item: {id: 'u00001', kind: 'note', x: 0, y: 0, w: 160, h: 120, text: '用户刚改'}}], 'user');
  for (const params of [
    {action: 'edit', id: 'u00001', rev: seen.rev, text: '碧琪改'},
    {action: 'delete', items: [{id: 'u00001', rev: seen.rev}]},
    {action: 'group', label: 'x', items: [{id: 'u00001', rev: seen.rev}]},
  ]) {
    const r = tool.run(KEY, params);
    assert.equal(r.skipped?.[0]?.id, 'u00001', params.action);
    assert.equal(r.skipped[0].text, '用户刚改');
  }
  const now = store.get(KEY).items.find(it => it.id === 'u00001');
  assert.equal(now.text, '用户刚改');
  assert.equal(now.by, 'user');
  assert.equal(now.group, undefined);
  // 拿新 rev 才改得动
  const fresh = tool.run(KEY, {action: 'edit', id: 'u00001', rev: now.rev, text: '碧琪补一句'});
  assert.equal(fresh.changed[0].text, '碧琪补一句');
  assert.equal(fresh.changed[0].by, 'pinkie');
});

test('反例：格式不对就报错，不写', () => {
  const {store, tool} = setup();
  userNote(store, 'u00001');
  const before = store.get(KEY).rev;
  for (const params of [
    {action: 'add_notes', notes: []},
    {action: 'add_notes', notes: Array.from({length: 31}, () => ({text: 'x'}))},
    {action: 'delete', items: [{id: 'u00001'}]},
    {action: 'edit', id: 'u00001', rev: 1},
    {action: 'link', from: 'u00001', to: 'nope0001'},
    {action: 'fly'},
  ]) assert.throws(() => tool.run(KEY, params), Error, params.action);
  assert.equal(store.get(KEY).rev, before);
});

test('网关一侧不受影响：界面方法照旧记 user，工具记 pinkie', () => {
  const {store, tool} = setup();
  tool.run(KEY, {action: 'add_notes', notes: [{text: '碧琪的'}]});
  userNote(store, 'u00001');
  const by = Object.fromEntries(store.get(KEY).items.map(it => [it.text, it.by]));
  assert.deepEqual(by, {'碧琪的': 'pinkie', '用户写的': 'user'});
});
