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

test('every plugin instance shares one prefs cache per root', () => {
  const root = tmp();
  const hooks = [];
  const api = () => ({on: (name, fn) => { if (name === 'before_prompt_build') hooks.push(fn); }, registerGatewayMethod() {}});
  const first = registerSessionPrefs(api(), {root});
  const second = registerSessionPrefs(api(), {root});
  assert.equal(first, second);
  first.setSession(KEY, {style: 'concise'});
  assert.match(hooks[1]({}, {sessionKey: KEY}).appendSystemContext, /回答风格：简洁/);
});

test('自己分工 is on by default and the settings switch turns it off and back on', async t => {
  const root = tmp();
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const make = () => new SessionPrefs(root);
  const prefs = make();
  assert.equal(prefs.globalPrefs().autoSplit, true);
  assert.equal(prefs.setGlobal({autoSplit: false}).autoSplit, false);
  assert.equal(make().globalPrefs().autoSplit, false, 'survives a restart');
  prefs.setGlobal({autoSplit: 'yes'});
  assert.equal(prefs.globalPrefs().autoSplit, false, 'only a real boolean changes it');
  assert.equal(prefs.setGlobal({autoSplit: true}).autoSplit, true);
});

test('mode options: 工作程度 only in project mode, 想法取向 only in ideas mode', () => {
  const prefs = new SessionPrefs(tmp());
  const project = 'agent:project:dashboard:p1', ideas = 'agent:thinking:dashboard:t1';
  assert.equal(prefs.forSession(project).pace, 'default');
  assert.equal(prefs.forSession(ideas).lens, 'default');
  assert.ok(!('pace' in prefs.forSession(KEY)) && !('lens' in prefs.forSession(KEY)));
  assert.ok(!('lens' in prefs.forSession(project)) && !('pace' in prefs.forSession(ideas)));
  prefs.setSession(project, {pace: 'fast'});
  prefs.setSession(ideas, {lens: 'critic'});
  assert.equal(prefs.forSession(project).pace, 'fast');
  assert.match(prefs.promptContext(project), /【工作程度：效率】/);
  assert.match(prefs.promptContext(project), /没验证的就说没验证/);
  assert.match(prefs.promptContext(ideas), /【想法取向：挑刺】/);
  prefs.setSession(project, {pace: 'strict'});
  assert.match(prefs.promptContext(project), /【工作程度：严谨】/);
  prefs.setSession(project, {pace: 'default'});
  assert.doesNotMatch(prefs.promptContext(project), /工作程度/);
  assert.throws(() => prefs.setSession(project, {pace: 'turbo'}), /没有这种工作程度/);
  assert.throws(() => prefs.setSession(ideas, {lens: 'x'}), /没有这种想法取向/);
  assert.throws(() => prefs.setSession(KEY, {pace: 'fast'}), /这个模式没有这个选项/);
  assert.throws(() => prefs.setSession(project, {lens: 'critic'}), /这个模式没有这个选项/);
  assert.doesNotMatch(prefs.promptContext(KEY), /工作程度|想法取向/);
});