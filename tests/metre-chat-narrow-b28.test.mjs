import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

// B28（uireview #218 记，main 已有）：1440 开着工作台时 Metre 聊天栏只有约 340px 宽——
// 1. 后台带短档也放不下，四格定宽 flex: none，最右「排队」被带子右沿截掉。→ 紧档：格子可缩、省略号，「排队」不缩。
// 2. 框下那排控件折成两行，外壳高了一行，工具键、发送 / 麦克风键按外壳下沿 49px 摆，就骑到输入框下框线上。
//    → 锚点定位挂在输入框本体下沿（laolao-metre-skin.css :714）；一行时位置和原来一样。
// 模型名截断本来就有省略号（laolao-workbench.css :518）和 title（laolao-model-picker.js :1743），这里不重复测。
const file = (name) => fileURLToPath(new URL('../ui/injections/' + name, import.meta.url));
const read = (name) => fs.readFileSync(file(name), 'utf8');

let shared = null;
async function sharedBrowser(t) {
  shared ??= (async () => {
    let lib;
    try { lib = playwright(); } catch { return {skip: 'Playwright is not installed here'}; }
    const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
    try { return {browser: await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})})}; }
    catch (error) { return {skip: 'no browser: ' + error.message.split('\n')[0]}; }
  })();
  const got = await shared;
  if (got.skip) { t.skip(got.skip); return null; }
  return got.browser;
}
after(async () => { const got = await shared; if (got?.browser) await got.browser.close(); });

test('B28: when even the short tier does not fit, the band goes tight, no cell runs past its right edge and 排队 is never cut', {timeout: 60_000}, async (t) => {
  const browser = await sharedBrowser(t); if (!browser) return;
  const context = await browser.newContext({viewport: {width: 1440, height: 800}});
  try {
    const tab = await context.newPage();
    const body = `<!doctype html><html data-laolao-mode="metre"><head><style>${read('laolao-metre-keys.css')}</style></head>
      <body><main class="content" style="position:fixed;inset:0"></main><section class="agent-chat__input" style="position:fixed;left:1076px;top:640px;width:340px;height:92px"></section></body></html>`;
    await tab.route('http://127.0.0.1:30128/**', (route) => route.fulfill({contentType: 'text/html', body}));
    await tab.goto('http://127.0.0.1:30128/chat?session=agent%3Ametre%3Atest');
    await tab.evaluate(() => {
      const pane = document.createElement('openclaw-chat-pane'); pane.state = {chatRunId: null, chatSending: false, chatStream: null, chatQueue: [1, 2, 3], sessionKey: 'agent:metre:test'}; document.body.append(pane);
      window.__pinkieRunStatus = {get state() { return {key: 'agent:metre:test', status: {active: false}, conn: {online: true, attempt: 0}, live: {active: false}}; }, refresh: async () => null};
      window.__laolaoSidebar = {gwRequest: async (method) => (method === 'pinkie.engines.status' ? {enabled: true, running: true} : {})};
      window.__pinkieMetreBoardData = {data: {sessions: [{key: 'e1', external: true, engineName: 'Codex', state: 'fail'}, {key: 'e2', external: true, engineName: 'Kiro', state: 'wait'}]}};
    });
    await tab.addScriptTag({content: read('laolao-metre-backstage.js')});
    const look = () => tab.evaluate(() => {
      window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}}));
      const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)'), b = band.getBoundingClientRect();
      const segs = [...band.querySelectorAll('.pk-bs__seg')];
      const q = band.querySelector('[data-seg="queue"]'), qs = q.querySelector('span');
      return {tier: band.dataset.tier, need: window.PinkieMetreBackstage.tierWidths(), bandW: Math.round(b.width),
        out: segs.filter((n) => n.getBoundingClientRect().right > b.right + 0.5).map((n) => n.dataset.seg),
        queue: qs.textContent, queueCut: qs.scrollWidth > qs.clientWidth + 1, queueTitle: q.title,
        titles: segs.map((n) => n.title || n.getAttribute('aria-label')).every(Boolean)};
    });
    let s = await look();
    assert.ok(s.need.short > s.bandW, `这个宽度短档本来就放不下（短档要 ${s.need.short}，带子 ${s.bandW}）`);
    assert.equal(s.tier, 'tight');
    assert.deepEqual(s.out, [], '紧档：没有一格伸出带子右沿');
    assert.equal(s.queue, '排队 3');
    assert.equal(s.queueCut, false, '「排队」整格完整，不被省略');
    assert.equal(s.queueTitle, '排队 3');
    assert.ok(s.titles, '每一格都有全文（title / 读屏名），缩成省略号也看得到');
    // 反例：格子照旧定宽不许缩（修之前的样子），最右的格子就伸出带子
    const before = await tab.evaluate(() => {
      const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)'), b = band.getBoundingClientRect();
      band.querySelectorAll('.pk-bs__seg').forEach((n) => { n.style.flexShrink = '0'; n.style.minWidth = ''; });
      return [...band.querySelectorAll('.pk-bs__seg')].filter((n) => n.getBoundingClientRect().right > b.right + 0.5).map((n) => n.dataset.seg);
    });
    assert.ok(before.length > 0, '反例：不许缩时有格子伸出带子（修之前就是「排队」被截）：' + before.join(','));
    // 宽到短档放得下时仍是短档，不误入紧档
    await tab.evaluate(() => { document.querySelector('.agent-chat__input').style.width = window.PinkieMetreBackstage.tierWidths().short + 'px'; });
    s = await look();
    assert.equal(s.tier, 'short');
    assert.deepEqual(s.out, []);
  } finally { await context.close(); }
});

test('B28: the tools and send keys stay inside the input box when the control row under it wraps to two lines', {timeout: 60_000}, async (t) => {
  const browser = await sharedBrowser(t); if (!browser) return;
  const context = await browser.newContext({viewport: {width: 1440, height: 800}});
  try {
    const tab = await context.newPage();
    // 和真页面同样的结构：外壳 .agent-chat__input（定位祖先）里，输入框本体在上，框下一排控件；工具键、发送键绝对定位
    const ctl = (w) => `<span class="pk-fake-ctl" style="order:6;flex:none;width:${w}px;height:30px"></span>`;
    const body = `<!doctype html><html data-laolao-mode="metre"><head><style>${read('laolao-metre-skin.css')}</style></head>
      <body style="margin:0"><div class="agent-chat__composer-shell" style="position:fixed;left:40px;top:300px;width:780px"><section class="agent-chat__input">
        <div class="agent-chat__composer-combobox"><textarea placeholder="要做什么?"></textarea></div>
        <button class="pinkie-tray-btn" type="button" style="height:30px"><span>工具</span></button>${ctl(200)}${ctl(150)}${ctl(150)}
        <button class="chat-send-btn chat-send-btn--voice" type="button"></button></section></div></body></html>`;
    await tab.route('http://127.0.0.1:30129/**', (route) => route.fulfill({contentType: 'text/html', body}));
    await tab.goto('http://127.0.0.1:30129/chat');
    const supported = await tab.evaluate(() => CSS.supports('anchor-name: --a'));
    if (!supported) { t.skip('这个浏览器不支持锚点定位，走 bottom 49px 老路，和修之前一样'); return; }
    const look = (w) => tab.evaluate((width) => {
      document.querySelector('.agent-chat__composer-shell').style.width = width + 'px';
      const box = document.querySelector('.agent-chat__composer-combobox').getBoundingClientRect();
      const keys = ['.pinkie-tray-btn', '.chat-send-btn'].map((s) => document.querySelector(s).getBoundingClientRect());
      const rows = new Set([...document.querySelectorAll('.pk-fake-ctl')].map((n) => Math.round(n.getBoundingClientRect().top))).size;
      return {rows, gaps: keys.map((k) => Math.round(box.bottom - k.bottom)), inside: keys.every((k) => k.top >= box.top && k.bottom <= box.bottom - 2)};
    }, w);
    const dropRule = () => tab.evaluate(() => {
      for (const sheet of document.styleSheets) for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
        if (sheet.cssRules[i] instanceof CSSSupportsRule && /anchor-name/.test(sheet.cssRules[i].conditionText)) sheet.deleteRule(i);
      }
    });
    const wide = await look(780), narrow = await look(340);
    assert.equal(wide.rows, 1, '780 宽：框下控件一行');
    assert.equal(narrow.rows, 2, '340 宽：框下控件折成两行（B28 的场景）');
    assert.ok(narrow.inside, '两行时工具键、发送键仍在输入框里：离框下沿 ' + narrow.gaps.join(' / '));
    assert.deepEqual(narrow.gaps, wide.gaps, '两行时离框下沿的距离和一行时一样');
    // 反例：去掉锚点规则（修之前），一行时位置不变，两行时键掉到框线上
    await dropRule();
    const wideOld = await look(780), narrowOld = await look(340);
    for (const [a, b] of wide.gaps.map((g, i) => [g, wideOld.gaps[i]])) assert.ok(Math.abs(a - b) <= 1, `一行时和修之前一样（${wide.gaps} vs ${wideOld.gaps}）`);
    assert.equal(narrowOld.inside, false, '反例：没有锚点规则时两行就骑到框线上：离框下沿 ' + narrowOld.gaps.join(' / '));
  } finally { await context.close(); }
});
