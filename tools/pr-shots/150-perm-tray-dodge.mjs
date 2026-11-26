#!/usr/bin/env node
// #150 续做（mac2 #150 issuecomment-7183750963）的 PR 截图脚本，走 .github/workflows/pr-shots.yml 在 CI 上拍，本机不开浏览器。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/150-perm-tray-dodge.mjs --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI + Metre（tests/visual/lib/real-harness.mjs 的 metre-board 场景，关掉看板），和 mac2 的 B 路一样：
// 320 宽时「⋯」为躲右下角的麦克风（button.chat-send-btn / #laolao-native-dictation）让到行首，改前又落在左下角
// 浮着的托盘键 button.pinkie-tray-btn 底下，点中心打不开会话详情。360 宽作对照（改前就正常）。
// 每格（320 / 360 × 日 / 夜）拍两张：按键行（输入区）、点「⋯」中心后的整页；shots.jsonl 每行另记
// fold / dodge / padLeft / statHit（「⋯」中心点下去是不是它自己）/ top（中心点最上层是谁）/ opened。
// 最后再把同一页放宽到 820 量一次，记下放宽后是否回到原位（fold 0、没有 data-dodge、没有让位距离）。
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
const engine = String(H.resolveRealEngine() || 'chromium');
const HEIGHT = 900;
const lines = [], report = [];

const record = (name, file, extra) => {
  const buf = fs.readFileSync(path.join(out, file));
  // PNG IHDR：宽在 16–19 字节，高在 20–23 字节
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};
const shoot = async (page, name, sel, extra) => {
  const file = `${name}.png`;
  const target = sel ? page.locator(sel).first() : null;
  if (target && await target.count()) await target.screenshot({path: path.join(out, file)});
  else await page.screenshot({path: path.join(out, file)});
  record(name, file, extra);
};

// 量「⋯」：位置、中心点的 elementsFromPoint 栈、哪些浮着的键盖住了它
const probe = () => {
  const R = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  const name = (n) => n ? (n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '')) : null;
  const box = document.querySelector('.chat-main .agent-chat__composer-controls > .pk-perm-chips');
  const stat = box?.querySelector('.pk-perm-chip--stat');
  const input = box?.closest('.agent-chat__input');
  if (!stat) return {found: false};
  const r = stat.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  const floats = [...(input?.querySelectorAll('button, summary, [role="button"]') || [])].filter((b) => !b.closest('.pk-perm-chips') && /^(?:absolute|fixed)$/.test(getComputedStyle(b).position))
    .map((b) => ({el: name(b), rect: R(b.getBoundingClientRect()), b: b.getBoundingClientRect()})).filter((f) => f.b.width > 0 && f.b.height > 0);
  const coveredBy = floats.filter((f) => Math.min(r.right, f.b.right) - Math.max(r.left, f.b.left) > 1 && Math.min(r.bottom, f.b.bottom) - Math.max(r.top, f.b.top) > 1).map((f) => f.el);
  return {found: true, fold: box.dataset.fold ?? null, dodge: box.dataset.dodge ?? null, padLeft: box.style.paddingLeft || null, label: stat.textContent.trim(),
    stat: R(r), center: [cx, cy], statHit: Boolean(top && stat.contains(top)), top: name(top),
    stack: document.elementsFromPoint(cx, cy).slice(0, 6).map(name), coveredBy, floats: floats.map(({el, rect}) => ({el, rect})),
    chips: R(box.getBoundingClientRect()), inputH: input ? Math.round(input.getBoundingClientRect().height) : null};
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of ['day', 'night']) {
    for (const width of [320, 360]) {
      const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
      const base = `150b-${width}-${theme}`;
      try {
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.setViewportSize({width, height: HEIGHT});
        await page.waitForSelector('.chat-main .agent-chat__composer-controls > .pk-perm-chips', {state: 'attached', timeout: 15_000});
        await page.evaluate(() => window.PinkieMetrePerm?.fit?.());
        await page.waitForTimeout(1800);   // fitSoon 会在 60 / 400 / 1500ms 再量
        const row = await page.evaluate(probe);
        const {center, ...rec} = row;
        await page.mouse.move(0, 0);
        await shoot(page, `${base}-row`, '.chat-main .agent-chat__input', rec);
        let opened = false;
        if (center) {
          await page.mouse.click(...center);
          opened = await page.waitForSelector('.pk-perm-pop--detail', {timeout: 3000}).then(() => true, () => false);
        }
        await page.mouse.move(0, 0);
        await shoot(page, `${base}-detail`, null, {...rec, opened});
        await page.keyboard.press('Escape');
        // 放宽：回到原位
        await page.setViewportSize({width: 820, height: HEIGHT});
        await page.evaluate(() => window.PinkieMetrePerm?.fit?.());
        await page.waitForTimeout(1800);
        const wide = await page.evaluate(probe);
        report.push({theme, width, row: rec, opened, wide: {fold: wide.fold, dodge: wide.dodge, padLeft: wide.padLeft, statHit: wide.statHit}, pageErrors});
      } catch (error) {
        report.push({theme, width, error: error.message, pageErrors});
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
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) {
  if (r.error) console.log(`pr-shots: ${r.theme} ${r.width} 出错：${r.error}`);
  else console.log(`pr-shots: ${r.theme} ${r.width} fold=${r.row.fold} dodge=${r.row.dodge} pad=${r.row.padLeft} statHit=${r.row.statHit} top=${r.row.top} opened=${r.opened} | 820 fold=${r.wide.fold} dodge=${r.wide.dodge} pad=${r.wide.padLeft}`);
}
