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

// 灵感圆桌：假圆桌服务（同样的合并规则，用 WhiteboardStore 代替 SQLite），看令牌、记成 pinkie、旧 rev 不盖。
async function fakeRoundtable() {
  const http = await import('node:http');
  const store = new WhiteboardStore(tmp()), SESSION = 'ab'.repeat(16), TOKEN = 't'.repeat(43), KEYRT = 'agent:thinking:rt';
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; }).on('end', () => {
      seen.push({path: req.url, token: req.headers['x-roundtable-board'], origin: req.headers.origin});
      const send = (code, v) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(v)); };
      if (req.url !== `/api/sessions/${SESSION}/whiteboard/pinkie` || req.headers['x-roundtable-board'] !== TOKEN) return send(403, {error: '白板令牌不对或已经过期'});
      const data = JSON.parse(body);
      if (data.read === true) return send(200, store.get(KEYRT));
      try { send(200, store.apply(KEYRT, data.ops, 'pinkie')); } catch (e) { send(400, {error: e.message}); }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = {PINKIE_ROUNDTABLE_BOARD: JSON.stringify({url: `http://127.0.0.1:${server.address().port}`, session: SESSION, token: TOKEN})};
  const user = (id, text) => store.apply(KEYRT, [{op: 'put', baseRev: 0, item: {id, kind: 'note', x: 0, y: 0, w: 160, h: 120, text}}], 'user').applied[0];
  return {store, env, seen, user, KEYRT, TOKEN, close: () => new Promise(r => server.close(r))};
}
const call = async (t, params) => { const r = await t.execute('c1', params); if (r.isError) throw new Error(r.content[0].text); return r.details; };

test('灵感圆桌：有 PINKIE_ROUNDTABLE_BOARD 才有工具，走圆桌服务、带白板令牌、记成 pinkie', async () => {
  const rt = await fakeRoundtable();
  try {
    const {tool} = setup();
    // 圆桌每席的会话号是随机的（不是 agent:thinking:*），只有带了这个变量的那一席才有工具
    assert.equal(whiteboardTool(tool, {sessionKey: 'agent:main:roundtable-seat'}, {}), null);
    const t = whiteboardTool(tool, {sessionKey: 'agent:main:roundtable-seat'}, rt.env);
    assert.equal(t.name, TOOL_NAME);
    assert.match(t.description, /这张圆桌的白板/);
    rt.user('u00001', '用户先写的');
    const add = await call(t, {action: 'add_notes', notes: [{text: '碧琪：去山里'}]});
    assert.equal(add.changed.length, 1);
    const read = await call(t, {action: 'read'});
    assert.deepEqual(read.items.map(it => [it.text, it.by]).sort(), [['用户先写的', 'user'], ['碧琪：去山里', 'pinkie']]);
    // 新便签排在用户的右边，不压住
    const mine = read.items.find(it => it.by === 'pinkie'), theirs = read.items.find(it => it.by === 'user');
    assert.ok(mine.x >= theirs.x + theirs.w);
    assert.ok(rt.seen.every(s => s.token === rt.TOKEN && !s.origin));
  } finally { await rt.close(); }
});

test('灵感圆桌反例：用户在她读之后改过的便签不盖，退回 skipped；令牌不对就报错不写', async () => {
  const rt = await fakeRoundtable();
  try {
    const {tool} = setup();
    const t = whiteboardTool(tool, {}, rt.env);
    const first = rt.user('u00001', '原文');
    rt.store.apply(rt.KEYRT, [{op: 'put', baseRev: first.rev, item: {id: 'u00001', kind: 'note', x: 0, y: 0, w: 160, h: 120, text: '用户刚改的'}}], 'user');
    const r = await call(t, {action: 'edit', id: 'u00001', rev: first.rev, text: '碧琪改的'});
    assert.equal(r.changed.length, 0);
    assert.equal(r.skipped[0].text, '用户刚改的');
    assert.equal(rt.store.get(rt.KEYRT).items[0].text, '用户刚改的');
    const bad = whiteboardTool(tool, {}, {PINKIE_ROUNDTABLE_BOARD: rt.env.PINKIE_ROUNDTABLE_BOARD.replace(rt.TOKEN, 'x'.repeat(43))});
    const res = await bad.execute('c2', {action: 'add_notes', notes: [{text: '不该写进去'}]});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /令牌/);
    assert.equal(rt.store.get(rt.KEYRT).items.length, 1);
  } finally { await rt.close(); }
});

test('灵感圆桌反例：不是本机地址、会话号不对、令牌太短、格式坏了都不给远程工具', async () => {
  const {tool} = setup();
  const good = {url: 'http://127.0.0.1:18891', session: 'ab'.repeat(16), token: 't'.repeat(43)};
  for (const bad of [{...good, url: 'http://example.com:18891'}, {...good, url: 'https://127.0.0.1:18891'}, {...good, url: 'http://10.0.0.2:18891'},
    {...good, session: 'agent:thinking:main'}, {...good, token: 'short'}]) {
    assert.equal(whiteboardTool(tool, {sessionKey: 'agent:main:x'}, {PINKIE_ROUNDTABLE_BOARD: JSON.stringify(bad)}), null, JSON.stringify(bad));
  }
  assert.equal(whiteboardTool(tool, {sessionKey: 'agent:main:x'}, {PINKIE_ROUNDTABLE_BOARD: '{not json'}), null);
  // 坏的变量不影响想法模式本来的工具
  assert.equal(whiteboardTool(tool, {sessionKey: KEY}, {PINKIE_ROUNDTABLE_BOARD: '{not json'}).name, TOOL_NAME);
});

test('网关一侧不受影响：界面方法照旧记 user，工具记 pinkie', () => {
  const {store, tool} = setup();
  tool.run(KEY, {action: 'add_notes', notes: [{text: '碧琪的'}]});
  userNote(store, 'u00001');
  const by = Object.fromEntries(store.get(KEY).items.map(it => [it.text, it.by]));
  assert.deepEqual(by, {'碧琪的': 'pinkie', '用户写的': 'user'});
});
