// 16 复发防护（真页面）：设置页「定时任务」卡里，上次没做成的那条要用 danger 红，上次做完了的不红。
// 在真实安装的 Control UI + 碧琪注入上，用 initScript 喂三条任务（j1 做完了 / j2 没做成 / j3 停用），
// 碧琪（设置场景，project 模式）与 Metre（metre 模式）× 日 / 夜各量一次：
//   j2 的 .pk-job__last[data-state="error"] 计算色等于该模式的 danger 色，对卡片底 ≥ 4.5:1；j1 的不是红。
// 反例写在测试里：去掉 data-state、或删掉 laolao-rich.css 里那条规则，j2 就不再是 danger 色。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {openSettingsSchedules, settingsCronInit} from './fixtures/settings-cron-jobs.mjs';

// 碧琪：laolao-rich.css 的回退色；Metre：laolao-metre-skin.css 的 --metre-danger（日 #A8432F / 夜 #D0705A）
const DANGER = {
  pinkie: {day: 'rgb(177, 61, 99)', night: 'rgb(255, 143, 179)'},
  metre: {day: 'rgb(168, 67, 47)', night: 'rgb(208, 112, 90)'},
};
const SCENES = [['pinkie', 'settings', 'project'], ['metre', 'metre-board', 'metre']];

function readJobs() {
  const rgb = (s) => {
    const n = (s.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^rgba?\(/.test(s)) return n;
    if (/^color\(srgb\s/.test(s)) return n.map((v, i) => (i < 3 ? v * 255 : v));
    throw new Error(`读不懂的颜色格式：${s}`);
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  // 设置页的卡片是半透明底叠在背景图上，往上找不到不透明的底（html 是 transparent，会被当成纯黑）。
  // 所以把一路上的半透明底由外向内叠起来；一层不透明的都没有时，日间垫白、夜间垫黑（背景图本身日亮夜暗）。
  const bgOf = (el) => {
    const layers = [];
    let base = null;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length < 3) continue;
      const a = c[3] === undefined ? 1 : c[3];
      if (a >= 0.99) { base = c.slice(0, 3); break; }
      if (a > 0) layers.push([...c.slice(0, 3), a]);
    }
    if (!base) base = matchMedia('(prefers-color-scheme: dark)').matches ? [0, 0, 0] : [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) base = [r, g, b].map((v, i) => a * v + (1 - a) * base[i]);
    return base.map((v) => Math.round(v));
  };
  const inSettings = Boolean(document.querySelector('#laolao-user-settings #pinkie-schedules'));
  const jobs = [...document.querySelectorAll('#pinkie-schedules .pk-job')].map((job) => {
    const meta = job.querySelector('.pk-job__meta');
    const last = meta?.querySelector('.pk-job__last');
    const out = {text: meta?.textContent.trim() || '', metaColor: meta ? getComputedStyle(meta).color : null, last: null};
    if (last) {
      const cs = getComputedStyle(last); const bg = bgOf(last);
      const a = lum(rgb(cs.color)); const b = lum(bg);
      out.last = {state: last.dataset.state || null, text: last.textContent.trim(), color: cs.color, weight: cs.fontWeight,
        bg: `rgb(${bg})`, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)};
    }
    return out;
  });
  return {inSettings, mode: document.documentElement.getAttribute('data-laolao-mode'), jobs};
}

const settle = (page) => page.waitForFunction(
  () => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running'), null, {timeout: 5000});

test('16 real page: failed cron job in settings uses danger red (Pinkie / Metre × day / night); ok job does not', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const [skin, sceneId, mode] of SCENES) {
    for (const theme of ['day', 'night']) {
      const tag = `${skin}/${theme}`;
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, sceneId, theme, {initScript: settingsCronInit});
      try {
        await openSettingsSchedules(page);
        await settle(page);
        const got = await page.evaluate(readJobs);
        console.log(`ℹ ${tag}: ${JSON.stringify(got.jobs)}`);
        assert.equal(got.mode, mode, `${tag}: 模式不对`);
        assert.ok(got.inSettings, `${tag}: #pinkie-schedules 不在 #laolao-user-settings 里`);
        const [ok, err, off] = got.jobs;
        assert.match(err.text, /上次 .+ 没做成/, `${tag}: j2 的 meta 文字变了`);
        assert.equal(err.last?.state, 'error', `${tag}: j2 的「上次」没带 data-state="error"`);
        assert.equal(err.last.color, DANGER[skin][theme], `${tag}: j2 不是 danger 色`);
        assert.ok(err.last.ratio >= 4.5, `${tag}: j2 对 ${err.last.bg} 只有 ${err.last.ratio.toFixed(2)}:1`);
        assert.equal(ok.last?.state, 'ok', `${tag}: j1 的「上次」没带 data-state="ok"`);
        assert.match(ok.last.text, /做完了$/);
        assert.notEqual(ok.last.color, DANGER[skin][theme], `${tag}: 做完了的 j1 也红了`);
        assert.equal(ok.last.color, ok.metaColor, `${tag}: j1 的「上次」颜色和其余 meta 不一致`);
        assert.ok(off.last, `${tag}: j3 有上次运行时间却没显示`);
        assert.notEqual(off.last.color, DANGER[skin][theme]);

        // 反例 1：去掉 data-state，j2 必须不再是 danger 色
        await page.evaluate(() => { document.querySelectorAll('#pinkie-schedules .pk-job__last[data-state="error"]').forEach((el) => el.removeAttribute('data-state')); });
        await page.waitForTimeout(400); await settle(page);
        const noState = (await page.evaluate(readJobs)).jobs[1];
        assert.notEqual(noState.last.color, DANGER[skin][theme], `${tag}: 反例没生效：去掉 data-state 后 j2 仍是 danger 色`);
        await page.evaluate(() => { document.querySelectorAll('#pinkie-schedules .pk-job__last:not([data-state])').forEach((el) => { el.dataset.state = 'error'; }); });

        // 反例 2：删掉 laolao-rich.css 里给 .pk-job__last 上色的规则，j2 必须不再是 danger 色
        const removed = await page.evaluate(() => {
          let n = 0;
          for (const sh of document.styleSheets) {
            if (!/laolao-rich\.css/.test(sh.href || '')) continue;
            for (let i = sh.cssRules.length - 1; i >= 0; i--) if (/pk-job__last/.test(sh.cssRules[i].cssText)) { sh.deleteRule(i); n++; }
          }
          return n;
        });
        assert.ok(removed >= 1, `${tag}: 页面上的 laolao-rich.css 里没找到 .pk-job__last 规则`);
        await page.waitForTimeout(400); await settle(page);
        const noCss = (await page.evaluate(readJobs)).jobs[1];
        assert.equal(noCss.last.state, 'error');
        assert.notEqual(noCss.last.color, DANGER[skin][theme], `${tag}: 反例没生效：删掉规则后 j2 仍是 danger 色`);
        assert.deepEqual(pageErrors, [], `${tag}: 页面报错`);
      } finally {
        await context.close();
      }
    }
  }
});
