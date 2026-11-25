// R4：Metre 里「预览本地服务」（laolao-metre-preview.js）。
// 复发防护：
//   1. 这一轮工具输出里的本地服务地址（Vite / Next / python -m http.server，带颜色码也行）都要认出来，去重、最多 3 个；
//      18789（正式网关）和当前页面自己的端口绝不出签；外站地址不出签。
//   2. 点了交给碧琪的浏览器（Mac 桥 / Windows 桥 / 回退新标签页），不把整页导航走，不自动打开。
//   3. 离开 Metre 整行拿掉；其他模式一个字不动。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const js = read('../ui/injections/laolao-metre-preview.js');
const css = read('../ui/injections/laolao-metre-preview.css');
const domWatch = read('../ui/injections/laolao-dom-watch.js');
const head = read('../ui/injections/laolao-head.fragment.html');
const regions = JSON.parse(read('../ui/injections/regions.json'));
const PORT = 30123;

const t = text => [{type: 'text', text}];
const history = [
  {role: 'user', content: t('起个开发服务'), timestamp: 1},
  {role: 'assistant', content: [{type: 'toolCall', id: 'a', name: 'exec'}], timestamp: 2},
  {role: 'toolResult', toolName: 'exec', content: t('\u001b[32m  VITE v5.2.0  ready in 312 ms\u001b[39m\n\n  ➜  Local:   \u001b[36mhttp://localhost:5173/\u001b[39m\n  ➜  Network: use --host to expose'), timestamp: 3},
  {role: 'toolResult', toolName: 'exec', content: t('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...'), timestamp: 4},
  {role: 'toolResult', toolName: 'exec', content: t(`网关在 http://127.0.0.1:18789/ ，页面在 http://127.0.0.1:${PORT}/chat ，文档 https://vitejs.dev/guide/ 。再看 http://localhost:5173/ 。`), timestamp: 5},
  {role: 'assistant', content: t('开好了，在 5173。'), timestamp: 6},
  {role: 'user', content: t('再起一个'), timestamp: 7},
  {role: 'toolResult', toolName: 'exec', content: t('- Local:        http://localhost:3000\n- Ready in 1.2s\n  docs: http://localhost:3000/docs/getting-started/installation?lang=zh-CN'), timestamp: 8},
  {role: 'assistant', content: t('好了。'), timestamp: 9},
  {role: 'user', content: t('谢谢'), timestamp: 10},
  {role: 'assistant', content: t('不客气。'), timestamp: 11},
];
const group = index => `<div class="chat-group assistant" id="g${index}"><div class="chat-avatar assistant"></div><div class="chat-group-messages">
<div class="chat-bubble" data-message-id="msg:assistant:${history[index].timestamp}:${index}"><div class="chat-text"><p>${history[index].content[0].text}</p></div></div>
<div class="chat-group-footer"></div></div></div>`;
const page = mode => `<!doctype html><html data-laolao-mode="${mode}"><head><style>${css}</style></head><body>
<openclaw-chat-pane active><div class="chat-thread" style="width:760px"><div class="chat-thread-inner">${group(5)}${group(8)}${group(10)}</div></div></openclaw-chat-pane></body></html>`;

// 整个文件只起一个浏览器（CI 里测试文件并行跑，多起会拖慢别的文件里的浏览器测试）。
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
async function open(browser, mode, bridge) {
  const tab = await browser.newPage({viewport: {width: 1024, height: 700}});
  await tab.route(`http://127.0.0.1:${PORT}/**`, route => route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode)}));
  await tab.goto(`http://127.0.0.1:${PORT}/chat`);
  await tab.evaluate(([items, bridge]) => {
    document.querySelector('openclaw-chat-pane').state = {chatMessages: items};
    window.__pinkieMessageActions = {historyItem: (id, list) => list.find(item => id === `msg:${item.role}:${item.timestamp}:${list.indexOf(item)}`) || null};
    window.opened = [];
    if (bridge === 'mac') window.webkit = {messageHandlers: {laolaoBrowserWorkspace: {postMessage: m => window.opened.push(['mac', m.url])}}};
    if (bridge === 'windows') {
      document.documentElement.dataset.pinkiePlatform = 'windows';
      window.pywebview = {api: {browser_workspace: m => window.opened.push(['windows', m.url])}};
    }
    window.open = url => { window.opened.push(['tab', url]); return null; };
  }, [history, bridge || '']);
  await tab.addScriptTag({content: domWatch});
  await tab.addScriptTag({content: js});
  return tab;
}
const chips = (tab, id) => tab.locator(`#${id} .pk-mprev-chip`).evaluateAll(list => list.map(a => [a.textContent, a.href]));

test('loaded after the Metre engine files, owned by the metre region, no new observer / interval / window.__ global', () => {
  const at = name => head.indexOf(`/${name}?v=@hash`);
  assert.ok(at('laolao-metre-preview.css') > at('laolao-metre-engine.js'));
  assert.ok(at('laolao-metre-preview.js') > at('laolao-metre-preview.css'));
  const metre = Object.values(regions.regions || regions).find(region => (region.files || []).includes('laolao-metre-engine.js'));
  assert.ok(metre?.files.includes('laolao-metre-preview.js') && metre.files.includes('laolao-metre-preview.css'));
  assert.doesNotMatch(js, /new MutationObserver|setInterval\(|window\.__\w+\s*=/);
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|WebSocket/, 'never probes the address');
  assert.doesNotMatch(css, /!important/);
});

test('in Metre: local server addresses from this turn become one preview row; 18789, the page itself and outside sites never do', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'metre', 'mac');
    await tab.locator('#g5 .pk-mprev-row').waitFor({timeout: 5000});
    assert.deepEqual(await chips(tab, 'g5'), [['localhost:5173', 'http://localhost:5173/'], ['127.0.0.1:8000', 'http://127.0.0.1:8000/']]);
    assert.deepEqual(await chips(tab, 'g8'), [
      ['localhost:3000', 'http://localhost:3000/'],
      ['localhost:3000/docs/…', 'http://localhost:3000/docs/getting-started/installation?lang=zh-CN'],
    ], 'each turn only gets its own tool results; long paths are shortened in the label, not cut by CSS');
    assert.equal(await tab.locator('#g8 .pk-mprev-chip').nth(1).getAttribute('aria-label'), '预览 http://localhost:3000/docs/getting-started/installation?lang=zh-CN');
    assert.equal(await tab.locator('#g10 .pk-mprev-row').count(), 0, 'a turn without servers gets no row');
    // 行在回答和按键区之间
    // 原生结构里按键区在 .chat-group-messages 里面；行要在气泡和按键区之间，和气泡同一列，不能挤到头像旁边去
    const place = await tab.locator('#g5').evaluate(g => { const row = g.querySelector('.pk-mprev-row'); return [row.parentElement.className, row.previousElementSibling?.className, row.nextElementSibling?.className]; });
    assert.deepEqual(place, ['chat-group-messages', 'chat-bubble', 'chat-group-footer']);
    const look = await tab.locator('#g5 .pk-mprev-chip').first().evaluate(a => { const r = a.getBoundingClientRect(); const row = a.closest('.pk-mprev-row').getBoundingClientRect(); return {h: Math.round(r.height), inside: r.right <= row.right + 1}; });
    assert.deepEqual(look, {h: 26, inside: true});
    // 重画不重复
    await tab.evaluate(() => window.Pinkie.metrePreview.paint());
    await tab.waitForTimeout(100);
    assert.equal(await tab.locator('#g5 .pk-mprev-row').count(), 1);
    // 点了交给碧琪的浏览器，页面不跳走
    await tab.locator('#g5 .pk-mprev-chip').first().click();
    assert.deepEqual(await tab.evaluate(() => window.opened), [['mac', 'http://localhost:5173/']]);
    assert.equal(new URL(tab.url()).port, String(PORT));
    // 离开 Metre 整行拿掉
    await tab.evaluate(() => { document.documentElement.setAttribute('data-laolao-mode', 'chat'); window.dispatchEvent(new Event('laolao:modechange')); });
    await tab.waitForFunction(() => !document.querySelector('.pk-mprev-row'));
  } finally { await browser.close(); }
});

test('without the Mac bridge it uses the Windows app browser, and plain pages open a new tab', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    for (const [bridge, expected] of [['windows', 'windows'], ['', 'tab']]) {
      const tab = await open(browser, 'metre', bridge);
      await tab.locator('#g8 .pk-mprev-chip').first().click({timeout: 5000});
      assert.deepEqual(await tab.evaluate(() => window.opened), [[expected, 'http://localhost:3000/']]);
      await tab.close();
    }
  } finally { await browser.close(); }
});

test('in other modes nothing changes', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'chat', 'mac');
    await tab.waitForTimeout(400);
    assert.equal(await tab.locator('.pk-mprev-row').count(), 0);
  } finally { await browser.close(); }
});
