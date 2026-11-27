// B91 (linuxwatch on #488): after #488 the "放手程度" section (.pk-eng-menu__levels) sticks to the bottom of the
// engine list with an opaque background, so it covers the "more below" fade that .pk-eng-menu__body draws at its
// bottom edge. With a short window or many engines the list had no hint that it could still scroll.
// Now, while the list is not scrolled to the end, the section gets .is-below and draws the same fade on its top edge;
// scrolled to the end the class and the fade go away. The counter-example strips the new CSS rule: the section is
// still marked, but no fade is drawn (the old state).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = name => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const js = read('laolao-metre-engine.js');
const css = read('laolao-metre-engine.css');
const RULE = /\.pk-eng-menu__levels\.is-below::before \{[^}]*\}/;

test('the levels section draws a top-edge fade while the list has more below', () => {
  const line = css.split('\n').find(l => l.startsWith('.pk-eng-menu__levels {')) || '';
  assert.match(line, RULE, 'laolao-metre-engine.css: .pk-eng-menu__levels.is-below::before fade rule');
  assert.match(js, /levels\.classList\.toggle\('is-below'/, 'laolao-metre-engine.js: the section is marked from the list scroll position');
});

async function probe(browser, style, width, height, night) {
  const tab = await browser.newPage({viewport: {width, height}, colorScheme: night ? 'dark' : 'light'});
  try {
    const page = `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night' : ''}><head><style>${style}</style></head><body style="margin:0">
      <div class="chat-main" style="position:relative;height:100vh"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30191/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30191/chat?session=agent%3Ametre%3Ab91');
    await tab.evaluate(() => {
      const row = (id, name) => ({id, name, state: 'ready', text: '', enabled: true, installed: true, signedIn: true, quota: {state: 'unknown'},
        setup: {canInstall: false, canAuthenticate: false}, guide: {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: false, managedSignin: false},
        models: [{slug: 'm1', name: 'Model One', isDefault: true}]});
      const engines = ['Claude Code', 'Codex', 'Antigravity', 'Cursor', 'OpenCode', 'Grok Build', 'Kiro', 'Pi', 'fx', 'Muse Code'].map((n, i) => row('e' + i, n));
      const levels = [{id: 'full-access', name: '全放手', hint: 'a'}, {id: 'auto', name: '自己判断', hint: 'b'},
        {id: 'auto-accept-edits', name: '改文件不问', hint: 'c'}, {id: 'approval-required', name: '每步都问', hint: 'd'}];
      window.__laolaoToast = () => {};
      window.__laolaoSidebar = {gwRequest: async method => {
        if (method === 'pinkie.engines.session') return {sessionKey: 'agent:metre:b91', pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}};
        if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels, engines};
        return {};
      }};
    });
    await tab.addScriptTag({content: js});
    const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip');
    await chip.waitFor({timeout: 10_000});
    await chip.click();
    await tab.locator('.pk-eng-menu__levels .pk-eng-seg').first().waitFor({timeout: 10_000});
    const read = () => tab.evaluate(() => {
      const body = document.querySelector('.pk-eng-menu .pk-eng-menu__body'), levels = body.querySelector('.pk-eng-menu__levels');
      const fade = getComputedStyle(levels, '::before');
      const lb = levels.getBoundingClientRect(), bb = body.getBoundingClientRect();
      return {left: Math.round(body.scrollHeight - body.scrollTop - body.clientHeight), marked: levels.classList.contains('is-below'),
        stuck: Math.abs(lb.bottom - bb.bottom) < 1.5, fade: fade.content !== 'none' && /gradient/.test(fade.backgroundImage) && parseFloat(fade.height) > 0,
        fadeTop: lb.top + parseFloat(fade.top || '0'), bodyTop: bb.top};
    });
    await tab.waitForTimeout(100);
    const top = await read();
    await tab.locator('.pk-eng-menu__body').evaluate(body => { body.scrollTop = body.scrollHeight; });
    await tab.waitForTimeout(150);
    const end = await read();
    return {top, end};
  } finally { await tab.close(); }
}

test('in a browser: fade above the stuck levels section until the list reaches its end (1024×520 / 820×380 × day / night)', {timeout: 120_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const sizes = [[1024, 520, false], [1024, 520, true], [820, 380, false], [820, 380, true]];
    for (const [w, h, night] of sizes) {
      const at = `${w}x${h}-${night ? 'night' : 'day'}`;
      const r = await probe(browser, css, w, h, night);
      assert.ok(r.top.left > 1, `${at}: the list really has more below at open (${r.top.left}px)`);
      assert.ok(r.top.stuck, `${at}: the levels section is stuck to the list bottom: ${JSON.stringify(r.top)}`);
      assert.ok(r.top.marked && r.top.fade, `${at}: with more below, the section draws the fade: ${JSON.stringify(r.top)}`);
      assert.ok(r.top.fadeTop >= r.top.bodyTop, `${at}: the fade sits inside the visible list: ${JSON.stringify(r.top)}`);
      assert.ok(r.end.left <= 1 && !r.end.marked && !r.end.fade, `${at}: scrolled to the end, no fade: ${JSON.stringify(r.end)}`);
    }
    // Counter-example: without the new rule the section is marked but nothing is drawn — the old "no hint" state.
    const unfixed = css.replace(RULE, '');
    assert.notEqual(unfixed, css, 'counter-example: the fade rule was found and removed');
    const bug = await probe(browser, unfixed, 1024, 520, false);
    assert.ok(bug.top.left > 1 && bug.top.stuck, `counter-example: the list overflows and the section is stuck: ${JSON.stringify(bug.top)}`);
    assert.equal(bug.top.fade, false, `counter-example: no fade without the rule: ${JSON.stringify(bug.top)}`);
  } finally { await browser.close(); }
});
