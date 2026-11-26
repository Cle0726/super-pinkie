// 总谱刷新时不乱跳（11-19 用户：「总谱页面乱跳还没有解决」）。
// 数据层每次刷新都把数字和各块整块换掉；WebKit 没有滚动锚定，换内容会把滚动区打回顶上，
// 上面的块变高也会把正在看的往下推。面板的 keepPlace 让正在看的那一块停在原处。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const file = (name) => fileURLToPath(new URL('../ui/injections/' + name, import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'webkit';

for (const width of [1500, 900]) {
  test(`score board keeps the reader's place while a run refreshes it (${engine}, ${width}px)`, {timeout: 30_000}, async () => {
    const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
    try {
      const tab = await browser.newPage({viewport: {width, height: 900}});
      await tab.route('http://127.0.0.1:30119/**', (route) => route.fulfill({contentType: 'text/html', body: `<!doctype html><html data-laolao-mode="metre"><body style="margin:0">
<div class="shell" style="display:flex;height:100vh"><aside class="sidebar shell-nav" style="width:260px;flex:none"></aside>
<main style="flex:1;display:flex;flex-direction:column"><div class="chat-thread" style="flex:1"></div><div class="agent-chat__input" style="height:90px"></div></main></div></body></html>`}));
      await tab.goto('http://127.0.0.1:30119/chat?session=agent:metre:x');
      for (const css of ['laolao-metre-board.css', 'laolao-metre-skin.css']) await tab.addStyleTag({path: file(css)});
      await tab.evaluate(() => {
        // 每读一次：用时在走、在跑的数变、时间线和节目单变长——和真实运行一样，每次换上来的内容都不一样。
        const qa = window.qa = {n: 0, planSteps: 3};
        window.__laolaoSidebar = {gwRequest: async (method) => {
          if (method === 'pinkie.metre.memory') return {ok: true, items: []};
          const n = ++qa.n, at = Date.now();
          return {ok: true, at, overview: {parentRunning: true, running: n % 3, limit: 6, returned: n, failed: 0, startedAt: at - 60_000, state: 'Metre 在做'},
            plan: {items: Array.from({length: qa.planSteps}, (_, i) => ({text: '第 ' + (i + 1) + ' 步', status: i ? 'pending' : 'active'}))},
            sessions: [], pending: [], changes: [], runtime: {}, raw: [],
            timeline: Array.from({length: n % 5}, (_, i) => ({at: at - i * 1000, kind: 'dispatch', text: '分谱 ' + i}))};
        }};
      });
      for (const js of ['laolao-metre-board.js', 'laolao-metre-board-data.js']) await tab.addScriptTag({path: file(js)});
      await tab.evaluate(() => window.__pinkieMetreBoard.open());
      await tab.waitForFunction(() => window.qa.n > 0 && document.getElementById('pk-metre-board-plan')?.dataset.metreState === 'live');
      await tab.waitForTimeout(300);
      // 11-24 真实页面基线比对时发现：记忆统计不带 count / known 时，卡片写成「undefined 条 · 了解 undefined / 9 类」。
      await tab.waitForFunction(() => document.querySelector('.pk-mb-memory__folder small'));
      assert.equal(await tab.evaluate(() => document.querySelector('.pk-mb-memory__folder small').textContent), '0 条 · 了解 0 / 9 类', 'memory card counts fall back to 0, never undefined');

      const place = () => tab.evaluate(() => {
        const scroll = document.querySelector('.pk-metre-board__scroll');
        const card = document.getElementById('pk-metre-board-timeline');
        return {top: scroll.scrollTop, card: Math.round(card.getBoundingClientRect().top)};
      });
      const refresh = async () => {
        const before = await tab.evaluate(() => window.qa.n);
        await tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: 'agent', payload: {}}})));
        await tab.waitForFunction((n) => window.qa.n > n, before);
        await tab.waitForTimeout(200);
      };

      // 滚到中间看「小节」那一块，然后连着刷几次：滚动区不能被打回顶上，那一块不能挪。
      await tab.evaluate(() => { const scroll = document.querySelector('.pk-metre-board__scroll'); scroll.scrollTop = document.getElementById('pk-metre-board-timeline').offsetTop - scroll.offsetTop - 20; });
      const start = await place();
      assert.ok(start.top > 100, 'the board scrolled down before the refreshes');
      // 允许 1px：CI 上的 WebKit 偶尔把亚像素位置取整到相邻像素（11-26 run 45733916177 出过 151 对 150）。
      // 真回归是被打回顶上或被上面的块顶下去，都是几十像素。
      const inPlace = (got, why) => assert.ok(Math.abs(got.card - start.card) <= 1, `${why} (card top ${got.card}, was ${start.card})`);
      for (let i = 0; i < 4; i++) {
        await refresh();
        inPlace(await place(), `refresh ${i + 1} kept the card being read in place`);
      }
      // 上面的节目单变长：正在看的那一块还在原处（滚动位置跟着加上多出来的高度）。
      await tab.evaluate(() => { window.qa.planSteps = 9; });
      await refresh();
      const after = await place();
      inPlace(after, 'a longer plan above did not push the card being read down');
      assert.ok(after.top > start.top, 'scroll position grew with the content above');
      // 在最顶上看的人不被拽下去。
      await tab.evaluate(() => { document.querySelector('.pk-metre-board__scroll').scrollTop = 0; });
      await refresh();
      assert.equal((await place()).top, 0, 'a reader at the top stays at the top');
    } finally { await browser.close(); }
  });
}
