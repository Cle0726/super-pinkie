// 引擎菜单的模型子菜单最底下「用谁的模型」那一行（ui/injections/laolao-metre-engine-upstream.js，用户 11-25：「对其他的也可以，比如 Codex」）。
// 能切的几家：一行「改用碧琪模型」，点了进那一家「碧琪模型」那一行的模型列表；「碧琪模型」那一行反过来「改回我自己的账号」；
// 不能切的几家：灰掉（aria-disabled）、写原因，点了不动。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = name => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const js = read('laolao-metre-engine.js');
const upstreamJs = read('laolao-metre-engine-upstream.js');
const css = read('laolao-metre-engine.css');

test('the upstream row is its own file, loaded right after the engine file, and adds no globals', () => {
  const head = read('laolao-head.fragment.html');
  const at = name => head.indexOf(`<script defer src="/${name}?v=@hash"></script>`);
  assert.ok(at('laolao-metre-engine.js') > 0 && at('laolao-metre-engine-upstream.js') > at('laolao-metre-engine.js'));
  const metre = JSON.parse(read('regions.json')).regions.find(region => region.files.includes('laolao-metre-engine.js'));
  assert.ok(metre.files.includes('laolao-metre-engine-upstream.js'), 'same region as the engine file');
  assert.doesNotMatch(upstreamJs, /window\.__|globalThis/, 'no new global names');
  assert.doesNotMatch(upstreamJs.split('\n').filter(line => !/^\s*(?:\/\/|\/?\*)/.test(line)).join('\n'), /T3|t3\.codes/i);
});

async function openPage(t, {withUpstream = true} = {}) {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return null; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return null; }
  const tab = await browser.newPage();
  const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body>
    <div class="chat-main" style="position:relative;width:900px;height:700px"><div class="chat-thread">native</div>
    <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
  await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
  await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Au');
  await tab.evaluate(() => {
    const row = (id, driver, name, extra = {}) => ({id, driver, name, state: 'ready', text: '', enabled: true, installed: true, signedIn: true, upstream: 'own',
      quota: {state: 'unknown'}, models: [{slug: id + '/m1', name: name + ' Model', isDefault: true}], setup: {canInstall: false, canAuthenticate: false},
      guide: {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: false, managedSignin: false}, ...extra});
    const engines = [
      row('claudeAgent', 'claudeAgent', 'Claude Code', {switchable: {to: 'claudeAgent-pinkie'}}),
      row('claudeAgent-pinkie', 'claudeAgent', 'Claude Code · 碧琪模型', {upstream: 'pinkie', switchable: {to: 'claudeAgent-pinkie'}, models: [{slug: 'pinkie/gw/top', name: 'Top', isDefault: true}]}),
      row('antigravity', 'antigravity', 'Antigravity', {switchable: {why: '只能用 Google 账号或 Gemini 的 API 密钥，没有换上游的口子'}}),
      row('kiro', 'kiro', 'Kiro'),
    ];
    window.calls = [];
    window.__laolaoToast = () => {};
    window.__laolaoSidebar = {gwRequest: async (method, params) => {
      window.calls.push([method, params]);
      if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}};
      if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels: [], engines};
      if (method === 'pinkie.engines.choose') return {sessionKey: params.sessionKey, pref: {engine: params.engine, model: params.model}, summary: null, error: '', service: {running: true}};
      return {};
    }};
  });
  await tab.addScriptTag({content: js});
  if (withUpstream) await tab.addScriptTag({content: upstreamJs});
  const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip');
  await chip.waitFor({timeout: 10_000});
  const sub = () => tab.locator('.pk-eng-menu__sub').textContent();
  const engineItem = name => tab.locator('.pk-eng-menu__item').filter({has: tab.locator('.pk-eng-menu__name', {hasText: new RegExp(`^${name}$`)})});
  const models = async name => {
    if (!await tab.locator('.pk-eng-menu').count()) await chip.click();
    else await tab.getByRole('button', {name: '‹ 换引擎'}).click();
    await tab.locator('.pk-eng-menu__group').first().waitFor();
    await engineItem(name).click();
    await tab.locator('.pk-eng-menu__back').waitFor();
  };
  return {browser, tab, sub, models, upstream: () => tab.locator('.pk-eng-menu__item--upstream')};
}

test('in a browser: engines that can switch offer Pinkie\'s models, the Pinkie row offers the way back, the rest are greyed out with the reason', {timeout: 60_000}, async t => {
  const ctx = await openPage(t);
  if (!ctx) return;
  const {browser, tab, sub, models, upstream} = ctx;
  try {
    // 能切：一行「改用碧琪模型」，点了进「Claude Code · 碧琪模型」那一行的模型列表，不直接改这段对话的选择。
    await models('Claude Code');
    assert.equal(await sub(), 'Claude Code 用哪个模型');
    assert.equal(await upstream().count(), 1);
    assert.equal(await upstream().locator('.pk-eng-menu__name').textContent(), '改用碧琪模型');
    assert.equal(await upstream().getAttribute('aria-disabled'), null);
    // 和上面的模型行分开：多留 4–6px，上面一道 1px 的线（uireview 11-26 02:31Z）。
    const apart = await upstream().evaluate(node => { const after = getComputedStyle(node, '::after'); return {gap: parseFloat(getComputedStyle(node).marginTop), line: after.borderTopWidth, style: after.borderTopStyle}; });
    assert.ok(apart.gap >= 4 && apart.gap <= 6, `gap above the row is ${apart.gap}px`);
    assert.deepEqual([apart.line, apart.style], ['1px', 'solid']);
    // 分隔线比菜单标题下那道深一档（协调者 11-25 20:14）
    const rules = await upstream().evaluate(node => [getComputedStyle(node, '::after').borderTopColor, getComputedStyle(document.querySelector('.pk-eng-menu__head')).borderBottomColor]);
    assert.notEqual(rules[0], rules[1], `separator ${rules[0]} vs head rule ${rules[1]}`);
    await upstream().click();
    await tab.waitForFunction(() => document.querySelector('.pk-eng-menu__sub')?.textContent === 'Claude Code · 碧琪模型 用哪个模型');
    assert.deepEqual(await tab.locator('.pk-eng-menu__item .pk-eng-menu__note').first().textContent(), 'pinkie/gw/top · 默认');
    assert.equal(await tab.evaluate(() => window.calls.some(([m]) => m === 'pinkie.engines.choose')), false, 'opening the list does not switch yet');

    // 「碧琪模型」那一行：反过来「改回我自己的账号」。
    assert.equal(await upstream().locator('.pk-eng-menu__name').textContent(), '改回我自己的账号');
    await upstream().click();
    await tab.waitForFunction(() => document.querySelector('.pk-eng-menu__sub')?.textContent === 'Claude Code 用哪个模型');

    // 不能切：灰掉、写原因、点了不动（反例：没有跳到别的列表、没有改选择）。
    await models('Antigravity');
    assert.equal(await upstream().count(), 1);
    assert.equal(await upstream().getAttribute('aria-disabled'), 'true');
    assert.match(await upstream().getAttribute('class'), /pk-eng-menu__item--dim/);
    assert.equal(await upstream().locator('.pk-eng-menu__note').textContent(), '用不了：只能用 Google 账号或 Gemini 的 API 密钥，没有换上游的口子');
    // 「API 密钥」不拆两行（协调者 11-25 20:14）：在同一个不换行的段里，只占一行
    const keep = await upstream().evaluate(node => { const s = [...node.querySelectorAll('.pk-eng-menu__note span')].find(x => x.textContent === 'API 密钥'); return s ? {ws: getComputedStyle(s).whiteSpace, lines: s.getClientRects().length} : null; });
    assert.deepEqual(keep, {ws: 'nowrap', lines: 1});
    await upstream().evaluate(node => node.click());
    await tab.waitForTimeout(300);
    assert.equal(await sub(), 'Antigravity 用哪个模型');
    assert.equal(await tab.evaluate(() => window.calls.some(([m]) => m === 'pinkie.engines.choose')), false);

    // 反例：老版本的引擎清单没有 switchable，就不画这一行，不瞎猜。
    await models('Kiro');
    assert.equal(await upstream().count(), 0);
    assert.equal(/T3/i.test(await tab.locator('.pk-eng-menu').innerText()), false);
  } finally { await browser.close(); }
});

// #127：macOS WebKit 的 Tab 不停在 button 上，Option+Tab 才停；Chromium 的 Tab 就停。两种都按一遍。
test('in a browser: keyboard focus walks past the greyed-out row but still reaches a row that can switch', {timeout: 60_000}, async t => {
  const ctx = await openPage(t);
  if (!ctx) return;
  const {browser, tab, models, upstream} = ctx;
  const keys = (process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium') === 'webkit' ? ['Alt+Tab', 'Tab'] : ['Tab'];
  const walk = async key => {
    await tab.locator('.pk-eng-menu__back').focus();
    const seen = [];
    for (let i = 0; i < 6; i++) {
      await tab.keyboard.press(key);
      seen.push(await tab.evaluate(() => { const a = document.activeElement; return a?.closest('.pk-eng-menu') ? (a.className + '|' + (a.querySelector('.pk-eng-menu__name')?.textContent || a.textContent)) : 'outside'; }));
    }
    return seen;
  };
  try {
    await models('Antigravity');
    assert.equal(await upstream().getAttribute('aria-disabled'), 'true');
    for (const key of keys) {
      const seen = await walk(key);
      assert.ok(!seen.some(s => /pk-eng-menu__item--dim/.test(s)), `${key} landed on the greyed-out row: ${seen.join(' > ')}`);
    }
    // 反例：能切的那一行照样键盘够得着，不是把整行都拿出了 Tab 序列。
    await models('Claude Code');
    assert.equal(await upstream().getAttribute('aria-disabled'), null);
    const reach = await walk(keys[0]);
    assert.ok(reach.some(s => s.includes('pk-eng-menu__item--upstream') && s.endsWith('|改用碧琪模型')), `${keys[0]} never reached the switch row: ${reach.join(' > ')}`);
  } finally { await browser.close(); }
});

test('in a browser: without the upstream file the model list is exactly as before (the engine file draws no such row itself)', {timeout: 40_000}, async t => {
  const ctx = await openPage(t, {withUpstream: false});
  if (!ctx) return;
  const {browser, tab, models, upstream} = ctx;
  try {
    await models('Claude Code');
    assert.equal(await upstream().count(), 0);
    assert.deepEqual(await tab.locator('.pk-eng-menu__item .pk-eng-menu__name').allTextContents(), ['Claude Code Model']);
  } finally { await browser.close(); }
});
