// 检查首页亮灯：重放进场后 0.3s / 0.9s / 2.2s 各截一张画带，并记下亮灯层在不在。
const pw = require('F:\\Projects\\super-pinkie\\build\\windows-runtime\\node_modules\\openclaw\\node_modules\\playwright-core');
const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const [url, out] = process.argv.slice(2);
  fs.mkdirSync(out, {recursive: true});
  const b = await pw.chromium.launch({headless: true, channel: 'chrome'});
  const p = await (await b.newContext({viewport: {width: 1440, height: 860}})).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  await p.goto(url); await p.waitForTimeout(4500);
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: 420}})));
  const t0 = Date.now(); const log = [];
  for (const at of [300, 900, 2200]) {
    while (Date.now() - t0 < at) await p.waitForTimeout(20);
    const info = await p.evaluate(() => ({enter: document.documentElement.getAttribute('data-metre-enter'), lights: !!document.querySelector('.pv3-lights'),
      srcOpacity: document.querySelector('canvas.pk-metre-backdrop')?.style.opacity, band: getComputedStyle(document.documentElement).getPropertyValue('--metre-band')}));
    log.push(at + 'ms ' + JSON.stringify(info));
    await p.screenshot({path: path.join(out, 'band-' + at + '.png'), clip: {x: 260, y: 560, width: 1180, height: 300}});
  }
  console.log(log.join('\n')); console.log(errs.filter((e) => !/ServiceWorker|404|sw\.js/.test(e)).slice(0, 12).join('\n')); await b.close();
})().catch((e) => { console.log('ERR', e); process.exit(1); });
