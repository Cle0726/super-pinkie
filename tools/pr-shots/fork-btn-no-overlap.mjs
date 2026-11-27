#!/usr/bin/env node
// fork-btn-no-overlap（#437 审图遗留）给 uireview / 协调者看图和数值用，走 .github/workflows/pr-shots.yml 在 CI 上拍。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/fork-btn-no-overlap.mjs --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真装的 Control UI，非 Metre，short / long-conversation × 1440 / 820 × 日 / 夜，每页挑塞回气泡后压字最多的那组，悬停后只截这一组：
//   after  = 本分支现状（键在回答下方操作栏）；
//   before = 同一组按 main 的挂法在气泡右上角放一个外形相同的键（换了类名，session-cards.js 的整理不会收走它），页脚键藏起来。
// shots.jsonl 每行多一个 overText 字段（键与正文叶子元素交叠面积，与复发测试同一量法）。不连真网关、不改基线。
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
const F = await import(pathToFileURL(path.join(root, 'tests/visual/lib/fork-action-overlap.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const HEIGHT = 900;
const lines = [];

// origin/main 的写法，类名换成 pk-shot-main-fork。
const MAIN_CSS = `
.chat-group.assistant .chat-bubble > .pk-shot-main-fork { position:absolute;top:2px;right:4px;min-height:28px;padding:0 7px;border-radius:6px;background:var(--pinkie-card-action-bg,#fffafb);color:var(--accent,#d9508d);font-size:12px;opacity:0;pointer-events:none }
html[data-pinkie-night] .chat-group.assistant .pk-shot-main-fork { --pinkie-card-action-bg:#30232d }
.chat-group.assistant .chat-bubble:is(:hover,:focus-within) > .pk-shot-main-fork { opacity:1;pointer-events:auto }
.chat-group.assistant .chat-group-footer .pinkie-fork-action { visibility:hidden !important }`;

function putMain(index) {
  const key = document.querySelectorAll('.chat-group.assistant .chat-group-footer .pinkie-fork-action')[index];
  const group = key.closest('.chat-group');
  const bubble = group.querySelector(`.chat-bubble[data-message-id="${CSS.escape(key.dataset.messageId || '')}"]`);
  const fake = key.cloneNode(true);
  fake.classList.replace('pinkie-fork-action', 'pk-shot-main-fork');
  bubble.append(fake);
  const q = fake.getBoundingClientRect();
  const overText = [...group.querySelectorAll('.chat-text')].flatMap((t) => [...t.querySelectorAll('*'), t]).reduce((sum, el) => {
    if (el.children.length) return sum;
    const r = el.getBoundingClientRect();
    return sum + Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top)) * Math.max(0, Math.min(q.right, r.right) - Math.max(q.left, r.left));
  }, 0);
  return Math.round(overText);
}

const shoot = async (page, name, index, overText) => {
  const group = page.locator('.chat-group.assistant:has(.chat-group-footer .pinkie-fork-action)').nth(index);
  const r = await group.boundingBox();
  const pad = 8;
  const y = Math.max(0, r.y - pad);
  const clip = {x: Math.max(0, r.x - pad), y, width: r.width + pad * 2, height: Math.min(HEIGHT, r.y + r.height + pad) - y};
  const file = `${name}.png`;
  await page.screenshot({path: path.join(out, file), clip, scale: 'device', animations: 'disabled'});
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), overText});
  console.log(`pr-shots: ${name} overText=${overText}`);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const scene of F.SCENES) {
    for (const width of [1440, 820]) {
      for (const theme of ['day', 'night']) {
        const {context, page, pageErrors} = await F.openScene(browser, server.origin, scene, theme, width);
        try {
          const count = await page.locator(F.FOOTER_KEY).count();
          let pick = 0;
          let worst = -1;
          for (let i = 0; i < count; i += 1) {
            await F.hoverKeyGroup(page, i);
            const old = await page.evaluate(F.measureKey, {index: i, asMain: true});
            if (old.overText > worst) { worst = old.overText; pick = i; }
          }
          const base = `fork-btn-${scene}-${width}-${theme}`;
          await F.hoverKeyGroup(page, pick);
          const now = await page.evaluate(F.measureKey, {index: pick});
          await shoot(page, `${base}-after`, pick, now.overText);
          await page.addStyleTag({content: MAIN_CSS});
          const before = await page.evaluate(putMain, pick);
          await F.hoverKeyGroup(page, pick, {force: true}); // 改前的键就压在正文上，会挡住普通悬停
          await shoot(page, `${base}-before`, pick, before);
          if (pageErrors.length) throw new Error(`${base} 页面报错：${pageErrors.join(' | ').slice(0, 300)}`);
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
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
