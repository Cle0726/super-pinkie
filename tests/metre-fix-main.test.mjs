// 11-24 ui2：main 上已有的 Metre 界面缺陷（队列-1124.md「协调者 08:35」1、2、4–7 条）的复发测试。
// 第 3 条「在奏 undefined」由 #67 在改，这里不测。第 2 条（1024 菜单标题和正文压字）实测是不透明菜单盖在正文上、走查误报，
// 和第 1 条同一处修法（菜单不再压到输入框上方以外的正文区以下），一起由第一组用例守住。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

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
  return new Function(`${src}\nreturn {word};`)();
}
test('Metre 措辞：Configure / Manage / Browse / Connect → 换成中文，保留两边空白；别的英文不动', () => {
  const {word} = loadWord();
  assert.equal(word('Configure →'), '设置 →');
  assert.equal(word('\n   Manage →\n  '), '\n   管理 →\n  ');
  assert.equal(word('Browse →'), '浏览 →');
  assert.equal(word('Connect →'), '连接 →');
  assert.equal(word('Configure the gateway'), 'Configure the gateway');
  assert.equal(word('Connect'), 'Connect');
});
test('Metre 措辞：原生设置页在改写范围里；不靠点击补找，等根节点出现再挂（直接打开、刷新设置页时根节点比脚本晚）', () => {
  const js = inj('laolao-metre-skin.js');
  assert.match(js, /const SCOPE = '[^']*openclaw-config-page/);
  assert.match(js, /window\.Pinkie\?\.domWatch\?\.watch\(SCOPE, attach\)/, '要经已有的 domWatch.watch 等根节点出现');
  assert.doesNotMatch(js, /setTimeout\(attach/, '不再靠点击 / popstate 之后的定时补找');
});

// 真浏览器：先装脚本、后出设置页根节点（等同直接打开 /settings/general 或在设置页刷新），英文链接也要换掉；离开 Metre 换回。
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
test(`Metre 措辞（真浏览器）：设置页根节点晚于脚本出现时，Configure → 也换成中文 (${engine})`, {timeout: 30_000}, async () => {
  const browser = await launch();
  try {
    const tab = await browser.newPage();
    await tab.route('http://127.0.0.1:30117/**', (route) => route.fulfill({contentType: 'text/html', body: '<!doctype html><html data-laolao-mode="metre"><head><title>超級碧琪</title></head><body><main id="app"></main></body></html>'}));
    await tab.goto('http://127.0.0.1:30117/settings/general');
    await tab.addScriptTag({path: path.join(root, 'ui', 'injections', 'laolao-dom-watch.js')});
    await tab.addScriptTag({path: path.join(root, 'ui', 'injections', 'laolao-metre-skin.js')});
    await tab.waitForTimeout(150);
    await tab.evaluate(() => { document.querySelector('#app').innerHTML = '<openclaw-config-page><button class="qs-link-btn">Configure →</button><a> Manage → </a><span>Configure the gateway</span></openclaw-config-page>'; });
    await tab.waitForFunction(() => document.querySelector('.qs-link-btn')?.textContent === '设置 →', null, {timeout: 3000});
    assert.equal(await tab.evaluate(() => document.querySelector('openclaw-config-page a').textContent), ' 管理 → ');
    assert.equal(await tab.evaluate(() => document.querySelector('openclaw-config-page span').textContent), 'Configure the gateway');
    // 设置页重新渲染出新的根节点（路由切回来）：同样换掉
    await tab.evaluate(() => { document.querySelector('#app').innerHTML = '<openclaw-config-page><button class="qs-link-btn">Browse →</button></openclaw-config-page>'; });
    await tab.waitForFunction(() => document.querySelector('.qs-link-btn')?.textContent === '浏览 →', null, {timeout: 3000});
    // 离开 Metre：换回英文，之后新出的根节点不再改
    await tab.evaluate(() => document.documentElement.setAttribute('data-laolao-mode', 'classic'));
    await tab.waitForFunction(() => document.querySelector('.qs-link-btn')?.textContent === 'Browse →', null, {timeout: 3000});
    await tab.evaluate(() => { document.querySelector('#app').innerHTML = '<openclaw-config-page><button class="qs-link-btn">Connect →</button></openclaw-config-page>'; });
    await tab.waitForTimeout(300);
    assert.equal(await tab.evaluate(() => document.querySelector('.qs-link-btn').textContent), 'Connect →');
  } finally { await browser.close(); }
});

// ---- 缺陷 6：820 宽能力卡说明不被省略号截掉 ----
test('设置页（Metre）：能力卡说明折行，不用省略号', () => {
  assert.match(inj('laolao-metre-skin.css'), /html\[data-laolao-mode="metre"\][^{]*#laolao-user-settings \.pk-cap__recipe-copy small \{ white-space: normal; overflow: visible; text-overflow: clip;/);
});

// ---- 缺陷 7：模式切换卡不压住连接灯 ----
// 真浏览器：经典壳的 .sidebar-brand__identity > .laolao-mode-switcher 带 min-width: 126px，会盖过 Metre 的 width。
// 两份样式一起加载，量卡的真实宽度，算上悬停投影，灯要在卡右边、又不碰底栏的全屏键（x155）。
test(`侧栏（Metre，真浏览器）：模式切换卡真实宽度 + 投影在连接灯左边，灯不碰全屏键 (${engine})`, {timeout: 30_000}, async () => {
  const css = inj('laolao-metre-skin.css');
  const lamp = css.match(/aside\.sidebar:not\(\.sidebar--collapsed\) \.pinkie-connection-status \{ left: (\d+)px !important; top: 16px/);
  assert.ok(lamp, '找不到连接灯位置的规则');
  const browser = await launch();
  try {
    const tab = await browser.newPage({viewport: {width: 1024, height: 768}});
    const page = [
      '<!doctype html><html data-laolao-mode="metre" data-laolao-classic-shell="1"><body style="margin:0">',
      '<aside class="sidebar" style="position:relative;width:260px;height:600px"><div class="sidebar-brand__identity" style="display:flex">',
      '<button class="laolao-mode-switcher laolao-mode-button--plain"><span class="laolao-mode-button__label">Metre</span></button>',
      '</div></aside></body></html>',
    ].join('');
    await tab.route('http://127.0.0.1:30118/**', (route) => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30118/');
    for (const name of ['laolao-classic-shell.css', 'laolao-metre-skin.css']) await tab.addStyleTag({path: path.join(root, 'ui', 'injections', name)});
    const width = await tab.evaluate(() => document.querySelector('.laolao-mode-switcher').getBoundingClientRect().width);
    const cardRight = 16 + width + 4;   // 卡在 aside x16 起；悬停投影 4px
    const lampLeft = 12 + Number(lamp[1]);   // 灯在底栏坐标系，底栏 x12
    assert.ok(lampLeft >= cardRight, `卡真实宽 ${width}px，灯 x${lampLeft} 压在卡（含投影到 x${cardRight}）上`);
    assert.ok(lampLeft + 10 <= 155, `灯 x${lampLeft}..${lampLeft + 10} 碰到了全屏键（x155）`);
  } finally { await browser.close(); }
});
