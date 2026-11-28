// uireview 06:39Z「不卡（另开）」/ 协调者 23:00：原生 /cron 页在 Metre 夜间，任务行（.list-item）底色是原生 var(--card)，
// 和外层卡（.card）同为 --metre-surface #232321，只靠一圈 #393835 细边分层，比日间弱。
// 日间原生是 :root[data-theme-mode=light] .list-item{background:var(--bg)}：#F7F6F3 的行嵌在白卡里，低一档。
// 修法在 laolao-metre-skin.css「:is([data-pinkie-night], [data-theme="dark"]) openclaw-cron-page .list-item { background: var(--metre-bg) }」，
// 夜间照同一层级落到 --metre-bg。
// 这里在真实安装的 OpenClaw Control UI + 碧琪注入上打开 /cron（cron.* 在页面里接到三条示例任务），量每条任务行和它外层卡的底色差：
// 夜间行底 = --metre-bg、和外层卡不同色、层级差不小于日间；日间行底仍是 --metre-bg（#F7F6F3）不变。
// 反例：夜间从页面上删掉新规则，行底必须回到和外层卡同色（1.00:1）。
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

// 页面里：假网关赋 window.WebSocket 时接住它，把 cron.* 请求答成三条示例任务（和 tests/metre-a3-cron-btn-edge-real.test.mjs 同一套）。
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
    if (!Cls?.prototype || Cls.prototype.__a3Card) return;
    const orig = Cls.prototype.send;
    Cls.prototype.send = function a3CardSend(data) {
      let f = null; try { f = JSON.parse(data); } catch {}
      if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
        Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
        return;
      }
      return orig.call(this, data);
    };
    Cls.prototype.__a3Card = true;
  };
  let cur = window.WebSocket;
  Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});
};

// 新规则的选择器片段（删反例时按它找）
const RULE = 'openclaw-cron-page .list-item';
const RULE_NIGHT = /data-pinkie-night/;

// 在页面里：每条任务行（.cron-job-list 里的 .list-item）的底色、它外层第一张 .card 的底色、--metre-bg，和两者对比度。
function readLayers() {
  const rgb = (s) => {
    const n = (s.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^rgba?\(/.test(s)) return n;
    if (/^color\(srgb\s/.test(s)) return n.map((v, i) => (i < 3 ? v * 255 : v));
    throw new Error(`读不懂的颜色格式：${s}`);
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const opaque = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.99)) return c.slice(0, 3).map(Math.round);
    }
    return rgb(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3).map(Math.round);
  };
  const root = document.querySelector('openclaw-cron-page');
  if (!root) return {rows: [], missing: 'openclaw-cron-page'};
  const probe = document.createElement('i'); probe.style.cssText = 'position:absolute;background:var(--metre-bg)';
  root.append(probe); const metreBg = rgb(getComputedStyle(probe).backgroundColor).slice(0, 3).map(Math.round); probe.remove();
  const rows = [];
  for (const el of root.querySelectorAll('.list-item')) {
    if (!el.querySelector('.cron-job-actions')) continue;   // 只量任务行，不量运行历史
    const card = el.parentElement?.closest('.card');
    if (!card) continue;
    const row = opaque(el); const outer = opaque(card);
    const x = lum(row); const y = lum(outer);
    rows.push({text: el.textContent.trim().slice(0, 8), row: `rgb(${row})`, outer: `rgb(${outer})`,
      ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)});
  }
  return {rows, metreBg: `rgb(${metreBg})`};
}

const fmt = (rows) => rows.map((r) => `「${r.text}」${r.row} in ${r.outer} ${r.ratio.toFixed(2)}`).join('; ');

async function openCron(browser, origin, theme) {
  const opened = await openRealScenePage(browser, origin, 'metre-board', theme, {initScript, timezoneId: 'Asia/Shanghai'});
  const {context, page} = opened;
  try {
    await page.setViewportSize({width: 1440, height: 900});
    // 页内切路由，省掉第二次整页冷加载（同 tests/metre-usage-missing-sessions-real.test.mjs）
    await page.evaluate(() => {
      const shell = document.querySelector('openclaw-app-shell');
      const nav = [shell, shell?.context].find((o) => typeof o?.navigate === 'function');
      if (nav) nav.navigate('cron');
      else { history.pushState({}, '', '/cron' + location.search); dispatchEvent(new PopStateEvent('popstate')); }
    });
    await page.waitForFunction(() => document.querySelectorAll('openclaw-cron-page .cron-job-actions .btn').length >= 3, null, {timeout: 20_000});
    await page.mouse.move(1, 899);
    await waitForStableEval(page, readLayers);   // Metre 皮肤的颜色过渡，等 readLayers() 连续两帧不再变
    return opened;
  } catch (e) {
    await context.close();
    throw e;
  }
}

test('real page: night /cron task rows sit one layer below the outer card (--metre-bg, not the same #232321), at least as far apart as day; day rows unchanged; removing the rule puts night rows back on the card colour', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  const seen = {};
  for (const theme of ['day', 'night']) {
    const {context, page} = await openCron(browser, server.origin, theme);
    try {
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
      const {rows, metreBg, missing} = await page.evaluate(readLayers);
      assert.equal(missing, undefined, `${theme}: 页面上没有 ${missing}`);
      console.log(`ℹ ${theme} (--metre-bg ${metreBg}): ${fmt(rows)}`);
      assert.equal(rows.length, 3, `${theme}: 任务行不是 3 条 — ${fmt(rows)}`);
      for (const r of rows) {
        assert.equal(r.row, metreBg, `${theme}: 「${r.text}」行底不是 --metre-bg — ${fmt(rows)}`);
        assert.notEqual(r.row, r.outer, `${theme}: 「${r.text}」行底和外层卡同色 — ${fmt(rows)}`);
      }
      seen[theme] = Math.min(...rows.map((r) => r.ratio));
      if (theme === 'day') {
        // 日间不变：原生 light 规则给的 var(--bg) = #F7F6F3，外层白卡
        for (const r of rows) assert.deepEqual([r.row, r.outer], ['rgb(247,246,243)', 'rgb(255,255,255)'], `day: 「${r.text}」日间层级变了 — ${fmt(rows)}`);
      } else {
        assert.ok(seen.night >= seen.day, `night: 行和外层卡层级差 ${seen.night.toFixed(2)}:1，比日间 ${seen.day.toFixed(2)}:1 还弱 — ${fmt(rows)}`);
        // 反例：删掉新规则，夜间行底回到原生 var(--card) = 外层卡同色
        const removed = await page.evaluate(({frag, night}) => {
          let n = 0;
          for (const sh of document.styleSheets) {
            let rules; try { rules = sh.cssRules; } catch { continue; }
            for (let i = rules.length - 1; i >= 0; i--) {
              const s = rules[i].selectorText || '';
              if (s.includes(frag) && new RegExp(night).test(s)) { sh.deleteRule(i); n++; }
            }
          }
          return n;
        }, {frag: RULE, night: RULE_NIGHT.source});
        assert.equal(removed, 1, `反例：页面上没找到那条夜间新规则（找到 ${removed} 条）`);
        await waitForStableEval(page, readLayers);   // 删规则后等皮肤颜色过渡走完，等连续两帧不再变
        const bad = (await page.evaluate(readLayers)).rows;
        console.log(`ℹ night without the new rule: ${fmt(bad)}`);
        assert.equal(bad.length, 3, `反例：删掉后量不到任务行 — ${fmt(bad)}`);
        assert.ok(bad.every((r) => r.row === r.outer), `反例没生效：删掉新规则后夜间行底仍和外层卡不同 — ${fmt(bad)}`);
      }
    } finally {
      await context.close();
    }
  }
});
