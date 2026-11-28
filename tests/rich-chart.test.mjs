// 回复里的 ```chart 图表（laolao-rich.js → 按需加载的 laolao-rich-chart.js / .css）。
// 前提：Chart.js 打包在 ui/injections/laolao-vendor-chart.js；页面上只放 laolao-dom-watch.js、laolao-rich.css、laolao-rich.js，
//       图表模块和样式表由 rich.js 第一次遇到图表时自己走 http 加载（不是 addScriptTag 塞进去）。
// 正例：格式对的画成图；「数据表」切到表格再切回；「复制图片」放进剪贴板的是实底 + 标题 + 图的 PNG，剪贴板用不了就存成文件；
//       配色跟着日夜和模式走（Metre 用自己的强调色），切模式、切日夜会重画。
//       「数据表」「复制图片」键的边：日夜、Metre 和非 Metre、普通和按下，对键底和图卡底都 ≥ 3:1（反例换回 --pk-faint 要红）。
// 反例：格式不对（不是 JSON、个数对不上、数里有字、类型不认识、一个数都没有、饼图两组、没有 labels）一律不画，原代码块露出来，
//       上面说清哪里不对，页面不报错；把模块里的校验换成「照单全收」，同一组检查要红。
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const ORIGIN = 'http://127.0.0.1:30131';

// L111（内核 job 提速）：原来 5 条测试各自 launch() 一次浏览器，现在整个文件只起一个（after 先注册，before 里起）。
// 每条测试拿一个「浏览器」外壳：newPage 走共用浏览器，并记下本条开过的页；close() 只关这些页、不关浏览器。
// browser.newPage 开的页各自带独立 context，页内改原型 / 剪贴板 / 路由都随页关掉，条与条之间不串。
let shared = null;
after(async () => { await shared?.close(); });
before(async () => { shared = await launch(); });
function sharedBrowser() {
  const pages = [];
  return {
    async newPage(options) { const p = await shared.newPage(options); pages.push(p); return p; },
    async close() { await Promise.all(pages.splice(0).map((p) => p.close().catch(() => {}))); },
  };
}

const GOOD = {type: 'bar', title: '吃饭花销连降两个月', labels: ['8月', '9月', '10月'], series: [{name: '吃饭', data: [2400, 2050, 1760]}], unit: '元'};
const TWO = {type: 'line', title: '两组', labels: ['一', '二', '三'], series: [{name: '甲', data: [1, 2, 3]}, {name: '乙', data: [3, null, 1]}]};
const BAD = [
  ['不是 JSON', '{"type":"bar","labels":["a","b"],', '不是有效的 JSON'],
  ['个数对不上', JSON.stringify({labels: ['a', 'b', 'c'], data: [1, 2]}), '有 2 个数，labels 有 3 个'],
  ['数里有字', JSON.stringify({labels: ['a', 'b'], data: [1, '两千']}), '不是数字的值'],
  ['类型不认识', JSON.stringify({type: 'scatter3d', labels: ['a'], data: [1]}), '不认识的类型'],
  ['一个数都没有', JSON.stringify({labels: ['a', 'b'], data: [null, null]}), '一个数都没有'],
  ['饼图两组', JSON.stringify({type: 'pie', labels: ['a', 'b'], series: [{data: [1, 2]}, {data: [3, 4]}]}), '只能有一组'],
  ['没有 labels', JSON.stringify({data: [1, 2, 3]}), '没有 labels'],
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const msg = (src) => `<div class="chat-group assistant"><div class="chat-group-messages"><div class="chat-bubble"><div class="chat-text"><p>看图：</p><pre><code class="language-chart">${esc(src)}</code></pre><p>完。</p></div></div></div></div>`;
// skin：Metre 时加载真 Metre 皮肤（不靠 var() 兜底色，兜底只有日间值）；皮肤的夜间块认 data-theme=dark，一起带上
const page = (sources, {mode = 'chat', night = false, skin = false} = {}) => `<!doctype html><html data-laolao-mode="${mode}"${night ? ' data-pinkie-night="1"' : ''}${night && skin ? ' data-theme="dark"' : ''}><head>`
  + (skin && mode === 'metre' ? '<link rel="stylesheet" href="/laolao-metre-skin.css">' : '')
  + '<link rel="stylesheet" href="/laolao-rich.css"><style>.chat-text :where(table) { display: block; width: 100%; }</style></head>'   // 原生 index.css 同一条<body style="margin:0;width:760px;font:15px/1.7 sans-serif">'
  + `<div class="chat-thread"><div class="chat-thread-inner">${sources.map(msg).join('')}</div></div>`
  + '<script src="/laolao-dom-watch.js"></script><script src="/laolao-rich.js"></script></body></html>';

async function open(browser, sources, opts = {}, mutateModule = null) {
  const tab = await browser.newPage({viewport: {width: 800, height: 900}});
  await tab.emulateMedia({reducedMotion: 'reduce'});
  const errors = [];
  tab.on('pageerror', (e) => errors.push(String(e)));
  await tab.route(ORIGIN + '/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/chat') return route.fulfill({contentType: 'text/html; charset=utf-8', body: page(sources, opts)});
    const name = url.pathname.slice(1);
    if (!/^laolao-[\w.-]+\.(js|css)$/.test(name)) return route.fulfill({status: 404, body: ''});
    let body = inj(name);
    if (name === 'laolao-rich-chart.js' && mutateModule) body = mutateModule(body);
    if (name === 'laolao-rich-chart.css' && opts.mutateCss) body = opts.mutateCss(body);
    return route.fulfill({contentType: (name.endsWith('.css') ? 'text/css' : 'text/javascript') + '; charset=utf-8', body});
  });
  await tab.goto(ORIGIN + '/chat');
  try {
    await tab.waitForFunction((n) => document.querySelectorAll('.pk-rich--chart').length === n
      && [...document.querySelectorAll('.pk-rich--chart')].every((b) => b.querySelector('canvas') || b.classList.contains('is-error')), sources.length, {timeout: 15000});
  } catch (error) {
    const state = await tab.evaluate(() => ({codes: document.querySelectorAll('code.language-chart').length, seen: document.querySelectorAll('code[data-pk-seen]').length,
      boxes: [...document.querySelectorAll('.pk-rich')].map((b) => b.className + ' canvas=' + !!b.querySelector('canvas') + ' | ' + b.innerText.slice(0, 80))})).catch(() => null);
    throw new Error(`等图表超时：${JSON.stringify(state)} 页面错误：${JSON.stringify(errors)}`, {cause: error});
  }
  return {tab, errors};
}

// 每个格式不对的块：不能画出图、原代码块要露出来、提示要说中原因。返回不符合的条目。
const badProblems = (tab) => tab.evaluate((expect) => [...document.querySelectorAll('.pk-rich--chart')].map((box, i) => {
  const pre = box.nextElementSibling;
  const why = box.querySelector('.pk-rich__error')?.textContent || '';
  const out = [];
  if (box.querySelector('canvas')) out.push('画出了图');
  if (!pre || pre.tagName !== 'PRE' || pre.hasAttribute('data-pk-hidden') || getComputedStyle(pre).display === 'none') out.push('原代码块没露出来或不在提示下面');
  if (!why.includes(expect[i])) out.push(`提示是「${why}」`);
  return out.length ? `${i}: ${out.join('，')}` : null;
}).filter(Boolean), BAD.map((b) => b[2]));

test('图表：格式对的画成图，「数据表」来回切，原代码块藏起来、点「源码」能看', async () => {
  const browser = sharedBrowser();
  try {
    const {tab, errors} = await open(browser, [JSON.stringify(GOOD), JSON.stringify(TWO)]);
    assert.ok(await tab.evaluate(() => typeof window.Chart === 'function'), '前提：Chart.js 是 rich 自己按需加载的');
    const s = await tab.evaluate(() => [...document.querySelectorAll('.pk-rich--chart')].map((b) => ({
      hidden: b.previousElementSibling.hasAttribute('data-pk-hidden'), title: b.querySelector('.pk-chart__title')?.firstChild?.textContent, unit: b.querySelector('.pk-chart__unit')?.textContent,
      keys: [...b.querySelectorAll('.pk-chart__key')].map((k) => k.textContent), h: b.querySelector('canvas').getBoundingClientRect().height,
      sets: b.__pkChart?.data.datasets.length,
    })));
    assert.deepEqual(s.map((x) => x.hidden), [true, true], '原代码块藏起来');
    assert.equal(s[0].title, GOOD.title);
    assert.equal(s[0].unit, '单位：元', '单位写在标题行右边，不做转 90° 的轴标题');
    assert.deepEqual(s[0].keys, ['数据表', '复制图片']);
    assert.ok(s[0].h > 200, '图有正常高度 ' + s[0].h);
    assert.deepEqual(s.map((x) => x.sets), [1, 2]);

    const first = tab.locator('.pk-rich--chart').first();
    await first.locator('.pk-chart__key', {hasText: '数据表'}).click();
    await tab.waitForTimeout(400);   // 等 rich 的扫描跑过一遍：数据表不能被「点表头排序」接管
    const t = await first.evaluate((b) => ({
      sort: b.querySelector('table').hasAttribute('data-pk-sort'), align: [...b.querySelectorAll('thead th')].map((c) => getComputedStyle(c).textAlign),
      on: b.querySelector('.pk-chart').classList.contains('is-table'), pressed: b.querySelector('.pk-chart__key').getAttribute('aria-pressed'),
      canvas: getComputedStyle(b.querySelector('canvas')).visibility, head: [...b.querySelectorAll('thead th')].map((c) => c.textContent),
      rows: [...b.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.textContent)),
      rowW: Math.round(b.querySelector('tbody tr').getBoundingClientRect().width), gridW: Math.round(b.querySelector('.pk-chart__grid').clientWidth),
      gridH: b.querySelector('.pk-chart__grid').getBoundingClientRect().height, stageH: b.querySelector('.pk-chart__stage').getBoundingClientRect().height,
    }));
    assert.equal(t.on, true); assert.equal(t.pressed, 'true');
    assert.equal(t.canvas, 'hidden', '图只是看不见，尺寸还在（复制图片要用）');
    assert.deepEqual(t.head, ['名称', '吃饭（元）']);
    assert.deepEqual(t.rows, [['8月', '2,400'], ['9月', '2,050'], ['10月', '1,760']]);
    assert.equal(t.sort, false, '数据表不加排序（行头上不出排序符号）');
    assert.deepEqual(t.align, ['left', 'right'], '名称列靠左，数字列表头和数字一起靠右');
    assert.equal(Math.round(t.gridH), Math.round(t.stageH), '图区跟着表格的高度，下面不空一大块');
    assert.ok(t.stageH < 200, '三行的表不占满 260px：' + t.stageH);
    assert.ok(t.rowW >= t.gridW - 4, '每行（分隔线）撑满表格外框，不画一半就断：行 ' + t.rowW + ' / 框 ' + t.gridW);
    const second = await tab.locator('.pk-rich--chart').nth(1).evaluate((b) => (b.querySelector('.pk-chart__key').click(), [...b.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.textContent))));
    assert.deepEqual(second[1], ['二', '2', '—'], '缺的数显示「—」');
    await first.locator('.pk-chart__key', {hasText: '数据表'}).click();
    assert.equal(await first.evaluate((b) => getComputedStyle(b.querySelector('canvas')).visibility), 'visible', '再点切回图');

    await first.hover();
    await first.locator('.pk-rich__src').click();
    assert.equal(await first.evaluate((b) => b.previousElementSibling.hasAttribute('data-pk-hidden')), false, '点「源码」露出原文');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('图表：「复制图片」放进剪贴板的是实底、带标题的 PNG；剪贴板用不了就存成文件', async () => {
  const browser = sharedBrowser();
  try {
    const {tab, errors} = await open(browser, [JSON.stringify(GOOD)]);
    await tab.evaluate(() => {
      window.__got = null;
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {write: async (items) => {
        const blob = await items[0].getType('image/png');
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
        let titleInk = 0; const d = g.getImageData(0, 0, Math.min(bmp.width, 400), 40).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 150) titleInk++;
        window.__got = {type: blob.type, w: bmp.width, corner: [...g.getImageData(2, 2, 1, 1).data], titleInk, src: document.querySelector('.pk-rich--chart canvas').width};
      }}});
    });
    await tab.locator('.pk-chart__key', {hasText: '复制图片'}).click();
    await tab.waitForFunction(() => window.__got && document.querySelector('.pk-chart__note').textContent, null, {timeout: 5000});
    const got = await tab.evaluate(() => ({...window.__got, note: document.querySelector('.pk-chart__note').textContent}));
    assert.equal(got.type, 'image/png');
    assert.deepEqual(got.corner, [255, 255, 255, 255], '实底（日间白），不是透明');
    assert.ok(got.w > got.src, '四周留了边');
    assert.ok(got.titleInk > 20, '图片上方有标题字');
    assert.equal(got.note, '已复制，可以直接粘贴');

    await tab.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined});
      window.__saved = null;
      HTMLAnchorElement.prototype.click = function () { window.__saved = {name: this.download, href: this.href.slice(0, 5)}; };
    });
    await tab.locator('.pk-chart__key', {hasText: '复制图片'}).click();
    await tab.waitForFunction(() => window.__saved && document.querySelector('.pk-chart__note').textContent.includes('文件'), null, {timeout: 5000});
    const saved = await tab.evaluate(() => ({...window.__saved, note: document.querySelector('.pk-chart__note').textContent}));
    assert.deepEqual(saved, {name: '吃饭花销连降两个月.png', href: 'blob:', note: '剪贴板用不了，已存成图片文件'});

    // toBlob 回空（无头 WebKit 实测如此）：改用 toDataURL，照样存成文件 / 写进剪贴板，不只报「没复制成」
    await tab.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = function (cb) { setTimeout(() => cb(null), 0); };
      window.__saved = null;
    });
    await tab.locator('.pk-chart__key', {hasText: '复制图片'}).click();
    await tab.waitForFunction(() => window.__saved && document.querySelector('.pk-chart__note').textContent.includes('文件'), null, {timeout: 5000});
    const savedNoBlob = await tab.evaluate(() => ({...window.__saved, note: document.querySelector('.pk-chart__note').textContent}));
    assert.deepEqual(savedNoBlob, {name: '吃饭花销连降两个月.png', href: 'blob:', note: '剪贴板用不了，已存成图片文件'}, 'toBlob 回空也退回下载');

    await tab.evaluate(() => {
      window.__got = null;
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {write: async (items) => {
        const blob = await items[0].getType('image/png');
        const bmp = await createImageBitmap(blob);
        window.__got = {type: blob.type, w: bmp.width, src: document.querySelector('.pk-rich--chart canvas').width};
      }}});
    });
    await tab.locator('.pk-chart__key', {hasText: '复制图片'}).click();
    await tab.waitForFunction(() => window.__got && document.querySelector('.pk-chart__note').textContent.includes('已复制'), null, {timeout: 5000});
    const gotNoBlob = await tab.evaluate(() => window.__got);
    assert.equal(gotNoBlob.type, 'image/png', 'toBlob 回空时剪贴板里也是能解开的 PNG');
    assert.ok(gotNoBlob.w > gotNoBlob.src, 'toDataURL 出的也是带边、带标题的那张');

    // 本机 WebKit（2370 / 2388）实测：toBlob 回空、toDataURL 三种格式都回 data:，但像素读得出：用像素自己拼 PNG
    await tab.evaluate(() => {
      HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
      window.__got = null;
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {write: async (items) => {
        const blob = await items[0].getType('image/png');
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
        let titleInk = 0; const d = g.getImageData(0, 0, Math.min(bmp.width, 400), 40).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 150) titleInk++;
        window.__got = {type: blob.type, w: bmp.width, corner: [...g.getImageData(2, 2, 1, 1).data], titleInk, src: document.querySelector('.pk-rich--chart canvas').width};
      }}});
    });
    await tab.locator('.pk-chart__key', {hasText: '复制图片'}).click();
    await tab.waitForFunction(() => window.__got && document.querySelector('.pk-chart__note').textContent.includes('已复制'), null, {timeout: 5000});
    const gotPixels = await tab.evaluate(() => window.__got);
    assert.equal(gotPixels.type, 'image/png', '编码全不可用时剪贴板里也是能解开的 PNG');
    assert.deepEqual(gotPixels.corner, [255, 255, 255, 255], '自己拼的那张也是实底');
    assert.ok(gotPixels.w > gotPixels.src, '自己拼的那张也带边');
    assert.ok(gotPixels.titleInk > 20, '自己拼的那张也有标题字');

    // 反例：连像素都读不出（比如画布被跨域图片污染），才如实报「没复制成」，也不下载空文件
    await tab.evaluate(() => {
      CanvasRenderingContext2D.prototype.getImageData = () => { throw new DOMException('tainted', 'SecurityError'); };
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined});
      window.__saved = null;
    });
    await tab.locator('.pk-chart__key', {hasText: '复制图片'}).click();
    await tab.waitForFunction(() => document.querySelector('.pk-chart__note').textContent.includes('没复制成'), null, {timeout: 5000});
    assert.equal(await tab.evaluate(() => window.__saved), null, '出不了图就不下载');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('图表：配色跟着日夜和模式走（Metre 用自己的强调色），切模式、切日夜会重画', async () => {
  const browser = sharedBrowser();
  try {
    const read = (tab) => tab.evaluate(() => {
      const b = document.querySelector('.pk-rich--chart');
      return {var1: getComputedStyle(b).getPropertyValue('--pk-chart-1').trim(), drawn: b.__pkChart.data.datasets[0].borderColor};
    });
    const cases = [
      [{mode: 'chat'}, '#2f7bff'], [{mode: 'chat', night: true}, '#8ec0ff'],
      [{mode: 'metre'}, '#2F4BB0'], [{mode: 'metre', night: true}, '#93A5EE'],
    ];
    for (const [opts, want] of cases) {
      const {tab, errors} = await open(browser, [JSON.stringify(GOOD)], opts);
      const r = await read(tab);
      assert.equal(r.drawn, r.var1, `${JSON.stringify(opts)}：画出来的颜色就是 --pk-chart-1`);
      // 页面上没有 Metre 皮肤，Metre 取 --metre-accent 的兜底色；有皮肤时就是皮肤里的同一个值
      assert.equal(r.drawn.toUpperCase(), want.toUpperCase(), `${JSON.stringify(opts)}`);
      assert.deepEqual(errors, []);
      await tab.close();
    }
    const {tab, errors} = await open(browser, [JSON.stringify(GOOD)], {mode: 'chat'});
    await tab.evaluate(() => document.documentElement.setAttribute('data-laolao-mode', 'metre'));
    await tab.waitForFunction(() => document.querySelector('.pk-rich--chart')?.__pkChart?.data.datasets[0].borderColor.toUpperCase() === '#2F4BB0', null, {timeout: 8000});
    await tab.evaluate(() => document.documentElement.setAttribute('data-pinkie-night', '1'));
    await tab.waitForFunction(() => document.querySelector('.pk-rich--chart')?.__pkChart?.data.datasets[0].borderColor.toUpperCase() === '#93A5EE', null, {timeout: 8000});
    assert.equal(await tab.evaluate(() => document.querySelectorAll('.pk-rich--chart').length), 1, '重画后还是一张，不叠');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('图表：格式不对一律不画，原代码块露出来、说清哪里不对，页面不报错；反例（校验照单全收）要红', async () => {
  const browser = sharedBrowser();
  try {
    const {tab, errors} = await open(browser, BAD.map((b) => b[1]));
    assert.deepEqual(await badProblems(tab), [], '每个错块都要退回原文');
    assert.deepEqual(errors, [], '页面不报错');
    assert.equal(await tab.evaluate(() => document.body.innerText.includes('完。')), true, '同一条消息里其他内容照常');
    await tab.close();

    // 反例：把 normalize 换成不检查、直接拿去画
    const lax = (src) => {
      const head = 'export function normalize(spec) {';
      assert.ok(src.includes(head), '反例：找得到 normalize');
      return src.replace(head, head + "\n  return {type: String(spec.type || 'bar'), series: spec.series || [{name: '', data: spec.data || []}], labels: (spec.labels || []).map(String), title: '', unit: '', stacked: false, horizontal: false};");
    };
    const counter = await open(browser, BAD.map((b) => b[1]), {}, lax);
    const problems = await badProblems(counter.tab);
    assert.ok(problems.length >= 4, '反例：校验照单全收时这组检查要红，实际只挑出 ' + JSON.stringify(problems));
  } finally { await browser.close(); }
});

// 图下「数据表」「复制图片」键的边：真页面计算样式，边色（叠到键底上）对键底、对背后图卡的实际底都要 ≥ 3:1。
// 日 / 夜 × Metre / 非 Metre × 普通 / 按下。反例：把边换回 --pk-faint，同一组检查要红。
const keyEdgeProblems = (tab) => tab.evaluate(() => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const box = document.querySelector('.pk-rich--chart');
  const behind = parse(getComputedStyle(box).backgroundColor);
  if (!behind || behind.a < 1) return [`图卡底不是实底：${getComputedStyle(box).backgroundColor}`];
  const out = [];
  for (const key of box.querySelectorAll('.pk-chart__key')) {
    const cs = getComputedStyle(key);
    const edge = parse(cs.boxShadow) || parse(cs.borderTopColor);
    const own = parse(cs.backgroundColor) || {r: 0, g: 0, b: 0, a: 0};
    if (!edge) { out.push(`${key.textContent} 没有边`); continue; }
    const keyBg = over(own, behind);
    const opacity = Number(cs.opacity);
    const seen = over({...edge, a: edge.a * opacity}, keyBg);
    const state = key.getAttribute('aria-pressed') === 'true' ? '按下' : '普通';
    const a = ratio(seen, keyBg), b = ratio(seen, behind);
    if (a < 3 || b < 3) out.push(`${key.textContent}（${state}）边对键底 ${a.toFixed(2)}、对图卡底 ${b.toFixed(2)}`);
  }
  return out;
});

test('图表：「数据表」「复制图片」键的边日夜、Metre 和非 Metre、普通和按下都 ≥ 3:1；反例（边换回 --pk-faint）要红', async () => {
  const browser = sharedBrowser();
  try {
    const measure = async (opts) => {
      const {tab, errors} = await open(browser, [JSON.stringify(GOOD)], opts);
      const found = await keyEdgeProblems(tab);
      const table = tab.locator('.pk-chart__key', {hasText: '数据表'}).first();
      await table.click();
      await tab.mouse.move(0, 0);
      assert.equal(await table.getAttribute('aria-pressed'), 'true', '「数据表」点了是按下态');
      found.push(...await keyEdgeProblems(tab));
      assert.deepEqual(errors, []);
      await tab.close();
      return found;
    };
    const cases = [{mode: 'chat'}, {mode: 'chat', night: true}, {mode: 'metre', skin: true}, {mode: 'metre', night: true, skin: true}];
    for (const opts of cases) assert.deepEqual(await measure(opts), [], JSON.stringify(opts));
    // 反例：普通态的边换回 --pk-faint，四种里都要挑出来
    const faint = (css) => css.replace('box-shadow: inset 0 0 0 1px var(--pk-mute)', 'box-shadow: inset 0 0 0 1px var(--pk-faint)');
    for (const opts of cases) {
      const bad = await measure({...opts, mutateCss: faint});
      assert.ok(bad.length >= 1, `${JSON.stringify(opts)} 反例没红`);
    }
  } finally { await browser.close(); }
});
