// 录我们自己的预览：首页进场（刚打开）、切进 Metre 的预备拍到落拍、换会话。每 70ms 一张。
const pw = require('F:\\Projects\\super-pinkie\\build\\windows-runtime\\node_modules\\openclaw\\node_modules\\playwright-core'); const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const [base, out, night] = process.argv.slice(2);
  fs.mkdirSync(out, {recursive: true}); for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f));
  const b = await pw.chromium.launch({headless: true, channel: 'chrome'});
  let n = 0;
  const rec = async (tag, url, act, frames, gap) => {
    const ctx = await b.newContext({viewport: {width: 1440, height: 860}}); const p = await ctx.newPage();
    await p.goto(url); if (act) { await p.waitForTimeout(4500); p.evaluate(act).catch(() => {}); }
    for (let i = 0; i < frames; i++) { await p.screenshot({path: path.join(out, String(n++).padStart(3, '0') + '-' + tag + '-' + i * gap + '.jpg'), type: 'jpeg', quality: 62}); await p.waitForTimeout(gap); }
    await ctx.close();
  };
  const q = '&night=' + night;
  await rec('home', base + '&empty=1' + q, `window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: 420}}))`, 30, 60);
  await rec('metre', base + '&empty=1' + q, `(async () => { const t = window.PinkieMetreTransition.play(); await t.ready; await t.covered; t.finish(); })()`, 34, 70);
  await rec('switch', base + '&empty=0' + q, `window.dispatchEvent(new CustomEvent('pinkie:session-selected', {detail: {}}))`, 20, 60);
  await b.close(); console.log('frames', n);
})().catch((e) => { console.log('ERR', e); process.exit(1); });
