// Metre 里共用界面（设置、工作台、链接预览）不出现「碧琪」，也不露碧琪粉。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../ui/injections');
const skinJs = fs.readFileSync(path.join(dir, 'laolao-metre-skin.js'), 'utf8');
const skinCss = fs.readFileSync(path.join(dir, 'laolao-metre-skin.css'), 'utf8');

function metreWord() {
  const start = skinJs.indexOf('  const RULES = [');
  const end = skinJs.indexOf('  // 记下换过的地方');
  assert.ok(start > 0 && end > start, 'wording rules are in laolao-metre-skin.js');
  const sandbox = {};
  vm.runInNewContext(skinJs.slice(start, end) + '\nthis.word = word;', sandbox);
  return sandbox.word;
}

test('Metre 措辞：助手叫 Metre，说别的模式或产品的句子只去掉称呼', () => {
  const word = metreWord();
  const cases = {
    '碧琪的常用设置': '常用设置',
    '碧琪工作台': '工作台',
    '碧琪的链接预览': '链接预览',
    '问碧琪（选中代码后 ⌘L）': '问Metre（选中代码后 ⌘L）',
    '手机微信聊，碧琪用无限模式回复。': '手机微信聊，用无限模式回复。',
    '用手机微信扫描，连接碧琪无限模式': '用手机微信扫描，连接无限模式',
    '把手机连接到这台碧琪。': '把手机连接到这台电脑。',
    '用哪个模式的碧琪': '用哪个模式',
    '碧琪经典': '经典',
    '由碧琪自动选择': '自动选择',
    '」放进碧琪的回收站': '」放进回收站',
    '把你自己的账号和资料接给碧琪，她就能直接去查、去读。': '把你自己的账号和资料接给Metre，它就能直接去查、去读。',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(word(from), to, from);
  // 不含碧琪的文字原样不动（「她」只在同一句里有碧琪时才换）
  assert.equal(word('她说好'), '她说好');
  assert.equal(word(''), '');
});

test('Metre 措辞只作用在共用界面的根节点上，不碰聊天内容，离开 Metre 会还原', () => {
  const scope = skinJs.match(/const SCOPE = '([^']+)'/)[1];
  for (const id of ['#laolao-user-settings', '.pk-wb', '#laolao-link-viewer', '#pinkie-schedules', '#pinkie-connectors', '#pinkie-model-setup']) assert.ok(scope.includes(id), id);
  assert.doesNotMatch(scope, /chat|message|agent-chat/);
  assert.match(skinJs, /function detach\(\)[\s\S]*node\.nodeValue = original/);
});

test('Metre 皮肤：设置和工作台换成 Metre 色板，样式表括号配平', () => {
  const css = skinCss.replace(/\/\*[\s\S]*?\*\//g, '');
  // 一个没闭合的 :is( 会吞掉后面的规则（11-18 生成的覆盖规则就这样丢过）
  assert.equal(css.split('(').length, css.split(')').length, 'parentheses balance');
  assert.equal(css.split('{').length, css.split('}').length, 'braces balance');
  assert.match(css, /:is\(#laolao-user-settings, #pinkie-model-setup\) \{\s*--pinkie-settings-ink: var\(--metre-text\);/);
  assert.match(css, /:is\(\.pk-wb, \.pk-wb\.is-light\) \{[^}]*--wb-text: var\(--metre-text\);/);
  assert.match(css, /--mode-button-ink: var\(--metre-text\)/);
});
