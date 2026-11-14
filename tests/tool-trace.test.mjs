// PLAN 2.8「创建」的判定和 2.9 读图小框的后端（services/mode-architecture/tool-trace.mjs）：
// A3-1 写不存在的文件 → created；A3-5 工具读图后有记录；A3-6 换一个进程（重开）还在；
// A3-7 没被工具读过的路径取不到；A3-8 图片被删 → exists:false；A3-9 Windows 路径、中文文件名。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Writable} from 'node:stream';
import {ToolTraceStore, imageCandidates, registerToolTrace, resolveToolPath, serveToolImage} from '../services/mode-architecture/tool-trace.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tool-trace-'));
const KEY = 'agent:metre:t1';

function fakeRes() {
  const chunks = [];
  const res = new Writable({write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); }});
  res.headers = {};
  res.statusCode = 0;
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  const end = res.end.bind(res);
  res.end = (...args) => { end(...args); return res; };
  res.body = () => Buffer.concat(chunks);
  res.done = new Promise((resolve) => res.on('finish', resolve));
  return res;
}
async function get(store, url) {
  const res = fakeRes();
  serveToolImage(store, {url, method: 'GET', headers: {}}, res);
  await res.done;
  return res;
}

test('A3-1: a write to a missing file is a create, overwriting is a write (every mode)', () => {
  const dir = tmp();
  const store = new ToolTraceStore({root: path.join(dir, 'state')});
  fs.writeFileSync(path.join(dir, 'old.txt'), 'x');
  for (const agent of ['main', 'project', 'thinking', 'learning', 'unrestricted', 'metre']) {
    const ctx = {sessionKey: `agent:${agent}:s`};
    assert.equal(store.beforeTool({toolName: 'write', toolCallId: agent + '-new', params: {path: path.join(dir, 'new.txt')}}, ctx).created, true, agent);
    assert.equal(store.beforeTool({toolName: 'write', toolCallId: agent + '-old', params: {path: 'old.txt'}}, ctx, [dir]).created, false, agent);
    store.afterTool({toolName: 'write', toolCallId: agent + '-new', params: {path: path.join(dir, 'new.txt')}, result: {}}, ctx);
    const calls = store.list(ctx.sessionKey).calls;
    assert.equal(calls[agent + '-new'].created, true);
    assert.equal(calls[agent + '-new'].name, 'new.txt');
    assert.equal(calls[agent + '-old'].created, false);
  }
});

test('a failed write is not reported as created; other tools are not checked', () => {
  const dir = tmp();
  const store = new ToolTraceStore({root: path.join(dir, 'state')});
  const ctx = {sessionKey: KEY};
  store.beforeTool({toolName: 'write', toolCallId: 'w1', params: {path: path.join(dir, 'never.txt')}}, ctx);
  store.afterTool({toolName: 'write', toolCallId: 'w1', error: 'EACCES'}, ctx);
  assert.equal(store.list(KEY).calls.w1.created, false);
  assert.equal(store.beforeTool({toolName: 'edit', toolCallId: 'e1', params: {path: path.join(dir, 'x')}}, ctx), null);
  assert.equal(store.beforeTool({toolName: 'write', toolCallId: '', params: {path: path.join(dir, 'x')}}, ctx), null, 'no call id → cannot pair with the UI row, skip');
  assert.equal(store.beforeTool({toolName: 'write', toolCallId: 'w2', params: {path: 'rel.txt'}}, ctx), null, 'relative path with no base → unknown, no guess');
});

test('image candidates: read, image tool, screenshots (details.path), MEDIA lines', () => {
  assert.deepEqual(imageCandidates('read', {path: 'a.png'}), ['a.png']);
  assert.deepEqual(imageCandidates('read', {path: 'a.md'}), []);
  assert.deepEqual(imageCandidates('image', {image: 'a.jpg', images: ['b.webp', 'https://x/c.png']}), ['a.jpg', 'b.webp', 'https://x/c.png']);
  assert.deepEqual(imageCandidates('browser', {action: 'screenshot'}, {content: [{type: 'image', data: ''}], details: {path: '/tmp/shot.png', media: {mediaUrl: '/tmp/shot.png'}}}), ['/tmp/shot.png']);
  assert.deepEqual(imageCandidates('exec', {}, {content: [{type: 'text', text: 'done\nMEDIA: C:\\out\\图.png\n'}]}), ['C:\\out\\图.png']);
});

test('A3-5/A3-6/A3-7: recorded images are served; nothing else is, also after a restart', async () => {
  const dir = tmp();
  const root = path.join(dir, 'state');
  const shot = path.join(dir, '截图 1.png');
  const secret = path.join(dir, 'secret.png');
  fs.writeFileSync(shot, PNG);
  fs.writeFileSync(secret, PNG);
  const store = new ToolTraceStore({root});
  store.afterTool({toolName: 'read', toolCallId: 'r1', params: {path: shot}, result: {content: [{type: 'image'}]}}, {sessionKey: KEY});
  const listed = store.list(KEY).calls.r1.images;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, '截图 1.png');
  assert.equal(listed[0].exists, true);
  assert.doesNotMatch(JSON.stringify(store.list(KEY)), /secret|截图 1\.png"[^}]*path/, 'the UI gets a URL, never a path');
  const ok = await get(store, listed[0].url);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'image/png');
  assert.deepEqual(ok.body(), PNG);

  // 重开（新进程 = 新 store，同一个状态目录）
  const reopened = new ToolTraceStore({root});
  const again = reopened.list(KEY).calls.r1.images[0];
  assert.equal(again.url, listed[0].url);
  assert.equal((await get(reopened, again.url)).statusCode, 200);

  // 越权：换 key、换编号、塞路径、别的会话、目录穿越 —— 全部 404
  const [, sessionPart, imageId] = /\/pinkie-tool-image\/([0-9a-f]+)\/([0-9a-f]+)\?key=/.exec(listed[0].url);
  const bad = [
    listed[0].url.replace(/key=[0-9a-f]+/, 'key=' + '0'.repeat(32)),
    `/pinkie-tool-image/${sessionPart}/${'0'.repeat(16)}?key=${/key=([0-9a-f]+)/.exec(listed[0].url)[1]}`,
    `/pinkie-tool-image/${sessionPart}/${imageId}`,
    '/pinkie-tool-image/' + encodeURIComponent(secret),
    `/pinkie-tool-image/${sessionPart}/..%2F..%2Fsecret.png?key=x`,
    `/pinkie-tool-image/${'f'.repeat(24)}/${imageId}?key=${/key=([0-9a-f]+)/.exec(listed[0].url)[1]}`,
  ];
  for (const url of bad) assert.equal((await get(reopened, url)).statusCode, 404, url);
  assert.deepEqual(new ToolTraceStore({root}).list('agent:project:other').calls, {}, 'another session sees nothing');
});

test('only images the tool really touched are recorded (no files outside the call, no non-images)', () => {
  const dir = tmp();
  const store = new ToolTraceStore({root: path.join(dir, 'state')});
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'fake.png.txt'), 'x');
  store.afterTool({toolName: 'read', toolCallId: 'r1', params: {path: path.join(dir, 'a.txt')}, result: {}}, {sessionKey: KEY});
  store.afterTool({toolName: 'read', toolCallId: 'r2', params: {path: path.join(dir, 'missing.png')}, result: {}}, {sessionKey: KEY});
  store.afterTool({toolName: 'read', toolCallId: 'r3', params: {path: path.join(dir, 'x.png')}, error: 'ENOENT'}, {sessionKey: KEY});
  store.afterTool({toolName: 'image', toolCallId: 'r4', params: {image: 'https://example.com/a.png'}, result: {}}, {sessionKey: KEY});
  assert.deepEqual(store.list(KEY).calls, {});
});

test('A3-8: an image deleted later is listed as gone and is not served', async () => {
  const dir = tmp();
  const file = path.join(dir, 'shot.png');
  fs.writeFileSync(file, PNG);
  const store = new ToolTraceStore({root: path.join(dir, 'state')});
  store.afterTool({toolName: 'browser', toolCallId: 'b1', params: {action: 'screenshot'}, result: {details: {path: file}}}, {sessionKey: KEY});
  fs.rmSync(file);
  const img = store.list(KEY).calls.b1.images[0];
  assert.equal(img.exists, false);
  assert.equal((await get(store, img.url)).statusCode, 404);
});

test('A3-9: Windows paths — drive letters, backslashes, Chinese names, relative to the workspace', () => {
  const dir = tmp();
  const sub = path.join(dir, '图片 文件夹');
  fs.mkdirSync(sub);
  const file = path.join(sub, '中文 截图.png');
  fs.writeFileSync(file, PNG);
  const store = new ToolTraceStore({root: path.join(dir, 'state')});
  const rel = '图片 文件夹\\中文 截图.png';
  if (process.platform === 'win32') {
    assert.equal(resolveToolPath(rel, [dir]), file);
    assert.equal(resolveToolPath(file.replace(/\\/g, '/'), []), file);
    assert.equal(resolveToolPath('file:///' + file.replace(/\\/g, '/'), []), file);
    assert.match(resolveToolPath('C:\\Users\\x\\a.png'), /^C:\\Users\\x\\a\.png$/);
    store.afterTool({toolName: 'read', toolCallId: 'w1', params: {path: rel}, result: {}}, {sessionKey: KEY}, [dir]);
  } else {
    store.afterTool({toolName: 'read', toolCallId: 'w1', params: {path: file}, result: {}}, {sessionKey: KEY});
  }
  assert.equal(store.list(KEY).calls.w1.images[0].name, '中文 截图.png');
  assert.equal(store.beforeTool({toolName: 'write', toolCallId: 'w2', params: {path: '图片 文件夹\\新 文件.txt'}}, {sessionKey: KEY}, [dir]).created, true);
  assert.equal(store.beforeTool({toolName: 'write', toolCallId: 'w3', params: {path: process.platform === 'win32' ? rel : file}}, {sessionKey: KEY}, [dir]).created, false);
});

test('registerToolTrace wires the hooks, the read-only gateway method and the image route', () => {
  const hooks = {}, methods = {}, routes = [];
  const api = {
    on: (name, fn, opts) => { (hooks[name] ||= []).push({fn, opts}); },
    registerGatewayMethod: (name, fn, opts) => { methods[name] = {fn, opts}; },
    registerHttpRoute: (route) => routes.push(route),
  };
  const dir = tmp();
  registerToolTrace(api, {root: path.join(dir, 'state'), baseFor: () => dir});
  assert.equal(hooks.before_tool_call.length, 1);
  assert.ok(hooks.before_tool_call[0].opts.priority < -12000, 'runs after the guards, so a blocked write is never recorded');
  assert.equal(hooks.after_tool_call.length, 1);
  assert.equal(methods['pinkie.toolTrace.list'].opts.scope, 'operator.read');
  assert.equal(routes[0].path, '/pinkie-tool-image/');
  assert.equal(routes[0].auth, 'plugin');
  // before_tool_call never blocks or rewrites
  assert.equal(hooks.before_tool_call[0].fn({toolName: 'write', toolCallId: 'x', params: {path: 'a.txt'}}, {sessionKey: KEY}), undefined);
  let answer;
  methods['pinkie.toolTrace.list'].fn({params: {sessionKey: KEY}, respond: (ok, value) => { answer = {ok, value}; }});
  assert.equal(answer.ok, true);
  assert.equal(answer.value.calls.x.created, true);
  methods['pinkie.toolTrace.list'].fn({params: {sessionKey: '../etc'}, respond: (ok) => { answer = {ok}; }});
  assert.equal(answer.ok, false);
});

test('index.mjs registers the tool trace', () => {
  const src = fs.readFileSync(new URL('../services/mode-architecture/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{registerToolTrace\} from '\.\/tool-trace\.mjs';/);
  assert.match(src, /registerToolTrace\(api, \{root: path\.join\(pinkieStateRoot\(\), 'tool-trace'\)/);
});
