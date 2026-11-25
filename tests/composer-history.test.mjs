// 第四批 I3 复发测试：原生 ↑/↓ 翻输入历史后只改 state.chatMessage、不请求重画，输入框的字不跟着变。
// laolao-composer-history.js 在冒泡阶段补一次重画。这里用假的聊天面板模拟原生这一缺口，真浏览器里跑。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

const PAGE = `<!doctype html><html><body>
<openclaw-chat-pane><div class="agent-chat__composer-combobox"><textarea></textarea></div></openclaw-chat-pane>
<div class="elsewhere"><textarea class="other"></textarea></div></body></html>`;

// 和原生一样：历史走一步就改草稿并 preventDefault，但不重画；重画（requestUpdate）走微任务，把草稿写回输入框。
const FAKE_NATIVE = () => {
  const pane = document.querySelector('openclaw-chat-pane');
  const input = pane.querySelector('textarea');
  const history = ['上一句', '更早一句'];
  window.updates = 0;
  pane.state = {chatMessage: '', index: -1, requestUpdate() {}};
  pane.requestUpdate = () => { window.updates++; queueMicrotask(() => { input.value = pane.state.chatMessage; }); };
  const step = (s, key) => {
    if (key === 'ArrowUp') { if (s.index >= history.length - 1) return false; s.index++; s.chatMessage = history[s.index]; return true; }
    if (s.index === -1) return false;
    s.index--; s.chatMessage = s.index === -1 ? '' : history[s.index]; return true;
  };
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (step(pane.state, event.key)) event.preventDefault();
  });
};

async function open(browser, withFix) {
  const page = await browser.newPage({viewport: {width: 800, height: 400}});
  await page.setContent(PAGE);
  await page.evaluate(FAKE_NATIVE);
  if (withFix) await page.addScriptTag({path: inj('laolao-composer-history.js')});
  await page.locator('openclaw-chat-pane textarea').click();
  return page;
}
const value = (page) => page.locator('openclaw-chat-pane textarea').inputValue();
const press = async (page, key) => { await page.keyboard.press(key); await page.waitForTimeout(50); };

test(`composer history: without the fix the textarea stays stale after ↑ (guards the test itself) (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser, false);
    await press(page, 'ArrowUp');
    assert.equal(await page.evaluate(() => document.querySelector('openclaw-chat-pane').state.chatMessage), '上一句');
    assert.equal(await value(page), '', '假原生确实不重画');
  } finally { await browser.close(); }
});

test(`composer history: ↑/↓ shows the history line at once and returns to the draft (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser, true);
    await press(page, 'ArrowUp');
    assert.equal(await value(page), '上一句');
    await press(page, 'ArrowUp');
    assert.equal(await value(page), '更早一句');
    await press(page, 'ArrowDown');
    assert.equal(await value(page), '上一句');
    await press(page, 'ArrowDown');
    assert.equal(await value(page), '');
    const updates = await page.evaluate(() => window.updates);
    assert.equal(updates, 4, '每次真正走一步只重画一次');
    // 到底了原生不处理（不 preventDefault），也不该重画
    await press(page, 'ArrowDown');
    assert.equal(await page.evaluate(() => window.updates), updates, '没处理的 ↓ 不重画');
  } finally { await browser.close(); }
});

test(`composer history: modifier keys and other textareas are left alone (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser, true);
    await press(page, 'Shift+ArrowUp');
    assert.equal(await page.evaluate(() => window.updates), 0, 'Shift+↑ 不碰');
    await page.evaluate(() => {
      const other = document.querySelector('textarea.other');
      other.addEventListener('keydown', (e) => e.preventDefault());
      document.querySelector('openclaw-chat-pane').state.chatMessage = '别处的值';
    });
    await page.locator('textarea.other').click();
    await press(page, 'ArrowUp');
    assert.equal(await page.evaluate(() => window.updates), 0, '别的输入框按 ↑ 不重画聊天面板');
  } finally { await browser.close(); }
});
