// K4（ui3）：快捷键一览（laolao-artifacts.js shortcutGroups / openShortcuts，⌘/ · Ctrl+/）
// 1) 列出工作台开关 ⌥⌘B，按平台写法和工作台自己的提示一致（Windows Alt+Ctrl+B）；
// 2) 设置「通知与快捷」卡里有看得见的入口「全部快捷键」，点了打开同一张一览。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../ui/injections');
const artifacts = fs.readFileSync(path.join(dir, 'laolao-artifacts.js'), 'utf8');
const settings = fs.readFileSync(path.join(dir, 'laolao-settings-user.js'), 'utf8');
const workbench = fs.readFileSync(path.join(dir, 'laolao-workbench.js'), 'utf8');

function groupsFor(src, isMac) {
  const start = src.indexOf('  const k = (mac, win) =>');
  const end = src.indexOf('  let sheet = null;');
  assert.ok(start > 0 && end > start, 'shortcut sheet section found');
  const sandbox = {isMac, window: {}};
  vm.runInNewContext(src.slice(start, end) + '\nthis.groups = shortcutGroups();', sandbox);
  return sandbox.groups;
}
const rowsOf = groups => JSON.parse(JSON.stringify(groups)).flatMap(([, rows]) => rows);   // 沙箱里的数组换回本上下文，deepEqual 才不比原型
const find = (groups, label) => rowsOf(groups).find(([name]) => name === label);

test('一览列出工作台开关：Mac ⌥⌘B，其他系统 Alt+Ctrl+B', () => {
  const mac = find(groupsFor(artifacts, true), '打开 / 收起工作台');
  const win = find(groupsFor(artifacts, false), '打开 / 收起工作台');
  assert.ok(mac && win, '一览里要有「打开 / 收起工作台」');
  assert.equal(mac[1], '⌥⌘B');
  assert.equal(win[1], 'Alt+Ctrl+B');
  // 和工作台自己的判定 / 提示是同一个键：benchKey 认 KeyB + Alt + (Mac ⌘ / 其他 Ctrl)，keyLabel 把 ⌥⌘ 换成 Alt+Ctrl+
  assert.match(workbench, /benchKey = e => e\.code === 'KeyB' && e\.altKey/);
  const keyLabel = new vm.Script(workbench.match(/const keyLabel = (s => [^;]+);/)[1]);
  assert.equal(keyLabel.runInNewContext({isMac: false})('⌥⌘B'), win[1]);
  assert.equal(keyLabel.runInNewContext({isMac: true})('⌥⌘B'), mac[1]);
  // 反例：拿掉这一项，断言必须失败
  const without = artifacts.replace(", ['打开 / 收起工作台', k('⌥⌘B')]", '');
  assert.notEqual(without, artifacts, '反例没换掉');
  assert.equal(find(groupsFor(without, false), '打开 / 收起工作台'), undefined);
});

test('一览别的行没变（只多了一行）', () => {
  const now = rowsOf(groupsFor(artifacts, false)).map(([n]) => n);
  const before = rowsOf(groupsFor(artifacts.replace(", ['打开 / 收起工作台', k('⌥⌘B')]", ''), false)).map(([n]) => n);
  assert.equal(now.length, before.length + 1);
  assert.deepEqual(now.filter(n => n !== '打开 / 收起工作台'), before);
});

test('设置「通知与快捷」卡里有「全部快捷键」入口，打开的是同一张一览', () => {
  const line = settings.split('\n').find(l => l.includes('"全部快捷键"'));
  assert.ok(line, '设置页里要有「全部快捷键」按钮');
  assert.match(line, /hotkeyRow\.control/, '放在快速提问快捷键那一行里');
  assert.match(line, /window\.PinkieArtifacts\?\.openShortcuts\?\.\(\)/, '点了调用一览的 openShortcuts');
  // 一览确实把 openShortcuts 导出到 window.PinkieArtifacts
  assert.match(artifacts, /window\.PinkieArtifacts = Object\.freeze\(\{[\s\S]*?openShortcuts/);
  // 点按钮会真的走到 openShortcuts
  let called = 0;
  const onClick = new vm.Script('(' + line.match(/\(\) => void window\.PinkieArtifacts\?\.openShortcuts\?\.\(\)/)[0] + ')');
  const fn = onClick.runInNewContext({window: {PinkieArtifacts: {openShortcuts: () => { called++; }}}});
  fn();
  assert.equal(called, 1);
  // 一览没加载时点了不报错
  assert.doesNotThrow(() => onClick.runInNewContext({window: {}})());
});
