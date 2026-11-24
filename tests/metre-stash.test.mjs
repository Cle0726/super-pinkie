// 11-24 T3 第一批 #2：Metre 草稿暂存（laolao-metre-stash.js），真浏览器里跑。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const read = (f) => fs.readFileSync(inj(f), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

const page = (mode) => `<!doctype html><html data-laolao-mode="${mode}"><head><style>
  body{margin:0;font:14px sans-serif} .chat-main{width:900px;margin:300px auto 0}
  .agent-chat__composer-combobox{width:780px;padding:12px;border:1px solid #ccc} textarea{width:100%}
  .agent-chat__composer-controls{display:flex;align-items:center;gap:4px} .pk-eng-chip{height:28px}
</style></head><body><openclaw-chat-pane><div class="chat-main"><div class="agent-chat__input">
  <div class="agent-chat__composer-combobox"><textarea></textarea></div>
  <div class="agent-chat__composer-controls"><button class="pk-eng-chip">Metre</button></div>
</div></div></openclaw-chat-pane></body></html>`;

async function setup(browser, mode, {origin = 'http://stash.test/'} = {}) {
  const p = await browser.newPage({viewport: {width: 1200, height: 700}});
  if (origin) { await p.route(origin, (r) => r.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode)})); await p.goto(origin); }
  else await p.setContent(page(mode));   // 空白页：没有本机存储，用来测「存不了就不清空」
  await p.evaluate(() => {
    const pane = document.querySelector('openclaw-chat-pane'), ta = pane.querySelector('textarea');
    window.drafts = [];
    pane.state = {sessionKey: 'agent:metre:s1', chatMessage: '', handleChatDraftChange(text) { this.chatMessage = text; ta.value = text; window.drafts.push(text); }};
    try { localStorage.clear(); } catch {}
  });
  await p.addStyleTag({path: inj('laolao-metre-stash.css')});
  await p.addScriptTag({path: inj('laolao-metre-stash.js')});
  return p;
}
const type = (p, text) => p.evaluate((t) => { const ta = document.querySelector('textarea'); ta.value = t; ta.dispatchEvent(new Event('input', {bubbles: true})); }, text);
const state = (p) => p.evaluate(() => {
  const btn = document.querySelector('.pk-stash__btn'), count = document.querySelector('.pk-stash__count'), box = document.querySelector('.pk-stash');
  const menu = document.querySelector('.pk-stash-menu');
  let stored = []; try { stored = JSON.parse(localStorage.getItem('pinkie.metreStash.v1:agent:metre:s1') || '[]').map((x) => x.text); } catch {}
  return {
    box: !!box, afterChip: box?.previousElementSibling?.classList.contains('pk-eng-chip') || false,
    disabled: btn ? btn.disabled : null, count: count && !count.hidden ? count.textContent : null,
    ta: document.querySelector('textarea').value, menu: !!menu, rows: menu ? [...menu.querySelectorAll('.pk-stash-menu__text')].map((n) => n.textContent) : [],
    stored, focus: String(document.activeElement?.className || ''), drafts: window.drafts.slice(),
  };
});

test(`Metre stash: Rest stashes and clears the composer, the count menu restores without losing text, per session, other modes untouched (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await setup(browser, 'metre');
    let s = await state(p);
    assert.deepEqual([s.box, s.afterChip, s.disabled, s.count], [true, true, true, null], `empty composer: Rest after the engine chip, disabled, no count: ${JSON.stringify(s)}`);

    await type(p, '第一段写到一半');
    assert.equal((await state(p)).disabled, false, 'typing enables Rest');
    await p.click('.pk-stash__btn');
    s = await state(p);
    assert.deepEqual([s.ta, s.count, s.stored, s.drafts.at(-1)], ['', '1', ['第一段写到一半'], ''], `stash clears via handleChatDraftChange and counts 1: ${JSON.stringify(s)}`);
    assert.equal(s.disabled, true, 'Rest is disabled again once the composer is empty');

    await type(p, '另一句');
    await p.click('.pk-stash__count');
    s = await state(p);
    assert.deepEqual([s.menu, s.rows], [true, ['第一段写到一半']], `count opens the menu: ${JSON.stringify(s)}`);
    await p.click('.pk-stash-menu__btn--take');
    s = await state(p);
    assert.deepEqual([s.ta, s.menu, s.count, s.stored], ['第一段写到一半', false, '1', ['另一句']], `restore puts the draft back and stashes what was in the box: ${JSON.stringify(s)}`);

    await p.click('.pk-stash__count');
    await p.keyboard.press('Escape');
    s = await state(p);
    assert.deepEqual([s.menu, /pk-stash__count/.test(s.focus)], [false, true], `Escape closes and returns focus to the count: ${JSON.stringify(s)}`);

    await p.click('.pk-stash__count');
    await p.click('.pk-stash-menu__btn--drop');
    s = await state(p);
    assert.deepEqual([s.menu, s.count, s.stored], [false, null, []], `deleting the last entry closes the menu and hides the count: ${JSON.stringify(s)}`);

    await type(p, '会话一的草稿'); await p.click('.pk-stash__btn');
    await p.evaluate(() => { document.querySelector('openclaw-chat-pane').state.sessionKey = 'agent:metre:s2'; window.dispatchEvent(new Event('pinkie:session-selected')); });
    await p.waitForTimeout(300);
    assert.equal((await state(p)).count, null, 'another session has its own (empty) stash');
    await p.close();

    const r = await setup(browser, 'metre', {origin: null});
    await type(r, '存不了也不能丢');
    await r.click('.pk-stash__btn');
    s = await state(r);
    assert.deepEqual([s.ta, s.count, s.drafts], ['存不了也不能丢', null, []], `no local storage: the composer keeps its text: ${JSON.stringify(s)}`);
    await r.close();

    const q = await setup(browser, 'chat');
    assert.equal((await state(q)).box, false, 'other modes get no stash button');
    await q.close();
  } finally { await browser.close(); }
});

test('wiring: laolao-metre-stash.css / .js are in the head, owned by the Metre region, Metre-only, and add no forbidden patterns', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<link rel="stylesheet" href="\/laolao-metre-stash\.css\?v=@hash">/);
  assert.match(head, /<script defer src="\/laolao-metre-stash\.js\?v=@hash"><\/script>/);
  assert.ok(head.indexOf('laolao-metre-engine.js') < head.indexOf('laolao-metre-stash.js'), 'loaded after the engine chip script');
  const regions = JSON.parse(read('regions.json'));
  for (const f of ['laolao-metre-stash.css', 'laolao-metre-stash.js']) {
    assert.equal((regions.regions || regions).find((g) => (g.files || []).includes(f))?.id, 'metre', f + ' is owned by the Metre region');
  }
  const js = read('laolao-metre-stash.js'), css = read('laolao-metre-stash.css');
  for (const bad of [/MutationObserver/, /setInterval/, /window\.__\w+\s*=(?!=)/, /!important/]) { assert.doesNotMatch(js, bad); assert.doesNotMatch(css, bad); }
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{[^{}]*\{[^}]*\}\s*\}/g, '').split('}')
    .map((s) => s.trim().replace(/^@media[^{]*\{\s*/, '')).filter(Boolean);
  for (const rule of rules) assert.match(rule, /^html\[data-laolao-mode="metre"\]/, `every rule is Metre-only: ${rule.slice(0, 80)}`);
});
