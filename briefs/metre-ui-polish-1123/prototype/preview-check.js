// 先在后台无头浏览器里打开预览页看能不能正常出来（截一张图、记下报错），再给用户开窗口。
const {chromium} = require('F:\\Projects\\super-pinkie\\build\\windows-runtime\\node_modules\\openclaw\\node_modules\\playwright-core');
(async () => {
  const url = process.argv[2], out = process.argv[3];
  const b = await chromium.launch({headless: true, channel: 'chrome'});
  const p = await b.newPage({viewport: {width: 1280, height: 800}});
  const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(url); await p.waitForTimeout(6000);
  const info = await p.evaluate(() => ({mode: document.documentElement.getAttribute('data-laolao-mode'), home: document.documentElement.getAttribute('data-laolao-startup-home'),
    splash: document.documentElement.hasAttribute('data-laolao-splash-metre'), reduce: document.documentElement.hasAttribute('data-pinkie-reduce-motion'),
    lock: !!document.querySelector('.laolao-metre-lock-dialog,.laolao-metre-lock-curtain'), transition: typeof window.PinkieMetreTransition?.play, panel: !!document.querySelector('[data-preview-panel]'),
    groups: document.querySelectorAll('.chat-thread .chat-group').length}));
  console.log(JSON.stringify(info)); console.log(errs.slice(0, 15).join('\n'));
  await p.screenshot({path: out}); await b.close();
})().catch((e) => { console.log('ERR', e); process.exit(1); });
