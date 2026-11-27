// 注入脚本里的图片路径必须是绝对的（/laolao-…）：脚本里设置的 src / backgroundImage 按「页面地址」解析，
// 在 /settings/… 这类嵌套路由上 ./laolao-x.png 会请求成 /settings/laolao-x.png → 404。
// 真页面截图测试只在那一帧正好渲染出这张图时才红（#346 重采 45910969939 linux：404 /settings/laolao-pinkie-status-done.png，
// 来自 laolao-update-dialog.js 的 ./ 贴纸），所以这里静态地查死。__pinkieAsset 只为查哈希去掉 ./，返回值仍带 ./，救不了。
// CSS 里的 url(./laolao-…) 按 CSS 文件解析，不受影响，不查。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DIR = new URL('../ui/injections/', import.meta.url);
// ${…} 里可以是任意表达式（如 ${stickers[s] || 'thinking'}），所以按「普通字符或整段 ${…}」来认。
const RELATIVE = /\.\/laolao-(?:[A-Za-z0-9_.\-]|\$\{[^}]*\})*\.(?:png|svg|webp|jpe?g|gif)\b/g;

test('injected JS references laolao-* images by absolute path, never ./laolao-*', () => {
  const hits = [];
  for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()) {
    const lines = fs.readFileSync(new URL(name, DIR), 'utf8').split('\n');
    lines.forEach((line, i) => { for (const m of line.matchAll(RELATIVE)) hits.push(`${name}:${i + 1} ${m[0]}`); });
  }
  assert.deepEqual(hits, [], `这些图片路径在 /settings/… 下会 404，改成 /laolao-…：\n${hits.join('\n')}`);
});

test('the pattern catches relative sticker paths and lets absolute paths and scripts through', () => {
  assert.equal(' `./laolao-pinkie-status-${s}.png` '.match(RELATIVE)?.length, 1);
  assert.equal(" `./laolao-pinkie-status-${stickers[s] || 'thinking'}.png` ".match(RELATIVE)?.length, 1, 'update-dialog.js:155 那种写法也要认出来');
  assert.equal(' "/laolao-pinkie-status-done.png" '.match(RELATIVE), null);
  assert.equal(' import("./laolao-x.js") '.match(RELATIVE), null);
});
