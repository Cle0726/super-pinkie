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
  assert.match(head, /<link rel="stylesheet" href="\/laolao-metre-engine\.css\?v=[\w.]+">/);
  assert.match(head, /<script defer src="\/laolao-metre-engine\.js\?v=[\w.]+"><\/script>/);
  const stageImport = /import\('\.\/(laolao-cle-space\.js\?v=\d+)'\)/.exec(read('laolao-cle-stage.js'))?.[1];
  assert.ok(stageImport, 'cle-stage imports the particle signature dynamically');
  assert.ok(js.includes(`const CLE_SPACE = '/${stageImport}';`), 'same URL, so one module and one WebGL context');
  assert.match(js, /new cle\.Space\(glyph, \{palette: 'cle', count: 1100, size: \.17, fitW: 10\.2, fitH: 5\.4, interactive: false\}\)/);
});

test('nothing on screen names or links the other projects (user 11-22: no T3 Code marks)', () => {
  for (const [name, text] of [['js', js], ['css', css]]) {
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
        {id: 'r', kind: 'reply', status: 'completed', text: 'Done: `a.css` <script>alert(1)</script>\n\n- one\n- two'},
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
    assert.deepEqual(names, ['Metre', 'Codex', 'Claude Code', 'Antigravity', 'Cursor', 'OpenCode', 'Grok Build', 'Kiro', 'Pi', 'fx', 'Muse Code']);
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
