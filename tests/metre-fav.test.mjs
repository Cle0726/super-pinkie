// 界面线 5 第二批 U4：Metre 引擎菜单「用哪个模型」的收藏星标（laolao-metre-fav.js / .css），真浏览器里跑。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const KEY = 'pinkie:metre:fav-models:v1';

// 和 laolao-metre-engine.js 选模型那一步画出来的结构一样：副标题「<引擎> 用哪个模型」，「‹ 换引擎」后面一行一个 menuitemradio。
const menuHtml = (engineName, models) => `<div class="pk-eng-menu" role="menu"><div class="pk-eng-menu__head"><span class="pk-eng-menu__title">Engine</span><span class="pk-eng-menu__sub">${engineName} 用哪个模型</span></div><div class="pk-eng-menu__body"><button class="pk-eng-menu__back">‹ 换引擎</button>${models.map(([name, slug, extra = '']) => `<button class="pk-eng-menu__item" role="menuitemradio" aria-checked="false"><span class="pk-eng-menu__name">${name}</span><span class="pk-eng-menu__note">${slug}${extra}</span></button>`).join('')}</div></div>`;
const MODELS = [['Opus', 'opus', ' · 默认'], ['Sonnet', 'sonnet'], ['Haiku', 'haiku'], ['Fable', 'fable', ' · 额度用完了，明天 08:00 恢复']];

async function setup(page, mode, favs) {
  // about:blank 没有 localStorage：挂一个假的 http 源。
  await page.unroute('http://pinkie.test/**');
  await page.route('http://pinkie.test/**', (r) => r.fulfill({contentType: 'text/html', body: `<!doctype html><html data-laolao-mode="${mode}"><head></head><body></body></html>`}));
  await page.goto('http://pinkie.test/');
  await page.evaluate(([key, list]) => { localStorage.clear(); if (list) localStorage.setItem(key, JSON.stringify(list)); }, [KEY, favs]);
  await page.addStyleTag({path: inj('laolao-metre-engine.css')});
  await page.addStyleTag({path: inj('laolao-metre-fav.css')});
  await page.addScriptTag({path: inj('laolao-dom-watch.js')});
  await page.addScriptTag({path: inj('laolao-metre-fav.js')});
}
async function openMenu(page, engineName = 'Claude Code') {
  await page.evaluate(([html]) => {
    document.querySelector('.pk-eng-menu')?.remove();
    window.picked = [];
    document.body.insertAdjacentHTML('beforeend', html);
    document.querySelectorAll('.pk-eng-menu__item').forEach((b) => b.addEventListener('click', () => window.picked.push(b.querySelector('.pk-eng-menu__note').textContent.split(' · ')[0])));
  }, [menuHtml(engineName, MODELS)]);
  // decorate() wraps every row and reorders in one pass, so once all rows are wrapped the order is final.
  // A fixed 150ms was sometimes too short on CI WebKit, which then read the unsorted order.
  if (await page.evaluate(() => document.documentElement.dataset.laolaoMode === 'metre')) {
    await page.waitForFunction((n) => document.querySelectorAll('.pk-eng-menu__body > .pk-fav-row').length === n, MODELS.length, {timeout: 5_000});
  } else {
    await page.waitForTimeout(150);
  }
}
const order = (page) => page.$$eval('.pk-eng-menu__body .pk-eng-menu__name', (n) => n.map((e) => e.textContent));

test(`Metre fav: favourites first when the menu opens, toggling does not reorder, star does not pick the model (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}});
    await setup(page, 'metre', ['Claude Code/haiku', 'Codex/sonnet']);
    await openMenu(page);
    assert.deepEqual(await order(page), ['Haiku', 'Opus', 'Sonnet', 'Fable'], '同一引擎的收藏排最前，别的引擎的收藏不算，其余保持原顺序');
    assert.equal(await page.locator('.pk-eng-menu__body > :first-child').innerText(), '‹ 换引擎', '「‹ 换引擎」仍在最上面');
    assert.equal(await page.locator('.pk-fav-row').count(), 4);
    assert.equal(await page.locator('.pk-fav-star[aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('.pk-fav-star').first().getAttribute('aria-label'), '取消收藏 Haiku');

    // 点 Sonnet 的星：只改星标和存储，不选模型、不重排。
    await page.locator('.pk-fav-row', {hasText: 'Sonnet'}).locator('.pk-fav-star').click();
    assert.deepEqual(await page.evaluate(() => window.picked), [], '点星标不选中模型');
    assert.deepEqual(await order(page), ['Haiku', 'Opus', 'Sonnet', 'Fable'], '切换星标时不当场重排');
    assert.equal(await page.locator('.pk-fav-row', {hasText: 'Sonnet'}).locator('.pk-fav-star').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY), ['Claude Code/sonnet', 'Claude Code/haiku', 'Codex/sonnet']);

    // 键盘：Tab 到 Fable 的星标，空格收藏。
    await page.locator('.pk-fav-row', {hasText: 'Fable'}).locator('.pk-fav-star').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.pk-fav-row', {hasText: 'Fable'}).locator('.pk-fav-star').getAttribute('aria-label'), '取消收藏 Fable');
    assert.deepEqual(await page.evaluate(() => window.picked), []);

    // 点行本身照样选模型。
    await page.locator('.pk-eng-menu__item', {hasText: 'Opus'}).click();
    assert.deepEqual(await page.evaluate(() => window.picked), ['opus']);

    // 重开菜单：按新收藏排（收藏之间保持原顺序）。
    await openMenu(page);
    assert.deepEqual(await order(page), ['Sonnet', 'Haiku', 'Fable', 'Opus']);

    // 共用观察器多次触发也不重复包：改一下副标题文字再等一帧。
    await page.evaluate(() => { document.querySelector('.pk-eng-menu__head').dataset.x = '1'; document.querySelector('.pk-eng-menu__body').append(document.createComment('poke')); });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.pk-fav-star').count(), 4, '每行只有一个星标');
    assert.equal(await page.locator('.pk-fav-row .pk-fav-row').count(), 0, '没有套两层');

    // 星标在行右侧、不压住模型名；行内说明文字不被截掉。
    const geo = await page.evaluate(() => [...document.querySelectorAll('.pk-fav-row')].map((r) => {
      const item = r.querySelector('.pk-eng-menu__item').getBoundingClientRect(), star = r.querySelector('.pk-fav-star').getBoundingClientRect();
      return {gap: star.left - item.right, h: star.height, w: star.width};
    }));
    for (const g of geo) { assert.ok(g.gap >= 0, '星标不压住行'); assert.equal(Math.round(g.w), 28); }
  } finally { await browser.close(); }
});

test(`Metre fav: other modes and other menu steps are left alone (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await setup(page, 'pinkie', ['Claude Code/haiku']);
    await openMenu(page);
    assert.equal(await page.locator('.pk-fav-star').count(), 0, '不是 Metre 不加星标');
    assert.deepEqual(await order(page), ['Opus', 'Sonnet', 'Haiku', 'Fable'], '不是 Metre 不重排');

    await setup(page, 'metre', null);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="pk-eng-menu"><div class="pk-eng-menu__head"><span class="pk-eng-menu__sub">这段对话交给谁来做</span></div><div class="pk-eng-menu__body"><button class="pk-eng-menu__item pk-eng-menu__item--row" role="menuitemradio"><span class="pk-eng-menu__name">Claude Code</span><span class="pk-eng-menu__note">已登录</span></button></div></div>'));
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.pk-fav-star').count(), 0, '选引擎那一步不加星标');

    // 存储坏了也不抛错。
    await page.evaluate((k) => localStorage.setItem(k, '{oops'), KEY);
    assert.deepEqual(await page.evaluate(() => window.Pinkie.metre.fav.read()), []);
  } finally { await browser.close(); }
});

// 原生模型选择器（laolao-model-picker.js 画的 [data-pinkie-picker-surface]）：行是宿主的按键，只在菜单底部加「收藏当前模型」。
const pickerHtml = (selected) => `<details class="chat-controls__model" open><summary>模型</summary><div class="chat-controls__model-menu" data-pinkie-picker-surface="1"><div class="chat-controls__model-options">${
  [['route-a/opus', 'Opus'], ['route-b/gpt-5', 'GPT-5'], ['route-c/a-very-long-model-name-that-keeps-going-and-going', 'A Very Long Model Name That Keeps Going And Going']]
    .map(([v, n]) => `<button type="button" data-chat-model-option="${v}" aria-selected="${v === selected}"><span class="chat-controls__model-option-name">${n}</span></button>`).join('')}</div></div></details>`;

test(`Metre fav: native picker gets one "favourite current model" toggle that feeds pickerFavs (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 820, height: 720}});
    await setup(page, 'metre', ['Claude Code/haiku']);
    await page.evaluate((html) => { document.body.insertAdjacentHTML('beforeend', html); window.picked = 0; document.querySelector('details').addEventListener('toggle', () => { window.picked += 1; }); }, pickerHtml('route-b/gpt-5'));
    await page.waitForTimeout(150);
    const toggle = page.locator('[data-pinkie-picker-surface] > .pk-fav-current');
    assert.equal(await toggle.count(), 1);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await toggle.innerText(), '☆ 收藏当前模型 GPT-5');
    const routes = ['route-a/opus', 'route-b/gpt-5', 'route-c/x'];
    assert.deepEqual(await page.evaluate((v) => window.Pinkie.metre.fav.pickerFavs(v), routes), [], '引擎菜单的收藏不算进原生选择器');

    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await toggle.innerText(), '★ 已收藏 GPT-5');
    assert.equal(await page.evaluate(() => document.querySelector('details').open), true, '点它不关菜单');
    assert.deepEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY), ['picker:route-b/gpt-5', 'Claude Code/haiku']);
    assert.deepEqual(await page.evaluate((v) => window.Pinkie.metre.fav.pickerFavs(v), routes), ['route-b/gpt-5']);
    assert.deepEqual(await page.evaluate(() => window.Pinkie.metre.fav.pickerFavs(['route-a/opus'])), [], '目录里没有的路由不返回');

    // 换了当前模型：键跟着换，状态按新模型算；键盘空格切换。
    await page.evaluate(() => { document.querySelector('[aria-selected="true"]').setAttribute('aria-selected', 'false'); document.querySelector('[data-chat-model-option^="route-c"]').setAttribute('aria-selected', 'true'); });
    await page.waitForTimeout(150);
    assert.equal(await toggle.count(), 1, '观察器多次触发也只有一个键');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await toggle.focus(); await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    const box = await toggle.evaluate((b) => ({sw: b.scrollWidth, cw: b.clientWidth, ov: getComputedStyle(b).textOverflow, w: b.getBoundingClientRect().width, pw: b.parentElement.getBoundingClientRect().width}));
    assert.equal(box.ov, 'ellipsis', '长模型名省略号截断，不撑宽菜单');
    assert.ok(box.w <= box.pw + 0.5, '键不超出菜单');

    // 不是 Metre：不加键，pickerFavs 返回空（原生选择器顺序不变）。
    await setup(page, 'pinkie', ['picker:route-b/gpt-5']);
    await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), pickerHtml('route-b/gpt-5'));
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.pk-fav-current').count(), 0);
    assert.deepEqual(await page.evaluate((v) => window.Pinkie.metre.fav.pickerFavs(v), routes), []);
  } finally { await browser.close(); }
});

// 真页面的样子（mac1 任务 19 抓到的两条）：宿主 Lit 行藏在前面、选中态停在最初的模型，标题类名是 -title；
// laolao-model-picker.js 的 .pinkie-fallback-catalog 才是可见目录，展示名直接写在按键文字里。
const realPickerHtml = (hostSelected, shownSelected) => `<details class="chat-controls__model" open><summary>模型</summary><div class="chat-controls__model-menu" data-pinkie-picker-surface="1"><div class="chat-controls__model-options" hidden>${
  [['google/gemini-3-flash', 'Gemini 3 Flash'], ['openai/gpt-5.2', 'GPT-5.2']]
    .map(([v, n]) => `<button type="button" class="chat-controls__inline-select-option" data-chat-model-option="${v}" aria-selected="${v === hostSelected}"><span class="chat-controls__model-option-title">${n}</span></button>`).join('')
}</div><div class="pinkie-fallback-catalog">${
  [['google/gemini-3-flash', 'Gemini 3 Flash'], ['openai/gpt-5.2', 'GPT-5.2']]
    .map(([v, n]) => `<button type="button" class="chat-controls__combined-model-option pinkie-fallback-option" data-chat-model-option="${v}" aria-selected="${v === shownSelected}">${n}</button>`).join('')
}</div></div></details>`;

test(`Metre fav: on the real picker the toggle follows the visible catalog and shows the display name (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 820, height: 720}});
    await setup(page, 'metre', []);
    await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), realPickerHtml('google/gemini-3-flash', 'google/gemini-3-flash'));
    await page.waitForTimeout(150);
    const toggle = page.locator('[data-pinkie-picker-surface] > .pk-fav-current');
    assert.equal(await toggle.innerText(), '☆ 收藏当前模型 Gemini 3 Flash', '显示展示名，不是路由串');

    // 在可见目录里换成 GPT-5.2；藏着的宿主行仍停在 Gemini。
    await page.evaluate(() => {
      const c = document.querySelector('.pinkie-fallback-catalog');
      c.querySelector('[data-chat-model-option="google/gemini-3-flash"]').setAttribute('aria-selected', 'false');
      c.querySelector('[data-chat-model-option="openai/gpt-5.2"]').setAttribute('aria-selected', 'true');
    });
    await page.waitForTimeout(150);
    assert.equal(await toggle.innerText(), '☆ 收藏当前模型 GPT-5.2', '跟着可见目录换，不卡在藏着的旧行上');
    await toggle.click();
    assert.deepEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY), ['picker:openai/gpt-5.2'], '收的是现在选中的模型');
    assert.equal(await toggle.innerText(), '★ 已收藏 GPT-5.2');
  } finally { await browser.close(); }
});

test('Metre fav: no new observer, timer or window.__ global; loaded right after the engine script', () => {
  const js = fs.readFileSync(inj('laolao-metre-fav.js'), 'utf8');
  assert.doesNotMatch(js, /new MutationObserver|setInterval|window\.__/);
  assert.match(js, /window\.Pinkie\?\.domWatch\?\.watch/);
  const head = fs.readFileSync(inj('laolao-head.fragment.html'), 'utf8');
  assert.match(head, /laolao-metre-engine\.js\?v=@hash"><\/script>\n<link rel="stylesheet" href="\/laolao-metre-fav\.css\?v=@hash">\n<script defer src="\/laolao-metre-fav\.js\?v=@hash"><\/script>/);
});
