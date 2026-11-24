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
    await page.setViewportSize({width: 1000, height: 640}); await page.waitForTimeout(500);
    await page.setViewportSize({width: 1200, height: 700}); await page.waitForTimeout(500);
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
  assert.match(read('laolao-metre-skin.css'), /\.chat-queue:has\(> \.pk-mq\) > :is\(\.chat-queue__title, \.chat-queue__list\) \{ display: none !important; \}/, '原生的大卡片只在新的一条画出来以后才藏');
});
