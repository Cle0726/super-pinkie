const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function translate() {
  const window = {};
  const document = {body: null, addEventListener() {}, getElementById() { return null; }};
  class MutationObserver { observe() {} }
  vm.runInNewContext(read('ui/injections/laolao-biqi-notices.js'), {window, document, MutationObserver, NodeFilter: {}});
  return window.__pinkieBiqiTranslateNotice;
}

test('"no auth available" says the model cannot be used, not that it is busy', () => {
  const say = translate();
  const account = say('503 auth_unavailable: no auth available');
  assert.match(account, /用不了/);
  assert.doesNotMatch(account, /太忙|稍等|稍后/);
  assert.match(say('429 Too Many Requests'), /排队/);
  assert.match(say('503 Service Unavailable'), /太忙/);
  // 11-23 真界面里看到的：模型不存在被说成「没找到要用的文件」，而且和失败卡重复了一条红横幅。
  const missing = say('Agent failed before reply: The selected model was not found by the provider. Check the model id or choose a different model.');
  assert.match(missing, /找不到这个模型/);
  assert.doesNotMatch(missing, /文件/);
});

test('the chat error banner hides itself when the chat already shows the failure card', () => {
  const source = read('ui/injections/laolao-biqi-notices.js');
  assert.match(source, /callout\[data-pinkie-dup\]\{display:none!important\}/);
  assert.match(source, /isChatErrorBanner\(box\) && MODEL_FAILURE\.test\(raw\) && chatShowsFailure\(box\)/);
  const failure = new RegExp(/auth[_ ]?unavailable|no auth available|\b(?:402|429|5\d\d)\b|timeout/i);
  assert.ok(failure.test('503 auth_unavailable: no auth available'));
  const banner = new RegExp(/const MODEL_FAILURE = \/(.*)\/i;/.exec(source)[1], 'i');
  assert.ok(banner.test('Agent failed before reply: The selected model was not found by the provider.'), 'a missing model is a model failure too, so the banner is not repeated');
});

test('the failure card explains the reason and offers a usable model, except when it is just busy', () => {
  const source = read('ui/injections/laolao-message-actions.js');
  const say = vm.runInNewContext(`(${/const FAILURE_SAY = (\{[\s\S]*?\n  \});/.exec(source)[1]})`);
  assert.match(say.account('Gemini 3.8 Flash'), /「Gemini 3\.8 Flash」现在用不了：.*没有可用的账号.*不会好/);
  assert.match(say.busy('Grok 4.5'), /过一会儿/);
  assert.match(source, /pinkie\.model\.failure/);
  assert.match(source, /`换成 \$\{next\} 再发一次`/);
  assert.match(source, /failure\.kind !== 'busy'/);
  assert.match(source, /'sessions\.patch', \{key, \.\.\.\(agentId \? \{agentId\} : \{\}\), model\}/);
  assert.match(source, /'pinkie\.chat\.regenerate', \{entryId: userId, model\}/);
  assert.match(read('ui/injections/laolao-message-actions.css'), /\.chat-bubble\[data-pinkie-fail\] > \.chat-text \{ display:none \}/);
});

test('the plugin answers pinkie.model.failure and ships model-health.mjs', () => {
  const index = read('services/mode-architecture/index.mjs');
  assert.match(index, /registerGatewayMethod\('pinkie\.model\.failure'/);
  assert.match(index, /modelHealth\.turnEnded\(/);
  assert.match(read('services/mode-architecture/setup.py'), /"model-health\.mjs"/);
  assert.match(read('installer/macos/apply-theme.sh'), / model-health\.mjs /);
});

test('a retried send (two live user entries, same time and idempotencyKey) resolves to the later one', () => {
  const source = read('ui/injections/laolao-message-actions.js');
  const body = /function historyItem\(messageId, history\) \{[\s\S]*?\n  \}\n/.exec(source)[0];
  const historyItem = vm.runInNewContext(`(${body.replace(/^function historyItem/, 'function')})`);
  const send = {idempotencyKey: 'k:user'};
  const history = [{role: 'user', timestamp: 5}, {role: 'user', timestamp: 9, __openclaw: {id: 'a1', ...send}},
    {role: 'user', timestamp: 9, __openclaw: {id: 'a2', ...send}}, {role: 'assistant', timestamp: 12, __openclaw: {id: 'b'}}];
  assert.equal(historyItem('msg:user:9:0', history).__openclaw.id, 'a2');
  const different = [{role: 'user', timestamp: 9, __openclaw: {id: 'a1', idempotencyKey: 'x'}}, {role: 'user', timestamp: 9, __openclaw: {id: 'a2', idempotencyKey: 'y'}}];
  assert.equal(historyItem('msg:user:9:0', different), null);
  assert.equal(historyItem('msg:assistant:12:3', history).__openclaw.id, 'b');
});
