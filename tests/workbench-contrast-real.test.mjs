// B11·workbench 复发防护（真页面，Chromium）：项目 / 无限模式工作台日夜 × 1440 / 820。
// 对比度（判据同 tools/pr-shots/b11-project-walkthrough.mjs：小字 ≥ 4.5，控件边框 / 图标 ≥ 3）：
//   空态「打开项目文件夹…」字与边框、项目条「未打开 / 主目录」、窄屏「代码 / 对话」切换、状态栏 C.le. 标志（遮罩，按 backgroundImage 渐变各色标逐个量取最低，无渐变才退回 backgroundColor）、活动栏选中图标。
//   走查旧值（日间）：边框 1.26，夜间字 4.25，标签 3.24，「对话」3.25 / 4.31，标志 1.0，codicon-files 2.98。
//   标志反例 = main 的渐变 + 只加一层被盖住的底色（不动渐变），日间改后值必须比它高 ≥1（main 可见渐变约 3.1，不一定低于 3）。
// 820 状态栏：任意两项不按走查的 overlap 判据互压（互不包含、相交 ≥ 较小框 15%、相交中心点落在其中一框内），左右两半不相交。
// 反例：贴回旧配方必须量出不合格；820 撤掉 fitStatus 的整项隐藏并贴回 B50 前的状态栏规则，必须量出互压。
import assert from 'node:assert/strict';
import test from 'node:test';
import {REPO_ROOT, installRealControlUi, launchRealBrowser, openRealScenePage, startRealUiServer} from './visual/lib/real-harness.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

const WIDTHS = [1440, 820];
const MIN = {text: 4.5, icon: 3, border: 3};

const OLD_RECIPE = `
.pk-wb-act.is-active .codicon.codicon { color: var(--wb-accent) !important; }
.pk-wb-project__tag.pk-wb-project__tag { color: var(--wb-cle) !important; }
.pk-wb-open-project.pk-wb-open-project { color: inherit !important; border-color: var(--wb-line) !important; }
.pk-workspace-header__views button:not([aria-selected="true"]) { color: var(--muted) !important; }
.pk-wb-mark.pk-wb-mark { background: linear-gradient(110deg, var(--accent, #ff7aa2), var(--cle-accent, #62b4ff)) color-mix(in srgb, var(--wb-accent, #ff7aa2) 55%, var(--wb-text, #efe5ea)) !important; }
`;
const OLD_STATUS = `
.pk-wb-status > .pk-wb-status__side:first-child { flex: none !important; }
.pk-wb-status > .pk-wb-status__side:last-child { flex: 0 1 auto !important; min-width: 0 !important; overflow: hidden !important; justify-content: flex-end !important; }
`;

// 走查项目 #14–#16 用 sidebar-expanded（项目模式），无限 #14 用 home-unrestricted（无限模式），同一批工作台项。
const SCENES = [{scene: 'sidebar-expanded', mode: 'project'}, {scene: 'home-unrestricted', mode: 'unrestricted'}];

const makeInit = (bound, mode) => new Function(`
const NL = String.fromCharCode(10);
const FILES = {'README.md': ['# proj', '', 'npm run dev', ''].join(NL), 'src/game.js': 'let a = 1;' + NL};
const rel = (p) => { const s = String(p || ''); return s.startsWith('/proj/') ? s.slice(6) : s === '/proj' ? '' : s; };
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: '${mode}', name: 'proj', bound: ${bound}, unrestricted: ${mode === 'unrestricted'}}),
  'pinkie.fs.list': (p) => { const dir = rel(p.path); const seen = new Map();
    for (const f of Object.keys(FILES)) { if (dir && !f.startsWith(dir + '/')) continue; const rest = dir ? f.slice(dir.length + 1) : f; const head = rest.split('/')[0];
      seen.set(head, {name: head, path: (dir ? dir + '/' : '') + head, kind: rest.includes('/') ? 'dir' : 'file'}); }
    return {entries: [...seen.values()]}; },
  'pinkie.fs.read': (p) => { const content = FILES[rel(p.path)] || ''; return {kind: 'text', content, path: p.path, readOnly: false, size: content.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', changes: [{path: 'src/game.js', status: 'M'}]}),
  'pinkie.fs.gitShow': (p) => { const c = FILES[rel(p.path)]; return c ? {content: c, exists: true} : {content: '', exists: false}; },
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b11wb) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b11wbSend(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b11wb = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

// 页面里：字色 / 图标色 / 边框色 × 自己和祖先 opacity 连乘，混到祖先 background-color 层层合成的底上算对比度。
function measure() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', {willReadFrequently: true});
  const rgb = (s) => {
    s = String(s).trim();
    if (s === 'transparent') return [0, 0, 0, 0];
    const n = (s.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^color\(srgb\s/.test(s)) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1];
    if (/^rgba?\(/.test(s)) return [n[0], n[1], n[2], n[3] ?? 1];
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(getComputedStyle(n).backgroundColor);
    let bg = [255, 255, 255];
    for (const c of chain.reverse()) bg = over(rgb(c), bg);
    return bg;
  };
  const opOf = (el) => { let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity); return op; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width >= 2 && r.height >= 2 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
    && getComputedStyle(el).visibility !== 'hidden' && opOf(el) >= 0.05; };
  const out = [];
  const push = (name, kind, el, colorStr, bgs) => {
    const raw = rgb(colorStr);
    let best = null;
    for (const bg of bgs) {
      const ink = over([raw[0], raw[1], raw[2], raw[3] * opOf(el)], bg);
      const r = ratio(ink, bg);
      if (!best || r > best.ratio) best = {ratio: r, ink: `rgb(${ink.map(Math.round)})`, bg: `rgb(${bg.map(Math.round)})`};
    }
    out.push({name, kind, ...best});
  };
  for (const el of document.querySelectorAll('.pk-wb-open-project')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    push('open-project·字', 'text', el, cs.color, [bgOf(el)]);
    if (parseFloat(cs.borderTopWidth) > 0) push('open-project·边框', 'border', el, cs.borderTopColor, [bgOf(el.parentElement), bgOf(el)]);
  }
  for (const el of document.querySelectorAll('.pk-wb-project__tag')) if (vis(el) && el.textContent.trim()) push('tag·字', 'text', el, getComputedStyle(el).color, [bgOf(el)]);
  for (const el of document.querySelectorAll('.pk-workspace-header__views > button')) {
    if (vis(el)) push(`views「${el.textContent.trim()}」·字`, 'text', el, getComputedStyle(el).color, [bgOf(el)]);
  }
  for (const el of document.querySelectorAll('.pk-wb-status__mode .pk-wb-mark')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const stops = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage.match(/(?:rgba?|color)\([^()]*\)/g) || [] : [];
    const n = out.length;
    for (const c of stops.length ? stops : [cs.backgroundColor]) push('mark·图标', 'icon', el, c, [bgOf(el.parentElement)]);
    const worst = out.splice(n).reduce((a, b) => (b.ratio < a.ratio ? b : a));
    out.push({...worst, stops: stops.length});
  }
  for (const el of document.querySelectorAll('.pk-wb-act.is-active .codicon')) {
    if (vis(el)) push(el.classList.contains('codicon-files') ? 'files·图标' : 'act·图标', 'icon', el, getComputedStyle(el).color, [bgOf(el)]);
  }
  return {mode: document.documentElement.dataset.laolaoMode, night: document.documentElement.hasAttribute('data-pinkie-night'), items: out};
}

// 页面里：状态栏内文字 / 控件 / svg / 遮罩 / codicon 两两按走查 overlap 判据比；oldCss 给了就先撤掉 fitStatus 的整项隐藏、贴回旧规则（同一次调用里量完，不给 fitStatus 重算的机会）。
function statusOverlap(oldCss) {
  const bar = document.querySelector('.pk-wb-status');
  if (!bar) return null;
  const [left, right] = [bar.firstElementChild, bar.lastElementChild];
  if (oldCss) {
    const st = document.createElement('style'); st.textContent = oldCss; document.head.append(st);
    for (const k of right.children) k.style.display = '';
    right.style.minWidth = '';
    void bar.offsetWidth;
  }
  const contains = (a, b) => { for (let x = b; x; x = x.parentElement) if (x === a) return true; return false; };
  const label = (e) => `${e.localName}.${String(e.className?.baseVal ?? e.className).trim().split(/\s+/).slice(0, 2).join('.')}`;
  const cands = [];
  for (const e of bar.querySelectorAll('*')) {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const mask = (cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none');
    if (text || e.localName === 'button' || e.localName === 'svg' || mask || e.classList.contains('codicon')) cands.push({e, r, text: (e.textContent || '').trim().slice(0, 20)});
  }
  const overlap = [];
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
    const A = cands[i], B = cands[j];
    const ix = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
    const iy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
    if (ix < 2 || iy < 2 || contains(A.e, B.e) || contains(B.e, A.e)) continue;
    const small = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
    if (ix * iy < 0.15 * small) continue;
    const t = document.elementFromPoint(Math.max(A.r.left, B.r.left) + ix / 2, Math.max(A.r.top, B.r.top) + iy / 2);
    if (!t || !(contains(A.e, t) || contains(B.e, t))) continue;
    overlap.push({a: `${label(A.e)}「${A.text}」`, b: `${label(B.e)}「${B.text}」`, share: +(ix * iy / small).toFixed(2)});
  }
  const lb = left.getBoundingClientRect(), rb = right.getBoundingClientRect();
  return {bar: Math.round(bar.getBoundingClientRect().width), leftRight: Math.round(lb.right * 10) / 10, rightLeft: Math.round(rb.left * 10) / 10,
    sidesCross: lb.right > rb.left + 0.5, candidates: cands.length, overlap};
}

async function openBench(page, width, bound) {
  await page.setViewportSize({width, height: 900});
  await page.waitForTimeout(400);
  await page.waitForFunction(() => typeof window.__pinkieWorkbench?.show === 'function', null, {timeout: 15_000});
  await page.evaluate(() => window.__pinkieWorkbench.show());
  if (bound) {
    await page.evaluate(() => { void window.__pinkieWorkbench.open('/proj/README.md', {pinned: true}); });
    await page.waitForFunction(() => document.querySelector('.pk-wb-status__mode .pk-wb-mark'), null, {timeout: 15_000});
    // B34: was a fixed 1200ms sleep (05b1a7ce) guessing at settle time. Monaco cold-loads
    // its ~15MB bundle on the first text tab (same cause metre-files.test.mjs's settledTab
    // diagnoses, L84b) and a slow Windows runner can take well over a second doing it, so
    // measuring before the tab leaves pending/loading would read a half-built DOM. Wait on
    // that real condition instead of a guessed duration.
    await page.waitForFunction(() => {
      const tab = window.__pinkieWorkbench.state.tabs.find((t) => t.path === '/proj/README.md');
      return Boolean(tab) && !['pending', 'loading'].includes(tab.kind);
    }, null, {timeout: 15_000});
    await page.evaluate(() => window.__pinkieWorkbench.renderStatus?.());
  } else {
    await page.waitForFunction(() => document.querySelector('.pk-wb-open-project'), null, {timeout: 15_000});
  }
  await page.waitForTimeout(300);
}

const fmt = (items) => items.map((i) => `${i.name} ${i.ink} on ${i.bg} ${i.ratio.toFixed(2)}`).join('; ');
const low = (items) => items.filter((i) => i.ratio < MIN[i.kind]);

test('B11·workbench 项目 / 无限模式：工作台五项日夜 × 1440/820 对比度达标、820 状态栏不互压；贴回旧配方 / 撤掉 fitStatus 必须量出问题', {timeout: 480_000}, async (t) => {
  try { playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  let installed; let server; let browser;
  t.after(async () => {
    try { await browser?.close(); } finally { try { await server?.close(); } finally { installed?.cleanup(); } }
  });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  try { browser = await launchRealBrowser(); }
  catch (err) { t.skip(`Chromium is not installed: ${err.message.split('\n')[0]}`); return; }

  // 每个 (mode, theme, bound) 只开一个上下文，依次量 1440、820：旧配方量完即撤；撤 fitStatus 的反例改 DOM，只在最后一个宽度 820 做。
  assert.equal(WIDTHS.at(-1), 820, '改 DOM 的状态栏反例必须排在最后一个宽度');
  for (const {scene, mode} of SCENES) for (const theme of ['day', 'night']) {
    const good = Object.fromEntries(WIDTHS.map((w) => [w, []])); const bad = Object.fromEntries(WIDTHS.map((w) => [w, []]));
    for (const bound of [true, false]) {
      const pre = bound ? '已绑定' : '空态';
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, scene, theme, {timezoneId: 'Asia/Shanghai', initScript: makeInit(bound, mode)});
      try {
        for (const width of WIDTHS) {
          const tag = `${mode} ${theme} ${width}`;
          await openBench(page, width, bound);
          const r = await page.evaluate(measure);
          assert.equal(r.mode, mode, `${tag}: 模式不对（${r.mode}）`);
          assert.equal(r.night, theme === 'night', `${tag}: 日夜没切对`);
          good[width].push(...r.items.map((i) => ({...i, name: `${pre}/${i.name}`})));
          if (bound) {
            const ov = await page.evaluate(statusOverlap, '');
            console.log(`ℹ ${tag} 状态栏: ${JSON.stringify(ov)}`);
            assert.ok(ov && ov.candidates >= 4, `${tag}: 状态栏没量到东西 ${JSON.stringify(ov)}`);
            assert.equal(ov.sidesCross, false, `${tag}: 状态栏左右两半相交 ${JSON.stringify(ov)}`);
            assert.deepEqual(ov.overlap, [], `${tag}: 状态栏有互压 ${JSON.stringify(ov)}`);
          }
          const old = await page.addStyleTag({content: OLD_RECIPE});
          await page.waitForTimeout(300);
          bad[width].push(...(await page.evaluate(measure)).items.map((i) => ({...i, name: `${pre}/${i.name}`})));
          if (bound && width === 820) {
            const ov = await page.evaluate(statusOverlap, OLD_STATUS);
            console.log(`ℹ ${tag} 状态栏（反例：撤掉 fitStatus + B50 前规则）: ${JSON.stringify(ov)}`);
            assert.ok(ov && ov.overlap.length >= 1, `${tag}: 反例没生效：撤掉 fitStatus 后仍不互压 ${JSON.stringify(ov)}`);
          }
          await old.evaluate((el) => el.remove());
        }
        assert.deepEqual(pageErrors, [], `${mode} ${theme} ${pre}: 页面不该报错`);
      } finally { await context.close(); }
    }
    const badAll = [];
    for (const width of WIDTHS) {
      const tag = `${mode} ${theme} ${width}`;
      console.log(`ℹ ${tag}: ${fmt(good[width])}`);
      console.log(`ℹ ${tag} 旧配方: ${fmt(bad[width])}`);
      const names = new Set(good[width].map((i) => i.name));
      const required = width >= 1440
        ? ['已绑定/tag·字', '已绑定/mark·图标', '已绑定/files·图标', '空态/tag·字', '空态/open-project·字', '空态/open-project·边框']
        : ['已绑定/mark·图标', '已绑定/views「对话」·字'];
      for (const n of required) assert.ok(names.has(n), `${tag}: 没量到「${n}」（量不到不能算通过） — ${fmt(good[width])}`);
      assert.deepEqual(low(good[width]).map((i) => i.name), [], `${tag}: 对比度不够 — ${fmt(low(good[width]))}`);
      for (const b of bad[width]) {
        const g = good[width].find((i) => i.name === b.name);
        assert.ok(g && b.ratio <= g.ratio + 0.01, `${tag}: 旧配方反而更好「${b.name}」— 改后 ${g?.ratio.toFixed(2)}，旧配方 ${b.ratio.toFixed(2)}`);
      }
      if (theme === 'day') {
        const mustLow = width >= 1440 ? ['已绑定/tag·字', '空态/open-project·边框'] : ['已绑定/views「对话」·字'];
        const lowNames = new Set(low(bad[width]).map((i) => i.name));
        for (const n of mustLow) assert.ok(lowNames.has(n), `${tag}: 反例没生效「${n}」— ${fmt(bad[width])}`);
        // main 的可见渐变在项目模式日间量出约 3.1，不一定低于 3；只加底色不动渐变时改后值等于旧值，按差值必红。
        const gm = good[width].find((i) => i.name === '已绑定/mark·图标'); const bm = bad[width].find((i) => i.name === '已绑定/mark·图标');
        assert.ok(gm && bm && gm.ratio >= bm.ratio + 1, `${tag}: 标志只加底色没动可见渐变 — 改后 ${gm?.ratio.toFixed(2)}，main 渐变 ${bm?.ratio.toFixed(2)}`);
      }
      badAll.push(...bad[width]);
    }
    // 夜间标签规则只在 is-light 下改，旧值本来达标；按整套主题汇总要求反例至少一项不合格（标志、空态字）。
    assert.ok(low(badAll).length >= 1, `${theme}: 反例没生效：贴回旧配方后仍全部达标 — ${fmt(badAll)}`);
  }
});
