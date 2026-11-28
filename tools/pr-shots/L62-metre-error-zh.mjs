#!/usr/bin/env node
// L62（#96 P4）的 PR 截图脚本（照 tools/pr-shots/minimal.mjs 的约定：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl）。
// 拍三处网关出错时的界面：Metre 审批卡里「其余在等你批的」一行点「允许一次」失败、设置里「允许的命令」卡读不到设置、
// 解锁框提交时网关超时。修复前分别显示「没批成：gateway timeout」「读不到审批设置：gateway socket unavailable」
// 「gateway timeout」；修复后只显示中文，原文进 console.warn。每处拍 640 × 日 / 夜，共 6 张。
// shots.jsonl 每行另记 text（界面上实际显示的那句）和 leak（是否还有英文原文 / undefined / [object Object]）。
// 页面只放原生外壳节点、假网关（只在页面里回）和真的注入文件。不连网关、不碰用户会话。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

const read = (name) => fs.readFileSync(fileURLToPath(new URL('../../ui/injections/' + name, import.meta.url)), 'utf8');
const SK = 'agent:metre:dashboard:t1';
const LEAK = /gateway|timeout|socket|unavailable|undefined|\[object/i;
// Metre 的日夜变量（同 tests/metre-perm.test.mjs）
const VARS = `
  html[data-laolao-mode]{--metre-bg:#F7F6F3;--metre-surface:#FFFFFF;--metre-text:#1B1A18;--metre-muted:#77736B;--metre-line:#E4E2DC;--metre-line-strong:#D3D0C8;--metre-hover:#EFEDE8;--metre-danger:#A8432F;--metre-cobalt:#2F4BB0;--metre-sans:sans-serif;--metre-serif:serif;--metre-mono:monospace}
  html[data-laolao-mode][data-pinkie-night]{--metre-bg:#151514;--metre-surface:#232321;--metre-text:#ECEAE4;--metre-muted:#918D84;--metre-line:#272725;--metre-line-strong:#393835;--metre-hover:#1F1F1D;--metre-danger:#D0705A;--metre-cobalt:#8496E6}
  body{margin:0;padding:16px;background:var(--metre-bg,#fff);color:var(--metre-text);font-family:var(--metre-sans)}`;
const shell = (mode, night, body) => `<!doctype html><html data-laolao-mode="${mode}"${night ? ' data-pinkie-night' : ''} lang="zh-CN"><head><style>${VARS}</style></head><body>${body}</body></html>`;

// 假网关：失败的那个方法抛给定的英文原文，其余照 tools/pr-shots/159-perm-key.mjs 回
const stubs = (failing, raw) => `
  window.__resp = {
    'pinkie.metre.planMode.get': () => ({on: false}),
    'pinkie.plan.get': () => ({plan: null}),
    'usage.status': () => ({providers: []}),
    'sessions.usage': () => ({sessions: []}),
    'pinkie.project.bind': () => ({binding: null}),
    'exec.approvals.get': () => ({exists: true, hash: 'h1', file: {version: 1, agents: {metre: {security: 'allowlist', ask: 'on-miss', allowlist: [{id: 'a1', pattern: 'git'}]}}}}),
    'pinkie.model.failure': () => ({failure: null}),
    'pinkie.guard.metreStatus': () => ({required: true, unlocked: false, locked: true, configured: true, remainingAttempts: 5, lockedUntil: 0}),
  };
  window.__warned = [];
  const warn = console.warn.bind(console); console.warn = (...a) => { window.__warned.push(a.map((x) => String(x?.message ?? x)).join(' ')); warn(...a); };
  window.__laolaoSidebar = {gwRequest: async (method, params) => {
    if (method === ${JSON.stringify(failing)}) throw new Error(${JSON.stringify(raw)});
    const f = window.__resp[method]; return f ? f(params || {}) : {};
  }, toast() {}, navigateSession() {}};
  window.__laolaoToast = () => {};
  document.title = 'Metre';
`;

const SCENES = [
  {
    name: 'L62-approval-row', mode: 'metre', failing: 'exec.approval.resolve', raw: 'gateway timeout',
    css: ['laolao-metre-engine.css', 'laolao-metre-perm.css'], js: ['laolao-metre-perm.js'],
    body: `<div class="chat-main"><openclaw-chat-pane></openclaw-chat-pane></div>
<openclaw-exec-approval><div class="exec-approval-card"><div class="exec-approval-header"><div><div class="exec-approval-title">Exec approval needed</div><div class="exec-approval-sub">expires in 2m</div></div><div class="exec-approval-queue">2 pending</div></div>
<div class="exec-approval-command mono">npm test</div><div class="exec-approval-actions"><button class="btn primary">允许一次</button><button class="btn">始终允许</button><button class="btn danger">拒绝</button></div></div></openclaw-exec-approval>`,
    async act(p) {
      await p.evaluate((sk) => {
        document.querySelector('openclaw-chat-pane').state = {sessionKey: sk};
        const mk = (id, command) => ({id, kind: 'exec', request: {command, sessionKey: sk, allowedDecisions: ['allow-once', 'deny']}, createdAtMs: 1, expiresAtMs: Date.now() + 1e5});
        document.querySelector('openclaw-exec-approval').props = {queue: [mk('a1', 'npm test'), mk('a2', 'rm -rf build')]};
        window.PinkieMetrePerm.paintApproval();
      }, SK);
      await p.click('.pk-perm-q__btn--yes');
      await p.waitForSelector('.pk-perm-q__row[data-error]', {timeout: 5000});
      return p.$eval('.pk-perm-q__row[data-error]', (e) => e.dataset.error);
    },
  },
  {
    name: 'L62-allow-card', mode: 'metre', failing: 'exec.approvals.get', raw: 'gateway socket unavailable',
    css: ['laolao-settings-user.css', 'laolao-metre-allow.css'], js: ['laolao-metre-allow.js'],
    body: `<div id="laolao-user-settings"><div class="pinkie-user-settings__scroll"><footer class="pinkie-user-settings__footer"></footer></div></div>`,
    async act(p) {
      await p.waitForFunction(() => /读不到/.test(document.querySelector('.pk-metre-allow__status')?.textContent || ''), null, {timeout: 5000});
      return p.$eval('.pk-metre-allow__status', (e) => e.textContent);
    },
  },
  {
    // 解锁框是从别的模式切进 Metre 时弹的，所以页面在「对话」模式
    name: 'L62-lock-dialog', mode: 'chat', failing: 'pinkie.guard.metreUnlock', raw: 'gateway timeout',
    css: ['laolao-metre-lock.css'], js: ['laolao-metre-lock.js'], body: '',
    async act(p) {
      await p.evaluate(() => { void window.__pinkieMetreLock.ensureUnlocked(); });
      await p.waitForSelector('.laolao-metre-lock-dialog__input', {timeout: 5000});
      await p.fill('.laolao-metre-lock-dialog__input', 'not-the-password');
      await p.click('.laolao-metre-lock-dialog__btn--primary');
      await p.waitForFunction(() => (document.querySelector('.laolao-metre-lock-dialog__error')?.textContent || '').length > 0 && document.querySelector('.laolao-metre-lock-dialog__btn--primary')?.textContent === '解锁', null, {timeout: 5000});
      await p.evaluate(() => document.activeElement?.blur?.());
      return p.$eval('.laolao-metre-lock-dialog__error', (e) => e.textContent);
    },
  },
];

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const channel = process.env.PINKIE_UI_CHANNEL;
const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' && channel ? {channel} : {})});
const lines = [];
let leaked = 0;
try {
  for (const scene of SCENES) for (const night of [false, true]) {
    const width = 640, height = 420, name = `${scene.name}-${night ? 'night' : 'day'}`;
    const p = await browser.newPage({viewport: {width, height}, colorScheme: night ? 'dark' : 'light', locale: 'zh-CN'});
    try {
      await p.setContent(shell(scene.mode, night, scene.body));
      await p.addScriptTag({content: stubs(scene.failing, scene.raw)});
      for (const c of scene.css) await p.addStyleTag({content: read(c)});
      for (const j of scene.js) await p.addScriptTag({content: read(j)});
      const text = String(await scene.act(p));
      const warned = await p.evaluate((raw) => window.__warned.some((w) => w.includes(raw)), scene.raw);
      const leak = LEAK.test(text);
      if (leak) leaked++;
      await p.mouse.move(0, 0);
      const file = name + '.png';
      const buf = await p.screenshot({path: path.join(out, file)});
      lines.push({name, file, os: process.platform, browser: engine, width, height, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), raw: scene.raw, text, leak, warned});
    } finally { await p.close(); }
  }
} finally {
  await browser.close();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
if (leaked) { console.error(`pr-shots: ${leaked} 张界面上还有英文原文`); process.exitCode = 1; }
