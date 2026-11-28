#!/usr/bin/env node
// B97 前后对比截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 快捷键一览弹窗开着、「协作处理中」工作浮标在跑：after = 现头（浮标退到遮罩下面），before = 同一页拿掉 B97 两条规则（原来的样子）。
// 格子：Metre 1440 日 / 夜 × 1.25 / 1.5（uireview 当初在这几格看到的），加项目模式 1440 日间 1x。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
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
const WIDTH = 1440, HEIGHT = 900;

const initScript = () => {
  const T = Date.now();
  const WORK = (k) => ({sessionKey: k, now: T,
    background: [{id: 'bg-run', execId: 'e2', command: 'npm run build -- --watch', state: 'running', startedAt: T - 65000, endedAt: 0, woke: false}],
    reasoning: {phase: 'idle', jobs: []},
    tier: {active: true, children: [{id: 'c1', roleLabel: '查资料', model: 'qa/selected', state: 'running', summary: '在翻文档', startedAt: T - 12000, endedAt: 0, hasOutput: true}]}});
  const answers = {
    'pinkie.work.status': (p) => WORK(p.sessionKey),
    'pinkie.work.detail': (p) => ({found: true, output: '（截图用的假结果）', sessionKey: p.sessionKey}),
  };
  const patch = (Cls) => {
    if (!Cls?.prototype || Cls.prototype.__b97) return;
    const orig = Cls.prototype.send;
    Cls.prototype.send = function b97Send(data) {
      let f = null; try { f = JSON.parse(data); } catch {}
      if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
        Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
        return;
      }
      return orig.call(this, data);
    };
    Cls.prototype.__b97 = true;
  };
  let cur = window.WebSocket;
  Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});
};

const CELLS = [
  ['metre-board', 'day', 1.25], ['metre-board', 'night', 1.25],
  ['metre-board', 'day', 1.5], ['metre-board', 'night', 1.5],
  ['home-project', 'day', 1],
];

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

async function shoot(scene, theme, scale, variant) {
  const tag = `${variant}-${scene === 'metre-board' ? 'metre' : 'project'}-${theme}-x${String(scale).replace('.', '')}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {initScript, deviceScaleFactor: scale});
  try {
    await page.setViewportSize({width: WIDTH, height: HEIGHT});
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.()).catch(() => {});
    const pill = await page.waitForFunction(() => { const p = document.getElementById('pinkie-work-panel'); return Boolean(p && !p.hidden && p.getBoundingClientRect().width > 0); }, null, {timeout: 20_000}).then(() => true, () => false);
    if (variant === 'before') {
      await page.evaluate(() => {
        for (const s of document.querySelectorAll('style')) {
          if (/laolao-modal-mask/.test(s.textContent || '')) s.textContent = s.textContent.replace(/body:has\(> \.laolao-modal-mask\)[^{]*\{z-index:99997\}/g, '');
        }
      });
    }
    await page.evaluate(() => window.PinkieArtifacts?.openShortcuts?.());
    const dialog = await page.waitForSelector('.laolao-modal-mask .pinkie-shortcuts', {timeout: 10_000}).then(() => true, () => false);
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => {
      const panel = document.getElementById('pinkie-work-panel');
      const mask = document.querySelector('.pinkie-shortcuts')?.closest('.laolao-modal-mask');
      const el = panel?.querySelector('.pinkie-work__pill') || panel;
      const r = el ? el.getBoundingClientRect() : null;
      const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return {mode: document.documentElement.getAttribute('data-laolao-mode') || '', dpr: window.devicePixelRatio,
        pillText: (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        pillZ: panel ? getComputedStyle(panel).zIndex : '', maskZ: mask ? getComputedStyle(mask).zIndex : '',
        pillOnTop: Boolean(top && panel && panel.contains(top))};
    });
    const file = `b97-${tag}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name: `b97-${tag}`, file, os: process.platform, browser: engine || 'chromium', width: WIDTH, height: HEIGHT, deviceScaleFactor: scale,
      bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
    report.push({tag, variant, scene, theme, scale, pill, dialog, ...state, pageErrors: pageErrors.map((e) => String(e?.message || e).slice(0, 200))});
    console.log(JSON.stringify({tag, pill, dialog, pillOnTop: state.pillOnTop, pillZ: state.pillZ, maskZ: state.maskZ}));
  } finally {
    await context.close();
  }
}

try {
  for (const [scene, theme, scale] of CELLS) for (const variant of ['before', 'after']) await shoot(scene, theme, scale, variant);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
