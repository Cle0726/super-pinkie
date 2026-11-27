#!/usr/bin/env node
// A5 并排答界面截图。约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl。
// 假页面和 e2e 测试共用 tests/helpers/side-by-side-fixture.mjs（假网关，不连真网关、不碰用户会话）。
// 碧琪 / Metre × 浅 / 深 × 并排中 / 待选边 × 1440 / 820，共 16 张。不动 tests/visual/baseline/。
// PINKIE_SHOTS_ENGINE=webkit 走 WebKit（本机 page.screenshot 回 0 字节，改用 wkshotBuffer）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {wkshotBuffer, wrapWebKitPlaywright} from '../../tests/visual/lib/webkit-screenshot.mjs';
import {openFixturePage, until, startFromComposer, finishBoth} from '../../tests/helpers/side-by-side-fixture.mjs';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const git = (...a) => { try { return execFileSync('git', ['-C', repoRoot, ...a], {encoding: 'utf8'}).trim(); } catch { return null; } };
const head = {head: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain'))};
console.log(`pr-shots: 被测头 ${JSON.stringify(head)}`);

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await playwright()[engine].launch({headless: true});
const capture = async (page, opts) => {
  const buf = engine === 'webkit' ? await wkshotBuffer(page, opts) : await page.screenshot(opts);
  if (opts.path) fs.writeFileSync(opts.path, buf);
  return buf;
};

const HEIGHT = 900;
const lines = [];
try {
  for (const [skin, mode] of [['pinkie', ''], ['metre', 'metre']]) {
    for (const night of [false, true]) {
      for (const width of [1440, 820]) {
        for (const phase of ['running', 'choosing']) {
          const name = `a5-${skin}-${night ? 'night' : 'day'}-${phase}-${width}`;
          const {page, close} = await openFixturePage(browser, {mode, night, width, height: HEIGHT});
          try {
            await page.locator('.pinkie-sbs-toggle').waitFor({state: 'attached'});
            await startFromComposer(page);
            if (phase === 'running') {
              await page.evaluate(() => { window.__test.stream('left', '光合作用是植物把光能变成化学能的过程：叶绿体吸收光，把水和二氧化碳合成葡萄糖，'); window.__test.stream('right', '简单说：'); });
              await until(page, () => document.querySelector('.pinkie-sbs__text[data-side="right"]')?.textContent === '简单说：');
            } else {
              await finishBoth(page);
            }
            await page.waitForTimeout(300);
            const file = `${name}.png`;
            const buf = await capture(page, {path: path.join(out, file)});
            lines.push({name, file, os: process.platform, browser: engine, width, height: HEIGHT, bytes: buf.length,
              sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...head});
          } finally { await close(); }
        }
      }
    }
  }
} finally {
  await browser.close();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
