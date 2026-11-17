const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const css = read('ui/injections/laolao-metre-skin.css');
const ask = read('ui/injections/laolao-ask-user.js');
const tray = read('ui/injections/laolao-composer-tray.js');
const companion = read('ui/injections/laolao-companion.js');
const run = read('ui/injections/laolao-run-status.js');

test('Metre owns expanded and collapsed sidebar icon geometry and neutral thinking cards', () => {
  const section = css.slice(css.indexOf('真机回归修复（11-16）'));
  assert.match(section, /aside\.sidebar\.sidebar--collapsed :is\(\.sidebar-brand__collapse, \.sidebar-collapse\)/);
  assert.match(section, /\.sidebar-brand__icon\)/);
  assert.match(section, /\.pinkie-thinking__label/);
  assert.match(section, /\.pinkie-thinking__text/);
  assert.match(section, /--pt-label: var\(--metre-muted\)/);
  assert.match(section, /#pk-run :is\(\.pk-run__dot, \.pk-metre-cat--dot\).*display: none/);
  assert.doesNotMatch(section, /pinkie-thinking__label[\s\S]{0,200}#e18bad/);
});

test('Metre sidebar head uses the real native DOM hooks: dock trigger, toggle and temp entry', () => {
  const fix = css.slice(css.indexOf('真机核对（11-16 下午）'));
  assert.ok(fix.length > 100, 'real-app sidebar fix section exists');
  // Glass dock trigger exists only inside the native shell; Metre flattens it and moves it off the search button.
  assert.match(fix, /aside\.sidebar \.laolao-mode-dock-trigger \{\n  all: unset !important;/);
  assert.match(fix, /aside\.sidebar:not\(\.sidebar--collapsed\) \.laolao-mode-dock-trigger \{[^}]*position: absolute !important;[^}]*right: 20px !important;/);
  // Collapse toggle shares .sidebar-brand__icon with search; it must get the panel glyph, not the plus.
  assert.match(fix, /\.sidebar-brand__icon\[data-pinkie-sidebar-toggle\] \{\n  --metre-glyph: url\([^)]*M14 9l-3 3 3 3/);
  assert.match(fix, /\[data-pinkie-sidebar-peek="1"\] aside\.sidebar \.sidebar-brand__icon\[data-pinkie-sidebar-toggle\],\n[^{]*sidebar--collapsed \.sidebar-brand__icon\[data-pinkie-sidebar-toggle\] \{\n  --metre-glyph: url\([^)]*M11 9l3 3-3 3/);
  // Temp entry: a 'none' glyph turns the mask off and paints a solid square.
  assert.match(fix, /\.pinkie-temp-entry \{ --metre-glyph: var\(--metre-ic-temp\); \}/);
  // Peek card and narrow drawer sit above the run strip.
  assert.match(fix, /\[data-pinkie-sidebar-peek="1"\] \.pk-run,\n[^{]*:has\(\.shell--nav-drawer-open\) \.pk-run \{ z-index: 0 !important; \}/);
});

test('Metre has no Pinkie ask card, answer prefix or selection action', () => {
  assert.match(ask, /\?\s*"【回答提问】" : "【回答碧琪的提问】"/);
  assert.match(ask, /metre \? "需要你的选择" : "碧琪想问你"/);
  assert.match(ask, /metre \? \[who\] : \[face, who\]/);
  assert.match(companion, /data-laolao-mode"\) !== "metre"[\s\S]{0,120}!desk/);
  assert.match(css, /\.pinkie-buddy-ask \{ display: none !important; \}/);
});

test('ask card and tray use visual viewport bounds instead of forced offscreen sizes', () => {
  for (const source of [ask, tray]) {
    assert.match(source, /window\.visualViewport/);
    assert.match(source, /const above = Math\.max\(0,/);
    assert.match(source, /const below = Math\.max\(0,/);
    assert.match(source, /const available = Math\.max\(0,/);
  }
  assert.match(ask, /card\.style\.maxHeight = `\$\{Math\.floor\(available\)\}px`/);
  assert.match(tray, /menu\.style\.maxHeight = Math\.floor\(available\) \+ 'px'/);
  assert.doesNotMatch(tray, /Math\.max\(160, Math\.round/);
});

test('chat clearance follows the real composer and run status height', () => {
  assert.match(run, /--metre-run-space/);
  assert.match(run, /window\.innerHeight - rect\.top \+ \(bar\.hidden \? 28 : 78\)/);
  assert.match(css, /padding-bottom: var\(--metre-run-space, 190px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-height: 640px\)/);
});

test('Metre process card title carries no Pinkie name; other modes keep theirs', () => {
  const fs = require('node:fs');
  for (const file of ['patch/apply-chat-timeline.mjs', 'ui/runtime/chat-page-DrPkxqJK.js']) {
    const src = fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
    assert.match(src, /const metreSession = \/\^agent:metre:\/\.test\(routedSession\);/, file);
    assert.match(src, /live \? \(metreSession \? '正在处理' : '碧琪正在干活'\)/, file);
    assert.match(src, /metreSession \? '工作过程' : '碧琪的工作过程'/, file);
  }
});

// 11-16 夜（用户截图）：碧琪素材没改干净、思考滑块太简陋、按键涂层不对、悬停重复介绍、总控台要有自己的话
test('Metre third real-app pass: no pink dialog / toast / tooltip, flat mode card, tempo slider, no repeat tooltips, the console speaks in score terms', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.resolve(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const css = read('ui/injections/laolao-metre-skin.css');
  const M = 'html[data-laolao-mode="metre"]:not(#_m1):not(#_m2):not(#_m3):not(#_m4)';
  for (const sel of ['.laolao-modal {', '.laolao-modal__btn--danger', '.laolao-toast {', '.pinkie-sidebar-tooltip {']) assert.ok(css.includes(`${M} ${sel}`), sel);
  assert.match(css, /\.laolao-mode-button--plain:is\(:hover, :focus-visible, :active, \[aria-expanded="true"\]\) \{\n  box-shadow: none !important; transform: none !important;/, '模式黑卡不再有钴蓝硬投影');
  assert.match(css, /\.pinkie-reasoning-current\[data-metre-tempo\]::before \{ content: attr\(data-metre-tempo\)/, '思考强度显示速度记号');
  assert.match(css, /reasoning-range::-webkit-slider-thumb[\s\S]{0,400}M4 0h6v2h1v3h1v4h1v5H1V9h1V5h1V2h1z/, '滑块是节拍器的梯形摆锤');
  assert.match(css, /-webkit-mask: none !important; mask: none !important;/, '去掉碧琪的菱形遮罩');
  const skin = read('ui/injections/laolao-metre-skin.js');
  assert.match(skin, /high: \['Andante', 88\]/);
  assert.match(skin, /adaptive: \['Rubato', 0\]/, 'Adaptive = Rubato');
  assert.match(skin, /addEventListener\('pointerover'[\s\S]{0,300}showsItsText\(el\)/, '写着字的按钮悬停不弹 title');
  assert.match(read('ui/injections/laolao-sidebar.js'), /data-laolao-mode'\)==='metre'&&\(window\.__pinkieMetreShowsText/, '侧栏提示同样判断');
  const board = read('ui/injections/laolao-metre-board.js');
  for (const word of ['总控台', '暂停派发', '全部停下', '派发中']) assert.ok(!board.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').includes(word), `总谱里不再出现「${word}」`);
  for (const word of ['总谱', '暂停分谱', '全体收住', '在奏 · 等你 · 已收', '声部']) assert.ok(board.includes(word), word);
  assert.doesNotMatch(board, /btn\.title = '总/, '侧栏入口不再挂一段介绍');
  // 模型不挂 AI 品牌标：模型键、列表行一律是 Metre 的像素 M；品牌筛选写字
  assert.match(css, /summary\.chat-controls__inline-select-trigger::before,[\s\S]{0,600}background: var\(--metre-mode-mark\)/);
  assert.match(css, /\.pinkie-model-filter::before \{ display: none !important;/);
});
