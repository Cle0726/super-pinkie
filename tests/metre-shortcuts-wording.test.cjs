// K4（ui3）：快捷键一览（⌘/ · Ctrl+/，laolao-artifacts.js openShortcuts）在 Metre 里不出现「碧琪」。
// 一览的面板根是 .pinkie-shortcuts，要在 laolao-metre-skin.js 措辞替换的 SCOPE 里，
// 「问碧琪（带上选中的代码）」才会换成 Metre 的说法；离开 Metre 由同一套 detach 还原。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../ui/injections');
const skinJs = fs.readFileSync(path.join(dir, 'laolao-metre-skin.js'), 'utf8');
const artifactsJs = fs.readFileSync(path.join(dir, 'laolao-artifacts.js'), 'utf8');

function scopeOf(src) {
  const m = src.match(/const SCOPE = '([^']+)'/);
  assert.ok(m, 'SCOPE is declared in laolao-metre-skin.js');
  return m[1].split(',').map(s => s.trim());
}
function metreWord() {
  const start = skinJs.indexOf('  const RULES = [');
  const end = skinJs.indexOf('  // 记下换过的地方');
  assert.ok(start > 0 && end > start);
  const sandbox = {};
  vm.runInNewContext(skinJs.slice(start, end) + '\nthis.word = word;', sandbox);
  return sandbox.word;
}

test('快捷键一览的面板根 .pinkie-shortcuts 在 Metre 措辞替换范围里', () => {
  // 面板根真的叫这个名字（改名了这里会先失败）
  assert.match(artifactsJs, /el\('div', 'laolao-modal pinkie-tools-modal pinkie-shortcuts'\)/);
  assert.ok(scopeOf(skinJs).includes('.pinkie-shortcuts'), 'SCOPE 要包含 .pinkie-shortcuts');
  // 反例：去掉这一项，断言必须失败
  const without = skinJs.replace(', .pinkie-shortcuts', '');
  assert.ok(!scopeOf(without).includes('.pinkie-shortcuts'));
  // 不碰聊天内容
  assert.doesNotMatch(scopeOf(skinJs).join(','), /chat|message/);
});

test('一览里每一行在 Metre 里都不带碧琪', () => {
  const word = metreWord();
  const labels = [...artifactsJs.matchAll(/\['([^'\]]*碧琪[^']*)',/g)].map(m => m[1]);
  const start = artifactsJs.indexOf('function shortcutGroups()');
  const end = artifactsJs.indexOf('async function openShortcuts()');
  const sheet = artifactsJs.slice(start, end);
  const inSheet = labels.filter(l => sheet.includes(l));
  assert.ok(inSheet.length >= 1, '一览里至少有一行原文带碧琪（否则这条测试没在测东西）');
  for (const label of inSheet) assert.doesNotMatch(word(label), /碧琪/, label);
  assert.equal(word('问碧琪（带上选中的代码）'), '问Metre（带上选中的代码）');
});
