// film-r4.js <port> <out> <night 0|1> [scenes] [step=40]：第 4 轮录帧（假时钟，帧名 = 触发后的毫秒数）
// 场景：v1（第 1 版去掉小猫，对比用）、enter-<模式>（碧琪某模式 → Metre）、exit-<模式>（Metre → 碧琪某模式）、reduce（减少动效下 Metre → 碧琪）
// 预览页的 __pv.toMetre / __pv.toPinkie 和切换器的先后顺序一样（见 preview.js）。
const pw = require('F:\\Projects\\super-pinkie\\build\\windows-runtime\\node_modules\\openclaw\\node_modules\\playwright-core'); const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const [port, out, night, scenes = 'v1,enter-chat,exit-chat', STEP = '40'] = process.argv.slice(2);
  fs.mkdirSync(out, {recursive: true});
  const b = await pw.chromium.launch({headless: true, channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const step = Number(STEP), url = `http://127.0.0.1:${port}/chat?session=agent%3Ametre%3Adashboard%3Apreview1&harnessSession=active&empty=0&night=${night}&v=3`;
  for (const tag of scenes.split(',')) {
    const [kind, mode = 'chat'] = tag.split('-');
    const ctx = await b.newContext({viewport: {width: 1440, height: 860}}); const p = await ctx.newPage();
    await p.clock.install();
    await p.goto(url); await p.waitForTimeout(4500);
    await p.evaluate(() => { const q = document.querySelector('[data-preview-panel]'); if (q) q.style.display = 'none'; });
    if (kind === 'v1') await p.addScriptTag({url: `http://127.0.0.1:${port}/__v1nocat.js`});
    if (kind !== 'exit' && kind !== 'reduce') await p.evaluate((m) => window.__pv.skin(m), mode);   // 起点是碧琪的页面
    await p.waitForTimeout(Number(process.env.SKIN_WAIT || 600));
    if (process.env.SKIN_WAIT) console.log(tag, 'mode before', await p.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), await p.evaluate(() => [...document.querySelectorAll('[class*=splash]')].map((n) => n.className.slice(0, 40)).join(',')));
    for (let k = 1; ; k++) { const now = await p.evaluate('Date.now()'); try { await p.clock.pauseAt(new Date(now + 300 * k)); break; } catch (e) { if (k > 5) throw e; } }
    await p.clock.runFor(20);
    const act = {
      v1: `(async () => { const t = window.PinkieMetreTransitionV1.play(); await t.ready; await t.covered; window.__pv.skin('metre'); t.finish(); })()`,
      enter: `window.__pv.toMetre()`,
      exit: `window.__pv.toPinkie(${JSON.stringify(mode)})`,
      reduce: `(document.documentElement.setAttribute('data-pinkie-reduce-motion', ''), window.__filmLeave = String(window.PinkieMetreTransition.leave()), window.__pv.toPinkie('chat'))`,
    }[kind];
    p.evaluate(act).catch((e) => console.log('act err', e.message));
    await p.waitForTimeout(60);
    const len = kind === 'exit' ? 3600 : kind === 'reduce' ? 400 : 2000;
    const log = [];
    for (let ms = 0; ms <= len; ms += step) {
      await p.screenshot({path: path.join(out, `${tag}-${String(ms).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 72});
      log.push(ms + ' ' + await p.evaluate(() => [...document.querySelectorAll('.pk-metre-transition, .laolao-mode-transition')].map((n) => n.className.split(' ')[0] + '@' + getComputedStyle(n).opacity).join(',') + ' | mode=' + document.documentElement.getAttribute('data-laolao-mode')));
      await p.clock.runFor(step); await p.waitForTimeout(kind === 'exit' ? 30 : 5);
    }
    fs.writeFileSync(path.join(out, `${tag}-overlays.txt`), log.join('\n'));
    if (kind === 'reduce') console.log('reduce: leave() ->', await p.evaluate('window.__filmLeave'));
    console.log(tag, 'ok'); await ctx.close();
  }
  await b.close(); console.log('done');
})().catch((e) => { console.log('ERR', e); process.exit(1); });
