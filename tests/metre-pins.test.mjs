// 「以后」S 级 M3（ui2，11-25）：Metre 置顶消息。
// 原生有「N pinned」折叠条但没有置顶入口，存储按消息序号、在模块里缓存，外面写不进去；所以 Metre 自己按消息 id 存一份。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SRC = read('ui/injections/laolao-metre-pins.js');
const CSS = read('ui/injections/laolao-metre-chat.css');

function loadApi() {
  const window = {addEventListener() {}, localStorage: null, Pinkie: {}};
  const document = {documentElement: {getAttribute: () => 'classic'}, querySelector: () => null, querySelectorAll: () => []};
  const location = {href: 'http://x/chat'};
  vm.runInNewContext(SRC, {window, document, location, URL});
  return window.Pinkie.metre.pins;
}

test('M3 消息 id：去掉「当前窗口里的序号」，分页后同一条还是同一个 id；直接 id 原样用', () => {
  const {stableId} = loadApi();
  assert.equal(stableId('msg:assistant:1764050000000:3'), 'assistant:1764050000000');
  assert.equal(stableId('msg:assistant:1764050000000:17'), 'assistant:1764050000000', '序号变了，id 不变');
  assert.equal(stableId('msg:user:1764050000000:0'), 'user:1764050000000');
  assert.equal(stableId('msg:abc-123'), 'abc-123');
  assert.equal(stableId(''), '');
  assert.equal(stableId('msg:'), '');
  assert.equal(stableId('tool:1'), '');
});

test('M3 接入和健康度：头片段加载、regions.json 登记；不新增观察器 / 定时器 / window 全局；不碰原生 openclaw:pinned 存储；只用 textContent', () => {
  assert.match(read('ui/injections/laolao-head.fragment.html'), /<script defer src="\/laolao-metre-pins\.js\?v=@hash"><\/script>/);
  const regions = JSON.parse(read('ui/injections/regions.json'));
  const list = Array.isArray(regions) ? regions : regions.regions;
  assert.ok(list.find((r) => r.id === 'metre').files.includes('laolao-metre-pins.js'));
  assert.doesNotMatch(SRC, /new\s+MutationObserver|setInterval\s*\(|setTimeout\s*\(|window\.__[A-Za-z]/);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 注释里提到原生存储不算
  assert.doesNotMatch(code, /openclaw:pinned/);
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML/);
  assert.match(SRC, /window\.Pinkie\.domWatch\?\.watch\(/);
});

test('M3 样式只在 Metre：新规则都以 html[data-laolao-mode="metre"] 开头，不加 !important', () => {
  const block = CSS.slice(CSS.indexOf('/* M3 置顶消息'));
  assert.ok(block.length > 100, '找到 M3 段');
  assert.doesNotMatch(block, /!important/);
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => /^[^\s@}]/.test(l) && !/^(from|to)\b/.test(l));
  assert.ok(rules.length >= 10, '数到了规则行');
  for (const line of rules) assert.match(line, /^html\[data-laolao-mode="metre"\]/, line);
});

test('M3 真浏览器：置顶 / 折叠条 / 展开列表 / 跳过去 / 取消置顶；分页后序号变了还对得上；安静时不反复重画；其他模式不出现', {timeout: 40_000}, async (t) => {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  const DOMWATCH = read('ui/injections/laolao-dom-watch.js');
  const group = (role, id, text) => `<div class="chat-group ${role}"><div class="chat-group-messages"><div class="chat-bubble" data-message-id="${id}"><div class="chat-text">${text}</div></div><div class="chat-group-footer"><div class="chat-group-footer__meta"><span class="chat-sender-name">${role}</span><time>10:00</time></div></div></div></div>`;
  const thread = (offset) => group('user', `msg:user:1000:${offset}`, '把登录页的按钮改成蓝色') + group('assistant', `msg:assistant:2000:${offset + 1}`, '好，我先改按钮颜色');
  const page = (mode) => `<!doctype html><html data-laolao-mode="${mode}"><head><style>${CSS}</style></head><body><div class="chat-main"><div class="chat-workbench"><div class="chat-thread" style="height:300px;overflow:auto">${thread(0)}</div></div></div></body></html>`;
  const KEY = 'pinkie.metre.pins:agent:metre:p1';
  try {
    const tab = await browser.newPage();
    let mode = 'metre';
    await tab.route('http://127.0.0.1:30119/**', (route) => route.fulfill({contentType: 'text/html', body: page(mode)}));
    await tab.goto('http://127.0.0.1:30119/chat?session=agent%3Ametre%3Ap1');
    await tab.evaluate(() => localStorage.clear());
    await tab.addScriptTag({content: DOMWATCH});
    await tab.addScriptTag({content: SRC});
    const pin = tab.locator('.chat-group.assistant .pk-metre-pin');
    await pin.waitFor({state: 'attached', timeout: 5000});
    assert.equal(await tab.locator('.pk-metre-pin').count(), 2, '每组消息页脚行一个');
    assert.equal(await tab.locator('.pk-metre-pins').count(), 0, '没置顶时没有折叠条');
    await tab.locator('.chat-group.assistant').hover();
    await pin.click();
    await tab.locator('.pk-metre-pins').waitFor({timeout: 5000});
    assert.equal(await pin.textContent(), '已置顶');
    assert.equal(await pin.getAttribute('aria-pressed'), 'true');
    assert.equal(await tab.locator('.pk-metre-pins__toggle').textContent(), '已置顶 1 条');
    assert.equal(await tab.evaluate(() => document.querySelector('.pk-metre-pins').nextElementSibling.className), 'chat-workbench', '折叠条在对话区上面');
    const stored = await tab.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
    assert.deepEqual(stored.map((p) => [p.id, p.role, p.text]), [['assistant:2000', 'assistant', '好，我先改按钮颜色']]);
    assert.equal(await tab.evaluate(() => localStorage.getItem('openclaw:pinned:agent:metre:p1')), null, '不写原生存储');
    // 展开、看到摘要、点一条跳过去
    await tab.locator('.pk-metre-pins__toggle').click();
    assert.equal(await tab.locator('.pk-metre-pins__toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await tab.locator('.pk-metre-pins__text').textContent(), '好，我先改按钮颜色');
    assert.equal(await tab.locator('.pk-metre-pins__role').textContent(), 'Metre');
    await tab.locator('.pk-metre-pins__go').click();
    assert.equal(await tab.locator('.chat-group.assistant.pk-metre-pin-flash').count(), 1, '跳过去的那组亮一下');
    // 分页重画：序号变了（0/1 → 5/6），同一条还是「已置顶」
    await tab.evaluate((html) => { document.querySelector('.chat-thread').innerHTML = html; }, thread(5));
    await tab.waitForFunction(() => document.querySelector('.chat-group.assistant .pk-metre-pin')?.textContent === '已置顶', null, {timeout: 5000});
    assert.equal(await tab.locator('.chat-group.user .pk-metre-pin').textContent(), '置顶');
    // 安静时不反复重画自己（domWatch 也看属性变化，原样再写一遍也算变化）
    await tab.waitForTimeout(300);
    await tab.evaluate(() => { window.pkMutations = 0; new MutationObserver((r) => { window.pkMutations += r.length; }).observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true}); });
    await tab.waitForTimeout(600);
    assert.equal(await tab.evaluate(() => window.pkMutations), 0, '安静时 0 次改动');
    // 列表里取消
    await tab.locator('.pk-metre-pins__x').click();
    await tab.waitForFunction(() => !document.querySelector('.pk-metre-pins'), null, {timeout: 5000});
    assert.equal(await tab.evaluate((k) => localStorage.getItem(k), KEY), null);
    assert.equal(await pin.textContent(), '置顶');
    // 其他模式：存了置顶也不出现
    await tab.evaluate((k) => localStorage.setItem(k, JSON.stringify([{id: 'assistant:2000', role: 'assistant', text: 'x', at: 1}])), KEY);
    mode = 'classic';
    await tab.reload();
    await tab.addScriptTag({content: DOMWATCH});
    await tab.addScriptTag({content: SRC});
    await tab.waitForTimeout(300);
    assert.equal(await tab.locator('.pk-metre-pin, .pk-metre-pins').count(), 0, '经典模式里什么都不加');
  } finally { await browser.close(); }
});
