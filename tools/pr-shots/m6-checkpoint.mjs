#!/usr/bin/env node
// B21·M6「回到这一轮之前」截图。约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面 long-conversation（项目模式）× 日 / 夜 × 1440 / 820 × 4 个场景：有键的对话、在跑时灰键、确认框带冲突一组、回退之后。
// 假网关：fake-gateway.js 赋 window.WebSocket 时接住它，pinkie.checkpoint.* 答成两轮动过文件的记录；回退后 chat.history 只回第 1 轮。
// 注入文件还没登记进 head.fragment 时，页面打开后补挂 laolao-checkpoint.js / .css。
// PINKIE_VISUAL_ENGINE=webkit 走 WebKit（本机 page.screenshot 回 0 字节，改用 wkshotBuffer）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {wkshotBuffer, wrapWebKitPlaywright} from '../../tests/visual/lib/webkit-screenshot.mjs';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const out = path.resolve(opt('--out', process.env.PINKIE_SHOTS_OUT || 'shots'));
const repoRoot = path.resolve(opt('--repo', fileURLToPath(new URL('../../', import.meta.url))));
fs.mkdirSync(out, {recursive: true});

const git = (...a) => { try { return execFileSync('git', ['-C', repoRoot, ...a], {encoding: 'utf8'}).trim(); } catch { return null; } };
const head = {repo: repoRoot, head: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain'))};
console.log(`pr-shots: 被测头 ${JSON.stringify(head)}`);

const t = (text) => [{type: 'text', text}];
const T0 = H.FROZEN_TIME_MS - 900_000;
const HISTORY = [
  {role: 'user', content: t('把 README 的启动命令改成 npm run dev。'), timestamp: T0, __openclaw: {id: 'ck-u1'}},
  {role: 'assistant', stopReason: 'stop', content: t('改好了：README.md 的启动命令现在是 `npm run dev`。'), timestamp: T0 + 60_000, __openclaw: {id: 'ck-a1'}},
  {role: 'user', content: t('再把端口改成 5174，顺手把 docs/setup.md 里的端口也改掉。'), timestamp: T0 + 120_000, __openclaw: {id: 'ck-u2'}},
  {role: 'assistant', stopReason: 'stop', content: t('已把 src/app.js 的端口改成 5174，docs/setup.md 同步更新，另外新建了 .env.local 记下端口。'), timestamp: T0 + 180_000, __openclaw: {id: 'ck-a2'}},
  {role: 'user', content: t('把 hosts 也加一行 127.0.0.1 proj.local。'), timestamp: T0 + 240_000, __openclaw: {id: 'ck-u3'}},
  {role: 'assistant', stopReason: 'stop', content: t('hosts 在项目文件夹外面，我用命令加了一行；另外删掉了不再用的 scripts/old-start.sh。'), timestamp: T0 + 300_000, __openclaw: {id: 'ck-a3'}},
];
const LIST = {ok: true, running: false, turns: [
  {turn: 2, userEntryId: 'ck-u2', assistantEntryIds: ['ck-a2'], auditIncomplete: false},
  {turn: 3, userEntryId: 'ck-u3', assistantEntryIds: ['ck-a3'], auditIncomplete: true},
]};
const PREVIEW = {ok: true, turn: 2, running: false, text: HISTORY[2].content[0].text,
  restore: [{path: 'src/app.js', action: 'modify'}, {path: '.env.local', action: 'delete'}, {path: 'scripts/old-start.sh', action: 'recreate'}],
  conflicts: [{path: 'docs/setup.md', action: 'modify'}],
  unrecoverable: [{path: '/etc/hosts', reason: 'outside'}, {path: 'assets/demo-recording.mov', reason: 'too-large'}],
  auditIncomplete: [3]};
const RESTORE = {ok: true, turn: 2, restored: 3, skipped: ['docs/setup.md'], unrecoverable: PREVIEW.unrecoverable};

const initScript = new Function(`window.__fakeSeedHistory = ${JSON.stringify(HISTORY)};
const LIST = ${JSON.stringify(LIST)}, PREVIEW = ${JSON.stringify(PREVIEW)}, RESTORE = ${JSON.stringify(RESTORE)};
const AFTER = ${JSON.stringify(HISTORY.slice(0, 2))};
const answers = {
  'pinkie.checkpoint.list': () => (window.__ckptRestored ? {...LIST, turns: []} : {...LIST, running: Boolean(window.__ckptRunning)}),
  'pinkie.checkpoint.preview': () => PREVIEW,
  'pinkie.checkpoint.restore': () => { window.__ckptRestored = true; return RESTORE; },
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__ckptShots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function ckptSend(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    const hit = f && f.type === 'req' && (Object.prototype.hasOwnProperty.call(answers, f.method) || (f.method === 'chat.history' && window.__ckptRestored));
    if (hit) {
      (window.__ckptRpc ||= []).push(f.method);
      const payload = f.method === 'chat.history' ? {sessionKey: (f.params || {}).sessionKey, messages: AFTER} : answers[f.method](f.params || {});
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__ckptShots = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

const JS = fs.readFileSync(path.join(repoRoot, 'ui/injections/laolao-checkpoint.js'), 'utf8');
const CSS = fs.readFileSync(path.join(repoRoot, 'ui/injections/laolao-checkpoint.css'), 'utf8');
const HEIGHT = 900;
const engine = H.resolveRealEngine();
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser(engine);
const capture = async (page, opts) => {
  const buf = engine === 'webkit' ? await wkshotBuffer(page, opts) : await page.screenshot(opts);
  if (opts.path) fs.writeFileSync(opts.path, buf);
  return buf;
};
const report = [];
const lines = [];
const rec = (name, width, buf, extra) => lines.push({name, file: `${name}.png`, os: process.platform, browser: engine, width, height: HEIGHT,
  bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...head, ...extra});

async function mount(page, running) {
  await page.evaluate(({JS, CSS, running}) => {
    window.__ckptRunning = running;
    if (!document.querySelector('link[href*="laolao-checkpoint.css"], style[data-ckpt-shots]')) {
      const style = document.createElement('style'); style.dataset.ckptShots = '1'; style.textContent = CSS; document.head.append(style);
    }
    if (!window.Pinkie?.checkpoint) { const s = document.createElement('script'); s.textContent = JS; document.head.append(s); }
    const pane = document.querySelector('openclaw-chat-pane');
    if (running && pane?.state) pane.state.chatRunId = 'shots-run';
    const key = new URL(location.href).searchParams.get('session') || pane?.state?.sessionKey || '';
    window.Pinkie.checkpoint.refresh(pane, key);
  }, {JS, CSS, running});
  await page.waitForFunction(() => document.querySelectorAll('.pinkie-ckpt').length === 2, {timeout: 10_000});
  await page.waitForTimeout(200);
}

const lastKey = '.pinkie-ckpt[data-turn="2"]';
const lastGroup = '.chat-group.assistant:has(.pinkie-ckpt[data-turn="2"])';
async function showKey(page) {
  await page.locator(lastGroup).scrollIntoViewIfNeeded();
  await page.hover(lastGroup);
  await page.waitForTimeout(250);
}
function measure() {
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)}; };
  const ckpts = [...document.querySelectorAll('.pinkie-ckpt')].map((n) => {
    const group = n.closest('.chat-group');
    const bubble = group?.querySelector(`.chat-bubble[data-message-id="${CSS.escape(n.dataset.messageId || '')}"]`);
    const texts = group ? [...group.querySelectorAll('.chat-text')] : [];
    const k = n.getBoundingClientRect();
    const overText = (k) => texts.flatMap((t) => [...t.querySelectorAll('*'), t]).reduce((sum, el) => {
      if (el.children.length) return sum;
      const r = el.getBoundingClientRect();
      return sum + Math.max(0, Math.min(k.bottom, r.bottom) - Math.max(k.top, r.top)) * Math.max(0, Math.min(k.right, r.right) - Math.max(k.left, r.left));
    }, 0);
    const overlapText = overText(k);
    const fork = bubble?.querySelector(':scope > .pinkie-fork-action');
    const f = fork?.getBoundingClientRect();
    const forkOverlapText = f ? Math.round(overText(f)) : null;
    const overlapFork = f ? Math.max(0, Math.min(k.bottom, f.bottom) - Math.max(k.top, f.top)) * Math.max(0, Math.min(k.right, f.right) - Math.max(k.left, f.left)) : 0;
    const btn = n.querySelector('.pinkie-ckpt__btn');
    return {turn: n.dataset.turn, entryId: n.dataset.entryId, footer: Boolean(n.closest('.chat-group-footer-actions')), box: box(n), fork: box(fork), opacity: getComputedStyle(n).opacity,
      disabled: btn.getAttribute('aria-disabled'), tabIndex: btn.tabIndex, overlapText: Math.round(overlapText), overlapFork: Math.round(overlapFork), forkOverlapText};
  });
  const modal = document.querySelector('.pinkie-ckpt-modal');
  const file = modal?.querySelector('.pinkie-ckpt-file');
  const cs = (sel) => getComputedStyle(file.querySelector(sel));
  const modalInk = file ? {pathBg: cs('.pinkie-ckpt-file__path').backgroundColor, noteColor: cs('.pinkie-ckpt-file__note').color, noteOpacity: cs('.pinkie-ckpt-file__note').opacity} : null;
  return {ua: navigator.userAgent, ckpts, modal: box(modal), modalInk, focus: document.activeElement?.textContent?.slice(0, 40) || document.activeElement?.tagName,
    draft: document.querySelector('.agent-chat__composer-combobox textarea')?.value || '', groups: document.querySelectorAll('.chat-thread .chat-group').length,
    rpc: window.__ckptRpc || []};
}

const SCENES = {
  keys: async (page) => { await mount(page, false); await showKey(page); },
  running: async (page) => { await mount(page, true); await page.waitForFunction(() => document.querySelectorAll('.pinkie-ckpt[data-busy]').length === 2); await showKey(page); },
  confirm: async (page) => {
    await mount(page, false); await showKey(page);
    await page.click(`${lastKey} > .pinkie-ckpt__btn`);
    await page.waitForSelector('.pinkie-ckpt-modal');
    await page.waitForTimeout(250);
  },
  after: async (page) => {
    await mount(page, false); await showKey(page);
    await page.click(`${lastKey} > .pinkie-ckpt__btn`);
    await page.waitForSelector('.pinkie-ckpt-modal');
    await page.check('.pinkie-ckpt-modal input[type=checkbox]');
    await page.click('.pinkie-ckpt-modal .laolao-modal__btn--danger');
    await page.waitForSelector('.pinkie-ckpt-modal', {state: 'detached'});
    await page.waitForFunction(() => document.querySelector('.agent-chat__composer-combobox textarea')?.value, {timeout: 10_000});
    await page.waitForTimeout(300);
  },
};

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      for (const [scene, run] of Object.entries(SCENES)) {
        const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'long-conversation', theme, {initScript});
        try {
          await page.setViewportSize({width, height: HEIGHT});
          await run(page);
          const info = await page.evaluate(measure);
          const name = `m6-${scene}-${width}-${theme}`;
          const extra = {theme, scene, ...info, pageErrors};
          rec(name, width, await capture(page, {path: path.join(out, `${name}.png`)}), extra);
          report.push({width, ...extra});
          console.log(`${name}: ckpts=${JSON.stringify(info.ckpts.map((c) => [c.turn, c.footer, c.opacity, c.disabled, c.overlapText, c.overlapFork]))} focus=${info.focus} draft=${info.draft.slice(0, 12)} groups=${info.groups} errors=${pageErrors.length}`);
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({head, engine, report}, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
