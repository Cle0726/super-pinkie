#!/usr/bin/env node
// L29（T3 #17 归档后可撤销，linux/L29）的 PR 截图脚本，走 .github/workflows/pr-shots.yml 在 CI 上拍，本机不开浏览器。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/l29-metre-undo.mjs --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI（tests/visual/lib/real-harness.mjs）：
//   - Metre（metre-board 场景，关掉看板）：悬停一行不是当前会话的会话，点它的「归档」小键（laolao-metre-list.js → archiveWithUndo），
//     等「已归档 · 撤销」条出来，拍整页 + 撤销条，量条和「撤销」键的颜色、对比度、有没有出屏。夹具网关对 sessions.patch / lineage 回 {}，不会真改数据。
//   - 对照（sidebar-expanded 场景，项目模式）：照 showArchiveUndo 的结构放一条撤销条，量计算样式，应当还是 laolao-sidebar.css 的碧琪粉，
//     证明 laolao-metre-undo.css 在其他模式一条都不命中。
// 每格 1440 / 1024 / 820 × 日 / 夜。
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
const HEIGHT = 800;
const lines = [], report = [];

const record = (name, file) => {
  const buf = fs.readFileSync(path.join(out, file));
  // PNG IHDR：宽在 16–19 字节，高在 20–23 字节
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
const shoot = async (page, name, sel) => {
  const file = `${name}.png`;
  if (sel) await page.locator(sel).first().screenshot({path: path.join(out, file)});
  else await page.screenshot({path: path.join(out, file)});
  record(name, file);
};

// 撤销条和「撤销」键的计算样式 + 对比度（WCAG 相对亮度）
const measureBar = (page) => page.evaluate(() => {
  const bar = document.querySelector('.pinkie-archive-undo');
  if (!bar) return null;
  const btn = bar.querySelector('button');
  const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => { const v = rgb(c).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const bs = getComputedStyle(bar), ks = btn && getComputedStyle(btn), r = bar.getBoundingClientRect();
  return {text: bar.textContent, background: bs.backgroundColor, color: bs.color, border: bs.border, radius: bs.borderRadius, shadow: bs.boxShadow, font: bs.font,
    button: ks && {text: btn.textContent, label: btn.getAttribute('aria-label'), color: ks.color, background: ks.backgroundColor},
    textContrast: ratio(bs.color, bs.backgroundColor), buttonContrast: ks ? ratio(ks.color, bs.backgroundColor) : null,
    rect: {left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height)},
    onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    mode: document.documentElement.getAttribute('data-laolao-mode')};
});

const openDrawer = async (page) => {
  // 窄宽下侧栏是抽屉：先点原生「展开侧边栏」，等侧栏滑到 x >= 0（同 s7-worktree.mjs）
  const drawer = await page.evaluate(() => Math.round(document.querySelector('aside.sidebar')?.getBoundingClientRect().left ?? -9999) < 0);
  if (drawer) {
    await page.click('button[aria-label="展开侧边栏"]');
    await page.waitForFunction(() => document.querySelector('aside.sidebar')?.getBoundingClientRect().left >= 0, null, {timeout: 5_000});
    await page.waitForTimeout(400);
  }
  return drawer;
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 1024, 820]) {
      // 1. Metre：真点「归档」小键
      {
        const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
        try {
          await page.setViewportSize({width, height: HEIGHT});
          await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
          await page.evaluate(() => window.PinkieSessionList?.invalidate?.());
          await page.waitForTimeout(400);
          const drawer = await openDrawer(page);
          await page.waitForSelector('aside.sidebar .session-row-host[data-session-key] .pk-ml-act[aria-label="归档"]', {state: 'attached', timeout: 15_000});
          // 归档一行不是当前会话的，免得 followAfterSessionLeaves 去开新会话
          const key = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('aside.sidebar .session-row-host[data-session-key]')].filter((n) => n.querySelector('.pk-ml-act[aria-label="归档"]'));
            const row = rows.find((n) => !n.classList.contains('sidebar-recent-session--active')) || rows[0];
            return row?.dataset.sessionKey || '';
          });
          const row = page.locator(`aside.sidebar .session-row-host[data-session-key="${key}"]`).first();
          await row.hover();
          await row.locator('.pk-ml-act[aria-label="归档"]').click({force: true});
          await page.waitForSelector('.pinkie-archive-undo', {timeout: 10_000});
          await page.waitForTimeout(300);
          const base = `l29-metre-${theme}-${width}`;
          await shoot(page, base);
          await shoot(page, `${base}-undo`, '.pinkie-archive-undo');
          // 键盘焦点：Tab 到「撤销」键再拍一张，看钴蓝焦点框
          await page.focus('.pinkie-archive-undo button');
          await page.keyboard.press('Shift');
          await shoot(page, `${base}-undo-focus`, '.pinkie-archive-undo');
          report.push({scene: 'metre', theme, width, drawer, archivedKey: key, bar: await measureBar(page), pageErrors});
        } catch (error) {
          report.push({scene: 'metre', theme, width, error: error.message, pageErrors});
        } finally {
          await context.close();
        }
      }
      // 2. 对照：项目模式里同结构的撤销条，样式应当原样（碧琪粉）
      {
        const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'sidebar-expanded', theme);
        try {
          await page.setViewportSize({width, height: HEIGHT});
          await page.evaluate(() => {
            // 和 laolao-sidebar.js showArchiveUndo 一样的结构；不调它（没暴露），也就不会动会话
            const bar = document.createElement('div'); bar.className = 'pinkie-archive-undo'; bar.setAttribute('role', 'status');
            const text = document.createElement('span'); text.textContent = '已归档';
            const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = '撤销'; undo.setAttribute('aria-label', '撤销归档');
            bar.append(text, undo); document.body.append(bar);
          });
          await page.waitForTimeout(200);
          const base = `l29-control-${theme}-${width}`;
          await shoot(page, `${base}-undo`, '.pinkie-archive-undo');
          report.push({scene: 'control-project', theme, width, bar: await measureBar(page),
            metreUndoSheetLoaded: await page.evaluate(() => [...document.styleSheets].some((s) => /laolao-metre-undo\.css/.test(s.href || ''))), pageErrors});
        } catch (error) {
          report.push({scene: 'control-project', theme, width, error: error.message, pageErrors});
        } finally {
          await context.close();
        }
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
for (const r of report) if (r.error) console.log(`pr-shots: ${r.scene} ${r.theme} ${r.width} 出错：${r.error}`);
