// T3 #4（#96 L32）：Metre 对话区的时间线缩略条（laolao-metre-minimap.js / .css）。
// 复发防护：
//   1. 每条提问一根小节线，位置按它在整段对话里的比例排；挨得太近的至少隔 3px；正在读的那一小节、看得到的那一段算对。
//   2. 点小节线跳到那一条提问；键盘 ↑ / ↓ 在小节线之间走、Enter 跳；跳完「正在读」跟着变。
//   3. 少于 3 条提问、首页、离开 Metre 不出；窄窗放不下时给对话区右边让位，缩略条不压正文。
//   4. 其他模式一个字不动（反例：同样的对话，项目模式不出缩略条）；不加观察器、定时器循环、window.__ 全局、!important。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const js = read('../ui/injections/laolao-metre-minimap.js');
const css = read('../ui/injections/laolao-metre-minimap.css');
const domWatch = read('../ui/injections/laolao-dom-watch.js');
const head = read('../ui/injections/laolao-head.fragment.html');
const regions = JSON.parse(read('../ui/injections/regions.json'));
const plain = value => JSON.parse(JSON.stringify(value)); // vm 里的对象来自另一个 realm

function loadPure() {
  const ctx = {window: {addEventListener() {}}, requestAnimationFrame: () => 0, setTimeout, clearTimeout,
    document: {documentElement: {getAttribute: () => 'metre', dataset: {}}, querySelector: () => null, querySelectorAll: () => []}};
  vm.runInNewContext(js, ctx);
  return ctx.window.Pinkie.metreMinimap;
}

test('loaded after metre-files, owned by the metre region, Metre-only css, no observer / interval / gateway / window.__ / !important', () => {
  const at = name => head.indexOf(`/${name}?v=@hash`);
  assert.ok(at('laolao-metre-minimap.css') > at('laolao-metre-files.js'));
  assert.ok(at('laolao-metre-minimap.js') > at('laolao-metre-minimap.css'));
  const metre = regions.regions.find(region => region.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-minimap.css') && metre.files.includes('laolao-metre-minimap.js'));
  assert.doesNotMatch(js, /new MutationObserver|new ResizeObserver|new IntersectionObserver|setInterval\(|window\.__\w+\s*=/);
  assert.doesNotMatch(js, /gwRequest|fetch\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(css, /!important/);
  // 每条规则都挂在 Metre 下（@keyframes 的帧和 @media 里的规则同样要求）
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '').replace(/@media[^{]*\{/g, '')
    .match(/[^{};]+(?=\{)/g).map(s => s.trim()).filter(Boolean);
  assert.ok(selectors.length >= 10, 'the selector scan found the rules');
  for (const group of selectors) {
    for (const sel of group.split(',').map(s => s.trim())) assert.match(sel, /^html(\[data-pinkie-reduce-motion\])?\[data-laolao-mode="metre"\]/, sel);
  }
});

test('layout: one bar line per question by position, min 3px apart, current = the one being read, band = what is on screen', () => {
  const {layout} = loadPure();
  const base = {tops: [0, 500, 1000, 1500, 1980], clientHeight: 500, scrollHeight: 2000, length: 200};
  assert.deepEqual(plain(layout({...base, scrollTop: 0})), {ticks: [0, 50, 100, 150, 198], current: 0, band: {top: 0, height: 50}});
  assert.equal(layout({...base, scrollTop: 900}).current, 2, 'the question above the reading line (30% down) is current');
  assert.equal(layout({...base, scrollTop: 840}).current, 1, 'reading line at 990, just above the third question');
  assert.deepEqual(plain(layout({...base, scrollTop: 1500})), {ticks: [0, 50, 100, 150, 198], current: 4, band: {top: 150, height: 50}}, 'at the bottom the last one is current');
  assert.deepEqual(plain(layout({tops: [0, 5, 10], clientHeight: 500, scrollHeight: 2000, length: 200, scrollTop: 0}).ticks), [0, 3, 6], 'crowded bar lines stay 3px apart');
  assert.deepEqual(plain(layout({tops: [1990, 1995, 2000], clientHeight: 500, scrollHeight: 2000, length: 200, scrollTop: 0}).ticks), [199, 200, 200], 'never past the end');
  assert.equal(layout({tops: [], clientHeight: 500, scrollHeight: 2000, length: 200, scrollTop: 0}).current, -1);
});

test('labels: 第 N 小节 + the question, whitespace folded, clipped at 40', () => {
  const {label} = loadPure();
  assert.equal(label('  帮我\n看看  这个 ', 0), '第 1 小节 · 帮我 看看 这个');
  assert.equal(label('', 2), '第 3 小节');
  assert.equal(label('字'.repeat(50), 4), `第 5 小节 · ${'字'.repeat(40)}…`);
});

// ---------- 真页面（页面结构照原生 chat-page：.chat-thread > .chat-thread-inner > .chat-group） ----------
let sharedBrowser;
after(async () => { const b = await sharedBrowser; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}
async function launch(t) {
  sharedBrowser ??= start();
  const b = await sharedBrowser;
  if (b.why) { t.skip(b.why); return null; }
  return b;
}
const QUESTIONS = ['先看看登录页', '按钮改成蓝色', '顺便跑一下测试', '还有别的地方要改吗', '最后整理一下改动'];
const page = (mode, {count = 5, home = false} = {}) => `<!doctype html><html data-laolao-mode="${mode}"${home ? ' data-laolao-startup-home="1"' : ''}><head><style>
html,body{margin:0} :root{--metre-line-strong:#D3D0C8;--metre-hover:#EFEDE8;--metre-muted:#77736B;--metre-text:#1B1A18;--metre-cobalt:#2F4BB0}
.chat-thread{position:fixed;left:0;top:0;width:min(1000px,100vw);height:600px;overflow:auto;box-sizing:border-box}
.chat-thread-inner{max-width:640px;margin:0 auto}
.chat-group{margin:0}.chat-group.user .chat-bubble{height:40px}.chat-group.assistant{height:600px}
.agent-chat__input{position:fixed;left:0;top:640px;width:600px;height:100px}
${css}</style></head><body><main class="content content--chat"><openclaw-chat-pane active><div class="chat-main"><div class="chat-thread"><div class="chat-thread-inner">
${QUESTIONS.slice(0, count).map((q, i) => `<div class="chat-group user" id="u${i}"><div class="chat-bubble" data-message-text="${q}">${q}</div></div><div class="chat-group assistant" id="a${i}"><div class="chat-bubble">好的。</div></div>`).join('')}
</div></div><div class="agent-chat__input"></div></div></openclaw-chat-pane></main></body></html>`;
async function open(browser, mode, {width = 1280, ...opts} = {}) {
  const tab = await browser.newPage({viewport: {width, height: 800}});
  await tab.setContent(page(mode, opts));
  await tab.addScriptTag({content: domWatch});
  await tab.addScriptTag({content: js});
  return tab;
}
const ticks = tab => tab.locator('.pk-mmap__tick').evaluateAll(list => list.map(b => [b.getAttribute('aria-label'), b.hasAttribute('aria-current')]));
const topOf = (tab, id) => tab.evaluate(i => Math.round(document.getElementById(i).getBoundingClientRect().top - document.querySelector('.chat-thread').getBoundingClientRect().top), id);

test('in Metre: one bar line per question; clicking jumps there and moves the cobalt mark; keys walk between bar lines', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'metre');
  try {
    await tab.locator('.pk-mmap').waitFor({timeout: 5000});
    assert.deepEqual(await ticks(tab), QUESTIONS.map((q, i) => [`第 ${i + 1} 小节 · ${q}`, i === 0]));
    const place = await tab.evaluate(() => {
      const r = document.querySelector('.pk-mmap').getBoundingClientRect(), inner = document.querySelector('.chat-thread-inner').getBoundingClientRect();
      const thread = document.querySelector('.chat-thread');
      return {clearOfText: r.left >= inner.right, insideThread: r.right <= thread.getBoundingClientRect().left + thread.clientWidth, aboveBottom: r.bottom <= thread.getBoundingClientRect().bottom, tight: document.documentElement.dataset.pkMmap || ''};
    });
    assert.deepEqual(place, {clearOfText: true, insideThread: true, aboveBottom: true, tight: ''});
    await tab.locator('.pk-mmap__tick').nth(2).click();
    await tab.waitForFunction(() => document.querySelector('.pk-mmap__tick[data-index="2"]')?.hasAttribute('aria-current'), null, {timeout: 3000});
    assert.ok(Math.abs(await topOf(tab, 'u2')) <= 2, 'the third question is at the top of the conversation');
    assert.equal(await tab.evaluate(() => document.getElementById('u2').hasAttribute('data-pk-mmap-hit')), true, 'and flashes');
    // 键盘：↓ 到下一根、Enter 跳
    await tab.locator('.pk-mmap__tick').nth(2).focus();
    await tab.keyboard.press('ArrowDown');
    assert.equal(await tab.evaluate(() => document.activeElement?.dataset.index), '3');
    await tab.keyboard.press('Enter');
    await tab.waitForFunction(() => document.querySelector('.pk-mmap__tick[data-index="3"]')?.hasAttribute('aria-current'), null, {timeout: 3000});
    assert.ok(Math.abs(await topOf(tab, 'u3')) <= 2);
    await tab.keyboard.press('Home');
    assert.equal(await tab.evaluate(() => document.activeElement?.dataset.index), '0');
    // 用户自己滚到底：最后一小节变成当前
    await tab.evaluate(() => { const th = document.querySelector('.chat-thread'); th.scrollTop = th.scrollHeight; });
    await tab.waitForFunction(() => document.querySelector('.pk-mmap__tick[data-index="4"]')?.hasAttribute('aria-current'), null, {timeout: 3000});
    // 离开 Metre 整条拿掉
    await tab.evaluate(() => { document.documentElement.setAttribute('data-laolao-mode', 'chat'); window.dispatchEvent(new Event('laolao:modechange')); });
    await tab.waitForFunction(() => !document.querySelector('.pk-mmap') && !document.documentElement.dataset.pkMmap, null, {timeout: 3000});
  } finally { await tab.close(); }
});

test('a narrow window makes room on the right so the bar never covers the text', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'metre', {width: 660});
  try {
    await tab.locator('.pk-mmap').waitFor({timeout: 5000});
    await tab.waitForTimeout(200);
    const r = await tab.evaluate(() => ({tight: document.documentElement.dataset.pkMmap, rail: document.querySelector('.pk-mmap').getBoundingClientRect().left, text: document.querySelector('.chat-thread-inner').getBoundingClientRect().right}));
    assert.equal(r.tight, 'tight');
    assert.ok(r.rail >= r.text, `rail ${r.rail} starts right of the text ${r.text}`);
  } finally { await tab.close(); }
});

test('nothing shows with fewer than 3 questions, on the home page, or in other modes (counterexample: same conversation, project mode)', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  for (const [mode, opts] of [['metre', {count: 2}], ['metre', {home: true}], ['project', {}], ['chat', {}]]) {
    const tab = await open(browser, mode, opts);
    try {
      await tab.waitForTimeout(400);
      assert.equal(await tab.locator('.pk-mmap').count(), 0, `${mode} ${JSON.stringify(opts)}`);
      assert.equal(await tab.evaluate(() => document.documentElement.dataset.pkMmap ?? null), null);
    } finally { await tab.close(); }
  }
});
