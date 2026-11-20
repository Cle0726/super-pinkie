// Diagnostic only: load the actual local packaged Control UI with no credentials injected.
import {createRequire} from 'node:module';
import path from 'node:path';
const require = createRequire(path.join(process.env.PINKIE_UI_DEPS, 'package.json'));
const {webkit} = require('playwright');
const origin = 'http://127.0.0.1:18789';
const browser = await webkit.launch({headless: true});
try {
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/chat', {waitUntil: 'domcontentloaded', timeout: 25_000});
  let ready = true;
  try {
    await page.waitForFunction(() => document.querySelector('openclaw-app-shell')?.context?.gateway?.snapshot?.connected === true, null, {timeout: 15000});
  } catch { ready = false; }
  const report = await page.evaluate(async connected => {
    const gateway = document.querySelector('openclaw-app-shell')?.context?.gateway?.snapshot;
    const result = {connected, keys: Object.keys(gateway || {}), request: false};
    if (connected) {
      try {
        await window.__laolaoSidebar.gwRequest('pinkie.usage.get', {}, 5000);
        result.request = true;
      } catch (error) { result.requestError = String(error).slice(0, 250); }
    } else {
      result.authMessage = String(gateway?.lastError || gateway?.error || '').slice(0, 250);
      result.signInText = String(document.body.innerText).split('\n').find(line => /token|连接.*失败|未连接|设备|密码|unauthorized/i.test(line))?.slice(0, 250) || '';
    }
    return result;
  }, ready);
  console.log('live Mac WebKit:', JSON.stringify(report));
} finally { await browser.close(); }
