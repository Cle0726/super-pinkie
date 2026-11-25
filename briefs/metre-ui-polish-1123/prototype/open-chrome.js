// 在用户桌面上开一个 Chrome 窗口看预览（单独的配置目录，不动用户自己的 Chrome 资料）。
const {spawn} = require('node:child_process'); const fs = require('node:fs');
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
if (!chrome) { console.log('chrome not found'); process.exit(1); }
const url = process.argv[2];
spawn(chrome, ['--user-data-dir=F:\\Projects\\super-pinkie\\build\\quick-run\\mui\\chrome-preview', '--no-first-run', '--no-default-browser-check', '--new-window', '--window-size=1320,880', url], {detached: true, stdio: 'ignore'}).unref();
setTimeout(() => { console.log('opened', chrome, url); process.exit(0); }, 600);
