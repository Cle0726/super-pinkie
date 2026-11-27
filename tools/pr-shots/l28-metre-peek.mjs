#!/usr/bin/env node
// L28（#96，T3 #16 Metre 侧栏悬停预览卡，linux/L28）的 PR 截图脚本，走 .github/workflows/pr-shots.yml 在 CI 上拍，本机不开浏览器。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/l28-metre-peek.mjs --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI + Metre（tests/visual/lib/real-harness.mjs 的 metre-board 场景，关掉看板），会话行用夹具网关自带的假会话
// （带 lastMessagePreview / updatedAt），不另造数据。每格（1440 / 820 × 日 / 夜）：
//   1. 指针停在一条会话行上，等卡片出来，拍整页 + 侧栏到卡片那一块，量卡片位置 / 对比度 / 有没有挡住行、出没出窗口；
//   2. 指针移开，确认卡片收起；
//   3. 键盘把焦点放到会话链接（focus-visible），等卡片出来再拍一次；按 Esc，确认收起、侧栏还在。
// 窄宽度侧栏是抽屉：先点原生「展开侧边栏」，等侧栏滑到 x >= 0（同 s7-worktree.mjs）；开不了就照实记 drawerFailed，不硬拍。
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
const ROW = 'aside.sidebar .session-row-host[data-session-key]';
const lines = [], report = [];

const record = (name, file) => {
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
const shoot = async (page, name, clip) => {
  const file = `${name}.png`;
  await page.screenshot({path: path.join(out, file), ...(clip ? {clip} : {})});
  record(name, file);
};

// 卡片量一次：位置、是否在窗口里、是否盖住了悬停的那一行、字色 / 底色对比度、内容
const MEASURE = (rowSel) => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const card = document.querySelector('.pk-mpeek');
  if (!card) return {open: false};
  const r = card.getBoundingClientRect(), cs = getComputedStyle(card), bg = parse(cs.backgroundColor);
  // 同一个 key 可能有一个隐藏的同名节点排在前面：只量看得见的那一行
  const hostEl = [...document.querySelectorAll(rowSel)].find((n) => n.getClientRects().length && n.getBoundingClientRect().width > 0) || null;
  const row = hostEl?.getBoundingClientRect();
  const side = document.querySelector('aside.sidebar')?.getBoundingClientRect();
  const part = (sel) => { const n = card.querySelector(sel); return n ? {text: n.textContent, contrast: bg ? Number(ratio(parse(getComputedStyle(n).color), bg).toFixed(2)) : null} : null; };
  return {
    open: true, rect: {left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height)},
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
    coversRow: Boolean(row && r.left < row.right && r.right > row.left && r.top < row.bottom && r.bottom > row.top),
    rightOfSidebar: Boolean(side && r.left >= side.right),
    pointerEvents: cs.pointerEvents,
    title: part('.pk-mpeek__title'), text: part('.pk-mpeek__text'), meta: part('.pk-mpeek__meta'),
    describedBy: hostEl?.querySelector(':scope > .sidebar-recent-session__link')?.getAttribute('aria-describedby') || null,
  };
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
      const entry = {theme, width, pageErrors};
      try {
        await page.setViewportSize({width, height: HEIGHT});
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.evaluate(() => window.PinkieSessionList?.invalidate?.());
        await page.waitForTimeout(400);
        const drawer = await page.evaluate(() => Math.round(document.querySelector('aside.sidebar')?.getBoundingClientRect().left ?? -9999) < 0);
        entry.drawer = drawer;
        if (drawer) {
          await page.click('button[aria-label="展开侧边栏"]');
          await page.waitForFunction(() => document.querySelector('aside.sidebar')?.getBoundingClientRect().left >= 0, null, {timeout: 5_000});
          await page.waitForTimeout(400);
        }
        await page.waitForFunction(() => typeof window.Pinkie?.metrePeek?.mark === 'function', null, {timeout: 10_000});
        // 挑一条有摘要的假会话（prev01），没有就第一条看得见的行
        const key = await page.evaluate((sel) => {
          const rows = [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length && n.getBoundingClientRect().width > 0);
          return (rows.find((n) => /prev01$/.test(n.dataset.sessionKey)) || rows[0])?.dataset.sessionKey || null;
        }, ROW);
        entry.key = key;
        if (!key) throw new Error('侧栏里没有看得见的会话行');
        const rowSel = `${ROW}[data-session-key="${key}"]`;
        const base = `l28-${theme}-${width}`;

        // 1. 悬停。同一个 key 在 aside.sidebar 里能匹配到两个节点，第一个是隐藏的（run 46027036797：
        // page.hover 取第一个，报 element is not visible）；上面挑行只看可见行，这里按 key 重新找节点时也只取可见的那个。
        await page.locator(rowSel + ' .sidebar-recent-session__name:visible').first().hover();
        await page.waitForSelector('.pk-mpeek', {state: 'visible', timeout: 5_000});
        await page.waitForTimeout(250);   // 入场动画 120ms 走完（场景已开减少动效，这里只是保险）
        entry.hover = await page.evaluate(MEASURE, rowSel);
        await shoot(page, `${base}-hover`);
        const box = entry.hover.rect;
        if (box) await shoot(page, `${base}-hover-zoom`, {x: 0, y: Math.max(0, box.top - 60), width: Math.min(width, box.left + box.width + 24), height: Math.min(HEIGHT - Math.max(0, box.top - 60), box.height + 140)});

        // 2. 移开
        await page.mouse.move(width - 4, HEIGHT - 4);
        await page.waitForTimeout(150);
        entry.afterLeave = await page.evaluate(() => Boolean(document.querySelector('.pk-mpeek')));

        // 3. 键盘
        await page.keyboard.press('Shift');   // 最近一次交互是键盘：随后的程序聚焦按 :focus-visible 算（同键盘 Tab 过来）
        await page.locator(rowSel + ' > .sidebar-recent-session__link:visible').first().focus();   // 同上：只取可见的那个
        entry.focusVisible = await page.evaluate(() => document.activeElement?.matches?.(':focus-visible') ?? null);
        const opened = await page.waitForSelector('.pk-mpeek', {state: 'visible', timeout: 3_000}).then(() => true, () => false);
        entry.keyboard = opened ? await page.evaluate(MEASURE, rowSel) : {open: false};
        if (opened) { await page.waitForTimeout(250); await shoot(page, `${base}-focus`); }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        entry.afterEsc = {card: await page.evaluate(() => Boolean(document.querySelector('.pk-mpeek'))),
          sidebarShown: await page.evaluate(() => { const r = document.querySelector('aside.sidebar')?.getBoundingClientRect(); return Boolean(r && r.width > 0 && r.left >= 0); })};
      } catch (error) {
        entry.error = error.message;
      } finally {
        report.push(entry);
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
