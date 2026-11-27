// B81（#426 补测）：macOS 中文输入法组字时按 Enter 上屏，@ 提及弹层不能被这一下选中，也不能把消息发出去。
// Safari / WebKit 的顺序是 compositionend 先到、随后的 keydown 是 isComposing=false + keyCode 229；
// Chromium 是 keydown 先到、isComposing=true。Playwright 没有 IME 接口，这里在真浏览器里按两种顺序派发合成事件，
// 加载真的 laolao-metre-prefs.js 和 laolao-session-tools.js，原生发送按 chat-page 快照的规则建模（组字或 229 不发）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const PREFS = read('ui/injections/laolao-metre-prefs.js');
const TOOLS = read('ui/injections/laolao-session-tools.js');
const PICK_GUARD = `(event.key === 'Enter' || event.key === 'Tab') && !event.isComposing && event.keyCode !== 229`;
const SEND_GUARD = `event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !sendingExpanded`;
const SESSION = 'agent:metre:dashboard:main';
const OTHER = {key: 'agent:metre:dashboard:s1', title: '周报草稿'};

const HELPER = `
window.b81 = {sent: 0, hooks: 0, handled: []};
window.__laolaoSidebar = {mode: 'metre', gwRequest: async (method) => {
  if (method === 'sessions.list') return {sessions: [{key: ${JSON.stringify(OTHER.key)}, label: ${JSON.stringify(OTHER.title)}, updatedAt: 2}]};
  if (method === 'pinkie.session.search') return {ok: true, results: [${JSON.stringify(OTHER)}]};
  if (method === 'pinkie.session.digest') return {ok: true, title: ${JSON.stringify(OTHER.title)}, excerpt: '本周进度'};
  if (method === 'pinkie.fs.status') return {bound: false};
  return {ok: false, error: 'stub'};
}};
document.querySelector('openclaw-chat-pane').state = {sessionKey: ${JSON.stringify(SESSION)}, chatAttachments: [], handleSendChat: async (text) => { window.b81.handled.push(text); }};
const ta = () => document.querySelector('textarea');
ta().addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.b81.sent += 1; }
});
const setValue = (value, composing) => {
  const t = ta(); t.value = value; t.setSelectionRange(value.length, value.length);
  t.dispatchEvent(new InputEvent('input', {bubbles: true, isComposing: composing, inputType: composing ? 'insertCompositionText' : 'insertText', data: value}));
};
const enter = (init) => {
  const ev = new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true, ...init});
  if (ev.keyCode !== init.keyCode) Object.defineProperty(ev, 'keyCode', {get: () => init.keyCode});
  return ev;
};
window.b81.compose = (steps) => {
  const t = ta(); t.focus();
  const base = t.value;
  t.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, data: ''}));
  for (const s of steps) { t.dispatchEvent(new CompositionEvent('compositionupdate', {bubbles: true, data: s})); setValue(base + s, true); }
};
window.b81.commit = (order, data) => {
  const t = ta();
  const end = () => t.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data}));
  const down = enter(order === 'webkit' ? {isComposing: false, keyCode: 229} : {isComposing: true, keyCode: 229});
  if (order === 'webkit') { end(); t.dispatchEvent(down); } else { t.dispatchEvent(down); end(); }
  return {keyCode: down.keyCode, isComposing: down.isComposing};
};
window.b81.look = () => ({value: ta().value, sent: window.b81.sent, hooks: window.b81.hooks, handled: window.b81.handled.length,
  popup: Boolean(document.querySelector('.pinkie-mention .pinkie-mention__item'))});
`;
// 碧琪共用 Enter 钩子（queue-steer / resume / immersion / companion）：从真文件里取守卫行原样装进页面，挂在 session-tools 之后，
// 守卫放行一次就 hooks + 1。修复前它们只看 isComposing，WebKit 上屏那一下（isComposing=false、229）会被当成发送。
const HOOK_FILES = ['laolao-queue-steer.js', 'laolao-resume.js', 'laolao-immersion.js', 'laolao-companion.js'];
const HOOK_RE = /document\.addEventListener\("keydown", \((e|event)\) => \{\n\s+(if \(\1\.key !== "Enter"[^\n]*\) return;)\n/;
const guards = (strip229) => HOOK_FILES.map((f) => {
  const m = read('ui/injections/' + f).match(HOOK_RE);
  assert.ok(m, f + ' 的 Enter 守卫行');
  return {f, arg: m[1], line: strip229 ? m[2].replace(` || ${m[1]}.keyCode === 229`, '') : m[2]};
});
const hookScript = (list) => 'const isRunning = () => false;\n' + list.map(({arg, line}) =>
  `document.addEventListener('keydown', (${arg}) => { ${line} window.b81.hooks += 1; }, true);`).join('\n');
const HOOK = hookScript(guards(false));
const PAGE = `<!doctype html><html data-laolao-mode="metre"><body><openclaw-chat-pane active><div class="agent-chat__input"><div class="agent-chat__composer-combobox"><textarea></textarea></div></div></openclaw-chat-pane></body></html>`;

async function open(browser, {sendKey, tools = TOOLS, hook = HOOK}) {
  const tab = await browser.newPage();
  await tab.route('http://127.0.0.1:30118/**', (route) => route.fulfill({contentType: 'text/html', body: PAGE}));
  await tab.goto('http://127.0.0.1:30118/chat?session=' + encodeURIComponent(SESSION));
  await tab.evaluate((v) => { v ? localStorage.setItem('pinkie.metre.prefs.sendKey', v) : localStorage.removeItem('pinkie.metre.prefs.sendKey'); }, sendKey);
  for (const content of [HELPER, PREFS, tools, hook]) await tab.addScriptTag({content});
  return tab;
}
const look = (tab) => tab.evaluate(() => window.b81.look());
const settle = (tab) => tab.waitForTimeout(120);

async function mentionThenCompose(tab, order) {
  const ta = tab.locator('textarea');
  await ta.click();
  await ta.pressSequentially('@');
  await tab.waitForSelector('.pinkie-mention .pinkie-mention__item', {timeout: 5000});
  await tab.evaluate(() => window.b81.compose(['z', 'zhou', '周报']));
  await settle(tab);
  const down = await tab.evaluate((o) => window.b81.commit(o, '周报'), order);
  await settle(tab);
  return {down, after: await look(tab)};
}

async function withBrowser(t, fn) {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try { await fn(browser, engine); } finally { await browser.close(); }
}

test('B81 前提：两处 Enter 守卫都还在 laolao-session-tools.js，Metre 拦截也认 isComposing / 229', () => {
  assert.ok(TOOLS.includes(PICK_GUARD), '提及弹层 Enter / Tab 选中的守卫');
  assert.ok(TOOLS.includes(SEND_GUARD), '带提及发送的守卫');
  assert.match(PREFS, /event\.isComposing \|\| event\.keyCode === 229\) return;/);
});

for (const sendKey of ['modifier-enter', '']) {
  const label = sendKey ? '选了 Ctrl + Enter' : '默认 Enter';
  test(`B81 真浏览器（${label}）：输入法组字按 Enter 上屏不选中提及项、不发送；上屏后再按 Enter 才选中；带提及组字上屏也不发`, {timeout: 60_000}, async (t) => {
    await withBrowser(t, async (browser, engine) => {
      for (const order of ['webkit', 'chromium']) {
        const tab = await open(browser, {sendKey});
        const tag = `${engine} / ${order} 顺序 / ${label}`;
        const {down, after} = await mentionThenCompose(tab, order);
        t.diagnostic(`${tag}: keydown keyCode=${down.keyCode} isComposing=${down.isComposing} hooks=${after.hooks}`);
        assert.equal(down.keyCode, 229, tag + '：合成 keydown 的 keyCode 要是 229');
        assert.deepEqual(after, {value: '@周报', sent: 0, handled: 0, hooks: 0, popup: true}, tag + '：上屏这一下不选中、不发送、共用 Enter 钩子不放行、弹层还在');

        const ta = tab.locator('textarea');
        await ta.press('Enter');
        const picked = await look(tab);
        assert.equal(picked.value, `@「${OTHER.title}」 `, tag + '：上屏后再按 Enter 选中提及项');
        assert.deepEqual([picked.sent, picked.handled, picked.popup], [0, 0, false], tag + '：选中不发送、弹层关掉');

        await tab.evaluate(() => window.b81.compose(['qing', '请看']));
        await settle(tab);
        const hooksBefore = (await look(tab)).hooks;
        await tab.evaluate((o) => window.b81.commit(o, '请看'), order);
        await settle(tab);
        const composed = await look(tab);
        assert.equal(composed.value, `@「${OTHER.title}」 请看`, tag);
        assert.deepEqual([composed.sent, composed.handled, composed.hooks], [0, 0, hooksBefore], tag + '：带提及时组字上屏的 Enter 不走带提及发送、共用钩子不放行');

        if (sendKey) {
          await ta.press('Enter');
          assert.equal((await look(tab)).handled, 0, tag + '：单按 Enter 照 I7 只换行');
          await ta.press('Control+Enter');
        } else {
          await ta.press('Enter');
        }
        await tab.waitForFunction(() => window.b81.handled.length > 0, null, {timeout: 5000});
        const sent = await look(tab);
        assert.deepEqual([sent.handled, sent.sent], [1, 0], tag + '：正常发送键带着提及发出去一次，原生不重复发');
        await tab.close();
      }
    });
  });
}

test('B81 前提：四个共用 Enter 钩子的守卫行都认 keyCode 229（同一行，不加行）', () => {
  for (const {f, arg, line} of guards(false)) assert.ok(line.includes(`${arg}.isComposing || ${arg}.keyCode === 229`), f + '：' + line);
});

test('B81 反例：去掉四个共用 Enter 钩子守卫里的 229，WebKit 顺序上屏那一下就会被当成发送 Enter（Chromium 顺序靠 isComposing 仍拦得住）', {timeout: 60_000}, async (t) => {
  const stripped = guards(true);
  for (const {f, line} of stripped) assert.ok(!line.includes('229'), f);
  await withBrowser(t, async (browser, engine) => {
    for (const order of ['webkit', 'chromium']) {
      const tab = await open(browser, {sendKey: 'modifier-enter', hook: hookScript(stripped)});
      const {after} = await mentionThenCompose(tab, order);
      assert.equal(after.hooks, order === 'webkit' ? HOOK_FILES.length : 0, `${engine} / ${order}：去掉 229 后共用钩子放行次数`);
      assert.deepEqual([after.value, after.sent, after.handled], ['@周报', 0, 0], `${engine} / ${order}`);
      await tab.close();
    }
  });
});

test('B81 反例：去掉 session-tools 的 isComposing / 229 守卫，组字上屏的 Enter 就会误选中提及项（两种顺序都抓得住）', {timeout: 60_000}, async (t) => {
  const broken = TOOLS.replace(PICK_GUARD, `(event.key === 'Enter' || event.key === 'Tab')`).replace(SEND_GUARD, `event.key === 'Enter' && !event.shiftKey && !sendingExpanded`);
  assert.notEqual(broken, TOOLS);
  await withBrowser(t, async (browser, engine) => {
    for (const order of ['webkit', 'chromium']) {
      const tab = await open(browser, {sendKey: 'modifier-enter', tools: broken});
      const {after} = await mentionThenCompose(tab, order);
      assert.equal(after.value, `@「${OTHER.title}」 `, `${engine} / ${order}：守卫去掉后上屏这一下就被当成选中`);
      await tab.close();
    }
  });
});
