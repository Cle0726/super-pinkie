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
