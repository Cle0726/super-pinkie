// S7（11-26 ui2）：Metre 侧栏会话行显示这个会话开的工作树「目录 · 分支」（laolao-metre-worktree.js / .css），真浏览器里跑。
// 数据只来自网关 worktrees.list：ownerKind = session、ownerId = 会话 canonicalKey、没有 removedAt 的才显示。
// 版式（uireview 08:26Z 打回五条）：会话名优先、不因小字变短；剩的地方不到 6 个字符就整段不显示；分支 = …/目录 只显示目录。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const read = (f) => fs.readFileSync(inj(f), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

const LONG = '一个很长很长的会话标题用来看省略号先省哪一段';
const WORKTREES = [
  {id: 'w1', name: 'login-blue', path: 'F:/work/demo/.openclaw/worktrees/login-blue', branch: 'openclaw/login-blue', ownerKind: 'session', ownerId: 'agent:metre:a', createdAt: 1, lastActiveAt: 2},
  {id: 'w2', name: 'old', path: 'F:/work/demo/.openclaw/worktrees/old', branch: 'openclaw/old', ownerKind: 'session', ownerId: 'agent:metre:b', removedAt: 5, snapshotRef: 'refs/x'},
  {id: 'w3', name: 'manual', path: 'F:/work/demo/.openclaw/worktrees/manual', branch: 'openclaw/manual', ownerKind: 'manual', ownerId: 'agent:metre:c'},
  {id: 'w4', name: 'long-title-tree', path: 'F:/w/long-title-tree', branch: 'feat/other', ownerKind: 'session', ownerId: 'AGENT:METRE:D'},
  {id: 'w5', name: 'audit', path: 'F:/w/audit', branch: 'feat/baseline', ownerKind: 'session', ownerId: 'agent:metre:h'},
];
// f 和 d 同名、没有工作树：用来比会话名宽度（有小字的 d 不能比 f 短）。
const ROWS = {a: '会话 a', b: '会话 b', c: '会话 c', d: LONG, e: '会话 e', f: LONG, h: '会话 h'};
const KEYS = Object.keys(ROWS);

const html = (mode) => `<!doctype html><html data-laolao-mode="${mode}"><head><style>
  body{margin:0;font:14px sans-serif} aside.sidebar{position:fixed;left:0;top:0;width:238px}
  .session-row-host{display:flex;align-items:center} .sidebar-recent-session__link{display:flex;align-items:center;gap:6px;min-width:0;flex:1}
  .sidebar-recent-session__name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .session-row-aside{flex-shrink:0;font-size:12px}
  html{--metre-muted:#77736B;--metre-text:#1B1A18}
</style></head><body><aside class="sidebar"><div class="laolao-managed-groups"><div class="laolao-group"><div class="laolao-group__list">
${KEYS.map((k) => `<div class="sidebar-recent-session session-row-host" data-session-key="agent:metre:${k}"><a class="sidebar-recent-session__link"><span class="sidebar-recent-session__name">${ROWS[k]}</span></a><span class="session-row-aside">2 分钟前</span></div>`).join('')}
</div></div></div></aside></body></html>`;

async function open(browser, mode, reply) {
  const p = await browser.newPage({viewport: {width: 1200, height: 700}});
  await p.setContent(html(mode));
  await p.evaluate((reply) => {
    window.calls = [];
    window.__laolaoSidebar = {gwRequest: (method, params) => { window.calls.push([method, params]); return reply === 'fail' ? Promise.reject(new Error('x')) : Promise.resolve(reply); }};
    window.PinkieSessionList = {sessionStatus: () => ''};
  }, reply);
  await p.addStyleTag({path: inj('laolao-metre-worktree.css')});
  await p.addScriptTag({path: inj('laolao-metre-list.js')});
  await p.addScriptTag({path: inj('laolao-metre-worktree.js')});
  return p;
}
const decorate = (p) => p.evaluate((keys) => window.PinkieMetreList.decorate(document.querySelector('.laolao-managed-groups'),
  keys.map((k) => ({key: 'agent:metre:' + k, updatedAt: Date.now()})), {state: {pins: []}}), KEYS);
const tags = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.session-row-host')].map((n) => [n.dataset.sessionKey.slice(-1), n.querySelector('.pk-ml-wt')?.textContent ?? null])));

// 每行量一次：小字有没有露出来、露出来多宽、6 个等宽字符多宽、会话名是不是被截。
const measure = (p) => p.evaluate(() => {
  const out = {};
  for (const n of document.querySelectorAll('.session-row-host')) {
    const k = n.dataset.sessionKey.slice(-1), name = n.querySelector('.sidebar-recent-session__name');
    const tag = n.querySelector('.pk-ml-wt'), text = tag?.querySelector('.pk-ml-wt__text');
    const r = {nameW: name.getBoundingClientRect().width, nameClipped: name.scrollWidth > name.clientWidth + 1, tag: Boolean(tag)};
    if (text) {
      const tr = tag.getBoundingClientRect(), xr = text.getBoundingClientRect(), cs = getComputedStyle(text);
      const probe = document.createElement('span'); probe.textContent = '000000'; probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`;
      document.body.append(probe); const sixCh = probe.getBoundingClientRect().width; probe.remove();
      const shown = xr.top - tr.top < tr.height - 1 && xr.width > 0;
      const aside = n.querySelector('.session-row-aside')?.getBoundingClientRect();
      Object.assign(r, {shown, textW: xr.width, sixCh, textClipped: text.scrollWidth > text.clientWidth + 1,
        gapToTime: shown && aside ? aside.left - xr.right : null,
        oneLine: Math.abs((tr.top + tr.height / 2) - (name.getBoundingClientRect().top + name.getBoundingClientRect().height / 2)) < 4,
        color: getComputedStyle(tag).color});
    }
    out[k] = r;
  }
  return out;
});
const setWidth = (p, w) => p.evaluate((w) => { document.querySelector('aside.sidebar').style.width = w + 'px'; }, w);

test('label: branch that repeats the folder shows the folder once; different branch shows both', () => {
  // 纯函数，不开浏览器：从源码里取出 label 直接跑
  const src = read('laolao-metre-worktree.js');
  const body = src.slice(src.indexOf('function label('), src.indexOf('function paint('));
  const label = new Function(body + 'return label;')();
  assert.equal(label({folder: 'login-blue', branch: 'openclaw/login-blue'}), 'login-blue');
  assert.equal(label({folder: 'login-blue', branch: 'login-blue'}), 'login-blue');
  assert.equal(label({folder: 'audit', branch: 'feat/baseline'}), 'audit · feat/baseline');
  assert.equal(label({folder: 'login-blue', branch: 'openclaw/login-blue-2'}), 'login-blue · openclaw/login-blue-2', '只是前缀相同不算重复');
  assert.equal(label({folder: 'blue', branch: 'openclaw/login-blue'}), 'blue · openclaw/login-blue', '要整段 /目录 结尾才算重复');
  assert.equal(label({folder: '', branch: 'feat/x'}), 'feat/x');
  assert.equal(label({folder: 'x', branch: ''}), 'x');
});

test(`Metre session row shows the worktree only for live session-owned worktrees; name first, no stub (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser, 'metre', {worktrees: WORKTREES});
    await decorate(p);
    await p.waitForFunction(() => document.querySelector('.pk-ml-wt'));
    assert.deepEqual(await tags(p), {a: 'login-blue', b: null, c: null, d: 'long-title-tree · feat/other', e: null, f: null, h: 'audit · feat/baseline'},
      '按 ownerId 对上会话 key；已移除的、不是会话开的、对不上的都不显示；分支 = openclaw/目录 只显示目录');
    assert.deepEqual(await p.evaluate(() => window.calls), [['worktrees.list', {}]], '只调一次现成的 worktrees.list，参数为空');
    const tip = await p.locator('[data-session-key="agent:metre:a"] .pk-ml-wt').getAttribute('data-pinkie-tooltip');
    assert.equal(tip, '工作树 F:/work/demo/.openclaw/worktrees/login-blue，分支 openclaw/login-blue', '完整的目录和分支在悬停提示里');

    const m = await measure(p);
    // 短会话名：小字露出来、整段放得下、和会话名一行、用 --metre-muted
    assert.ok(m.a.shown && !m.a.textClipped && !m.a.nameClipped && m.a.oneLine, `a 行小字完整露出（${JSON.stringify(m.a)}）`);
    assert.equal(m.a.color, 'rgb(119, 115, 107)', '小字用 --metre-muted');
    // 长会话名：会话名和没有工作树的同名行一样宽（不因小字变短），小字整段不显示
    assert.ok(Math.abs(m.d.nameW - m.f.nameW) < 0.5, `会话名优先：有小字的 d 和没小字的 f 一样宽（${m.d.nameW} / ${m.f.nameW}）`);
    assert.equal(m.d.shown, false, `会话名占满时小字不显示（${JSON.stringify(m.d)}）`);
    // 每一行：小字要么不显示，要么至少 6 个字符宽
    for (const [k, r] of Object.entries(m)) if (r.tag && r.shown) assert.ok(r.textW >= r.sixCh - 0.5, `${k} 行小字露出时至少 6 个字符（${r.textW} / ${r.sixCh}）`);

    // 重画列表：从缓存补上，不再打网关
    await p.evaluate(() => { for (const n of document.querySelectorAll('.pk-ml-dot, .pk-ml-wt')) n.remove(); });
    await decorate(p);
    assert.equal((await tags(p)).a, 'login-blue', '重画后照样有');
    assert.equal(await p.evaluate(() => window.calls.length), 1, '30 秒内重画不再请求');
  } finally { await browser.close(); }
});

test(`Metre worktree tag across sidebar widths: never a stub, never shortens the name; shows both parts when there is room (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser, 'metre', {worktrees: WORKTREES});
    await decorate(p);
    await p.waitForFunction(() => document.querySelector('.pk-ml-wt'));
    let sawHidden = false, sawShown = false;
    for (let w = 120; w <= 420; w += 6) {
      await setWidth(p, w);
      const m = await measure(p);
      for (const k of ['a', 'h']) {
        const r = m[k];
        assert.equal(r.nameClipped, false, `${w}px：${k} 行短会话名不被截（${JSON.stringify(r)}）`);
        if (r.shown) {
          sawShown = true;
          assert.ok(r.textW >= r.sixCh - 0.5, `${w}px：${k} 行小字露出就至少 6 个字符（${r.textW} / ${r.sixCh}）`);
          assert.ok(r.gapToTime >= 6, `${w}px：${k} 行小字到右边时间至少 6px（${r.gapToTime}）`);
        } else sawHidden = true;
      }
      assert.ok(Math.abs(m.d.nameW - m.f.nameW) < 0.5, `${w}px：长会话名有没有小字都一样宽（${m.d.nameW} / ${m.f.nameW}）`);
    }
    assert.ok(sawHidden, '反例：侧栏窄到剩不到 6 个字符时，小字整段不显示（不出现「b…」）');
    assert.ok(sawShown, '侧栏够宽时小字会显示');
    await setWidth(p, 420);
    const wide = await measure(p);
    assert.ok(wide.h.shown && !wide.h.textClipped, `够宽时「audit · feat/baseline」整段放得下（${JSON.stringify(wide.h)}）`);

    // 反例：去掉右边 8px 外边距，小字顶满时会贴住时间（上面那条 ≥ 6px 的断言能抓到）
    await p.addStyleTag({content: 'html[data-laolao-mode="metre"] aside.sidebar .session-row-host .pk-ml-wt__text { margin-inline-end: 0; }'});
    let minGap = Infinity;
    for (let w = 120; w <= 420; w += 6) {
      await setWidth(p, w);
      const m = await measure(p);
      for (const k of ['a', 'h']) if (m[k].shown) minGap = Math.min(minGap, m[k].gapToTime);
    }
    assert.ok(minGap < 6, `反例：没有右边距时小字会贴到时间（最小 ${minGap}px）`);
  } finally { await browser.close(); }
});

test(`Metre worktree tags: gateway error shows nothing; other modes never call or draw (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser, 'metre', 'fail');
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await decorate(p); await p.waitForTimeout(200);   // 保留：断言网关出错时「什么都不画」，没有能等的条件
    assert.deepEqual(await tags(p), Object.fromEntries(KEYS.map((k) => [k, null])), '网关出错就当没有');
    assert.deepEqual(errors, []);
    const q = await open(browser, 'project', {worktrees: WORKTREES});
    await q.evaluate(() => window.PinkieMetreWorktree.mark(document.querySelector('.laolao-managed-groups')));
    await q.waitForTimeout(200);   // 保留：断言别的模式「不画、不请求」，没有能等的条件
    assert.equal(await q.locator('.pk-ml-wt').count(), 0, '别的模式不画');
    assert.equal(await q.evaluate(() => window.calls.length), 0, '别的模式不请求');
  } finally { await browser.close(); }
});

test('wiring: S7 files are in the head and the metre region; list decorator calls mark; Metre-only CSS without !important; no timers / observers / window.__ names (only the frozen PinkieMetreWorktree)', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<script defer src="\/laolao-metre-list\.js\?v=@hash"><\/script>\r?\n<link rel="stylesheet" href="\/laolao-metre-worktree\.css\?v=@hash">\r?\n<script defer src="\/laolao-metre-worktree\.js\?v=@hash"><\/script>/);
  const regions = read('regions.json');
  assert.ok(regions.includes('"laolao-metre-worktree.css"') && regions.includes('"laolao-metre-worktree.js"'));
  assert.match(read('laolao-metre-list.js'), /window\.PinkieMetreWorktree\?\.mark\(groups\);/);
  const css = read('laolao-metre-worktree.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /!\s*important/i);
  for (const rule of css.split('}').map((s) => s.trim()).filter(Boolean)) assert.match(rule, /^html\[data-laolao-mode="metre"\] /, '每条规则都只在 Metre');
  const js = read('laolao-metre-worktree.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(js, /setInterval|setTimeout|MutationObserver|ResizeObserver|window\.__\w+\s*=/);
  assert.deepEqual([...js.matchAll(/window\.(\w+)\s*=/g)].map((m) => m[1]), ['PinkieMetreWorktree'], '只挂一个全局名');
  assert.match(js, /window\.PinkieMetreWorktree = Object\.freeze\(/, '而且是冻结的');
  assert.match(js, /gw\('worktrees\.list', \{\}/, '只用现成的 worktrees.list');
});
