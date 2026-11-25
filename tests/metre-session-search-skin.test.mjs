// 11-25 S5「会话全文搜索」的复发测试：搜索本身已有（session-search.mjs 读正文），坏的是 Metre 皮肤。真浏览器里跑，
// 页面上放碧琪共用的搜索弹层样式（laolao-sidebar-surface.css）+ 整份 laolao-metre-skin.css，弹层按 laolao-session-list.js 的结构搭。
// 改前：方向键选中的那条没有底色（皮肤只认不存在的 .is-active，又用 transparent 压掉了共用的 aria-selected 底色）；
// 摘录和时间跟标题一样深（皮肤写的 __snippet / __time 类名不存在）；夜间命中高亮 10% 钴蓝几乎看不见、遮罩 0.36 压不住深色页面。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (f) => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + f, import.meta.url)), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

const row = (sel, title, snippet, hit, time) => `<button class="pinkie-session-search-result" role="option" aria-selected="${sel}" aria-label="打开会话：${title}">`
  + `<span class="pinkie-session-search-title">${title}</span><span class="pinkie-session-search-snippet">${snippet[0]}<mark>${hit}</mark>${snippet[1]}</span>`
  + `<span class="pinkie-session-search-time">${time}</span></button>`;
const page = (mode, night) => `<!doctype html><html${mode ? ` data-laolao-mode="${mode}"` : ''}${night ? ' data-pinkie-night=""' : ''}><head><style>body{margin:0;font:14px sans-serif}
${read('laolao-sidebar-surface.css')}
${read('laolao-metre-skin.css')}</style></head><body>
<div class="pinkie-session-search-mask"><section class="pinkie-session-search-dialog" role="dialog" aria-modal="true">
<input class="pinkie-session-search-input" type="search"><label class="pinkie-session-search-filter"><input type="checkbox">含已归档</label>
<div class="pinkie-session-search-status" role="status">找到 3 条结果</div><div class="pinkie-session-search-results" role="listbox">
${row('false', '整理发版清单', ['…上次说的那个', '要先核一遍'], '预览', '18:40')}
${row('true', '预览'.repeat(40) + '一个很长的会话标题', ['', '相关的一段正文'], '预览', '周一')}
${row('false', '新会话', ['…abcdefghij', '后面还有很多字'], '预览', '11/14')}
</div></section></div></body></html>`;

async function measure(browser, mode, night) {
  const p = await browser.newPage({viewport: {width: 1024, height: 768}});
  await p.setContent(page(mode, night));
  const m = await p.evaluate(() => {
    const rgb = (c) => { const v = c.match(/[\d.]+/g).map(Number), k = /^color\(/.test(c) ? 255 : 1; return [v[0] * k, v[1] * k, v[2] * k, v.length > 3 ? v[3] : 1]; };
    const over = (top, under) => { const [r, g, b, a] = rgb(top), [r2, g2, b2] = rgb(under); return [r * a + r2 * (1 - a), g * a + g2 * (1 - a), b * a + b2 * (1 - a)]; };
    const lum = (c) => 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const cs = (e) => getComputedStyle(e);
    const dialog = document.querySelector('.pinkie-session-search-dialog'), face = rgb(cs(dialog).backgroundColor).slice(0, 3);
    const rows = [...document.querySelectorAll('.pinkie-session-search-result')];
    const bgOf = (r) => over(cs(r).backgroundColor, `rgb(${face})`);
    const sel = rows[1], plain = rows[0];
    const part = (r, c) => r.querySelector('.pinkie-session-search-' + c);
    const markBg = (r) => over(cs(r.querySelector('mark')).backgroundColor, `rgb(${bgOf(r)})`);
    const title = part(sel, 'title');
    return {
      selBg: bgOf(sel), plainBg: bgOf(plain), face,
      titleColor: cs(part(plain, 'title')).color, snippetColor: cs(part(plain, 'snippet')).color,
      minMuted: Math.min(...[plain, sel].flatMap((r) => ['snippet', 'time'].map((c) => ratio(rgb(cs(part(r, c)).color), bgOf(r))))),
      statusContrast: ratio(rgb(cs(document.querySelector('.pinkie-session-search-status')).color), face),
      minMark: Math.min(...[plain, sel].map((r) => ratio(rgb(cs(r.querySelector('mark')).color), markBg(r)))),
      markVsRow: ratio(markBg(plain), bgOf(plain)),
      maskAlpha: rgb(cs(document.querySelector('.pinkie-session-search-mask')).backgroundColor)[3],
      titleOneLine: title.getBoundingClientRect().height < 30 && title.scrollWidth > title.clientWidth,
      timeOneLine: part(sel, 'time').getBoundingClientRect().height < 24,
    };
  });
  await p.close();
  return m;
}

for (const night of [false, true]) {
  test(`Metre session search: selected row, muted excerpt, hit highlight and backdrop are readable (${night ? 'night' : 'day'}, ${engine})`, {timeout: 60_000}, async () => {
    const browser = await launch();
    try {
      const m = await measure(browser, 'metre', night);
      const diff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
      assert.ok(diff(m.selBg, m.face) >= 12, `the arrow-key row stands out from the dialog face: ${JSON.stringify(m)}`);
      assert.ok(diff(m.plainBg, m.face) < 1, 'rows that are not selected stay flat');
      assert.notEqual(m.snippetColor, m.titleColor, 'excerpt is muted, not the title ink');
      assert.ok(m.minMuted >= 4.5, `excerpt and time keep 4.5:1, also on the selected row: ${m.minMuted.toFixed(2)}`);
      assert.ok(m.statusContrast >= 4.5, `status line keeps 4.5:1: ${m.statusContrast.toFixed(2)}`);
      assert.ok(m.minMark >= 4.5, `hit words keep 4.5:1 on their highlight: ${m.minMark.toFixed(2)}`);
      assert.ok(m.markVsRow >= 1.25, `the highlight is visible against its row: ${m.markVsRow.toFixed(2)}`);
      assert.ok(m.maskAlpha >= (night ? 0.55 : 0.3), `backdrop dims the page: ${m.maskAlpha}`);
      assert.ok(m.titleOneLine && m.timeOneLine, 'long titles end in one line, the time never wraps');
    } finally { await browser.close(); }
  });
}

test(`other modes keep the shared search skin (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const m = await measure(browser, 'chat', false);
    assert.equal(m.maskAlpha, 0.28, 'shared backdrop untouched');
    assert.ok(Math.abs(m.selBg[0] - m.face[0]) > 1 || Math.abs(m.selBg[1] - m.face[1]) > 1, 'shared aria-selected tint still applies');
    assert.equal(m.titleOneLine, false, 'shared rule lets the title wrap; the Metre one-line rule does not leak');
  } finally { await browser.close(); }
});
