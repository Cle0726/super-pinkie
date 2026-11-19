import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const script = fileURLToPath(new URL('../ui/injections/laolao-session-tools.js', import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';

test(`Metre saves the active composer’s strategy before a message can send (${engine})`, {timeout: 60_000}, async () => {
  const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(12_000);
    await page.route('http://127.0.0.1:30114/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: '<html data-laolao-mode="metre"><body><openclaw-chat-pane active><div class="agent-chat__composer-combobox"><textarea></textarea></div><div class="agent-chat__composer-controls"><button class="chat-send-btn">发送</button></div></openclaw-chat-pane></body></html>',
    }));
    const composerKey = 'agent:metre:dashboard:active';
    await page.goto('http://127.0.0.1:30114/chat?session=agent:metre:dashboard:old');
    await page.evaluate(key => {
      document.querySelector('openclaw-chat-pane').state = {sessionKey: key};
      const qa = window.qa = {saved: 'dispatch', sends: [], requests: [], confirm: null};
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        if (!method.startsWith('pinkie.session.prefs.')) return {};
        qa.requests.push([method, params.key]);
        if (method.endsWith('.set')) {
          await new Promise(resolve => { qa.confirm = resolve; });
          qa.saved = params.dispatch;
        }
        return {ok: true, web: true, dispatch: qa.saved};
      }};
      const send = () => qa.sends.push(qa.saved);
      document.querySelector('.chat-send-btn').onclick = send;
      document.querySelector('textarea').onkeydown = event => { if (event.key === 'Enter') send(); };
    }, composerKey);
    await page.addScriptTag({path: script});
    const solo = page.getByRole('radio', {name: 'Virtuoso'});
    await solo.click();
    await page.waitForFunction(() => typeof window.qa.confirm === 'function');
    await page.getByRole('textbox').fill('这是还没发送的草稿');
    await page.getByRole('textbox').press('Enter');
    await page.locator('.chat-send-btn').click();
    assert.deepEqual(await page.evaluate(() => window.qa.sends), []);
    assert.equal(await page.getByRole('textbox').inputValue(), '这是还没发送的草稿');
    assert.equal(await solo.getAttribute('aria-checked'), 'false', 'only the saved state is selected');
    await page.evaluate(() => window.qa.confirm());
    await page.locator('.pinkie-baton__seg[aria-label="Virtuoso"][aria-checked="true"]').waitFor();
    await page.locator('.chat-send-btn').click();
    assert.deepEqual(await page.evaluate(() => window.qa.sends), ['solo']);
    assert.deepEqual(await page.evaluate(() => [...new Set(window.qa.requests.map(([,key]) => key))]), [composerKey]);
  } finally { await browser.close(); }
});
