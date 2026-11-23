import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const file = name => fileURLToPath(new URL('../ui/injections/' + name, import.meta.url));
const read = name => fs.readFileSync(file(name), 'utf8');
const js = read('laolao-metre-engine.js');
const css = read('laolao-metre-engine.css');

test('the engine stage is loaded by the head fragment and reuses the very same C.le. three.js module', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<link rel="stylesheet" href="\/laolao-metre-engine\.css\?v=@hash">/);
  assert.match(head, /<script defer src="\/laolao-metre-engine\.js\?v=@hash"><\/script>/);
  const stageImport = /import\((window\.__pinkieAsset \? window\.__pinkieAsset\('\.\/laolao-cle-space\.js'\) : '\.\/laolao-cle-space\.js')\)/.exec(read('laolao-cle-stage.js'))?.[1];
  assert.ok(stageImport, 'cle-stage imports the particle signature dynamically');
  assert.ok(js.includes(`const CLE_SPACE = () => (${stageImport});`), 'same URL, so one module and one WebGL context');
  assert.match(js, /new cle\.Space\(glyph, \{palette: 'cle', count: 1100, size: \.17, fitW: 10\.2, fitH: 5\.4, interactive: false\}\)/);
});

test('nothing on screen names or links the other projects (user 11-22: no T3 Code marks)', () => {
  // 唯一的例外：关于页的第三方许可声明（MIT 要保留版权和许可声明），夹在 NOTICES-BEGIN / NOTICES-END 之间，只有一段。
  assert.equal(js.split('// NOTICES-BEGIN').length, 2, 'exactly one notices block');
  const outside = js.replace(/\/\/ NOTICES-BEGIN[\s\S]*?\/\/ NOTICES-END/, '');
  for (const [name, text] of [['js', outside], ['css', css]]) {
    const visible = text.split('\n').filter(line => !/^\s*(?:\/\/|\/?\*)/.test(line)).join('\n');
    assert.doesNotMatch(visible, /T3|t3\.codes|OpenMaus|Maus/i, name);
  }
});

test('the stage only acts on Metre sessions and folds finished thinking by the 「思考了」 rule', () => {
  assert.match(js, /isMetre\(\) && sessionKey\(\) && external\(\)/);
  assert.match(js, /\^agent:metre:/);
  assert.match(js, /思考了/);
  assert.match(js, /Math\.min\(3600, 1800 \+/, 'hold 1.8–3.6 s after the burst before folding');
  assert.match(css, /pk-eng-think--live \.pk-eng-think__text \{ max-height: 68px;/);
});

function scene() {
  return {
    sessionKey: 'agent:metre:a',
    pref: {engine: 'claudeAgent', model: 'claude-opus-5-5', level: 'auto', threadId: 't1'},
    summary: {thread: {id: 't1', engine: 'claudeAgent', engineName: 'Claude Code', model: 'claude-opus-5-5', level: 'auto'},
      status: 'waiting', activeRunId: 'r1', runStartedAt: new Date(Date.now() - 20000).toISOString(), runCompletedAt: null,
      pending: [{requestId: 'q1', kind: 'approval'}], changes: [{file: 'a.css', additions: 2, deletions: 1, edits: 1}], turnCount: 1,
      items: [
        {id: 'u', kind: 'you', status: 'completed', text: 'fix <b>it</b>'},
        {id: 'r', kind: 'reply', status: 'completed', text: 'Done: `a.css` <script>alert(1)</script> [hello.md](file:///F:/x/hello.md)\n\n- one\n- two'},
        {id: 'c', kind: 'command', status: 'completed', command: 'npm test', output: 'ok', exitCode: 0},
        {id: 'a', kind: 'approval', status: 'pending', requestId: 'q1', requestKind: 'command', prompt: 'rm -rf build', open: true, options: []},
      ]},
  };
}

test('in a browser: chip in the composer, stage rows, escaped text, and the approve button sends the decision', {timeout: 40_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body>
      <div class="chat-main" style="position:relative;width:900px;height:700px"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Aa');
    await tab.evaluate(view => {
      window.calls = [];
      window.__laolaoToast = () => {};
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        window.calls.push([method, params]);
        if (method === 'pinkie.engines.session') return view;
        if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, levels: [], engines: []};
        if (method === 'pinkie.engines.respond') return {...view.summary, status: 'running', pending: [], items: view.summary.items.map(i => i.id === 'a' ? {...i, open: false} : i)};
        return {};
      }};
    }, scene());
    await tab.addScriptTag({content: js});
    await tab.locator('.pk-eng-stage .pk-eng-row--approval').waitFor({timeout: 10_000});
    assert.equal(await tab.locator('.agent-chat__composer-controls > .pk-eng-chip').textContent(), 'Claude Code');
    assert.equal(await tab.evaluate(() => document.documentElement.getAttribute('data-pk-engine')), 'on');
    assert.equal(await tab.locator('.pk-eng-row--you').textContent(), 'fix <b>it</b>', 'user text is shown as text');
    assert.equal(await tab.locator('.pk-eng-reply script').count(), 0, 'no markup from the engine runs');
    assert.equal(await tab.locator('.pk-eng-reply li').count(), 2);
    assert.equal(await tab.locator('.pk-eng-reply code').first().textContent(), 'a.css');
    assert.equal(await tab.locator('.pk-eng-reply a[href^="file:"]').count(), 0, 'local file links show as a name, not a dead link');
    assert.equal(await tab.locator('.pk-eng-reply code').nth(1).textContent(), 'hello.md');
    assert.match(await tab.locator('.pk-eng-live .cle-status b').textContent(), /等你确认/);
    await tab.getByRole('button', {name: '批准', exact: true}).click();
    await tab.waitForFunction(() => window.calls.some(([m]) => m === 'pinkie.engines.respond'));
    const respond = await tab.evaluate(() => window.calls.find(([m]) => m === 'pinkie.engines.respond')[1]);
    assert.deepEqual(respond, {threadId: 't1', requestId: 'q1', decision: 'accept'});
    await tab.locator('.pk-eng-card--closed').waitFor();
  } finally { await browser.close(); }
});

// 3.7：对方支持的十家都在菜单里；没设置好的点进去一步步打开、安装、登录。
test('in a browser: all ten engines are in the menu, and the ones not set up open their own setup steps', {timeout: 60_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body>
      <div class="chat-main" style="position:relative;width:900px;height:700px"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Ab');
    await tab.evaluate(() => {
      const guide = (install, login, extra = {}) => ({install, login, loginHint: '', link: 'https://example.com/docs', note: '', managedInstall: false, managedSignin: false, ...extra});
      const row = (id, name, state, text, extra = {}) => ({id, name, state, text, enabled: state !== 'off', installed: !['off', 'missing'].includes(state), signedIn: state === 'ready',
        quota: {state: 'unknown'}, models: state === 'ready' ? [{slug: 'm1', name: 'Model One', isDefault: true}] : [], setup: {canInstall: false, canAuthenticate: false}, guide: guide('', ''), ...extra});
      let cursorOn = false;
      const engines = () => [
        row('claudeAgent', 'Claude Code', 'signin', '还没登录，或者登录过期了', {guide: guide('npm install -g @anthropic-ai/claude-code', 'claude auth login')}),
        row('codex', 'Codex', 'ready', ''),
        row('antigravity', 'Antigravity', 'signin', '还没登录，或者登录过期了', {setup: {canInstall: false, canAuthenticate: true}, guide: guide('', '', {managedInstall: true, managedSignin: true})}),
        row('cursor', 'Cursor', cursorOn ? 'missing' : 'off', cursorOn ? '这台电脑上还没装' : '还没打开', {guide: guide("irm 'https://cursor.com/install?win32=true' | iex", 'agent login', {managedSignin: true, note: '要付费的 Cursor 套餐'})}),
        row('opencode', 'OpenCode', 'off', '还没打开'), row('grok', 'Grok Build', 'off', '还没打开'),
        row('kiro', 'Kiro', 'missing', '这台电脑上还没装', {guide: guide("irm 'https://cli.kiro.dev/install.ps1' | iex", 'kiro-cli login')}),
        row('pi', 'Pi', 'off', '还没打开'), row('fx', 'fx', 'off', '还没打开'), row('muse', 'Muse Code', 'off', '还没打开'),
      ];
      window.calls = [];
      window.toasts = [];
      window.__laolaoToast = text => window.toasts.push(text);
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        window.calls.push([method, params]);
        if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}};
        if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels: [], engines: engines()};
        if (method === 'pinkie.engines.turnOn') { cursorOn = true; return {enabled: true, running: true, source: 'live', levels: [], engines: engines()}; }
        if (method === 'pinkie.engines.install') return {engine: params.engine, how: 'terminal', command: 'x', opened: params.open === true};
        if (method === 'pinkie.engines.signin') return {engine: params.engine, how: 'managed', auth: {phase: 'waiting', flowId: 'f1', url: '', step: {type: 'browser', id: 'i1', url: 'https://accounts.example/x', consent: true, paste: true}, message: '', methods: []}};
        if (method === 'pinkie.engines.setup') return {engine: params.engine, install: null, auth: {phase: 'waiting', flowId: 'f1', url: '', step: {type: 'browser', id: 'i1', url: 'https://accounts.example/x', consent: true, paste: true}, message: '', methods: []}};
        return {};
      }};
    });
    await tab.addScriptTag({content: js});
    const chipButton = tab.locator('.agent-chat__composer-controls > .pk-eng-chip');
    await chipButton.waitFor({timeout: 10_000});
    await chipButton.click();
    await tab.locator('.pk-eng-menu__group').first().waitFor();
    const names = await tab.locator('.pk-eng-menu__item .pk-eng-menu__name').allTextContents();
    assert.deepEqual(names, ['Metre', 'Codex', 'Claude Code', 'Antigravity', 'Cursor', 'OpenCode', 'Grok Build', 'Kiro', 'Pi', 'fx', 'Muse Code', '＋ 更多引擎']);
    assert.deepEqual(await tab.locator('.pk-eng-menu__group').allTextContents(), ['能用', '还要设置一下']);

    // Cursor 还没打开 → 打开 → 变成「没装」，给官方安装命令；不点不跑。
    await tab.locator('.pk-eng-menu__item', {hasText: 'Cursor'}).click();
    await tab.getByRole('button', {name: '打开 Cursor'}).click();
    await tab.locator('.pk-eng-cmd code', {hasText: 'cursor.com/install'}).waitFor();
    assert.deepEqual(await tab.evaluate(() => window.calls.find(([m]) => m === 'pinkie.engines.turnOn')[1]), {engine: 'cursor', on: true});
    assert.equal(await tab.evaluate(() => window.calls.some(([m]) => m === 'pinkie.engines.install')), false);
    assert.match(await tab.locator('.pk-eng-setup__note').textContent(), /付费/);
    await tab.getByRole('button', {name: '在终端里装'}).click();
    await tab.waitForFunction(() => window.calls.some(([m]) => m === 'pinkie.engines.install'));
    assert.deepEqual(await tab.evaluate(() => window.calls.find(([m]) => m === 'pinkie.engines.install')[1]), {engine: 'cursor', open: true});

    // Antigravity 托管登录：同意 + 打开登录页 + 回贴代码，都在 Metre 自己的卡片里。
    await tab.getByRole('button', {name: '‹ 换引擎'}).click();
    await tab.locator('.pk-eng-menu__item', {hasText: 'Antigravity'}).click();
    await tab.getByRole('button', {name: '登录', exact: true}).click();
    await tab.getByRole('button', {name: '打开登录页'}).waitFor();
    await tab.locator('.pk-eng-input').fill('4/code');
    await tab.getByRole('button', {name: '确定'}).click();
    await tab.waitForFunction(() => window.calls.some(([m, p]) => m === 'pinkie.engines.setup' && p.action === 'paste'));
    assert.deepEqual(await tab.evaluate(() => window.calls.find(([m, p]) => m === 'pinkie.engines.setup' && p.action === 'paste')[1]), {engine: 'antigravity', action: 'paste', code: '4/code'});
    assert.equal(/T3/i.test(await tab.locator('.pk-eng-menu').innerText()), false);
  } finally { await browser.close(); }
});

// 多账号（用户 11-23）：一个账号一行；「再加一个账号」→ 起名字 → 选哪家 → 直接进这个新账号的登录。
test('in a browser: one row per account, and adding an account goes straight to its sign-in', {timeout: 60_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body>
      <div class="chat-main" style="position:relative;width:900px;height:700px"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Ac');
    await tab.evaluate(() => {
      const guide = {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: true, managedSignin: true};
      const row = (id, name, state, extra = {}) => ({id, driver: id.replace(/-\d+$/, ''), name, state, text: state === 'ready' ? '' : '还没登录', account: /-\d+$/.test(id), multi: true,
        enabled: true, installed: true, signedIn: state === 'ready', plan: 'Google account', quota: {state: 'unknown'}, models: [{slug: 'g', name: 'G', isDefault: true}],
        setup: {canInstall: false, canAuthenticate: true}, guide, ...extra});
      let engines = [row('antigravity', 'Antigravity', 'ready'), row('antigravity-2', 'Antigravity · 工作号', 'ready')];
      window.calls = [];
      window.__laolaoToast = () => {};
      const catalog = () => ({enabled: true, running: true, source: 'live', levels: [], engines, accountEngines: [{id: 'claudeAgent', name: 'Claude Code'}, {id: 'codex', name: 'Codex'}, {id: 'antigravity', name: 'Antigravity'}, {id: 'cursor', name: 'Cursor'}]});
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        window.calls.push([method, params]);
        if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}};
        if (method === 'pinkie.engines.catalog') return catalog();
        if (method === 'pinkie.engines.account' && params.action === 'add') {
          engines = [...engines, row('antigravity-3', 'Antigravity · ' + params.name.trim(), 'signin')];
          return {engine: 'antigravity-3', ...catalog()};
        }
        if (method === 'pinkie.engines.account' && params.action === 'remove') { engines = engines.filter(r => r.id !== params.engine); return catalog(); }
        return {};
      }};
    });
    await tab.addScriptTag({content: js});
    const chipButton = tab.locator('.agent-chat__composer-controls > .pk-eng-chip');
    await chipButton.waitFor({timeout: 10_000});
    await chipButton.click();
    await tab.locator('.pk-eng-menu__group').first().waitFor();
    const names = await tab.locator('.pk-eng-menu__item .pk-eng-menu__name').allTextContents();
    assert.deepEqual(names.slice(0, 3), ['Metre', 'Antigravity', 'Antigravity · 工作号'], 'each account is its own row');
    await tab.getByText('＋ 再加一个账号').click();
    await tab.locator('.pk-eng-menu .pk-eng-input').fill(' 第三个号 ');
    await tab.getByRole('button', {name: 'Antigravity', exact: true}).click();
    await tab.getByRole('button', {name: '登录', exact: true}).waitFor();
    assert.deepEqual(await tab.evaluate(() => window.calls.find(([m]) => m === 'pinkie.engines.account')[1]), {action: 'add', driver: 'antigravity', name: ' 第三个号 '});
    assert.match(await tab.locator('.pk-eng-menu__sub').textContent(), /Antigravity · 第三个号/);
    // 删掉：点两下才删，删完回到引擎列表。
    await tab.getByRole('button', {name: '删掉这个账号'}).click();
    assert.equal(await tab.evaluate(() => window.calls.some(([m, p]) => m === 'pinkie.engines.account' && p.action === 'remove')), false, 'the first click only arms it');
    await tab.getByRole('button', {name: '再点一次确认删掉'}).click();
    await tab.waitForFunction(() => window.calls.some(([m, p]) => m === 'pinkie.engines.account' && p.action === 'remove'));
    await tab.locator('.pk-eng-menu__group').first().waitFor();
    assert.equal(await tab.locator('.pk-eng-menu__item', {hasText: '第三个号'}).count(), 0);
  } finally { await browser.close(); }
});

// 侧栏：用外部引擎的会话标上引擎名（账号名），Metre 派给引擎的活标「引擎 · 模型」，在跑的有一道强调色。
// 不碰侧栏的节点（laolao-session-list.js 每次整片重建），只按 data-session-key 写样式表。
test('in a browser: sidebar rows of engine sessions carry the engine name, jobs carry engine · model', {timeout: 40_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    const row = key => `<div class="sidebar-recent-session session-row-host" data-session-key='${key}'><a class="sidebar-recent-session__link"><span>t</span></a><span class="session-row-aside"></span></div>`;
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body><aside class="sidebar"><div id="laolao-session-manager">
      ${row('agent:metre:top')}${row('agent:metre:pinkie-child:job')}${row('agent:metre:odd"key]x')}${row('agent:metre:plain')}</div></aside></body></html>`;
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Aplain');
    await tab.evaluate(() => {
      window.__laolaoSidebar = {gwRequest: async method => {
        if (method === 'pinkie.engines.sessions') return {sessions: {
          'agent:metre:top': {engine: 'claudeAgent-2', name: 'Claude Code · Metre', model: 'claude-haiku-5-5', modelName: 'Claude Haiku 5.5', task: false},
          'agent:metre:pinkie-child:job': {engine: 'claudeAgent-2', name: 'Claude Code · Metre', model: 'claude-haiku-5-5', modelName: 'Claude Haiku 5.5', task: true, status: 'running'},
          'agent:metre:odd"key]x': {engine: 'antigravity', name: 'Anti"gravity', task: false},
        }};
        if (method === 'pinkie.engines.session') return {pref: {engine: 'metre'}};
        return {};
      }};
    });
    await tab.addScriptTag({content: js});
    await tab.locator('style#pk-eng-side').waitFor({state: 'attached', timeout: 10_000});
    const before = key => tab.evaluate(k => {
      const link = [...document.querySelectorAll('.session-row-host')].find(n => n.dataset.sessionKey === k).querySelector('.sidebar-recent-session__link');
      const style = getComputedStyle(link, '::after');
      return {content: style.content, shadow: style.boxShadow};
    }, key);
    assert.equal((await before('agent:metre:top')).content, '"Claude Code · Metre"');
    const job = await before('agent:metre:pinkie-child:job');
    assert.equal(job.content, '"Claude Code · Haiku 5.5"');
    assert.match(job.shadow, /inset/);
    assert.equal((await before('agent:metre:odd"key]x')).content, '"Anti\\"gravity"', 'keys and names are escaped, not injected');
    assert.equal((await before('agent:metre:plain')).content, 'none');
  } finally { await browser.close(); }
});

// 乐手（E5）：菜单里一组「乐手」，点了用它那一套；「把现在这一套记成乐手」起个名字（可挂角色卡）存下来。
test('in a browser: players are one click away, and the current choice can be saved as a player', {timeout: 60_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body>
      <div class="chat-main" style="position:relative;width:900px;height:700px"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Ap');
    await tab.evaluate(() => {
      const row = (id, name, models) => ({id, driver: id.replace(/-\d+$/, ''), name, state: 'ready', text: '', enabled: true, installed: true, signedIn: true,
        quota: {state: 'ok'}, models, setup: {}, guide: {}});
      const engines = [row('antigravity', 'Antigravity', [{slug: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', isDefault: true}]),
        row('claudeAgent-2', 'Claude Code · Metre', [{slug: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', isDefault: true}])];
      let players = [{id: 'player-1', name: '审稿', engine: 'claudeAgent-2', model: 'claude-haiku-5-5', level: 'auto', role: 'reviewer'}];
      let pref = {engine: 'antigravity', model: 'gemini-3.8-flash', level: 'full-access'};
      window.calls = [];
      window.__laolaoToast = () => {};
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        window.calls.push([method, params]);
        if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref, summary: null, error: '', service: {running: true}};
        if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels: [], engines};
        if (method === 'pinkie.engines.choose') { pref = {...pref, ...params}; return {sessionKey: params.sessionKey, pref, summary: null}; }
        if (method === 'pinkie.engines.players') {
          if (params.action === 'save') { const saved = {id: 'player-2', ...params.player}; players = [...players, saved]; return {players, roles: [{id: 'reviewer', name: '审稿人'}], saved}; }
          return {players, roles: [{id: 'reviewer', name: '审稿人'}]};
        }
        return {};
      }};
    });
    await tab.addScriptTag({content: js});
    // The session already uses an engine, so the stage has taken over the composer: its own engine chip opens the menu.
    const chip = name => tab.locator('.pk-eng-stage .pk-eng-chip', {hasText: name});
    await chip('Antigravity').waitFor({timeout: 10_000});
    await chip('Antigravity').click();
    const player = tab.locator('.pk-eng-menu__item--player');
    await player.first().waitFor();
    assert.match(await player.first().textContent(), /审稿Claude Code · Metre · Claude Haiku 5\.5 · 自己判断 · 带角色卡/);
    await player.first().click();
    await tab.waitForFunction(() => window.calls.some(([m]) => m === 'pinkie.engines.choose'));
    const chosen = await tab.evaluate(() => window.calls.find(([m]) => m === 'pinkie.engines.choose')[1]);
    assert.deepEqual({engine: chosen.engine, model: chosen.model, level: chosen.level}, {engine: 'claudeAgent-2', model: 'claude-haiku-5-5', level: 'auto'});
    await chip('Claude Code · Metre').click();
    await tab.getByText('＋ 把现在这一套记成乐手').click();
    await tab.locator('.pk-eng-menu input.pk-eng-input').fill('小提琴手');
    await tab.locator('.pk-eng-menu select.pk-eng-input').selectOption('reviewer');
    await tab.getByRole('button', {name: '存下来'}).click();
    await tab.waitForFunction(() => window.calls.some(([m, p]) => m === 'pinkie.engines.players' && p.action === 'save'));
    const save = await tab.evaluate(() => window.calls.find(([m, p]) => m === 'pinkie.engines.players' && p.action === 'save')[1]);
    assert.deepEqual(save.player, {name: '小提琴手', engine: 'claudeAgent-2', model: 'claude-haiku-5-5', level: 'auto', role: 'reviewer'});
    await tab.locator('.pk-eng-menu__item--player', {hasText: '小提琴手'}).waitFor();
  } finally { await browser.close(); }
});

// PLAN 3.6：设置「连接」里也有一处外部引擎总开关；设置页只留空位，开关写在引擎台的文件里（健康门禁不让设置页变长）。
test('the settings page leaves a slot for the engines switch and the engine file fills it', () => {
  const settings = read('laolao-settings-user.js');
  assert.match(settings, /element\("div", "pinkie-user-settings__engines", connectionCard\); enginesHost\.pinkieKit = \{row, setPressed\}; window\.dispatchEvent\(new CustomEvent\("pinkie:settings-engines"/);
  assert.match(js, /window\.addEventListener\('pinkie:settings-engines', event => mountSettings\(event\.detail\?\.host\)\)/);
  assert.match(js, /document\.querySelectorAll\('\.pinkie-user-settings__engines'\)\.forEach\(mountSettings\)/);
});

test('in a browser: the settings switch turns the engines on, and turning them off takes two clicks', {timeout: 40_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><html data-laolao-mode="chat"><body><section id="card"></section></body></html>'}));
    await tab.goto('http://127.0.0.1:30117/settings');
    await tab.evaluate(() => {
      let enabled = false;
      window.calls = [];
      window.toasts = [];
      window.__laolaoToast = text => window.toasts.push(text);
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        window.calls.push([method, params]);
        if (method === 'pinkie.engines.status') return {running: enabled, enabled};
        if (method === 'pinkie.engines.enable') { enabled = params.on === true; return {running: enabled, enabled}; }
        if (method === 'pinkie.engines.catalog') return {enabled, running: enabled, levels: [], engines: []};
        return {};
      }};
      // 设置页先建好（引擎台的文件后加载）：空位已经在了。
      const row = (parent, title, hint) => {
        const item = document.createElement('div'); item.className = 'pinkie-user-settings__row';
        item.innerHTML = `<div class="copy"><span class="title"></span><span class="hint"></span></div>`;
        item.querySelector('.title').textContent = title; item.querySelector('.hint').textContent = hint;
        const control = document.createElement('div'); item.append(control); parent.append(item);
        return {item, control};
      };
      const setPressed = (node, pressed) => node.setAttribute('aria-pressed', String(Boolean(pressed)));
      const host = document.createElement('div'); host.className = 'pinkie-user-settings__engines'; host.pinkieKit = {row, setPressed};
      document.getElementById('card').append(host);
    });
    await tab.addScriptTag({content: js});
    const onButton = tab.getByRole('button', {name: '打开外部引擎', exact: true});
    const offButton = tab.getByRole('button', {name: '关掉外部引擎', exact: true});
    await tab.waitForFunction(() => document.querySelector('[aria-label="关掉外部引擎"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await tab.locator('.pinkie-user-settings__engines .title').textContent(), '外部引擎');
    assert.match(await tab.locator('.pinkie-user-settings__engines .hint').textContent(), /170MB/);
    assert.equal(await tab.evaluate(() => window.calls.some(([m]) => m === 'pinkie.engines.enable')), false, 'just showing the switch turns nothing on');

    await onButton.click();
    await tab.waitForFunction(() => document.querySelector('[aria-label="打开外部引擎"]')?.getAttribute('aria-pressed') === 'true');
    assert.deepEqual(await tab.evaluate(() => window.calls.find(([m]) => m === 'pinkie.engines.enable')[1]), {on: true});
    assert.match(await tab.locator('.pk-eng-settings-note').textContent(), /已经打开/);

    await offButton.click();
    assert.equal(await offButton.textContent(), '再点一次关掉');
    assert.match(await tab.locator('.pk-eng-settings-note').textContent(), /正在跑的外部引擎对话和派出去的活也会停/);
    assert.equal(await tab.evaluate(() => window.calls.filter(([m, p]) => m === 'pinkie.engines.enable' && p.on === false).length), 0, 'one click does not turn it off');
    await offButton.click();
    await tab.waitForFunction(() => document.querySelector('[aria-label="关掉外部引擎"]')?.getAttribute('aria-pressed') === 'true');
    assert.deepEqual(await tab.evaluate(() => window.calls.filter(([m]) => m === 'pinkie.engines.enable').map(([, p]) => p)), [{on: true}, {on: false}]);
    assert.ok((await tab.evaluate(() => window.toasts)).includes('外部引擎已经关掉'));
  } finally { await browser.close(); }
});

// 更多引擎（E6）：搜公开的 ACP 注册表，点「加上」才下载，加好直接进它的登录；删掉点两下，叫「删掉这个引擎」，没有改名字。
test('in a browser: more engines searches the registry, adding one goes straight to its sign-in', {timeout: 60_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body>
      <div class="chat-main" style="position:relative;width:900px;height:700px"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Ad');
    await tab.evaluate(() => {
      const guide = {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: false, managedSignin: true};
      let engines = [{id: 'codex', driver: 'codex', name: 'Codex', state: 'ready', text: '', enabled: true, installed: true, signedIn: true, quota: {state: 'unknown'}, models: [{slug: 'm', name: 'M'}], setup: {}, guide}];
      const agents = [{id: 'qwen-code', name: 'Qwen Code', description: 'coding <b>assistant</b>', license: 'Apache-2.0', link: 'https://github.com/QwenLM/qwen-code', how: '用 npm 装', dist: 'npx', added: false},
        {id: 'kilo', name: 'Kilo', description: 'open source', license: 'MIT', link: '', how: '下载运行包', dist: 'binary', added: true}];
      window.calls = [];
      window.__laolaoToast = () => {};
      const catalog = () => ({enabled: true, running: true, source: 'live', levels: [], engines, accountEngines: []});
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        window.calls.push([method, params]);
        if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}};
        if (method === 'pinkie.engines.catalog') return catalog();
        if (method === 'pinkie.engines.players') return {players: []};
        if (method === 'pinkie.engines.registry' && params.action === 'search') return {query: params.query, agents: agents.filter(a => a.name.toLowerCase().includes(params.query.trim().toLowerCase()))};
        if (method === 'pinkie.engines.registry' && params.action === 'add') {
          engines = [...engines, {id: 'acpRegistry_qwen_code', driver: 'acpRegistry', name: 'Qwen Code', registry: true, account: true, state: 'signin', text: '还没登录',
            enabled: true, installed: true, signedIn: false, quota: {state: 'unknown'}, models: [], setup: {canAuthenticate: false}, guide}];
          return {engine: 'acpRegistry_qwen_code', ...catalog()};
        }
        if (method === 'pinkie.engines.account' && params.action === 'remove') { engines = engines.filter(r => r.id !== params.engine); return catalog(); }
        return {};
      }};
    });
    await tab.addScriptTag({content: js});
    const chipButton = tab.locator('.agent-chat__composer-controls > .pk-eng-chip');
    await chipButton.waitFor({timeout: 10_000});
    await chipButton.click();
    await tab.getByText('＋ 更多引擎').click();
    await tab.locator('.pk-eng-more__row').nth(1).waitFor();
    assert.deepEqual(await tab.locator('.pk-eng-more__row .pk-eng-menu__name').allTextContents(), ['Qwen Code', 'Kilo']);
    assert.equal(await tab.locator('.pk-eng-more__row b').count(), 0, 'descriptions are text, not markup');
    assert.match(await tab.locator('.pk-eng-more__row').first().innerText(), /许可证 Apache-2\.0 · 用 npm 装/);
    assert.equal(await tab.locator('.pk-eng-more__row').first().locator('a').getAttribute('href'), 'https://github.com/QwenLM/qwen-code');
    assert.equal(await tab.getByRole('button', {name: '已加'}).isDisabled(), true, 'one already added cannot be added twice');
    await tab.locator('.pk-eng-menu .pk-eng-input').fill('kil');
    await tab.waitForFunction(() => document.querySelectorAll('.pk-eng-more__row').length === 1);
    assert.deepEqual(await tab.evaluate(() => window.calls.filter(([m]) => m === 'pinkie.engines.registry').at(-1)[1]), {action: 'search', query: 'kil'});
    await tab.locator('.pk-eng-menu .pk-eng-input').fill('');
    await tab.waitForFunction(() => document.querySelectorAll('.pk-eng-more__row').length === 2);
    assert.equal(await tab.evaluate(() => window.calls.some(([m, p]) => m === 'pinkie.engines.registry' && p.action === 'add')), false, 'nothing is downloaded before a click');
    await tab.getByRole('button', {name: '加上'}).click();
    await tab.getByRole('button', {name: '登录', exact: true}).waitFor();
    assert.deepEqual(await tab.evaluate(() => window.calls.find(([m, p]) => m === 'pinkie.engines.registry' && p.action === 'add')[1]), {action: 'add', agentId: 'qwen-code'});
    assert.match(await tab.locator('.pk-eng-menu__sub').textContent(), /Qwen Code/);
    assert.equal(await tab.getByRole('button', {name: '改名字'}).count(), 0);
    assert.equal(/T3/i.test(await tab.locator('.pk-eng-menu').innerText()), false);
    await tab.getByRole('button', {name: '删掉这个引擎'}).click();
    await tab.getByRole('button', {name: '再点一次确认删掉'}).click();
    await tab.waitForFunction(() => window.calls.some(([m, p]) => m === 'pinkie.engines.account' && p.action === 'remove' && p.engine === 'acpRegistry_qwen_code'));
  } finally { await browser.close(); }
});

// PLAN 3.5「每个会话独立工作树」：还没开对话时引擎台底下有「新工作树」，按下以后第一句话带 worktree；对话开了就不再出现。
test('in a browser: a new conversation can start in its own worktree, and the choice is only offered before it starts', {timeout: 40_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>${css}</style></head><body>
      <div class="chat-main" style="position:relative;width:900px;height:700px"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Aw');
    await tab.evaluate(() => {
      window.calls = [];
      window.__laolaoToast = () => {};
      let pref = {engine: 'claudeAgent', model: 'claude-haiku-5-5', level: 'full-access', threadId: ''};
      const view = () => ({sessionKey: 'agent:metre:w', pref, summary: pref.threadId ? {thread: {id: 't9', engine: 'claudeAgent', engineName: 'Claude Code'}, status: 'running', items: [], pending: [], changes: [], turnCount: 0} : null, error: '', service: {running: true}});
      window.__laolaoSidebar = {gwRequest: async (method, params) => {
        window.calls.push([method, params]);
        if (method === 'pinkie.engines.session') return view();
        if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, levels: [], engines: []};
        if (method === 'pinkie.engines.say') { pref = {...pref, threadId: 't9'}; return view(); }
        return {};
      }};
    });
    await tab.addScriptTag({content: js});
    const tree = tab.getByRole('button', {name: '新工作树'});
    await tree.waitFor({timeout: 10_000});
    assert.equal(await tree.getAttribute('aria-pressed'), 'false', 'off unless the user asks');
    await tree.click();
    assert.equal(await tab.getByRole('button', {name: '新工作树'}).getAttribute('aria-pressed'), 'true');
    await tab.locator('.pk-eng-stage textarea').fill('新建 notes.md');
    await tab.locator('.pk-eng-send').click();
    await tab.waitForFunction(() => window.calls.some(([m]) => m === 'pinkie.engines.say'));
    assert.deepEqual(await tab.evaluate(() => window.calls.find(([m]) => m === 'pinkie.engines.say')[1]), {sessionKey: 'agent:metre:w', text: '新建 notes.md', mode: 'queue', worktree: true});
    await tab.waitForFunction(() => !document.querySelector('.pk-eng-chip--tree'));
    assert.equal(await tab.getByRole('button', {name: '新工作树'}).count(), 0, 'once the conversation exists its folder is settled');
  } finally { await browser.close(); }
});

// 关于页「第三方许可」（用户 11-23 定）：设置页「关于与更新」最后一行留空位，引擎文件填上；点「查看」弹出全文。
test('the about card leaves the last slot for the third-party notices, and the notices keep the MIT text word for word', () => {
  const settings = read('laolao-settings-user.js');
  assert.match(settings, /makeStatus\(aboutCard, "usage"\); const noticesHost = element\("div", "pinkie-user-settings__notices", aboutCard\); noticesHost\.pinkieKit = \{row, button\}; window\.dispatchEvent\(new CustomEvent\("pinkie:settings-notices"/);
  assert.ok(settings.indexOf('pinkie-user-settings__notices') > settings.indexOf('state.usageGrid ='), 'after the usage numbers, so it is the last row');
  const block = /\/\/ NOTICES-BEGIN[\s\S]*?\/\/ NOTICES-END/.exec(js)[0];
  for (const line of ['MIT License', 'Copyright (c) 2026 T3 Tools Inc.', 'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.', 'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE', 'https://github.com/pingdotgg/t3code', 'Apache-2.0']) assert.ok(block.includes(line), line);
  assert.match(read('laolao-head.fragment.html'), /laolao-settings-user\.js\?v=@hash/, 'the version comes from the file hash, so a changed file gets a new one');
});

test('in a browser: 第三方许可 shows a 查看 button that opens the full notices and closes again', {timeout: 40_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage();
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html data-laolao-mode="chat"><head><style>${css}</style></head><body><section id="card"></section></body></html>`}));
    await tab.goto('http://127.0.0.1:30117/settings');
    await tab.evaluate(() => {
      window.calls = [];
      window.__laolaoSidebar = {gwRequest: async method => { window.calls.push(method); return {}; }};
      const row = (parent, title, hint) => {
        const item = document.createElement('div'); item.className = 'pinkie-user-settings__row';
        item.innerHTML = '<div class="copy"><span class="title"></span><span class="hint"></span></div>';
        item.querySelector('.title').textContent = title; item.querySelector('.hint').textContent = hint;
        const control = document.createElement('div'); item.append(control); parent.append(item);
        return {item, control};
      };
      const button = (label, className, parent, onClick) => { const b = document.createElement('button'); b.className = className; b.type = 'button'; b.textContent = label; parent.append(b); b.addEventListener('click', onClick); return b; };
      window.slot = () => { const host = document.createElement('div'); host.className = 'pinkie-user-settings__notices'; host.pinkieKit = {row, button}; document.getElementById('card').append(host); return host; };
      window.slot(); // 设置页比引擎文件先建好
    });
    await tab.addScriptTag({content: js});
    await tab.locator('.pinkie-user-settings__notices .title').waitFor({timeout: 10_000});
    assert.equal(await tab.locator('.pinkie-user-settings__notices .title').textContent(), '第三方许可');
    // 引擎文件先加载、设置页后建好：靠事件接上。
    await tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:settings-notices', {detail: {host: window.slot()}})));
    assert.equal(await tab.locator('.pinkie-user-settings__notices .title').count(), 2);
    await tab.getByRole('button', {name: '查看'}).first().click();
    const dialog = tab.getByRole('dialog', {name: '第三方许可'});
    await dialog.waitFor();
    const text = await dialog.locator('.pk-notices__text').textContent();
    assert.match(text, /Copyright \(c\) 2026 T3 Tools Inc\./);
    assert.match(text, /OpenMausBot/);
    assert.match(text, /^引擎服务/);
    await dialog.getByRole('button', {name: '关闭'}).click();
    await tab.waitForFunction(() => !document.querySelector('.pk-notices'));
    assert.deepEqual(await tab.evaluate(() => window.calls), [], 'reading the notices needs no gateway');
  } finally { await browser.close(); }
});
