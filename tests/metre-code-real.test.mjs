// B-C3 夜间复发防护（真页面）：在真实安装的 OpenClaw Control UI + 碧琪注入上，按像素量 Metre 夜间 diff 代码块的对比度。
// 11-24 uireview 打回 #85：静态页上量的夜间 6.78 / 6.23，真页面上只有 1.78——所有模式共用的 laolao-theme.css 给
// 对话里的 code / pre 铺了不分日夜的 rgba(255,255,255,.52) !important，夜间叠成浅灰底，浅色字看不清（main 上普通代码 1.36）。
// 读 CSS 文本抓不到这种「被别的文件压掉」的情况，所以这里截图读像素。
// 反例写在同一个测试里：把 laolao-metre-code.css 里夜间代码块底色那条规则从页面上删掉，再量一次，必须掉到 4.5 以下。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const DIFF_REPLY = '改动如下：\n\n```diff\n@@ -1,3 +1,3 @@\n const a = 1;\n-const color = "red";\n+const color = "blue";\n export default a;\n```\n\n这是一段中英混排 mixed text。';

// 在页面里：截每一行的矩形，取出现最多的颜色当底色、离它最远的颜色当字，算 WCAG 对比度。
async function measureRows(page) {
  await page.evaluate(() => {
    window.__pinkieMetreBoard?.close?.();
    document.querySelector('.chat-text pre code.language-diff')?.scrollIntoView({block: 'center'});
  });
  await page.waitForTimeout(200);
  const boxes = await page.evaluate(() => {
    const code = document.querySelector('.chat-text pre code.language-diff');
    if (!code) return null;
    const out = {};
    for (const [k, sel] of [['deletion', '.hljs-deletion'], ['addition', '.hljs-addition'], ['meta', '.hljs-meta']]) {
      const r = code.querySelector(sel)?.getClientRects()[0];
      if (r) out[k] = {x: r.left, y: r.top, width: Math.min(r.width, 300), height: r.height};
    }
    const tn = [...code.childNodes].find((n) => n.nodeType === 3 && /const a/.test(n.textContent));
    if (tn) {
      const rg = document.createRange();
      const i = tn.textContent.indexOf('const a');
      rg.setStart(tn, i); rg.setEnd(tn, i + 11);
      const r = rg.getBoundingClientRect();
      out.context = {x: r.left, y: r.top, width: r.width, height: r.height};
    }
    return out;
  });
  assert.ok(boxes, 'Metre 对话里没有渲染出 diff 代码块');
  const res = {};
  for (const [k, bx] of Object.entries(boxes)) {
    assert.ok(bx.width > 4 && bx.height > 4, `${k} 行没有尺寸`);
    const buf = await page.screenshot({clip: bx});
    res[k] = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const L = (r, gg, bb) => [r, gg, bb].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const cnt = new Map();
      for (let i = 0; i < d.length; i += 4) { const key = `${d[i]},${d[i + 1]},${d[i + 2]}`; cnt.set(key, (cnt.get(key) || 0) + 1); }
      const bg = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
      const lb = L(...bg);
      let ink = bg; let far = -1;
      for (const key of cnt.keys()) { const px = key.split(',').map(Number); const dl = Math.abs(L(...px) - lb); if (dl > far) { far = dl; ink = px; } }
      const li = L(...ink);
      return {bg: `rgb(${bg})`, ink: `rgb(${ink})`, ratio: (Math.max(lb, li) + 0.05) / (Math.min(lb, li) + 0.05)};
    }, buf.toString('base64'));
  }
  return res;
}

const fmt = (res) => Object.entries(res).map(([k, v]) => `${k} ${v.ink} on ${v.bg} ${v.ratio.toFixed(2)}:1`).join('; ');

test('B-C3 real page: Metre night diff rows and plain code reach 4.5:1 (pixels), and fail without the override', async (t) => {
  // 每起一样东西就登记一样清理：前一样起来了、后一样失败时（例如找不到 Playwright），也不会留着服务把进程挂住。
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  // openRealScenePage 只收函数（typeof === 'function'），在它自己的种子之后跑，覆盖默认的短对话。
  // 函数会被序列化进页面，拿不到闭包，所以用 new Function 把历史直接写进函数体。
  // eslint-disable-next-line no-new-func
  const initScript = new Function(`window.__fakeSeedHistory = ${JSON.stringify([
    {role: 'user', content: [{type: 'text', text: '把登录页的按钮改成蓝色'}], timestamp: 1},
    {role: 'assistant', content: [{type: 'text', text: DIFF_REPLY}], stopReason: 'stop', timestamp: 2},
  ])};`);

  for (const theme of ['night', 'day']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
    try {
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-pinkie-night')), theme === 'night');
      await page.waitForSelector('.chat-text pre code.language-diff .hljs-addition', {timeout: 10_000});
      const res = await measureRows(page);
      for (const k of ['deletion', 'addition', 'context', 'meta']) {
        assert.ok(res[k]?.ratio >= 4.5, `${theme}: ${k} 行对比度不到 4.5:1 — ${fmt(res)}`);
      }
      if (theme === 'night') {
        // 反例：去掉夜间代码块底色的覆盖，删、加、上下文行必须掉回 4.5 以下（证明测试真能抓到这个问题）
        const removed = await page.evaluate(() => {
          let n = 0;
          for (const sh of document.styleSheets) {
            if (!/laolao-metre-code\.css/.test(sh.href || '')) continue;
            for (let i = sh.cssRules.length - 1; i >= 0; i--) {
              const s = sh.cssRules[i].selectorText || '';
              if (s.includes('data-pinkie-night') && s.includes('.cm-code-block')) { sh.deleteRule(i); n++; }
            }
          }
          return n;
        });
        assert.equal(removed, 1, '没找到夜间代码块底色那条规则');
        const bad = await measureRows(page);
        for (const k of ['deletion', 'addition', 'context']) {
          assert.ok(bad[k].ratio < 4.5, `反例没生效：去掉覆盖后 ${k} 行仍有 ${bad[k].ratio.toFixed(2)}:1 — ${fmt(bad)}`);
        }
      }
    } finally {
      await context.close();
    }
  }
});
