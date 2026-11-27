// L38（T3 #26）：Metre 里快捷键一览和实际按键对上（ui/injections/laolao-metre-keymap.js），不起浏览器。
// 1) 单按 ? 打开同一张一览（openShortcuts），输入框 / 编辑器里 / 开着模态弹层时不拦；
// 2) Windows / Linux 的 Ctrl+B 真能显示 / 隐藏侧栏（原生 ⌘B 只认 metaKey）；
// 3) 一览补上 K3 / K2 / ?，发送键偏好为 Ctrl/⌘+Enter 时发送 / 换行按偏好写；
// 4) 注入对照：其他五个模式下一览是同一个数组、按键一个都不拦。
// 每条都带反例：只去掉对应的修复，断言必须失败。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INJ = path.join(ROOT, 'ui/injections');
const read = (file) => fs.readFileSync(path.join(INJ, file), 'utf8');
const SRC = read('laolao-metre-keymap.js');
const ARTIFACTS = read('laolao-artifacts.js');
const WORKSPACE = read('laolao-metre-workspace.js');
const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted', 'metre'];
const OTHER_MODES = MODES.filter((m) => m !== 'metre');
const plain = (v) => JSON.parse(JSON.stringify(v));

function el(matches = []) {
  return {closest: (sel) => (matches.some((m) => sel.split(',').map((s) => s.trim()).includes(m)) ? {} : null)};
}
const BODY = el();
const TEXTAREA = el(['textarea']);
const MONACO = el(['.monaco-editor']);

function load({mode = 'metre', mac = false, modal = false, shell = true, sendKey = null, src = SRC} = {}) {
  const listeners = {window: [], document: []};
  const calls = {open: 0, toggle: 0};
  const store = new Map(sendKey ? [['pinkie.metre.prefs.sendKey', sendKey]] : []);
  const app = shell ? {toggleNavigationSurface: () => { calls.toggle += 1; }} : null;
  const document = {
    documentElement: {getAttribute: (k) => (k === 'data-laolao-mode' ? mode : null)},
    querySelector: (sel) => {
      if (sel === 'openclaw-app-shell') return app;
      if (sel.includes('aria-modal')) return modal ? {} : null;
      return null;
    },
    addEventListener: (type, fn, capture) => listeners.document.push({type, fn, capture: Boolean(capture)}),
  };
  const window = {
    navigator: {platform: mac ? 'MacIntel' : 'Win32'},
    localStorage: {getItem: (k) => store.get(k) ?? null},
    PinkieArtifacts: {openShortcuts: () => { calls.open += 1; return Promise.resolve(null); }},
    addEventListener: (type, fn, capture) => listeners.window.push({type, fn, capture: Boolean(capture)}),
  };
  vm.runInNewContext(src, {window, document});
  const press = (init) => {
    const event = {key: '', target: BODY, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false,
      keyCode: 0, defaultPrevented: false, ...init, preventDefault() { this.defaultPrevented = true; }};
    for (const scope of ['window', 'document']) for (const {type, fn} of listeners[scope]) if (type === 'keydown') fn(event);
    return event;
  };
  return {window, listeners, calls, press, api: window.Pinkie.metreKeymap};
}

// laolao-artifacts.js 里真的 shortcutGroups()（和 K4 测试同一种切法）
function realGroups(isMac) {
  const start = ARTIFACTS.indexOf('  const k = (mac, win) =>');
  const end = ARTIFACTS.indexOf('  let sheet = null;');
  assert.ok(start > 0 && end > start, 'shortcut sheet section found');
  const sandbox = {isMac, window: {}};
  vm.runInNewContext(ARTIFACTS.slice(start, end) + '\nthis.groups = shortcutGroups();', sandbox);
  return sandbox.groups;
}
const rows = (groups) => plain(groups).flatMap(([title, list]) => list.map(([label, keys]) => [title, label, keys]));
const row = (groups, label) => rows(groups).find(([, l]) => l === label);

test('? 在 Metre 里打开快捷键一览，并拦住原生「打字就聚焦输入框」', () => {
  const h = load();
  const e = h.press({key: '?', shiftKey: true});
  assert.equal(h.calls.open, 1, '按 ? 要调 openShortcuts');
  assert.equal(e.defaultPrevented, true, '要 preventDefault，原生才不会把 ? 打进输入框');
  // 挂在 window 捕获阶段：比 document 捕获阶段的原生聚焦先跑
  assert.ok(h.listeners.window.some((l) => l.type === 'keydown' && l.capture && l.fn === h.api.question));
  // 原生聚焦处理先看 defaultPrevented（ui/runtime 里的真实代码）
  const chat = fs.readdirSync(path.join(ROOT, 'ui/runtime')).find((f) => /^chat-page-.*\.js$/.test(f));
  assert.match(fs.readFileSync(path.join(ROOT, 'ui/runtime', chat), 'utf8'), /handleDocumentKeydown=e=>\{if\(this\.active&&!e\.defaultPrevented&&/);
  // 再按一次 = 再调一次（openShortcuts 自己负责开着时收起）
  h.press({key: '?', shiftKey: true});
  assert.equal(h.calls.open, 2);
  // 反例：去掉 ? 的监听，按 ? 就不再打开
  const without = SRC.replace("  window.addEventListener('keydown', question, true);\n", '');
  assert.notEqual(without, SRC, '反例没换掉');
  const r = load({src: without});
  r.press({key: '?', shiftKey: true});
  assert.equal(r.calls.open, 0);
});

test('? 在输入框、编辑器、模态弹层、输入法组字时照常是一个字', () => {
  for (const [why, init, opts] of [
    ['输入框', {target: TEXTAREA}, {}],
    ['代码编辑器', {target: MONACO}, {}],
    ['模态弹层', {}, {modal: true}],
    ['输入法组字', {isComposing: true}, {}],
    ['按住不放', {repeat: true}, {}],
    ['带 Ctrl', {ctrlKey: true}, {}],
    ['已被别人处理', {defaultPrevented: true}, {}],
  ]) {
    const h = load(opts);
    const e = h.press({key: '?', shiftKey: true, ...init});
    assert.equal(h.calls.open, 0, why);
    if (!init.defaultPrevented) assert.equal(e.defaultPrevented, false, why);
  }
  // 反例：去掉输入框判断，输入框里按 ? 就会被拦
  const without = SRC.replace('inside(event.target, TYPING) || ', '');
  assert.notEqual(without, SRC, '反例没换掉');
  const r = load({src: without});
  r.press({key: '?', shiftKey: true, target: TEXTAREA});
  assert.equal(r.calls.open, 1);
});

test('Windows / Linux 上 Ctrl+B 显示 / 隐藏侧栏（原生只认 ⌘B）', () => {
  // 原生 openclaw-app-shell：⌘B 处理里 !e.metaKey 直接返回，所以 Ctrl+B 原来没反应
  const index = fs.readdirSync(path.join(ROOT, 'ui/runtime')).find((f) => /^index-.*\.js$/.test(f));
  const nativeSrc = fs.readFileSync(path.join(ROOT, 'ui/runtime', index), 'utf8');
  assert.match(nativeSrc, /handleDocumentKeydown=e=>\{e\.defaultPrevented\|\|e\.altKey\|\|e\.shiftKey\|\|!e\.metaKey\|\|e\.ctrlKey\|\|e\.key\.toLowerCase\(\)!==`b`/);
  assert.match(nativeSrc, /toggleNavigationSurface\(e\)\{/);
  const h = load();
  const e = h.press({key: 'b', ctrlKey: true});
  assert.equal(h.calls.toggle, 1);
  assert.equal(e.defaultPrevented, true);
  // Mac 不动（原生 ⌘B 自己管）；工作台先处理过的 Ctrl+B 不动；编辑器里不动；带 Shift/Alt 不动
  for (const [why, init, opts] of [
    ['Mac', {}, {mac: true}],
    ['工作台已处理', {defaultPrevented: true}, {}],
    ['编辑器里', {target: MONACO}, {}],
    ['Ctrl+Shift+B', {shiftKey: true}, {}],
    ['Ctrl+Alt+B', {altKey: true}, {}],
    ['原生壳不在', {}, {shell: false}],
  ]) {
    const r = load(opts);
    r.press({key: 'b', ctrlKey: true, ...init});
    assert.equal(r.calls.toggle, 0, why);
  }
  // 反例：去掉 Ctrl+B 的监听，Ctrl+B 又没反应
  const without = SRC.replace("  document.addEventListener('keydown', sidebar, false);\n", '');
  assert.notEqual(without, SRC, '反例没换掉');
  const r = load({src: without});
  r.press({key: 'b', ctrlKey: true});
  assert.equal(r.calls.toggle, 0);
});

test('一览补上 K3 / K2 / ?，和 laolao-metre-workspace.js 的实际按键一致', () => {
  // 实际按键：K3 ⌘/Ctrl+Digit1-9、Ctrl+Tab / Ctrl+Shift+Tab；K2 Esc 停止、0.5 秒内连按两下清空
  assert.match(WORKSPACE, /\/\^Digit\[1-9\]\$\/\.test\(event\.code/);
  assert.match(WORKSPACE, /event\.ctrlKey && !event\.metaKey && event\.key === 'Tab'\) return \{step: event\.shiftKey \? -1 : 1\}/);
  assert.match(WORKSPACE, /chat-send-btn--stop/);
  assert.match(WORKSPACE, /DOUBLE_ESC_MS = 500/);
  for (const mac of [false, true]) {
    const h = load({mac});
    const got = h.api.groups(realGroups(mac));
    assert.deepEqual(row(got, '打开侧栏第 1–9 个会话'), ['会话', '打开侧栏第 1–9 个会话', mac ? '⌘1 … ⌘9' : 'Ctrl+1 … Ctrl+9']);
    assert.deepEqual(row(got, '下一个 / 上一个会话'), ['会话', '下一个 / 上一个会话', mac ? '⌃Tab / ⌃⇧Tab' : 'Ctrl+Tab / Ctrl+Shift+Tab']);
    assert.deepEqual(row(got, '停止正在回答的这一轮'), ['输入框', '停止正在回答的这一轮', 'Esc']);
    assert.deepEqual(row(got, '清空输入框'), ['输入框', '清空输入框', 'Esc 连按两下']);
    assert.deepEqual(row(got, '快捷键一览'), ['全局', '快捷键一览', (mac ? '⌘/' : 'Ctrl+/') + ' · ?']);
    assert.deepEqual(row(got, '发送'), ['输入框', '发送', 'Enter'], '默认发送键不变');
    // 原有每一行都还在、顺序不变，只多了 4 行
    const before = rows(realGroups(mac)).map(([t, l]) => t + '/' + l);
    const after = rows(got).map(([t, l]) => t + '/' + l);
    assert.equal(after.length, before.length + 4);
    assert.deepEqual(after.filter((x) => before.includes(x)), before);
  }
  // 反例：去掉 K3 补行，一览里就没有
  const without = SRC.replace(/      '会话': \[[\s\S]*?\n      \],\n/, '');
  assert.notEqual(without, SRC, '反例没换掉');
  assert.equal(row(load({src: without}).api.groups(realGroups(false)), '打开侧栏第 1–9 个会话'), undefined);
});

test('选了「Ctrl / ⌘ + Enter 发送」时，发送 / 换行两行按偏好写', () => {
  // 和 laolao-metre-prefs.js 是同一个键、同一个值
  const prefs = read('laolao-metre-prefs.js');
  assert.match(prefs, /const SEND_KEY = 'pinkie\.metre\.prefs\.sendKey'/);
  assert.match(prefs, /sendKey\(\) !== 'modifier-enter'\) return;/);
  for (const mac of [false, true]) {
    const got = load({mac, sendKey: 'modifier-enter'}).api.groups(realGroups(mac));
    assert.deepEqual(row(got, '发送'), ['输入框', '发送', mac ? '⌘Enter' : 'Ctrl+Enter']);
    assert.deepEqual(row(got, '换行'), ['输入框', '换行', mac ? 'Enter · ⇧Enter' : 'Enter · Shift+Enter']);
  }
  // 反例：不看偏好，发送行就还是 Enter
  const without = SRC.replace("sendKey() === 'modifier-enter'\n      ?", "false\n      ?");
  assert.notEqual(without, SRC, '反例没换掉');
  assert.deepEqual(row(load({sendKey: 'modifier-enter', src: without}).api.groups(realGroups(false)), '发送'), ['输入框', '发送', 'Enter']);
});

test('注入对照：其他五个模式下一览原样（同一个数组）、? 和 Ctrl+B 一个都不拦', () => {
  for (const mode of OTHER_MODES) {
    for (const mac of [false, true]) {
      const h = load({mode, mac, sendKey: 'modifier-enter'});
      const list = realGroups(mac);
      const got = h.api.groups(list);
      assert.equal(got, list, `${mode}: 返回同一个数组`);
      assert.equal(JSON.stringify(got), JSON.stringify(realGroups(mac)), `${mode}: 逐字节不变`);
      const q = h.press({key: '?', shiftKey: true});
      const b = h.press({key: 'b', ctrlKey: true});
      assert.equal(h.calls.open + h.calls.toggle, 0, mode);
      assert.equal(q.defaultPrevented || b.defaultPrevented, false, mode);
    }
  }
  // 反例：去掉 groups 里的 Metre 判断，其他模式的一览就变了
  const without = SRC.replace('if (!isMetre() || !Array.isArray(list)) return list;', 'if (!Array.isArray(list)) return list;');
  assert.notEqual(without, SRC, '反例没换掉');
  const list = realGroups(false);
  assert.notEqual(JSON.stringify(load({mode: 'chat', src: without}).api.groups(list)), JSON.stringify(list));
});

test('一览画表时交给 Metre 补行；补行没加载时照旧画原表', () => {
  const line = ARTIFACTS.split('\n').find((l) => l.includes('for (const [title, rows] of ('));
  assert.ok(line, 'openShortcuts 画表那一行');
  const expr = line.match(/of (\(window\.Pinkie\?\.metreKeymap\?\.groups\?\.\(shortcutGroups\(\)\) \|\| shortcutGroups\(\)\))\)/)[1];
  const list = [['全局', [['快捷键一览', 'Ctrl+/']]]];
  const run = (window) => vm.runInNewContext(expr, {window, shortcutGroups: () => list});
  assert.equal(run({}), list, '没加载 laolao-metre-keymap.js 时原表');
  const h = load();
  assert.deepEqual(plain(run(h.window)), [['全局', [['快捷键一览', 'Ctrl+/ · ?']]]]);
  assert.equal(run(load({mode: 'chat'}).window), list);
});

test('新注入文件登记：头片段（?v=@hash）+ metre 区域，没有新观察器 / 定时器 / window.__ 全局名', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<script defer src="\/laolao-metre-keymap\.js\?v=@hash"><\/script>/);
  const regions = JSON.parse(read('regions.json'));
  const metre = (regions.regions || regions).find((r) => r.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-keymap.js'));
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /MutationObserver|setInterval|setTimeout|domWatch|window\.__|!important/);
  assert.ok(SRC.split('\n').length <= 1500);
});
