// 11-24 ui2：main 上已有的 Metre 界面缺陷（队列-1124.md「协调者 08:35」1、2、4–7 条）的复发测试。
// 第 3 条「在奏 undefined」由 #67 在改，这里不测。第 2 条（1024 菜单标题和正文压字）实测是不透明菜单盖在正文上、走查误报，
// 和第 1 条同一处修法（菜单不再压到输入框上方以外的正文区以下），一起由第一组用例守住。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const between = (text, from, to) => {
  const a = text.indexOf(from); assert.ok(a >= 0, `找不到「${from}」`);
  const b = text.indexOf(to, a); assert.ok(b > a, `找不到「${to}」`);
  return text.slice(a, b);
};

// ---- 缺陷 1 / 2：引擎菜单不压住输入框；放不下就限高、菜单里滚动 ----
function loadPosition() {
  const src = between(inj('laolao-metre-engine.js'), 'function position(anchor, node) {', '\n  function place(');
  return (vw, vh) => new Function('innerWidth', 'innerHeight', `${src}\nreturn position;`)(vw, vh);
}
function fakeMenu(contentHeight) {
  const style = {};
  return {style, offsetWidth: 320, get offsetHeight() { const m = parseFloat(style.maxHeight); return Number.isFinite(m) ? Math.min(m, contentHeight) : contentHeight; }};
}
function fakeChip(chipTop, inputTop) {
  const rect = (top, h) => ({top, bottom: top + h, left: 140, right: 240, width: 100, height: h});
  const input = {getBoundingClientRect: () => rect(inputTop, 120)};
  return {getBoundingClientRect: () => rect(chipTop, 28), closest: (sel) => (sel === '.agent-chat__input' ? input : null)};
}

for (const [label, vw, vh, chipTop, inputTop, content] of [
  ['1024x768', 1024, 768, 703, 648, 595],
  ['1440x900', 1440, 900, 835, 780, 595],
  ['820x720', 820, 720, 655, 600, 595],
  ['矮窗 820x560', 820, 560, 495, 440, 595],
]) {
  test(`引擎菜单 ${label}：下沿不越过输入框上沿，放不下时限高可滚动，不出窗口`, () => {
    const node = fakeMenu(content);
    loadPosition()(vw, vh)(fakeChip(chipTop, inputTop), node);
    const top = parseFloat(node.style.top); const bottom = top + node.offsetHeight;
    assert.ok(top >= 12, `菜单顶 ${top} 出了窗口`);
    assert.ok(bottom <= inputTop - 8, `菜单底 ${bottom} 压住了输入框（上沿 ${inputTop}）`);
    if (content > inputTop - 20) assert.ok(parseFloat(node.style.maxHeight) <= inputTop - 20, '放不下时要限高，靠菜单自己的滚动看全');
  });
}

// ---- 缺陷 4：总谱两列时「排练记录」「调音」各占一整行；一列时复位 ----
test('总谱：两列（按总谱自己的宽度）时 runtime / raw 卡跨两列，一列时复位，不留隐形第二列', () => {
  const css = inj('laolao-metre-board.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const two = between(css, '@container metre-board (max-width: 1100px) {', '\n}');
  assert.match(two, /\[data-metre-slot="runtime"\], \[data-metre-slot="raw"\]\)\s*\{\s*grid-column: span 2;/);
  const one = between(css, '@container metre-board (max-width: 720px) {', '\n}');
  assert.match(one, /\[data-metre-slot="runtime"\], \[data-metre-slot="raw"\]\)\s*\{\s*grid-column: auto;/,
    '一列时不复位，span 2 会撑出 0px 的隐形第二列（1024 停靠时实测过）');
  const media = between(css, '@media (max-width: 1100px) {', '\n}');
  assert.doesNotMatch(media, /data-metre-slot/, '跨列规则要跟着总谱自己的宽度（容器查询），不能跟窗口宽度');
});

test('设置页（Metre）：「助手身份」卡按自己内容高，不被旁边的卡撑成大框', () => {
  assert.match(inj('laolao-metre-skin.css'), /html\[data-laolao-mode="metre"\][^{]*\.qs-identity-grid \{ align-items: start; \}/);
});

// ---- 缺陷 5：原生设置页的英文链接键在 Metre 里换成中文 ----
function loadWord() {
  const src = between(inj('laolao-metre-skin.js'), '  const RULES = [', '\n  // 记下换过的地方');
  return new Function(`${src}\nreturn {word, hit};`)();
}
test('Metre 措辞：Configure / Manage / Browse / Connect → 换成中文，保留两边空白；别的英文不动', () => {
  const {word, hit} = loadWord();
  assert.equal(word('Configure →'), '设置 →');
  assert.equal(word('\n   Manage →\n  '), '\n   管理 →\n  ');
  assert.equal(word('Browse →'), '浏览 →');
  assert.equal(word('Connect →'), '连接 →');
  assert.equal(word('Configure the gateway'), 'Configure the gateway');
  assert.ok(hit(' Connect → ') && hit('碧琪') && !hit('Connect'));
});
test('Metre 措辞：原生设置页在改写范围里，点完设置后会再找几次（原生页约 170ms 后才出来）', () => {
  const js = inj('laolao-metre-skin.js');
  assert.match(js, /const SCOPE = '[^']*openclaw-config-page/);
  const retry = js.match(/addEventListener\('click', \(\) => \{ if \(isMetre\(\)\) for \(const ms of \[([\d, ]+)\]\) setTimeout\(attach, ms\)/);
  assert.ok(retry, '点击后要多次重试 attach');
  assert.ok(Math.max(...retry[1].split(',').map(Number)) >= 250, '最晚一次要晚于原生设置页出现的时间');
});

// ---- 缺陷 6：820 宽能力卡说明不被省略号截掉 ----
test('设置页（Metre）：能力卡说明折行，不用省略号', () => {
  assert.match(inj('laolao-metre-skin.css'), /html\[data-laolao-mode="metre"\][^{]*#laolao-user-settings \.pk-cap__recipe-copy small \{ white-space: normal; overflow: visible; text-overflow: clip;/);
});

// ---- 缺陷 7：模式切换卡不压住连接灯 ----
test('侧栏（Metre）：模式切换卡右沿 + 投影在连接灯左边，灯不出底栏全屏键的位置', () => {
  const css = inj('laolao-metre-skin.css');
  const sel = 'aside.sidebar:not(.sidebar--collapsed) ';
  const card = css.match(new RegExp(sel.replace(/[.()]/g, '\\$&') + '\\.laolao-mode-switcher\\.laolao-mode-button--plain \\{ width: (\\d+)px'));
  const lamp = css.match(new RegExp(sel.replace(/[.()]/g, '\\$&') + '\\.pinkie-connection-status \\{ left: (\\d+)px !important; top: 16px'));
  assert.ok(card && lamp, '找不到模式切换卡宽度或连接灯位置的规则');
  const cardRight = 16 + Number(card[1]) + 4;   // 卡在 aside x16 起；悬停投影 4px
  const lampLeft = 12 + Number(lamp[1]);         // 灯在底栏坐标系，底栏 x12
  assert.ok(lampLeft >= cardRight, `灯 x${lampLeft} 压在卡（含投影到 x${cardRight}）上`);
  assert.ok(lampLeft + 10 <= 155, `灯 x${lampLeft}..${lampLeft + 10} 碰到了全屏键（x155）`);
});
