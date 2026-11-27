// B31（backlog，定了：时间戳 ≤ 0 或缺失就不显示时间）：消息底部时间显示成「1970年1月1日」「1969年12月31日」。
// 原生 control-ui（chat-page 的 Rx/zx）画 <time class="chat-group-timestamp" datetime=${new Date(ts).toISOString()}>；
// 时间戳缺失 / 不合法时 datetime 是空串、文字是「Unknown date」。
// 修法在 laolao-message-actions.css（各模式都加载）：datetime 不以「2」开头（1970、1969、负年份、空）就 display: none。
// 真浏览器里只加载这一个 css，按原生的写法造 <time>，量计算样式；反例：页面上删掉这条规则，1970 那条又显示出来。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const css = fs.readFileSync(fileURLToPath(new URL('../ui/injections/laolao-message-actions.css', import.meta.url)), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const RULE = 'time.chat-group-timestamp:not([datetime^="2"])';

// 照原生 Rx：合法就 toISOString()，不合法 datetime 为空
const iso = (ts) => { const d = new Date(ts); return Number.isFinite(d.getTime()) ? d.toISOString() : ''; };
const CASES = [
  ['0', 0, false], ['-1', -1, false], ['-86400000', -86_400_000, false], ['缺失', undefined, false], ['NaN', NaN, false],
  ['2000-01-01', Date.UTC(2000, 0, 1), true], ['2026-11-26', Date.UTC(2026, 10, 26, 10, 0), true], ['现在', Date.now(), true],
];

test(`B31: message time is hidden when the timestamp is 0, negative or missing, and shown otherwise (${engine})`, {timeout: 60_000}, async () => {
  assert.ok(css.includes(RULE), '找不到 B31 那条规则');
  assert.doesNotMatch(css.slice(css.indexOf(RULE), css.indexOf('}', css.indexOf(RULE))), /!\s*important/, '不加强制覆盖');
  const browser = await launch();
  try {
    const p = await browser.newPage({viewport: {width: 800, height: 600}});
    const rows = CASES.map(([name, ts]) => `<div class="chat-group assistant"><div class="chat-group-footer"><time class="chat-group-timestamp" data-case="${name}" datetime="${iso(ts)}">t</time></div></div>`).join('');
    await p.setContent(`<!doctype html><html><head></head><body>${rows}</body></html>`);
    await p.addStyleTag({content: css});
    const shown = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('time.chat-group-timestamp')].map((t) => [t.dataset.case, getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().width > 0])));
    const got = await shown();
    for (const [name, , want] of CASES) assert.equal(got[name], want, `时间戳 ${name}：${want ? '应显示' : '不应显示'}（datetime="${iso(CASES.find((c) => c[0] === name)[1])}"）`);

    // 反例：删掉 B31 规则，时间戳 0 那条（1970-01-01T00:00:00.000Z）又显示出来
    const removed = await p.evaluate((frag) => {
      let n = 0;
      for (const sh of document.styleSheets) for (let i = sh.cssRules.length - 1; i >= 0; i--) if ((sh.cssRules[i].selectorText || '').includes(frag)) { sh.deleteRule(i); n++; }
      return n;
    }, 'time.chat-group-timestamp:not(');
    assert.equal(removed, 1, `反例：页面上应正好一条 B31 规则（找到 ${removed}）`);
    assert.equal((await shown())['0'], true, '反例没生效：删掉规则后 1970 那条仍不显示');
  } finally { await browser.close(); }
});
