// B11·project 走查 #13 在真实 Control UI 上的复发测试：工作台编辑器行号 .line-numbers 日夜都很淡（1.22–2.73:1，第 10 行几乎看不见），当前行号 3.75:1。
// 真实安装的 Control UI + 碧琪注入 + 假网关（tests/visual/lib/real-harness.mjs），项目 / 无限两种模式 × 日夜 × 1440 / 820，
// 工作台开一个 12 行的文件，量 Monaco 真画出来的行号字色对它所在的底色（gutter；当前行若有高亮底就叠上去）。
// 反例：把页面拿到的 laolao-workbench.js 里行号那一行换回旧写法 hex(c.muted, 0.7) / hex(c.accent)，日间行号必须掉到 4.5 以下。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'ui/injections/laolao-workbench.js'), 'utf8');
const NEW_LINE = /'editorLineNumber\.foreground': [^\n]*?'editorLineNumber\.activeForeground': hex\(reach\([^\n]*?\)\),/;
const OLD_LINE = "'editorLineNumber.foreground': hex(c.muted, 0.7), 'editorLineNumber.activeForeground': hex(c.accent),";
const SCENES = {project: 'home-project', unrestricted: 'home-unrestricted'};

const initScript = new Function(`
const body = Array.from({length: 12}, (_, i) => 'const line' + (i + 1) + ' = ' + (i + 1) + ';').join(String.fromCharCode(10));
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'main', name: 'proj', bound: true, unrestricted: document.documentElement.dataset.laolaoMode === 'unrestricted'}),
  'pinkie.fs.list': () => ({entries: [{name: 'a.js', path: 'a.js', kind: 'file'}]}),
  'pinkie.fs.read': (p) => ({kind: 'text', content: body, path: p.path, readOnly: false, size: body.length, mtimeMs: 1}),
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', changes: []}),
  'pinkie.fs.gitShow': () => ({content: body, exists: true}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b11ln) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b11lnSend(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b11ln = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

// 页里量：每个看得见的行号字色、它下面第一层不透明底色（往上找），当前行号若压在 .current-line-margin 高亮上就叠上去。
const measure = () => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r, g, b, a}; };
  const over = (fg, bg) => ({r: bg.r + (fg.r - bg.r) * fg.a, g: bg.g + (fg.g - bg.g) * fg.a, b: bg.b + (fg.b - bg.b) * fg.a, a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const baseBg = (n) => { for (let e = n; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) return c; } return {r: 255, g: 255, b: 255, a: 1}; };
  const nums = [...document.querySelectorAll('.pk-wb-editor .monaco-editor .margin-view-overlays .line-numbers')].filter((n) => n.offsetWidth && n.textContent.trim());
  const rows = nums.map((n) => {
    let bg = baseBg(n);
    const top = n.parentElement?.style.top;
    const hl = [...(n.parentElement?.parentElement?.children || [])].filter((d) => d.style.top === top).flatMap((d) => [...d.querySelectorAll('.current-line-margin, .current-line')]);
    for (const h of hl) { const c = parse(getComputedStyle(h).backgroundColor); if (c && c.a > 0) bg = over(c, bg); }
    const fg = over(parse(getComputedStyle(n).color), bg);
    return {n: n.textContent.trim(), active: n.classList.contains('active-line-number'), color: getComputedStyle(n).color, ratio: Math.round(ratio(fg, bg) * 100) / 100};
  });
  return {mode: document.documentElement.dataset.laolaoMode, theme: window.monaco?.editor ? 'monaco' : null, rows};
};

// 日夜由 context 的 colorScheme 决定，所以每个 (mode, theme) 只开一个页面：同页先切宽量 1440 / 820 正例；
// 日间页最后挂上换回旧写法的路由再 reload 量反例（反例改的是脚本本身，必须排在正例之后）。
// 切宽后 resize → sync / place（防抖 60 / 30 ms）→ ResizeObserver 下一帧 editor.layout，等两帧再留 400 ms。
async function lineNumbersAt(page, width) {
  await page.setViewportSize({width, height: 900});
  await page.evaluate(() => window.__pinkieWorkbench?.show?.());
  await page.evaluate(() => window.__pinkieWorkbench.open('/proj/a.js', {pinned: true}));
  await page.waitForFunction(() => document.querySelectorAll('.pk-wb-editor .monaco-editor .line-numbers').length >= 10, null, {timeout: 20_000});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(400);
  return page.evaluate(measure);
}

async function revertAndMeasure(context, page, width) {
  let swapped = 0;
  await context.route(/laolao-workbench\.js(\?|$)/, async (route) => {
    const res = await route.fetch();
    const text = (await res.text()).replace(NEW_LINE, () => { swapped++; return OLD_LINE; });
    await route.fulfill({response: res, body: text});
  });
  await page.reload();
  const m = await lineNumbersAt(page, width);
  return {...m, swapped};
}

test('工作台编辑器行号 real page：项目 / 无限 × 日夜 × 1440 / 820 行号与当前行号 ≥4.5:1，换回旧写法日间变红', async (t) => {
  assert.match(SOURCE, NEW_LINE, '源码里找不到新的行号写法');
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      try { await server?.close(); }
      finally { installed.cleanup(); }
    }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const mode of Object.keys(SCENES)) for (const theme of ['day', 'night']) {
    await t.test(`${mode} ${theme}`, async (tt) => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, SCENES[mode], theme, {initScript});
      try {
        for (const width of [1440, 820]) {
          await tt.test(`${mode} ${theme} ${width}`, async (ttt) => {
            const m = {...await lineNumbersAt(page, width), pageErrors};
            const where = JSON.stringify(m);
            ttt.diagnostic(where);
            assert.ok(m.rows.length >= 10, `行号没画够 10 行：${where}`);
            assert.ok(m.rows.some((r) => r.n === '10'), `第 10 行行号不在：${where}`);
            for (const r of m.rows) assert.ok(r.ratio >= 4.5, `${mode} ${theme} ${width} 第 ${r.n} 行${r.active ? '（当前行）' : ''}行号 ${r.ratio}:1 < 4.5。${where}`);
            assert.deepEqual(m.pageErrors, [], '页面不该报错');
          });
        }
        if (theme === 'day') {
          await tt.test(`反例：${mode} 日间 1440 换回 hex(c.muted, 0.7) / hex(c.accent)，行号掉到 4.5 以下`, async (ttt) => {
            const m = {...await revertAndMeasure(context, page, 1440), pageErrors};
            ttt.diagnostic(JSON.stringify(m));
            assert.ok(m.swapped >= 1, `反例没换上：页面拿到的 laolao-workbench.js 里没找到新写法（${mode}）`);
            const plain = m.rows.filter((r) => !r.active);
            assert.ok(plain.length >= 9 && plain.every((r) => r.ratio < 4.5), `反例没生效：${mode} 日间旧写法行号仍有够 4.5 的：${JSON.stringify(plain)}`);
          });
        }
      } finally { await context.close(); }
    });
  }
});
