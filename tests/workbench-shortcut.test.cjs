// R5a 复发防护：工作台开关键的标签和判定要一致。
// 11-25 真页面核实：Windows 上提示写「Alt+Ctrl+B」（keyLabel 把 ⌘ 换成 Ctrl+），判定却是 altKey && metaKey，
// 真按 Alt+Ctrl+B 没反应，只有 Alt+Win+B 能开。学习台拦截同一个键时也只认 metaKey。
// 这里把两个文件里真实的判定抠出来，在 Mac / Windows 两种 navigator.platform 下各按一遍。
// 反例写在测试里：把判定换回旧的 metaKey 写法，Windows 那几条必须失败。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'ui/injections', f), 'utf8');
const WB = read('laolao-workbench.js');
const SD = read('laolao-study-desk.js');

const key = (mods) => ({code: 'KeyB', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods});
const ALT_CTRL = key({altKey: true, ctrlKey: true});
const ALT_META = key({altKey: true, metaKey: true});
const ALT_CTRL_SHIFT = key({altKey: true, ctrlKey: true, shiftKey: true});
const CTRL_B = key({ctrlKey: true});

// 工作台：抠出 isMac / benchKey 那一行，在给定平台下求值
function workbenchKey(src, platform) {
  const line = src.split('\n').find((l) => /const isMac = .*benchKey = e =>/.test(l));
  assert.ok(line, '工作台里没找到 isMac / benchKey 定义');
  return vm.runInNewContext(`${line.replace(/\/\/.*$/, '')}; benchKey`, {navigator: {platform}});
}

// 学习台：抠出 onKey 里拦 KeyB 的 if 条件
function studyDeskKey(src, platform) {
  const line = src.split('\n').find((l) => /if \(event\.altKey.*'KeyB'/.test(l));
  assert.ok(line, '学习台里没找到拦工作台快捷键的那一行');
  const cond = line.slice(line.indexOf('if (') + 4, line.indexOf(') { if (!workspace()'));
  return vm.runInNewContext(`(event) => ${cond}`, {navigator: {platform}});
}

function checkWindows(wbKey, sdKey) {
  assert.equal(wbKey(ALT_CTRL), true, 'Windows：Alt+Ctrl+B 应该开关工作台（标签就是这么写的）');
  assert.equal(wbKey(ALT_META), false, 'Windows：Alt+Win+B 不该是开法');
  assert.equal(wbKey(ALT_CTRL_SHIFT), false);
  assert.equal(wbKey(CTRL_B), false, 'Ctrl+B 是工作台里收侧栏，不能被当成开关');
  assert.equal(sdKey(ALT_CTRL), true, 'Windows：学习台要拦住 Alt+Ctrl+B（学习台页上不开工作台）');
  assert.equal(sdKey(ALT_META), false);
}

test('R5a: on Windows the workbench toggles on Alt+Ctrl+B, as its label says, and the study desk intercepts the same key', () => {
  checkWindows(workbenchKey(WB, 'Win32'), studyDeskKey(SD, 'Win32'));
});

test('R5a: on Mac it stays Option+Command+B', () => {
  const wb = workbenchKey(WB, 'MacIntel');
  const sd = studyDeskKey(SD, 'MacIntel');
  assert.equal(wb(ALT_META), true);
  assert.equal(wb(ALT_CTRL), false);
  assert.equal(sd(ALT_META), true);
  assert.equal(sd(ALT_CTRL), false);
});

test('R5a: both workbench handlers use the shared check, and the label still comes from keyLabel', () => {
  const handler = WB.slice(WB.indexOf('/* ───────── 快捷键 ───────── */'), WB.indexOf('/* ───────── 刷新与监听 ───────── */'));
  assert.equal((handler.match(/benchKey\(event\)/g) || []).length, 2, '打开和收起两处都要用 benchKey');
  assert.doesNotMatch(handler, /event\.altKey && event\.metaKey/, '快捷键里不该再有只认 metaKey 的判定');
  assert.match(WB, /keyLabel\('⌥⌘B'\)/);
});

test('R5a counter-example: the old metaKey-only checks fail the Windows assertions', () => {
  const oldWb = (e) => e.altKey && e.metaKey && e.code === 'KeyB';
  const oldSd = (e) => e.altKey && e.metaKey && e.code === 'KeyB';
  assert.throws(() => checkWindows(oldWb, oldSd), /Alt\+Ctrl\+B/);
  // 再从真文件出发：把学习台那一行换回旧写法，抠出来的判定也必须失败
  const oldSdSrc = SD.replace(/if \(event\.altKey[^\n]*?'KeyB'[^\n]*?\) \{ if \(!workspace\(\)/, "if (event.altKey && event.metaKey && event.code === 'KeyB') { if (!workspace()");
  assert.notEqual(oldSdSrc, SD);
  assert.throws(() => checkWindows(workbenchKey(WB, 'Win32'), studyDeskKey(oldSdSrc, 'Win32')), /学习台/);
});

test('R5a: the welcome line does not print "undefined" when the gateway gives no root', () => {
  const line = WB.split('\n').find((l) => l.includes("'pk-wb-welcome__sub'"));
  assert.ok(line);
  const expr = line.slice(line.indexOf("'pk-wb-welcome__sub', ") + "'pk-wb-welcome__sub', ".length, line.lastIndexOf(');'));
  const sub = (info) => vm.runInNewContext(expr, {state: {info}});
  assert.equal(sub({bound: false}), '工作区');
  assert.equal(sub({bound: true, root: 'C:/proj'}), '项目文件夹 · C:/proj');
  assert.equal(sub({bound: false, root: '/home/u/ws'}), '工作区 · /home/u/ws');
  assert.equal(sub({error: '连不上'}), '连不上');
  assert.equal(sub(null), '正在连接…');
});
