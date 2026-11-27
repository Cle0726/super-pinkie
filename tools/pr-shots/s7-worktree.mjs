#!/usr/bin/env node
// S7（feat/metre-ui2-s7）的 PR 截图脚本，走 .github/workflows/pr-shots.yml 在 CI 上拍，本机不开浏览器。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/s7-worktree.mjs --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI + Metre（tests/visual/lib/real-harness.mjs 的 metre-board 场景，关掉看板），只把 worktrees.list 换成假数据
// （两条会话各开了一个工作树：一条分支 = openclaw/目录，只显示目录；一条分支不同，显示两段；第三条的已移除），别的调用照走真夹具网关。每格（1440 / 820 × 日 / 夜）拍整页 + 侧栏。
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

const initScript = () => {
  const worktrees = [
    {id: 'w1', name: 'login-blue', path: 'F:/work/demo/.openclaw/worktrees/login-blue', branch: 'openclaw/login-blue', ownerKind: 'session', ownerId: 'agent:metre:dashboard:harness0001'},
    {id: 'w2', name: 'baseline-audit', path: 'F:/work/demo/.openclaw/worktrees/baseline-audit', branch: 'feat/baseline', ownerKind: 'session', ownerId: 'agent:metre:dashboard:prev01'},
    {id: 'w3', name: 'gone', path: 'F:/work/demo/.openclaw/worktrees/gone', branch: 'openclaw/gone', ownerKind: 'session', ownerId: 'agent:metre:dashboard:prev02', removedAt: 1},
  ];
  window.__s7Calls = [];
  // 侧栏一挂上就把 gwRequest 包一层：只接 worktrees.list，别的照走真夹具网关。
  let sidebar;
  Object.defineProperty(window, '__laolaoSidebar', {configurable: true, get: () => sidebar, set(value) {
    sidebar = value;
    if (!value || typeof value.gwRequest !== 'function') return;
    const real = value.gwRequest.bind(value);
    value.gwRequest = (method, params, timeout) => {
      if (method === 'worktrees.list') { window.__s7Calls.push(method); return Promise.resolve({worktrees}); }
      return real(method, params, timeout);
    };
  }});
};

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

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
      try {
        await page.setViewportSize({width, height: HEIGHT});
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.evaluate(() => window.PinkieSessionList?.invalidate?.());
        await page.waitForTimeout(400);
        // 窄宽下侧栏是抽屉：先点原生「展开侧边栏」，等侧栏滑到 x >= 0 再拍（同 tests/metre-workspace-real.test.mjs）
        const drawer = await page.evaluate(() => Math.round(document.querySelector('aside.sidebar')?.getBoundingClientRect().left ?? -9999) < 0);
        if (drawer) {
          await page.click('button[aria-label="展开侧边栏"]');
          await page.waitForFunction(() => document.querySelector('aside.sidebar')?.getBoundingClientRect().left >= 0, null, {timeout: 5_000});
          await page.waitForTimeout(400);
        }
        await page.waitForSelector('aside.sidebar .pk-ml-wt', {state: 'attached', timeout: 15_000});
        if (!drawer) await page.mouse.move(width - 2, HEIGHT - 2);   // 抽屉开着时别点到遮罩上
        await page.waitForTimeout(500);
        const base = `s7-${theme}-${width}`;
        await shoot(page, base);
        const sidebarVisible = await page.evaluate(() => { const r = document.querySelector('aside.sidebar')?.getBoundingClientRect(); return Boolean(r && r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1); });
        if (sidebarVisible) await shoot(page, `${base}-sidebar`, 'aside.sidebar');
        report.push({theme, width, drawer, calls: await page.evaluate(() => window.__s7Calls), sidebarVisible,
          rows: await page.evaluate(() => [...document.querySelectorAll('aside.sidebar .session-row-host[data-session-key]')].map((n) => {
            const tag = n.querySelector('.pk-ml-wt'), text = tag?.querySelector('.pk-ml-wt__text'), name = n.querySelector('.sidebar-recent-session__name');
            const s = tag && getComputedStyle(tag), r = tag?.getBoundingClientRect(), xr = text?.getBoundingClientRect(), lr = n.querySelector('.sidebar-recent-session__link')?.getBoundingClientRect();
            // 小字折到第二行（被裁掉）就算没显示
            const shown = Boolean(r && xr && xr.width > 0 && xr.top - r.top < r.height - 1);
            return {key: n.dataset.sessionKey, visible: n.getClientRects().length > 0, name: name?.textContent || '', tag: text?.textContent ?? null, shown, color: s?.color, font: s?.font,
              textW: shown ? Math.round(xr.width) : 0, textFullW: text ? text.scrollWidth : null, linkW: lr ? Math.round(lr.width) : null,
              nameW: name ? name.clientWidth : null, nameFullW: name ? name.scrollWidth : null, nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : null};
          })), pageErrors});
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
for (const r of report) if (r.error) console.log(`pr-shots: ${r.theme} ${r.width} 出错：${r.error}`);
