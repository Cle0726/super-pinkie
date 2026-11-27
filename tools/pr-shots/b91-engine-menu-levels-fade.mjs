#!/usr/bin/env node
// B91 前后对比截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 真实页面打开 Metre 引擎菜单（窗口矮，列表比菜单高），不滚动：after = 现头（贴底的「放手程度」上沿有「下面还有」渐变），
// before = 同一页拿掉 B91 那条 ::before 规则（原来的样子：渐变被贴底一节盖住）；再各拍一张滚到底（渐变该消失）。
// 格子：1440×700 日 / 夜 × 1.25，820×600 日 1x。约定照 tools/pr-shots/minimal.mjs：--out <目录>，写 PNG + shots.jsonl + report.json。
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
const CELLS = [[1440, 700, 'day', 1.25], [1440, 700, 'night', 1.25], [820, 600, 'day', 1]];

// 隔离假网关对 pinkie.engines.catalog 回 {}（没有档位，「放手程度」不出现）：这里照 tests/metre-engine-menu-levels-fade.test.mjs 给十个已就绪引擎 + 四档。
const initScript = () => {
  const row = (id, name) => ({id, name, state: 'ready', text: '', enabled: true, installed: true, signedIn: true, quota: {state: 'unknown'},
    setup: {canInstall: false, canAuthenticate: false}, guide: {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: false, managedSignin: false},
    models: [{slug: 'm1', name: 'Model One', isDefault: true}]});
  const engines = ['Claude Code', 'Codex', 'Antigravity', 'Cursor', 'OpenCode', 'Grok Build', 'Kiro', 'Pi', 'fx', 'Muse Code'].map((n, i) => row('e' + i, n));
  const levels = [{id: 'full-access', name: '全放手', hint: 'a'}, {id: 'auto', name: '自己判断', hint: 'b'}, {id: 'auto-accept-edits', name: '改文件不问', hint: 'c'}, {id: 'approval-required', name: '每步都问', hint: 'd'}];
  const answers = {
    'pinkie.engines.catalog': () => ({enabled: true, running: true, source: 'live', levels, engines}),
    'pinkie.engines.session': (p) => ({sessionKey: p.sessionKey, pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}}),
  };
  const patch = (Cls) => {
    if (!Cls?.prototype || Cls.prototype.__b91) return;
    const orig = Cls.prototype.send;
    Cls.prototype.send = function b91Send(data) {
      let f = null; try { f = JSON.parse(data); } catch {}
      if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
        Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
        return;
      }
      return orig.call(this, data);
    };
    Cls.prototype.__b91 = true;
  };
  let cur = window.WebSocket;
  Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});
};

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const state = (page) => page.evaluate(() => {
  const body = document.querySelector('.pk-eng-menu .pk-eng-menu__body'), levels = body?.querySelector('.pk-eng-menu__levels');
  if (!body || !levels) return {found: false};
  const fade = getComputedStyle(levels, '::before');
  return {found: true, left: Math.round(body.scrollHeight - body.scrollTop - body.clientHeight), marked: levels.classList.contains('is-below'),
    fade: fade.content !== 'none' && /gradient/.test(fade.backgroundImage)};
});

async function shoot(w, h, theme, scale, variant) {
  const base = `${variant}-${w}x${h}-${theme}-x${String(scale).replace('.', '')}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript, deviceScaleFactor: scale});
  try {
    await page.setViewportSize({width: w, height: h});
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.()).catch(() => {});
    if (variant === 'before') await page.addStyleTag({content: '.pk-eng-menu__levels.is-below::before{content:none!important}'});
    await page.click('.agent-chat__composer-controls > .pk-eng-chip', {timeout: 8000});
    await page.waitForSelector('.pk-eng-menu .pk-eng-menu__levels .pk-eng-seg', {timeout: 10_000});
    await page.waitForTimeout(500);
    for (const pos of ['top', 'end']) {
      if (pos === 'end') { await page.evaluate(() => { const b = document.querySelector('.pk-eng-menu .pk-eng-menu__body'); b.scrollTop = b.scrollHeight; }); await page.waitForTimeout(300); }
      const s = await state(page);
      const file = `b91-${base}-${pos}.png`;
      const buf = await page.screenshot({path: path.join(out, file)});
      lines.push({name: `b91-${base}-${pos}`, file, os: process.platform, browser: engine || 'chromium', width: w, height: h, deviceScaleFactor: scale,
        bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
      report.push({tag: `${base}-${pos}`, variant, w, h, theme, scale, pos, ...s, pageErrors: pageErrors.map((e) => String(e?.message || e).slice(0, 200))});
      console.log(JSON.stringify({tag: `${base}-${pos}`, ...s}));
    }
  } finally {
    await context.close();
  }
}

try {
  for (const [w, h, theme, scale] of CELLS) for (const variant of ['before', 'after']) await shoot(w, h, theme, scale, variant);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
