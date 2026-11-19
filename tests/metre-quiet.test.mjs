// 批 6 · Metre 模式下的资源关停（PLAN 2.13，ACCEPTANCE A6-*）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {QUIET_TTL_MS, QuietMode, registerQuietMode} from '../services/mode-architecture/quiet-mode.mjs';

const nudge = prompt => /\[\[PINKIE_NUDGE/.test(String(prompt || ''));

test('A6-4 安静时拦心跳和学习提醒，用户自己的轮照常；别的模式有会话在跑时不安静', () => {
  let clock = 1000;
  const q = new QuietMode({now: () => clock, nudge});
  let paused = 0, resumed = 0;
  q.register('learning-materials', {pause: () => paused++, resume: () => resumed++});
  // 界面不是 Metre：什么都不拦
  assert.equal(q.gate({}, {sessionKey: 'agent:main:x', trigger: 'heartbeat'}), undefined);
  q.ended({}, {sessionKey: 'agent:main:x'});
  q.set(true);
  assert.equal(q.active, true);
  assert.equal(paused, 1);
  assert.equal(q.gate({}, {sessionKey: 'agent:main:x', trigger: 'heartbeat'})?.outcome, 'block');
  assert.equal(q.gate({prompt: '[[PINKIE_NUDGE:morning]]'}, {sessionKey: 'agent:learning:x', trigger: 'cron'})?.outcome, 'block');
  // 别的定时任务不拦（它在跑时项目模式算在用，结束后接着安静）；Metre 自己的轮不拦
  assert.equal(q.gate({prompt: '整理周报'}, {sessionKey: 'agent:project:cron:1', trigger: 'cron'}), undefined);
  assert.equal(q.active, false);
  q.ended({}, {sessionKey: 'agent:project:cron:1'});
  assert.deepEqual([paused, resumed], [2, 1]);
  assert.equal(q.gate({}, {sessionKey: 'agent:metre:main', trigger: 'user'}), undefined);
  assert.equal(q.active, true, 'Metre 自己在跑不影响');
  // Metre 派出的子会话在学习模式里跑：不再安静，学习资料的任务恢复，心跳也照常
  assert.equal(q.gate({}, {sessionKey: 'agent:learning:pinkie-child:abc', trigger: 'user'}), undefined);
  assert.equal(q.active, false);
  assert.equal(resumed, 2);
  assert.equal(q.gate({}, {sessionKey: 'agent:main:x', trigger: 'heartbeat'}), undefined);
  q.ended({}, {sessionKey: 'agent:main:x'});
  q.ended({}, {sessionKey: 'agent:learning:pinkie-child:abc'});
  assert.equal(q.active, true);
  assert.equal(paused, 3);
  // 界面 30 分钟没续：不再安静
  clock += QUIET_TTL_MS + 1;
  assert.equal(q.active, false);
  assert.equal(q.gate({}, {sessionKey: 'agent:main:x', trigger: 'heartbeat'}), undefined);
});

test('A6-7 消息渠道默认照常；打开开关后安静时先不处理，关掉恢复；开关存盘', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'quiet-mode.json');
  const q = new QuietMode({file, nudge});
  q.set(true);
  const wechat = {sessionKey: 'agent:main:openclaw-weixin:direct:1', trigger: 'user', messageProvider: 'openclaw-weixin'};
  assert.equal(q.gate({}, wechat), undefined);
  q.ended({}, wechat);
  q.setPrefs({pauseChannels: true});
  assert.equal(q.gate({}, wechat)?.outcome, 'block');
  assert.equal(q.gate({}, {sessionKey: 'agent:main:y', trigger: 'user', messageProvider: 'webchat'}), undefined, 'App 里自己发的照常');
  assert.equal(new QuietMode({file}).prefs.pauseChannels, true);
  q.setPrefs({pauseChannels: false});
  assert.equal(q.gate({}, wechat), undefined);
});

test('丢了结束事件的轮三小时后不再挡着', () => {
  let clock = 0;
  const q = new QuietMode({now: () => clock});
  q.set(true);
  q.gate({}, {sessionKey: 'agent:project:z', trigger: 'user'});
  assert.equal(q.active, false);
  clock += 3 * 3600_000 + 1;
  q.set(true);
  assert.equal(q.active, true);
});

test('网关方法：pinkie.quiet.set / status / prefs', async () => {
  const methods = new Map(), hooks = {};
  const api = {on: (name, fn) => (hooks[name] ??= []).push(fn), registerGatewayMethod: (name, fn) => methods.set(name, fn)};
  registerQuietMode(api, {nudge});
  const rpc = async (name, params) => { let out; await methods.get(name)({params, respond: (ok, payload) => { out = payload; }}); return out; };
  assert.equal((await rpc('pinkie.quiet.set', {quiet: true})).quiet, true);
  assert.equal(hooks.before_agent_run[0]({}, {sessionKey: 'agent:main:h', trigger: 'heartbeat'})?.outcome, 'block');
  assert.equal((await rpc('pinkie.quiet.status', {})).skipped.at(-1).why, 'heartbeat');
  assert.equal((await rpc('pinkie.quiet.set', {quiet: false})).quiet, false);
});

test('前端：调度器排在重模块前面，重模块都登记了 suspend / resume', () => {
  const read = name => fs.readFileSync(new URL('../ui/injections/' + name, import.meta.url), 'utf8');
  const head = read('laolao-head.fragment.html');
  const at = name => head.indexOf(name);
  assert.ok(at('laolao-quiet.js') > 0);
  for (const name of ['laolao-companion.js', 'laolao-buddy-rig.js', 'laolao-rest.js', 'laolao-immersion.js', 'laolao-cle-stage.js', 'laolao-laser-pointer.js']) {
    assert.ok(at('laolao-quiet.js') < at(name), name);
  }
  assert.doesNotMatch(head, /<script[^>]*defer[^>]*laolao-quiet\.js/, '调度器同步加载');
  for (const [file, name] of [['laolao-companion.js', 'companion'], ['laolao-rest.js', 'rest'], ['laolao-cle-stage.js', 'cle-space'],
    ['laolao-immersion.js', 'immersion'], ['laolao-party-entry.js', 'party-entry'], ['laolao-roundtable-entry.js', 'roundtable-entry'],
    ['laolao-laser-pointer.js', 'laser'], ['laolao-learning-library.js', 'learning-library']]) {
    assert.match(read(file), new RegExp(`__pinkieQuiet[?.]*\\.?(?:register|interval)\\(['"]${name}`), file);
  }
  // 三维小标不再静态 import three
  assert.doesNotMatch(read('laolao-cle-stage.js'), /^import \{CleSpace\}/m);
  // 小碧琪的 WebGL 上下文真的还回去
  assert.match(read('laolao-buddy-rig.js'), /WEBGL_lose_context/);
});

test('11-16 夜：Metre 里思考时也有「C.le.」粒子签名，但只在运行期间占着 WebGL', () => {
  const src = fs.readFileSync(new URL('../ui/injections/laolao-cle-stage.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!metreNow\(\) && !document\.documentElement\.hasAttribute\('data-laolao-splash-metre'\)\) loadSpace\(\)/, 'Metre 冷启动不加载 three');
  assert.match(src, /if \(!CleSpace\) \{ loadSpace\(\); return null; \}/, '运行时按需加载 three');
  assert.match(src, /register\('cle-space', \{suspend: dropSpace\}\)/, '进 Metre 时仍先拆掉');
  assert.match(src, /release\(\);\n    if \(metreNow\(\) && !owner\) dropSpace\(\);/, 'Metre：一轮落款完就把 WebGL 还回去');
});

test('空闲 CPU：短轮询空闲 5 秒放到 5 秒一次，一分钟没人动再放到 30 秒一次，有输入或对话事件立即恢复', () => {
  const src = fs.readFileSync(new URL('../ui/injections/laolao-quiet.js', import.meta.url), 'utf8');
  assert.match(src, /DEEP_AFTER = 60_000, DEEP_FLOOR = 30_000/);
  // 正好 5 秒一次的轮询（续跑兜底探针）也算短轮询，深空闲时一起放慢
  assert.match(src, /typeof fn !== 'function' \|\| delay > SHORT\) return nativeSetInterval/);
  assert.match(src, /still > DEEP_AFTER \? Math\.max\(rec\.ms, DEEP_FLOOR\) : still > IDLE_AFTER \? Math\.max\(rec\.ms, IDLE_FLOOR\) : rec\.ms/);
  assert.match(src, /if \(rec\.due - lastActive > rec\.ms\) \{ nativeClearTimeout\.call\(window, rec\.timer\); arm\(rec, 0\); \}/);
});
