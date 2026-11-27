// Engine menu "放手程度" buttons clipped (L75, uireview 7221589715 on #134, same on main d97042bc): with four levels the
// list is a few px taller than the menu, the .pk-eng-menu__levels section sits at the end of the scrolling list, and the
// bottom border of the four .pk-eng-seg buttons is cut off by the menu's bottom edge (1440 / 820 × day / night).
// Now the section sticks to the bottom of the list, so all four buttons are fully inside the visible list area
// before and after scrolling. The counter-example strips the sticky rule and must show the clipping again.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = name => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const skin = read('laolao-metre-skin.css');
const css = read('laolao-metre-engine.css');
const js = read('laolao-metre-engine.js');
const FIX = ' position: sticky; bottom: 0; background: var(--metre-surface, #fff);';
// Same four levels as services/mode-architecture/engines-bridge.mjs LEVELS.
const FOUR = [
  {id: 'full-access', name: '全放手', hint: 'a'}, {id: 'auto', name: '自己判断', hint: 'b'},
  {id: 'auto-accept-edits', name: '改文件不问', hint: 'c'}, {id: 'approval-required', name: '每步都问', hint: 'd'},
];

test('the levels section sticks to the bottom of the engine menu list', () => {
  const rule = css.split('\n').find(line => line.startsWith('.pk-eng-menu__levels {')) || '';
  assert.ok(rule.includes(FIX), 'laolao-metre-engine.css: .pk-eng-menu__levels is sticky at bottom: 0 with the menu surface behind it');
});

const page = (style, night) => `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night' : ''} lang="zh-CN"><head>
<style>${skin}</style><style>${style}</style>
<style>body{margin:0}.chat-main{position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:flex-end}</style></head><body>
<div class="chat-main"><div class="chat-thread" style="flex:1"></div>
<div class="agent-chat__composer-controls" style="display:flex;gap:4px;padding:12px"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;

// Opens the menu in the "four" state and returns, for the top and the scrolled-to-bottom list, how far the lowest
// .pk-eng-seg bottom edge sticks out past the visible list area (> 0 means its bottom border is cut off).
async function measure(browser, style, width, night) {
  const ctx = await browser.newContext({viewport: {width, height: 900}, colorScheme: night ? 'dark' : 'light', locale: 'zh-CN'});
  try {
    const tab = await ctx.newPage();
    await tab.route('http://127.0.0.1:30175/**', route => route.fulfill({contentType: 'text/html', body: page(style, night)}));
    await tab.goto('http://127.0.0.1:30175/chat?session=agent%3Ametre%3Al75');
    await tab.evaluate(levels => {
      window.__laolaoToast = () => {};
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref: {engine: 'metre', level: 'auto-accept-edits'}, summary: null, error: '', service: {running: true}};
        if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels, engines: []};
        return {};
      }};
    }, FOUR);
    await tab.addScriptTag({content: js});
    const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip').first();
    await chip.waitFor({timeout: 10_000});
    await chip.click();
    await tab.locator('.pk-eng-menu .pk-eng-seg').first().waitFor({timeout: 10_000});
    const over = () => tab.evaluate(() => {
      const menu = document.querySelector('.pk-eng-menu'), body = menu.querySelector('.pk-eng-menu__body');
      const segs = [...menu.querySelectorAll('.pk-eng-menu__levels .pk-eng-seg')];
      const menuBox = menu.getBoundingClientRect(), bodyBox = body.getBoundingClientRect();
      const visible = Math.min(bodyBox.bottom, menuBox.bottom - parseFloat(getComputedStyle(menu).borderBottomWidth), innerHeight);
      return {count: segs.length, over: Math.max(...segs.map(seg => seg.getBoundingClientRect().bottom)) - visible, listOver: body.scrollHeight - body.clientHeight};
    });
    const top = await over();
    await tab.evaluate(() => { const body = document.querySelector('.pk-eng-menu .pk-eng-menu__body'); body.scrollTop = body.scrollHeight; });
    const bottom = await over();
    return {top, bottom};
  } finally { await ctx.close(); }
}

test('in a browser: all four level buttons end inside the visible menu (1440 / 820 × day / night)', {timeout: 120_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const sizes = [[1440, false], [1440, true], [820, false], [820, true]];
    for (const [width, night] of sizes) {
      const at = `${width}-${night ? 'night' : 'day'}`;
      const fixed = await measure(browser, css, width, night);
      assert.equal(fixed.top.count, 4, `${at}: four level buttons`);
      assert.ok(fixed.top.over <= 0.5, `${at}: list at the top, the button bottoms are inside the menu (over by ${fixed.top.over}px)`);
      assert.ok(fixed.bottom.over <= 0.5, `${at}: list scrolled down, the button bottoms are inside the menu (over by ${fixed.bottom.over}px)`);
    }
    // Counter-example: main's CSS (section at the end of the list) — the case is really taller than the menu and clips.
    const unfixed = css.replace(FIX, '');
    assert.notEqual(unfixed, css, 'counter-example: the sticky rule was found and removed');
    for (const [width, night] of sizes) {
      const at = `${width}-${night ? 'night' : 'day'}`;
      const bug = await measure(browser, unfixed, width, night);
      assert.ok(bug.top.listOver > 0, `${at}: counter-example: the list really overflows the menu (${bug.top.listOver}px)`);
      assert.ok(bug.top.over > 0.5, `${at}: counter-example: without the sticky rule the button bottoms are cut off (over by ${bug.top.over}px)`);
    }
  } finally { await browser.close(); }
});
