#!/usr/bin/env node
// B32「开 / 关」选项键描边截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用，本机不开浏览器。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json（量到的描边颜色）。
// 真页面（tests/visual/lib/real-harness.mjs）设置场景，每格（1440 / 820 × 日夜）拍：
//   settings       设置弹层整页（滚到第一组「开 / 关」选项键）
//   choice-row     那一行本身（放大看描边）
//   choice-hover   悬停在一个未选中的选项键上（悬停描边照旧）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const HEIGHT = 800;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const engine = String(H.resolveRealEngine() || 'chromium');
const browser = await H.launchRealBrowser(engine);
const report = [];
const lines = [];

const record = (name, file) => {
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
const shoot = async (target, name, theme, width) => {
  const file = `b32-${name}-${theme}-${width}.png`;
  await target.screenshot({path: path.join(out, file)});
  record(`b32-${name}-${theme}-${width}`, file);
};

const measureChoices = (page) => page.evaluate(() => [...document.querySelectorAll('#laolao-user-settings .pinkie-user-settings__choice')].slice(0, 8).map((n) => {
  const s = getComputedStyle(n);
  return {text: (n.textContent || '').trim().slice(0, 20), selected: n.classList.contains('is-selected'), border: s.borderTopColor, background: s.backgroundColor};
}));

async function settings(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'settings', theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const row = page.locator('#laolao-user-settings .pinkie-user-settings__row:has(.pinkie-user-settings__choice)').first();
    await row.waitFor({timeout: 10_000});
    await row.scrollIntoViewIfNeeded();
    await page.mouse.move(2, HEIGHT - 2);
    await page.waitForTimeout(400);
    await shoot(page, 'settings', theme, width);
    await shoot(row, 'choice-row', theme, width);
    const plain = await measureChoices(page);
    const idle = row.locator('.pinkie-user-settings__choice:not(.is-selected)').first();
    let hover = null;
    if (await idle.count()) {
      await idle.hover();
      await page.waitForTimeout(300);
      await shoot(row, 'choice-hover', theme, width);
      hover = await idle.evaluate((n) => getComputedStyle(n).borderTopColor);
      await page.mouse.move(2, HEIGHT - 2);
    }
    report.push({theme, width, step: 'settings', choices: plain, hoverBorder: hover, pageErrors});
  } catch (error) {
    report.push({theme, width, step: 'settings', error: error.message, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await settings(theme, width);
      // Windows runner 偶尔整页截图卡住（见 111-recap.mjs），出错就整格再来一次。
      if (report.at(-1)?.error) { report.at(-1).retried = true; await settings(theme, width); }
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const unique = [...new Map(lines.map((l) => [l.name, l])).values()];
fs.appendFileSync(path.join(out, 'shots.jsonl'), unique.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) if (r.error) console.log(`pr-shots: ${r.theme} ${r.width} ${r.step} 出错：${r.error}`);
