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
// 18:06 预审第 1 条：失败和等你同时有时，短档两个数都要留，不能只剩失败。
// 11-24 21:30 派活第 3 条：「1败·1等」看不懂，写全「引擎 4 · 1 失败 · 1 等你」；格子放不下时省略号，悬停 / 读屏是全文。
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
    assert.deepEqual(short, {failWait: '引擎 4 · 1 失败 · 1 等你', failOnly: '引擎 2 · 1 失败', fail2wait3: '引擎 5 · 2 失败 · 3 等你', wait: '引擎 2 · 1 等你', run: '引擎 2 · 1 在跑', done: '引擎 1',
      backRunning: '不同步 · 后台在跑', backIdle: '不同步 · 后台空闲'});
    // 真画出来：窄输入框只能走短档，引擎格失败数、等你数都在，每一格都不挤字
    await tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})));
    const drawn = await tab.evaluate(() => {
      const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)');
      return {tier: band?.dataset.tier, eng: band?.querySelector('[data-seg="eng"] span')?.textContent, engLabel: band?.querySelector('[data-seg="eng"]')?.getAttribute('aria-label'),
        squeezed: [...band.querySelectorAll('.pk-bs__seg')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent)};
    });
    assert.equal(drawn.tier, 'short');
    assert.equal(drawn.eng, '引擎 4 · 1 失败 · 1 等你', '820 宽短档：1 失败 + 1 等你两个数都要留，写全不缩成「败」「等」');
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

// 11-24 21:30 派活第 2 条：窄窗（820）侧栏抽屉打开、命令面板打开时，后台带（body 上 z=36）画在抽屉 / 遮罩上面，压住 METRE 账号键下半。
// 复发测试：抽屉、命令面板、收起侧栏的悬停卡片开着时，带子退到 app 层（openclaw-app z=1）下面——带子上取点，最上层不许是带子；
// 反例：把 keys.css 里那一条拿掉，同一组取点要变回带子在最上层（证明这条测试能红）。顺带：夜间用量圆环底圈对底 ≥ 3:1。
// 11-24 22:37 打回：z=0 让带子掉到输入框外壳底板下面，格子上沿 6px 被盖、字头被切。遮罩开着时 app 层（openclaw-app z=1）也不再自成层叠上下文，
// 每格上边框和文字区里，遮罩下面第一层必须是带子自己；反例只留 z=0、拿掉 app 层那一条，外壳要盖住格子（测试能红）。
test('the band sinks under the narrow nav drawer, its backdrop and the command palette, so it never covers the METRE key', {timeout: 60_000}, async (t) => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage({viewport: {width: 820, height: 720}});
    const keys = read('laolao-metre-keys.css');
    const fix = keys.split(/\r?\n/).find((l) => l.includes(':has(.shell--nav-drawer-open)') && l.includes('.pk-metre-backstage'));
    assert.ok(fix, 'keys.css 里有「抽屉 / 命令面板开着时带子退到 app 层下面」那一条');
    const body = `<!doctype html><html data-laolao-mode="metre"><head><style id="keys">${keys}</style><style>.laolao-context-viewer__track { stroke: rgba(119, 107, 136, .22); } html { --metre-muted: #77736B; } html[data-pinkie-night] { --metre-muted: #918D84; } body { margin: 0; } openclaw-app { position: relative; z-index: 1; display: block; min-height: 100vh; }</style></head>
      <body><openclaw-app><div class="shell">
        <aside class="shell-nav" style="position:fixed;left:-320px;top:0;bottom:0;width:320px;z-index:70;background:#fff"><button class="laolao-mode-switcher" style="position:absolute;left:16px;bottom:13px;width:120px;height:38px">METRE</button></aside>
        <div class="shell-nav-backdrop" style="position:fixed;inset:0;z-index:65;background:#00000085"></div>
        <main class="content" style="position:fixed;inset:0"></main>
        <div class="agent-chat__composer-shell" style="position:fixed;left:40px;top:560px;width:740px;height:136px;background:#F7F6F3"></div>
        <section class="agent-chat__input" style="position:fixed;left:40px;top:560px;width:740px;height:92px"><details class="laolao-context-viewer"><summary style="color:var(--metre-muted)"><svg width="16" height="16"><circle cx="8" cy="8" r="6.5" class="laolao-context-viewer__track" style="fill:none"/></svg><span class="laolao-context-viewer__percent">—</span></summary></details></section>
        <dialog class="cmd-palette-overlay" style="position:fixed;inset:0;z-index:1000;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;border:0;padding:0;background:#00000080"></dialog>
      </div></openclaw-app></body></html>`;
    await tab.route('http://127.0.0.1:30122/**', (route) => route.fulfill({contentType: 'text/html', body}));
    await tab.goto('http://127.0.0.1:30122/chat?session=agent%3Ametre%3Atest');
    await tab.evaluate(() => {
      const pane = document.createElement('openclaw-chat-pane'); pane.state = {chatRunId: null, chatSending: false, chatStream: null, chatQueue: [], sessionKey: 'agent:metre:test'}; document.body.append(pane);
      window.__pinkieRunStatus = {get state() { return {key: 'agent:metre:test', status: {active: false}, conn: {online: true, attempt: 0}, live: {active: false}}; }, refresh: async () => null};
      window.__laolaoSidebar = {gwRequest: async (method) => (method === 'pinkie.engines.status' ? {enabled: true, running: true} : {})};
      window.__pinkieMetreBoardData = {data: {sessions: [{key: 'e1', external: true, engineName: 'Codex', state: 'fail'}, {key: 'e2', external: true, engineName: 'Kiro', state: 'wait'}]}};
    });
    await tab.addScriptTag({content: read('laolao-metre-backstage.js')});
    await tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})));
    const set = (state) => tab.evaluate((s) => {
      const shell = document.querySelector('.shell'), nav = document.querySelector('.shell-nav'), dlg = document.querySelector('dialog.cmd-palette-overlay');
      shell.classList.toggle('shell--nav-drawer-open', s === 'drawer'); nav.style.left = s === 'drawer' ? '0px' : '-320px';
      if (s === 'palette') { if (!dlg.open) dlg.show(); } else if (dlg.open) dlg.close();
      if (s === 'peek') document.documentElement.setAttribute('data-pinkie-sidebar-peek', '1'); else document.documentElement.removeAttribute('data-pinkie-sidebar-peek');
    }, state);
    const look = () => tab.evaluate(() => {
      const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe):not([hidden])');
      if (!band) return null;
      const B = band.getBoundingClientRect(), pts = [];
      for (let i = 1; i < 10; i++) for (const y of [B.top + 4, B.top + B.height / 2, B.bottom - 4]) pts.push([B.left + B.width * i / 10, y]);
      const badge = document.querySelector('.laolao-mode-switcher').getBoundingClientRect(), bpts = [];
      for (let i = 1; i < 6; i++) for (const f of [0.55, 0.75, 0.92]) bpts.push([badge.left + badge.width * i / 6, badge.top + badge.height * f]);
      const onBand = (p) => band.contains(document.elementFromPoint(...p));
      // 每格上边框（top + 0.5）和文字区（中线）各取 3 点：跳过抽屉遮罩 / 抽屉 / 命令面板之后的第一层必须是带子自己，不是输入框外壳
      const overlay = (e) => e.closest('.shell-nav-backdrop, .shell-nav, dialog.cmd-palette-overlay');
      const under = [];
      for (const seg of band.querySelectorAll('.pk-bs__seg')) {
        const r = seg.getBoundingClientRect();
        for (const y of [r.top + 0.5, r.top + r.height / 2]) for (const f of [0.25, 0.5, 0.75]) {
          const first = document.elementsFromPoint(r.left + r.width * f, y).find((e) => !overlay(e));
          under.push(first && band.contains(first) ? 'band' : first ? first.className || first.tagName : 'none');
        }
      }
      return {z: getComputedStyle(band).zIndex, top: pts.filter(onBand).length, of: pts.length, badgeCovered: bpts.filter(onBand).length, y: Math.round(B.top), b: Math.round(B.bottom),
        under: under.filter((u) => u === 'band').length, underOf: under.length, underBy: [...new Set(under.filter((u) => u !== 'band'))]};
    });
    let s = await look();
    assert.ok(s, '820 宽时有后台带');
    // 字头不被格子文字的盒子剪掉：span 有 overflow: hidden（省略号），竖直方向要装得下整行字形（原来 11.5px/1 时中文字头被剪约 2px，「着」成「看」）
    const clipped = await tab.evaluate(() => [...document.querySelectorAll('.pk-metre-backstage:not(.pk-metre-backstage--probe) .pk-bs__seg > span')].map((n) => {
      const box = n.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(n); const ink = range.getBoundingClientRect();
      return {t: n.textContent, over: +Math.max(box.top - ink.top, ink.bottom - box.bottom).toFixed(1)};
    }).filter((x) => x.over > 0.5));
    assert.deepEqual(clipped, [], '每格文字竖直方向不被自己的盒子剪掉');
    assert.equal(s.top, s.of, '抽屉、面板都不开时带子在最上层、点得到');
    for (const state of ['drawer', 'palette', 'peek']) {
      await set(state); s = await look();
      assert.equal(s.z, '0', state + ' 开着时带子退到 z=0');
      if (state !== 'peek') assert.equal(s.top, 0, state + ' 开着时带子上每一点最上层都不是带子（被遮罩压暗、不越过抽屉）：' + s.top + '/' + s.of);
      if (state === 'drawer') assert.equal(s.badgeCovered, 0, '抽屉开着时 METRE 账号键下半不被带子压住');
      if (state !== 'peek') assert.equal(s.under, s.underOf, state + ' 开着时每格上边框和文字区，遮罩下面第一层是带子自己、不是输入框外壳：' + JSON.stringify(s.underBy));
    }
    // 22:37 打回第 1、2 条的反例：只留 z=0、不处理 app 层（拿掉 openclaw-app z-index: auto 那一条），输入框外壳盖住格子上沿——测试会红
    const appRule = await tab.evaluate(() => {
      const sheet = document.getElementById('keys').sheet;
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) { const r = sheet.cssRules[i]; if (r.selectorText?.includes('nav-drawer-open') && /openclaw-app$/.test(r.selectorText.trim()) && r.style.zIndex === 'auto') { const text = r.cssText; sheet.deleteRule(i); return text; } }
      return null;
    });
    assert.ok(appRule, '反例真的拿掉了 openclaw-app 那一条');
    for (const state of ['drawer', 'palette']) {
      await set(state); s = await look();
      assert.equal(s.z, '0', '反例：z=0 那一条还在');
      assert.ok(s.under < s.underOf && s.underBy.includes('agent-chat__composer-shell'), '反例（只留 z=0）：' + state + ' 开着时外壳盖住格子 ' + JSON.stringify(s));
    }
    await tab.evaluate((text) => { const sheet = document.getElementById('keys').sheet; sheet.insertRule(text, sheet.cssRules.length); }, appRule);
    // 反例：拿掉那一条，抽屉 / 面板开着时带子又跑到最上层、压住账号键——测试会红
    const removed = await tab.evaluate(() => {
      const sheet = document.getElementById('keys').sheet; let n = 0;
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) { const r = sheet.cssRules[i]; if (r.selectorText?.includes('nav-drawer-open') && ((r.selectorText.includes('pk-metre-backstage') && r.style.zIndex === '0') || (/openclaw-app$/.test(r.selectorText.trim()) && r.style.zIndex === 'auto'))) { sheet.deleteRule(i); n++; } }
      return n;
    });
    assert.equal(removed, 2, '反例真的拿掉了两条（带子 z=0、app 层 z-index: auto），回到 main 的样子');
    for (const state of ['drawer', 'palette']) {
      await set(state); s = await look();
      assert.equal(s.top, s.of, '反例（没有这一条）：' + state + ' 开着时带子在最上层 ' + JSON.stringify(s));
      if (state === 'drawer') assert.ok(s.badgeCovered > 0, '反例（没有这一条）：带子压住 METRE 账号键下半');
    }
    // 用量圆环（底圈 + 「—」）：夜间底圈用 --metre-muted，对 #151514 非文本 ≥ 3:1；日间这个键局部换深一档灰，底圈 ≥ 3:1、「—」≥ 4.5:1（对日间几种底色都算）
    const lum = (rgb) => { const v = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((n) => +n / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const ring = () => tab.evaluate(() => { const t = getComputedStyle(document.querySelector('.laolao-context-viewer__track')); const p = getComputedStyle(document.querySelector('.laolao-context-viewer__percent')); return {track: t.stroke, dash: p.color}; });
    const DAY_BGS = ['rgb(245, 244, 241)', 'rgb(246, 245, 242)', 'rgb(247, 246, 243)', 'rgb(255, 255, 255)'];
    await tab.evaluate(() => document.documentElement.setAttribute('data-pinkie-night', ''));
    const night = await ring();
    assert.equal(night.track, 'rgb(145, 141, 132)', '夜间底圈是 --metre-muted');
    assert.ok(cr(night.track, 'rgb(21, 21, 20)') >= 3, '夜间底圈对底 ≥ 3:1');
    assert.ok(cr(night.dash, 'rgb(21, 21, 20)') >= 4.5, '夜间「—」对底 ≥ 4.5:1');
    await tab.evaluate(() => document.documentElement.removeAttribute('data-pinkie-night'));
    const day = await ring();
    assert.equal(day.track, 'rgb(111, 107, 99)', '日间底圈是局部深一档的灰 #6F6B63');
    assert.equal(day.dash, day.track, '日间「—」和底圈同色');
    for (const bg of DAY_BGS) {
      assert.ok(cr(day.track, bg) >= 3, `日间底圈对 ${bg} ≥ 3:1`);
      assert.ok(cr(day.dash, bg) >= 4.5, `日间「—」对 ${bg} ≥ 4.5:1，实际 ${cr(day.dash, bg).toFixed(2)}`);
    }
    // 反例：拿掉日间那一条和「底圈走 --metre-muted」那一条（回到原生 22% 透明灰紫、「—」#77736B），日间底圈不到 3:1、「—」不到 4.5:1——测试会红
    const ringRules = await tab.evaluate(() => {
      const sheet = document.getElementById('keys').sheet; let n = 0;
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) { const r = sheet.cssRules[i]; if (r.selectorText?.includes('laolao-context-viewer')) { sheet.deleteRule(i); n++; } }
      return n;
    });
    assert.equal(ringRules, 2, '反例真的拿掉了两条（日间局部灰、底圈走 --metre-muted）');
    const nat = await ring();
    assert.ok(cr(nat.track, 'rgb(247, 246, 243)') < 3 || /rgba/.test(nat.track), '反例：原生日间底圈不到 3:1 ' + nat.track);
    assert.ok(cr(nat.dash, 'rgb(245, 244, 241)') < 4.5, '反例：原生日间「—」不到 4.5:1 ' + nat.dash);
  } finally { await browser.close(); }
});
