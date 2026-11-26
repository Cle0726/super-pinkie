import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WhiteboardStore, registerWhiteboard, boardAllowed, cleanItem} from '../services/mode-architecture/whiteboard-store.mjs';

const KEY = 'agent:thinking:main';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-'));
const note = (id, extra = {}) => ({id, kind: 'note', x: 10, y: 20, w: 160, h: 120, text: '想法', ...extra});
const put = (item, baseRev = 0) => ({op: 'put', baseRev, item});

test('前提：只有想法模式的会话能开白板', () => {
  assert.equal(boardAllowed(KEY), true);
  for (const key of ['agent:main:main', 'agent:metre:main', 'agent:learning:main', 'agent:project:main', '', 'thinking']) {
    assert.equal(boardAllowed(key), false, key);
  }
  const store = new WhiteboardStore(tmp());
  assert.throws(() => store.get('agent:metre:main'), /不能开白板/);
  assert.throws(() => store.apply('agent:main:main', [put(note('n00001'))], 'user'), /不能开白板/);
});

test('便签、方框、笔迹、连线：写进去、重开还在', () => {
  const root = tmp(), store = new WhiteboardStore(root);
  const r = store.apply(KEY, [
    put(note('n00001')),
    put({id: 'b00001', kind: 'box', x: 0, y: 0, w: 400, h: 300, label: '分组一'}),
    put({id: 'i00001', kind: 'ink', points: [[1, 2], [3.04, 4.06], [5, 6]], width: 2}),
    put({id: 'l00001', kind: 'link', from: 'n00001', to: 'b00001', label: ''}),
  ], 'user');
  assert.equal(r.applied.length, 4);
  assert.deepEqual(r.conflicts, []);
  const again = new WhiteboardStore(root).get(KEY);
  assert.equal(again.rev, 4);
  assert.deepEqual(again.items.map(it => it.id).sort(), ['b00001', 'i00001', 'l00001', 'n00001']);
  assert.deepEqual(again.items.find(it => it.id === 'i00001').points[1], [3, 4.1]);
  assert.ok(again.items.every(it => it.by === 'user' && Number.isInteger(it.rev)));
});

test('同时改：不同元素都生效；同一元素后到的不覆盖先到的（反例：去掉版本检查这条会红）', () => {
  const store = new WhiteboardStore(tmp());
  store.apply(KEY, [put(note('n00001')), put(note('n00002'))], 'user');
  const seen = Object.fromEntries(store.get(KEY).items.map(it => [it.id, it.rev]));
  // 用户和碧琪都拿着同一份快照
  const a = store.apply(KEY, [put(note('n00001', {text: '用户改的'}), seen.n00001)], 'user');
  const b = store.apply(KEY, [put(note('n00002', {text: '碧琪改的'}), seen.n00002)], 'pinkie');
  assert.equal(a.applied.length, 1);
  assert.equal(b.applied.length, 1);
  const late = store.apply(KEY, [put(note('n00001', {text: '碧琪也改这张'}), seen.n00001)], 'pinkie');
  assert.equal(late.applied.length, 0);
  assert.equal(late.conflicts.length, 1);
  assert.equal(late.conflicts[0].text, '用户改的');
  const now = Object.fromEntries(store.get(KEY).items.map(it => [it.id, it]));
  assert.equal(now.n00001.text, '用户改的');
  assert.equal(now.n00001.by, 'user');
  assert.equal(now.n00002.text, '碧琪改的');
  assert.equal(now.n00002.by, 'pinkie');
  // 新建撞了已有编号也算冲突，不覆盖
  const clash = store.apply(KEY, [put(note('n00002', {text: '重名'}), 0)], 'user');
  assert.equal(clash.applied.length, 0);
  assert.equal(store.get(KEY).items.find(it => it.id === 'n00002').text, '碧琪改的');
});

test('删除留墓碑给轮询；一头被删的连线跟着删', () => {
  const store = new WhiteboardStore(tmp());
  store.apply(KEY, [put(note('n00001')), put(note('n00002')), put({id: 'l00001', kind: 'link', from: 'n00001', to: 'n00002'})], 'user');
  const before = store.get(KEY).rev;
  const n1 = store.get(KEY).items.find(it => it.id === 'n00001');
  const r = store.apply(KEY, [{op: 'del', id: 'n00001', baseRev: n1.rev}], 'pinkie');
  assert.deepEqual(r.applied.map(it => [it.id, it.deleted]).sort(), [['l00001', true], ['n00001', true]]);
  assert.deepEqual(store.get(KEY).items.map(it => it.id), ['n00002']);
  const delta = store.get(KEY, before);
  assert.deepEqual(delta.items.map(it => it.id).sort(), ['l00001', 'n00001']);
  assert.ok(delta.items.every(it => it.deleted && it.by === 'pinkie'));
  // 连线连到不存在的元素：放进去立刻被删
  const dangling = store.apply(KEY, [put({id: 'l00002', kind: 'link', from: 'n00002', to: 'nope0001'})], 'user');
  assert.equal(store.get(KEY).items.some(it => it.id === 'l00002'), false);
  assert.ok(dangling.applied.some(it => it.id === 'l00002' && it.deleted));
});

test('反例：格式不对整批不写', () => {
  const store = new WhiteboardStore(tmp());
  for (const bad of [
    {id: 'x', kind: 'note', x: 0, y: 0, w: 100, h: 100},
    {id: 'n00001', kind: 'image', x: 0, y: 0, w: 100, h: 100},
    {id: 'n00001', kind: 'note', x: Infinity, y: 0, w: 100, h: 100},
    {id: 'n00001', kind: 'note', x: 0, y: 0, w: 2, h: 100},
    {id: 'n00001', kind: 'note', x: 0, y: 0, w: 100, h: 100, text: 'x'.repeat(2001)},
    {id: 'i00001', kind: 'ink', points: [[1, 2]]},
    {id: 'l00001', kind: 'link', from: 'n00001', to: 'n00001'},
  ]) assert.throws(() => cleanItem(bad), Error, JSON.stringify(bad).slice(0, 60));
  assert.throws(() => store.apply(KEY, [put(note('n00001')), put({id: 'bad', kind: 'note'})], 'user'));
  assert.deepEqual(store.get(KEY).items, []);
  assert.throws(() => store.apply(KEY, [{op: 'put', item: note('n00001')}], 'user'), /版本号/);
  assert.throws(() => store.apply(KEY, [put(note('n00001'))], 'someone'), /是谁/);
  assert.throws(() => store.apply(KEY, [], 'user'), /条数/);
  assert.equal(fs.existsSync(store.dir), false);
});

test('网关方法：界面改动一律记成 user，客户端送 by / actor 不认', async () => {
  const methods = {};
  const api = {registerGatewayMethod: (name, fn) => { methods[name] = fn; }};
  registerWhiteboard(api, {root: tmp()});
  assert.deepEqual(Object.keys(methods).sort(), ['pinkie.whiteboard.apply', 'pinkie.whiteboard.get']);
  const call = (name, params) => new Promise(resolve => methods[name]({params, respond: (ok, value, error) => resolve({ok, value, error})}));
  const r = await call('pinkie.whiteboard.apply', {key: KEY, actor: 'pinkie', ops: [put(note('n00001', {by: 'pinkie', rev: 99}))]});
  assert.equal(r.ok, true);
  assert.equal(r.value.applied[0].by, 'user');
  assert.equal(r.value.applied[0].rev, 1);
  const g = await call('pinkie.whiteboard.get', {key: KEY});
  assert.equal(g.value.items[0].by, 'user');
  const no = await call('pinkie.whiteboard.get', {key: 'agent:metre:main'});
  assert.equal(no.ok, false);
  assert.match(no.error.message, /不能开白板/);
});
