import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

// A5 并排答的真页面测试：假网关（5 个 pinkie.chat.sideBySide* + chat 事件），脚本按真实 head 顺序加载。
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const ORIGIN = 'http://127.0.0.1:30117';
const KEY = 'agent:main:test-a5';
const UUID = '0f1e2d3c-4b5a-4968-8776-a5a5a5a5a5a5';
const CSS = ['laolao-theme.css', 'laolao-message-actions.css', 'laolao-composer-tray.css', 'laolao-side-by-side.css'];
const ORDER = ['laolao-message-actions.js', 'laolao-composer-tray.js', 'laolao-side-by-side.js'];
const FILES = new Set([...CSS, ...ORDER]);
const WAIT = '先在上面的两栏里选一边，或者都不要，再发下一句';
const BUSY = '这轮跑完再改';
const SKINS = {
  pinkie: {mode: '', hint: '下一句用两个模型同时答', adopt: '用这一边继续', discard: '都不要，回到刚才'},
  metre: {mode: 'metre', hint: '下一拍两个模型对着写', adopt: '留下这一边', discard: '都不留，回到刚才'},
};
const MUTATE = {
  intercept: {'laolao-side-by-side.js': [
    ["window.addEventListener('click', intercept, true);", ''],
    ["window.addEventListener('keydown', intercept, true);", ''],
  ]},
  busy: {'laolao-message-actions.js': [[' || Boolean(window.Pinkie?.sideBySide?.active?.(key))', '']]},
  signature: {'laolao-message-actions.js': [[", Boolean(window.Pinkie?.sideBySide)].join('|')", "].join('|')"]]},
};

let browser;
before(async () => {
  browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
}, {timeout: 120_000});
after(async () => { await browser?.close(); });

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

function pageHtml({mode, pair, scripts}) {
  const config = JSON.stringify({mode, pair, key: KEY, uuid: UUID}).replace(/</g, '\\u003c');
  return `<!doctype html><html${mode ? ` data-laolao-mode="${mode}"` : ''}><head><meta charset="utf-8">
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

async function openPage({mode = '', pair = ['p/a', 'p/b'], width = 1440, mutate = {}, scripts = ORDER} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  const page = await context.newPage();
  await page.route(ORIGIN + '/**', route => {
    const url = new URL(route.request().url());
    const name = url.pathname.slice(1);
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html; charset=utf-8', body: pageHtml({mode, pair, scripts})});
    if (FILES.has(name)) {
      return route.fulfill({contentType: name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', body: source(name, mutate)});
    }
    return route.fulfill({status: 404, body: ''});
  });
  await page.goto(`${ORIGIN}/?session=${encodeURIComponent(KEY)}`);
  return {page, close: () => context.close()};
}

const callsOf = (page, method) => page.evaluate(name => window.__test.calls.filter(call => call.method === name).map(call => call.params), method);
const toastsOf = page => page.evaluate(() => [...window.__test.toasts]);
const until = (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: 10_000});

async function startFromComposer(page) {
  await page.evaluate(() => window.Pinkie.sideBySide.start({text: '讲讲光合作用', models: ['p/a', 'p/b']}));
  await page.locator('.pinkie-sbs[data-phase="running"]').waitFor();
}
async function sendWhileComparing(page) {
  const native = (await callsOf(page, 'native-send')).length, waits = (await toastsOf(page)).filter(text => text === WAIT).length;
  await page.locator('textarea').fill('再问一句');
  await page.locator('.chat-send-btn').click();
  await page.locator('textarea').press('Enter');
  const result = {
    native: (await callsOf(page, 'native-send')).length - native,
    toasts: (await toastsOf(page)).filter(text => text === WAIT).length - waits,
    label: await page.locator('.chat-send-btn').getAttribute('aria-label'),
  };
  await page.locator('textarea').fill('');
  return result;
}
async function finishBoth(page) {
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
const colBoxes = page => Promise.all(['left', 'right'].map(side => page.locator(`.pinkie-sbs__col[data-side="${side}"]`).boundingBox()));

for (const [skinName, skin] of Object.entries(SKINS)) {
  test(`输入框开关：两栏各自流式，比较中不可发，选边后出上一版/下一版（${skinName}，${engine}）`, {timeout: 90_000}, async () => {
    const {page, close} = await openPage({mode: skin.mode});
    try {
      await page.locator('.pinkie-sbs-toggle').waitFor({state: 'attached'});
      await page.locator('.pinkie-tray-btn').click();
      const trayRow = page.locator('.pinkie-tray__row[data-key="sidebyside"]');
      assert.equal(await trayRow.locator('.pinkie-tray__hint').textContent(), skin.hint);
      await trayRow.locator('.pinkie-tray__item').click();
      await until(page, () => document.querySelector('.pinkie-sbs-toggle')?.getAttribute('aria-pressed') === 'true');
      await until(page, () => document.querySelector('.pinkie-tray__row[data-key="sidebyside"] .pinkie-tray__item')?.getAttribute('aria-checked') === 'true');
      const rows = await page.evaluate(() => window.__pinkieComposerTray.rows(document.querySelector('.agent-chat__input')));
      assert.deepEqual(rows.find(row => row.key === 'sidebyside'), {key: 'sidebyside', kind: 'switch', on: true});
      assert.deepEqual(rows.find(row => row.key === 'split'), {key: 'split', kind: 'switch', on: false});
      await page.keyboard.press('Escape');

      await until(page, () => document.querySelector('select[aria-label="右边的模型"]')?.value === 'p/b');
      assert.equal(await page.locator('select[aria-label="左边的模型"]').inputValue(), 'p/a', '左边是这个会话现在的模型');
      assert.equal(await page.locator('.chat-send-btn').getAttribute('aria-label'), '并排发送');
      await page.locator('textarea').fill('讲讲光合作用');
      await page.locator('.chat-send-btn').click();
      await page.locator('.pinkie-sbs[data-phase="running"]').waitFor();
      assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide'), [{key: KEY, models: ['p/a', 'p/b'], text: '讲讲光合作用'}]);
      assert.equal((await callsOf(page, 'native-send')).length, 0, '开关打开时这一发不走普通发送');
      assert.equal(await page.locator('textarea').inputValue(), '');
      await until(page, () => document.querySelector('.pinkie-sbs-toggle')?.getAttribute('aria-pressed') === 'false');
      assert.deepEqual(await page.locator('.pinkie-sbs__model').allTextContents(), ['模型甲', '模型乙']);
      assert.equal(await page.locator('.pinkie-sbs__ask').textContent(), '讲讲光合作用');
      assert.equal(await page.locator('.pinkie-sbs').evaluate(node => node.classList.contains('pinkie-sbs--metre')), skin.mode === 'metre');
      assert.equal(await page.locator('#tail + .pinkie-sbs').count(), 1, '输入框发起的挂在最后');

      await page.evaluate(() => window.__test.stream('left', '左边先写了一半'));
      await until(page, () => document.querySelector('.pinkie-sbs__text[data-side="left"]')?.textContent === '左边先写了一半');
      assert.equal(await page.locator('.pinkie-sbs__text[data-side="right"]').textContent(), '', '右边没来事件就不跟着变');
      await page.evaluate(() => window.__test.stream('right', '右边也开始了'));
      await until(page, () => document.querySelector('.pinkie-sbs__text[data-side="right"]')?.textContent === '右边也开始了');
      assert.equal(await page.locator('.pinkie-sbs__text[data-side="left"]').textContent(), '左边先写了一半');
      assert.equal(await page.locator('.pinkie-sbs__stop').count(), 2, '每一栏可以单停');
      assert.equal(await page.locator('.pinkie-sbs__stop-all').count(), 1, '也可以两边都停');

      assert.deepEqual(await sendWhileComparing(page), {native: 0, toasts: 2, label: WAIT}, '比较中点发送和回车都不发');
      assert.equal(await page.locator('html').getAttribute('data-pinkie-sbs'), 'comparing');
      await until(page, () => document.querySelector('#answer button[aria-label="重新回答"]')?.disabled === true);
      for (const label of ['重新回答', '换个模型重新回答', '并排再答']) {
        const node = page.locator(`#answer .pinkie-msg-row--assistant button[aria-label="${label}"]`);
        assert.equal(await node.isDisabled(), true, label);
        assert.equal(await node.getAttribute('title'), BUSY, label);
      }

      await page.locator('.pinkie-tray-btn').click();
      await page.locator('.pinkie-tray__row[data-key="split"] .pinkie-tray__item').click();
      assert.equal((await callsOf(page, 'native-split')).length, 1, '比较中拆分视图照常能开');
      assert.equal(await page.locator('.chat-open-split-view').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.pinkie-sbs').count(), 1);

      await finishBoth(page);
      assert.deepEqual(await page.locator('.pinkie-sbs__state').allTextContents(), ['答完了', '答完了']);
      assert.equal(await page.locator('.pinkie-sbs__text[data-side="left"]').textContent(), '左边的完整回答');
      assert.deepEqual(await page.locator('.pinkie-sbs__usage').allTextContents(), ['输入 1,200 · 输出 340 令牌', '输入 1,200 · 输出 860 令牌']);
      assert.equal(await page.locator('.pinkie-sbs__total').textContent(), '这一题两边一共 3,600 令牌（输入 2,400 · 输出 1,200）');
      assert.deepEqual(await page.locator('.pinkie-sbs__adopt').allTextContents(), [skin.adopt, skin.adopt]);
      assert.equal(await page.locator('.pinkie-sbs__adopt:disabled').count(), 0, 'final 后两边都能选');
      assert.equal(await page.locator('.pinkie-sbs__discard').textContent(), skin.discard);
      assert.equal(await page.locator('.pinkie-sbs__stop, .pinkie-sbs__stop-all').count(), 0);
      assert.equal((await callsOf(page, 'pinkie.chat.sideBySide.adopt')).length, 0, '不自动选');

      let [left, right] = await colBoxes(page);
      assert.ok(Math.abs(left.y - right.y) < 1 && right.x >= left.x + left.width - 1, '1440 宽两栏并排');
      await page.setViewportSize({width: 820, height: 900});
      await until(page, () => {
        const [a, b] = document.querySelectorAll('.pinkie-sbs__col');
        return b.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 1;
      });
      [left, right] = await colBoxes(page);
      assert.ok(right.y >= left.y + left.height - 1 && Math.abs(left.x - right.x) < 1, '820 宽上下叠');
      await page.setViewportSize({width: 1440, height: 900});

      await page.locator('.pinkie-sbs__col[data-side="right"] .pinkie-sbs__adopt').click();
      await page.locator('.pinkie-sbs').waitFor({state: 'detached'});
      assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide.adopt'), [{key: KEY, side: 'right'}]);
      await until(page, () => document.querySelector('.pinkie-msg-variants__count')?.textContent === '3 / 3');
      assert.ok((await callsOf(page, 'chat.history')).some(params => params.sessionKey === KEY && params.limit === 200), '选完重读父会话历史');
      assert.equal(await page.locator('button[aria-label="上一版"]').isDisabled(), false);
      assert.equal(await page.locator('button[aria-label="下一版"]').isDisabled(), true);
      await until(page, () => document.querySelector('#answer button[aria-label="重新回答"]')?.disabled === false);
      assert.equal(await page.locator('.chat-send-btn').getAttribute('aria-label'), '发送');
      assert.equal(await page.locator('html').getAttribute('data-pinkie-sbs'), null);
      const mode = skin.mode || 'default';
      assert.equal(await page.evaluate(name => localStorage.getItem('pinkie.sideBySide.pair.' + name), mode), JSON.stringify(['p/a', 'p/b']));
    } finally { await close(); }
  });
}

test(`动作条「并排再答」：挂在那道题的回复下面，旧回复还在，都不要走 discard（${engine}）`, {timeout: 60_000}, async () => {
  const {page, close} = await openPage({mode: 'metre'});
  try {
    await page.locator('#answer .pinkie-msg-btn--sbs').click();
    await page.locator('.pinkie-sbs[data-phase="running"]').waitFor();
    assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide'), [{key: KEY, models: ['p/a', 'p/b'], entryId: 'E-u1'}]);
    assert.equal(await page.locator('#answer + .pinkie-sbs + #tail').count(), 1, '面板紧跟在那道题的回复后面');
    assert.equal(await page.locator('#answer .chat-text').textContent(), '旧回复：光合作用把光变成糖。', '再答时旧回复还在');
    assert.equal(await page.locator('.pinkie-sbs__ask').count(), 0, '再答发起的不加题');
    await page.locator('.pinkie-sbs__discard').click();
    await page.locator('.pinkie-sbs').waitFor({state: 'detached'});
    assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide.discard'), [{key: KEY}]);
    assert.equal(await page.locator('#answer .chat-text').textContent(), '旧回复：光合作用把光变成糖。');
  } finally { await close(); }
});

test(`动作条「并排再答」没记住另一个模型时先让人挑（${engine}）`, {timeout: 60_000}, async () => {
  const {page, close} = await openPage({pair: null});
  try {
    await page.locator('#answer .pinkie-msg-btn--sbs').click();
    await page.locator('.pinkie-sbs[data-phase="pick"]').waitFor();
    assert.equal(await page.locator('.pinkie-sbs__lead').textContent(), '选两个模型，对这一题各答一份');
    assert.equal((await callsOf(page, 'pinkie.chat.sideBySide')).length, 0);
    await until(page, () => document.querySelector('.pinkie-sbs select[aria-label="左边的模型"]')?.value === 'p/a');
    assert.equal(await page.locator('.pinkie-sbs__go').isDisabled(), true);
    await page.locator('.pinkie-sbs select[aria-label="右边的模型"]').selectOption('p/a');
    assert.equal(await page.locator('.pinkie-sbs__go').isDisabled(), true, '两边同一个模型不能开始');
    await page.locator('.pinkie-sbs select[aria-label="右边的模型"]').selectOption('p/c');
    await page.locator('.pinkie-sbs__go').click();
    await page.locator('.pinkie-sbs[data-phase="running"]').waitFor();
    assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide'), [{key: KEY, models: ['p/a', 'p/c'], entryId: 'E-u1'}]);
    assert.equal(await page.locator('#answer + .pinkie-sbs').count(), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('pinkie.sideBySide.pair.default')), JSON.stringify(['p/a', 'p/c']));
  } finally { await close(); }
});

test(`网关报错原样显示；单停、失败栏写「未完成」和原因；lost 可以收起（${engine}）`, {timeout: 60_000}, async () => {
  const {page, close} = await openPage();
  try {
    await page.locator('.pinkie-sbs-toggle').waitFor({state: 'attached'});
    await page.evaluate(() => { window.__test.fake.sendError = '这一版还不能限制工具，并排答暂不可用'; });
    await page.evaluate(() => window.Pinkie.sideBySide.start({text: '问一句', models: ['p/a', 'p/b']}));
    assert.ok((await toastsOf(page)).includes('这一版还不能限制工具，并排答暂不可用'));
    await until(page, () => !document.querySelector('.pinkie-sbs'));
    assert.equal(await page.evaluate(key => window.Pinkie.sideBySide.active(key), KEY), false);

    await page.evaluate(() => { window.__test.fake.sendError = ''; });
    await startFromComposer(page);
    await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__stop').click();
    await until(page, () => document.querySelector('.pinkie-sbs__col[data-side="left"]')?.dataset.status === 'aborted');
    assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide.abort'), [{key: KEY, side: 'left'}]);
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__state').textContent(), '未完成');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__why').textContent(), '这一边停下了，没答完');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="right"] .pinkie-sbs__stop').count(), 1, '另一边还在答');

    await page.evaluate(async key => {
      Object.assign(window.__test.fake, {phase: 'choosing', sides: {left: 'error', right: 'final'}, errors: {left: '上游 500：模型那边出错了'}});
      await window.Pinkie.sideBySide.refresh(key);
    }, KEY);
    await until(page, () => document.querySelector('.pinkie-sbs__col[data-side="left"]')?.dataset.status === 'error');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__state').textContent(), '未完成');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__why').textContent(), '这一边没答完：上游 500：模型那边出错了');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__adopt').isDisabled(), true);
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="right"] .pinkie-sbs__adopt').isDisabled(), false);

    await page.evaluate(async key => {
      Object.assign(window.__test.fake, {phase: 'lost', message: '这次比较没保住，可以重新发起'});
      await window.Pinkie.sideBySide.refresh(key);
    }, KEY);
    await page.locator('.pinkie-sbs[data-phase="lost"]').waitFor();
    assert.equal(await page.locator('.pinkie-sbs__lost').textContent(), '这次比较没保住，可以重新发起');
    await page.locator('.pinkie-sbs[data-phase="lost"] button').click();
    await until(page, () => !document.querySelector('.pinkie-sbs'));
  } finally { await close(); }
});

test(`并排答脚本晚于动作条生效时，「并排再答」也会补上（${engine}）`, {timeout: 60_000}, async () => {
  const {page, close} = await openPage({scripts: ORDER.filter(name => name !== 'laolao-side-by-side.js')});
  try {
    await page.locator('#answer .pinkie-msg-row--assistant').waitFor();
    assert.equal(await page.locator('.pinkie-msg-btn--sbs').count(), 0);
    await page.addScriptTag({url: '/laolao-side-by-side.js'});
    await page.locator('#answer .pinkie-msg-btn--sbs').waitFor({timeout: 5000});
  } finally { await close(); }
});

test(`反例：去掉发送拦截、比较中的 busy、签名里的并排答，上面对应的检查会变红（${engine}）`, {timeout: 90_000}, async () => {
  {
    const {page, close} = await openPage({mutate: MUTATE.intercept});
    try {
      await startFromComposer(page);
      const result = await sendWhileComparing(page);
      assert.ok(result.native > 0 && result.toasts === 0, '没有拦截时比较中的发送会漏到普通发送');
    } finally { await close(); }
  }
  {
    const {page, close} = await openPage({mutate: MUTATE.busy});
    try {
      await page.locator('#answer button[aria-label="重新回答"]').waitFor();
      await startFromComposer(page);
      await page.waitForTimeout(800);
      assert.equal(await page.locator('#answer button[aria-label="重新回答"]').isDisabled(), false, '没有 busy 判断时比较中动作条还能点');
    } finally { await close(); }
  }
  {
    const {page, close} = await openPage({mutate: MUTATE.signature, scripts: ORDER.filter(name => name !== 'laolao-side-by-side.js')});
    try {
      await page.locator('#answer .pinkie-msg-row--assistant').waitFor();
      await page.addScriptTag({url: '/laolao-side-by-side.js'});
      await page.waitForTimeout(4000);
      assert.equal(await page.locator('.pinkie-msg-btn--sbs').count(), 0, '签名不看并排答时晚到的脚本补不上按钮');
    } finally { await close(); }
  }
});
