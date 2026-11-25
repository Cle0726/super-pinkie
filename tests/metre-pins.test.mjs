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
  const a3 = stableId('msg:assistant:1764050000000:3', '好，我先改按钮颜色');
  assert.match(a3, /^assistant:1764050000000:[0-9a-z]+$/);
  assert.equal(stableId('msg:assistant:1764050000000:17', '好，我先改按钮颜色'), a3, '序号变了，id 不变');
  assert.equal(stableId('msg:assistant:1764050000000:17', '  好，我先改按钮颜色 \n'), a3, '首尾空白不算');
  assert.notEqual(stableId('msg:assistant:1764050000000:4', '注册页用的是同一个'), a3, '同一时间戳的两条（假网关种子 / 批量导入）不撞');
  assert.match(stableId('msg:user:1764050000000:0', 'x'), /^user:1764050000000:/);
  assert.equal(stableId('msg:abc-123', 'whatever'), 'abc-123', '有消息 id 就原样用，不加哈希');
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
  // 两条助手消息时间戳相同（假网关种子记录就是这样）：只置顶最后一条，第一条不能跟着变「已置顶」。
  const thread = (offset) => group('user', `msg:user:1000:${offset}`, '把登录页的按钮改成蓝色') + group('assistant', `msg:assistant:2000:${offset + 1}`, '好，我先改按钮颜色')
    + group('assistant', `msg:assistant:2000:${offset + 2}`, '注册页用的是同一个');
  const page = (mode) => `<!doctype html><html data-laolao-mode="${mode}"><head><style>html{--metre-cobalt:#2f4bb0;--metre-chat-small:#6f6c65} .chat-group-footer__meta{display:flex;align-items:center;gap:8px;min-width:0} .chat-group-footer__meta time{min-width:96px;opacity:0} .chat-group:hover .chat-group-footer__meta time{opacity:1}</style><style>${CSS}</style></head><body><div class="chat-main"><div class="chat-workbench"><div class="chat-thread" style="height:300px;overflow:auto">${thread(0)}</div></div></div></body></html>`;
  const KEY = 'pinkie.metre.pins:agent:metre:p1';
  try {
    const tab = await browser.newPage();
    let mode = 'metre';
    await tab.route('http://127.0.0.1:30119/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode)}));
    await tab.goto('http://127.0.0.1:30119/chat?session=agent%3Ametre%3Ap1');
    await tab.evaluate(() => localStorage.clear());
    await tab.addScriptTag({content: DOMWATCH});
    await tab.addScriptTag({content: SRC});
    const pin = tab.locator('.chat-group.assistant .pk-metre-pin').last();
    const firstPin = tab.locator('.chat-group.assistant .pk-metre-pin').first();
    await pin.waitFor({state: 'attached', timeout: 5000});
    assert.equal(await tab.locator('.pk-metre-pin').count(), 3, '每组消息页脚行一个');
    assert.equal(await tab.locator('.pk-metre-pins').count(), 0, '没置顶时没有折叠条');
    await tab.locator('.chat-group.assistant').last().hover();
    await pin.click();
    await tab.locator('.pk-metre-pins').waitFor({timeout: 5000});
    assert.equal(await pin.textContent(), '已置顶');
    assert.equal(await pin.getAttribute('aria-pressed'), 'true');
    // 协调者 03:27：已置顶的不悬停时贴页脚左缘（原生时间 opacity 0 但照占位），悬停时也不跳。
    const edge = () => tab.evaluate(() => { const b = [...document.querySelectorAll('.pk-metre-pin')].find((x) => x.getAttribute('aria-pressed') === 'true'); const r = document.createRange(); r.selectNodeContents(b); return {text: Math.round(r.getBoundingClientRect().left), row: Math.round(b.parentElement.getBoundingClientRect().left)}; });
    await tab.mouse.move(1, 1);
    const rest = await edge();
    await tab.locator('.chat-group.assistant').last().hover();
    const hover = await edge();
    t.diagnostic('已置顶左缘 ' + JSON.stringify({rest, hover}));
    assert.ok(Math.abs(rest.text - rest.row) <= 1, `不悬停时「已置顶」字贴页脚左缘（字 ${rest.text}，行 ${rest.row}）`);
    assert.equal(hover.text, rest.text, '悬停时不跳');
    // assist 03:17 预审：悬停这组时「已置顶」不能退成灰色「置顶」（截图里那张是置顶之前拍的）。
    const look = await tab.evaluate(() => { const b = [...document.querySelectorAll('.pk-metre-pin')].find((x) => x.getAttribute('aria-pressed') === 'true'); return {text: b.textContent, color: getComputedStyle(b).color, cobalt: (() => { const i = document.createElement('i'); i.style.color = 'var(--metre-cobalt)'; b.parentElement.append(i); const c = getComputedStyle(i).color; i.remove(); return c; })()}; });
    assert.equal(look.text, '已置顶', '悬停这组时文字不变');
    assert.equal(look.cobalt, 'rgb(47, 75, 176)', '前提：钴蓝变量在页面里有值');
    assert.equal(look.color, look.cobalt, '悬停这组时还是钴蓝，不退成时间戳灰');
    assert.equal(await firstPin.textContent(), '置顶', '同一时间戳的另一条不跟着变');
    assert.equal(await tab.locator('.pk-metre-pins__toggle').textContent(), '已置顶 1 条');
    // 折叠条是对话流的第一个子元素，在流里占位：第一条消息在它下面，不被盖住
    const place = await tab.evaluate(() => { const bar = document.querySelector('.pk-metre-pins'), first = document.querySelector('.chat-thread .chat-group'); const a = bar.getBoundingClientRect(), b = first.getBoundingClientRect(); return {first: bar.parentElement.classList.contains('chat-thread') && bar.parentElement.firstElementChild === bar, gap: Math.round(b.top - a.bottom), position: getComputedStyle(bar).position}; });
    assert.equal(place.first, true, '在 .chat-thread 最前面');
    assert.ok(place.gap >= 0, `第一条消息不被盖住（间距 ${place.gap}px）`);
    assert.equal(place.position, 'static', '普通排在流里，不浮在消息上（look.py：sticky 贴顶读起来像压住了消息）');
    const stored = await tab.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
    assert.equal(stored.length, 1);
    assert.match(stored[0].id, /^assistant:2000:[0-9a-z]+$/);
    assert.deepEqual([stored[0].role, stored[0].text], ['assistant', '注册页用的是同一个']);
    assert.equal(await tab.evaluate(() => localStorage.getItem('openclaw:pinned:agent:metre:p1')), null, '不写原生存储');
    // 展开、看到摘要、点一条跳过去
    await tab.locator('.pk-metre-pins__toggle').click();
    assert.equal(await tab.locator('.pk-metre-pins__toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await tab.locator('.pk-metre-pins__text').textContent(), '注册页用的是同一个');
    assert.equal(await tab.locator('.pk-metre-pins__role').textContent(), 'Metre');
    await tab.locator('.pk-metre-pins__go').click();
    assert.equal(await tab.locator('.chat-group.assistant.pk-metre-pin-flash').count(), 1, '跳过去的那组亮一下');
    assert.equal(await tab.evaluate(() => [...document.querySelectorAll('.chat-group.assistant')].findIndex((g) => g.classList.contains('pk-metre-pin-flash'))), 1, '亮的是置顶的那条（第二条助手消息）');
    // 分页重画：序号变了（0/1/2 → 5/6/7），只有同一条还是「已置顶」；折叠条重新回到对话流最前面
    await tab.evaluate((html) => { document.querySelector('.chat-thread').innerHTML = html; }, thread(5));
    await tab.waitForFunction(() => [...document.querySelectorAll('.chat-group.assistant .pk-metre-pin')].map((b) => b.textContent).join('|') === '置顶|已置顶', null, {timeout: 5000});
    await tab.waitForFunction(() => document.querySelector('.chat-thread').firstElementChild?.classList.contains('pk-metre-pins'), null, {timeout: 5000});
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

// uireview 11-25 10:04Z 打回 #102：「取消置顶」只靠边框圈出来（底透明），原来 --metre-line-strong 对折叠条底日 1.54 / 夜 1.34。
// 真浏览器里装上皮肤和对话样式，日夜各量一次计算样式：边框色对它背后实际的底色 ≥ 3:1，悬停底上也 ≥ 3:1；
// 反例：把边框换回 --metre-line-strong，同一把尺子量出来要 < 3（尺子本身没坏）。顺带量三种键 Tab 到时的焦点环。
test('M3 真浏览器：「取消置顶」边框日夜对实际底色 ≥ 3:1（换回 --metre-line-strong 要低于 3）；三种键 Tab 焦点有环', {timeout: 40_000}, async (t) => {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  const SKIN = read('ui/injections/laolao-metre-skin.css');
  const bar = '<section class="pk-metre-pins"><button type="button" class="pk-metre-pins__toggle" aria-expanded="true">已置顶 1 条</button>'
    + '<ul class="pk-metre-pins__list"><li class="pk-metre-pins__item"><button type="button" class="pk-metre-pins__go"><span class="pk-metre-pins__role">Metre</span><span class="pk-metre-pins__text">注册页用的是同一个</span></button>'
    + '<button type="button" class="pk-metre-pins__x">取消置顶</button></li></ul></section>';
  const footer = '<div class="chat-group assistant"><div class="chat-group-footer"><div class="chat-group-footer__meta"><span class="chat-sender-name">Metre</span>'
    + '<button type="button" class="pk-metre-pin" aria-pressed="true">已置顶</button></div></div></div>';
  const page = `<!doctype html><html data-laolao-mode="metre"><head><meta charset="utf-8"><style>${SKIN}</style><style>${CSS}</style></head><body><div class="chat-thread">${bar}${footer}</div></body></html>`;
  // 浏览器里量：边框色和往上第一个不透明的底色都按计算样式取（color-mix 的计算值可能是 color(srgb …)），算 WCAG 对比度。
  const measure = () => {
    const rgb = (s) => {
      let m = s.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
      if (m) return {c: [+m[1], +m[2], +m[3]], a: m[4] == null ? 1 : +m[4]};
      m = s.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/);
      if (m) return {c: [m[1], m[2], m[3]].map((v) => +v * 255), a: m[4] == null ? 1 : +m[4]};
      throw new Error('unparsed colour ' + s);
    };
    const lum = (c) => c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const x = document.querySelector('.pk-metre-pins__x');
    let host = x.parentElement, bg;
    while (host) { const b = rgb(getComputedStyle(host).backgroundColor); if (b.a === 1) { bg = b.c; break; } host = host.parentElement; }
    // 悬停时键底是 --metre-hover：拿一个探针元素把这个变量解析成颜色
    const probe = document.createElement('i'); probe.style.color = 'var(--metre-hover)'; x.parentElement.append(probe);
    const hover = rgb(getComputedStyle(probe).color); probe.remove();
    const cs = getComputedStyle(x), edge = rgb(cs.borderTopColor);
    return {edge: edge.c.map(Math.round), style: cs.borderTopStyle, width: cs.borderTopWidth, height: x.getBoundingClientRect().height, onBar: +ratio(edge.c, bg).toFixed(2), onHover: +ratio(edge.c, hover.c).toFixed(2)};
  };
  try {
    const tab = await browser.newPage();
    await tab.route('http://127.0.0.1:30121/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8', body: page}));
    await tab.goto('http://127.0.0.1:30121/chat');
    for (const night of [false, true]) {
      await tab.evaluate((n) => { const h = document.documentElement; if (n) h.setAttribute('data-pinkie-night', ''); else h.removeAttribute('data-pinkie-night'); document.getElementById('pk-revert')?.remove(); }, night);
      const theme = night ? '夜' : '日';
      const now = await tab.evaluate(measure);
      t.diagnostic(`${theme} 取消置顶 ${JSON.stringify(now)}`);
      assert.equal(now.style, 'solid'); assert.equal(now.width, '1px');
      assert.ok(now.onBar >= 3, `${theme}间边框对折叠条底 ${now.onBar}:1，要 ≥ 3:1`);
      assert.ok(now.onHover >= 3, `${theme}间边框对悬停底 ${now.onHover}:1，要 ≥ 3:1`);
      assert.ok(now.height >= 24, `点击区高 ${now.height}px，要 ≥ 24`);
      // 反例：换回皮肤原来的 --metre-line-strong，同一把尺子必须量出 < 3
      await tab.evaluate(() => { const s = document.createElement('style'); s.id = 'pk-revert'; s.textContent = 'html[data-laolao-mode="metre"] .pk-metre-pins .pk-metre-pins__x { border-color: var(--metre-line-strong); }'; document.head.append(s); });
      const old = await tab.evaluate(measure);
      assert.ok(old.onBar < 3, `${theme}间反例（--metre-line-strong）应低于 3:1，量到 ${old.onBar}:1`);
    }
    // 焦点：Tab 到三种键，看计算出来的 outline（Metre 规则没去掉浏览器默认焦点环）
    await tab.evaluate(() => document.getElementById('pk-revert')?.remove());
    await tab.locator('.pk-metre-pin').evaluate((b) => { b.closest('.chat-group').parentElement.prepend(b.closest('.chat-group')); });
    await tab.evaluate(() => document.activeElement?.blur());
    const rings = {};
    for (let i = 0; i < 4; i++) {
      await tab.keyboard.press('Tab');
      const f = await tab.evaluate(() => { const e = document.activeElement, s = getComputedStyle(e); return {cls: e.className, text: e.textContent, style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor}; });
      rings[f.cls] = f;
    }
    t.diagnostic('焦点环 ' + JSON.stringify(Object.values(rings)));
    for (const cls of ['pk-metre-pin', 'pk-metre-pins__toggle', 'pk-metre-pins__x']) {
      assert.ok(rings[cls], `Tab 能到 ${cls}`);
      assert.notEqual(rings[cls].style, 'none', `${cls} 键盘焦点有 outline`);
      assert.notEqual(rings[cls].width, '0px', `${cls} 焦点环有宽度`);
    }
  } finally { await browser.close(); }
});

// mac2 任务 32（14:12Z，#102@6b389e4b）挡合并的两条：
// 1. 用户消息悬停时，皮肤把「复制 / 编辑」行（.pinkie-msg-row--user）绝对定位在气泡右下，正好盖住页脚行末尾的「置顶」，鼠标点不到；
// 2. 列表里点一条跳不到：smooth scrollIntoView 滚到一半，laolao-perf.js 的 IntersectionObserver 回调 restoreNow 把 scrollTop 写回锚点。
// 这里装上真皮肤、消息操作样式和 laolao-perf.js：鼠标（不 force）点用户消息的「置顶」；跳转后那条在对话视口里。
test('M3 真浏览器（mac2 任务 32）：用户消息的「置顶」不被复制 / 编辑行盖住；装着 laolao-perf.js 时列表跳转落在视口里', {timeout: 60_000}, async (t) => {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  const SKIN = read('ui/injections/laolao-metre-skin.css'), ACTIONS = read('ui/injections/laolao-message-actions.css');
  const DOMWATCH = read('ui/injections/laolao-dom-watch.js'), PERF = read('ui/injections/laolao-perf.js');
  const filler = '这一段只是占位，让对话够长、要滚很远才到目标。'.repeat(6);
  const userRow = '<div class="pinkie-msg-row pinkie-msg-row--user"><button type="button" class="pinkie-msg-btn" style="width:26px;height:26px">复</button><button type="button" class="pinkie-msg-btn" style="width:26px;height:26px">编</button></div>';
  const group = (role, i, text) => `<div class="chat-group ${role}"><div class="chat-group-messages"><div class="chat-bubble" data-message-id="msg:${role}:${1000 + i}:${i}"><div class="chat-text">${text}</div>${role === 'user' ? userRow : ''}</div>`
    + `<div class="chat-group-footer"><div class="chat-group-footer__meta"><span class="chat-sender-name">${role === 'user' ? '你' : 'Metre'}</span><time>2026年11月25日 0:10</time></div></div></div></div>`;
  let body = '';
  for (let i = 0; i < 40; i++) body += group(i % 2 ? 'assistant' : 'user', i, i === 37 ? '注册页用的是同一个' : `第 ${i} 条。${filler}`);
  // 原生的几条布局：用户消息整组靠右、页脚行 flex。
  const native = '.chat-group-messages{display:flex;flex-direction:column}.chat-group.user .chat-group-messages{align-items:flex-end}'
    + '.chat-bubble{max-width:560px}.chat-group-footer{display:flex}.chat-group-footer__meta{display:flex;align-items:center;gap:8px}.chat-group{margin:0 0 24px}';
  const page = `<!doctype html><html data-laolao-mode="metre"><head><meta charset="utf-8"><style>${native}</style><style>${SKIN}</style><style>${ACTIONS}</style><style>${CSS}</style></head>`
    + `<body style="margin:0"><div class="chat-main"><div class="chat-thread" style="height:600px;overflow-y:auto;width:900px"><div class="chat-thread-inner">${body}</div></div></div></body></html>`;
  const KEY = 'pinkie.metre.pins:agent:metre:p2';
  try {
    const tab = await browser.newPage({viewport: {width: 1000, height: 700}});
    await tab.route('http://127.0.0.1:30123/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8', body: page}));
    await tab.goto('http://127.0.0.1:30123/chat?session=agent%3Ametre%3Ap2');
    await tab.evaluate(() => localStorage.clear());
    await tab.addScriptTag({content: DOMWATCH});
    await tab.addScriptTag({content: PERF});
    await tab.addScriptTag({content: SRC});
    await tab.locator('.pk-metre-pin').first().waitFor({state: 'attached', timeout: 5000});
    assert.equal(await tab.evaluate(() => window.__laolaoPerf), true, '前提：laolao-perf.js 装上了');

    // 1. 用户消息：悬停后「置顶」中心点上最上面的元素是它自己，鼠标点得到（不 force）。
    const user = tab.locator('.chat-group.user').first();
    await user.hover();
    const hit = await user.evaluate((g) => { const b = g.querySelector('.pk-metre-pin'), r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return {own: b.contains(top), top: top?.className || top?.tagName, pin: [r.left, r.top, r.width, r.height].map(Math.round), row: [...g.querySelector('.pinkie-msg-row').getBoundingClientRect().toJSON ? Object.values(g.querySelector('.pinkie-msg-row').getBoundingClientRect().toJSON()).slice(0, 4) : []].map(Math.round)}; });
    t.diagnostic('用户消息置顶键 ' + JSON.stringify(hit));
    assert.ok(hit.own, `用户消息「置顶」中心点被 ${hit.top} 盖住`);
    await user.locator('.pk-metre-pin').click({timeout: 3000});
    assert.equal(await user.locator('.pk-metre-pin').getAttribute('aria-pressed'), 'true', '鼠标点到了用户消息的「置顶」');
    await user.locator('.pk-metre-pin').click({timeout: 3000});
    assert.equal(await user.locator('.pk-metre-pin').getAttribute('aria-pressed'), 'false');

    // 2. 置顶最后面那条，回到顶上，从列表跳过去：等滚动停下，目标在 .chat-thread 视口里。
    const far = tab.locator('.chat-group.assistant', {hasText: '注册页用的是同一个'});
    await far.scrollIntoViewIfNeeded();
    await far.hover();
    await far.locator('.pk-metre-pin').click();
    await tab.evaluate(() => { document.querySelector('.chat-thread').scrollTop = 0; });
    await tab.waitForTimeout(400);
    await tab.locator('.pk-metre-pins__toggle').click();
    await tab.locator('.pk-metre-pins__go').click();
    let last = -1;
    for (let i = 0; i < 30; i++) { await tab.waitForTimeout(100); const now = await tab.evaluate(() => document.querySelector('.chat-thread').scrollTop); if (now === last) break; last = now; }
    await tab.waitForTimeout(300);
    const seen = await far.evaluate((g) => { const v = g.closest('.chat-thread').getBoundingClientRect(), r = g.getBoundingClientRect(); return {top: Math.round(r.top - v.top), bottom: Math.round(r.bottom - v.top), view: Math.round(v.height), scroll: Math.round(g.closest('.chat-thread').scrollTop)}; });
    t.diagnostic('跳转后 ' + JSON.stringify(seen));
    assert.ok(seen.scroll > 0, `滚动了（scrollTop ${seen.scroll}）`);
    assert.ok(seen.top >= 0 && seen.top < seen.view, `跳过去的那条在视口里（相对视口 top ${seen.top}，视口高 ${seen.view}）`);
    assert.equal(await tab.evaluate((k) => JSON.parse(localStorage.getItem(k)).length, KEY), 1);
  } finally { await browser.close(); }
});
