#!/usr/bin/env node
// I6（mac/i6-shell-bang）聊天里用 ! 直接跑命令的 PR 截图脚本，约定同 tools/pr-shots/minimal.mjs：
// node tools/pr-shots/i6-shell-bang.mjs --out <目录> [--counter]，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI（tests/visual/lib/real-harness.mjs 的 long-conversation 场景），只把 pinkie.shell.* 换成假的：
// run 返回 started 前把「$ 命令」写进假网关的记录（模拟服务端 chat.inject），别的调用照走真夹具网关。
// 每格（1440 / 820 × 日 / 夜）拍：输入框「命令」标签、发送后（本地「!命令」气泡应被刷新换掉）、确认框、不能跑时的提示条、设置卡。
// --counter：反例，把 intercept 成功时的回包换成旧形状 {status:'started', runId:null}，report 里 replaced 应该变差。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
const counter = args.includes('--counter');
fs.mkdirSync(out, {recursive: true});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = await import(pathToFileURL(path.join(root, 'tests/visual/lib/real-harness.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const HEIGHT = 800;
const widths = (process.env.PINKIE_I6_WIDTHS || '1440,820').split(',').map(Number);
const themes = (process.env.PINKIE_I6_THEMES || 'day,night').split(',');
const lines = [], report = [];

const initScript = () => {
  window.__i6Calls = [];
  let enabled = true;
  const fence = (text) => '```\n' + text + '\n```';
  const inject = (text) => {
    const st = window.__fake?.state;
    if (!st) return;
    st.seq += 1;
    // 形状照 openclaw chat.inject（appendAssistantTranscriptMessage + resolveInjectedAssistantContent）：label 拼成「[命令]\n\n」前缀。
    st.history.push({role: 'assistant', content: [{type: 'text', text: `[命令]\n\n${text}`}], stopReason: 'stop', timestamp: Date.now(),
      api: 'openai-responses', provider: 'openclaw', model: 'gateway-injected',
      usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
      __openclaw: {id: `i6-${st.seq}`, seq: st.seq}});
  };
  const shell = async (method, params = {}) => {
    window.__i6Calls.push({method, params});
    if (method === 'pinkie.shell.config.get') return {enabled};
    if (method === 'pinkie.shell.config.set') { enabled = params.enabled === true; return {enabled}; }
    if (method === 'pinkie.shell.cancel') return {ok: true};
    const cwd = '/Users/demo/work/site';
    const command = String(params.command || '');
    if (/^curl\b/.test(command)) throw new Error('这条命令在「不允许」名单里');
    if (/^rm\b/.test(command) && !params.confirmed) return {status: 'confirm', command, cwd};
    inject(fence(`$ ${command}`));
    return {status: 'started', command, cwd};
  };
  let sidebar;
  Object.defineProperty(window, '__laolaoSidebar', {configurable: true, get: () => sidebar, set(value) {
    sidebar = value;
    if (!value || typeof value.gwRequest !== 'function') return;
    const real = value.gwRequest.bind(value);
    value.gwRequest = (method, params, timeout) => String(method).startsWith('pinkie.shell.')
      ? shell(method, params) : real(method, params, timeout);
  }});
};

const record = (name, file) => {
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
const shoot = async (page, name, sel) => {
  const file = `${name}.png`;
  const target = sel ? page.locator(sel).first() : null;
  if (target && await target.count()) await target.screenshot({path: path.join(out, file)});
  else await page.screenshot({path: path.join(out, file)});
  record(name, file);
};
const COMPOSER = '.agent-chat__input';
const INPUT = '.agent-chat__composer-combobox textarea';
const type = async (page, text) => {
  const input = page.locator(INPUT).first();
  await input.click();
  await input.fill('');
  await input.pressSequentially(text);
};
const snapshot = (page, command) => page.evaluate((cmd) => {
  const thread = document.querySelector('.chat-thread');
  const users = [...(thread?.querySelectorAll('.chat-group.user') || [])].map((n) => n.textContent.trim());
  return {
    localBubble: users.some((t) => t.includes('!' + cmd)),
    dollar: (thread?.textContent || '').includes('$ ' + cmd),
    draft: document.querySelector('.agent-chat__composer-combobox textarea')?.value ?? null,
    userGroups: users.length,
    stopVisible: [...document.querySelectorAll('button')].some((b) => /停止|stop/i.test(b.getAttribute('aria-label') || b.title || '') && b.offsetParent),
    typing: Boolean(document.querySelector('.chat-reading-indicator, .chat-group.assistant .typing, .chat-typing')),
    tag: Boolean(document.querySelector('.laolao-composer-bang__tag')),
    // 状态对象挂在 openclaw-chat-pane 的 .state 上（chat-page connectedCallback：this.state=U_(...)）。
    pane: [...document.querySelectorAll('openclaw-chat-pane')].map((el) => el.state).filter(Boolean)
      .map((st) => ({chatStream: st.chatStream ?? null, chatRunId: st.chatRunId ?? null, chatSending: Boolean(st.chatSending)})),
  };
}, command);
// 原生 chat.send 回包：ok → chatStream=null + 刷新历史；started/accepted/in_flight → chatStream='' 留下进行中状态。
const settled = (s) => s.pane.length > 0 && s.pane.every((p) => p.chatStream === null && p.chatRunId === null && !p.chatSending);

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of themes) {
    for (const width of widths) {
      const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'long-conversation', theme, {initScript});
      const cell = {theme, width, counter, pageErrors};
      const base = `i6-${counter ? 'counter-' : ''}${theme}-${width}`;
      try {
        await page.setViewportSize({width, height: HEIGHT});
        await page.waitForFunction(() => typeof window.Pinkie?.composerBang?.intercept === 'function', null, {timeout: 10_000});
        if (counter) await page.evaluate(() => {
          const orig = window.Pinkie.composerBang.intercept;
          window.Pinkie.composerBang.intercept = (k, req, reply) => orig(k, req, (ok, body) => reply(ok, ok ? {status: 'started', runId: null} : body));
        });
        await page.waitForTimeout(300);

        await type(page, '!ls -la');
        await page.waitForSelector('.laolao-composer-bang__tag', {timeout: 5_000});
        await shoot(page, `${base}-tag`, COMPOSER);

        const before = await snapshot(page, 'ls -la');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        cell.early = await snapshot(page, 'ls -la');
        await page.waitForTimeout(1300);
        cell.sent = await snapshot(page, 'ls -la');
        cell.sent.userGroupsBefore = before.userGroups;
        cell.replaced = !cell.sent.localBubble && cell.sent.dollar && cell.sent.draft === '' && !cell.sent.stopVisible
          && settled(cell.early) && settled(cell.sent);
        await shoot(page, `${base}-sent`);

        await type(page, '!rm -rf build');
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('alertdialog', {name: '跑这条命令？'});
        await dialog.waitFor({timeout: 5_000});
        await shoot(page, `${base}-confirm`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        cell.afterCancel = await snapshot(page, 'rm -rf build');

        await type(page, '!curl x');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.laolao-composer-bang__hint', {timeout: 5_000});
        cell.hint = await page.locator('.laolao-composer-bang__hint').first().textContent();
        cell.afterRefuse = await snapshot(page, 'curl x');
        await shoot(page, `${base}-hint`, COMPOSER);

        const link = 'a.sidebar-footer-icon[aria-label="设置"]';
        const drawer = await page.evaluate(() => Math.round(document.querySelector('aside.sidebar')?.getBoundingClientRect().left ?? -9999) < 0);
        if (drawer) {
          await page.click('button[aria-label="展开侧边栏"]');
          await page.waitForFunction(() => document.querySelector('aside.sidebar')?.getBoundingClientRect().left >= 0, null, {timeout: 5_000});
        }
        await page.click(link);
        await page.waitForSelector('#laolao-user-settings .pk-shell-card', {timeout: 10_000});
        await page.locator('#laolao-user-settings .pk-shell-card').scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shoot(page, `${base}-settings`, '#laolao-user-settings .pk-shell-card');
        cell.switchChecked = await page.locator('.pk-shell-card [role="switch"]').getAttribute('aria-checked');
        cell.calls = await page.evaluate(() => window.__i6Calls.filter((c) => c.method === 'pinkie.shell.run').map((c) => c.params));
      } catch (error) {
        cell.error = error.message;
        try { await shoot(page, `${base}-error`); } catch {}
      } finally {
        report.push(cell);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) console.log(`pr-shots: ${r.theme} ${r.width}${r.counter ? ' (counter)' : ''} replaced=${r.replaced}${r.error ? ' 出错：' + r.error : ''}`);
