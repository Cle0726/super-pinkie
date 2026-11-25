import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

// 11-24 验收打回第 3 条：后台带写「网关 连着」，同一时刻总谱顶上却是「连接断了，正在重连」。两边要读同一份连接状态，
// 连接恢复后总谱的断线条和「此刻」必须一起恢复。流程：先断线，再恢复，再打开总谱；以及总谱开着时断线、恢复。
const file = (name) => fileURLToPath(new URL('../ui/injections/' + name, import.meta.url));
const read = (name) => fs.readFileSync(file(name), 'utf8');

test('the backstage band and the score read one connection state, so neither says the gateway is down after it came back', {timeout: 60_000}, async (t) => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage({viewport: {width: 1024, height: 720}});
    const body = `<!doctype html><html data-laolao-mode="metre"><head><style>${read('laolao-metre-board.css')}\n${read('laolao-metre-keys.css')}</style></head>
      <body><main class="content" style="position:fixed;inset:0"></main><section class="agent-chat__input" style="position:fixed;left:100px;top:560px;width:780px;height:92px"></section></body></html>`;
    await tab.route('http://127.0.0.1:30118/**', (route) => route.fulfill({contentType: 'text/html', body}));
    await tab.goto('http://127.0.0.1:30118/chat?session=agent%3Ametre%3Atest');
    await tab.evaluate(() => {
      window.CONN = {online: true, attempt: 0};
      window.calls = [];
      window.__pinkieRunStatus = {get state() { return {key: 'agent:metre:test', status: {active: false}, conn: {...window.CONN}}; }, refresh: async () => null};
      window.__laolaoSidebar = {gwRequest: async (method) => {
        window.calls.push(method);
        if (!window.CONN.online) throw new Error('offline');
        if (method === 'pinkie.metre.board') return {overview: {state: 'Metre 空闲', running: 0, limit: 4, started: 0, cap: 8, returned: 0, failed: 0}, sessions: [], pending: [], timeline: [], changes: [], runtime: {}, raw: []};
        if (method === 'pinkie.engines.status') return {enabled: false};
        return {};
      }};
    });
    for (const name of ['laolao-metre-board.js', 'laolao-metre-board-data.js', 'laolao-metre-backstage.js']) await tab.addScriptTag({content: read(name)});
    const tick = () => tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})));
    const band = () => tab.evaluate(() => document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)')?.innerText.replace(/\s+/g, ' ') || '');
    const score = () => tab.evaluate(() => ({notice: document.querySelector('#pk-metre-board .pk-metre-board__notice')?.textContent || '', text: document.getElementById('pk-metre-board')?.innerText || '', stale: window.__pinkieMetreBoardData.stale}));
    await tick();
    assert.match(await band(), /网关 连着/);
    // 1. 先断线，再恢复，再打开总谱
    await tab.evaluate(() => { window.CONN.online = false; window.dispatchEvent(new Event('pinkie:sidebar-gateway-lost')); });
    await tick();
    assert.match(await band(), /网关 断了/, 'the band follows the gateway store');
    await tab.evaluate(() => { window.CONN.online = true; window.dispatchEvent(new Event('pinkie:sidebar-gateway-ready')); });
    await tick();
    await tab.evaluate(() => window.__pinkieMetreBoard.open());
    await tab.waitForFunction(() => window.calls.includes('pinkie.metre.board') && /Metre 空闲/.test(document.getElementById('pk-metre-board')?.innerText || ''), null, {timeout: 5000});
    let s = await score();
    assert.equal(s.stale, false);
    assert.equal(s.notice, '', 'no 断线 strip once the gateway is back');
    assert.doesNotMatch(s.text, /连接断了/);
    assert.match(await band(), /网关 连着/);
    // 2. 总谱开着时断线：两边一起说断了；恢复：断线条和「此刻」一起恢复
    await tab.evaluate(() => { window.CONN.online = false; window.dispatchEvent(new Event('pinkie:sidebar-gateway-lost')); });
    await tick();
    s = await score();
    assert.match(s.notice, /连接断了/); assert.match(await band(), /网关 断了/);
    await tab.evaluate(() => { window.CONN.online = true; });
    await tick();
    await tab.waitForFunction(() => !document.querySelector('#pk-metre-board .pk-metre-board__notice') && /Metre 空闲/.test(document.getElementById('pk-metre-board')?.innerText || ''), null, {timeout: 5000});
    assert.match(await band(), /网关 连着/);
    // 3. 连着、但这次总谱没读到：说「没读到」，不说「连接断了」
    await tab.evaluate(() => { const real = window.__laolaoSidebar.gwRequest; window.__laolaoSidebar.gwRequest = async (m, ...rest) => (m === 'pinkie.metre.board' ? Promise.reject(new Error('bad')) : real(m, ...rest)); window.__pinkieMetreBoardData.refresh(); });
    await tab.waitForFunction(() => /没读到/.test(document.querySelector('#pk-metre-board .pk-metre-board__notice')?.textContent || ''), null, {timeout: 5000});
    assert.doesNotMatch((await score()).text, /连接断了/);
  } finally { await browser.close(); }
});

// 11-24 复验第 1 条：「不同步」两个方向都要认。页面以为在跑（停止键亮着、chatRunId 有值）、后台却空闲——这正是用户最常碰到的「转圈不停」；
// 以及后台在跑、页面停着。超过 3 秒都显示「不同步」和「同步」键；对上以后（页面自己被清掉，或者点了同步）说 2 秒「已和后台对齐」再回常态。
test('the band calls out an unsynced round in both directions after 3 seconds, and says it is aligned again for 2 seconds', {timeout: 60_000}, async (t) => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage({viewport: {width: 1024, height: 720}});
    const body = `<!doctype html><html data-laolao-mode="metre"><head><style>${read('laolao-metre-keys.css')}</style></head>
      <body><main class="content" style="position:fixed;inset:0"></main><section class="agent-chat__input" style="position:fixed;left:100px;top:560px;width:780px;height:92px"></section></body></html>`;
    await tab.route('http://127.0.0.1:30119/**', (route) => route.fulfill({contentType: 'text/html', body}));
    await tab.goto('http://127.0.0.1:30119/chat?session=agent%3Ametre%3Atest');
    await tab.evaluate(() => {
      window.ACTIVE = false;
      const pane = document.createElement('openclaw-chat-pane'); pane.state = {chatRunId: null, chatSending: false, chatStream: null, chatQueue: [], sessionKey: 'agent:metre:test'}; document.body.append(pane);
      window.__pinkieRunStatus = {get state() { return {key: 'agent:metre:test', status: {active: window.ACTIVE}, conn: {online: true, attempt: 0}, live: {active: false}}; },
        refresh: async () => { if (window.FINISH_ON_REFRESH) window.ACTIVE = false; return null; }};
      window.__laolaoSidebar = {gwRequest: async (method) => (method === 'pinkie.engines.status' ? {enabled: false} : {})};
    });
    await tab.addScriptTag({content: read('laolao-metre-backstage.js')});
    const tick = () => tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})));
    // 读每一格的 title（就是全文）。带子按输入框宽度选全文 / 短档，CI 的 Linux 没有同款中文字体，780px 放不下全文就换短档，
    // 可见文字跟着环境变；title 两档一样，断言只看状态，不看字体。
    const band = () => tab.evaluate(() => [...document.querySelectorAll('.pk-metre-backstage:not(.pk-metre-backstage--probe) .pk-bs__seg')].map((n) => n.title).join(' '));
    const hasSync = () => tab.evaluate(() => Boolean(document.querySelector('.pk-metre-backstage .pk-bs__sync')));
    await tick();
    assert.match(await band(), /本轮 后台空闲 · 页面停着/);
    // 1. 页面以为在跑、后台空闲：不到 3 秒不喊；过了 3 秒自己变成「不同步」（中间没有任何事件，靠带子自己的一次性复查）
    await tab.evaluate(() => { document.querySelector('openclaw-chat-pane').state.chatRunId = 'stuck-run'; });
    await tick();
    await tab.waitForTimeout(1200);
    assert.match(await band(), /本轮 后台空闲 · 页面在等回复/);
    assert.equal(await hasSync(), false);
    await tab.waitForTimeout(2400);
    assert.match(await band(), /不同步 · 后台空闲 · 页面在等回复/, 'page waiting but the backend is idle is unsynced too');
    assert.equal(await hasSync(), true, 'and offers 同步');
    // 2. 页面自己被清掉（已有代码约 4 秒后会清）：先说「已和后台对齐」，停 2 秒再回常态
    await tab.evaluate(() => { document.querySelector('openclaw-chat-pane').state.chatRunId = null; });
    await tab.waitForTimeout(800);
    assert.match(await band(), /本轮 已和后台对齐/);
    await tab.waitForTimeout(2000);
    assert.match(await band(), /本轮 后台空闲 · 页面停着/);
    // 3. 反方向：后台在跑、页面停着；过了 3 秒「不同步」，点「同步」以后后台这一轮也结束了 → 「已和后台对齐」→ 常态
    await tab.evaluate(() => { window.ACTIVE = true; window.FINISH_ON_REFRESH = false; });
    await tick();
    await tab.waitForTimeout(3600);
    assert.match(await band(), /不同步 · 后台在跑 · 页面停着/);
    await tab.evaluate(() => { window.FINISH_ON_REFRESH = true; document.querySelector('.pk-metre-backstage .pk-bs__sync').click(); });
    await tab.waitForFunction(() => /已和后台对齐/.test(document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe) [data-seg="run"]')?.title || ''), null, {timeout: 3000});
    await tab.waitForTimeout(2600);
    assert.match(await band(), /本轮 后台空闲 · 页面停着/);
  } finally { await browser.close(); }
});

// 11-24 16:10 打回第 4 条：820 宽时状态带走短档，引擎 4 个声部（1 失败、1 等你）只剩「引擎 4」，「不同步」也只剩三个字、看不出哪边在跑。
// 复发测试：短档的引擎格留最要紧的一项（失败 > 等你 > 在跑），不同步格带上后台在跑 / 空闲；输入框窄到只能走短档时，每一格都不挤字。
// 18:06 预审第 1 条：失败和等你同时有时，短档两个数都要留（「引擎 4 · 1 败 · 1 等」），不能只剩失败。
// 19:50 审查建议：不用「✕」「!」符号（读屏念成乘号 / 叹号，✕ 像关闭键）；引擎格按钮的读屏名（aria-label）是全档文字。
test('the short tier of the band still says what failed or waits, and which side is running when unsynced', {timeout: 60_000}, async (t) => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage({viewport: {width: 820, height: 720}});
    const body = `<!doctype html><html data-laolao-mode="metre"><head><style>${read('laolao-metre-keys.css')}</style></head>
      <body><main class="content" style="position:fixed;inset:0"></main><section class="agent-chat__input" style="position:fixed;left:40px;top:560px;width:300px;height:92px"></section></body></html>`;
    await tab.route('http://127.0.0.1:30120/**', (route) => route.fulfill({contentType: 'text/html', body}));
    await tab.goto('http://127.0.0.1:30120/chat?session=agent%3Ametre%3Atest');
    await tab.evaluate(() => {
      const pane = document.createElement('openclaw-chat-pane'); pane.state = {chatRunId: null, chatSending: false, chatStream: null, chatQueue: [], sessionKey: 'agent:metre:test'}; document.body.append(pane);
      window.__pinkieRunStatus = {get state() { return {key: 'agent:metre:test', status: {active: false}, conn: {online: true, attempt: 0}, live: {active: false}}; }, refresh: async () => null};
      window.__laolaoSidebar = {gwRequest: async (method) => (method === 'pinkie.engines.status' ? {enabled: true, running: true} : {})};
      window.__pinkieMetreBoardData = {data: {sessions: [{key: 'e1', external: true, engineName: 'Codex', state: 'fail'}, {key: 'e2', external: true, engineName: 'Kiro', state: 'wait'},
        {key: 'e3', external: true, engineName: 'Claude', state: 'run'}, {key: 'e4', external: true, engineName: 'Gemini', state: 'done'}]}};
    });
    await tab.addScriptTag({content: read('laolao-metre-backstage.js')});
    // 纯函数：同样的输入同样的短档文字
    const short = await tab.evaluate(() => {
      const d = (o) => Object.fromEntries(window.PinkieMetreBackstage.describe({conn: {online: true}, page: {busy: false, writing: false}, queue: 0, engines: {enabled: true}, since: 0, now: 0, ...o}).cells.map((c) => [c.id, c.short]));
      const v = (...tones) => tones.map((tone, i) => ({key: 'k' + i, name: 'e' + i, tone}));
      return {
        failWait: d({voices: v('fail', 'wait', 'run', 'done')}).eng, failOnly: d({voices: v('fail', 'run')}).eng, fail2wait3: d({voices: v('fail', 'fail', 'wait', 'wait', 'wait')}).eng, wait: d({voices: v('wait', 'run')}).eng, run: d({voices: v('run', 'done')}).eng, done: d({voices: v('done')}).eng,
        backRunning: d({status: {active: true}, page: {busy: false}, since: 1, now: 5000, voices: []}).run,
        backIdle: d({status: {active: false}, page: {busy: true}, since: 1, now: 5000, voices: []}).run,
      };
    });
    assert.deepEqual(short, {failWait: '引擎 4 · 1 败 · 1 等', failOnly: '引擎 2 · 1 失败', fail2wait3: '引擎 5 · 2 败 · 3 等', wait: '引擎 2 · 1 等你', run: '引擎 2 · 1 在跑', done: '引擎 1',
      backRunning: '不同步 · 后台在跑', backIdle: '不同步 · 后台空闲'});
    // 真画出来：窄输入框只能走短档，引擎格失败数、等你数都在，每一格都不挤字
    await tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})));
    const drawn = await tab.evaluate(() => {
      const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)');
      return {tier: band?.dataset.tier, eng: band?.querySelector('[data-seg="eng"] span')?.textContent, engLabel: band?.querySelector('[data-seg="eng"]')?.getAttribute('aria-label'),
        squeezed: [...band.querySelectorAll('.pk-bs__seg')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent)};
    });
    assert.equal(drawn.tier, 'short');
    assert.equal(drawn.eng, '引擎 4 · 1 败 · 1 等', '820 宽短档：1 失败 + 1 等你两个数都要留');
    assert.equal(drawn.engLabel, '引擎 4 · 1 失败 · 1 等你', '短档时读屏名仍是全档文字');
    assert.deepEqual(drawn.squeezed, [], '短档每一格都放得下');
  } finally { await browser.close(); }
});

test('the band and the model row under the composer sit on one solid theme plate, day and night, so no pixel backdrop shows behind their text', {timeout: 60_000}, async (t) => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage({viewport: {width: 1024, height: 768}});
    // 一整块红色铺在最底下代替像素背景（skin.css 会把 html / body 刷成主题底色，所以不能直接染 body）：底板 / 带子哪里没盖住，取色就会取到红色
    const body = `<!doctype html><html data-laolao-mode="metre"><head><style>${read('laolao-metre-skin.css')}</style><style>${read('laolao-metre-keys.css')}</style>
      <style>body { margin: 0; } .agent-chat__composer-shell { position: fixed; left: 122px; top: 638px; width: 780px; height: 106px; z-index: 1; }</style></head>
      <body><div id="pixel-stand-in" style="position:fixed;inset:0;z-index:0;background:rgb(255,0,0)"></div><div class="agent-chat__composer-shell"><section class="agent-chat__input"></section></div>
      <div class="pk-metre-backstage" style="left:122px;top:736px;width:780px;z-index:2"><span class="pk-bs__label">后台</span><span class="pk-bs__seg" data-tone="fail"><i></i><span>引擎 4</span></span></div></body></html>`;
    await tab.route('http://127.0.0.1:30121/**', (route) => route.fulfill({contentType: 'text/html', body}));
    await tab.goto('http://127.0.0.1:30121/chat');
    const look = () => tab.evaluate(() => {
      const shell = document.querySelector('.agent-chat__composer-shell'), band = document.querySelector('.pk-metre-backstage');
      const cs = getComputedStyle(shell), r = shell.getBoundingClientRect();
      return {plate: cs.backgroundImage, bandBg: getComputedStyle(band).backgroundColor, labelInk: getComputedStyle(band.querySelector('.pk-bs__label')).color,
        bg: getComputedStyle(document.documentElement).getPropertyValue('--metre-bg').trim(), h: Math.round(r.height)};
    });
    const lum = (rgb) => { const v = rgb.match(/\d+/g).slice(0, 3).map((n) => +n / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((m, n) => n - m); return (hi + 0.05) / (lo + 0.05); };
    // 首页（没有后台带）：外壳照旧透明
    let s = await look();
    assert.equal(s.plate, 'none', '没有后台带时外壳不加底板');
    for (const night of [false, true]) {
      await tab.evaluate((n) => { const h = document.documentElement; h.setAttribute('data-metre-bs', ''); if (n) h.setAttribute('data-pinkie-night', ''); else h.removeAttribute('data-pinkie-night'); }, night);
      s = await look();
      const want = night ? 'rgb(21, 21, 20)' : 'rgb(247, 246, 243)';
      assert.equal(s.bandBg, want, (night ? '夜间' : '日间') + '后台带整条是 --metre-bg 底色');
      assert.match(s.plate, /linear-gradient\(to top, rgb\(\d+, \d+, \d+\) 68px, rgba\(0, 0, 0, 0\) 68px\)/, '外壳下 68px（框体下圆角到后台带）一块底板');
      assert.ok(s.plate.includes(want), (night ? '夜间' : '日间') + '底板也是 --metre-bg');
      assert.ok(ratio(s.labelInk, s.bandBg) >= 4.5, '「后台」字对底 ≥ 4.5:1');
      // 真画出来：模型那一排（外壳下沿往上 14–44px）和带子上取色，不能是红的
      // 取色只看底板和带子自己：把输入框本体拿掉（它自带 --metre-surface 底色，会盖住外壳上部，让「上面透出背景」那一点取不到红）
      await tab.evaluate(() => document.querySelector('.agent-chat__composer-shell .agent-chat__input')?.remove());
      const shot = await tab.screenshot({clip: {x: 122, y: 638, width: 780, height: 122}});
      const px = await tab.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const at = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3).join(',');
        return {model: [at(20, 106 - 30), at(400, 106 - 20), at(770, 106 - 40)], band: [at(4, 98 + 12), at(500, 98 + 3), at(775, 98 + 12)], above: at(400, 2)}; }, shot.toString('base64'));
      const wantPx = want.match(/\d+/g).join(',');
      // 截图解码会有 ±1–2 的色差，差 4 以内算同一底色（红色差两百多，不会混进来）
      const near = (got) => got.split(',').every((c, i) => Math.abs(+c - +wantPx.split(',')[i]) <= 4);
      assert.ok(px.model.every(near), '模型那一排身后是实底，像素背景透不出来：' + px.model.join(' / '));
      assert.ok(px.band.every(near), '后台带左端「后台」、格与格之间、右端都是实底：' + px.band.join(' / '));
      assert.equal(px.above, '255,0,0', '底板只到框体下圆角，上面对话区照旧透出背景');
    }
  } finally { await browser.close(); }
});
