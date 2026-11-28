#!/usr/bin/env node
// L31（T3 #20 后台会话做完提醒，linux/L31）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）。在页面里派发 pinkie:gateway-event，当作侧栏里另一条会话（prev01）一轮做完；
// sessions.patch 在页面里接住，改 __fakeExtraSessions 里那一条的 unread，下一次 sessions.list 就带着它。不连网关、不碰用户会话。
// 每格（Metre 1440 / 820 × 日夜）拍：
//   notify-unread   后台会话做完、你在看别的会话 → 那一行会话名加粗 + 左边记号位一个空心圈
//   notify-read     打开那个会话以后：unread 被原有的已读逻辑清掉，圈消失
//   notify-classic  对照：项目模式（long-conversation，1440 × 日夜）同样的事件，新文件不记未读、不改样式
// Metre 1440 每格另测一次「页面看不见」（document.hidden 临时置真）：标题前缀、系统通知（页面里的 Notification 桩）、回来后标题恢复。
// 注入对照：每格把 laolao-metre-notify.css 停用再量一次那一行的计算样式；项目模式前后必须完全相同、Metre 必须不同。
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

// 页面里：fake-gateway.js 赋 window.WebSocket 时接住它，只接 sessions.patch 的 unread；其余照旧交给假网关。写法同 L24 / 218。
// Notification 换成记录用的桩（已授权），看系统通知发没发、发了什么。
const initScript = new Function(`const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__l31Shots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function l31Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && f.method === 'sessions.patch' && f.params && typeof f.params.unread === 'boolean') {
      const p = f.params;
      (window.__l31Patches ||= []).push({key: p.key, unread: p.unread});
      const row = (window.__fakeExtraSessions || []).find((s) => s.key === p.key);
      if (row) row.unread = p.unread;
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: {ok: true, key: p.key}}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__l31Shots = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});
class L31Note { constructor(title, o) { (window.__l31Notes ||= []).push({title, body: o && o.body, tag: o && o.tag}); } static requestPermission() { return Promise.resolve('granted'); } }
L31Note.permission = 'granted';
window.Notification = L31Note;`);

const HEIGHT = 900;
const TEXT = '清单整理好了，放在 docs/release.md。另外补了两条。';
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const shot = async (page, name, theme, width, extra = {}) => {
  const file = `${name}-${width}-${theme}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name: `${name}-${width}-${theme}`, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};

const keyFor = (page, suffix) => page.evaluate((s) => (window.__fakeExtraSessions || []).find((x) => x.key.endsWith(':' + s))?.key || '', suffix);
const fireDone = (page, key, runId) => page.evaluate(({key, runId, text}) => {
  const fire = (event, payload) => window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event, payload}}));
  fire('agent', {sessionKey: key, runId, stream: 'lifecycle', data: {phase: 'start'}});
  fire('chat', {sessionKey: key, runId, state: 'final', message: {role: 'assistant', content: [{type: 'text', text}]}});
}, {key, runId, text: TEXT});
const waitUnread = (page, key, want) => page.waitForFunction(({key, want}) => {
  const row = [...document.querySelectorAll('.session-row-host[data-session-key]')].find((n) => n.dataset.sessionKey === key);
  return Boolean(row) && row.classList.contains('pk-ml-unread') === want;
}, {key, want}, {timeout: 15_000}).then(() => true, () => false);
// 那一行（行、左边记号、会话名、会话名前的伪元素）的计算样式
const rowStyle = (page, key) => page.evaluate((key) => {
  const row = [...document.querySelectorAll('.session-row-host[data-session-key]')].find((n) => n.dataset.sessionKey === key);
  if (!row) return null;
  const pick = (n, pseudo) => { if (!n) return null; const s = getComputedStyle(n, pseudo); return [s.boxShadow, s.backgroundColor, s.fontWeight, s.color, s.content, s.width, s.height, s.display]; };
  const dot = row.querySelector(':scope > .pk-ml-dot'), name = row.querySelector('.sidebar-recent-session__name');
  const r = row.getBoundingClientRect();
  return {cls: row.className, dotState: dot?.dataset.state || null, dot: pick(dot), name: pick(name), nameBefore: pick(name, '::before'), row: pick(row),
    visible: r.width > 0 && r.right > 0 && r.left < window.innerWidth};
}, key);
const withoutMine = async (page, key) => {
  const found = await page.evaluate(() => { const l = document.querySelector('link[href*="laolao-metre-notify.css"]'); if (l) l.disabled = true; return Boolean(l); });
  await page.waitForTimeout(100);
  const style = await rowStyle(page, key);
  await page.evaluate(() => { const l = document.querySelector('link[href*="laolao-metre-notify.css"]'); if (l) l.disabled = false; });
  await page.waitForTimeout(100);
  return {found, style};
};
const patches = (page) => page.evaluate(() => window.__l31Patches || []);

async function cell(sceneId, theme, width, {metre}) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, sceneId, theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    // 场景 metre-board 会先打开总谱（占右侧）；关掉它，拍侧栏和对话区。
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    const key = await keyFor(page, 'prev01');
    await fireDone(page, key, 'l31-run-1');
    const marked = metre ? await waitUnread(page, key, true) : (await page.waitForTimeout(1500), false);
    await page.waitForTimeout(400);
    const style = await rowStyle(page, key);
    const without = await withoutMine(page, key);
    const changedByMine = JSON.stringify(style) !== JSON.stringify(without.style);
    const sent = await patches(page);
    const unreadPatches = sent.filter((p) => p.key === key && p.unread === true).length;
    await shot(page, metre ? 'notify-unread' : 'notify-classic', theme, width, {mode, marked, changedByMine, linked: without.found, unreadPatches});
    report.push({scene: sceneId, theme, width, step: 'unread', mode, key, marked, unreadPatches, style, withoutMine: without, changedByMine});
    if (!metre) { report.push({scene: sceneId, theme, width, step: 'errors', pageErrors}); return; }

    // 打开那个会话：原生 markSessionRead / laolao-session-list.js 的 readCurrent 把 unread 清掉
    await page.evaluate((k) => window.__laolaoSidebar?.navigateSession?.(k), key);
    const cleared = await waitUnread(page, key, false);
    await page.waitForTimeout(600);
    await shot(page, 'notify-read', theme, width, {mode, cleared});
    report.push({scene: sceneId, theme, width, step: 'read', mode, key, cleared, style: await rowStyle(page, key), patches: await patches(page)});

    if (width === 1440) {
      const other = await keyFor(page, 'prev02');
      const hidden = await page.evaluate(async ({key, text}) => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
        const before = document.title;
        window.dispatchEvent(new CustomEvent('pinkie:run-recovered', {detail: {sessionKey: key, runId: 'l31-hidden', outcome: 'done', text, startedAt: Date.now() - 90_000}}));
        await wait(300);
        const titled = document.title;
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
        await wait(100);
        const native = Boolean(window.webkit?.messageHandlers?.pinkieNotify) || typeof window.pywebview?.api?.notify === 'function';
        return {before, titled, after: document.title, notes: window.__l31Notes || [], native};
      }, {key: other, text: TEXT});
      report.push({scene: sceneId, theme, width, step: 'hidden', mode, key: other, ...hidden});
    }
    report.push({scene: sceneId, theme, width, step: 'errors', pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await cell('metre-board', theme, width, {metre: true});
    await cell('long-conversation', theme, 1440, {metre: false});
  }
} finally {
  const unread = report.filter((r) => r.step === 'unread');
  const metreCells = unread.filter((r) => r.mode === 'metre'), others = unread.filter((r) => r.mode !== 'metre');
  const hidden = report.filter((r) => r.step === 'hidden');
  const verdict = {
    metreMarked: metreCells.length > 0 && metreCells.every((r) => r.marked && r.unreadPatches === 1),
    metreChangedByCss: metreCells.length > 0 && metreCells.every((r) => r.changedByMine),
    readClears: report.filter((r) => r.step === 'read').every((r) => r.cleared),
    otherModesUnchanged: others.length > 0 && others.every((r) => r.withoutMine.found && !r.changedByMine && r.unreadPatches === 0),
    hiddenNotified: hidden.length > 0 && hidden.every((h) => h.titled.startsWith('✓ ') && h.after === h.before && (h.native || h.notes.length === 1)),
  };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({verdict, cells: report}, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  console.log('L31 注入对照：' + JSON.stringify(verdict));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
