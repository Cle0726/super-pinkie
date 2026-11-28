// B121：Windows 中文输入法（微软拼音）在侧栏「搜索当前模式的会话」弹层里组字：组字过程中 input 事件照样触发搜索、
// 结果先出来；按 Enter 上屏那一下不能把选中的第一条打开（误跳转到别的会话）。
// WebView2 / Chromium：keydown（isComposing=true、keyCode 229）先到、compositionend 随后；
// WebKit：compositionend 先到、随后的 keydown 是 isComposing=false + keyCode 229。两种顺序都要拦住。
// Playwright 没有 IME 接口：真浏览器加载真的 laolao-session-list.js，网关用桩，按两种顺序派发合成事件。
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = fs.readFileSync(path.join(root, 'ui/injections/laolao-session-list.js'), 'utf8');
const GUARD = `event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && event.target === input && items.length`;
const BROKEN = `event.key === 'Enter' && event.target === input && items.length`;
const HIT = {key: 'agent:metre:dashboard:s1', title: '周报草稿', snippet: '本周周报', updatedAt: Date.now()};

const SETUP = `
const qa = window.qa = {navigated: [], searches: []};
qa.api = {mode: 'chat', agentId: 'metre', currentKey: 'agent:metre:current', state: {pins: [], collapsed: {__recent: true}, projects: {}, projectFolders: {}},
  gwRequest: async (method, params) => {
    if (method === 'sessions.list') return {sessions: []};
    if (method === 'pinkie.session.search') { qa.searches.push(params.query); return {ok: true, results: [${JSON.stringify(HIT)}]}; }
    return {rows: {}};
  },
  navigateSession: (key) => { qa.navigated.push(key); },
  toast() {},
};
window.PinkieSessionList.render(document.querySelector('#sidebar'), qa.api);
const input = () => document.querySelector('.pinkie-session-search-input');
const key = (init) => {
  const ev = new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true, ...init});
  if (ev.keyCode !== init.keyCode) Object.defineProperty(ev, 'keyCode', {get: () => init.keyCode});
  return ev;
};
qa.compose = (steps) => {
  const el = input(); el.focus();
  el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, data: ''}));
  for (const s of steps) {
    el.dispatchEvent(new CompositionEvent('compositionupdate', {bubbles: true, data: s}));
    el.value = s;
    el.dispatchEvent(new InputEvent('input', {bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: s}));
  }
};
qa.commit = (order, data) => {
  const el = input();
  const end = () => el.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data}));
  const down = key(order === 'webkit' ? {isComposing: false, keyCode: 229} : {isComposing: true, keyCode: 229});
  if (order === 'webkit') { end(); el.dispatchEvent(down); } else { el.dispatchEvent(down); end(); }
  return {keyCode: down.keyCode};
};
qa.enter = () => input().dispatchEvent(key({keyCode: 13}));
qa.look = () => ({open: Boolean(input()), navigated: qa.navigated.slice(),
  results: document.querySelectorAll('.pinkie-session-search-result').length});
`;

async function open(browser, source = LIST) {
  const tab = await browser.newPage();
  tab.setDefaultTimeout(5000);
  await tab.route('http://127.0.0.1:30123/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"></head><body><section id="sidebar"></section></body></html>'}));
  await tab.goto('http://127.0.0.1:30123/chat');
  await tab.addScriptTag({content: source});
  await tab.addScriptTag({content: SETUP});
  await tab.getByRole('button', {name: '搜索当前模式的会话', exact: true}).click();
  await tab.waitForSelector('.pinkie-session-search-input');
  return tab;
}
const look = (tab) => tab.evaluate(() => window.qa.look());

async function composeCommit(tab, order) {
  // 组字到候选「周报」，等搜索结果出来（组字中的 input 也会触发搜索），再按 Enter 上屏。
  await tab.evaluate(() => window.qa.compose(['z', 'zhou', '周报']));
  await tab.waitForSelector('.pinkie-session-search-result');
  const down = await tab.evaluate((o) => window.qa.commit(o, '周报'), order);
  await tab.waitForTimeout(80);
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

test('B121 前提：会话搜索弹层的 Enter 打开结果守卫认 isComposing / 229（同一行，不加行）', () => {
  assert.ok(LIST.includes(GUARD), GUARD);
  assert.ok(!LIST.includes(BROKEN));
});

test('B121 真浏览器：会话搜索组字按 Enter 上屏不打开结果、弹层还在；上屏后再按 Enter 才打开选中那条', {timeout: 60_000}, async (t) => {
  await withBrowser(t, async (browser) => {
    for (const order of ['chromium', 'webkit']) {
      const tab = await open(browser);
      const tag = `${engine} / ${order} 顺序`;
      const {down, after} = await composeCommit(tab, order);
      assert.equal(down.keyCode, 229, tag + '：合成 keydown 的 keyCode 要是 229');
      assert.deepEqual(after, {open: true, navigated: [], results: 1}, tag + '：上屏这一下不跳转、弹层不关');
      await tab.evaluate(() => window.qa.enter());
      await tab.waitForFunction(() => window.qa.navigated.length > 0);
      assert.deepEqual(await look(tab), {open: false, navigated: [HIT.key], results: 0}, tag + '：上屏后再按 Enter 打开选中那条');
      await tab.close();
    }
  });
});

test('B121 反例：去掉会话搜索的 isComposing / 229 守卫，组字上屏那一下就跳到第一条结果（两种顺序都抓得住）', {timeout: 60_000}, async (t) => {
  const broken = LIST.replace(GUARD, BROKEN);
  assert.notEqual(broken, LIST);
  await withBrowser(t, async (browser) => {
    for (const order of ['chromium', 'webkit']) {
      const tab = await open(browser, broken);
      const {after} = await composeCommit(tab, order);
      assert.deepEqual(after.navigated, [HIT.key], `${engine} / ${order}：守卫去掉后上屏这一下就跳转了`);
      await tab.close();
    }
  });
});
