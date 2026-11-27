// Engine menu "放手程度" section (uireview 11-25 16:56Z on #124, main 498b4c40): when loading the catalog fails,
// laolao-metre-engine.js falls back to {engines: [], levels: [], error}, and the menu still drew the "放手程度" label
// with nothing under it. Now an empty levels list draws no section at all; four levels still draw four buttons
// with aria-pressed on the session's level. The counter-example runs main's code (no empty check) and must show the bug.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = name => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const js = read('laolao-metre-engine.js');
const css = read('laolao-metre-engine.css');
const GUARD = 'if ((catalog.levels || []).length) body.append(levels);';
// Same four levels as services/mode-architecture/engines-bridge.mjs LEVELS.
const FOUR = [
  {id: 'full-access', name: '全放手', hint: 'a'}, {id: 'auto', name: '自己判断', hint: 'b'},
  {id: 'auto-accept-edits', name: '改文件不问', hint: 'c'}, {id: 'approval-required', name: '每步都问', hint: 'd'},
];

test('the engine menu has the empty-levels check', () => {
  assert.ok(js.includes(GUARD), 'laolao-metre-engine.js only appends .pk-eng-menu__levels when catalog.levels is not empty');
});

async function openMenu(browser, code, catalog, level) {
  const tab = await browser.newPage({viewport: {width: 1024, height: 768}});
  try {
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body style="margin:0">
      <div class="chat-main" style="position:relative;height:100vh"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30118/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30118/chat?session=agent%3Ametre%3Ab');
    await tab.evaluate(({catalog, level}) => {
      window.__laolaoToast = () => {};
      window.__laolaoSidebar = {gwRequest: async method => {
        if (method === 'pinkie.engines.session') return {sessionKey: 'agent:metre:b', pref: {engine: 'metre', ...(level ? {level} : {})}, summary: null, error: '', service: {running: true}};
        if (method === 'pinkie.engines.catalog') { if (catalog === 'fail') throw new Error('gateway timeout'); return catalog; }
        return {};
      }};
    }, {catalog, level});
    await tab.addScriptTag({content: code});
    const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip');
    await chip.waitFor({timeout: 10_000});
    await chip.click();
    await tab.locator('.pk-eng-menu .pk-eng-menu__item').first().waitFor({timeout: 10_000});
    return await tab.evaluate(() => {
      const box = document.querySelector('.pk-eng-menu .pk-eng-menu__levels');
      return {section: !!box, label: box?.querySelector('.pk-eng-menu__label')?.textContent || '',
        buttons: box ? [...box.querySelectorAll('.pk-eng-seg')].map(b => ({name: b.textContent, pressed: b.getAttribute('aria-pressed')})) : []};
    });
  } finally { await tab.close(); }
}

test('in a browser: no "放手程度" section without levels; four levels draw four buttons', {timeout: 90_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const empty = {enabled: true, running: true, source: 'live', levels: [], engines: []};
    const full = {enabled: true, running: true, source: 'live', levels: FOUR, engines: []};

    const failed = await openMenu(browser, js, 'fail', '');
    assert.equal(failed.section, false, 'catalog load failed (falls back to levels: []): no .pk-eng-menu__levels');
    const none = await openMenu(browser, js, empty, '');
    assert.equal(none.section, false, 'catalog with levels: []: no .pk-eng-menu__levels');

    const four = await openMenu(browser, js, full, 'auto-accept-edits');
    assert.equal(four.section, true, 'four levels: the section is there');
    assert.equal(four.label, '放手程度');
    assert.deepEqual(four.buttons, FOUR.map(l => ({name: l.name, pressed: String(l.id === 'auto-accept-edits')})), 'four buttons, only the session level pressed');
    const dflt = await openMenu(browser, js, full, '');
    assert.deepEqual(dflt.buttons.map(b => b.pressed), ['true', 'false', 'false', 'false'], 'no level chosen: 全放手 (full-access) is pressed');

    // Counter-example: without the empty check (main 498b4c40), the failed catalog leaves an empty "放手程度" label.
    const unguarded = js.replace(GUARD, 'body.append(levels);');
    assert.notEqual(unguarded, js, 'counter-example: the check was found and removed');
    const bug = await openMenu(browser, unguarded, 'fail', '');
    assert.equal(bug.section, true, 'counter-example: without the check the empty section comes back');
    assert.equal(bug.buttons.length, 0, 'counter-example: and it has no buttons');
  } finally { await browser.close(); }
});
