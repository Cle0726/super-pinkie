// 11-24 T3 第一批 #3：Metre 会话内查找（laolao-metre-find.js / .css），真浏览器里跑。
// 测试页仿原生 2026.7.1-2 的结构：section.card.chat > .agent-chat__search-bar（放大镜 svg + 查找框 + openclaw-tooltip 里的关闭键）
// + .chat-thread；原生的 Ctrl+F 只挂在对话卡片里，开关的是 searchOpen。
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
  body{margin:0;font:14px sans-serif} aside{position:fixed;left:0;top:0;width:200px;height:100vh}
  section.card.chat{position:absolute;left:220px;top:20px;width:900px;height:640px;display:flex;flex-direction:column}
  .chat-workbench{flex:1 1 auto;min-height:0;display:flex} .chat-main{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
  .chat-thread{flex:1 1 auto;overflow:auto} .chat-group{margin:8px 0} textarea{width:100%}
</style></head><body><aside><button id="side">侧栏</button></aside>
<section class="card chat"><div class="chat-workbench"><div class="chat-main">
  <div class="chat-thread">
    <div class="chat-group user"><div class="chat-text">还有那个长颈鹿的例子</div></div>
    <div class="chat-group assistant"><div class="chat-text">长颈鹿的例子在第五节，我已经改好了。</div></div>
    <div class="chat-group user"><div class="chat-text">好的，谢谢</div></div>
  </div>
  <div class="agent-chat__input"><div class="agent-chat__composer-combobox"><textarea></textarea></div></div>
</div></div></section></body></html>`;

// 原生行为的替身：Ctrl+F 在卡片里切换查找条；关闭键收起
const NATIVE = () => {
  const card = document.querySelector('section.card.chat');
  const toggle = () => {
    const old = card.querySelector(':scope > .agent-chat__search-bar');
    if (old) { old.remove(); return; }
    const bar = document.createElement('div'); bar.className = 'agent-chat__search-bar';
    bar.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/></svg><input type="text" placeholder="搜索消息…"><openclaw-tooltip style="display:contents"><button class="btn btn--ghost" aria-label="Close search">×</button></openclaw-tooltip>';
    bar.querySelector('button').addEventListener('click', () => bar.remove());
    card.prepend(bar);
  };
  card.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'f') { e.preventDefault(); toggle(); } });
};

async function setup(browser, mode) {
  const p = await browser.newPage({viewport: {width: 1200, height: 700}});
  await p.route('http://find.test/', (r) => r.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode)}));
  await p.goto('http://find.test/');
  await p.evaluate(NATIVE);
  await p.addStyleTag({path: inj('laolao-metre-find.css')});
  await p.addScriptTag({path: inj('laolao-metre-find.js')});
  return p;
}
const state = (p) => p.evaluate(() => {
  const R = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.width), Math.round(r.height)]; };
  const bar = document.querySelector('.agent-chat__search-bar');
  return {
    bar: R(bar), svg: R(bar?.querySelector('svg')), thread: R(document.querySelector('.chat-thread')),
    focusInBar: !!document.activeElement?.closest?.('.agent-chat__search-bar'), focusComposer: document.activeElement?.tagName === 'TEXTAREA',
    count: bar?.querySelector('.pk-find__count')?.textContent ?? null,
    marks: CSS.highlights?.get('pk-find')?.size || 0, cur: CSS.highlights?.get('pk-find-cur')?.size || 0,
  };
});

test(`Metre find: Ctrl+F opens a 40px bar with focus, highlights and counts matches, Enter steps, Esc closes; other modes untouched (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await setup(browser, 'metre');
    await p.click('#side');                       // 焦点在侧栏：原生的 Ctrl+F 够不着
    await p.keyboard.press('Control+f'); await p.waitForTimeout(300);
    let s = await state(p);
    assert.ok(s.bar, `Ctrl+F from outside the card opens the bar: ${JSON.stringify(s)}`);
    assert.deepEqual([s.bar[3], s.svg[2], s.svg[3]], [40, 14, 14], `bar is 40px high, magnifier 14px (was stretched to the card width): ${JSON.stringify(s)}`);
    assert.ok(s.thread[0] >= s.bar[1] && s.thread[1] <= 700, `thread stays inside the window below the bar: ${JSON.stringify(s)}`);
    assert.equal(s.focusInBar, true, 'focus is in the find box');

    await p.keyboard.press('Control+f'); await p.waitForTimeout(200);
    assert.ok((await state(p)).bar, 'Ctrl+F again keeps the bar open (selects the box instead of toggling it off)');

    await p.keyboard.type('长颈鹿'); await p.waitForTimeout(300);
    s = await state(p);
    assert.deepEqual([s.count, s.marks, s.cur], ['2 / 2', 2, 1], `two matches highlighted, current is the latest: ${JSON.stringify(s)}`);
    await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    assert.equal((await state(p)).count, '1 / 2', 'Enter wraps to the first match');
    await p.keyboard.press('Shift+Enter'); await p.waitForTimeout(100);
    assert.equal((await state(p)).count, '2 / 2', 'Shift+Enter goes back');

    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    s = await state(p);
    assert.deepEqual([s.bar, s.marks, s.focusComposer], [null, 0, true], `Esc closes the bar, clears highlights, focus back to the composer: ${JSON.stringify(s)}`);
    await p.close();

    const q = await setup(browser, 'chat');
    await q.click('textarea'); await q.keyboard.press('Control+f'); await q.waitForTimeout(300);
    s = await state(q);
    assert.ok(s.bar && s.svg[2] > 100 && s.count === null, `other modes: this file changes nothing: ${JSON.stringify(s)}`);
    await q.close();
  } finally { await browser.close(); }
});

test('wiring: laolao-metre-find.css / .js are in the head, owned by the Metre region, Metre-only, and add no forbidden patterns', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<link rel="stylesheet" href="\/laolao-metre-find\.css\?v=@hash">/);
  assert.match(head, /<script defer src="\/laolao-metre-find\.js\?v=@hash"><\/script>/);
  const regions = JSON.parse(read('regions.json'));
  for (const f of ['laolao-metre-find.css', 'laolao-metre-find.js']) {
    assert.equal((regions.regions || regions).find((g) => (g.files || []).includes(f))?.id, 'metre', f + ' is owned by the Metre region');
  }
  const js = read('laolao-metre-find.js'), css = read('laolao-metre-find.css');
  for (const bad of [/MutationObserver/, /setInterval/, /window\.__\w+\s*=(?!=)/, /!important/]) { assert.doesNotMatch(js, bad); assert.doesNotMatch(css, bad); }
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((s) => s.trim()).filter(Boolean)) {
    assert.match(rule, /^html\[data-laolao-mode="metre"\]/, `every rule is Metre-only: ${rule.slice(0, 80)}`);
  }
});
