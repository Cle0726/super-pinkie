// #98 打回（uireview 05:12Z 第三节 / 06:03Z）：原生 /cron 页在 Metre 里，次按键「运行 / 编辑 / •••」和页头「刷新」的边框日夜都要走 --pk-a3-edge，
// 量出来对页面底 ≥ 3:1。以前日间边框是 laolao-theme.css 强制给所有 .btn 的 rgba(255,255,255,.72)，叠在白底上约 #FDFDFC 对 #F7F6F3 ≈ 1.04:1；
// 原生 :root[data-theme-mode=light] .btn{border-color:var(--input)} 在 Metre 里又被 --input: var(--metre-surface) !important 压成白。
// 修法在 laolao-metre-skin.css「openclaw-cron-page .btn:not(.btn--primary):not(.primary):not(.danger) { border-color: var(--pk-a3-edge) !important }」。
// 这里在真实安装的 OpenClaw Control UI + 碧琪注入上打开 /cron（cron.* 在页面里接到三条示例任务），读 getComputedStyle(按键).borderTopColor，
// 把半透明边框混到它后面第一层不透明底上，算对比度。反例：从页面上删掉那两条新规则，日间至少一颗键必须掉回 3:1 以下。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

// Metre 皮肤的 hover/active 颜色过渡是纯 CSS transition（最长约 220ms，期间没有 DOM mutation），
// 没有可观察的 transitionend 落点可等，所以用同一个判据代替固定 waitForTimeout(ms)：反复在页面里
// 跑 read()，连续两帧结果不再变就认为已经稳定。read 必须是一个无参纯函数（会被 toString() 搬进
// page.evaluate），返回值要能被 JSON.stringify 序列化。
async function waitForStableEval(page, read) {
  const result = await page.evaluate(async (readSrc) => {
    const fn = new Function(`return (${readSrc})();`);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    let last = JSON.stringify(fn());
    let same = 0;
    for (let i = 0; i < 600 && same < 2; i++) {
      await frame();
      const now = JSON.stringify(fn());
      same = now === last ? same + 1 : 0;
      last = now;
    }
    return {settled: same >= 2, value: last};
  }, read.toString());
  if (!result.settled) throw new Error(`value never held still for two frames: ${result.value.slice(0, 200)}`);
  return JSON.parse(result.value);
}

// 页面里：假网关赋 window.WebSocket 时接住它，把 cron.* 请求答成三条示例任务（和 tools/pr-shots/98-a3-cron.mjs 同一套形状）。
const initScript = () => {
  const jobsAt = (t0) => [
    {id: 'j1', name: 'weather', enabled: true, agentId: 'main', schedule: {kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Shanghai'},
      payload: {kind: 'agentTurn', message: '查一下今天的天气。'}, delivery: {mode: 'announce', channel: 'last'},
      state: {nextRunAtMs: t0 + 20 * 3600e3, lastRunAtMs: t0 - 4 * 3600e3, lastStatus: 'ok'}},
    {id: 'j2', name: 'ci', enabled: true, agentId: 'metre', schedule: {kind: 'every', everyMs: 30 * 60000},
      payload: {kind: 'agentTurn', message: '看一眼 CI。'}, delivery: {mode: 'announce', channel: 'last'},
      state: {nextRunAtMs: t0 + 12 * 60000, lastRunAtMs: t0 - 18 * 60000, lastStatus: 'error'}},
    {id: 'j3', name: 'weekly', enabled: false, agentId: 'project', schedule: {kind: 'cron', expr: '0 9 * * 1,3,5', tz: 'Asia/Shanghai'},
      payload: {kind: 'agentTurn', message: '整理待办。'}, delivery: {mode: 'announce', channel: 'last'},
      state: {lastRunAtMs: t0 - 51 * 3600e3, lastStatus: 'ok'}},
  ];
  const answers = {
    'cron.list': () => { const jobs = jobsAt(Date.now()); return {jobs, total: jobs.length, offset: 0, limit: 100, hasMore: false, nextOffset: null}; },
    'cron.status': () => ({enabled: true, jobs: 3, nextWakeAtMs: Date.now() + 12 * 60000}),
    'cron.runs': () => ({entries: [], total: 0, offset: 0, limit: 50, hasMore: false, nextOffset: null}),
    'pinkie.cron.targets': () => ({targets: []}),
    'cron.run': () => ({ok: true}), 'cron.update': () => ({ok: true}), 'cron.add': () => ({ok: true}), 'cron.remove': () => ({ok: true}),
  };
  const patch = (Cls) => {
    if (!Cls?.prototype || Cls.prototype.__a3Edge) return;
    const orig = Cls.prototype.send;
    Cls.prototype.send = function a3EdgeSend(data) {
      let f = null; try { f = JSON.parse(data); } catch {}
      if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
        Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
        return;
      }
      return orig.call(this, data);
    };
    Cls.prototype.__a3Edge = true;
  };
  let cur = window.WebSocket;
  Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});
};

// 新规则的选择器片段（删反例时按它找）
const RULE = ':not(#_m3) openclaw-cron-page .btn:not(.btn--primary):not(.primary):not(.danger)';

// 在页面里：量 /cron 的「运行 / 编辑」（.cron-job-actions .btn）、「•••」（summary.btn.cron-job-menu__trigger）、「刷新」三类键的边框对底对比度。
function readEdges() {
  const rgb = (s) => {
    const n = (s.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^rgba?\(/.test(s)) return n;
    if (/^color\(srgb\s/.test(s)) return n.map((v, i) => (i < 3 ? v * 255 : v));
    throw new Error(`读不懂的颜色格式：${s}`);
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  // 页面底：按键外面第一层不透明底（行 / 卡片 / 页面）
  const bgOf = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.99)) return c.slice(0, 3);
    }
    return rgb(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3);
  };
  const root = document.querySelector('openclaw-cron-page');
  if (!root) return {items: [], missing: 'openclaw-cron-page'};
  const pick = (kind, els) => els.map((el) => ({kind, el}));
  const refresh = [...root.querySelectorAll('button.btn')].filter((b) => /^(刷新|Refresh)$/.test(b.textContent.trim()));
  const all = [
    ...pick('运行/编辑', [...root.querySelectorAll('.cron-job-actions .btn:not(summary)')]),
    ...pick('•••', [...root.querySelectorAll('summary.btn.cron-job-menu__trigger')]),
    ...pick('刷新', refresh),
  ];
  const items = [];
  for (const {kind, el} of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.borderTopWidth) < 0.5 || cs.borderTopStyle === 'none') {
      items.push({kind, text: el.textContent.trim().slice(0, 8), border: 'none', bg: '', ratio: 1});
      continue;
    }
    const raw = rgb(cs.borderTopColor); const bg = bgOf(el.parentElement);
    const a = raw[3] === undefined ? 1 : raw[3];
    const ink = raw.slice(0, 3).map((v, i) => a * v + (1 - a) * bg[i]);
    const x = lum(ink); const y = lum(bg);
    items.push({kind, text: el.textContent.trim().slice(0, 8), border: cs.borderTopColor, bg: `rgb(${bg.map(Math.round)})`,
      ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)});
  }
  return {items};
}

const fmt = (items) => items.map((i) => `${i.kind}「${i.text}」${i.border} on ${i.bg} ${i.ratio.toFixed(2)}`).join('; ');

async function openCron(browser, origin, theme) {
  const opened = await openRealScenePage(browser, origin, 'metre-board', theme, {initScript, timezoneId: 'Asia/Shanghai'});
  const {page} = opened;
  await page.setViewportSize({width: 1440, height: 900});
  // 站内路由切到 /cron，不再二次整页冷加载（和 metre-usage-missing-sessions-real 同一条路）
  await page.evaluate(() => {
    const shell = document.querySelector('openclaw-app-shell');
    const nav = [shell, shell?.context].find((o) => typeof o?.navigate === 'function');
    if (nav) nav.navigate('cron');
    else { history.pushState({}, '', '/cron'); dispatchEvent(new PopStateEvent('popstate')); }
  });
  await page.waitForFunction(() => location.pathname === '/cron'
    && document.querySelectorAll('openclaw-cron-page .cron-job-actions .btn').length >= 3, null, {timeout: 20_000});
  await page.mouse.move(1, 899);   // 指针不在任何键上，量的是平时的边框
  await waitForStableEval(page, readEdges);   // Metre 皮肤的颜色过渡，等 readEdges() 连续两帧不再变
  return opened;
}

test('#98 real page: /cron Run / Edit / ••• / Refresh borders use --pk-a3-edge and reach 3:1 against the page background, day and night; removing the rule drops day below 3:1', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page} = await openCron(browser, server.origin, theme);
    try {
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
      const {items, missing} = await page.evaluate(readEdges);
      assert.equal(missing, undefined, `${theme}: 页面上没有 ${missing}`);
      console.log(`ℹ ${theme}: ${fmt(items)}`);
      // 三条任务：「运行 / 编辑」至少 6 颗、「•••」3 颗、「刷新」1 颗；量不到不能算通过
      assert.ok(items.filter((i) => i.kind === '运行/编辑').length >= 6, `${theme}: 「运行 / 编辑」不到 6 颗 — ${fmt(items)}`);
      assert.ok(items.filter((i) => i.kind === '•••').length >= 3, `${theme}: 「•••」不到 3 颗 — ${fmt(items)}`);
      assert.ok(items.some((i) => i.kind === '刷新'), `${theme}: 没找到「刷新」 — ${fmt(items)}`);
      for (const i of items) assert.ok(i.ratio >= 3, `${theme}: ${i.kind}「${i.text}」边框只有 ${i.ratio.toFixed(2)}:1 — ${fmt(items)}`);
      // 边框色就是 --pk-a3-edge（不是碰巧够 3:1 的别的颜色）
      const edge = await page.evaluate(() => {
        const host = document.querySelector('openclaw-cron-page');
        const p = document.createElement('i'); p.style.cssText = 'position:absolute;border:1px solid var(--pk-a3-edge)';
        host.append(p); const c = getComputedStyle(p).borderTopColor; p.remove(); return c;
      });
      for (const i of items) assert.equal(i.border, edge, `${theme}: ${i.kind}「${i.text}」边框不是 --pk-a3-edge（${edge}）`);

      if (theme === 'day') {
        // 反例：删掉新加的两条规则，日间边框回到主题的白色半透明，至少一颗掉回 3:1 以下
        const removed = await page.evaluate((frag) => {
          let n = 0;
          for (const sh of document.styleSheets) {
            let rules; try { rules = sh.cssRules; } catch { continue; }
            for (let i = rules.length - 1; i >= 0; i--) if ((rules[i].selectorText || '').includes(frag)) { sh.deleteRule(i); n++; }
          }
          return n;
        }, RULE);
        assert.equal(removed, 2, `反例：页面上没找到那两条新规则（找到 ${removed} 条）`);
        await waitForStableEval(page, readEdges);   // 删规则后等皮肤颜色过渡走完，等连续两帧不再变
        const bad = (await page.evaluate(readEdges)).items;
        console.log(`ℹ day without the new rule: ${fmt(bad)}`);
        assert.ok(bad.length >= 10, `反例：删掉后量不到按键 — ${fmt(bad)}`);
        assert.ok(bad.some((i) => i.ratio < 3), `反例没生效：删掉新规则后日间按键边框仍都 ≥ 3:1 — ${fmt(bad)}`);
      }
    } finally {
      await context.close();
    }
  }
});
