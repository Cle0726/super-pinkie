// M13：Metre 里的来源角标和引用卡（laolao-metre-cite.js）。
// 复发防护：
//   1. 同一个网址先被搜到、后来又被 web_fetch 打开过，共用模块会把它挤到最后，[1] 指到第二条结果上（11-24 预览页复现）。
//      Metre 里必须按工具结果出现的先后编号。
//   2. 来源行在回答正文外面，链接预览模块接不到点击，点了会把整个页面导航到外站。Metre 里必须接住。
//   3. 其他模式一个字不动；离开 Metre 时改过的地方原样换回。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const js = read('../ui/injections/laolao-metre-cite.js');
const css = read('../ui/injections/laolao-metre-cite.css');
const domWatch = read('../ui/injections/laolao-dom-watch.js');
const head = read('../ui/injections/laolao-head.fragment.html');
const regions = JSON.parse(read('../ui/injections/regions.json'));

const N = 'https://nodejs.org/en/blog/release/v22.0.0';
const V = 'https://v8.dev/blog/v8-release-124';
const E = 'https://example.com/posts/node-22';
const t = text => [{type: 'text', text}];
const results = [
  {title: 'Node.js 22 发布说明', url: N, snippet: 'require(esm) 实验支持'},
  {title: 'V8 12.4 新特性', url: V, snippet: 'Maglev 默认开启'},
  {title: '', url: E, snippet: ''},
];
const history = [
  {role: 'user', content: t('Node 22 有什么新东西'), timestamp: 1},
  {role: 'assistant', content: [{type: 'toolCall', id: 'a', name: 'web_search'}], timestamp: 2},
  {role: 'toolResult', toolName: 'web_search', content: t(JSON.stringify({query: 'node 22', results})), timestamp: 3},
  {role: 'assistant', content: [{type: 'toolCall', id: 'b', name: 'web_fetch'}], timestamp: 4},
  {role: 'toolResult', toolName: 'web_fetch', content: t(JSON.stringify({url: N, finalUrl: N, title: 'Node.js 22 发布说明', text: '正文'})), timestamp: 5},
  {role: 'assistant', content: t('三点 [1] [2] [3]'), timestamp: 6},
];
// 共用模块（laolao-session-tools.js）现在实际画出来的样子：倒着收集，nodejs.org 被挤到了第 3。
const shared = [V, E, N];
const page = mode => `<!doctype html><html data-laolao-mode="${mode}"><head><style>${css}</style></head><body>
<openclaw-chat-pane active><div class="chat-thread" style="width:760px"><div class="chat-thread-inner">
<div class="chat-group assistant" data-pinkie-sources="${shared.join('|')}"><div class="chat-group-messages">
<div class="chat-bubble" data-message-id="msg:assistant:6:5"><div class="chat-text"><p>三点
${shared.map((url, i) => `<a class="pinkie-cite" href="${url}" aria-label="来源 ${i + 1}：x">${i + 1}</a>`).join(' ')}</p></div></div></div>
<div class="pinkie-sources"><span class="pinkie-sources__label">来源：</span>${shared.map((url, i) => `<a class="pinkie-sources__item" href="${url}">[${i + 1}] ${new URL(url).hostname}</a>`).join('')}</div>
<div class="chat-group-footer"></div></div></div></div></openclaw-chat-pane></body></html>`;

// 整个文件只起一个浏览器（CI 里所有测试文件并行跑，每个测试都起一个会拖慢别的文件里的浏览器测试）；
// 每个测试自己开页面、用完关掉自己的页面，互不影响；文件跑完关浏览器。
let sharedBrowser;
after(async () => { const b = await sharedBrowser; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}
async function launch(t) {
  sharedBrowser ??= start();
  const b = await sharedBrowser;
  if (b.why) { t.skip(b.why); return null; }
  return {newPage: (...a) => b.newPage(...a), close: async () => { for (const c of b.contexts()) await c.close(); }};
}
async function open(browser, mode) {
  const tab = await browser.newPage({viewport: {width: 1024, height: 700}});
  await tab.route('http://127.0.0.1:30121/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode)}));
  await tab.route(/^https:\/\//, route => route.fulfill({contentType: 'text/html', body: '<h1>外站</h1>'}));
  await tab.goto('http://127.0.0.1:30121/chat');
  await tab.evaluate(items => {
    document.querySelector('openclaw-chat-pane').state = {chatMessages: items};
    window.__pinkieMessageActions = {historyItem: (id, list) => list.find(item => id === `msg:${item.role}:${item.timestamp}:${list.indexOf(item)}`) || null};
    window.opened = [];
    window.open = (url) => { window.opened.push(url); return null; };
  }, history);
  await tab.addScriptTag({content: domWatch});
  await tab.addScriptTag({content: js});
  return tab;
}
const hrefs = (tab, sel) => tab.$$eval(sel, nodes => nodes.map(node => node.getAttribute('href')));

test('loaded after the Metre engine files and owned by the metre region', () => {
  assert.match(head, /laolao-metre-cite\.css\?v=@hash/);
  assert.match(head, /laolao-metre-cite\.js\?v=@hash/);
  const metre = regions.regions?.find?.(r => r.id === 'metre') || Object.values(regions).flat().find?.(r => r?.id === 'metre');
  assert.ok(metre, 'metre region exists');
  assert.ok(metre.files.includes('laolao-metre-cite.js') && metre.files.includes('laolao-metre-cite.css'));
  assert.doesNotMatch(js, /new\s+MutationObserver|setInterval\s*\(|window\.__\w+\s*=(?!=)/, 'no new observer, interval or window.__ global');
  for (const rule of css.match(/^[^@\s/}][^{]*\{/gm) || []) assert.match(rule, /html\[data-laolao-mode="metre"\]/, 'every rule is scoped to Metre: ' + rule);
});

test('in Metre: cites follow the order the tools returned them, the card shows the source, and the row opens links in place', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'metre');
    await tab.locator('.pk-mcite-row').waitFor();
    assert.deepEqual(await hrefs(tab, '.pinkie-cite'), [N, V, E], '[1] is the first search result, even though web_fetch opened it later');
    assert.deepEqual(await hrefs(tab, '.pk-mcite-chip'), [N, V, E]);
    assert.equal(await tab.locator('.pk-mcite-chip').nth(2).locator('.pk-mcite-chip__title').textContent(), 'example.com', 'no title → the site name');
    assert.match(await tab.locator('.pinkie-cite').first().getAttribute('aria-label'), /^来源 1：Node\.js 22 发布说明，nodejs\.org$/);

    await tab.locator('.pinkie-cite').first().hover();
    const card = tab.locator('.pk-mcite-card:not([role])');
    await card.waitFor();
    assert.match(await card.innerText(), /nodejs\.org[\s\S]*Node\.js 22 发布说明[\s\S]*require\(esm\)/);
    assert.equal(await tab.locator('.pinkie-cite').first().getAttribute('aria-describedby'), 'pk-mcite-card');
    const box = await card.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1024 && box.y + box.height <= 700, 'card stays inside the window');
    await tab.mouse.move(2, 2);
    await tab.waitForFunction(() => !document.querySelector('.pk-mcite-card'));

    await tab.locator('.pk-mcite-chip').nth(1).focus();
    await card.waitFor();
    await tab.keyboard.press('Escape');
    await tab.waitForFunction(() => !document.querySelector('.pk-mcite-card'));

    const before = tab.url();
    await tab.locator('.pk-mcite-chip').nth(1).click();
    await tab.waitForTimeout(300);
    assert.equal(tab.url(), before, 'the page itself does not navigate away');
    assert.deepEqual(await tab.evaluate(() => window.opened), [V]);

    // 离开 Metre：角标换回原样，Metre 的来源行拿掉、共用模块的签名清掉，它会按原样重建。
    await tab.evaluate(() => { document.documentElement.setAttribute('data-laolao-mode', 'chat'); window.dispatchEvent(new CustomEvent('laolao:modechange')); });
    await tab.waitForFunction(() => !document.querySelector('.pk-mcite-row'));
    assert.deepEqual(await hrefs(tab, '.pinkie-cite'), shared);
    assert.equal(await tab.locator('[data-pk-cite-n], [data-pk-cite-href]').count(), 0);
    assert.equal(await tab.locator('.chat-group').getAttribute('data-pinkie-sources'), null);
  } finally { await browser.close(); }
});

test('in other modes nothing changes', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'chat');
    await tab.waitForTimeout(400);
    assert.deepEqual(await hrefs(tab, '.pinkie-cite'), shared);
    assert.equal(await tab.locator('.pk-mcite-row, .pk-mcite-chip, [data-pk-cite-n]').count(), 0);
    await tab.locator('.pinkie-cite').first().hover();
    await tab.waitForTimeout(300);
    assert.equal(await tab.locator('.pk-mcite-card').count(), 0);
  } finally { await browser.close(); }
});
