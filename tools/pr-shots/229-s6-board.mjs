#!/usr/bin/env node
// #229（feat/engines-s6-board）S6 第 2、3 步接上 linux2 数据层（#231）后的 PR 截图，走 .github/workflows/pr-shots.yml 在 CI 上拍，本机不开浏览器。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/229-s6-board.mjs --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI（tests/visual/lib/real-harness.mjs），只把 sessions.list / exec.approval.list / plugin.approval.list 换成假数据
// （一条等你确认、一条在跑带两个分身、一条排队、一条出错、一条刚做完），别的调用照走真夹具网关。
// 碧琪皮：home-project 场景，① 看板关着、发一次 laolao:sessions-changed 后的侧栏胶囊 ② 点胶囊打开的面板；
// Metre 皮：metre-board 场景，总控台打开到「全部会话」一栏。每格 1440 / 820 × 日 / 夜。
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
  window.__s6Calls = [];
  const fake = (method) => {
    const now = Date.now(), min = 60_000;
    if (method === 'sessions.list') {
      return {sessions: [
        {key: 'agent:project:s6ask', label: '给登录页换蓝色', status: 'running', hasActiveRun: true, startedAt: now - 12 * min, updatedAt: now - min, totalTokens: 41_200, contextTokens: 200_000, model: 'claude-sonnet-4-6'},
        {key: 'agent:metre:dashboard:s6run', label: '整理视觉基线', status: 'running', hasActiveRun: true, startedAt: now - 25 * min, updatedAt: now - 2 * min, totalTokens: 88_000, contextTokens: 200_000, model: 'gemini-3-pro', lastMessagePreview: '在对比 1440 日间的三张图'},
        {key: 'agent:metre:subagent:s6kid1', label: '分身：跑单测', status: 'running', hasActiveRun: true, spawnedBy: 'agent:metre:dashboard:s6run', startedAt: now - 8 * min, updatedAt: now - min},
        {key: 'agent:metre:subagent:s6kid2', label: '分身：查截图', status: 'running', hasActiveRun: true, spawnedBy: 'agent:metre:dashboard:s6run', startedAt: now - 6 * min, updatedAt: now - min},
        {key: 'agent:thinking:s6queued', label: '周报提纲', status: 'queued', updatedAt: now - 3 * min},
        {key: 'agent:learning:s6err', label: '背单词第 3 课', status: 'error', lastRunError: '网关超时', updatedAt: now - 4 * min, totalTokens: 9_800, contextTokens: 128_000},
        {key: 'agent:main:s6done', label: '查一下明天天气', status: 'done', updatedAt: now - 3 * min},
        {key: 'agent:main:s6old', label: '一小时前做完的', status: 'done', updatedAt: now - 60 * min},
      ]};
    }
    if (method === 'exec.approval.list') return {approvals: [{id: 's6a1', request: {sessionKey: 'agent:project:s6ask', command: 'npm run build -- --filter login'}}]};
    if (method === 'plugin.approval.list') return {approvals: []};
    return null;
  };
  // 侧栏一挂上就把 gwRequest 包一层：只接上面三个，别的照走真夹具网关。
  let sidebar;
  Object.defineProperty(window, '__laolaoSidebar', {configurable: true, get: () => sidebar, set(value) {
    sidebar = value;
    if (!value || typeof value.gwRequest !== 'function') return;
    const real = value.gwRequest.bind(value);
    value.gwRequest = (method, params, timeout) => {
      const hit = fake(method);
      if (hit) { window.__s6Calls.push(method); return Promise.resolve(hit); }
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
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)} : null; }, sel);
const rowsOf = (page, sel) => page.$$eval(sel, (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)));

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      // ---- 碧琪皮 ----
      {
        const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'home-project', theme, {initScript});
        const base = `s6-pinkie-${theme}-${width}`;
        try {
          await page.setViewportSize({width, height: HEIGHT});
          await page.waitForTimeout(400);
          const drawer = await openDrawer(page);
          const callsBeforeChange = await page.evaluate(() => window.__s6Calls.slice());
          await page.evaluate(() => window.dispatchEvent(new Event('laolao:sessions-changed')));
          await page.waitForSelector('.pk-sb-pill:not([hidden])', {timeout: 15_000});
          await page.waitForTimeout(300);
          const pill = {rect: await rect(page, '.pk-sb-pill'), text: await page.textContent('.pk-sb-pill'), callsBeforeChange};
          await shoot(page, `${base}-pill`, 'aside.sidebar');
          await page.click('.pk-sb-pill');
          await page.waitForSelector('.pk-sb-panel:not([hidden]) .pk-sb-row', {timeout: 15_000});
          await page.waitForTimeout(500);
          await shoot(page, `${base}-panel`);
          report.push({skin: 'pinkie', theme, width, drawer, pill, panel: await rect(page, '.pk-sb-panel'),
            rows: await rowsOf(page, '.pk-sb-panel .pk-sb-row'), calls: await page.evaluate(() => window.__s6Calls), pageErrors});
        } catch (error) {
          try { await shoot(page, `${base}-error`); } catch {}
          report.push({skin: 'pinkie', theme, width, error: error.message, calls: await page.evaluate(() => window.__s6Calls).catch(() => null), pageErrors});
        } finally {
          await context.close();
        }
      }
      // ---- Metre 皮 ----
      {
        const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
        const base = `s6-metre-${theme}-${width}`;
        try {
          await page.setViewportSize({width, height: HEIGHT});
          await page.evaluate(() => window.__pinkieMetreBoard?.open?.('all'));
          await page.waitForSelector('.pk-sb-metre .pk-sb-row', {timeout: 15_000});
          await page.evaluate(() => document.querySelector('.pk-sb-metre')?.scrollIntoView({block: 'center'}));
          await page.waitForTimeout(500);
          await shoot(page, base);
          report.push({skin: 'metre', theme, width, slot: await rect(page, '.pk-sb-metre'),
            rows: await rowsOf(page, '.pk-sb-metre .pk-sb-row'), calls: await page.evaluate(() => window.__s6Calls), pageErrors});
        } catch (error) {
          try { await shoot(page, `${base}-error`); } catch {}
          report.push({skin: 'metre', theme, width, error: error.message, calls: await page.evaluate(() => window.__s6Calls).catch(() => null), pageErrors});
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
for (const r of report) if (r.error) console.log(`pr-shots: ${r.skin} ${r.theme} ${r.width} 出错：${r.error}`);
