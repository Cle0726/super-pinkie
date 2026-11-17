import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WebGptRunner, batchWakeText, composeImagePrompt, createWebGptTool, resolveOutputDir, safeSubfolder} from '../services/mode-architecture/web-gpt.mjs';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2048, 1)]);

// A stand-in for the App socket: every job finishes on its second status poll.
function fakeApp({fail = () => '', reply = 'ok'} = {}) {
  const jobs = new Map();
  const calls = [];
  const overlaps = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-gpt-app-'));
  const request = async (action, params) => {
    calls.push({action, ...params});
    if (action === 'gpt_web_account') return {ok: true, result: {loggedIn: true, plan: 'plus'}};
    if (action === 'gpt_web_start') {
      const job = randomUUID();
      if ([...jobs.values()].some(record => !record.finished)) overlaps.push(job);
      jobs.set(job, {params, polls: 0});
      return {ok: true, result: {job, phase: 'loading'}};
    }
    if (action === 'gpt_web_status') {
      const record = jobs.get(params.job);
      record.polls += 1;
      if (record.polls < 2) return {ok: true, result: {job: params.job, phase: 'waiting', detail: 'ChatGPT 正在出图'}};
      record.finished = true;
      const error = fail(record.params);
      if (error) return {ok: true, result: {job: params.job, phase: 'failed', error}};
      const files = [];
      if (record.params.kind === 'image') {
        const dir = path.join(tmp, 'pinkie-gpt-web', params.job);
        fs.mkdirSync(dir, {recursive: true});
        files.push(path.join(dir, 'image-1.png'));
        fs.writeFileSync(files[0], png);
      }
      return {ok: true, result: {job: params.job, phase: 'done', reply, files, conversationUrl: 'https://chatgpt.com/c/abc'}};
    }
    if (action === 'gpt_web_cancel') return {ok: true, result: {cancelled: true}};
    return {ok: false, reason: 'unknown'};
  };
  return {request, calls, overlaps, cleanup: () => fs.rmSync(tmp, {recursive: true, force: true})};
}

function freshState() { delete globalThis[Symbol.for('pinkie.webGpt.v1')]; }

test('image prompt carries style, aspect and a do-not-ask line', () => {
  const prompt = composeImagePrompt({prompt: '一只猫坐在窗台', style: '水彩', aspect: '竖'});
  assert.match(prompt, /^水彩/);
  assert.match(prompt, /竖版 9:16/);
  assert.match(prompt, /直接生成图片/);
});

test('output folder stays in an ordinary folder inside home', () => {
  const home = '/Users/someone';
  const date = new Date('2026-11-17T08:00:00Z');
  assert.equal(resolveOutputDir({home, date, sessionKey: 'agent:main:x'}), '/Users/someone/Documents/碧琪出图/2026-11-17');
  assert.equal(resolveOutputDir({home, date, sessionKey: 'agent:metre:x'}), '/Users/someone/Documents/Metre 出图/2026-11-17');
  assert.equal(resolveOutputDir({home, date, project: '/Users/someone/shop'}), '/Users/someone/shop/出图/2026-11-17');
  assert.equal(resolveOutputDir({home, outDir: '分镜/第1集', project: '/Users/someone/drama'}), '/Users/someone/drama/分镜/第1集');
  assert.throws(() => resolveOutputDir({home, outDir: '/etc'}), /用户目录/);
  assert.throws(() => resolveOutputDir({home, outDir: '~/.openclaw/x'}), /隐藏目录/);
  assert.throws(() => resolveOutputDir({home, outDir: '~/Library/x'}), /Library/);
  assert.throws(() => resolveOutputDir({home, outDir: '../../etc', project: '/Users/someone/p'}), /用户目录/);
});

test('ask waits for the reply and continue reuses the same web conversation', async t => {
  freshState();
  const app = fakeApp({reply: '答案是 42'});
  t.after(app.cleanup);
  const runner = new WebGptRunner({request: app.request, pollMs: 1, track: () => null});
  const first = await runner.ask({sessionKey: 'agent:main:s', question: '问题'});
  assert.equal(first.reply, '答案是 42');
  await runner.ask({sessionKey: 'agent:main:s', question: '追问', continueChat: true});
  const starts = app.calls.filter(call => call.action === 'gpt_web_start');
  assert.equal(starts[0].conversationUrl, undefined);
  assert.equal(starts[1].conversationUrl, 'https://chatgpt.com/c/abc');
  assert.equal(starts[1].kind, 'ask');
});

test('a batch runs one image at a time, names files and writes a record', async t => {
  freshState();
  const app = fakeApp();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web-gpt-out-'));
  t.after(() => { app.cleanup(); fs.rmSync(out, {recursive: true, force: true}); });
  let watched;
  const runner = new WebGptRunner({request: app.request, pollMs: 1, track: job => (watched = job)});
  const batch = runner.startBatch({
    sessionKey: 'agent:main:s', outDir: out, style: '统一画风', aspect: '方', refs: ['/tmp/role.png'],
    items: [{prompt: '第一张', name: '封面'}, {prompt: '第二张', count: 2}],
  });
  assert.equal(batch.tasks.length, 3);
  assert.equal(watched.isRunning(), true);
  while (watched.isRunning()) await new Promise(resolve => setTimeout(resolve, 5));
  const names = fs.readdirSync(out).sort();
  assert.deepEqual(names.filter(name => name.endsWith('.png')), ['02-1.png', '02-2.png', '封面.png']);
  assert.ok(names.some(name => name.startsWith('出图记录-')));
  const starts = app.calls.filter(call => call.action === 'gpt_web_start');
  assert.equal(starts.length, 3);
  assert.ok(starts.every(call => call.kind === 'image' && call.refs[0] === '/tmp/role.png' && /统一画风/.test(call.prompt)));
  // Only one job is ever in flight on the single web page.
  assert.deepEqual(app.overlaps, []);
  const wake = batchWakeText(batch);
  assert.match(wake, /成功 3 张/);
  assert.match(wake, /用户看不到/);
});

test('a usage-limit reply stops the rest of the batch instead of retrying', async t => {
  freshState();
  const app = fakeApp({fail: () => '你已达到图片生成上限，请稍后再试'});
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web-gpt-out-'));
  t.after(() => { app.cleanup(); fs.rmSync(out, {recursive: true, force: true}); });
  let watched;
  const runner = new WebGptRunner({request: app.request, pollMs: 1, track: job => (watched = job)});
  const batch = runner.startBatch({sessionKey: 'agent:main:s', outDir: out, items: [{prompt: 'a'}, {prompt: 'b'}, {prompt: 'c'}]});
  while (watched.isRunning()) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(app.calls.filter(call => call.action === 'gpt_web_start').length, 1);
  assert.equal(batch.limited, true);
  assert.match(batchWakeText(batch), /上限/);
});

test('the tool refuses work outside a Pinkie session and explains a missing login', async () => {
  freshState();
  const outside = createWebGptTool({sessionKey: ''});
  const refused = await outside.execute('1', {action: 'account'});
  assert.equal(refused.isError, true);
  const runner = {account: async () => ({loggedIn: false})};
  const tool = createWebGptTool({sessionKey: 'agent:metre:x'}, {runner});
  const result = await tool.execute('2', {action: 'account'});
  assert.equal(result.details.loggedIn, false);
  assert.match(result.details.hint, /chatgpt\.com/);
  assert.match(tool.description, /隐藏页面/);
});

test('items can go into subfolders, and the wake text hands back MEDIA lines', async t => {
  freshState();
  const app = fakeApp();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web-gpt-out-'));
  t.after(() => { app.cleanup(); fs.rmSync(out, {recursive: true, force: true}); });
  let watched;
  const runner = new WebGptRunner({request: app.request, pollMs: 1, track: job => (watched = job)});
  const batch = runner.startBatch({
    sessionKey: 'agent:metre:s', outDir: out,
    items: [{prompt: '女主定稿', name: '女主', folder: '角色'}, {prompt: '分镜一', name: '镜01', folder: '第01集/分镜'}, {prompt: '封面'}],
  });
  while (watched.isRunning()) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(fs.existsSync(path.join(out, '角色', '女主.png')));
  assert.ok(fs.existsSync(path.join(out, '第01集', '分镜', '镜01.png')));
  assert.ok(fs.existsSync(path.join(out, '03.png')));
  const record = JSON.parse(fs.readFileSync(path.join(out, fs.readdirSync(out).find(name => name.startsWith('出图记录-'))), 'utf8'));
  assert.equal(record.images[1].files[0], path.join('第01集', '分镜', '镜01.png'));
  const wake = batchWakeText(batch);
  assert.match(wake, new RegExp(`MEDIA:${path.join(out, '角色', '女主.png').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(wake, /最多 6 张/);
});

test('subfolder names cannot climb out of the batch folder', () => {
  assert.equal(safeSubfolder(''), '');
  assert.equal(safeSubfolder('第01集/分镜'), path.join('第01集', '分镜'));
  for (const bad of ['../x', '/abs', '~/x', 'a/../../b', '.hidden', 'C:/x', 'a/b/c/d/e']) {
    assert.throws(() => safeSubfolder(bad), /folder/, bad);
  }
});

test('images in an ask reply are saved into the output folder and offered as MEDIA lines', async t => {
  freshState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-gpt-ask-'));
  const home = os.homedir();
  const project = fs.mkdtempSync(path.join(home, 'Documents', 'web-gpt-proj-'));
  t.after(() => { fs.rmSync(tmp, {recursive: true, force: true}); fs.rmSync(project, {recursive: true, force: true}); });
  const job = randomUUID();
  const src = path.join(tmp, 'pinkie-gpt-web', job, 'image-1.png');
  fs.mkdirSync(path.dirname(src), {recursive: true});
  fs.writeFileSync(src, png);
  const runner = {ask: async () => ({reply: '给你画好了', files: [src]})};
  const tool = createWebGptTool({sessionKey: 'agent:main:s'}, {runner, projectFor: () => project});
  const result = await tool.execute('t1', {action: 'ask', question: '画只猫'});
  assert.equal(result.details.ok, true);
  assert.equal(result.details.images.length, 1);
  assert.ok(result.details.images[0].startsWith(path.join(project, '出图')));
  assert.ok(fs.existsSync(result.details.images[0]));
  assert.match(result.details.show, /^要给先生看/);
  assert.match(result.details.show, /MEDIA:/);
  assert.equal(fs.existsSync(src), false);
});
