// B121：Windows 中文输入法（微软拼音）组字时按 Enter 上屏，设置页「浏览器网络 → 代理地址」不能把这一下当成「保存」。
// 真窗口实测（B121 探针，WebView2 + 微软拼音，11-28）：上屏那一下 keydown 是 key="Process"、keyCode 229、isComposing=true，
// 不是 key="Enter"，所以 Windows 上本来就不误触；下面 windows 顺序锁住这个真实形状。守卫防的是 key=Enter 也带组字标记的情况：
// Chromium 合成顺序是 keydown（isComposing=true、keyCode 229）先到、compositionend 随后；
// WebKit 是 compositionend 先到、随后的 keydown 是 isComposing=false + keyCode 229。两种顺序都要拦住。
// Playwright 没有 IME 接口：这里在真浏览器里加载真的 laolao-settings-user.js，按两种顺序派发合成事件，
// pywebview.api 用桩记下 browser_proxy_set 被调了几次。
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = fs.readFileSync(path.join(root, 'ui/injections/laolao-settings-user.js'), 'utf8');
const GUARD = 'if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) save("custom");';
const BROKEN = 'if (event.key === "Enter") save("custom");';

const STUB = `
window.b121 = {sets: []};
window.pywebview = {api: {
  browser_proxy_get: async () => ({ok: true, mode: 'custom', server: '', effective: ''}),
  browser_proxy_set: async (arg) => { window.b121.sets.push(arg); return {ok: true, mode: 'custom', server: arg.server, message: '已保存。'}; },
}};
`;
const HELPER = `
const input = () => document.querySelector('input[aria-label="代理地址"]');
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
  const down = key(order === 'windows' ? {key: 'Process', isComposing: true, keyCode: 229}
    : order === 'webkit' ? {isComposing: false, keyCode: 229} : {isComposing: true, keyCode: 229});
  if (order === 'webkit') { end(); el.dispatchEvent(down); } else { el.dispatchEvent(down); end(); }
  return {keyCode: down.keyCode, isComposing: down.isComposing};
};
window.b121.enter = () => input().dispatchEvent(key({keyCode: 13}));
window.b121.look = () => ({value: input()?.value ?? null, sets: window.b121.sets.length});
`;
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

async function open(browser, source = SETTINGS) {
  const tab = await browser.newPage();
  tab.setDefaultTimeout(5000);
  await tab.route('http://127.0.0.1:30121/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8', body: PAGE}));
  await tab.goto('http://127.0.0.1:30121/settings');
  for (const content of [STUB, source, HELPER]) await tab.addScriptTag({content});
  await tab.waitForFunction(() => Boolean(document.querySelector('input[aria-label="代理地址"]')));
  return tab;
}
const look = (tab) => tab.evaluate(() => window.b121.look());
const settle = (tab) => tab.waitForTimeout(80);

async function composeCommit(tab, order) {
  await tab.evaluate(() => window.b121.compose(['d', 'daili', '代理']));
  await settle(tab);
  const down = await tab.evaluate((o) => window.b121.commit(o, '代理'), order);
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

test('B121 前提：代理地址框的 Enter 守卫认 isComposing / 229（同一行，不加行）', () => {
  assert.ok(SETTINGS.includes(GUARD), GUARD);
  assert.ok(!SETTINGS.includes(BROKEN));
});

test('B121 真浏览器：代理地址框组字按 Enter 上屏不保存；上屏后再按 Enter 才保存一次', {timeout: 60_000}, async (t) => {
  await withBrowser(t, async (browser) => {
    for (const order of ['windows', 'chromium', 'webkit']) {
      const tab = await open(browser);
      const tag = `${engine} / ${order} 顺序`;
      const {down, after} = await composeCommit(tab, order);
      assert.equal(down.keyCode, 229, tag + '：合成 keydown 的 keyCode 要是 229');
      assert.deepEqual(after, {value: '代理', sets: 0}, tag + '：上屏这一下不保存');
      await tab.evaluate(() => window.b121.enter());
      await tab.waitForFunction(() => window.b121.sets.length > 0);
      await settle(tab);
      const saved = await tab.evaluate(() => window.b121.sets);
      assert.deepEqual(saved, [{mode: 'custom', server: '代理'}], tag + '：上屏后再按 Enter 保存一次');
      await tab.close();
    }
  });
});

test('B121 反例：去掉代理地址框的 isComposing / 229 守卫，组字上屏那一下就会被当成保存（两种顺序都抓得住）', {timeout: 60_000}, async (t) => {
  const broken = SETTINGS.replace(GUARD, BROKEN);
  assert.notEqual(broken, SETTINGS);
  await withBrowser(t, async (browser) => {
    for (const order of ['chromium', 'webkit']) {
      const tab = await open(browser, broken);
      await composeCommit(tab, order);
      await tab.waitForFunction(() => window.b121.sets.length > 0);
      assert.equal((await look(tab)).sets, 1, `${engine} / ${order}：守卫去掉后上屏这一下就保存了`);
      await tab.close();
    }
  });
});
