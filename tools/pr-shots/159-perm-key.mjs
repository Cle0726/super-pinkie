#!/usr/bin/env node
// #159（fix/metre-perm-key，#150 跟进，协调者 21:18）的 PR 截图脚本（照 tools/pr-shots/minimal.mjs 的约定：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl）。
// 拍 Metre 按键行：浮在按键行起点上的麦克风（挂在输入框里、绝对定位、z-index 3）把第一个键盖住，按键行一路收到「⋯」，
// 「⋯」还被盖住时自己占一行、排在行首（data-dodge）。每个宽度拍两张：按键行本身、点开「⋯」后的会话详情。
// 只拍 320 × 日 / 夜，共 4 张：收起态「⋯」（带描边）、打开的会话详情（最后一行不用滚）。shots.jsonl 每行另记 fold / dodge / keyHit / ring / scroll。
// 页面照 tests/metre-perm.test.mjs 的反例搭：原生外壳节点、假网关（只在页面里回）、真的 laolao-metre-engine.css / laolao-metre-perm.css / .js。
// 不连网关、不碰用户会话。
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
// Metre 的日夜变量（同 tests/metre-perm.test.mjs）
const VARS = `
  html[data-laolao-mode=metre]{--metre-bg:#F7F6F3;--metre-surface:#FFFFFF;--metre-text:#1B1A18;--metre-muted:#77736B;--metre-line:#E4E2DC;--metre-line-strong:#D3D0C8;--metre-hover:#EFEDE8;--metre-danger:#A8432F;--metre-cobalt:#2F4BB0;--metre-sans:sans-serif;--metre-serif:serif;--metre-mono:monospace}
  html[data-laolao-mode=metre][data-pinkie-night]{--metre-bg:#151514;--metre-surface:#232321;--metre-text:#ECEAE4;--metre-muted:#918D84;--metre-line:#272725;--metre-line-strong:#393835;--metre-hover:#1F1F1D;--metre-danger:#D0705A;--metre-cobalt:#8496E6}
  body{margin:0;background:var(--metre-bg,#fff);color:var(--metre-text)}
  .chat-main{height:100vh;display:flex;flex-direction:column;justify-content:flex-end}
  .agent-chat__input{position:relative;padding:8px 12px 16px}`;
const page = (night) => `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night' : ''} lang="zh-CN"><head><style>${VARS}</style></head><body>
<div class="chat-main"><openclaw-chat-pane></openclaw-chat-pane><div class="agent-chat__input"><div class="agent-chat__composer-footer">
<div class="agent-chat__composer-controls" style="display:flex;flex-wrap:wrap;gap:4px"><button class="pk-eng-chip"><span class="pk-eng-chip__name">Metre</span></button></div></div></div></div>
</body></html>`;
const STUBS = `
  window.__resp = {
    'pinkie.metre.planMode.get': () => ({on: false}),
    'pinkie.plan.get': () => ({plan: null}),
    'usage.status': () => ({providers: [{provider: 'anthropic', displayName: 'Claude', windows: [{label: '5h', usedPercent: 60, resetAt: Date.now() + 3600e3}, {label: 'Week', usedPercent: 20}]}]}),
    'sessions.usage': (p) => ({sessions: [{key: p.key, model: 'hy4flash-free', modelProvider: 'workbuddy', usage: {input: 12000, output: 3400, totalTokens: 15400, totalCost: 0.0123, firstActivity: Date.now() - 600e3}}]}),
    'pinkie.project.bind': () => ({binding: {root: 'F:/work/demo'}}),
    'exec.approvals.get': () => ({exists: true, hash: 'h1', file: {version: 1, defaults: {}, agents: {main: {allowlist: []}}}}),
    'pinkie.model.failure': () => ({failure: null}),
  };
  window.__laolaoSidebar = {gwRequest: async (method, params) => { const f = window.__resp[method]; return f ? f(params || {}) : {}; }, toast() {}, navigateSession() {}};
  document.querySelector('openclaw-chat-pane').state = {sessionKey: ${JSON.stringify(SK)}};
  window.__pinkieRunNotify = {decide: () => ({list: 'none'}), prefs: {}, notify: {}};
  document.title = 'Metre';
`;

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const channel = process.env.PINKIE_UI_CHANNEL;
const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' && channel ? {channel} : {})});
const lines = [];
const shot = async (p, name, width, height, extra) => {
  const file = name + '.png';
  const buf = await p.screenshot({path: path.join(out, file)});
  lines.push({name, file, os: process.platform, browser: engine, width, height, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};
try {
  for (const width of [320]) for (const night of [false, true]) {
    const height = 420, tag = `${width}-${night ? 'night' : 'day'}`;
    const p = await browser.newPage({viewport: {width, height}, colorScheme: night ? 'dark' : 'light', locale: 'zh-CN'});
    try {
      await p.setContent(page(night));
      await p.addScriptTag({content: STUBS});
      await p.addStyleTag({content: read('laolao-metre-engine.css')});
      await p.addStyleTag({content: read('laolao-metre-perm.css')});
      await p.addScriptTag({content: read('laolao-metre-perm.js')});
      await p.evaluate(() => {
        const c = document.querySelector('.agent-chat__composer-controls');
        const m = document.createElement('button'); m.className = 'chat-composer-model-control'; m.style.cssText = 'flex:0 0 auto;width:150px;height:28px'; m.textContent = 'model'; c.append(m);
      });
      await p.evaluate(() => window.PinkieMetrePerm.refresh());
      await p.waitForTimeout(1700);
      // 麦克风浮在按键行起点上（同测试反例），再量一次
      await p.evaluate(() => {
        const input = document.querySelector('.agent-chat__input');
        const k = document.querySelector('.pk-perm-chips .pk-perm-chip').getBoundingClientRect(), base = input.getBoundingClientRect();
        const mic = document.createElement('button'); mic.className = 'chat-send-btn chat-send-btn--laolao-dictation'; mic.textContent = '🎤';
        mic.style.cssText = `position:absolute;z-index:3;left:${Math.round(k.left - base.left - 2)}px;top:${Math.round(k.top - base.top - 3)}px;width:34px;height:34px;padding:0;border:0`;
        input.append(mic);
        window.PinkieMetrePerm.fit();
      });
      await p.waitForTimeout(300);
      const state = await p.evaluate(() => {
        const chips = document.querySelector('.pk-perm-chips'), stat = chips.querySelector('.pk-perm-chip--stat'), r = stat.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {fold: chips.dataset.fold ?? null, dodge: chips.dataset.dodge ?? null, label: stat.textContent.trim(), keyHit: Boolean(hit && stat.contains(hit)), ring: getComputedStyle(stat).boxShadow, dots: getComputedStyle(stat.querySelector('.pk-eng-chip__name')).color, center: [r.left + r.width / 2, r.top + r.height / 2]};
      });
      const {center, ...rec} = state;
      await p.mouse.move(0, 0);
      await shot(p, `159-row-${tag}`, width, height, rec);
      await p.mouse.click(...center);
      const opened = await p.waitForSelector('.pk-perm-pop--detail', {timeout: 3000}).then(() => true, () => false);
      const pop = opened ? await p.evaluate(() => { const e = document.querySelector('.pk-perm-pop--detail'), b = e.getBoundingClientRect(); return {popTop: Math.round(b.top), popBottom: Math.round(b.bottom), scrolls: e.scrollHeight > e.clientHeight + 1}; }) : {};
      await p.mouse.move(0, 0);
      await shot(p, `159-detail-${tag}`, width, height, {...rec, opened, ...pop});
    } finally { await p.close(); }
  }
} finally {
  await browser.close();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
