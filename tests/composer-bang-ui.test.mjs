// I6 聊天里用 ! 直接跑命令：laolao-composer-bang.js 的 intercept、确认框、命令标签和失败后放回草稿。
// 假网关只模拟 pinkie.shell.*，判档和执行由 tests/shell-run.test.mjs 覆盖；这里在真浏览器里跑。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const KEY = 'agent:project:dashboard:bang0001';

const PAGE = `<!doctype html><html><body>
<openclaw-chat-pane><div class="agent-chat__composer-combobox"><textarea></textarea></div></openclaw-chat-pane></body></html>`;

// 假网关：shell.run 第一次按 window.plan 回（confirm / started / 抛错），带 confirmed 的一律 started。
const FAKE = (enabled) => {
  window.calls = [];
  window.plan = 'started';
  const pane = document.querySelector('openclaw-chat-pane');
  pane.state = {chatMessage: ''};
  window.__laolaoSidebar = {gwRequest: async (method, params) => {
    window.calls.push({method, params});
    if (method === 'pinkie.shell.config.get') return {enabled};
    if (method !== 'pinkie.shell.run') return {};
    const cwd = '/tmp/bang';
    if (params.confirmed) return {status: 'started', command: params.command, cwd};
    if (window.plan === 'confirm') return {status: 'confirm', command: params.command, cwd};
    if (window.plan instanceof Object) throw new Error(window.plan.error);
    return {status: 'started', command: params.command, cwd};
  }};
};

async function open(browser, {enabled = true, fix = true} = {}) {
  const page = await browser.newPage({viewport: {width: 900, height: 500}});
  await page.setContent(PAGE);
  await page.evaluate(FAKE, enabled);
  if (fix) {
    await page.addStyleTag({path: inj('laolao-composer-bang.css')});
    await page.addScriptTag({path: inj('laolao-composer-bang.js')});
    await page.waitForFunction(() => window.calls.some(c => c.method === 'pinkie.shell.config.get'));
  }
  return page;
}

// 模拟 sidebar chat.send 队列：原生已清空输入框，然后调 intercept；记下 reply 和返回值。
const send = (page, message, plan = 'started') => page.evaluate(async ([key, message, plan]) => {
  window.plan = plan;
  document.querySelector('textarea').value = '';
  const req = {type: 'req', id: 'r1', method: 'chat.send', params: {sessionKey: key, message, idempotencyKey: 'run-abc12345'}};
  const replies = [];
  const intercept = window.Pinkie?.composerBang?.intercept;
  const result = intercept ? await intercept(key, req, (ok, body) => replies.push({ok, body})) : 'missing';
  return {result, replies, message: req.params.message};
}, [KEY, message, plan]);
const runs = (page) => page.evaluate(() => window.calls.filter(c => c.method === 'pinkie.shell.run').map(c => c.params));
const draft = async (page) => { await page.waitForTimeout(30); return page.locator('textarea').inputValue(); };

test(`composer bang: switch off leaves ! messages for the model (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser, {enabled: false});
    const out = await send(page, '!ls');
    assert.equal(out.result, false, '开关关着照常发');
    assert.deepEqual(out.replies, []);
    assert.deepEqual(await runs(page), [], '不碰 pinkie.shell.run');
    await page.locator('textarea').fill('!ls');
    assert.equal(await page.locator('.laolao-composer-bang__tag').count(), 0, '关着不显示「命令」标签');
  } finally { await browser.close(); }
});

test(`composer bang: a runnable command replies ok with the send runId and never reaches the model (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser);
    await page.locator('textarea').fill('!ls -la');
    assert.equal(await page.locator('.laolao-composer-bang__tag').textContent(), '命令');
    const out = await send(page, '!ls -la');
    assert.equal(out.result, true, '已处理，不往下发');
    assert.deepEqual(out.replies, [{ok: true, body: {status: 'ok', runId: 'run-abc12345'}}],
      '回 ok：原生清草稿并刷新历史，不留 chatRunId=null 的进行中状态');
    assert.deepEqual(await runs(page), [{sessionKey: KEY, command: 'ls -la'}]);
    assert.equal(await page.locator('.laolao-composer-bang__tag').count(), 0, '发完输入框空了，标签跟着去掉');
  } finally { await browser.close(); }
});

test(`composer bang: !! and "! " are ordinary messages (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser);
    const twice = await send(page, '!!重要');
    assert.equal(twice.result, 'rewrite');
    assert.equal(twice.message, '!重要', '!! 去掉一个 ! 发给模型');
    const spaced = await send(page, '! 不是命令');
    assert.equal(spaced.result, false);
    assert.deepEqual(await runs(page), []);
  } finally { await browser.close(); }
});

test(`composer bang: confirm dialog defaults to 算了, Esc cancels and puts the command back (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser);
    const pending = send(page, '!rm -rf build', 'confirm');
    const dialog = page.getByRole('alertdialog', {name: '跑这条命令？'});
    await dialog.waitFor();
    assert.equal(await dialog.locator('.laolao-composer-bang__command').textContent(), 'rm -rf build');
    assert.match(await dialog.textContent(), /\/tmp\/bang/);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '算了', '默认焦点在「算了」');
    await page.keyboard.press('Escape');
    const out = await pending;
    assert.equal(out.result, true);
    assert.deepEqual(out.replies, [{ok: false, body: '没有跑'}]);
    assert.equal(await dialog.count(), 0);
    assert.equal(await draft(page), '!rm -rf build', '没跑就把命令放回输入框');
    assert.equal(await page.locator('.laolao-composer-bang__hint').count(), 0, '自己取消不弹提示');
    assert.deepEqual(await runs(page), [{sessionKey: KEY, command: 'rm -rf build'}], '只问过一次，没带 confirmed');
  } finally { await browser.close(); }
});

test(`composer bang: 跑 resends with confirmed (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser);
    const pending = send(page, '!make test', 'confirm');
    await page.getByRole('button', {name: '跑', exact: true}).click();
    const out = await pending;
    assert.deepEqual(out.replies, [{ok: true, body: {status: 'ok', runId: 'run-abc12345'}}]);
    assert.deepEqual(await runs(page), [{sessionKey: KEY, command: 'make test'}, {sessionKey: KEY, command: 'make test', confirmed: true}]);
  } finally { await browser.close(); }
});

test(`composer bang: a refused command shows the reason and restores the draft (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser);
    const out = await send(page, '!curl x', {error: '这条命令在「不允许」名单里'});
    assert.equal(out.result, true);
    assert.deepEqual(out.replies, [{ok: false, body: '这条命令在「不允许」名单里'}]);
    assert.equal(await page.locator('.laolao-composer-bang__hint').textContent(), '这条命令在「不允许」名单里');
    assert.equal(await draft(page), '!curl x');
    await page.locator('textarea').pressSequentially('y');
    assert.equal(await page.locator('.laolao-composer-bang__hint').count(), 0, '一打字提示就收起');
  } finally { await browser.close(); }
});

test(`composer bang: switched off on the gateway meanwhile falls back to a normal send (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const page = await open(browser);
    const out = await send(page, '!ls', {error: '聊天里跑命令还没打开'});
    assert.equal(out.result, false, '服务端说没打开就照常发，不吞消息');
    assert.deepEqual(out.replies, []);
    assert.equal(await page.evaluate(() => window.Pinkie.composerBang.isEnabled()), false);
  } finally { await browser.close(); }
});
