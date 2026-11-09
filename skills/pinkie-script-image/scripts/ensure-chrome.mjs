// 确保专用 Chrome 在跑（CDP 9333）。碧琪生图技能用这个浏览器开网页版出图。
// 关键：必须带 --disable-http2。这台机器走 Clash 代理时 HTTP/2 长连接会被掐断
// （ERR_HTTP2_PING_FAILED），页面永远卡在 loading，输入框的发送按钮一辈子不亮。
// 用法: node ensure-chrome.mjs [--url https://chatgpt.com/] [--headful]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const PORT = Number(process.env.CDP_PORT || 9333);
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const url = opt('--url', 'https://chatgpt.com/');
// 默认有头：用户能在屏幕上看见，登录状态也才存得住
const headless = argv.includes('--headless');
const profile = process.env.PK_CHROME_PROFILE || path.join(os.homedir(), '.pinkie', 'gen-chrome');

const alive = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, {signal: AbortSignal.timeout(1500)});
    return r.ok;
  } catch { return false; }
};

if (await alive()) {
  console.log(JSON.stringify({ok: true, reused: true, port: PORT, profile}));
  process.exit(0);
}

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = candidates.find((p) => fs.existsSync(p));
if (!exe) {
  console.error('找不到 Chrome 或 Edge。装一个（winget install Google.Chrome）再试。');
  process.exit(2);
}

fs.mkdirSync(profile, {recursive: true});
const args = [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-http2',      // ← 必须，否则页面卡在 loading
  '--disable-features=HttpsUpgrades',
  '--lang=zh-CN',
];
if (headless) args.push('--headless=new');
args.push(url);

const child = spawn(exe, args, {detached: true, stdio: 'ignore'});
child.unref();

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await alive()) {
    console.log(JSON.stringify({ok: true, reused: false, port: PORT, profile, exe, url}));
    process.exit(0);
  }
}
console.error('Chrome 起了但调试端口没通（' + PORT + '）');
process.exit(3);
