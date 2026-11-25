// 复现 r3 第 1 条：点「模拟一轮在跑」后每 500ms 读带子上的字和几份状态。
const pw = require('F:/Projects/super-pinkie/build/windows-runtime/node_modules/openclaw/node_modules/playwright-core');
(async () => {
  const [url, w = '1440', h = '860'] = process.argv.slice(2);
  const b = await pw.chromium.launch({headless: true, channel: 'chrome'}); const p = await (await b.newContext({viewport: {width: +w, height: +h}})).newPage();
  await p.goto(url); await p.waitForTimeout(5000);
  await p.evaluate(() => { window.__rv = 0; window.addEventListener('pinkie:run-view', () => window.__rv++); });
  await p.evaluate(() => document.querySelector('[data-preview-panel] [data-pv="keys-run"]').click());
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(500);
    console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', await p.evaluate(() => {
      const st = document.querySelector('openclaw-chat-pane')?.state || {}, rs = window.__pinkieRunStatus?.state;
      const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)');
      const r = band?.getBoundingClientRect();
      return `rv=${window.__rv} run=${st.chatRunId} send=${st.chatSending} stream=${!!st.chatStream} rs.status=${JSON.stringify(rs?.status)} live=${JSON.stringify({a: rs?.live?.active, s: rs?.live?.state})} stop=${!!document.querySelector('.chat-send-btn--stop')} | ${band?.innerText.replace(/\s+/g, ' ')} | bottomGap=${r ? Math.round(innerHeight - r.bottom) : '-'}`;
    }));
  }
  await b.close();
})();
