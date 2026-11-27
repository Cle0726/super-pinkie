// B16（backlog，uireview #218 记）：窄窗（< 840）工作台切到「代码」页时，Metre 的「后台」带子压住编辑器状态栏。
// 原因：代码页盖住了对话那一栏，但输入框还在布局里，laolao-metre-backstage.js 照着输入框量位置，带子照样显示在窗口底。
// 工作台在 html 上写 data-pk-wb-narrow="1" / data-pk-wb-view="code"（laolao-workbench.js place()；关工作台时删掉）。
// 修法在 laolao-metre-keys.css：这两个属性同时在时带子 display: none。不加强制覆盖。
// 真浏览器里只加载 laolao-metre-keys.css，量带子的计算样式；对照组：窄窗「对话」页、宽窗两栏、没开工作台、别的模式。
// 反例：页面上删掉这条新规则，代码页的带子又显示出来。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const css = fs.readFileSync(fileURLToPath(new URL('../ui/injections/laolao-metre-keys.css', import.meta.url)), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const RULE = '[data-pk-wb-narrow="1"][data-pk-wb-view="code"] .pk-metre-backstage:not([hidden])';

test(`B16: Metre backstage band hides on the narrow workbench code page only; deleting the rule brings it back (${engine})`, {timeout: 60_000}, async () => {
  assert.ok(css.includes(RULE), '找不到 B16 那条规则');
  assert.doesNotMatch(css.slice(css.indexOf(RULE), css.indexOf('}', css.indexOf(RULE))), /!\s*important/, '不加强制覆盖');
  const browser = await launch();
  try {
    const p = await browser.newPage({viewport: {width: 820, height: 700}});
    await p.setContent('<!doctype html><html data-laolao-mode="metre"><head></head><body><div class="pk-metre-backstage" style="left:0;top:676px;width:400px"><span class="pk-bs__label">后台</span></div></body></html>');
    await p.addStyleTag({content: css});
    const shown = (attrs) => p.evaluate((attrs) => {
      const h = document.documentElement;
      for (const k of ['data-pk-wb-narrow', 'data-pk-wb-view', 'data-laolao-mode']) h.removeAttribute(k);
      for (const [k, v] of Object.entries(attrs)) h.setAttribute(k, v);
      const b = document.querySelector('.pk-metre-backstage');
      return getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0;
    }, attrs);
    const metre = {'data-laolao-mode': 'metre'};
    assert.equal(await shown({...metre, 'data-pk-wb-narrow': '1', 'data-pk-wb-view': 'code'}), false, '窄窗代码页：带子不显示');
    assert.equal(await shown({...metre, 'data-pk-wb-narrow': '1', 'data-pk-wb-view': 'chat'}), true, '窄窗对话页：带子照常显示');
    assert.equal(await shown({...metre, 'data-pk-wb-narrow': '0', 'data-pk-wb-view': 'both'}), true, '宽窗两栏：带子照常显示');
    assert.equal(await shown(metre), true, '没开工作台：带子照常显示');
    assert.equal(await shown({'data-laolao-mode': 'chat', 'data-pk-wb-narrow': '1', 'data-pk-wb-view': 'code'}), false, '别的模式本来就不显示（keys.css 第一条）');

    // 反例：删掉 B16 那条规则，窄窗代码页的带子又显示出来
    const removed = await p.evaluate((frag) => {
      let n = 0;
      for (const sh of document.styleSheets) for (let i = sh.cssRules.length - 1; i >= 0; i--) if ((sh.cssRules[i].selectorText || '').includes(frag)) { sh.deleteRule(i); n++; }
      return n;
    }, RULE);
    assert.equal(removed, 1, `反例：页面上应正好一条 B16 规则（找到 ${removed}）`);
    assert.equal(await shown({...metre, 'data-pk-wb-narrow': '1', 'data-pk-wb-view': 'code'}), true, '反例没生效：删掉规则后代码页带子仍不显示');
  } finally { await browser.close(); }
});
