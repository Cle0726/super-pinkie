// B97（uireview #497 18:25Z 记）：快捷键一览弹窗开着时，「协作处理中 2/4」工作浮标（#pinkie-work-panel，z-index 2147482810）
// 压在弹窗上，盖住弹窗里的说明行。共用弹窗遮罩 .laolao-modal-mask 只有 99998，挂在 body 下。
// 修法在 ui/injections/laolao-deep-think.js：body 下有遮罩时，工作浮标和协作状态退到 99997（遮罩下面）。
// 这里在真实安装的 OpenClaw Control UI + 碧琪注入上，假网关回 pinkie.work.status（照 tools/pr-shots/b85-metre-hidpi.mjs），
// 等浮标出来，再打开快捷键一览：浮标中心那一点上最上层的元素不能是浮标。日 / 夜各一遍，Metre 和项目模式都看。
// 反例：把注入样式里 B97 那两条规则拿掉，同样的步骤下浮标中心那一点必须是浮标自己（原来的 bug）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const fakeWork = () => {
  const T = Date.now();
  const WORK = (k) => ({sessionKey: k, now: T,
    background: [{id: 'bg-run', execId: 'e2', command: 'npm run build -- --watch', state: 'running', startedAt: T - 65000, endedAt: 0, woke: false}],
    reasoning: {phase: 'idle', jobs: []},
    tier: {active: true, children: [{id: 'c1', roleLabel: '查资料', model: 'qa/selected', state: 'running', summary: '在翻文档', startedAt: T - 12000, endedAt: 0, hasOutput: true}]}});
  const answers = {
    'pinkie.work.status': (p) => WORK(p.sessionKey),
    'pinkie.work.detail': (p) => ({found: true, output: '假结果', sessionKey: p.sessionKey}),
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

let ctx = null;
async function setup() {
  if (ctx) return ctx;
  let browser;
  try { browser = await launchRealBrowser(); } catch (error) { return {skip: `没有可用浏览器：${String(error?.message || error).slice(0, 120)}`}; }
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  ctx = {browser, installed, server};
  return ctx;
}

test.after(async () => {
  if (!ctx) return;
  await ctx.browser.close().catch(() => {});
  await ctx.server.close().catch(() => {});
  ctx.installed.cleanup();
});

// 打开场景 → 等浮标 → （反例时去掉 B97 规则）→ 打开快捷键一览 → 看浮标中心那一点最上层是谁。
async function probe(t, scene, theme, {dropFix = false} = {}) {
  const c = await setup();
  if (c.skip) { t.skip(c.skip); return null; }
  const {context, page, pageErrors} = await openRealScenePage(c.browser, c.server.origin, scene, theme, {initScript: fakeWork});
  try {
    await page.setViewportSize({width: 1440, height: 900});
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.()).catch(() => {});
    await page.waitForFunction(() => { const p = document.getElementById('pinkie-work-panel'); if (!p || p.hidden) return false; const r = p.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, null, {timeout: 20_000});
    if (dropFix) {
      await page.evaluate(() => {
        for (const s of document.querySelectorAll('style')) {
          if (!/laolao-modal-mask/.test(s.textContent || '')) continue;
          s.textContent = s.textContent.replace(/body:has\(> \.laolao-modal-mask\)[^{]*\{z-index:99997\}/g, '');
        }
      });
    }
    await page.evaluate(() => window.PinkieArtifacts?.openShortcuts?.());
    await page.waitForSelector('.laolao-modal-mask .pinkie-shortcuts', {timeout: 10_000});
    await page.waitForTimeout(400);
    return await page.evaluate(() => {
      const panel = document.getElementById('pinkie-work-panel');
      const mask = document.querySelector('.pinkie-shortcuts')?.closest('.laolao-modal-mask');
      const pill = panel.querySelector('.pinkie-work__pill') || panel;
      const r = pill.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        mode: document.documentElement.getAttribute('data-laolao-mode') || '',
        pillText: (pill.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        pillZ: getComputedStyle(panel).zIndex,
        maskZ: mask ? getComputedStyle(mask).zIndex : '',
        topIsPanel: Boolean(top && panel.contains(top)),
        topInMask: Boolean(top && mask && mask.contains(top)),
      };
    }).then((state) => ({state, errors: pageErrors.map((e) => String(e?.message || e))}));
  } finally {
    await context.close();
  }
}

for (const [scene, theme] of [['metre-board', 'day'], ['metre-board', 'night'], ['home-project', 'day'], ['home-project', 'night']]) {
  test(`B97 ${scene} ${theme}：快捷键一览开着时工作浮标在遮罩下面，不压弹窗`, async (t) => {
    const r = await probe(t, scene, theme);
    if (!r) return;
    assert.equal(r.state.topIsPanel, false, `浮标还压在弹窗上：${JSON.stringify(r.state)}`);
    assert.equal(r.state.topInMask, true, `浮标中心那一点应落在遮罩 / 弹窗里：${JSON.stringify(r.state)}`);
    assert.ok(Number(r.state.pillZ) < Number(r.state.maskZ), `浮标 z-index 应低于遮罩：${JSON.stringify(r.state)}`);
    assert.deepEqual(r.errors, []);
  });
}

test('B97 反例：拿掉那两条规则，浮标照旧压在快捷键一览上', async (t) => {
  const r = await probe(t, 'metre-board', 'day', {dropFix: true});
  if (!r) return;
  assert.equal(r.state.topIsPanel, true, `反例里浮标应在最上层：${JSON.stringify(r.state)}`);
  assert.ok(Number(r.state.pillZ) > Number(r.state.maskZ), `反例里浮标 z-index 应高于遮罩：${JSON.stringify(r.state)}`);
});
