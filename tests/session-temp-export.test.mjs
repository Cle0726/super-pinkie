import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TempSessions, isTempKey, mediaPathsIn, registerSessionTemp, TEMP_PROMPT, TEMP_TITLE} from '../services/mode-architecture/session-temp.mjs';
import {branchTurns, renderMarkdown, digestOf, SessionExport, ASSET_DIR} from '../services/mode-architecture/session-export.mjs';
import {LongTermMemoryStore} from '../services/mode-architecture/memory.mjs';

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const TEMP = 'agent:main:dashboard:temp-0f8fad5b-d9cb-469f-a165-70867728950e';

function fakeAccess(stateDir) {
  const dir = path.join(stateDir, 'agents', 'main', 'sessions');
  fs.mkdirSync(dir, {recursive: true});
  const entries = {};
  const calls = [];
  return {
    calls, entries, dir,
    async rpc(method, params) {
      calls.push([method, params]);
      if (method === 'sessions.create') {
        if (Object.values(entries).some(row => row.label === params.label)) throw new Error('label already in use');
        const sessionId = 's' + Object.keys(entries).length + '-x';
        entries[params.key] = {sessionId, label: params.label, updatedAt: Date.now()};
        fs.writeFileSync(path.join(dir, sessionId + '.jsonl'), '');
        return {key: params.key, sessionId};
      }
      if (method === 'sessions.delete') {
        const row = entries[params.key];
        if (row) fs.renameSync(path.join(dir, row.sessionId + '.jsonl'), path.join(dir, row.sessionId + '.jsonl.deleted.1'));
        delete entries[params.key];
        return {ok: true};
      }
      throw new Error('unexpected ' + method);
    },
    async entry(key) {
      const row = entries[key];
      return row ? {...row, key, transcript: path.join(dir, row.sessionId + '.jsonl')} : null;
    },
    async list() { return {entries, dir}; },
  };
}

test('temp key shape is recognised only for dashboard temp sessions', () => {
  assert.equal(isTempKey(TEMP), true);
  assert.equal(isTempKey('agent:main:dashboard:0f8fad5b-d9cb-469f-a165-70867728950e'), false);
  assert.equal(isTempKey('agent:main:dashboard:temp-zz'), false);
});

test('create names it 临时会话, leave removes record, transcript, trajectory and media', async () => {
  const stateDir = tmp('temp-state-');
  const access = fakeAccess(stateDir);
  const forgotten = [];
  const titles = {record: () => {}, forget: key => forgotten.push(key)};
  const prefs = {forget: key => forgotten.push('prefs:' + key)};
  const temp = new TempSessions({}, {root: tmp('temp-root-'), access, titles, prefs, stateDir});
  const first = await temp.create({mode: 'main'});
  assert.equal(first.ok, true);
  assert.ok(isTempKey(first.key));
  assert.equal(access.entries[first.key].label, TEMP_TITLE);
  const second = await temp.create({mode: 'main'});
  assert.equal(access.entries[second.key].label, TEMP_TITLE + ' 2');

  const row = access.entries[first.key];
  const media = path.join(stateDir, 'media', 'inbound', 'photo.png');
  fs.mkdirSync(path.dirname(media), {recursive: true});
  fs.writeFileSync(media, 'x');
  fs.writeFileSync(path.join(access.dir, row.sessionId + '.jsonl'), JSON.stringify({type: 'message', message: {role: 'user', content: [{type: 'text', text: `看 ${media}`}]}}) + '\n');
  fs.writeFileSync(path.join(access.dir, row.sessionId + '.trajectory.jsonl'), '{}');
  fs.writeFileSync(path.join(access.dir, row.sessionId + '.trajectory-path.json'), '{}');
  assert.deepEqual(await temp.leave(first.key), {ok: true});
  const left = fs.readdirSync(access.dir).filter(name => name.startsWith(row.sessionId));
  assert.deepEqual(left, []);
  assert.equal(fs.existsSync(media), false);
  assert.ok(forgotten.includes(first.key) && forgotten.includes('prefs:' + first.key));
  assert.deepEqual(Object.keys(temp.registry()), [second.key]);
  await assert.rejects(temp.leave('agent:main:dashboard:abc'), /不是临时会话/);
});

test('sweep deletes temp sessions older than 24 h, keeps fresh ones', async () => {
  const stateDir = tmp('temp-sweep-');
  const access = fakeAccess(stateDir);
  let clock = 1_000_000_000;
  const temp = new TempSessions({}, {root: tmp('temp-root-'), access, now: () => clock, stateDir});
  const old = await temp.create({mode: 'main'});
  clock += 25 * 60 * 60 * 1000;
  const fresh = await temp.create({mode: 'main'});
  const result = await temp.sweep();
  assert.equal(result.removed, 1);
  assert.equal(access.entries[old.key], undefined);
  assert.ok(access.entries[fresh.key]);
});

test('temp prompt is injected only for temp sessions', () => {
  const hooks = {};
  const api = {on: (name, fn) => { hooks[name] = fn; }, registerGatewayMethod() {}};
  registerSessionTemp(api, {root: tmp('temp-reg-'), titles: {access: fakeAccess(tmp('x-'))}, prefs: {}});
  assert.equal(hooks.before_prompt_build({}, {sessionKey: 'agent:main:dashboard:abc'}), undefined);
  assert.match(hooks.before_prompt_build({}, {sessionKey: TEMP}).appendSystemContext, new RegExp(TEMP_PROMPT.slice(0, 10)));
});

test('memory never records from a temp session', () => {
  const store = new LongTermMemoryStore({config: {}});
  assert.equal(store.captureExplicit({sessionKey: TEMP, mode: 'main'}, '记住：我喜欢蓝色'), null);
  assert.throws(() => store.remember({sessionKey: TEMP, mode: 'main'}, {text: '蓝色'}), /临时会话|只支持/);
});

test('media path detection stays inside the state media folder', () => {
  const state = '/tmp/st';
  assert.deepEqual(mediaPathsIn('a /tmp/st/media/inbound/a.png, b /tmp/st/other/x.png "/tmp/st/media/../x"', state), ['/tmp/st/media/inbound/a.png']);
});

const branch = [
  {type: 'model_change', modelId: 'mock-1'},
  {type: 'message', message: {role: 'user', content: [{type: 'text', text: '帮我查天气'}, {type: 'image', data: Buffer.from('png').toString('base64'), mimeType: 'image/png'}]}},
  {type: 'message', message: {role: 'assistant', content: [{type: 'thinking', thinking: '秘密思考'}, {type: 'text', text: '我先查一下。'}, {type: 'toolCall', name: 'exec'}]}},
  {type: 'message', message: {role: 'toolResult', content: [{type: 'text', text: '工具输出'}]}},
  {type: 'message', message: {role: 'assistant', content: [{type: 'toolCall', name: 'exec'}, {type: 'toolCall', name: 'exec'}]}},
  {type: 'message', message: {role: 'assistant', content: [{type: 'text', text: '明天晴。'}]}},
  {type: 'message', message: {role: 'user', content: [{type: 'text', text: '【子会话简报】内部'}]}},
];

test('markdown export: header, roles, tool line, no thinking or tool output, images as assets', () => {
  const {turns, model} = branchTurns(branch);
  assert.equal(model, 'mock-1');
  const {markdown, assets} = renderMarkdown({title: '天气', model, exportedAt: Date.UTC(2026, 10, 11, 12), turns});
  assert.match(markdown, /^# 天气\n\n导出时间：2026-11-1\d \d\d:00 · 模型：mock-1/);
  assert.match(markdown, /\*\*你\*\*\n\n帮我查天气/);
  assert.match(markdown, /我先查一下。\n\n（运行了 3 个命令）\n\n明天晴。/);
  assert.doesNotMatch(markdown, /秘密思考|工具输出|子会话简报/);
  assert.equal(assets.length, 1);
  assert.match(markdown, new RegExp(`!\\[图片-1-[0-9a-f]+\\.png\\]\\(\\./${ASSET_DIR}/`));
  const inline = renderMarkdown({title: '天气', model, exportedAt: 0, turns, inlineImages: true});
  assert.equal(inline.assets.length, 0);
  assert.match(inline.markdown, /\(data:image\/png;base64,cG5n\)/);
});

test('digest keeps the opening and the latest exchange within the limit', () => {
  const turns = [];
  for (let index = 0; index < 40; index++) turns.push({role: index % 2 ? 'assistant' : 'user', blocks: [{type: 'text', text: `第${index}条` + '字'.repeat(80)}]});
  const text = digestOf(turns, 600);
  assert.ok([...text].length <= 640, [...text].length);
  assert.match(text, /^用户：第0条/);
  assert.match(text, /第39条/);
  assert.match(text, /……/);
});

test('SessionExport reads the transcript and writes image assets', async () => {
  const stateDir = tmp('exp-');
  const access = fakeAccess(stateDir);
  access.entries['agent:main:dashboard:x1'] = {sessionId: 'x1', label: '我的会话'};
  fs.writeFileSync(path.join(access.dir, 'x1.jsonl'), branch.map(row => JSON.stringify(row)).join('\n'));
  access.sdk = async () => null;
  const exporter = new SessionExport({access, root: tmp('exp-root-')});
  const result = await exporter.exportMarkdown('agent:main:dashboard:x1');
  assert.equal(result.ok, true);
  assert.equal(result.title, '我的会话');
  assert.equal(result.assets.length, 1);
  assert.equal(fs.readFileSync(result.assets[0].path, 'utf8'), 'png');
  const digest = await exporter.digest('agent:main:dashboard:x1', 2000);
  assert.match(digest.excerpt, /用户：帮我查天气/);
});
