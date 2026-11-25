// M14：Metre 里「朗读这条回答」（laolao-metre-read.js）。
// 用一个可控的 speechSynthesis 替身走完整个过程：点了开始念、键变「停止朗读」、念完自己复原、
// 一次只念一条、再点就停、换会话 / 离开 Metre 会停；不念代码块、链接、来源角标；其他模式不出键。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const js = read('../ui/injections/laolao-metre-read.js');
const domWatch = read('../ui/injections/laolao-dom-watch.js');
const head = read('../ui/injections/laolao-head.fragment.html');
const regions = JSON.parse(read('../ui/injections/regions.json'));

// row=true：碧琪的按键行已经画好；row=false：后端元数据还没到，只有原生底部按键区（朗读键要退回放在这里）。
const group = (id, html, row = true) => `<div class="chat-group assistant" id="${id}"><div class="chat-group-messages"><div class="chat-bubble"><div class="chat-text">${html}</div></div></div>
  <div class="chat-group-footer"><div class="chat-group-footer-actions">${row ? '<div class="pinkie-msg-row pinkie-msg-row--assistant"><button class="pinkie-msg-btn">复制</button></div>' : '<button class="chat-group-delete" aria-label="删除消息">x</button>'}</div></div></div>`;
const page = mode => `<!doctype html><html data-laolao-mode="${mode}"><body><div class="chat-thread">
${group('a', '<p>第一段。说两句<a class="pinkie-cite" href="https://x.dev">1</a>。</p><pre><code>rm -rf /</code></pre><ul><li>要点一 https://example.com/x</li><li>要点二</li></ul>')}
${group('b', '<p>Second answer.</p>', false)}
${group('c', '<pre><code>only code</code></pre>')}
</div></body></html>`;

// 替身：记下念过的每一段；end() 让当前这段念完（触发 onend）。
const fakeSpeech = () => {
  const log = window.spoken = [];
  let queue = [];
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ''; };
  const synth = {
    speak(u) { queue.push(u); log.push(u.text); },
    cancel() { window.cancels = (window.cancels || 0) + 1; queue = []; },
    getVoices: () => [{name: 'Microsoft Xiaoxiao Online (Natural)', lang: 'zh-CN', localService: false}, {name: 'Aria', lang: 'en-US', localService: true}],
  };
  Object.defineProperty(window, 'speechSynthesis', {value: synth, configurable: true});
  window.endOne = () => { const u = queue.shift(); u?.onend?.(); };
  window.failOne = () => { const u = queue.shift(); u?.onerror?.(); };
};

// 整个文件只起一个浏览器（CI 里所有测试文件并行跑，每个测试都起一个会拖慢别的文件里的浏览器测试）；
// 每个测试自己开页面、用完关掉自己的页面，互不影响；文件跑完关浏览器。
let shared;
after(async () => { const b = await shared; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}
async function launch(t) {
  shared ??= start();
  const b = await shared;
  if (b.why) { t.skip(b.why); return null; }
  return {newPage: (...a) => b.newPage(...a), close: async () => { for (const c of b.contexts()) await c.close(); }};
}
async function open(browser, mode) {
  const tab = await browser.newPage();
  await tab.route('http://127.0.0.1:30122/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode)}));
  await tab.goto('http://127.0.0.1:30122/chat');
  await tab.evaluate(fakeSpeech);
  await tab.addScriptTag({content: domWatch});
  await tab.addScriptTag({content: js});
  return tab;
}
const state = (tab, id) => tab.locator(`#${id} .pk-mread`).getAttribute('aria-pressed');

test('loaded after the cite files, owned by the metre region, no new observer / interval / window.__ global', () => {
  assert.ok(head.indexOf('laolao-metre-read.js?v=@hash') > head.indexOf('laolao-metre-cite.js?v=@hash'));
  const metre = regions.regions.find(r => r.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-read.js'));
  assert.doesNotMatch(js, /new\s+MutationObserver|setInterval\s*\(|window\.__\w+\s*=(?!=)/);
});

test('in Metre: read one answer, show it is playing, reset when done, one at a time, stop on mode change', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'metre');
    await tab.locator('#a .pk-mread').waitFor();
    assert.equal(await tab.locator('#c .pk-mread').count(), 0, 'nothing readable (only code) → no button');
    assert.equal(await tab.locator('#a .pinkie-msg-row--assistant > .pk-mread').count(), 1, 'goes into the Pinkie action row when it is there');
    assert.equal(await tab.locator('#b .chat-group-footer-actions > .pk-mread').count(), 1, 'falls back to the native footer actions before the row is drawn');
    // 按键行后来才画出来：朗读键搬进去，不重复
    await tab.evaluate(() => { const row = document.createElement('div'); row.className = 'pinkie-msg-row pinkie-msg-row--assistant'; document.querySelector('#b .chat-group-footer-actions').append(row); });
    await tab.locator('#b .pinkie-msg-row--assistant > .pk-mread').waitFor();
    assert.equal(await tab.locator('#b .pk-mread').count(), 1);
    const button = tab.getByRole('button', {name: '朗读'}).first();
    assert.equal(await state(tab, 'a'), 'false');

    await button.click();
    assert.equal(await state(tab, 'a'), 'true');
    assert.equal(await tab.locator('#a .pk-mread').getAttribute('aria-label'), '停止朗读');
    // 11-25 06:46 打回：停止方块实际只有约 6.4px，夜间认不出。量渲染出来的方块，至少 9px 见方。
    const stop = await tab.locator('#a .pk-mread svg rect').boundingBox();
    assert.ok(stop && stop.width >= 9 && stop.height >= 9, `stop square too small: ${JSON.stringify(stop)}`);
    // 只念正文：不念代码、链接、角标数字；段落和列表项分开念
    assert.deepEqual(await tab.evaluate(() => window.spoken), ['第一段。']);
    await tab.evaluate(() => window.endOne());
    await tab.evaluate(() => window.endOne());
    await tab.evaluate(() => window.endOne());
    assert.deepEqual(await tab.evaluate(() => window.spoken), ['第一段。', '说两句。', '要点一', '要点二']);
    assert.equal(await state(tab, 'a'), 'true', 'still the last part');
    await tab.evaluate(() => window.endOne());
    assert.equal(await state(tab, 'a'), 'false', 'resets by itself when the last part ends');

    // 一次只念一条：念 a 时点 b，a 复原、b 开始
    await tab.locator('#a .pk-mread').click();
    await tab.locator('#b .pk-mread').click();
    assert.equal(await state(tab, 'a'), 'false');
    assert.equal(await state(tab, 'b'), 'true');
    assert.equal(await tab.evaluate(() => window.spoken.at(-1)), 'Second answer.');
    // 再点同一条 → 停
    await tab.locator('#b .pk-mread').click();
    assert.equal(await state(tab, 'b'), 'false');
    // 出错也复原
    await tab.locator('#b .pk-mread').click();
    await tab.evaluate(() => window.failOne());
    assert.equal(await state(tab, 'b'), 'false');
    // 换会话 → 停
    await tab.locator('#a .pk-mread').click();
    await tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:session-selected')));
    assert.equal(await state(tab, 'a'), 'false');
    // 正在念的那条被删掉 → 停
    await tab.locator('#b .pk-mread').click();
    const cancels = await tab.evaluate(() => window.cancels);
    await tab.evaluate(() => document.getElementById('b').remove());
    await tab.waitForFunction(n => window.cancels > n, cancels);
    assert.equal(await tab.evaluate(() => window.Pinkie.metreRead.playing), false);
    // 离开 Metre → 停，键拿掉
    await tab.locator('#a .pk-mread').click();
    await tab.evaluate(() => { document.documentElement.setAttribute('data-laolao-mode', 'chat'); window.dispatchEvent(new CustomEvent('laolao:modechange')); });
    await tab.waitForFunction(() => !document.querySelector('.pk-mread'));
    assert.equal(await tab.evaluate(() => window.Pinkie.metreRead.playing), false);
  } finally { await browser.close(); }
});

test('long text is split at sentence ends, never more than 160 characters a part', {timeout: 30_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'metre');
    const parts = await tab.evaluate(() => window.Pinkie.metreRead.chunks('甲'.repeat(400) + '。短句。' + ('一二三四五，').repeat(60)));
    assert.ok(parts.every(p => p.length <= 160), JSON.stringify(parts.map(p => p.length)));
    assert.equal(parts.join(''), '甲'.repeat(400) + '。短句。' + ('一二三四五，').repeat(60));
  } finally { await browser.close(); }
});

// 复发防护：原生 .chat-group-footer button 不悬停时 opacity:0、pointer-events:none（摘自 OpenClaw 控制台 CSS）。
// 朗读键退回原生底部按键区时，念到一半鼠标移开，「停止朗读」不能看不见、点不到。
const NATIVE_FOOTER_CSS = `.chat-group-footer button{opacity:0;pointer-events:none}
.chat-group:hover .chat-group-footer button{opacity:.6;pointer-events:auto}`;
test('while reading, the stop button stays visible and clickable after the mouse leaves (native footer hides buttons)', {timeout: 30_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'metre');
    await tab.addStyleTag({content: NATIVE_FOOTER_CSS});
    await tab.addStyleTag({content: read('../ui/injections/laolao-metre-cite.css')});
    const button = tab.locator('#b .pk-mread');
    await button.waitFor({state: 'attached'});
    await tab.locator('#b').hover();
    await button.click();
    assert.equal(await state(tab, 'b'), 'true');
    await tab.mouse.move(1, 1);
    const look = await button.evaluate(b => ({opacity: getComputedStyle(b).opacity, pe: getComputedStyle(b).pointerEvents}));
    assert.deepEqual(look, {opacity: '1', pe: 'auto'});
    await button.click({timeout: 3000});
    assert.equal(await state(tab, 'b'), 'false', 'stop works without hovering');
    // 不念时跟旁边的键一样，跟着按键区隐藏，不留一个看不见却点得到的键（点击会把鼠标带回来，先移开）
    await tab.mouse.move(1, 1);
    assert.equal(await button.evaluate(b => getComputedStyle(b).pointerEvents), 'none');
  } finally { await browser.close(); }
});

test('in other modes there is no read-aloud button', {timeout: 30_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'chat');
    await tab.waitForTimeout(300);
    assert.equal(await tab.locator('.pk-mread').count(), 0);
  } finally { await browser.close(); }
});
