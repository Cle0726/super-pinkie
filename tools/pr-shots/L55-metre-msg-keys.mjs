#!/usr/bin/env node
// L55（T3 #5 / #6，linux/L55-t3-b1）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），不连网关、不碰用户会话。假历史里的消息补上 __openclaw.id，碧琪的「编辑」键才会出来。
// 每格（Metre：1440 / 820 × 日夜；对照：项目模式 long-conversation，1440 × 日夜）拍：
//   msg-keys  助手消息底部只剩一个复制键（T3 #5）；用户消息的「复制」「编辑」点得到、时间戳排在它们左边（T3 #6）
//   msg-edit  点「编辑」后改了重发的编辑框在对话栏里、「发送」看得见（T3 #6，820 宽时改前出界）
// 注入对照：每一格都把 laolao-metre-display.css 临时停用再量一次。
//   项目模式两次必须完全相同（本次改动对其他模式不起作用）；Metre 两次必须不同（改动确实生效）。结果写在 report.json / shots.jsonl。
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

// 假网关的种子历史在 harness 的初始化脚本里赋值；这里在它之后给每条消息补一个 __openclaw.id（碧琪按它判断能不能编辑）。
const initScript = () => {
  const seed = window.__fakeSeedHistory;
  if (Array.isArray(seed)) window.__fakeSeedHistory = seed.map((m, i) => ({...m, __openclaw: {...(m.__openclaw || {}), id: m.__openclaw?.id || `l55-entry-${i}`}}));
};

const HEIGHT = 900;
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

// 按键这一格量的：助手页脚两个复制键各自可见吗；用户消息两个键的中心点是不是点到自己；时间戳右端和按键行左端；页脚右内边距。
const keyState = (page) => page.evaluate(() => {
  const vis = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const hit = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); return n.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); };
  const a = [...document.querySelectorAll('.chat-group.assistant .chat-group-footer-actions')].pop();
  const u = [...document.querySelectorAll('.chat-group.user')].filter((g) => g.querySelector('.pinkie-msg-row')).pop();
  const row = u?.querySelector('.pinkie-msg-row'), ts = u?.querySelector('.chat-group-timestamp');
  const btns = row ? [...row.querySelectorAll('.pinkie-msg-btn')] : [];
  return {
    nativeCopy: vis(a?.querySelector('.chat-copy-btn')), ourCopy: vis(a?.querySelector('.pinkie-msg-row')),
    userKeys: btns.map((b) => b.getAttribute('aria-label') || b.textContent), userKeysHit: btns.map(hit),
    tsRight: ts ? Math.round(ts.getBoundingClientRect().right) : null, rowLeft: row ? Math.round(row.getBoundingClientRect().left) : null,
    footerPadRight: u ? getComputedStyle(u.querySelector('.chat-group-footer') || u).paddingRight : null,
  };
});
// 编辑这一格量的：编辑框左右边和对话栏左右边、编辑框宽、min-width、「发送」可见
const editState = (page) => page.evaluate(() => {
  const box = document.querySelector('.pinkie-msg-edit'), th = document.querySelector('.chat-thread');
  if (!box || !th) return null;
  const b = box.getBoundingClientRect(), t = th.getBoundingClientRect(), s = box.querySelector('.pinkie-msg-edit__send')?.getBoundingClientRect();
  return {l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), thL: Math.round(t.left), thR: Math.round(t.right),
    minWidth: getComputedStyle(box).minWidth, sendVisible: Boolean(s && s.width > 0 && s.right <= innerWidth && s.left >= 0)};
});
const toggleMine = (page, off) => page.evaluate((o) => {
  const l = document.querySelector('link[href*="laolao-metre-display.css"]');
  if (l) l.disabled = o;
  return Boolean(l);
}, off);
const without = async (page, measure) => {
  const found = await toggleMine(page, true);
  await page.waitForTimeout(150);
  const style = await measure(page);
  await toggleMine(page, false);
  await page.waitForTimeout(150);
  return {found, style};
};

async function cell(sceneId, theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, sceneId, theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    const ready = await page.waitForFunction(() => document.querySelector('.chat-group.user .pinkie-msg-row') && document.querySelector('.chat-group.assistant .pinkie-msg-row'), null, {timeout: 15_000})
      .then(() => true, () => false);
    await page.evaluate(() => [...document.querySelectorAll('.chat-group.user')].pop()?.scrollIntoView({block: 'center'}));
    await page.waitForTimeout(500);
    const keys = await keyState(page);
    const keysWithout = await without(page, keyState);
    const keysChanged = JSON.stringify(keys) !== JSON.stringify(keysWithout.style);
    await shot(page, 'msg-keys', theme, width, {mode, ready, keysChanged});

    const editBtn = await page.$('.chat-group.user .pinkie-msg-row .pinkie-msg-btn:nth-child(2)');
    let edit = null, editWithout = null, editChanged = null;
    if (editBtn) {
      await editBtn.click();
      const opened = await page.waitForSelector('.pinkie-msg-edit', {timeout: 5000}).then(() => true, () => false);
      if (opened) {
        await page.evaluate(() => document.querySelector('.pinkie-msg-edit')?.scrollIntoView({block: 'center'}));
        await page.waitForTimeout(300);
        edit = await editState(page);
        editWithout = await without(page, editState);
        editChanged = JSON.stringify(edit) !== JSON.stringify(editWithout.style);
        await shot(page, 'msg-edit', theme, width, {mode, editChanged});
      }
    }
    report.push({scene: sceneId, theme, width, mode, ready, keys, keysWithout, keysChanged, edit, editWithout, editChanged, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await cell('metre-board', theme, width);
    await cell('long-conversation', theme, 1440);
  }
} finally {
  const metre = report.filter((r) => r.mode === 'metre'), others = report.filter((r) => r.mode !== 'metre');
  const verdict = {
    // T3 #5：Metre 下助手消息底部只剩碧琪的复制键
    metreOneCopyKey: metre.every((r) => r.ready && r.keys.nativeCopy !== true && r.keys.ourCopy === true),
    // T3 #6：Metre 下用户消息两个键都点得到、时间戳在左；编辑框在对话栏内、「发送」看得见
    metreUserKeysClickable: metre.every((r) => r.keys.userKeysHit.length >= 2 && r.keys.userKeysHit.every(Boolean) && r.keys.tsRight <= r.keys.rowLeft),
    metreEditInside: metre.every((r) => r.edit && r.edit.l >= r.edit.thL && r.edit.r <= r.edit.thR && r.edit.sendVisible),
    // 注入对照
    otherModesUnchanged: others.every((r) => r.ready && r.keysWithout.found && !r.keysChanged && r.editChanged !== true),
    metreChanged: metre.every((r) => r.keysChanged),
  };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({verdict, cells: report}, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  console.log('L55 注入对照：' + JSON.stringify(verdict));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
