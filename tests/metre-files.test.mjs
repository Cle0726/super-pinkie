// R5 ①：Metre 回答下面「文件」一行（laolao-metre-files.js）+ 工作台的 show / rel / diff（laolao-workbench.js）。
// 复发防护：
//   1. 路径只认工具调用参数里的结构化字段（path / file_path / filePath，参数是 JSON 字符串也认），正文里的路径不出签；出错的调用不出签；
//      同一文件读过又改过算「改动」；每一轮只算自己的调用。
//   2. 点「打开」在真实工作台里开标签，只读标记照后端 pinkie.fs.read 的 readOnly；点「改动」进差异视图（没有 git 时退回开标签）。
//   3. 工作台不在（窗口 < 600）时不硬挤出来，行里说一句为什么。
//   4. 离开 Metre 整行拿掉；其他模式一个字不动（反例）。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import util from 'node:util';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const js = read('../ui/injections/laolao-metre-files.js');
const css = read('../ui/injections/laolao-metre-files.css');
const bench = read('../ui/injections/laolao-workbench.js');
const domWatch = read('../ui/injections/laolao-dom-watch.js');
const head = read('../ui/injections/laolao-head.fragment.html');
const regions = JSON.parse(read('../ui/injections/regions.json'));
const PORT = 30131;
const TYPES = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', ttf: 'font/ttf', svg: 'image/svg+xml', png: 'image/png'};

const t = text => [{type: 'text', text}];
const call = (id, name, args) => ({type: 'toolCall', id, name, arguments: args});
const history = [
  {role: 'user', content: t('看看 src/app.js，改一下 README'), timestamp: 1},
  {role: 'assistant', content: [call('r1', 'read', {path: '/proj/src/app.js'}), call('r2', 'read', {file_path: '/etc/hosts'})], timestamp: 2},
  {role: 'toolResult', toolCallId: 'r1', toolName: 'read', content: t('const a = 1;'), timestamp: 3},
  {role: 'toolResult', toolCallId: 'r2', toolName: 'read', content: t('127.0.0.1 localhost'), timestamp: 4},
  {role: 'assistant', content: [call('w1', 'edit', JSON.stringify({path: '/proj/README.md', oldText: 'a', newText: 'b'})), call('w2', 'write', {path: '/proj/broken.txt'}), call('x1', 'exec', {command: 'cat /proj/other.js'})], timestamp: 5},
  {role: 'toolResult', toolCallId: 'w1', toolName: 'edit', content: t('ok'), timestamp: 6},
  {role: 'toolResult', toolCallId: 'w2', toolName: 'write', isError: true, content: t('EACCES'), timestamp: 7},
  {role: 'toolResult', toolCallId: 'x1', toolName: 'exec', content: t('// /proj/other.js'), timestamp: 8},
  {role: 'assistant', content: [call('r3', 'read', {path: '/proj/src/app.js'}), call('w3', 'edit', {path: '/proj/src/app.js'})], timestamp: 9},
  {role: 'toolResult', toolCallId: 'r3', toolName: 'read', content: t('x'), timestamp: 10},
  {role: 'toolResult', toolCallId: 'w3', toolName: 'edit', content: t('ok'), timestamp: 11},
  {role: 'assistant', content: t('看过了，README 也改了。正文里提到 /proj/mention.js 不算。'), timestamp: 12},
  {role: 'user', content: t('谢谢'), timestamp: 13},
  {role: 'assistant', content: t('不客气。'), timestamp: 14},
];

// ---------- 纯函数：不起浏览器 ----------
function loadPure() {
  const ctx = {window: {}, document: {documentElement: {getAttribute: () => 'metre'}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => []},
    addEventListener() {}, requestAnimationFrame: () => 0, setTimeout, clearTimeout};
  ctx.window.addEventListener = () => {};
  vm.runInNewContext(js.replace(/\bwindow\.addEventListener/g, 'addEventListener'), ctx);
  return ctx.window.Pinkie.metreFiles;
}

test('loaded after metre-preview, owned by the metre region, no observer / interval / gateway call / !important', () => {
  const at = name => head.indexOf(`/${name}?v=@hash`);
  assert.ok(at('laolao-metre-files.css') > at('laolao-metre-preview.js'));
  assert.ok(at('laolao-metre-files.js') > at('laolao-metre-files.css'));
  const metre = Object.values(regions.regions || regions).find(region => (region.files || []).includes('laolao-metre-preview.js'));
  assert.ok(metre?.files.includes('laolao-metre-files.js') && metre.files.includes('laolao-metre-files.css'));
  assert.doesNotMatch(js, /new MutationObserver|setInterval\(|window\.__\w+\s*=/);
  assert.doesNotMatch(js, /gwRequest|fetch\(|XMLHttpRequest|WebSocket/, 'reads history only; the workbench does the reading');
  assert.doesNotMatch(css, /!important/);
  assert.match(bench, /show: async \(\) => \{ if \(!wanted\(\)\) return false;/, 'the workbench only comes out where it already may');
});

test('files come from structured tool-call arguments only: errors, exec commands and prose never chip; read then edit counts as changed', () => {
  const pure = loadPure();
  // 结果来自 vm 里的另一个 realm，原型不同；转一道 JSON 再比
  const api = {filesFor: (...a) => JSON.parse(JSON.stringify(pure.filesFor(...a)))};
  assert.deepEqual(JSON.parse(JSON.stringify(api.filesFor(history, 11))), [
    {path: '/proj/src/app.js', changed: true},
    {path: '/etc/hosts', changed: false},
    {path: '/proj/README.md', changed: true},
  ]);
  assert.deepEqual(api.filesFor(history, 13), [], 'the next turn only counts its own calls');
  const win = [{role: 'user', content: t('x'), timestamp: 1}, {role: 'assistant', content: [call('a', 'read', {path: 'F:\\p\\a.txt'})], timestamp: 2}];
  assert.deepEqual(JSON.parse(JSON.stringify(api.filesFor(win, 1))), [{path: 'F:/p/a.txt', changed: false}], 'Windows paths use / like the workbench');
  const bad = [{role: 'user', content: t('x'), timestamp: 1}, {role: 'assistant', content: [call('a', 'read', '{not json'), call('b', 'read', {path: 'a\nb'}), call('c', 'grep', {path: '/proj'})], timestamp: 2}];
  assert.deepEqual(api.filesFor(bad, 1), [], 'broken arguments, control characters and directory tools never chip');
});

// ---------- 真页面：真的 laolao-workbench.js，网关打桩 ----------
let sharedBrowser;
after(async () => { const b = await sharedBrowser; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}
async function launch(t) {
  sharedBrowser ??= start();
  const b = await sharedBrowser;
  if (b.why) { t.skip(b.why); return null; }
  return b;
}
const group = index => `<div class="chat-group assistant" id="g${index}"><div class="chat-group-messages">
<div class="chat-bubble" data-message-id="msg:assistant:${history[index].timestamp}:${index}"><div class="chat-text"><p>${history[index].content[0].text}</p></div></div>
<div class="chat-group-footer"></div></div></div>`;
const page = mode => `<!doctype html><html data-laolao-mode="${mode}"><head><link rel="stylesheet" href="/laolao-workbench.css"><style>${css}</style></head><body>
<main class="content content--chat" style="position:fixed;inset:0;overflow:auto"><openclaw-chat-pane active><div class="chat-thread" style="width:640px"><div class="chat-thread-inner">${group(11)}${group(13)}</div></div></openclaw-chat-pane></main></body></html>`;
async function open(browser, mode, {width = 1280, git = true, statusDelay = 0} = {}) {
  const tab = await browser.newPage({viewport: {width, height: 800}});
  const answer = route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/chat') return route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode)});
    // 工作台从页面目录取 Monaco 和自己的样式（BASE = 页面目录）；照真包一样从 ui/injections 给。以前一律 404，文本标签变成「编辑器加载失败」，CI 上这几条一直是红的。
    const file = fileURLToPath(new URL('../ui/injections' + url.pathname, import.meta.url));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status: 404, body: ''});
    return route.fulfill({contentType: TYPES[file.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(file)});
  };
  // L84b：页面来要文件、文件交出去，都记一笔进展（settledTab 按「多久没有进展」算期限）
  await tab.route(`http://127.0.0.1:${PORT}/**`, async route => {
    lastServed.set(tab, Date.now());
    try { await answer(route); } finally { lastServed.set(tab, Date.now()); }
  });
  await tab.goto(`http://127.0.0.1:${PORT}/chat?session=agent%3A${mode === 'metre' ? 'metre' : 'project'}%3Atest`);
  await tab.evaluate(([items, git, statusDelay]) => {
    document.querySelector('openclaw-chat-pane').state = {chatMessages: items};
    window.__pinkieMessageActions = {historyItem: (id, list) => list.find(item => id === `msg:${item.role}:${item.timestamp}:${list.indexOf(item)}`) || null};
    window.calls = [];
    window.__laolaoSidebar = {gwRequest: async (method, params = {}) => {
      window.calls.push([method, params.path || '']);
      // B66：statusDelay 让工作台的 pinkie.fs.status 人为晚到，复现 CI 上「show() 还在等 info」那段窗口
      if (method === 'pinkie.fs.status') { if (statusDelay) await new Promise(r => setTimeout(r, statusDelay)); return {root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}; }
      if (method === 'pinkie.fs.list') return {entries: []};
      // 后端说了算：项目外只读（这里按非 Metre 的规则答，看前端是不是照抄 readOnly，不自己判）
      if (method === 'pinkie.fs.read') return {kind: 'text', content: 'text of ' + params.path, path: params.path, readOnly: String(params.path).startsWith('/'), size: 10, mtimeMs: 1};
      if (method === 'pinkie.fs.git') return git ? {repo: true, branch: 'main', changes: []} : {repo: false};
      if (method === 'pinkie.fs.stat') return {stats: (params.paths || []).map(p => ({path: p, exists: true, kind: 'file', size: 10, mtimeMs: 1}))};
      if (method === 'pinkie.fs.gitShow') return {content: 'old', exists: true};
      return {};
    }};
  }, [history, git, statusDelay]);
  await tab.addScriptTag({content: domWatch});
  await tab.addScriptTag({content: bench});
  await tab.addScriptTag({content: js});
  return tab;
}
const chips = (tab, id) => tab.locator(`#${id} .pk-mfile-chip`).evaluateAll(list => list.map(b => [b.querySelector('.pk-mfile-chip__text').textContent, b.dataset.action, b.title]));
const tabs = tab => tab.evaluate(() => window.__pinkieWorkbench.state.tabs.map(t => [t.path, t.kind === 'diff' ? 'diff' : 'file', Boolean(t.readOnly)]));
// B84：等标签加载完（不再是 pending / loading）再看它成了什么。以前直接等 kind === 'text'：标签落到 error（编辑器没加载出来）
// 和 runner 整体慢都只报一个裸的 5 s 超时，分不出来。超时时把各标签现状、Monaco 在不在、最后几次网关调用一起报出来。
// L84b：第一次开文本标签要冷加载 Monaco（ui/injections/laolao-vendor-monaco，约 15 MB，经 tab.route 一个个交出去），
// 标签在 Monaco 加载完之前一直是 loading。原来的 5 s 是从点击开始的墙钟：Windows runner 整体慢几倍时 Monaco 还在一个个
// 文件地来，标签就被判超时（#435 头 316bf335 的 windows-checks 首跑和重跑 job 140631900699 都红，整条 11.5 s；别的头上 Windows 同一条约 2 s 过）。真实条件是「标签落定，
// 或者页面卡住了」：期限还是 5 s，但从最后一次进展（页面来要文件 / 文件交出去）算起；一直没进展就照旧红，并带诊断。
// 总时长仍受这条测试自己的 60 s 上限。
const lastServed = new WeakMap();
async function settledTab(tab, path, quiet = 5000, progress = () => lastServed.get(tab) || 0) {
  const started = Date.now();
  const idle = () => Date.now() - Math.max(started, progress());
  for (;;) {
    try {
      await tab.waitForFunction(p => { const t = window.__pinkieWorkbench.state.tabs.find(x => x.path === p); return Boolean(t) && !['pending', 'loading'].includes(t.kind); }, path, {timeout: Math.max(1, quiet - idle())});
      break;
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
      if (idle() < quiet) continue;   // 这段时间里页面还在取文件：没卡住，接着等
      const seen = await tab.evaluate(() => ({tabs: window.__pinkieWorkbench.state.tabs.map(t => [t.path, t.kind, t.error || '']), monaco: Boolean(window.monaco), calls: window.calls.slice(-12)})).catch(e => ({evaluateFailed: String(e)}));
      const note = `\n  waiting for ${path} to load; nothing served for ${idle()} ms; workbench: ${JSON.stringify(seen)}`;
      // node:test 报告打的是 stack（抛出时就定型了），只改 message 诊断不会出现在 CI 日志里（B84 那段一直没显示过）
      error.message += note;
      if (typeof error.stack === 'string' && !error.stack.includes(note)) error.stack += note;
      throw error;
    }
  }
  return tab.evaluate(p => { const t = window.__pinkieWorkbench.state.tabs.find(x => x.path === p); return {kind: t.kind, error: t.error || ''}; }, path);
}

// ---------- settledTab 本身：假标签，不起浏览器 ----------
// 假页面：标签在 settleAt ms 落定；progressUntil 之前每 step ms 有一次进展。waitForFunction 照 Playwright 的样子超时抛 TimeoutError。
function fakeTab({settleAt, progressUntil, step = 50}) {
  const t0 = Date.now(), timeouts = [];
  let last = t0;
  const timer = setInterval(() => { if (Date.now() - t0 <= progressUntil) last = Date.now(); }, step);
  return {
    timeouts, stop: () => clearInterval(timer), progress: () => last,
    waitForFunction: (_fn, _arg, {timeout}) => new Promise((ok, no) => {
      timeouts.push(timeout);
      const left = settleAt - (Date.now() - t0);
      if (left <= timeout) setTimeout(ok, Math.max(0, left));
      // 先读一次 stack：Playwright 的错误抛到测试里时 stack 已经定型，之后改 message 不会再进 stack
      else setTimeout(() => { const e = Object.assign(new Error(`page.waitForFunction: Timeout ${timeout}ms exceeded.`), {name: 'TimeoutError'}); void e.stack; no(e); }, timeout);
    }),
    evaluate: async (_fn, arg) => arg === undefined ? {tabs: [['x', 'loading', '']], monaco: false, calls: []} : {kind: 'text', error: ''},
  };
}

test('settledTab: a load that keeps fetching settles even past the quiet window; no single wait is longer than it', async () => {
  const tab = fakeTab({settleAt: 700, progressUntil: 650});
  try {
    assert.deepEqual(await settledTab(tab, 'x', 200, tab.progress), {kind: 'text', error: ''});
    assert.ok(tab.timeouts.length > 1 && tab.timeouts.every(ms => ms <= 200), `each wait stays within the 200 ms window: ${tab.timeouts}`);
  } finally { tab.stop(); }
});

test('settledTab counterexample: once nothing is served the old deadline still holds, and the diagnosis reaches the report', async () => {
  const tab = fakeTab({settleAt: Infinity, progressUntil: 100});
  const begun = Date.now();
  try {
    const error = await settledTab(tab, 'x', 200, tab.progress).then(() => null, e => e);
    assert.equal(error?.name, 'TimeoutError', 'a stuck load is still red');
    assert.ok(Date.now() - begun < 1000, 'and red soon after progress stops, not at the test timeout');
    assert.match(util.inspect(error), /waiting for x to load; nothing served for \d+ ms; workbench: .*"loading"/, 'node:test prints the stack, so the note must be on it');
  } finally { tab.stop(); }
});

test('in Metre: one 文件 row per turn; 打开 opens a workbench tab with the backend readOnly, 改动 opens the diff', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'metre');
  try {
    await tab.locator('#g11 .pk-mfile-row').waitFor({timeout: 5000});
    assert.deepEqual(await chips(tab, 'g11'), [
      ['app.js', 'diff', '在工作台看改动：/proj/src/app.js'],
      ['hosts', 'open', '在工作台打开：/etc/hosts'],
      ['README.md', 'diff', '在工作台看改动：/proj/README.md'],
    ]);
    assert.equal(await tab.locator('#g13 .pk-mfile-row').count(), 0, 'a turn without file tools gets no row');
    const place = await tab.locator('#g11').evaluate(g => { const row = g.querySelector('.pk-mfile-row'); return [row.parentElement.className, row.previousElementSibling?.className, row.nextElementSibling?.className]; });
    assert.deepEqual(place, ['chat-group-messages', 'chat-bubble', 'chat-group-footer']);
    await tab.evaluate(() => window.Pinkie.metreFiles.paint());
    await tab.waitForTimeout(100);
    assert.equal(await tab.locator('#g11 .pk-mfile-row').count(), 1, 'repainting does not duplicate the row');
    // 打开：项目外 → 后端说只读 → 标签只读
    await tab.locator('#g11 .pk-mfile-chip[data-action="open"]').click();
    const hosts = await settledTab(tab, '/etc/hosts');
    assert.equal(hosts.kind, 'text', `the /etc/hosts tab ended as ${hosts.kind} ${hosts.error}`);
    assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.state.visible), true, 'the click brings the workbench out');
    // 改动：项目里的文件 → 相对路径 → 差异视图
    await tab.locator('#g11 .pk-mfile-chip[data-action="diff"]').last().click();
    await tab.waitForFunction(() => window.__pinkieWorkbench.state.tabs.some(t => t.kind === 'diff'), null, {timeout: 10_000});
    const list = await tabs(tab);
    assert.deepEqual(list.find(x => x[0] === '/etc/hosts'), ['/etc/hosts', 'file', true], 'outside the project the tab is read-only because the backend says so');
    assert.deepEqual(list.find(x => x[1] === 'diff'), ['diff:README.md', 'diff', false], 'the changed file opens as a diff, relative to the project root');
    assert.ok((await tab.evaluate(() => window.calls)).some(([m, p]) => m === 'pinkie.fs.gitShow' && p === 'README.md'));
    // 离开 Metre 整行拿掉
    await tab.evaluate(() => { document.documentElement.setAttribute('data-laolao-mode', 'chat'); window.dispatchEvent(new Event('laolao:modechange')); });
    await tab.waitForFunction(() => !document.querySelector('.pk-mfile-row'));
  } finally { await tab.close(); }
});

test('改动 clicked first, before git status has loaded, still opens the diff (pr-shots 45789320196 caught this)', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'metre');
  try {
    await tab.locator('#g11 .pk-mfile-chip[data-path="/proj/README.md"]').click({timeout: 5000});
    await tab.waitForFunction(() => window.__pinkieWorkbench.state.tabs.some(t => t.kind === 'diff'), null, {timeout: 10_000});
    assert.ok((await tab.evaluate(() => window.calls)).some(([m]) => m === 'pinkie.fs.git'), 'diff asks for git status itself when it is not known yet');
  } finally { await tab.close(); }
});

test('at 820 a chip clicked from the 对话 page brings the workbench back to 代码, so the opened tab is on screen (pr-shots 45793117245)', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  // B66：pinkie.fs.status 人为晚到 400 ms，用户在工作台还在等的时候就点了「对话」（CI 上 #409 run 45939911423 就是这个时序）。
  // 等 hosts 标签真的开出来（openChip 走完），用户选的「对话」不能被 show() 改回「代码」，否则对话页整页 visibility: hidden、签条点不着。
  const tab = await open(browser, 'metre', {width: 820, statusDelay: 400});
  try {
    await tab.locator('#g11 .pk-mfile-chip[data-path="/etc/hosts"]').click({timeout: 5000});
    await tab.waitForFunction(() => document.documentElement.dataset.pkWbNarrow === '1' && document.documentElement.dataset.pkWbView === 'code', null, {timeout: 10_000});
    await tab.getByRole('tab', {name: '对话', exact: true}).first().click({timeout: 5000});
    await tab.waitForFunction(() => document.documentElement.dataset.pkWbView === 'chat', null, {timeout: 3000});
    await tab.waitForFunction(() => window.__pinkieWorkbench.state.tabs.some(t => t.path === '/etc/hosts'), null, {timeout: 10_000});
    assert.equal(await tab.evaluate(() => document.documentElement.dataset.pkWbView), 'chat', 'the late status must not pull the user back from 对话');
    await tab.locator('#g11 .pk-mfile-chip[data-path="/proj/README.md"]').click({timeout: 5000});
    await tab.waitForFunction(() => window.__pinkieWorkbench.state.tabs.some(t => t.kind === 'diff'), null, {timeout: 10_000});
    assert.equal(await tab.evaluate(() => document.documentElement.dataset.pkWbView), 'code', 'the diff opens on the 代码 page, not behind the chat');
  } finally { await tab.close(); }
});

test('without git the 改动 chip opens the file; under 600px the workbench stays away and the row says why', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  let tab = await open(browser, 'metre', {git: false});
  try {
    await tab.locator('#g11 .pk-mfile-chip[data-action="diff"]').last().click({timeout: 5000});
    const readme = await settledTab(tab, 'README.md');
    assert.equal(readme.kind, 'text', `the README.md tab ended as ${readme.kind} ${readme.error}`);
    assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.state.tabs.some(t => t.kind === 'diff')), false);
  } finally { await tab.close(); }
  tab = await open(browser, 'metre', {width: 560});
  try {
    await tab.locator('#g11 .pk-mfile-chip').first().click({timeout: 5000});
    await tab.locator('#g11 .pk-mfile-row__note').waitFor({timeout: 5000});
    assert.match(await tab.locator('#g11 .pk-mfile-row__note').textContent(), /工作台现在打不开/);
    assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.state.visible), false, 'not forced out under 600px');
    assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.state.tabs.length), 0);
  } finally { await tab.close(); }
});

test('in other modes nothing changes (counterexample: same history, project mode, no row)', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'project');
  try {
    await tab.waitForTimeout(400);
    assert.equal(await tab.locator('.pk-mfile-row').count(), 0);
  } finally { await tab.close(); }
});

// ---------- R5 ②：回合中只读 + 回合结束重读 ----------
// 复发防护：Metre 这一轮的改文件工具一开始，工作台里这个文件不能打字、不能存、标签有锁、顶上说明；回合结束放开，并按磁盘重读（走工作台自己的 mtime 检查，
// 回合结束时马上查一次，不等 2.5 s 的轮询）。反例：同一轮里只读过的文件、别的会话在改的文件照常可打字；其他模式同样的事件不锁。
const gw = (tab, payload) => tab.evaluate(p => window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: 'agent', payload: p}})), payload);
const toolStart = (name, path, sessionKey = 'agent:metre:test') => ({sessionKey, runId: 'run1', stream: 'tool', data: {phase: 'start', name, toolCallId: name + path, args: {path}}});
const typeInto = async (tab, path) => {
  await tab.evaluate(p => window.__pinkieWorkbench.open(p, {pinned: true}), path);
  await tab.waitForFunction(p => window.__pinkieWorkbench.state.active === p && window.__pinkieWorkbench.state.tabs.find(t => t.path === p)?.kind === 'text', path, {timeout: 10_000});
  await tab.locator('.monaco-editor .view-lines').first().click();
  await tab.keyboard.press('End'); await tab.keyboard.type('Z');
  return tab.evaluate(p => window.__pinkieWorkbench.state.tabs.find(t => t.path === p).model.getValue(), path);
};
const lockOn = (tab, name) => tab.evaluate(n => [...document.querySelectorAll('.pk-wb-tab')].some(t => t.querySelector('.pk-wb-tab__label')?.textContent === n && t.querySelector('.pk-wb-tab__readonly')), name);

test('while Metre edits a file this turn the workbench tab is read-only with a note; other files stay editable; the turn ending unlocks and re-reads from disk', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'metre');
  try {
    assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.show()), true);
    await tab.evaluate(() => { const real = window.__laolaoSidebar.gwRequest; window.__laolaoSidebar.gwRequest = async (m, p = {}) => {
      if (m === 'pinkie.fs.read' && window.DISK && p.path === 'README.md') return {kind: 'text', content: window.DISK, path: p.path, readOnly: false, size: 10, mtimeMs: 2};
      if (m === 'pinkie.fs.stat' && window.DISK) return {stats: (p.paths || []).map(x => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: x === 'README.md' ? 2 : 1}))};
      return real(m, p);
    }; });
    await gw(tab, toolStart('edit', '/proj/README.md'));
    await gw(tab, toolStart('read', '/proj/src/app.js'));
    await gw(tab, toolStart('edit', '/proj/src/app.js', 'agent:metre:other'));
    assert.equal(await typeInto(tab, 'README.md'), 'text of README.md', 'the file Metre is editing takes no typing');
    assert.equal(await lockOn(tab, 'README.md'), true, 'its tab shows the lock');
    assert.match(await tab.locator('.pk-wb-notice__text').textContent(), /Metre 正在改这个文件，这一轮结束后可以编辑/);
    await tab.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
    await tab.waitForTimeout(200);
    assert.equal((await tab.evaluate(() => window.calls)).some(([m]) => m === 'pinkie.fs.write'), false, 'and cannot be saved');
    // 反例：读过的、别的会话在改的文件不锁
    assert.equal(await typeInto(tab, 'src/app.js'), 'text of src/app.jsZ', 'a file only read this turn (or edited in another session) stays editable');
    assert.equal(await lockOn(tab, 'app.js'), false);
    // 回合结束：放开 + 按磁盘重读（mtime 没变，自动同步不会读，只能是回合结束读的）
    await tab.evaluate(() => { window.DISK = 'changed by Metre'; });
    await gw(tab, {sessionKey: 'agent:metre:test', runId: 'run1', stream: 'lifecycle', data: {phase: 'end'}});
    await tab.waitForFunction(() => window.__pinkieWorkbench.state.tabs.find(t => t.path === 'README.md')?.model.getValue() === 'changed by Metre', null, {timeout: 5000});
    assert.equal(await lockOn(tab, 'README.md'), false, 'unlocked once the turn ends');
    assert.equal(await typeInto(tab, 'README.md'), 'changed by MetreZ', 'and editable again, on top of what Metre wrote');
    assert.equal(await tab.locator('.pk-wb-notice:not([hidden]) .pk-wb-notice__text').count(), 0, 'the note goes away');
  } finally { await tab.close(); }
});

test('the hold also lifts when the status bar says the run stopped or Metre is left; other modes never hold (counterexample)', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  let tab = await open(browser, 'metre');
  try {
    assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.show()), true);
    await gw(tab, toolStart('write', '/proj/README.md'));
    await tab.evaluate(() => window.__pinkieWorkbench.open('README.md', {pinned: true}));
    await tab.waitForFunction(() => document.querySelector('.pk-wb-tab__readonly'), null, {timeout: 10_000});
    await tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {key: 'agent:metre:test', kind: 'idle', live: {active: false}}})));
    await tab.waitForFunction(() => !document.querySelector('.pk-wb-tab__readonly'), null, {timeout: 5000});
    await gw(tab, toolStart('apply_patch', '/proj/README.md'));
    await tab.waitForFunction(() => document.querySelector('.pk-wb-tab__readonly'), null, {timeout: 5000});
    await tab.evaluate(() => { document.documentElement.setAttribute('data-laolao-mode', 'chat'); window.dispatchEvent(new Event('laolao:modechange')); });
    // 离开 Metre 时工作台可能已经收起，不一定重画标签；看的是锁本身拿掉了（回来时 activate 照 held 重画）
    await tab.waitForFunction(() => window.__pinkieWorkbench.held.size === 0, null, {timeout: 5000});
  } finally { await tab.close(); }
  tab = await open(browser, 'project');
  try {
    assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.show()), true);
    await gw(tab, toolStart('edit', '/proj/README.md', 'agent:project:test'));
    assert.equal(await typeInto(tab, 'README.md'), 'text of README.mdZ', 'outside Metre the same event locks nothing');
    assert.equal(await lockOn(tab, 'README.md'), false);
  } finally { await tab.close(); }
});
