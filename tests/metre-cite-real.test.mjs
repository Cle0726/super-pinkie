// M13 / M14 复发防护（真页面）：真实安装的 OpenClaw Control UI + 碧琪注入，Metre 日、夜各量一遍。
// 11-24 协调者看图打回 #81：
//   1. 引用卡没有标题：卡片带 role="tooltip"，Metre 皮肤给所有 tooltip 铺「正文色底 + 底色字」反色（强制覆盖），
//      标题用正文色，和底同色整行消失；卡片因此日间黑底、夜间米白底，摘要和底部提示也看不清。
//   2. 悬停角标变成实心强调色块：皮肤把正文链接字色定死成强调色，悬停底色也是强调色，数字看不见。
//   3. 念的时候鼠标移开，原生左边三键和时间戳消失（只在悬停这条回答时显示），整排看起来往右跳；「停止朗读」只是个小方框。
// 读 CSS 文本抓不到「被别的文件压掉」，所以这里截图读像素、量真实位置。
// 反例写在同一个测试里：把旧样子放回页面（卡片加回 role=tooltip、角标悬停铺实心强调色、删掉念时保持按键行的规则），再量一次必须失败。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const N = 'https://nodejs.org/en/blog/release/v22.0.0';
const t = (text) => [{type: 'text', text}];
const results = [
  {title: 'Node.js 22 发布说明', url: N, snippet: 'Node.js 22 带来了 require(esm) 实验支持……', siteName: 'nodejs.org'},
  {title: 'V8 12.4 新特性', url: 'https://v8.dev/blog/v8-release-124', snippet: 'Maglev 编译器默认开启……', siteName: 'v8.dev'},
];
const HISTORY = [
  {role: 'user', content: t('Node 22 有什么新东西？查一下'), timestamp: 1},
  {role: 'assistant', stopReason: 'toolUse', content: [{type: 'toolCall', id: 'ws1', name: 'web_search', arguments: {query: 'Node.js 22'}}], timestamp: 2},
  {role: 'toolResult', toolCallId: 'ws1', toolName: 'web_search', content: t(JSON.stringify({query: 'Node.js 22', results})), timestamp: 3},
  {role: 'assistant', stopReason: 'stop', content: t('Node 22 主要有两点 [1]：\n\n- `require()` 可以加载 ES 模块 [1]\n- V8 升到 12.4 [2]'), timestamp: 4},
];
// 假的语音合成：不出声，念到被 cancel 为止。
const FAKE_TTS = `(() => { let cur = null; const ss = {speaking: false, pending: false, paused: false, getVoices: () => [],
  speak(u) { ss.speaking = true; cur = u; }, cancel() { const u = cur; cur = null; ss.speaking = false; u && u.onend && u.onend({}); },
  pause() {}, resume() {}, addEventListener() {}, removeEventListener() {}};
  Object.defineProperty(window, 'speechSynthesis', {configurable: true, value: ss});
  if (!window.SpeechSynthesisUtterance) window.SpeechSynthesisUtterance = function (text) { this.text = text; }; })();`;
// eslint-disable-next-line no-new-func
const initScript = new Function(`window.__fakeSeedHistory = ${JSON.stringify(HISTORY)};\n${FAKE_TTS}`);

// 截一块矩形：出现最多的颜色当底、离它亮度最远的颜色当字，算 WCAG 对比度。
async function contrast(page, box) {
  assert.ok(box && box.width > 2 && box.height > 2, `要量的区域没有尺寸：${JSON.stringify(box)}`);
  const buf = await page.screenshot({clip: box});
  return page.evaluate(async (b64) => {
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
    for (let i = 0; i < d.length; i += 4) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
    const bg = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    const lb = L(...bg);
    let ink = bg; let far = -1;
    for (const k of cnt.keys()) { const px = k.split(',').map(Number); const dl = Math.abs(L(...px) - lb); if (dl > far) { far = dl; ink = px; } }
    const li = L(...ink);
    return {bg: `rgb(${bg})`, ink: `rgb(${ink})`, ratio: (Math.max(lb, li) + 0.05) / (Math.min(lb, li) + 0.05)};
  }, buf.toString('base64'));
}
const rectOf = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return {x: r.left, y: r.top, width: r.width, height: r.height};
}, sel);
const fmt = (o) => `${o.ink} on ${o.bg} ${o.ratio.toFixed(2)}:1`;

// 最后一条回答底部看得见的按键（连同祖先的透明度一起算）和时间戳。
const footerState = (page) => page.evaluate(() => {
  const g = [...document.querySelectorAll('.chat-group.assistant')].pop();
  const shown = (e) => { let op = 1; for (let x = e; x && x !== g; x = x.parentElement) op *= Number(getComputedStyle(x).opacity); return op; };
  const buttons = [...g.querySelectorAll('.chat-group-footer button')]
    .filter((b) => b.getBoundingClientRect().width > 1)
    .map((b) => ({label: b.getAttribute('aria-label') || b.textContent.trim(), x: Math.round(b.getBoundingClientRect().left), op: shown(b)}));
  const visible = buttons.filter((b) => b.op > 0.3);
  const ts = g.querySelector('.chat-group-timestamp');
  return {left: visible.length ? Math.min(...visible.map((b) => b.x)) : null, count: visible.length, all: buttons.length, ts: ts ? shown(ts) : null};
});

async function hoverCite(page) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(150);
  await page.locator('.chat-group.assistant .pinkie-cite').first().hover();
  await page.waitForSelector('.pk-mcite-card', {timeout: 5_000});
  await page.waitForTimeout(300);
}

test('M13/M14 real page: citation card title + contrast, hovered badge number, read-aloud row stays put (pixels), and old styles fail', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
    try {
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
      await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
      await page.waitForSelector('.chat-group.assistant .pinkie-cite', {timeout: 10_000});
      await page.locator('.chat-group.assistant .pinkie-cite').first().scrollIntoViewIfNeeded();

      // ---------- M13 引用卡 ----------
      await hoverCite(page);
      const card = await page.evaluate(() => {
        const c = document.querySelector('.pk-mcite-card');
        const s = getComputedStyle(c);
        return {role: c.getAttribute('role'), bg: s.backgroundColor, card: getComputedStyle(document.documentElement).getPropertyValue('--metre-card').trim(),
          title: c.querySelector('.pk-mcite-card__title')?.textContent || ''};
      });
      assert.equal(card.role, null, `${theme}: 引用卡不能带 role=tooltip（会被皮肤铺成反色）`);
      assert.equal(card.title, 'Node.js 22 发布说明', `${theme}: 引用卡要有标题`);
      const parts = {};
      for (const k of ['title', 'snippet', 'foot', 'host']) parts[k] = await contrast(page, await rectOf(page, `.pk-mcite-card__${k}`));
      t.diagnostic(`${theme} card bg ${card.bg}: ${Object.entries(parts).map(([k, v]) => `${k} ${fmt(v)}`).join("; ")}`);
      for (const k of ['title', 'snippet']) assert.ok(parts[k].ratio >= 4.5, `${theme}: 引用卡 ${k} 不到 4.5:1 — ${fmt(parts[k])}`);
      for (const k of ['foot', 'host']) assert.ok(parts[k].ratio >= 4.5, `${theme}: 引用卡 ${k} 小字不到 4.5:1 — ${fmt(parts[k])}`);
      // 卡片底色就是 Metre 弹层色（日间白、夜间深），不是反色
      const bgL = await page.evaluate((c) => { const m = c.match(/\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; }, card.bg);
      assert.ok(theme === 'day' ? bgL > 200 : bgL < 60, `${theme}: 引用卡底色不对（${card.bg}，--metre-card=${card.card}）`);

      // ---------- M13 悬停角标：数字要看得见 ----------
      const inset = async () => { const r = await rectOf(page, '.chat-group.assistant .pinkie-cite[aria-describedby]'); return r && {x: r.x + 2, y: r.y + 2, width: r.width - 4, height: r.height - 4}; };
      const badge = await contrast(page, await inset());
      t.diagnostic(`${theme} hovered badge: ${fmt(badge)}`);
      assert.ok(badge.ratio >= 3, `${theme}: 悬停时角标数字看不清 — ${fmt(badge)}`);

      // 反例 1：卡片加回 role=tooltip（旧样子），标题必须看不见
      await page.evaluate(() => document.querySelector('.pk-mcite-card').setAttribute('role', 'tooltip'));
      await page.waitForTimeout(100);
      const oldTitle = await contrast(page, await rectOf(page, '.pk-mcite-card__title'));
      assert.ok(oldTitle.ratio < 1.5, `反例没生效：卡片带 role=tooltip 时标题仍有 ${fmt(oldTitle)}`);
      // 反例 2：角标悬停放回旧规则（实心强调色底），数字必须看不见
      await page.addStyleTag({content: 'html[data-laolao-mode="metre"] .chat-group .pinkie-cite[aria-describedby] { background: var(--metre-accent) !important; border-color: var(--metre-accent) !important; }'});
      await page.waitForTimeout(100);
      const oldBadge = await contrast(page, await inset());
      assert.ok(oldBadge.ratio < 1.5, `反例没生效：实心强调色底上角标数字仍有 ${fmt(oldBadge)}`);
      await page.evaluate(() => { for (const s of [...document.querySelectorAll('style')].filter((x) => x.textContent.includes('.pinkie-cite[aria-describedby] { background: var(--metre-accent) !important'))) s.remove(); });

      // ---------- M14 朗读：按键行不跳位，停止键认得出 ----------
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
      const last = page.locator('.chat-group.assistant').last();
      await last.hover();
      await page.waitForTimeout(400);
      const hovered = await footerState(page);
      assert.ok(hovered.count >= 2, `${theme}: 悬停回答后底部按键太少 ${JSON.stringify(hovered)}`);
      const read = last.locator('.pk-mread');
      assert.equal(await read.getAttribute('aria-label'), '朗读');
      await read.click();
      await page.waitForTimeout(200);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(600);
      const away = await footerState(page);
      t.diagnostic(`${theme} footer hover left=${hovered.left} n=${hovered.count}; reading+away left=${away.left} n=${away.count} ts=${away.ts}`);
      assert.equal(away.left, hovered.left, `${theme}: 念的时候鼠标移开，按键行从 x=${hovered.left} 跳到 x=${away.left}`);
      assert.equal(away.count, hovered.count, `${theme}: 念的时候鼠标移开，看得见的按键从 ${hovered.count} 个变成 ${away.count} 个`);
      assert.ok(away.ts > 0.3, `${theme}: 念的时候时间戳不见了（透明度 ${away.ts}）`);
      const stop = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.chat-group.assistant')].pop().querySelector('.pk-mread');
        return {label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), filled: !!b.querySelector('svg rect[fill="currentColor"]'), tip: getComputedStyle(b, '::after').content};
      });
      assert.deepEqual([stop.label, stop.pressed, stop.filled], ['停止朗读', 'true', true], `${theme}: 停止朗读键 ${JSON.stringify(stop)}`);
      const sq = await last.locator('.pk-mread svg rect').boundingBox();
      t.diagnostic(`${theme} stop square ${sq && `${sq.width.toFixed(1)}x${sq.height.toFixed(1)}`}`);
      assert.ok(sq && sq.width >= 9 && sq.height >= 9, `${theme}: 停止方块太小，夜间认不出（11-25 06:46 打回）${JSON.stringify(sq)}`);
      assert.equal(stop.tip, '"停止朗读"', `${theme}: 停止朗读键没有悬停提示`);
      await read.hover();
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => getComputedStyle([...document.querySelectorAll('.chat-group.assistant')].pop().querySelector('.pk-mread'), '::after').opacity), '1', `${theme}: 悬停停止朗读键提示没出来`);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(600);

      // 反例 3：删掉念时保持按键行的规则，鼠标移开后必须跳位（左边三键 / 时间戳消失）
      const removed = await page.evaluate(() => {
        let n = 0;
        for (const sh of document.styleSheets) {
          if (!/laolao-metre-cite\.css/.test(sh.href || '')) continue;
          for (let i = sh.cssRules.length - 1; i >= 0; i--) {
            const s = sh.cssRules[i].selectorText || '';
            if (s.includes(':has(.pk-mread[aria-pressed="true"])')) { sh.deleteRule(i); n++; }
          }
        }
        return n;
      });
      assert.equal(removed, 3, '没找到念时保持按键行的三条规则');
      await page.waitForTimeout(400);
      const bad = await footerState(page);
      assert.ok(bad.left !== hovered.left || bad.ts < 0.3, `反例没生效：删掉规则后按键行仍从 x=${bad.left} 开始、时间戳透明度 ${bad.ts}`);
    } finally {
      await context.close();
    }
  }
});
