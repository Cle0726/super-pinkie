#!/usr/bin/env node
// B11·S5（侧栏高亮会话行时间对比度）给 uireview / 协调者看图和数值用，走 .github/workflows/pr-shots.yml 在 CI 上拍。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/b11-s5-active-session-time.mjs --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真装的 Control UI，home-chat 点进对话，1440 / 820（820 先展开抽屉）× 日 / 夜，只截侧栏高亮行：
//   after  = 本分支现状；
//   before = 同一页注回 origin/main@b8fcd5be 的写法（日间 --sb-muted，夜间继承行色 × .56）。
// shots.jsonl 每行多一个 contrast 字段：calc（计算值）与 px（像素量，4px 分箱最浅，与复发测试同口径）。不连真网关、不改基线。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = await import(pathToFileURL(path.join(root, 'tests/visual/lib/real-harness.mjs')).href);
const C = await import(pathToFileURL(path.join(root, 'tests/visual/lib/session-time-contrast.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const lines = [];
const ROW = 'aside.sidebar #laolao-session-manager .sidebar-recent-session--active';

const measure = async (page, width) => {
  const rows = await C.visibleTimes(page, width);
  if (!rows.length) throw new Error(`${width} 高亮行里没有看得见的时间`);
  let calc = Infinity;
  let px = Infinity;
  for (const r of rows) {
    calc = Math.min(calc, r.ratio);
    px = Math.min(px, await C.pixelTime(page, r.box, {binPx: 4}));
  }
  return {calc: Number(calc.toFixed(2)), px: Number(px.toFixed(2)), box: rows[0].box};
};

const shoot = async (page, name, contrast) => {
  const row = await page.evaluate(([sel, y]) => {
    const hit = [...document.querySelectorAll(sel)].find((n) => {
      const r = n.getBoundingClientRect();
      return r.top <= y && r.bottom >= y;
    });
    const r = (hit || document.querySelector(sel)).getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height};
  }, [ROW, contrast.box.y + contrast.box.height / 2]);
  const pad = 8;
  const clip = {x: Math.max(0, row.x - pad), y: Math.max(0, row.y - pad), width: row.width + pad * 2, height: row.height + pad * 2};
  const file = `${name}.png`;
  await page.screenshot({path: path.join(out, file), clip, scale: 'device', animations: 'disabled'});
  const buf = fs.readFileSync(path.join(out, file));
  const {box, ...ratios} = contrast;
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), contrast: ratios});
  console.log(`pr-shots: ${name} calc=${ratios.calc} px=${ratios.px}`);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const width of [1440, 820]) {
    for (const theme of ['day', 'night']) {
      const {context, page} = await C.openActiveRow(browser, server.origin, theme, width);
      try {
        await shoot(page, `b11-s5-session-time-${width}-${theme}-after`, await measure(page, width));
        await page.addStyleTag({content: C.REVERT_CSS});
        await page.waitForTimeout(200);
        await shoot(page, `b11-s5-session-time-${width}-${theme}-before`, await measure(page, width));
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
