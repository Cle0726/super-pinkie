// B25（backlog，uireview #111 记）：共享设置键 .pinkie-user-settings__button 描边对卡片只有 日 1.24 / 夜 1.69:1，键像没有边。
// 修法在 laolao-settings-user.css：加按键专用变量 --pinkie-settings-button-edge（日 #b5698f、夜 #a8738f），只给 __button 用；
// 共享 --pinkie-settings-border 不动（卡片边、分隔线、别的控件也用）。--primary 自带描边、悬停规则、Metre（skin.css 自带 !important 描边）都不变。
// 真浏览器：日 / 夜量键描边颜色和对卡片、键底的对比度；Metre 一并加载 skin.css 看描边仍走 Metre 色板。
// 反例：页面上删掉 __button 那条里的 border-color，描边退回原来的淡粉（< 3:1）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (f) => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + f, import.meta.url)), 'utf8');
const css = read('laolao-settings-user.css');
const skin = read('laolao-metre-skin.css');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

// sRGB 相对亮度对比度；半透明色按 alpha 叠在下面的颜色上
const parse = (s) => { const m = String(s).match(/[\d.]+/g).map(Number); return {r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1}; };
const over = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
const lum = ({r, g, b}) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

const PAGE = (htmlAttrs) => `<!doctype html><html ${htmlAttrs}><head></head><body style="margin:0;background:#888">
  <section id="laolao-user-settings" class="pinkie-user-settings" style="position:static"><div class="pinkie-user-settings__card" id="card" style="background:var(--pinkie-settings-card);padding:20px">
    <button class="pinkie-user-settings__button" id="plain" type="button">现在看看</button>
    <button class="pinkie-user-settings__button pinkie-user-settings__button--primary" id="primary" type="button">保存</button>
    <button class="pinkie-user-settings__choice" id="choice" type="button">选项</button>
  </div></section></body></html>`;

// 共享按键规则（settings-user.css 119 行那组）带 transition: border-color .16s，刚加样式就量会量到过渡起点（CI 上量成 rgb(0, 0, 0)）。
// 量之前关掉过渡，只测最终颜色。
const NO_TRANSITION = '#laolao-user-settings *, #laolao-user-settings *::before, #laolao-user-settings *::after { transition: none !important; }';
async function load(p, attrs, sheets) {
  await p.setContent(PAGE(attrs));
  await p.addStyleTag({content: NO_TRANSITION});
  for (const content of sheets) await p.addStyleTag({content});
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function measure(p) {
  return p.evaluate(() => {
    const cs = (id) => getComputedStyle(document.getElementById(id));
    const card = getComputedStyle(document.getElementById('card')).backgroundColor;
    return {plain: cs('plain').borderTopColor, plainBg: cs('plain').backgroundColor, primary: cs('primary').borderTopColor, choice: cs('choice').borderTopColor, card,
      metreLineStrong: getComputedStyle(document.documentElement).getPropertyValue('--metre-line-strong').trim()};
  });
}

test(`B25: shared settings buttons get a ≥3:1 edge in day and night, other controls and Metre unchanged; removing it brings the faint edge back (${engine})`, {timeout: 90_000}, async () => {
  assert.match(css, /--pinkie-settings-button-edge: #b5698f;/, '日间按键描边变量不在');
  assert.match(css, /--pinkie-settings-button-edge: #a8738f;/, '夜间按键描边变量不在');
  const browser = await launch();
  try {
    const p = await browser.newPage({viewport: {width: 600, height: 300}});
    const gray = {r: 136, g: 136, b: 136, a: 1};
    for (const [name, attrs, want] of [['日', '', 'rgb(181, 105, 143)'], ['夜', 'data-theme-mode="dark"', 'rgb(168, 115, 143)']]) {
      await load(p, attrs, [css]);
      const m = await measure(p);
      assert.equal(m.plain, want, `${name}：设置键描边应是新颜色`);
      const card = over(parse(m.card), gray), fill = over(parse(m.plainBg), card), edge = parse(m.plain);
      assert.ok(ratio(edge, card) >= 3, `${name}：描边对卡片 ${ratio(edge, card).toFixed(2)}:1 < 3`);
      assert.ok(ratio(edge, fill) >= 3, `${name}：描边对键底 ${ratio(edge, fill).toFixed(2)}:1 < 3`);
      assert.notEqual(m.primary, want, `${name}：主键 --primary 保留自己的描边`);
      assert.notEqual(m.choice, want, `${name}：选项键（__choice）不跟着变`);

      // 反例：删掉 __button 那条里的 border-color，描边退回共享的淡色，对卡片 < 3:1
      await p.evaluate(() => {
        for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.selectorText === '#laolao-user-settings .pinkie-user-settings__button') r.style.removeProperty('border-color');
      });
      const back = await measure(p);
      assert.notEqual(back.plain, want, `${name} 反例没生效：删掉后描边仍是新颜色`);
      assert.ok(ratio(over(parse(back.plain), card), card) < 3, `${name} 反例：退回的淡色描边应 < 3:1`);
    }
    // Metre：skin.css 的设置键规则自带 !important 描边（--metre-line-strong），新变量不影响
    await load(p, 'data-laolao-mode="metre"', [css, skin]);
    const metre = await measure(p);
    assert.notEqual(metre.plain, 'rgb(181, 105, 143)', 'Metre：设置键不该出现新的粉色描边');
    assert.doesNotMatch(metre.plain, /181, 105, 143|168, 115, 143/);
  } finally { await browser.close(); }
});
