// 第五批「权限、计划、用量」前端的复发测试（ui/injections/laolao-metre-perm.js / .css）。真浏览器里跑：页面上只放原生的几个外壳节点
// （按键行、openclaw-exec-approval 卡片）、假网关请求函数和本批两个文件。
// 改前（a4d141bf）：没有这两个文件，Metre 下没有放手程度 / 先出方案 / 状态键，审批卡是原生英文标题、只露第一条，
// Metre 会话的审批不提醒（laolao-run-notify.js 的会话正则没有 metre），额度用完不会到点接着做——下面每条都失败。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const read = (f) => fs.readFileSync(inj(f), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const SK = 'agent:metre:dashboard:t1';

// Metre 的日夜变量（laolao-metre-skin.css 第 1036、1122、1244 行起的原值）
const VARS = `
  html[data-laolao-mode=metre]{--metre-bg:#F7F6F3;--metre-surface:#FFFFFF;--metre-text:#1B1A18;--metre-muted:#77736B;--metre-line:#E4E2DC;--metre-line-strong:#D3D0C8;--metre-hover:#EFEDE8;--metre-danger:#A8432F;--metre-cobalt:#2F4BB0;--metre-sans:sans-serif;--metre-serif:serif;--metre-mono:monospace}
  html[data-laolao-mode=metre][data-pinkie-night]{--metre-bg:#151514;--metre-surface:#232321;--metre-text:#ECEAE4;--metre-muted:#918D84;--metre-line:#272725;--metre-line-strong:#393835;--metre-hover:#1F1F1D;--metre-danger:#D0705A;--metre-cobalt:#8496E6}
  body{margin:0;background:var(--metre-bg,#fff)}`;

const page0 = (mode, night) => `<!doctype html><html data-laolao-mode="${mode}"${night ? ' data-pinkie-night' : ''}><head><style>${VARS}</style></head><body>
<div class="chat-main"><openclaw-chat-pane></openclaw-chat-pane><div class="agent-chat__input"><div class="agent-chat__composer-footer">
<div class="agent-chat__composer-controls" style="display:flex;gap:4px"><button class="pk-eng-chip"><span class="pk-eng-chip__name">Metre</span></button></div></div></div></div>
<openclaw-exec-approval><div class="exec-approval-card"><div class="exec-approval-header"><div><div class="exec-approval-title">Exec approval needed</div><div class="exec-approval-sub">expires in 2m</div></div><div class="exec-approval-queue">3 pending</div></div>
<div class="exec-approval-command mono">npm test</div><div class="exec-approval-actions"><button class="btn primary">允许一次</button><button class="btn">始终允许</button><button class="btn danger">拒绝</button></div></div></openclaw-exec-approval>
</body></html>`;

// 假网关：记下每次请求；exec.approvals.set 可以先回几次「别人刚写过」
const STUBS = (sk) => `
  window.__calls = [];
  window.__file = {version: 1, defaults: {}, agents: {main: {allowlist: [{id: 'a', pattern: 'git *'}]}}};
  window.__hash = 'h1'; window.__conflicts = 0;
  window.__resp = {
    'pinkie.metre.planMode.get': () => ({on: !!window.__planOn}),
    'pinkie.metre.planMode.set': (p) => { window.__planOn = p.on === true; return {on: window.__planOn}; },
    'pinkie.plan.get': () => ({plan: window.__plan || null}),
    'usage.status': () => ({providers: [{provider: 'anthropic', displayName: 'Claude', windows: [{label: '5h', usedPercent: 60, resetAt: Date.now() + 3600e3}, {label: 'Week', usedPercent: 20}]}]}),
    'sessions.usage': (p) => ({sessions: [{key: p.key, model: 'hy4flash-free', modelProvider: 'workbuddy', usage: {input: 12000, output: 3400, totalTokens: 15400, totalCost: 0.0123, firstActivity: Date.now() - 600e3}}]}),
    'pinkie.project.bind': () => ({binding: {root: 'F:/work/demo'}}),
    'exec.approvals.get': () => ({exists: true, hash: window.__hash, file: JSON.parse(JSON.stringify(window.__file))}),
    'exec.approvals.set': (p) => {
      if (window.__conflicts > 0) { window.__conflicts--; window.__hash = 'h' + Math.random(); throw new Error('exec approvals changed since last load; re-run exec.approvals.get and retry'); }
      if (p.baseHash !== window.__hash) throw new Error('exec approvals changed since last load; re-run exec.approvals.get and retry');
      window.__file = p.file; window.__hash = 'h' + Math.random(); return {hash: window.__hash};
    },
    'exec.approval.resolve': () => ({ok: true}),
    'plugin.approval.resolve': () => ({ok: true}),
    'pinkie.model.failure': () => ({failure: window.__failure || null}),
    'chat.send': () => ({ok: true}),
  };
  window.__laolaoSidebar = {
    gwRequest: async (method, params) => { window.__calls.push({method, params: JSON.parse(JSON.stringify(params || {}))}); const f = window.__resp[method]; if (!f) throw new Error('unknown method: ' + method); return f(params || {}); },
    toast: (t) => { window.__toast = t; }, navigateSession() {},
  };
  document.querySelector('openclaw-chat-pane').state = {sessionKey: ${JSON.stringify(sk)}};
  window.__attn = []; window.__notes = [];
  window.pywebview = {api: {request_attention: (k) => window.__attn.push(k), notify: (m) => window.__notes.push(m)}};
  window.__pinkieRunNotify = {decide: () => ({list: 'attention', title: '? ', attention: true, system: true}), prefs: {list: true, title: true, system: true}, notify: {done: true, waiting: true}};
  document.title = 'Metre';
`;
const gw = (event, payload) => `window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: ${JSON.stringify(event)}, payload: ${JSON.stringify(payload)}}}))`;

async function open(browser, {mode = 'metre', night = false, sk = SK, clock = false, width = 1024} = {}) {
  const p = await browser.newPage({viewport: {width, height: 760}});
  if (clock) await p.clock.install();
  await p.setContent(page0(mode, night));
  await p.addScriptTag({content: STUBS(sk)});
  await p.addStyleTag({content: read('laolao-metre-engine.css')});   // 按键外形（.pk-eng-chip）是引擎台的样式，真页面上也是它
  await p.addStyleTag({content: read('laolao-metre-perm.css')});
  await p.addScriptTag({content: read('laolao-metre-perm.js')});
  return p;
}
// 装了假时钟以后 waitForFunction 的轮询也停了：每次推进 50ms 假时间再看一次
async function until(p, fn, tries = 60) { for (let i = 0; i < tries; i++) { if (await p.evaluate(fn)) return; await p.clock.runFor(50); } throw new Error('没等到：' + fn); }
const calls = (p, m) => p.evaluate((m) => window.__calls.filter((c) => c.method === m), m);
// color-mix() 算出来是 color(srgb 0.84 0.53 0.46)，分量是 0–1，不是 0–255
const lum = (rgb) => { const k = /^color\(srgb/.test(rgb) ? 1 : 255; const [r, g, b] = rgb.replace(/^color\(srgb/, '').match(/\d*\.?\d+/g).slice(0, 3).map(Number).map((v) => { v /= k; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test(`P2 / I4 / R3 / U2: Metre composer gets level, plan-first and status keys; level writes only agents.metre security / ask with baseHash and retries on a conflict (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser);
    await p.evaluate(() => { window.__plan = {items: [{id: '1', text: '读代码', status: 'completed'}, {id: '2', text: '写测试', status: 'completed'}, {id: '3', text: '改界面', status: 'in_progress'}, {id: '4', text: '走查', status: 'pending'}, {id: '5', text: '交付', status: 'pending'}]}; });
    await p.evaluate(() => window.PinkieMetrePerm.refresh());
    const keys = await p.$$eval('.agent-chat__composer-controls > *', (n) => n.map((e) => e.textContent.trim()));
    assert.deepEqual(keys, ['Metre', '自动先出方案计划 2 / 5 · 额度 40%'], '引擎键后面紧跟三个键，默认档是「自动」');
    // 放手程度：选「问我」→ 只改 agents.metre，带 baseHash；第一次被别人抢先写了，重读再写
    await p.evaluate(() => { window.__conflicts = 1; });
    await p.click('.pk-perm-chip--level');
    assert.equal(await p.$$eval('.pk-perm-pop__item', (n) => n.map((e) => e.querySelector('.pk-perm-pop__name').textContent).join('/')), '自动/问我/不跑命令');
    await p.click('.pk-perm-pop__item:nth-of-type(2)');
    await p.waitForFunction(() => window.__file.agents?.metre?.security === 'allowlist');
    const file = await p.evaluate(() => window.__file);
    assert.deepEqual(file.agents.metre, {security: 'allowlist', ask: 'on-miss'});
    assert.deepEqual(file.agents.main, {allowlist: [{id: 'a', pattern: 'git *'}]}, '别的代理、允许清单（ui2 P3 的）原样不动');
    const sets = await calls(p, 'exec.approvals.set');
    assert.equal(sets.length, 2, '第一次冲突、重读后第二次成功');
    assert.ok(sets.every((c) => typeof c.params.baseHash === 'string' && c.params.baseHash));
    assert.equal(await p.textContent('.pk-perm-chip--level'), '问我');
    // 先出方案：开 → 出「照这个方案做」→ 点它：先关开关再发话
    await p.click('.pk-perm-chip--plan');
    await p.waitForSelector('.pk-perm-chip--go');
    assert.equal(await p.getAttribute('.pk-perm-chip--plan', 'aria-pressed'), 'true');
    assert.equal(await p.textContent('.pk-perm-chip--stat'), '详情', '多出「照这个方案做」时状态键只留「详情」，820 宽下按键行不换行');
    await p.click('.pk-perm-chip--go');
    await p.waitForFunction(() => window.__calls.some((c) => c.method === 'chat.send'));
    const seq = (await p.evaluate(() => window.__calls)).filter((c) => /planMode\.set|chat\.send/.test(c.method)).map((c) => c.method + ':' + (c.params.on ?? c.params.message));
    assert.deepEqual(seq, ['pinkie.metre.planMode.set:true', 'pinkie.metre.planMode.set:false', 'chat.send:照这个方案做。']);
    assert.equal(await p.$('.pk-perm-chip--go'), null);
    // 引擎台开着时这一组让位
    await p.evaluate(() => document.documentElement.setAttribute('data-pk-engine', 'on'));
    assert.equal(await p.$eval('.pk-perm-chips', (e) => getComputedStyle(e).display), 'none');
  } finally { await browser.close(); }
});

test(`R1 / U3: the status key opens session details with model, start, folder, tokens, cost, plan and quota (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser);
    await p.evaluate(() => { window.__plan = {items: [{id: '1', text: 'a', status: 'completed'}, {id: '2', text: 'b', status: 'in_progress'}]}; });
    await p.evaluate(() => window.PinkieMetrePerm.refresh());
    await p.click('.pk-perm-chip--stat');
    const rows = await p.$$eval('.pk-perm-pop--detail .pk-perm-pop__row', (n) => Object.fromEntries(n.map((r) => [r.children[0].textContent, r.children[1].textContent])));
    assert.equal(rows['模型'], 'workbuddy / hy4flash-free');
    assert.equal(rows['工作目录'], 'F:/work/demo');
    assert.equal(rows['本会话令牌'], '15.4k（读 12.0k · 写 3.4k）');
    assert.equal(rows['本会话花费'], '$0.012（估算）');
    assert.match(rows['额度'], /^Claude 5h 还剩 40% · .+ 重置$/);
    assert.match(rows['开始'], /^\d\d:\d\d$/);
    assert.equal(await p.getAttribute('.pk-perm-bar', 'aria-valuenow'), '1');
    await p.keyboard.press('Escape');
    assert.equal(await p.$('.pk-perm-pop'), null, 'Esc 关掉');
  } finally { await browser.close(); }
});

test(`P1 / P4 / N1: approval card in Metre gets a Chinese title, lists the others with their own buttons, and a Metre approval reminds (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser);
    await p.evaluate(() => {
      const mk = (id, cmd, sk) => ({id, kind: 'exec', request: {command: cmd, sessionKey: sk}, createdAtMs: 1, expiresAtMs: Date.now() + 120e3});
      document.querySelector('openclaw-exec-approval').props = {queue: [mk('a1', 'npm test', 'agent:metre:dashboard:t1'), mk('a2', 'rm -rf build', 'agent:metre:dashboard:t2'), {id: 'p3', kind: 'plugin', pluginTitle: '读邮箱', request: {sessionKey: 'agent:metre:dashboard:t1', allowedDecisions: ['allow-once', 'deny']}, createdAtMs: 1, expiresAtMs: Date.now() + 1e5}]};
    });
    await p.evaluate(gw('exec.approval.requested', {id: 'a2', request: {command: 'rm -rf build', sessionKey: 'agent:metre:dashboard:t2'}}));
    await p.waitForSelector('.pk-perm-q');
    const title = await p.$eval('.exec-approval-title', (e) => getComputedStyle(e, '::after').content);
    assert.equal(title, '"要跑一条命令，等你批"');
    assert.equal(await p.textContent('.pk-perm-q__head'), '还有 2 处在等你批');
    assert.deepEqual(await p.$$eval('.pk-perm-q__cmd', (n) => n.map((e) => e.textContent)), ['rm -rf build', '读邮箱']);
    await p.click('.pk-perm-q__row:nth-of-type(2) .pk-perm-q__btn--yes');
    await p.waitForFunction(() => window.__calls.some((c) => c.method === 'exec.approval.resolve'));
    assert.deepEqual((await calls(p, 'exec.approval.resolve'))[0].params, {id: 'a2', decision: 'allow-once'});
    await p.click('.pk-perm-q__row:nth-of-type(3) .pk-perm-q__btn:not(.pk-perm-q__btn--yes)');
    await p.waitForFunction(() => window.__calls.some((c) => c.method === 'plugin.approval.resolve'));
    assert.deepEqual((await calls(p, 'plugin.approval.resolve'))[0].params, {id: 'p3', decision: 'deny'});
    // N1：标题「? 」、任务栏、系统通知各一次；同一条不重复
    await p.evaluate(gw('exec.approval.requested', {id: 'a2', request: {command: 'rm -rf build', sessionKey: 'agent:metre:dashboard:t2'}}));
    assert.equal(await p.title(), '? Metre');
    assert.deepEqual(await p.evaluate(() => window.__attn), ['ask']);
    const notes = await p.evaluate(() => window.__notes);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].sessionKey, 'agent:metre:dashboard:t2');
    assert.match(notes[0].body, /rm -rf build/);
    // 别的模式的会话这里不管（那边是 laolao-run-notify.js 管）
    await p.evaluate(gw('exec.approval.requested', {id: 'x9', request: {command: 'ls', sessionKey: 'agent:main:chat:x'}}));
    assert.equal((await p.evaluate(() => window.__notes)).length, 1);
  } finally { await browser.close(); }
});

test(`A2: when quota runs out with a reset time, Metre shows it and sends "接着做" after the reset; starting a run yourself cancels it (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await open(browser, {clock: true});
    await p.evaluate(() => { void window.PinkieMetrePerm.refresh(); });
    await until(p, () => !!document.querySelector('.pk-perm-chip--stat'));
    await p.evaluate(() => { window.__failure = {kind: 'account', resetAt: new Date(Date.now() + 60_000).toISOString()}; });
    await p.evaluate(gw('chat', {sessionKey: SK, state: 'error'}));
    await until(p, () => window.PinkieMetrePerm.snapshot().resume?.armed === true);
    assert.match(await p.textContent('.pk-perm-chip--stat'), /^\d\d:\d\d 恢复$/);
    await p.clock.runFor(70_000);
    assert.equal((await calls(p, 'chat.send')).length, 0, '恢复后再等 20 秒才发，别卡在边上');
    await p.clock.runFor(15_000);
    const sent = await calls(p, 'chat.send');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].params.sessionKey, SK);
    assert.match(sent[0].params.message, /接着做/);
    // 第二次：用户自己先发了话（这一轮开始跑）就不再自动发
    await p.evaluate(() => { window.__failure = {kind: 'account', resetAt: new Date(Date.now() + 60_000).toISOString()}; });
    await p.evaluate(gw('chat', {sessionKey: SK, state: 'error'}));
    await until(p, () => window.PinkieMetrePerm.snapshot().resume?.armed === true);
    await p.evaluate(gw('agent', {sessionKey: SK, stream: 'lifecycle', data: {phase: 'start'}}));
    await p.clock.runFor(120_000);
    assert.equal((await calls(p, 'chat.send')).length, 1);
  } finally { await browser.close(); }
});

// 审批卡走查第二轮：主题 laolao-theme.css 给不是 .danger 的 .btn 强制透明底、白色半透明边框和粉字，日间「允许一次 / 始终允许」看着像纯文字；
// 详情区标签和值是英文（CWD / allowlist / on-miss）；待批行来源取了侧栏整行文字，出来是「harness 刚刚」。改前三处都不对，这条失败。
// 夹具在页面画完以后才加这几条样式，按钮自带的 120ms 底色过渡会让读数停在浏览器默认的 #F0F0F0 起点；真页面主题一开始就在，这里关掉过渡。
const THEME_BTN = `*,*::before{transition:none!important}
  :is(.btn):not(:disabled):not(.danger){background:linear-gradient(180deg,rgba(255,250,253,.78),rgba(251,220,241,.33))!important;border-color:rgba(255,255,255,.72)!important;color:var(--mode-button-ink,#ad4f7f)!important}
  html[data-laolao-mode="metre"]:not(#_m1):not(#_m2) .btn{background-image:none!important;box-shadow:none!important}
  .btn{border:1px solid transparent;border-radius:6px;height:32px}`;
test(`P1: approval buttons stay filled although the theme forces glass on .btn, details read in Chinese, and the queue source is just the session name (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    for (const night of [false, true]) {
      const p = await open(browser, {night});
      await p.addStyleTag({content: THEME_BTN});
      await p.evaluate(() => {
        const row = document.createElement('a'); row.className = 'sidebar-recent-session'; row.dataset.sessionKey = 'agent:metre:dashboard:t2';
        row.innerHTML = '<span class="sidebar-recent-session__name">harness</span><span class="sidebar-recent-session__time">刚刚</span>';
        document.body.prepend(row);
        const meta = document.createElement('div'); meta.className = 'exec-approval-meta';
        meta.innerHTML = [['CWD', '~/demo'], ['安全', 'allowlist'], ['询问策略', 'on-miss']].map(([k, v]) => `<div class="exec-approval-meta-row"><span>${k}</span><span>${v}</span></div>`).join('');
        document.querySelector('.exec-approval-actions').before(meta);
        const mk = (id, cmd, sk) => ({id, kind: 'exec', request: {command: cmd, sessionKey: sk}, createdAtMs: 1, expiresAtMs: Date.now() + 120e3});
        document.querySelector('openclaw-exec-approval').props = {queue: [mk('a1', 'npm test', 'agent:metre:dashboard:t1'), mk('a2', 'rm -rf build', 'agent:metre:dashboard:t2')]};
      });
      await p.evaluate(gw('exec.approval.requested', {id: 'a2', request: {command: 'rm -rf build', sessionKey: 'agent:metre:dashboard:t2'}}));
      await p.waitForSelector('.pk-perm-q');
      const r = await p.evaluate(() => {
        const clear = (c) => /rgba\(0, 0, 0, 0\)|transparent/.test(c);
        const btns = [...document.querySelectorAll('.exec-approval-actions .btn')].map((e) => {
          const own = getComputedStyle(e), b = getComputedStyle(e, '::before');
          const fill = !clear(own.backgroundColor) && own.backgroundImage === 'none' ? own.backgroundColor : b.content !== 'none' ? b.backgroundColor : 'none';
          const edge = b.content !== 'none' && b.borderTopWidth !== '0px' ? b.borderTopColor : own.borderTopWidth !== '0px' ? own.borderTopColor : 'none';
          return {text: e.textContent.trim(), fill, edge, color: own.color};
        });
        const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
        return {btns, cobalt: v('--metre-cobalt'), card: getComputedStyle(document.querySelector('.exec-approval-card')).backgroundColor,
          meta: [...document.querySelectorAll('.exec-approval-meta-row')].map((row) => [...row.children].map((c) => c.dataset.pkZh || c.textContent.trim())),
          who: [...document.querySelectorAll('.pk-perm-q__who')].map((e) => e.textContent.trim())};
      });
      const tag = night ? '夜' : '日';
      const [once, always, deny] = r.btns;
      const hex = (c) => { const [a, b, d] = c.match(/\d+/g).map(Number); return '#' + [a, b, d].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); };
      assert.notEqual(once.fill, 'none', `${tag}：「允许一次」有底色（${JSON.stringify(once)}）`);
      assert.equal(hex(once.fill), r.cobalt.toUpperCase(), `${tag}：「允许一次」是钴蓝底（${JSON.stringify(once)}）`);
      assert.ok(ratio(once.color, once.fill) >= 4.5, `${tag}：「允许一次」字和底 ${ratio(once.color, once.fill).toFixed(2)}`);
      for (const b of [always, deny]) {
        assert.notEqual(b.fill, 'none', `${tag}：「${b.text}」有底色`);
        assert.ok(!/255, 255, 255, 0\.72/.test(b.edge) && b.edge !== 'none', `${tag}：「${b.text}」边框不是主题的白色半透明（${b.edge}）`);
        assert.ok(ratio(b.color, b.fill) >= 4.5, `${tag}：「${b.text}」字和底 ${ratio(b.color, b.fill).toFixed(2)}（${JSON.stringify(b)}）`);
      }
      assert.deepEqual(r.meta, [['工作目录', '~/demo'], ['安全', '只跑允许清单里的'], ['询问策略', '不在清单里就问']], `${tag}：详情区中文`);
      assert.ok(r.who.includes('harness') && !r.who.some((w) => /刚刚/.test(w)), `${tag}：来源只取会话名（${JSON.stringify(r.who)}）`);
      await p.close();
    }
  } finally { await browser.close(); }
});

test(`other modes are untouched, and Metre text on these keys and popovers is at least 4.5:1 in day and night (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const other = await open(browser, {mode: 'main', sk: 'agent:main:chat:x'});
    await other.evaluate(() => window.PinkieMetrePerm.refresh());
    await other.evaluate(gw('exec.approval.requested', {id: 'z', request: {command: 'ls', sessionKey: 'agent:main:chat:x'}}));
    await other.waitForTimeout(900);
    assert.equal(await other.$('.pk-perm-chips'), null);
    assert.equal(await other.$('.pk-perm-q'), null);
    assert.equal(await other.$eval('.exec-approval-title', (e) => e.dataset.pkTitle ?? null), null);
    assert.equal(await other.$eval('.exec-approval-card', (e) => getComputedStyle(e).animationName), 'none');
    const out = {};
    for (const night of [false, true]) {
      const p = await open(browser, {night});
      await p.evaluate(() => { window.__plan = {items: [{id: '1', text: 'a', status: 'completed'}]}; });
      await p.evaluate(() => window.PinkieMetrePerm.refresh());
      await p.click('.pk-perm-chip--stat');
      const pairs = await p.evaluate(() => {
        const bg = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
        return [...document.querySelectorAll('.pk-perm-chip .pk-eng-chip__name, .pk-perm-pop__k, .pk-perm-pop__v, .pk-perm-pop__title, .exec-approval-sub, .exec-approval-queue, .exec-approval-command')]
          .map((e) => ({cls: e.className, fg: getComputedStyle(e).color, bg: bg(e)}));
      });
      for (const x of pairs) {
        const r = ratio(x.fg, x.bg), k = (night ? 'night ' : 'day ') + x.cls;
        out[k] = Math.min(out[k] ?? 99, Math.round(r * 100) / 100);
        assert.ok(r >= 4.5, `${night ? '夜' : '日'} ${x.cls} ${x.fg} on ${x.bg} = ${r.toFixed(2)}`);
      }
    }
    console.log('contrast', JSON.stringify(out));
  } finally { await browser.close(); }
});

// 真页面 1280 宽 metre-board：输入框下这一行还有原生模型键和 Baton / Virtuoso，本批三个键把模型键挤到第二行、输入框往上跳 28px（#94 第一轮 CI 截图对比 5.2%）。
// 放不下时要一步步收拢，原生的键不许换行；位置够就全露。改前没有收拢，下面「窄」的那一半失败。
test(`when the composer row is too narrow the keys fold down instead of pushing the native model key to a new line (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    for (const [w, wide] of [[1000, true], [330, false]]) {
      const p = await open(browser);
      await p.evaluate((w) => {
        const c = document.querySelector('.agent-chat__composer-controls');
        c.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;width:${w}px`;
        const m = document.createElement('button'); m.className = 'chat-composer-model-control'; m.style.cssText = 'flex:0 0 auto;width:150px;height:28px'; m.textContent = 'model'; c.append(m);
        window.__plan = {items: [{id: '1', text: 'a', status: 'completed'}, {id: '2', text: 'b', status: 'pending'}]};
      }, w);
      await p.evaluate(() => window.PinkieMetrePerm.refresh());
      await p.waitForTimeout(1700);   // 画完以后还会隔一会儿再量几次
      const r = await p.evaluate(() => {
        const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top);
        return {metre: top('.agent-chat__composer-controls > .pk-eng-chip'), model: top('.chat-composer-model-control'), fold: document.querySelector('.pk-perm-chips').dataset.fold,
          keys: [...document.querySelectorAll('.pk-perm-chips .pk-eng-chip__name')].map((e) => e.textContent)};
      });
      assert.equal(r.model, r.metre, `${w}px：原生模型键和 Metre 键在同一行（${JSON.stringify(r)}）`);
      if (wide) { assert.equal(r.fold, '0'); assert.deepEqual(r.keys, ['自动', '先出方案', '计划 1 / 2 · 额度 40%']); continue; }
      assert.ok(Number(r.fold) >= 2, '窄的时候收拢到只剩一个键');
      assert.equal(r.keys.length, 1);
      // 收进去的放手程度、先出方案在会话详情里还能用
      await p.click('.pk-perm-chip--stat');
      assert.deepEqual(await p.$$eval('.pk-perm-pop--detail .pk-perm-pop__acts .pk-perm-pop__btn', (n) => n.map((e) => e.textContent)), ['放手程度：自动', '先出方案：关']);
      await p.click('.pk-perm-pop__acts .pk-perm-pop__btn:nth-child(2)');
      await p.waitForFunction(() => window.__planOn === true);
      await p.waitForSelector('.pk-perm-pop__btn--go');
      await p.click('.pk-perm-pop__btn--go');
      await p.waitForFunction(() => window.__calls.some((c) => c.method === 'chat.send'));
      assert.equal(await p.evaluate(() => window.__planOn), false, '照这个方案做：先关开关再发话');
      await p.close();
    }
  } finally { await browser.close(); }
});

// 按键行底下横穿着谱线：va-b5 真截图里字底下最难读的像素，日间 #C8C4BB、夜间 #232429；「先出方案」按下态的底日间 #B8B7BA、夜间 #313443。
// 字对这些像素也要 ≥ 4.5:1。改前日间 ink2 #5F5C55 只有 3.8、warn #8A5A12 3.4，夜间按下态钴蓝 4.4；夜间计划进度条底槽和卡片底几乎一样（1.05）。
test(`key text stays at least 4.5:1 over the stave lines behind the key row, and the night plan bar track is visible (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const out = {};
    for (const night of [false, true]) {
      const p = await open(browser, {night});
      await p.evaluate(() => {
        window.__plan = {items: [{id: '1', text: 'a', status: 'completed'}, {id: '2', text: 'b', status: 'pending'}]};
        window.__resp['usage.status'] = () => ({providers: [{provider: 'anthropic', displayName: 'Claude', windows: [{label: '5h', usedPercent: 78}]}]});
      });
      await p.evaluate(() => window.PinkieMetrePerm.refresh());
      assert.equal(await p.getAttribute('.pk-perm-chip--stat', 'data-tone'), 'warn', '额度只剩 22%：状态键是提醒色');
      const stave = night ? 'rgb(35, 36, 41)' : 'rgb(200, 196, 187)';
      const fg = (sel) => p.$eval(sel, (e) => getComputedStyle(e).color);
      const check = (k, c, bg) => {
        const r = ratio(c, bg);
        out[(night ? 'night ' : 'day ') + k] = Math.round(r * 100) / 100;
        assert.ok(r >= 4.5, `${night ? '夜' : '日'} ${k} ${c} on ${bg} = ${r.toFixed(2)}`);
      };
      check('level', await fg('.pk-perm-chip--level .pk-eng-chip__name'), stave);
      check('plan', await fg('.pk-perm-chip--plan .pk-eng-chip__name'), stave);
      check('stat warn', await fg('.pk-perm-chip--stat .pk-eng-chip__name'), stave);
      await p.click('.pk-perm-chip--plan');
      await p.waitForSelector('.pk-perm-chip--go');
      check('plan pressed', await fg('.pk-perm-chip--plan .pk-eng-chip__name'), night ? 'rgb(49, 52, 67)' : 'rgb(184, 183, 186)');
      check('go', await fg('.pk-perm-chip--go .pk-eng-chip__name'), stave);
      // 进度条底槽：在画布上先铺卡片底、再叠底槽色，取合成后的像素（底槽色是带透明度的混色）
      await p.click('.pk-perm-chip--stat');
      const [track, card] = await p.evaluate(() => {
        const card = getComputedStyle(document.querySelector('.pk-perm-pop--detail')).backgroundColor;
        const tr = getComputedStyle(document.querySelector('.pk-perm-bar')).backgroundColor;
        const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d');
        g.fillStyle = card; g.fillRect(0, 0, 1, 1); g.fillStyle = tr; g.fillRect(0, 0, 1, 1);
        const d = g.getImageData(0, 0, 1, 1).data;
        return [`rgb(${d[0]}, ${d[1]}, ${d[2]})`, card];
      });
      const r = ratio(track, card);
      out[(night ? 'night ' : 'day ') + 'bar track'] = Math.round(r * 100) / 100;
      if (night) assert.ok(r >= 1.5, `夜 进度条底槽 ${track} on ${card} = ${r.toFixed(2)}`);
      await p.close();
    }
    console.log('stave contrast', JSON.stringify(out));
  } finally { await browser.close(); }
});
