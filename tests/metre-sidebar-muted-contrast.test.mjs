// A4（#123 后续）：Metre 侧栏的日期行（今天 / 昨天…）和会话行尾时间是 12px 小字，日夜都要 ≥ 4.5:1。
// 日间原来直接用 --metre-muted #77736B：侧栏底 #F0EFEB 上 4.1:1，当前行（7% 钴蓝）底上 3.9:1。
// 真浏览器里跑：共用 laolao-sidebar.css（带 opacity .58 / .56）+ 整份 laolao-metre-skin.css，结构按 laolao-session-list.js 搭；
// 底色和字色都画到 1×1 画布上合成（各层底色 + 祖先 opacity），不手算 color-mix。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (f) => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + f, import.meta.url)), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

const SKIN = read('laolao-metre-skin.css');
const row = (active, name, time) => `<div class="sidebar-recent-session${active ? ' sidebar-recent-session--active' : ''}">`
  + `<a class="sidebar-recent-session__link" href="#"><span class="sidebar-recent-session__name">${name}</span></a>`
  + `<span class="session-row-aside"><time class="pinkie-session-time">${time}</time></span></div>`;
const page = (skin, night) => `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night=""' : ''}><head><style>body{margin:0;font:14px sans-serif}
${read('laolao-sidebar.css')}
${skin}</style></head><body>
<nav class="shell-nav" style="width:280px"><aside class="sidebar"><div id="laolao-session-manager"><div class="laolao-group pk-ml-flat"><div class="laolao-group__list">
<div class="pinkie-session-date">今天</div>
${row(false, '整理发版清单', '18:40')}
${row(true, '当前这条会话', '3 分钟')}
<div class="pinkie-session-date">昨天</div>
${row(false, '新会话', '昨天')}
<div class="laolao-group__empty">暂无会话</div>
</div></div></div></aside></nav></body></html>`;

async function measure(browser, skin, night) {
  const p = await browser.newPage({viewport: {width: 1024, height: 600}});
  await p.setContent(page(skin, night));
  await p.hover('.sidebar-recent-session >> nth=2');
  await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const m = await p.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d', {willReadFrequently: true});
    const chain = (e) => { const out = []; for (let n = e; n && n.nodeType === 1; n = n.parentElement) out.unshift(n); return out; };
    const paint = (e) => {
      g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1);
      for (const n of chain(e)) { const c = getComputedStyle(n).backgroundColor; g.fillStyle = '#fff'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); }
      const bg = [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
      g.globalAlpha = chain(e).reduce((a, n) => a * Number(getComputedStyle(n).opacity), 1);
      g.fillStyle = getComputedStyle(e).color; g.fillRect(0, 0, 1, 1);
      return {bg, fg: [...g.getImageData(0, 0, 1, 1).data].slice(0, 3)};
    };
    const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    const ratio = ({bg, fg}) => { const x = lum(bg), y = lum(fg); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const items = [
      ...[...document.querySelectorAll('.pinkie-session-date')].map((e) => ['date ' + e.textContent, e]),
      ...[...document.querySelectorAll('.sidebar-recent-session')].map((r) => [(r.matches('.sidebar-recent-session--active') ? 'active ' : r.matches(':hover') ? 'hover ' : 'row ') + 'time', r.querySelector('.pinkie-session-time')]),
    ];
    const res = items.map(([k, e]) => { const c = paint(e); return {k, ...c, r: ratio(c)}; });
    return {res, min: Math.min(...res.map((x) => x.r)), empty: getComputedStyle(document.querySelector('.laolao-group__empty')).color};
  });
  await p.close();
  return m;
}

for (const night of [false, true]) {
  test(`Metre sidebar: date rows and row times keep 4.5:1 on every sidebar surface (${night ? 'night' : 'day'}, ${engine})`, {timeout: 60_000}, async () => {
    const browser = await launch();
    try {
      const m = await measure(browser, SKIN, night);
      assert.deepEqual(m.res.map((x) => x.k).sort(), ['active time', 'date 今天', 'date 昨天', 'hover time', 'row time'], 'measured the plain, active and hovered rows');
      assert.ok(m.min >= 4.5, `12px date / time ≥ 4.5:1, also on the active row: ${m.min.toFixed(2)} ${JSON.stringify(m.res)}`);
      assert.equal(m.empty, night ? 'rgb(145, 141, 132)' : 'rgb(119, 115, 107)', 'only the date / time changed; other muted text still uses --metre-muted');
    } finally { await browser.close(); }
  });
}

test(`counter-example: back on plain --metre-muted the day date / time drop under 4.5:1 (${engine})`, {timeout: 60_000}, async () => {
  assert.equal(SKIN.split('color: var(--metre-side-muted) !important').length - 1, 2, 'exactly the date and the time rule use --metre-side-muted');
  const swapped = SKIN.split('color: var(--metre-side-muted) !important').join('color: var(--metre-muted) !important');
  const browser = await launch();
  try {
    const m = await measure(browser, swapped, false);
    assert.ok(m.min < 4.5, `the measurement catches the old colour: ${m.min.toFixed(2)}`);
  } finally { await browser.close(); }
});
