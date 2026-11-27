import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// A5 并排答的假页面：假网关（5 个 pinkie.chat.sideBySide* + chat 事件），脚本按真实 head 顺序加载。
// tests/side-by-side-ui-e2e.test.mjs 和 tools/pr-shots/a5-side-by-side.mjs 共用，不起服务器、不连网关。
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ORIGIN = 'http://127.0.0.1:30117';
export const KEY = 'agent:main:test-a5';
export const UUID = '0f1e2d3c-4b5a-4968-8776-a5a5a5a5a5a5';
export const CSS = ['laolao-theme.css', 'laolao-message-actions.css', 'laolao-composer-tray.css', 'laolao-side-by-side.css'];
export const ORDER = ['laolao-message-actions.js', 'laolao-composer-tray.js', 'laolao-side-by-side.js'];
const FILES = new Set([...CSS, ...ORDER]);

// 在页面里运行：先于所有注入脚本装好假网关、假目录、假 domWatch 和原生发送。
function fakeBoot({mode, pair, key, uuid}) {
  const sideKey = side => `agent:main:internal-session-effects:pinkie-side-${uuid}-${side}`;
  const calls = [], toasts = [];
  const fake = {phase: 'none', models: [], entryId: null, sides: {left: 'running', right: 'running'}, errors: {}, usage: null,
    sendError: '', adopted: false, texts: {left: '', right: ''}, message: ''};
  localStorage.clear();
  if (pair) localStorage.setItem('pinkie.sideBySide.pair.' + (mode || 'default'), JSON.stringify(pair));
  window.__laolaoToast = text => toasts.push(String(text));
  window.Pinkie = {domWatch: {
    poll(fn, ms) { return setInterval(fn, ms); },
    createObserver(cb) { return {watch(node, options) { new MutationObserver(cb).observe(node, {...options, subtree: true}); }}; },
  }};
  const history = () => [
    {id: 'u1', role: 'user', content: '讲讲光合作用', timestamp: 1, __openclaw: {id: 'E-u1'}},
    {id: 'a1', role: 'assistant', content: fake.adopted ? '右边的完整回答' : '旧回复：光合作用把光变成糖。', timestamp: 2,
      __openclaw: {id: fake.adopted ? 'E-a3' : 'E-a1'}},
  ];
  const pane = document.getElementById('pane');
  pane.active = true;
  pane.state = {sessionKey: key, chatMessages: history(), chatMessage: '', chatAttachments: []};
  pane.handleChatDraftChange = value => { pane.state.chatMessage = value; };
  pane.requestUpdate = () => {};
  const send = pane.querySelector('.chat-send-btn'), textarea = pane.querySelector('textarea'), split = pane.querySelector('.chat-open-split-view');
  send.addEventListener('click', () => calls.push({method: 'native-send', params: {text: textarea.value}}));
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) calls.push({method: 'native-send', params: {text: textarea.value}});
  });
  split.addEventListener('click', () => {
    calls.push({method: 'native-split', params: {}});
    split.setAttribute('aria-pressed', String(split.getAttribute('aria-pressed') !== 'true'));
  });
  window.__laolaoModelPickerCatalog = {
    load: async () => [{provider: 'p', id: 'a', name: '模型甲'}, {provider: 'p', id: 'b', name: '模型乙'}, {provider: 'p', id: 'c', name: '模型丙'}],
    present: models => models,
  };
  const view = () => ({
    ok: true, active: fake.phase !== 'lost', phase: fake.phase, id: 'cmp-1', entryId: fake.entryId, models: fake.models,
    sides: Object.fromEntries(['left', 'right'].map((side, index) => [side,
      {key: sideKey(side), model: fake.models[index], status: fake.sides[side], ...(fake.errors[side] ? {error: fake.errors[side]} : {})}])),
    ...(fake.usage ? {usage: fake.usage} : {}), ...(fake.phase === 'lost' ? {message: fake.message} : {}),
  });
  window.__laolaoSidebar = {gwRequest: async (method, params = {}) => {
    calls.push({method, params: JSON.parse(JSON.stringify(params))});
    switch (method) {
      case 'pinkie.chat.sideBySide.status':
        return fake.phase === 'none' ? {ok: true, active: false, phase: 'none'} : view();
      case 'pinkie.chat.sideBySide':
        if (fake.sendError) return {ok: false, error: fake.sendError};
        Object.assign(fake, {phase: 'running', models: params.models, entryId: params.entryId || null,
          sides: {left: 'running', right: 'running'}, errors: {}, usage: null});
        return view();
      case 'pinkie.chat.sideBySide.adopt':
        fake.phase = 'none'; fake.adopted = true;
        return {ok: true, leaf: 'E-a3', model: fake.models[params.side === 'left' ? 0 : 1], modelSaved: true};
      case 'pinkie.chat.sideBySide.abort':
        for (const side of params.side ? [params.side] : ['left', 'right']) if (fake.sides[side] === 'running') fake.sides[side] = 'aborted';
        if (!Object.values(fake.sides).includes('running')) fake.phase = 'choosing';
        return {ok: true};
      case 'pinkie.chat.sideBySide.discard':
        fake.phase = 'none';
        return {ok: true};
      case 'sessions.list':
        return {sessions: [{key, model: 'a', modelProvider: 'p'}]};
      case 'chat.history': {
        const side = ['left', 'right'].find(name => params.sessionKey === sideKey(name));
        if (side) return {messages: [{role: 'user', content: 'q'}, {role: 'assistant', content: fake.texts[side]}]};
        return {messages: history()};
      }
      case 'pinkie.chat.variants':
        return {ok: true, items: fake.adopted ? [{entryId: 'E-u1', total: 3, index: 3, siblings: ['E-u1x', 'E-u1y', 'E-u1']}] : []};
      case 'pinkie.feedback.get':
        return {ok: true, ratings: {}};
      case 'pinkie.model.failure':
        return {};
      default:
        return {ok: true};
    }
  }};
  const stream = (side, text, state = 'delta') => {
    if (state !== 'delta') fake.texts[side] = text;
    window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: 'chat',
      payload: {state, runId: 'run-' + side, sessionKey: sideKey(side), message: {role: 'assistant', content: [{type: 'text', text}]}}}}));
  };
  window.__test = {calls, toasts, fake, stream};
}

function pageHtml({mode, night, pair, scripts}) {
  const config = JSON.stringify({mode, pair, key: KEY, uuid: UUID}).replace(/</g, '\\u003c');
  return `<!doctype html><html${mode ? ` data-laolao-mode="${mode}"` : ''}${night ? ' data-pinkie-night' : ''}><head><meta charset="utf-8">
${CSS.map(name => `<link rel="stylesheet" href="/${name}">`).join('\n')}
<style>body{margin:24px;font-family:sans-serif}openclaw-chat-pane{display:block}</style></head><body>
<openclaw-chat-pane id="pane">
  <div class="chat-thread-inner">
    <div class="chat-group user"><div class="chat-bubble" data-message-id="msg:u1"><div class="chat-text">讲讲光合作用</div></div></div>
    <div class="chat-group assistant" id="answer"><div class="chat-bubble" data-message-id="msg:a1"><div class="chat-text">旧回复：光合作用把光变成糖。</div></div><div class="chat-group-footer"></div></div>
    <div id="tail"></div>
  </div>
  <div class="agent-chat__input">
    <div class="agent-chat__composer-combobox"><textarea aria-label="输入"></textarea></div>
    <div class="agent-chat__composer-actions"><button type="button" class="chat-open-split-view" aria-pressed="false" aria-label="拆分视图">拆分</button><button type="button" class="chat-send-btn" aria-label="发送">发送</button></div>
  </div>
</openclaw-chat-pane>
<button type="button" data-chat-model-option="p/a" aria-selected="true" hidden>模型甲</button>
<script>(${fakeBoot.toString()})(${config});</script>
${scripts.map(name => `<script src="/${name}"></script>`).join('\n')}
</body></html>`;
}

function source(name, mutate) {
  let body = fs.readFileSync(path.join(repo, 'ui/injections', name), 'utf8');
  for (const [from, to] of mutate[name] || []) {
    assert.ok(body.includes(from), `反例要改的那一句还在 ${name} 里：${from}`);
    body = body.split(from).join(to);
  }
  return body;
}

export async function openFixturePage(browser, {mode = '', night = false, pair = ['p/a', 'p/b'], width = 1440, height = 900, mutate = {}, scripts = ORDER} = {}) {
  const context = await browser.newContext({viewport: {width, height}});
  const page = await context.newPage();
  await page.route(ORIGIN + '/**', route => {
    const url = new URL(route.request().url());
    const name = url.pathname.slice(1);
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html; charset=utf-8', body: pageHtml({mode, night, pair, scripts})});
    if (FILES.has(name)) {
      return route.fulfill({contentType: name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', body: source(name, mutate)});
    }
    return route.fulfill({status: 404, body: ''});
  });
  await page.goto(`${ORIGIN}/?session=${encodeURIComponent(KEY)}`);
  return {page, context, close: () => context.close()};
}

export const until = (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: 10_000});

export async function startFromComposer(page) {
  await page.evaluate(() => window.Pinkie.sideBySide.start({text: '讲讲光合作用', models: ['p/a', 'p/b']}));
  await page.locator('.pinkie-sbs[data-phase="running"]').waitFor();
}

export async function finishBoth(page) {
  await page.evaluate(() => {
    const {fake, stream} = window.__test;
    fake.sides = {left: 'final', right: 'final'}; fake.phase = 'choosing';
    fake.usage = {sides: {left: {inputTokens: 1200, outputTokens: 340, totalTokens: 1540}, right: {inputTokens: 1200, outputTokens: 860, totalTokens: 2060}},
      total: {inputTokens: 2400, outputTokens: 1200, totalTokens: 3600}};
    stream('left', '左边的完整回答', 'final');
    stream('right', '右边的完整回答', 'final');
  });
  await page.locator('.pinkie-sbs[data-phase="choosing"]').waitFor();
  await until(page, () => document.querySelector('.pinkie-sbs__text[data-side="right"]')?.textContent === '右边的完整回答');
}
