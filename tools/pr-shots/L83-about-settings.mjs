#!/usr/bin/env node
// L83（B93 文字部分）：设置页与「关于与更新」卡片截图，日 / 夜 × 1440 / 820。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关；不连真网关、不改基线。
// report.json 记下页面可见文字里还剩的「CLE Kk」/「OpenClaw」（第三方许可弹窗不打开，不计入）。
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
const WIDTHS = [1440, 820], HEIGHT = 900, THEMES = ['day', 'night'];
const engine = 'chromium';

const lines = [];
const save = (name, buf) => {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

// 可见文字里的旧名字 / 上游名字（只看渲染出来的文字和 title / aria-label / placeholder）。
const leftovers = (page) => page.evaluate(() => {
  const bad = /CLE\s*Kk|OpenClaw/;
  const hits = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !bad.test(n.nodeValue)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
    hits.push(n.nodeValue.trim().slice(0, 120));
  }
  for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
    for (const a of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && bad.test(v)) hits.push(`${a}=${v.slice(0, 120)}`);
    }
  }
  if (bad.test(document.title)) hits.push(`document.title=${document.title}`);
  return hits;
});

const aboutTitle = (page) => page.locator('#laolao-user-settings .pinkie-user-settings__card-title', {hasText: '关于与更新'}).first();

const report = {engine, rows: []};
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
try {
  for (const theme of THEMES) for (const width of WIDTHS) {
    const row = {theme, width, kernelNote: null, leftovers: [], errors: []};
    let opened;
    try {
      opened = await H.openRealScenePage(browser, server.origin, 'settings', theme, {timezoneId: 'Asia/Shanghai'});
      const {page} = opened;
      await page.setViewportSize({width, height: HEIGHT});
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
      save(`L83-settings-${width}-${theme}`, await page.screenshot({animations: 'disabled'}));
      const title = aboutTitle(page);
      await title.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const card = title.locator('xpath=ancestor::section[contains(@class,"pinkie-user-settings__card")]');
      save(`L83-about-${width}-${theme}`, await page.screenshot({animations: 'disabled'}));
      save(`L83-about-card-${width}-${theme}`, await card.screenshot({animations: 'disabled'}));
      row.kernelNote = (await card.locator('.pinkie-user-settings__soft-note', {hasText: '内核'}).first().textContent().catch(() => null))?.trim() || null;
      row.leftovers = await leftovers(page);
    } catch (error) {
      row.errors.push(String(error?.message || error).slice(0, 300));
    } finally {
      await opened?.context.close();
    }
    report.rows.push(row);
  }
} catch (error) {
  report.error = String(error?.message || error).slice(0, 300);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}

console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
console.log('theme\twidth\tkernelNote\tleftovers');
for (const r of report.rows) {
  console.log(`${r.theme}\t${r.width}\t${r.kernelNote ?? '-'}\t${r.leftovers.length ? r.leftovers.join(' | ') : '无'}`);
  for (const e of r.errors) console.log(`${r.theme}\t${r.width}\tERROR ${e}`);
}
if (report.error || report.rows.some((r) => r.errors.length || r.leftovers.length)) { console.log(`ERROR ${report.error || 'see report.json'}`); process.exitCode = 1; }
