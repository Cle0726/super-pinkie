// B121：Windows 中文输入法（微软拼音）组字时按 Enter 上屏，设置页「模型服务 → 添加服务商 → 列表里没有？手动填模型名，回车添加」
// 不能把这一下当成「添加」。WebView2 / Chromium：keydown（isComposing=true、keyCode 229）先到、compositionend 随后；
// WebKit：compositionend 先到、随后的 keydown 是 isComposing=false + keyCode 229。两种顺序都要拦住。
// Playwright 没有 IME 接口：真浏览器加载真的 laolao-model-setup.js，网关用桩，按两种顺序派发合成事件，数模型行。
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETUP = fs.readFileSync(path.join(root, 'ui/injections/laolao-model-setup.js'), 'utf8');
const GUARD = 'if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || !manual.value.trim()) return;';
const BROKEN = 'if (event.key !== "Enter" || !manual.value.trim()) return;';

const STUB = `
window.__laolaoSidebar = {gwRequest: async (method) => {
  if (method === 'pinkie.modelSetup.presets') return {presets: [{id: 'custom', label: '自定义', region: 'custom', baseUrl: ''}]};
  if (method === 'pinkie.modelSetup.list') return {providers: [], needsSetup: false};
  if (method === 'pinkie.modelSetup.test') return {ok: true, message: '连上了。', models: [], recommended: []};
  return {ok: true};
}};
`;
const HELPER = `
window.b121 = {};
const input = () => document.querySelector('input[placeholder^="列表里没有"]');
const key = (init) => {
  const ev = new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true, ...init});
  if (ev.keyCode !== init.keyCode) Object.defineProperty(ev, 'keyCode', {get: () => init.keyCode});
  return ev;
};
window.b121.compose = (steps) => {
  const el = input(); el.focus();
  el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, data: ''}));
  for (const s of steps) {
    el.dispatchEvent(new CompositionEvent('compositionupdate', {bubbles: true, data: s}));
    el.value = s;
    el.dispatchEvent(new InputEvent('input', {bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: s}));
  }
};
window.b121.commit = (order, data) => {
  const el = input();
  const end = () => el.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data}));
  const down = key(order === 'webkit' ? {isComposing: false, keyCode: 229} : {isComposing: true, keyCode: 229});
  if (order === 'webkit') { end(); el.dispatchEvent(down); } else { el.dispatchEvent(down); end(); }
  return {keyCode: down.keyCode};
};
window.b121.enter = () => input().dispatchEvent(key({keyCode: 13}));
window.b121.look = () => ({models: [...document.querySelectorAll('.pinkie-model-setup__model-pick input[type=checkbox]')].map((c) => c.value), manual: Boolean(input())});
`;
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="host"></main></body></html>';

async function open(browser, source = SETUP) {
  const tab = await browser.newPage();
  tab.setDefaultTimeout(5000);
  await tab.route('http://127.0.0.1:30122/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8', body: PAGE}));
  await tab.goto('http://127.0.0.1:30122/settings');
  for (const content of [STUB, source, HELPER]) await tab.addScriptTag({content});
  await tab.evaluate(() => window.__pinkieModelSetup.mount(document.getElementById('host')));
  await tab.getByRole('button', {name: '＋ 添加服务商'}).click();
  await tab.locator('.pinkie-model-setup__preset').first().click();
  await tab.locator('input[type=password]').fill('sk-test');
  await tab.getByRole('button', {name: '测试连接'}).click();
  await tab.waitForSelector('input[placeholder^="列表里没有"]');
  return tab;
}
const look = (tab) => tab.evaluate(() => window.b121.look());
const settle = (tab) => tab.waitForTimeout(80);

async function composeCommit(tab, order) {
  await tab.evaluate(() => window.b121.compose(['t', 'tongyi', '通义']));
  await settle(tab);
  const down = await tab.evaluate((o) => window.b121.commit(o, '通义'), order);
  await settle(tab);
  return {down, after: await look(tab)};
}

// 整个文件只启动一次浏览器（同 B81）：冷启动放 before 里，不吃用例超时。
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
let browser = null, skipReason = '';
before(async () => {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { skipReason = 'Playwright is not installed here'; return; }
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { skipReason = 'no browser: ' + error.message.split('\n')[0]; return; }
  const warm = await open(browser);
  await warm.close();
}, {timeout: 180_000});
after(async () => { await browser?.close(); });

async function withBrowser(t, fn) {
  if (!browser) { t.skip(skipReason || 'no browser'); return; }
  await fn(browser);
}

test('B121 前提：手动填模型名框的 Enter 守卫认 isComposing / 229（同一行，不加行）', () => {
  assert.ok(SETUP.includes(GUARD), GUARD);
  assert.ok(!SETUP.includes(BROKEN));
});

test('B121 真浏览器：手动填模型名组字按 Enter 上屏不添加；上屏后再按 Enter 才添加一个', {timeout: 60_000}, async (t) => {
  await withBrowser(t, async (browser) => {
    for (const order of ['chromium', 'webkit']) {
      const tab = await open(browser);
      const tag = `${engine} / ${order} 顺序`;
      const {down, after} = await composeCommit(tab, order);
      assert.equal(down.keyCode, 229, tag + '：合成 keydown 的 keyCode 要是 229');
      assert.deepEqual(after, {models: [], manual: true}, tag + '：上屏这一下不添加模型');
      await tab.evaluate(() => window.b121.enter());
      await settle(tab);
      assert.deepEqual((await look(tab)).models, ['通义'], tag + '：上屏后再按 Enter 添加一个');
      await tab.close();
    }
  });
});

test('B121 反例：去掉手动填模型名框的 isComposing / 229 守卫，组字上屏那一下就会被当成添加（两种顺序都抓得住）', {timeout: 60_000}, async (t) => {
  const broken = SETUP.replace(GUARD, BROKEN);
  assert.notEqual(broken, SETUP);
  await withBrowser(t, async (browser) => {
    for (const order of ['chromium', 'webkit']) {
      const tab = await open(browser, broken);
      const {after} = await composeCommit(tab, order);
      assert.deepEqual(after.models, ['通义'], `${engine} / ${order}：守卫去掉后上屏这一下就添加了`);
      await tab.close();
    }
  });
});
