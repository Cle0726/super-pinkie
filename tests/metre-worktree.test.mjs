// S7（11-26 ui2）：Metre 侧栏会话行显示这个会话开的工作树「目录 · 分支」（laolao-metre-worktree.js / .css），真浏览器里跑。
// 数据只来自网关 worktrees.list：ownerKind = session、ownerId = 会话 canonicalKey、没有 removedAt 的才显示。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const read = (f) => fs.readFileSync(inj(f), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

const WORKTREES = [
  {id: 'w1', name: 'login-blue', path: 'F:/work/demo/.openclaw/worktrees/login-blue', branch: 'openclaw/login-blue', ownerKind: 'session', ownerId: 'agent:metre:a', createdAt: 1, lastActiveAt: 2},
  {id: 'w2', name: 'old', path: 'F:/work/demo/.openclaw/worktrees/old', branch: 'openclaw/old', ownerKind: 'session', ownerId: 'agent:metre:b', removedAt: 5, snapshotRef: 'refs/x'},
  {id: 'w3', name: 'manual', path: 'F:/work/demo/.openclaw/worktrees/manual', branch: 'openclaw/manual', ownerKind: 'manual', ownerId: 'agent:metre:c'},
  {id: 'w4', name: 'a-very-long-worktree-folder-name-for-ellipsis', path: 'F:/w/a-very-long-worktree-folder-name-for-ellipsis', branch: 'openclaw/a-very-long-branch-name', ownerKind: 'session', ownerId: 'AGENT:METRE:D'},
];
const KEYS = ['a', 'b', 'c', 'd', 'e'];

const html = (mode) => `<!doctype html><html data-laolao-mode="${mode}"><head><style>
  body{margin:0;font:14px sans-serif} aside.sidebar{position:fixed;left:0;top:0;width:238px}
  .session-row-host{display:flex;align-items:center} .sidebar-recent-session__link{display:flex;align-items:center;min-width:0;flex:1}
  .sidebar-recent-session__name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  html{--metre-muted:#77736B;--metre-text:#1B1A18}
</style></head><body><aside class="sidebar"><div class="laolao-managed-groups"><div class="laolao-group"><div class="laolao-group__list">
${KEYS.map((k) => `<div class="sidebar-recent-session session-row-host" data-session-key="agent:metre:${k}"><a class="sidebar-recent-session__link"><span class="sidebar-recent-session__name">${k === 'd' ? '一个很长很长的会话标题用来看省略号先省哪一段' : '会话 ' + k}</span></a><span class="session-row-aside"></span></div>`).join('')}
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

test(`Metre session row shows folder · branch only for live session-owned worktrees (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser, 'metre', {worktrees: WORKTREES});
    await decorate(p);
    await p.waitForFunction(() => document.querySelector('.pk-ml-wt'));
    assert.deepEqual(await tags(p), {a: 'login-blue · openclaw/login-blue', b: null, c: null, d: 'a-very-long-worktree-folder-name-for-ellipsis · openclaw/a-very-long-branch-name', e: null},
      '按 ownerId 对上会话 key；已移除的、不是会话开的、对不上的都不显示');
    assert.deepEqual(await p.evaluate(() => window.calls), [['worktrees.list', {}]], '只调一次现成的 worktrees.list，参数为空');
    const tip = await p.locator('[data-session-key="agent:metre:a"] .pk-ml-wt').getAttribute('data-pinkie-tooltip');
    assert.equal(tip, '工作树 F:/work/demo/.openclaw/worktrees/login-blue，分支 openclaw/login-blue');
    // 重画列表：从缓存补上，不再打网关
    await p.evaluate(() => { for (const n of document.querySelectorAll('.pk-ml-dot, .pk-ml-wt')) n.remove(); });
    await decorate(p);
    assert.equal((await tags(p)).a, 'login-blue · openclaw/login-blue', '重画后照样有');
    assert.equal(await p.evaluate(() => window.calls.length), 1, '30 秒内重画不再请求');
    // 长标题：小字最多四成宽、和标题在一行里、小字先省略，不把行撑出去
    const r = await p.evaluate(() => {
      const row = document.querySelector('[data-session-key="agent:metre:d"]'), link = row.querySelector('.sidebar-recent-session__link');
      const tag = row.querySelector('.pk-ml-wt'), name = row.querySelector('.sidebar-recent-session__name');
      const lr = link.getBoundingClientRect(), tr = tag.getBoundingClientRect(), nr = name.getBoundingClientRect();
      return {linkW: lr.width, tagW: tr.width, tagRight: tr.right, linkRight: lr.right, nameW: nr.width,
        tagClipped: tag.scrollWidth > tag.clientWidth + 1, oneLine: Math.abs(tr.top - nr.top) < 6, color: getComputedStyle(tag).color};
    });
    assert.ok(r.tagW <= r.linkW * 0.4 + 1, `小字最多四成宽（${r.tagW} / ${r.linkW}）`);
    assert.ok(r.tagRight <= r.linkRight + 0.5, `不出界（${r.tagRight} / ${r.linkRight}）`);
    assert.ok(r.oneLine && r.tagClipped && r.nameW > 40, `一行里、小字省略、标题仍看得见（${JSON.stringify(r)}）`);
    assert.equal(r.color, 'rgb(119, 115, 107)', '小字用 --metre-muted');
  } finally { await browser.close(); }
});

test(`Metre worktree tags: gateway error shows nothing; other modes never call or draw (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser, 'metre', 'fail');
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await decorate(p); await p.waitForTimeout(200);
    assert.deepEqual(await tags(p), {a: null, b: null, c: null, d: null, e: null}, '网关出错就当没有');
    assert.deepEqual(errors, []);
    const q = await open(browser, 'project', {worktrees: WORKTREES});
    await q.evaluate(() => window.PinkieMetreWorktree.mark(document.querySelector('.laolao-managed-groups')));
    await q.waitForTimeout(200);
    assert.equal(await q.locator('.pk-ml-wt').count(), 0, '别的模式不画');
    assert.equal(await q.evaluate(() => window.calls.length), 0, '别的模式不请求');
  } finally { await browser.close(); }
});

test('wiring: S7 files are in the head and the metre region; list decorator calls mark; Metre-only CSS without !important; no timers / observers / globals', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<script defer src="\/laolao-metre-list\.js\?v=@hash"><\/script>\r?\n<link rel="stylesheet" href="\/laolao-metre-worktree\.css\?v=@hash">\r?\n<script defer src="\/laolao-metre-worktree\.js\?v=@hash"><\/script>/);
  const regions = read('regions.json');
  assert.ok(regions.includes('"laolao-metre-worktree.css"') && regions.includes('"laolao-metre-worktree.js"'));
  assert.match(read('laolao-metre-list.js'), /window\.PinkieMetreWorktree\?\.mark\(groups\);/);
  const css = read('laolao-metre-worktree.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /!\s*important/i);
  for (const rule of css.split('}').map((s) => s.trim()).filter(Boolean)) assert.match(rule, /^html\[data-laolao-mode="metre"\] /, '每条规则都只在 Metre');
  const js = read('laolao-metre-worktree.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(js, /setInterval|MutationObserver|window\.__\w+\s*=/);
  assert.match(js, /gw\('worktrees\.list', \{\}/, '只用现成的 worktrees.list');
});
