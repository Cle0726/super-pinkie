// Engine menu taller than its panel (mac2 task 18 on #99, same on main 27aae83f): the whole .pk-eng-menu scrolled,
// so the "Engine" title scrolled away and the last row showed only half. Now only the list scrolls, the title stays,
// the last row can be scrolled fully into view, and there is a fade hint at the bottom while more is below.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = name => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const js = read('laolao-metre-engine.js');
const css = process.env.PINKIE_ENGINE_CSS ? fs.readFileSync(process.env.PINKIE_ENGINE_CSS, 'utf8') : read('laolao-metre-engine.css');

test('in a browser: a menu taller than the window keeps its title and scrolls only the list, down to the last row', {timeout: 60_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    for (const [width, height] of [[1440, 900], [1024, 520], [820, 380]]) {
      const tab = await browser.newPage({viewport: {width, height}});
      const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body style="margin:0">
        <div class="chat-main" style="position:relative;height:100vh"><div class="chat-thread">native</div>
        <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
      await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
      await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Ab');
      await tab.evaluate(() => {
        const row = (id, name, state, extra = {}) => ({id, name, state, text: state === 'ready' ? '' : '还没打开', enabled: state !== 'off', installed: state === 'ready', signedIn: state === 'ready',
          quota: {state: 'unknown'}, setup: {canInstall: false, canAuthenticate: false}, guide: {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: false, managedSignin: false},
          models: state === 'ready' ? [{slug: 'm1', name: 'Model One', isDefault: true}] : [], ...extra});
        const engines = [row('claudeAgent', 'Claude Code', 'ready'), row('codex', 'Codex', 'ready'), row('antigravity', 'Antigravity', 'ready'), row('cursor', 'Cursor', 'ready'),
          row('opencode', 'OpenCode', 'ready'), row('grok', 'Grok Build', 'ready'), row('kiro', 'Kiro', 'ready'), row('pi', 'Pi', 'ready'), row('fx', 'fx', 'ready'), row('muse', 'Muse Code', 'ready')];
        const levels = [{id: 'ask', name: '先问我', hint: ''}, {id: 'auto', name: '只改文件', hint: ''}, {id: 'full-access', name: '全放手', hint: ''}];
        window.__laolaoToast = () => {};
        window.__laolaoSidebar = {gwRequest: async method => {
          if (method === 'pinkie.engines.session') return {sessionKey: 'agent:metre:b', pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}};
          if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels, engines};
          return {};
        }};
      });
      await tab.addScriptTag({content: js});
      const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip');
      await chip.waitFor({timeout: 10_000});
      await chip.click();
      await tab.locator('.pk-eng-menu__levels').waitFor();
      const at = `${width}×${height}`;
      const shape = () => tab.evaluate(() => {
        const menu = document.querySelector('.pk-eng-menu'), head = menu.querySelector('.pk-eng-menu__head'), body = menu.querySelector('.pk-eng-menu__body');
        const box = e => e.getBoundingClientRect(), last = body.lastElementChild;
        return {menuScroll: menu.scrollHeight - menu.clientHeight, menuScrollTop: menu.scrollTop, menuBottom: box(menu).bottom, view: innerHeight,
          bodyOver: body.scrollHeight - body.clientHeight, headTop: box(head).top, bodyBottom: box(body).bottom, lastBottom: box(last).bottom,
          hint: getComputedStyle(body).backgroundImage.includes('gradient')};
      });
      const before = await shape();
      assert.ok(before.menuBottom <= before.view, `${at}: menu ends inside the window (${before.menuBottom} > ${before.view})`);
      assert.ok(before.menuScroll <= 1, `${at}: the menu as a whole must not scroll (it overflows by ${before.menuScroll}px)`);
      if (before.bodyOver > 1) assert.ok(before.hint, `${at}: while the list overflows there is a fade hint at its bottom`);
      await tab.locator('.pk-eng-menu__body').evaluate(body => { body.scrollTop = body.scrollHeight; });
      const after = await shape();
      assert.equal(after.menuScrollTop, 0, `${at}: scrolling the list does not move the menu`);
      assert.ok(Math.abs(after.headTop - before.headTop) < 0.5, `${at}: the Engine title stays put (${before.headTop} → ${after.headTop})`);
      assert.ok(after.lastBottom <= after.bodyBottom + 0.5, `${at}: at the bottom the last row is fully visible (${after.lastBottom} > ${after.bodyBottom})`);
      if (height <= 520) assert.ok(before.bodyOver > 1, `${at}: this case really is taller than the window (list overflow ${before.bodyOver}px)`);
      await tab.close();
    }
  } finally { await browser.close(); }
});
