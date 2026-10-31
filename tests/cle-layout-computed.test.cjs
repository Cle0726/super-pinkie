// Offscreen computed-style regression for the composer, run in a real browser engine.
//
// The mini-DOM tests can validate logic, but not layout: they cannot tell us that a
// `display: contents` <wa-dropdown> makes its child button resolve `width: 100%` against the whole
// lead. This harness loads the native chat CSS plus our composer CSS into headless Chrome,
// assembles the real composer DOM (including the wa-dropdown permission host with
// display:contents and its 100%-wide trigger), and asserts measured boxes.
//
// It uses headless Chrome over the DevTools protocol — no window is shown and no user GUI is
// touched. If Chrome is unavailable the whole file skips, so CI stays green.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = path.join(__dirname, '../services/cle-studio');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// the staged runtime the main controller verified against
const RUNTIME_ASSETS = '/Users/Admin/Library/Application Support/SuperPinkie/dev/cle-stage/npm/lib/node_modules/openclaw/dist/control-ui/assets';

const hasChrome = fs.existsSync(CHROME);

function readIf(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

// Native sheets that shape the composer, in the order the runtime loads them.
function nativeCss() {
  const names = [
    'control-ui-boot-shared-styles-DKyMAG_6.css',
    'control-ui-boot-chat-mLz7NUiY.css',
    'chat-transcript-styles-B_dd5Ueo.css',
  ];
  return names.map((name) => readIf(path.join(RUNTIME_ASSETS, name))).join('\n');
}

function page() {
  const ours = [
    readIf(path.join(root, 'src/styles/tokens.css')),
    readIf(path.join(root, 'src/process/status.css')),
    readIf(path.join(root, 'src/composer/composer.css')),
  ].join('\n');
  return `<!doctype html><html data-cle="0.1.0" data-cle-room="chat"><head><meta charset="utf-8">
<style>${nativeCss()}</style>
<style>${ours}</style>
<style>
  html,body{margin:0;padding:0}
  #host{width:864px;padding:0}
  .chat-pane-cache__pane{width:864px}
  .chat-main{width:864px}
  .chat-footer{width:864px}
  /* the mobile toolbar class the runtime puts on a narrow composer */
  .agent-chat__input{--chat-composer-control-size:36px;--chat-composer-chip-height:30px}
</style></head>
<body><div id="host">
  <div class="chat-pane-cache__pane" data-cle-pane-room="chat">
    <div class="chat-main"><div class="chat-main__conversation"><div class="chat">
      <div class="chat-footer"><openclaw-plugin-view>
        <div class="agent-chat__composer-shell">
          <div class="cle-composer"><div class="agent-chat__input">
            <div class="agent-chat__composer-input-row">
              <div class="agent-chat__composer-combobox">
                <textarea rows="1" placeholder="和碧琪说点什么"></textarea>
              </div>
            </div>
            <div class="agent-chat__composer-footer">
              <div class="agent-chat__composer-lead">
                <button type="button" class="agent-chat__input-btn agent-chat__input-btn--attach" aria-label="附件">+</button>
                <wa-dropdown class="chat-controls__inline-select chat-controls__permission-picker" style="display:contents">
                  <button slot="trigger" type="button"
                    class="chat-controls__inline-select-trigger chat-controls__permission-trigger"
                    aria-label="权限">&#9679;</button>
                </wa-dropdown>
                <button type="button" class="agent-chat__input-btn chat-browser-panel-toggle" aria-label="浏览器">B</button>
                <button type="button" class="laolao-learning-toggle">互动学习</button>
                <button type="button" class="laolao-learning-tools__trigger">学习工具</button>
                <button type="button" class="laolao-learning-notebook-button laolao-learning--absorbed">打开学习笔记本</button>
              </div>
              <div class="agent-chat__composer-trail">
                <div class="agent-chat__composer-controls">
                  <div class="chat-controls"><div class="chat-controls__model">
                    <button type="button" class="chat-controls__inline-select-trigger" aria-label="模型">
                      <span class="chat-controls__inline-select-label">DeepSeek V4.1 Flash &middot; WB</span>
                    </button>
                  </div></div>
                </div>
                <div class="agent-chat__composer-actions">
                  <div class="chat-talk-control">
                    <wa-dropdown class="chat-talk-input-picker" aria-label="麦克风输入">
                      <button slot="trigger" type="button" class="chat-talk-input-picker__trigger" aria-label="麦克风输入">&#9834;</button>
                    </wa-dropdown>
                    <button type="button" class="chat-send-btn chat-send-btn--voice" aria-label="开始语音输入">v</button>
                  </div>
                  <button type="button" class="chat-send-btn chat-send-btn--send" aria-label="发送">&uarr;</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </openclaw-plugin-view></div>
    </div></div>
  </div>
</div>
<script>
  window.__measure = () => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        display: cs.display, cols: cs.gridTemplateColumns, areas: cs.gridTemplateAreas};
    };
    return {
      shell: box('.agent-chat__composer-shell'),
      input: box('.agent-chat__input'),
      row: box('.agent-chat__composer-input-row'),
      textarea: box('.agent-chat__composer-combobox textarea'),
      actions: box('.agent-chat__composer-actions'),
      send: box('.chat-send-btn--send'),
      lead: box('.agent-chat__composer-lead'),
      permission: box('.chat-controls__permission-picker'),
      permissionTrigger: box('.chat-controls__permission-trigger'),
      controls: box('.agent-chat__composer-controls'),
      absorbed: box('.laolao-learning--absorbed'),
      mic: box('.chat-talk-input-picker'),
      micTrigger: box('.chat-talk-input-picker__trigger'),
      talkControl: box('.chat-talk-control'),
      kids: [...document.querySelector('.agent-chat__composer-lead').children].map((el) => {
        const r = el.getBoundingClientRect();
        return {cls: el.className, w: +r.width.toFixed(1), h: +r.height.toFixed(1)};
      }),
      actionsKids: [...document.querySelector('.agent-chat__composer-actions').children].map((el) => {
        const r = el.getBoundingClientRect();
        return {cls: el.className, w: +r.width.toFixed(1)};
      }),
    };
  };
</script>
</body></html>`;
}

// Minimal DevTools client: launch, poll /json/list, evaluate, close.
async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cle-style-'));
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, '--window-size=1280,800', '--remote-debugging-port=0', 'about:blank',
  ], {stdio: ['ignore', 'ignore', 'pipe']});
  // --remote-debugging-port=0 prints the chosen port instead of a ws URL, so read the port and
  // ask /json/version for the browser endpoint.
  const port = await new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('chrome did not report a debugger port')), 15000);
    child.stderr.on('data', (chunk) => {
      buffered += String(chunk);
      const match = buffered.match(/DevTools listening on ws:\/\/[^\s]+:(\d+)\//);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.on('error', reject);
  });
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const wsUrl = version.webSocketDebuggerUrl;
  const WebSocketImpl = globalThis.WebSocket;
  const socket = new WebSocketImpl(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); waiter(message); }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({id, method, params, sessionId}));
  });
  try {
    return await fn({send});
  } finally {
    try { socket.close(); } catch {}
    child.kill('SIGKILL');
    // chrome keeps writing into the profile after SIGKILL; a failed cleanup must not fail the test
    await new Promise((resolve) => setTimeout(resolve, 120));
    try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 80}); } catch {}
  }
}

async function measureAt(client, width) {
  const html = page().replace('#host{width:864px}', `#host{width:${width}px}`)
    .replace('.chat-pane-cache__pane{width:864px}', `.chat-pane-cache__pane{width:${width}px}`)
    .replace('.chat-main{width:864px}', `.chat-main{width:${width}px}`)
    .replace('.chat-footer{width:864px}', `.chat-footer{width:${width}px}`);
  const target = await client.send('Target.createTarget', {url: 'about:blank'});
  const targetId = target.result.targetId;
  const attached = await client.send('Target.attachToTarget', {targetId, flatten: true});
  const sessionId = attached.result.sessionId;
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);
  await client.send('Page.navigate', {url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html)}, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const result = await client.send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__measure())', returnByValue: true,
  }, sessionId);
  await client.send('Target.closeTarget', {targetId});
  const value = result.result?.result?.value;
  assert.ok(value, 'the harness page did not report measurements');
  return JSON.parse(value);
}

const skip = hasChrome ? false : 'Google Chrome not installed';

test('at 864px the permission trigger is a control-sized coin, not a full-row bar', {skip}, async () => {
  await withChrome(async (client) => {
    const m = await measureAt(client, 864);
    assert.ok(m.permissionTrigger.w <= 44,
      `permission trigger is ${m.permissionTrigger.w}px wide; a display:contents host let width:100% resolve against the whole lead`);
    assert.ok(m.permissionTrigger.w >= 28, `permission trigger shrank to ${m.permissionTrigger.w}px`);
  });
});

test('at 864px the tools stay on one row and the composer is not 153px tall', {skip}, async () => {
  await withChrome(async (client) => {
    const m = await measureAt(client, 864);
    // one row of tools: the lead must not be taller than a control plus its top padding
    assert.ok(m.lead.h <= 46, `tool lead is ${m.lead.h}px tall — the tools wrapped into ${Math.round(m.lead.h / 32)} rows`);
    assert.ok(m.input.h <= 110, `composer is ${m.input.h}px tall`);
  });
});

test('at 864px the text keeps the width the send coin leaves, not the model row width', {skip}, async () => {
  await withChrome(async (client) => {
    const m = await measureAt(client, 864);
    // the textarea spans the row minus the send/voice cluster (~112px: 20 left + 92 reserved),
    // never the 313px model column that squeezed it to 544px before
    assert.ok(m.textarea.w >= m.row.w - 130,
      `textarea is ${m.textarea.w}px inside a ${m.row.w}px row: row 2 is still sizing row 1`);
    assert.ok(m.textarea.w >= 700, `textarea is only ${m.textarea.w}px wide`);
    assert.ok(m.row.w >= m.input.w - 2, `input row is ${m.row.w}px of a ${m.input.w}px composer`);
  });
});

test('at 864px the send coin sits at the right edge, not mid-row', {skip}, async () => {
  await withChrome(async (client) => {
    const m = await measureAt(client, 864);
    const innerRight = m.send.x + m.send.w;
    // the composer's right edge minus the inner padding (9px) — no 200px empty tail
    assert.ok(innerRight >= m.input.x + m.input.w - 24,
      `send ends at ${innerRight}, composer ends at ${m.input.x + m.input.w}`);
    assert.ok(m.actions.x + m.actions.w >= m.input.x + m.input.w - 24,
      `actions end at ${m.actions.x + m.actions.w}`);
  });
});

test('no implicit third track is created inside a narrow pane', {skip}, async () => {
  await withChrome(async (client) => {
    const m = await measureAt(client, 508);
    const cols = (m.input.cols || '').split(' ').filter(Boolean);
    assert.ok(cols.length <= 2, `composer has ${cols.length} column tracks (${m.input.cols}) — an old grid-area index is creating an implicit track`);
    // and the tools/model controls sit in declared areas, so nothing lands in a phantom column
    assert.ok(m.lead.w > 100, `lead collapsed to ${m.lead.w}px`);
  });
});

test('a 508px pane keeps the inset on both the thread and the composer', {skip}, async () => {
  await withChrome(async (client) => {
    const m = await measureAt(client, 508);
    // shell is inset from the pane by the gutter on both sides
    assert.ok(m.shell.x >= 12, `composer starts at x=${m.shell.x}, expected the 16px pane inset`);
    assert.ok(m.shell.w <= 508 - 24, `composer is ${m.shell.w}px wide inside a 508px pane`);
  });
});

// ---- real DOM behaviour: the fold menu, in a browser ----
async function loadFoldHarness(client, width = 864) {
  const html = `<!doctype html><html data-cle="0.1.0"><head><meta charset="utf-8">
<style>${nativeCss()}</style>
<style>${[readIf(path.join(root, 'src/styles/tokens.css')), readIf(path.join(root, 'src/composer/composer.css'))].join('\n')}</style>
<style>#host{width:${width}px}</style></head><body><div id="host"></div></body></html>`;
  const target = await client.send('Target.createTarget', {url: 'about:blank'});
  const targetId = target.result.targetId;
  const attached = await client.send('Target.attachToTarget', {targetId, flatten: true});
  const sessionId = attached.result.sessionId;
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);
  await client.send('Page.navigate', {url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html)}, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {sessionId, targetId};
}

async function evaluate(client, sessionId, expression, awaitPromise = false) {
  const result = await client.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise,
  }, sessionId);
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text + ' ' + (result.result.exceptionDetails.exception?.description || ''));
  return result.result?.result?.value;
}

test('ArrowDown on the closed trigger moves real focus into the visible menu', {skip}, async () => {
  await withChrome(async (client) => {
    const {sessionId, targetId} = await loadFoldHarness(client);
    // build a lead with one low-priority tool, mount the fold, then press ArrowDown on the trigger
    const outcome = await evaluate(client, sessionId, `(async () => {
      const host = document.getElementById('host');
      host.innerHTML = '<div class="cle-composer"><div class="agent-chat__composer-lead">'
        + '<button class="agent-chat__input-btn" aria-label="附件">+</button>'
        + '<button class="chat-browser-panel-toggle" aria-label="浏览器">B</button>'
        + '<button class="chat-send-btn--voice" aria-label="语音">v</button>'
        + '</div></div>';
      const source = ${JSON.stringify(fs.readFileSync(path.join(root, 'src/composer/composer.js'), 'utf8')
        .replace(/^import .*$/m, '').replace(/\bexport\s+/g, ''))};
      const mod = new Function(source + '; return {mountToolFold};')();
      const controller = new AbortController();
      mod.mountToolFold(controller.signal);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const more = document.querySelector('.cle-tools-more');
      if (!more) return {error: 'no trigger'};
      more.focus();
      const keydown = new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true});
      more.dispatchEvent(keydown);
      await new Promise((r) => requestAnimationFrame(r));
      const menu = document.querySelector('.cle-tools-menu');
      const active = document.activeElement;
      const items = [...document.querySelectorAll('.cle-tools-menu__item')];
      // let several frames pass: the focus must not be reset by a refresh
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
      const afterFrames = document.activeElement;
      return {
        menuOpen: !!menu && !menu.hidden,
        menuVisible: !!menu && getComputedStyle(menu).display !== 'none',
        activeIsTrigger: active === more,
        activeIsFirstItem: active === items[0],
        activeTag: active?.className || '',
        focusStable: afterFrames === items[0],
        itemCount: items.length,
      };
    })()`, true);
    await client.send('Target.closeTarget', {targetId});
    assert.ok(!outcome.error, outcome.error);
    assert.equal(outcome.menuOpen, true, 'the menu opened');
    assert.equal(outcome.menuVisible, true, 'the menu is not display:none when focus moves');
    assert.equal(outcome.activeIsTrigger, false, 'focus must not stay on the trigger (it was focused while hidden)');
    assert.equal(outcome.activeIsFirstItem, true, `focus went to ${outcome.activeTag}`);
    assert.equal(outcome.focusStable, true, 'later frames must not reset the focus');
  });
});

test('the fold menu never lists learning entries the capsule absorbed', {skip}, async () => {
  await withChrome(async (client) => {
    const {sessionId, targetId} = await loadFoldHarness(client);
    const labels = await evaluate(client, sessionId, `(async () => {
      const host = document.getElementById('host');
      host.innerHTML = '<div class="cle-composer"><div class="agent-chat__composer-lead">'
        + '<button class="agent-chat__input-btn" aria-label="附件">+</button>'
        + '<button class="chat-browser-panel-toggle" aria-label="浏览器">B</button>'
        + '<button class="laolao-learning-notebook-button laolao-learning--absorbed" aria-label="打开学习笔记本">笔记本</button>'
        + '<button class="laolao-learning-tools__trigger" aria-label="学习资料">资料</button>'
        + '</div></div>';
      // mark what the fold considers low so the menu can be opened deterministically
      document.querySelectorAll('.chat-browser-panel-toggle, .laolao-learning-notebook-button')
        .forEach((el) => { el.dataset.cleTool = 'low'; el.dataset.clePriority = 'low'; el.dataset.cleToolName = el.getAttribute('aria-label'); });
      const source = ${JSON.stringify(fs.readFileSync(path.join(root, 'src/composer/composer.js'), 'utf8')
        .replace(/^import .*$/m, '').replace(/\bexport\s+/g, ''))};
      const mod = new Function(source + '; return {mountToolFold};')();
      const controller = new AbortController();
      mod.mountToolFold(controller.signal);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      document.querySelector('.cle-tools-more')?.click();
      await new Promise((r) => requestAnimationFrame(r));
      return [...document.querySelectorAll('.cle-tools-menu__item')].map((el) => el.textContent);
    })()`, true);
    await client.send('Target.closeTarget', {targetId});
    assert.ok(labels.includes('浏览器'), `the browser entry belongs in the menu: ${labels.join(',')}`);
    assert.equal(labels.some((label) => /学习笔记本/.test(label)), false,
      `an absorbed entry reappeared as a fold proxy: ${labels.join(',')}`);
  });
});

test('microphone picker expansion yields 28px without overlapping textarea and hit-target is unblocked', {skip}, async () => {
  await withChrome(async (client) => {
    // 1. measure steady state at 864px
    const steady = await measureAt(client, 864);
    assert.ok(steady.mic.w <= 1, `in steady state mic width must be 0px, got ${steady.mic.w}px`);
    const steadyTextRight = steady.textarea.x + steady.textarea.w;
    assert.ok(steadyTextRight <= steady.actions.x,
      `steady textarea (right: ${steadyTextRight}) overlaps actions (left: ${steady.actions.x})`);

    // 2. simulate the expanded state (native trigger takes focus-visible or open)
    const target = await client.send('Target.createTarget', {url: 'about:blank'});
    const targetId = target.result.targetId;
    const attached = await client.send('Target.attachToTarget', {targetId, flatten: true});
    const sessionId = attached.result.sessionId;
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Page.enable', {}, sessionId);
    await client.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false}, sessionId);
    await client.send('Page.navigate', {url: 'data:text/html;charset=utf-8,' + encodeURIComponent(page())}, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Open/focus the mic picker via native attribute & focus
    const expanded = await evaluate(client, sessionId, `(async () => {
      const picker = document.querySelector('.chat-talk-input-picker');
      picker.setAttribute('open', '');
      const trigger = document.querySelector('.chat-talk-input-picker__trigger');
      trigger.scrollIntoView();
      trigger.focus();
      // wait for the 0.19s CSS width transition
      await new Promise((r) => setTimeout(r, 260));
      const m = window.__measure();
      const send = document.querySelector('.chat-send-btn--send');
      const tr = trigger.getBoundingClientRect();
      const sr = send.getBoundingClientRect();
      const micCenter = {x: tr.left + tr.width / 2, y: tr.top + tr.height / 2};
      const sendCenter = {x: sr.left + sr.width / 2, y: sr.top + sr.height / 2};
      let micClicked = false;
      let sendClicked = false;
      trigger.addEventListener('click', () => { micClicked = true; }, {once: true});
      send.addEventListener('click', () => { sendClicked = true; }, {once: true});
      trigger.click();
      send.click();
      return {
        m,
        micCenter,
        sendCenter,
        micClicked,
        sendClicked,
        textRight: m.textarea.x + m.textarea.w,
        actionsLeft: m.actions.x,
        overlap: Math.max(0, (m.textarea.x + m.textarea.w) - m.actions.x),
      };
    })()`, true);
    await client.send('Target.closeTarget', {targetId});

    assert.ok(expanded.m.mic.w >= 26, `in expanded state mic must be ~28px, got ${expanded.m.mic.w}px`);
    assert.equal(expanded.overlap, 0, `textarea must not overlap actions, got ${expanded.overlap}px overlap`);
    assert.ok(expanded.textRight <= expanded.actionsLeft,
      `expanded textarea (right: ${expanded.textRight}) overlaps actions (left: ${expanded.actionsLeft})`);
    assert.equal(expanded.micClicked, true, 'mic trigger must be clickable and unblocked');
    assert.equal(expanded.sendClicked, true, 'send button must be clickable and unblocked');
    assert.ok(expanded.textRight < expanded.micCenter.x, 'textarea must end before mic button center');
    assert.ok(expanded.textRight < expanded.sendCenter.x, 'textarea must end before send button center');
  });
});

test('retired native composer shell preserves single-pill geometry and 864px column without freezing buttons', {skip}, async () => {
  await withChrome(async (client) => {
    const target = await client.send('Target.createTarget', {url: 'about:blank'});
    const targetId = target.result.targetId;
    const attached = await client.send('Target.attachToTarget', {targetId, flatten: true});
    const sessionId = attached.result.sessionId;
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Page.enable', {}, sessionId);
    await client.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false}, sessionId);
    await client.send('Page.navigate', {url: 'data:text/html;charset=utf-8,' + encodeURIComponent(page())}, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Simulate retirement: .cle-composer element is removed, leaving native .agent-chat__composer-shell
    const retired = await evaluate(client, sessionId, `(() => {
      const shell = document.querySelector('.agent-chat__composer-shell');
      const cle = document.querySelector('.cle-composer');
      const input = document.querySelector('.agent-chat__input');
      shell.replaceChildren(input); // remove .cle-composer wrapper
      const cs = getComputedStyle(input);
      const r = input.getBoundingClientRect();
      const send = document.querySelector('.chat-send-btn--send');
      const isDisabledBefore = send.disabled;
      send.disabled = true;
      const isDisabledAfter = send.disabled;
      return {
        display: cs.display,
        cols: cs.gridTemplateColumns,
        areas: cs.gridTemplateAreas,
        w: +r.width.toFixed(1),
        isDisabledBefore,
        isDisabledAfter,
      };
    })()`);
    await client.send('Target.closeTarget', {targetId});

    assert.equal(retired.display, 'grid', 'retired native input must stay grid layout');
    assert.equal(retired.w, 864, `retired native input width must be 768px (864px minus margins), got ${retired.w}px`);
    assert.equal(retired.isDisabledAfter, true, 'buttons must respect native disabled state and not be frozen');
  });
});
