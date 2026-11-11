import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SessionPrefs, registerSessionPrefs, styleText, WEB_ON, WEB_OFF, replyStyles} from '../services/mode-architecture/session-prefs.mjs';

const KEY = 'agent:main:main-abc';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-'));

test('reply styles match PROMPTS §4 keys and keep the safety sentence', () => {
  const styles = replyStyles();
  assert.deepEqual(Object.keys(styles).sort(), ['casual', 'concise', 'custom', 'detailed', 'formal']);
  for (const text of Object.values(styles)) assert.match(text, /安全、谨慎和工作规则照旧/);
  assert.equal(styleText('default'), '');
  assert.equal(styleText('custom', ''), '');
  assert.match(styleText('custom', '每段都用 $& 开头'), /每段都用 \$& 开头$/);
});

test('session prefs: defaults, per-session override, persistence', () => {
  const root = tmp();
  const prefs = new SessionPrefs(root);
  assert.deepEqual(prefs.forSession(KEY), {style: 'default', customStyle: '', web: true});
  prefs.setGlobal({defaultStyle: 'concise', notify: {done: false}});
  assert.equal(prefs.forSession(KEY).style, 'concise');
  assert.deepEqual(prefs.globalPrefs().notify, {done: false, waiting: true});
  prefs.setSession(KEY, {style: 'formal', web: false});
  const again = new SessionPrefs(root);
  assert.deepEqual(again.forSession(KEY), {style: 'formal', customStyle: '', web: false});
  assert.throws(() => again.setSession(KEY, {style: 'loud'}), /没有这种回答风格/);
  assert.throws(() => again.setSession('nope', {web: true}), /会话不存在/);
  assert.throws(() => again.setGlobal({defaultStyle: 'x'}), /没有这种回答风格/);
});

test('custom style clipped at 1000 characters', () => {
  const prefs = new SessionPrefs(tmp());
  prefs.setGlobal({customStyle: '字'.repeat(1500)});
  assert.equal([...prefs.globalPrefs().customStyle].length, 1000);
});

test('prompt context: style + web, web off adds nothing, block only tightens', () => {
  const prefs = new SessionPrefs(tmp());
  assert.equal(prefs.promptContext(KEY), WEB_ON);
  prefs.setSession(KEY, {style: 'casual', web: false});
  assert.equal(prefs.promptContext(KEY), replyStyles().casual);
  assert.ok(prefs.blocksTool(KEY, 'web_search'));
  assert.ok(prefs.blocksTool(KEY, 'web_fetch'));
  assert.ok(!prefs.blocksTool(KEY, 'exec'));
  prefs.setSession(KEY, {web: true});
  assert.ok(!prefs.blocksTool(KEY, 'web_search'));
});

test('hooks: before_prompt_build and before_tool_call', async () => {
  const hooks = {}, methods = {};
  const api = {
    on: (name, fn) => { (hooks[name] ||= []).push(fn); },
    registerGatewayMethod: (name, fn) => { methods[name] = fn; },
  };
  registerSessionPrefs(api, {root: tmp()});
  const call = (name, params) => new Promise(resolve => methods[name]({params, respond: (ok, value) => resolve(value)}));
  assert.deepEqual(await call('pinkie.session.prefs.set', {key: KEY, web: false, style: 'detailed'}), {ok: true});
  assert.equal((await call('pinkie.session.prefs.get', {key: KEY})).web, false);
  assert.equal((await call('pinkie.session.prefs.set', {key: KEY, style: 'x'})).ok, false);
  const built = hooks.before_prompt_build[0]({}, {sessionKey: KEY});
  assert.match(built.appendSystemContext, /详细讲解/);
  assert.doesNotMatch(built.appendSystemContext, /【联网】/);
  assert.deepEqual(hooks.before_tool_call[0]({toolName: 'web_search'}, {sessionKey: KEY}), {block: true, blockReason: WEB_OFF});
  assert.equal(hooks.before_tool_call[0]({toolName: 'read'}, {sessionKey: KEY}), undefined);
  assert.equal((await call('pinkie.prefs.get', {})).menubar, true);
});
