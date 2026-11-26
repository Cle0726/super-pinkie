// 11-24 第 5 轮追加：Metre 的待发送一条（laolao-metre-queue.js）和侧栏会话列表的整理（laolao-metre-list.js），真浏览器里跑。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

const PAGE = `<!doctype html><html data-laolao-mode="metre"><head><style>
  body{margin:0;font:14px sans-serif} .chat-main{width:900px;margin:40px auto}
  .agent-chat__composer-combobox{width:780px;margin:0 auto;padding:12px 46px;box-sizing:border-box;border:1px solid #ccc}
  textarea{width:100%;padding:0;border:0;font:16px sans-serif}
  aside.sidebar{position:fixed;left:0;top:0;width:280px} .session-row-host{display:flex}
</style></head><body>
<aside class="sidebar"><div class="laolao-managed-groups"></div></aside>
<openclaw-chat-pane><div class="chat-main"><div class="chat-queue" role="status"><div class="chat-queue__title">待发送（3）</div><div class="chat-queue__list"></div></div>
<div class="agent-chat__composer-combobox"><textarea></textarea></div></div></openclaw-chat-pane></body></html>`;

test(`Metre queue: one 30px line on the composer’s top edge; expanded rows are 28px with move / edit / steer / delete (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 700}});
    await page.setContent(PAGE);
    await page.evaluate(() => {
      const pane = document.querySelector('openclaw-chat-pane'), log = window.log = [];
      pane.state = {sessionKey: 'agent:metre:main', chatQueue: ['第一条：把发版说明里第三节的截图换成新的，顺便检查所有链接是不是都还能打开', '第二条', '第三条', '第四条', '第五条', '第六条']
        .map((text, i) => ({id: 'q' + i, text, sessionKey: 'agent:metre:main'})),
        removeQueuedMessage(id) { log.push('remove:' + id); this.chatQueue = this.chatQueue.filter((q) => q.id !== id); },
        handleChatDraftChange(text) { log.push('draft:' + text); }, requestUpdate() {}};
      window.__laolaoQueueSteer = {steerQueued: (p, id) => { log.push('steer:' + id); return Promise.resolve(); }};
    });
    await page.addStyleTag({path: inj('laolao-metre-skin.css')});
    await page.addScriptTag({path: inj('laolao-metre-queue.js')});
    await page.evaluate(() => window.PinkieMetreQueue.render());
    const box = (sel) => page.locator(sel).first().boundingBox();
    const bar = await box('.pk-mq__bar'), comp = await box('.agent-chat__composer-combobox'), mq = await box('.pk-mq');
    assert.ok(bar.height <= 32, `收起时一行 ≤ 32px（${bar.height}）`);
    assert.equal(Math.round(mq.width), Math.round(comp.width), '和输入框一样宽');
    assert.match(await page.locator('.pk-mq__bar').innerText(), /待发送 6\s*·\s*第一条：把发版说明里第三节的截图换成新的，顺便检查所有链接是…/);
    await page.locator('.pk-mq__btn--toggle').click();
    const rows = await page.locator('.pk-mq__row').count();
    assert.equal(rows, 6);
    const row = await box('.pk-mq__row'), list = await box('.pk-mq__list');
    assert.ok(row.height <= 28, `每条 ≤ 28px（${row.height}）`);
    assert.ok(list.height <= 4 * 28 + 1, '最多露 4 条，多了在框里滚');
    const textX = await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('.pk-mq__text')); return r.getBoundingClientRect().x; });
    const taX = (await box('textarea')).x;
    assert.ok(Math.abs(textX - taX) <= 1, `文字和输入框的字左对齐（${textX} / ${taX}）`);
    await page.locator('.pk-mq__row').nth(1).locator('.pk-mq__btn--up').click();
    assert.deepEqual(await page.evaluate(() => document.querySelector('openclaw-chat-pane').state.chatQueue.slice(0, 2).map((q) => q.id)), ['q1', 'q0'], '上移换顺序');
    await page.locator('.pk-mq__row').first().locator('.pk-mq__btn--steer').click();
    await page.locator('.pk-mq__row').nth(2).locator('.pk-mq__btn--remove').click();
    await page.locator('.pk-mq__row').first().locator('.pk-mq__btn--edit').click();
    assert.deepEqual(await page.evaluate(() => window.log), ['steer:q1', 'remove:q2', 'remove:q1', 'draft:第二条'], '插话走已有的插话；删除和编辑走原生的方法');
    await page.locator('.pk-mq__btn--clear').click();
    assert.equal(await page.evaluate(() => document.querySelector('openclaw-chat-pane').state.chatQueue.length), 0, '全部清掉');
  } finally { await browser.close(); }
});

// 11-24 16:10 打回第 2 条：排队一出现，原生的大卡片先露出来、停约 5 秒才缩成一行（.pk-mq 要等别的事件才画）。
// 复发测试：原生排队区插进来以后不碰页面，0 ms 和 300 ms 各量一次 .chat-queue，都不超过 32px；300 ms 时那一条已经画好；再排一条也跟着变。
test(`Metre queue: the native big card never shows — 0 ms and 300 ms after the queue appears it is one line (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 700}});
    await page.setContent(PAGE);
    await page.evaluate(() => {
      document.querySelector('.chat-queue').remove();
      document.querySelector('openclaw-chat-pane').state = {sessionKey: 'agent:metre:main', chatQueue: [], requestUpdate() {}};
    });
    await page.addStyleTag({path: inj('laolao-metre-skin.css')});
    await page.addStyleTag({path: inj('laolao-metre-display.css')});
    await page.addScriptTag({path: inj('laolao-metre-queue.js')});
    const item = (id, text) => `<div class="chat-queue__item" data-pinkie-queue-id="${id}" style="height:72px"><div class="chat-queue__text">${text}</div></div>`;
    const h0 = await page.evaluate((html) => {
      const pane = document.querySelector('openclaw-chat-pane');
      pane.state.chatQueue = [{id: 'q0', text: '第一条', sessionKey: 'agent:metre:main'}, {id: 'q1', text: '第二条', sessionKey: 'agent:metre:main'}];
      const q = document.createElement('div'); q.className = 'chat-queue'; q.setAttribute('role', 'status');
      q.innerHTML = `<div class="chat-queue__title">Queued (2)</div><div class="chat-queue__list">${html}</div>`;
      document.querySelector('.chat-main').prepend(q);
      return q.getBoundingClientRect().height;
    }, item('q0', '第一条') + item('q1', '第二条'));
    assert.ok(h0 <= 32, `排队区插进来的当时 ≤ 32px（${h0}）`);
    await page.waitForTimeout(300);   // 保留：这条测试本身量的就是「插进来 300 ms 时」的状态
    const at300 = await page.evaluate(() => ({h: document.querySelector('.chat-queue').getBoundingClientRect().height, bar: document.querySelector('.pk-mq__bar')?.textContent || ''}));
    assert.ok(at300.h <= 32, `300 ms 时 ≤ 32px（${at300.h}）`);
    assert.match(at300.bar, /待发送 2/, '300 ms 时那一条已经画好，没有等别的事件');
    await page.evaluate((html) => {
      const pane = document.querySelector('openclaw-chat-pane');
      pane.state.chatQueue = [...pane.state.chatQueue, {id: 'q2', text: '第三条', sessionKey: 'agent:metre:main'}];
      document.querySelector('.chat-queue__list').insertAdjacentHTML('beforeend', html);
    }, item('q2', '第三条'));
    await page.waitForFunction(() => /待发送 3/.test(document.querySelector('.pk-mq__bar')?.textContent || ''), null, {timeout: 5_000});   // 等那一条按新队列重画
    assert.match(await page.locator('.pk-mq__bar').innerText(), /待发送 3/, '再排一条，这一条跟着变');
    assert.ok((await page.locator('.chat-queue').boundingBox()).height <= 32);
  } finally { await browser.close(); }
});

// 11-24 16:10 打回第 3 条：侧栏会话行悬停时，「置顶 / 重命名 / 归档 / ⋯」四个键是绝对定位、透明底，长标题的字从键底下透出来。
// 复发测试：长标题悬停时，标题可见部分的右端 ≤ 第一个按键的左端，而且标题确实被省略了（不是没压到是因为标题短）。
// 原生的会话行规则（链接 flex:auto / min-width:0、会话名省略号、行尾区 flex:none）照 control-ui 打包里的写法补在页面上。
test(`Metre session list: on hover a long title makes room for the row keys and ellipsizes instead of running under them (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 700}});
    await page.setContent(PAGE);
    await page.addStyleTag({content: `.sidebar-recent-session__link{min-width:0;flex:auto;display:flex;align-items:center;gap:8px;text-decoration:none}
      .sidebar-recent-session__name{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;overflow:hidden}
      .session-row-aside{flex:none;display:grid;place-items:center end}`});
    await page.addStyleTag({path: inj('laolao-metre-skin.css')});
    await page.evaluate(() => {
      window.PinkieSessionList = {sessionStatus: () => '', beginRename() {}};
      document.querySelector('.laolao-managed-groups').innerHTML = `<div class="laolao-group"><div class="laolao-group__list"><div class="pinkie-session-date">今天</div>
        <div class="sidebar-recent-session session-row-host" data-session-key="agent:metre:a"><a class="sidebar-recent-session__link"><span class="sidebar-recent-session__name">把登录页和注册页的主按钮统一改成钴蓝色并补测试</span></a><span class="session-row-aside"><span class="laolao-row-actions"><button aria-label="管理会话">⋯</button></span></span></div></div></div>`;
    });
    await page.addScriptTag({path: inj('laolao-metre-list.js')});
    await page.evaluate(() => window.PinkieMetreList.decorate(document.querySelector('.laolao-managed-groups'), [{key: 'agent:metre:a', updatedAt: Date.now() - 3 * 60_000}], {state: {pins: []}}));
    await page.hover('.sidebar-recent-session');
    const r = await page.evaluate(() => {
      const name = document.querySelector('.sidebar-recent-session__name');
      const keys = [...document.querySelectorAll('.laolao-row-actions > button')].filter((b) => +getComputedStyle(b.parentElement).opacity > 0.5).map((b) => b.getBoundingClientRect());
      return {nameRight: name.getBoundingClientRect().right, firstKey: Math.min(...keys.map((k) => k.left)), keys: keys.length, clipped: name.scrollWidth > name.clientWidth + 1};
    });
    assert.equal(r.keys, 4, '悬停时四个键都露出来');
    assert.ok(r.nameRight <= r.firstKey + 0.5, `标题可见部分的右端 ≤ 第一个键的左端（${r.nameRight} / ${r.firstKey}）`);
    assert.ok(r.clipped, '长标题被省略，不是因为标题短才没压到');
    await page.mouse.move(900, 600);
    const idle = await page.evaluate(() => ({time: getComputedStyle(document.querySelector('.pinkie-session-time')).display, keys: +getComputedStyle(document.querySelector('.laolao-row-actions')).opacity}));
    assert.notEqual(idle.time, 'none', '不悬停时时间照常显示');
    assert.equal(idle.keys, 0, '不悬停时按键不露');
  } finally { await browser.close(); }
});

test(`Metre session list: one layer of date groups, status marks from backend state, relative time, hover-only actions (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 700}});
    await page.setContent(PAGE);
    await page.evaluate(() => {
      window.PinkieSessionList = {sessionStatus: (s) => s.phase || '', beginRename: (k) => window.log.push('rename:' + k)};
      window.log = [];
      const groups = document.querySelector('.laolao-managed-groups');
      groups.innerHTML = `<div class="laolao-group"><div class="laolao-group__head"><span class="laolao-group__label">最近</span><button class="laolao-group__action pinkie-recent-menu">⋯</button></div>
        <div class="laolao-group__list"><div class="pinkie-session-date">今天</div>
        ${['a', 'b', 'c', 'd'].map((k) => `<div class="sidebar-recent-session session-row-host" data-session-key="agent:metre:${k}"><a class="sidebar-recent-session__link"><span class="sidebar-recent-session__name">${k}</span></a><span class="session-row-aside"><span class="laolao-row-actions"><button>⋯</button></span></span></div>`).join('')}</div></div>`;
    });
    await page.addScriptTag({path: inj('laolao-metre-list.js')});
    const now = Date.now();
    await page.evaluate((now) => {
      const rows = [{key: 'agent:metre:a', phase: 'running', updatedAt: now - 20_000}, {key: 'agent:metre:b', phase: 'waiting', updatedAt: now - 3 * 60_000},
        {key: 'agent:metre:c', phase: 'error', updatedAt: (() => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime(); })()}, {key: 'agent:metre:d', unread: true, updatedAt: now - 3 * 60_000}];
      window.PinkieMetreList.decorate(document.querySelector('.laolao-managed-groups'), rows, {state: {pins: []}, togglePin: (k) => window.log.push('pin:' + k), archiveWithUndo: (k) => window.log.push('archive:' + k)});
    }, now);
    assert.deepEqual(await page.locator('.pk-ml-dot').evaluateAll((n) => n.map((x) => x.dataset.state)), ['running', 'waiting', 'error', 'idle'], '在跑 / 等你 / 出错 都来自会话状态');
    assert.equal(await page.locator('.pk-ml-unread').count(), 1, '没读过的那一行加粗');
    assert.deepEqual(await page.locator('.pinkie-session-time').allTextContents(), ['刚刚', '3 分钟前', '昨天', '3 分钟前']);
    assert.ok(await page.locator('.laolao-group').evaluate((g) => g.classList.contains('pk-ml-flat')), '只留一层分组：「最近」的标题行藏掉');
    assert.equal(await page.locator('.pinkie-session-date > .pinkie-recent-menu').count(), 1, '「⋯」挪到分组行的右侧');
    const acts = page.locator('.session-row-host').first().locator('.pk-ml-act');
    assert.deepEqual(await acts.evaluateAll((n) => n.map((x) => x.getAttribute('aria-label'))), ['置顶', '重命名', '归档']);
    for (const i of [0, 1, 2]) await acts.nth(i).click({force: true});
    assert.deepEqual(await page.evaluate(() => window.log), ['pin:agent:metre:a', 'rename:agent:metre:a', 'archive:agent:metre:a']);
    assert.equal(await page.evaluate(() => window.PinkieMetreList.relTime(new Date(2026, 10, 23, 17, 11).getTime(), new Date(2026, 10, 23, 19, 0).getTime())), '17:11');
  } finally { await browser.close(); }
});

// 11-24 第 6 轮整页走查：Metre 首页不挂碧琪小伙伴（bubble 没建出来），窗口一改尺寸 laolao-companion.js 的 liftHome 就读 undefined.classList 报错
test(`Metre home: resizing the window does not throw from the companion’s home lift (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 700}});
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(`<!doctype html><html data-laolao-mode="metre" data-laolao-startup-home="1"><body><div class="laolao-startup-home"><div class="agent-chat__welcome">早上好</div></div></body></html>`);
    await page.addScriptTag({path: inj('laolao-companion.js')});
    await page.setViewportSize({width: 1000, height: 640}); await page.waitForTimeout(500);   // 保留：断言改尺寸「不报错」，给 resize 处理留时间
    await page.setViewportSize({width: 1200, height: 700}); await page.waitForTimeout(500);   // 保留：同上
    assert.deepEqual(errors.filter((m) => /classList|liftHome/.test(m)), [], '改窗口尺寸不报错');
  } finally { await browser.close(); }
});

// 11-24 第 6 轮整页走查：Metre 皮肤给所有元素设了标准 scrollbar-color，Chromium 就丢掉原生 6px 的 ::-webkit-scrollbar，侧栏会话列表被 15px 的系统滚动条挤窄
test(`Metre keeps the native 6px scrollbar (sidebar list is not squeezed by a 15px system bar) (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 800, height: 600}});
    await page.setContent(`<!doctype html><html data-laolao-mode="metre"><head><style>::-webkit-scrollbar{width:6px;height:6px}</style></head><body>
      <div id="s" style="width:240px;height:100px;overflow-y:auto;scrollbar-gutter:stable"><div style="height:400px"></div></div></body></html>`);
    await page.addStyleTag({path: inj('laolao-metre-skin.css')});
    const gutter = await page.evaluate(() => { const s = document.getElementById('s'); return s.offsetWidth - s.clientWidth; });
    assert.equal(gutter, 6, `滚动条预留 6px（实际 ${gutter}px）`);
  } finally { await browser.close(); }
});

test('wiring: only Metre calls the list decorator; both scripts are in the head and owned by a region; no timers or observers', () => {
  const read = (f) => fs.readFileSync(inj(f), 'utf8');
  assert.match(read('laolao-session-list.js'), /if \(api\.mode === 'metre'\) window\.PinkieMetreList\?\.decorate\(groups, rows, api\);/);
  const head = read('laolao-head.fragment.html');
  for (const f of ['laolao-metre-queue.js', 'laolao-metre-list.js']) {
    assert.match(head, new RegExp(`<script defer src="/${f.replace('.', '\\.')}\\?v=@hash"></script>`));
    assert.ok(read('regions.json').includes(`"${f}"`));
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /setInterval|MutationObserver|window\.__\w+\s*=/, f + '：不加循环定时器、观察器、全局名');
  }
  const skin = read('laolao-metre-skin.css');
  assert.match(skin, /\.chat-queue > \.chat-queue__title \{ display: none !important; \}/, '原生标题从第一帧起就藏，不等 .pk-mq');
  assert.match(skin, /\.chat-queue > \.chat-queue__list \{ position: absolute; height: 0; overflow: hidden; visibility: hidden; pointer-events: none; \}/, '原生大卡片从第一帧起不占位');
  assert.doesNotMatch(skin, /\.chat-queue:has\(> \.pk-mq\)/, '不再靠 :has(.pk-mq) 才藏');
  assert.match(read('laolao-metre-queue.js'), /animationName === 'pk-mq-born'/, '排队区插进来的那一帧就画那一条');
  assert.ok(read('laolao-metre-display.css').includes('html[data-laolao-mode="metre"] :is(.chat-queue, .chat-queue__item) { animation: pk-mq-born 1ms; }'), '插进来那一帧的空动画只在 Metre');
});
