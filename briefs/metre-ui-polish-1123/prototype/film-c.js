// 按真实时间轴录帧（假时钟）：触发以后每走 STEP ms 截一张，帧名就是触发后的毫秒数。
// 用法：node film-c.js <网址(不带 empty/night)> <输出目录> <0|1> [场景,逗号分隔] [STEP=40] [宽] [高]
// 场景：home（首页进场 / 亮灯）、metre（切进 Metre）、switch（换会话）、load（刚打开 App，从 0 开始录）、reduce（减少动效下切进 Metre，应当没有过场）
// 注意：rAF / setTimeout / performance.now 走假时钟；element.animate（引导语的拷贝）走真时钟，所以引导语看 home 场景的 real 帧。
const pw = require('F:\\Projects\\super-pinkie\\build\\windows-runtime\\node_modules\\openclaw\\node_modules\\playwright-core'); const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const [base, out, night, scenes = 'home,metre,switch', STEP = '40', W = '1440', H = '860'] = process.argv.slice(2);
  fs.mkdirSync(out, {recursive: true}); for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), {recursive: true, force: true});
  const b = await pw.chromium.launch({headless: true, channel: 'chrome'});
  const step = Number(STEP);
  const ACT = {
    home: [`window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: 420}}))`, 1, 1800],
    metre: [`(async () => { const t = window.PinkieMetreTransition.play(); if (!t) { window.__filmNone = 1; return; } await t.ready; await t.covered; t.finish(); })()`, 1, 2300],
    reduce: [`document.documentElement.setAttribute('data-pinkie-reduce-motion', ''); window.__filmT = window.PinkieMetreTransition.play(); window.dispatchEvent(new CustomEvent('pinkie:session-selected', {detail: {}}))`, 1, 400],
    switch: [`window.dispatchEvent(new CustomEvent('pinkie:session-selected', {detail: {}}))`, 0, 720],
  };
  for (const tag of scenes.split(',')) {
    const ctx = await b.newContext({viewport: {width: Number(W), height: Number(H)}}); const p = await ctx.newPage();
    await p.clock.install();
    const shot = (ms) => p.screenshot({path: path.join(out, `${tag}-${String(ms).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 70});
    if (tag === 'load') {
      const t0 = Date.now(); p.goto(base + '&empty=1&night=' + night).catch(() => {});
      for (let i = 0; i < 40; i++) { await p.waitForTimeout(90); await shot(Date.now() - t0).catch(() => {}); }
    } else {
      const [act, empty, len] = ACT[tag];
      await p.goto(base + '&empty=' + empty + '&night=' + night); await p.waitForTimeout(4500);
      const now = await p.evaluate('Date.now()'); await p.clock.pauseAt(new Date(now + 20)); await p.clock.runFor(20);
      p.evaluate(act).catch(() => {});
      await p.waitForTimeout(60);
      for (let ms = 0; ms <= len; ms += step) { await shot(ms); await p.clock.runFor(step); }
      if (tag === 'reduce') console.log('reduce: play() ->', await p.evaluate('String(window.__filmT)'), ', overlays:', await p.evaluate('[...document.querySelectorAll(".pk-metre-transition, .pk-metre-turn, .pk-metre-lights, .pk-metre-fly")].map((n) => n.className).join(",")'));
    }
    console.log(tag, 'ok'); await ctx.close();
  }
  await b.close(); console.log('done');
})().catch((e) => { console.log('ERR', e); process.exit(1); });
