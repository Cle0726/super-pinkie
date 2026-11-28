#!/usr/bin/env node
// L95（#96，接手 #102 Metre「以后」S 级 M3 置顶消息）的 PR 截图脚本，走 .github/workflows/pr-shots.yml 在 CI 上拍，本机不开浏览器。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/L95-metre-pins.mjs --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI + Metre（tests/visual/lib/real-harness.mjs 的 metre-board 场景，关掉总谱），聊天记录用夹具网关自带的两条短记录
// （一条用户、一条 Metre），不另造数据。每格（1440 / 820 × 日 / 夜）依次：
//   rest       初始：没有置顶，页脚「置顶」键不悬停时看不见；
//   hover      指针停在 Metre 那条上：页脚出现「置顶」；
//   pinned     点「置顶」：键变「已置顶」，对话流最前面出现「已置顶 1 条」；
//   expanded   用户那条也置顶，展开折叠条：列表两条（谁说的 · 摘要 · 取消置顶）；
//   focus-x    键盘焦点在第一条的「取消置顶」上（focus-visible 焦点环）；
//   jump       点列表第一条：跳过去并亮一下；
//   after-unpin 键盘 Enter 取消第一条：计数减一，焦点留在条里（不掉到 body）。
// 每步量折叠条 / 输入框位置（不重叠）、键的文字和 aria、焦点落点；出错照实记在 report.json，不让一格带崩整轮。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = await import(pathToFileURL(path.join(root, 'tests/visual/lib/real-harness.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const HEIGHT = 900;
const git = (...a) => { try { return execFileSync('git', ['-C', root, ...a], {encoding: 'utf8'}).trim(); } catch { return null; } };
const head = {head: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain'))};
console.log(`pr-shots: 被测头 ${JSON.stringify(head)}`);

const lines = [], report = [];
const shoot = async (page, name) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...head});
};

// 量一次：折叠条、输入框、各「置顶」键、焦点落点。
const MEASURE = () => {
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const hit = (a, b) => Boolean(a && b && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]);
  const bar = document.querySelector('.pk-metre-pins');
  const composer = document.querySelector('.agent-chat__input, .agent-chat__composer-combobox');
  const thread = document.querySelector('.chat-thread');
  const a = document.activeElement;
  const pins = [...document.querySelectorAll('.chat-thread .chat-group')].filter((g) => !g.closest('.pinkie-session-cards')).map((g) => {
    const b = g.querySelector('.pk-metre-pin');
    return {role: g.classList.contains('user') ? 'user' : 'assistant', has: Boolean(b), text: b?.textContent || null, pressed: b?.getAttribute('aria-pressed') ?? null,
      opacity: b ? getComputedStyle(b).opacity : null, color: b ? getComputedStyle(b).color : null, box: box(b)};
  });
  const x = bar?.querySelector('.pk-metre-pins__x');
  return {
    mode: document.documentElement.getAttribute('data-laolao-mode'),
    bar: bar ? {box: box(bar), position: getComputedStyle(bar).position, firstChild: thread?.firstElementChild === bar, toggle: bar.querySelector('.pk-metre-pins__toggle')?.textContent || null,
      expanded: bar.querySelector('.pk-metre-pins__toggle')?.getAttribute('aria-expanded') ?? null, items: bar.querySelectorAll('.pk-metre-pins__item').length,
      xBorder: x ? getComputedStyle(x).borderTopColor : null} : null,
    composer: box(composer), barOverComposer: hit(box(bar), box(composer)),
    pins,
    focus: a ? {tag: a.tagName, cls: a.className || '', inBar: Boolean(bar && bar.contains(a)), focusVisible: a.matches?.(':focus-visible') ?? null,
      outline: a === document.body ? null : `${getComputedStyle(a).outlineStyle} ${getComputedStyle(a).outlineWidth} ${getComputedStyle(a).outlineColor}`} : null,
    flash: document.querySelectorAll('.pk-metre-pin-flash').length,
    stored: Object.keys(localStorage).filter((k) => k.startsWith('pinkie.metre.pins:')).map((k) => [k, JSON.parse(localStorage.getItem(k) || '[]').length]),
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
  };
};

const GROUP = (role) => `.chat-thread .chat-group.${role}:not(.pinkie-session-cards .chat-group)`;

async function pinGroup(page, role) {
  const g = page.locator(GROUP(role)).first();
  await g.scrollIntoViewIfNeeded();
  await g.hover();
  await page.waitForTimeout(200);
  await g.locator('.pk-metre-pin').click({timeout: 5_000});
  await page.waitForTimeout(250);
}

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
      const base = `L95-${theme}-${width}`;
      const entry = {theme, width, steps: {}, pageErrors};
      const step = async (name, run) => {
        try { await run(); entry.steps[name] = await page.evaluate(MEASURE); await shoot(page, `${base}-${name}`); }
        catch (error) { entry.steps[name] = {error: error.message.split('\n')[0]}; }
      };
      try {
        await page.setViewportSize({width, height: HEIGHT});
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5_000}).catch(() => {});
        await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pinkie.metre.pins:')) localStorage.removeItem(k); window.Pinkie?.metre?.pins?.paint?.(); });
        await page.waitForSelector('.chat-thread .chat-group .pk-metre-pin', {state: 'attached', timeout: 10_000});
        await page.mouse.move(width - 4, HEIGHT - 4);
        await page.waitForTimeout(300);

        await step('rest', async () => {});
        await step('hover', async () => { const g = page.locator(GROUP('assistant')).first(); await g.scrollIntoViewIfNeeded(); await g.hover(); await page.waitForTimeout(250); });
        await step('pinned', async () => { await pinGroup(page, 'assistant'); await page.mouse.move(width - 4, HEIGHT - 4); await page.waitForTimeout(250); });
        await step('expanded', async () => {
          await pinGroup(page, 'user');
          await page.locator('.pk-metre-pins__toggle').click({timeout: 5_000});
          await page.mouse.move(width - 4, HEIGHT - 4);
          await page.waitForTimeout(250);
        });
        await step('focus-x', async () => {
          await page.keyboard.press('Shift');   // 最近一次交互是键盘：随后的程序聚焦按 :focus-visible 算
          await page.locator('.pk-metre-pins__x').first().focus();
          await page.waitForTimeout(200);
        });
        await step('jump', async () => {
          await page.locator('.pk-metre-pins__go').first().click({timeout: 5_000});
          await page.waitForTimeout(120);
        });
        await step('after-unpin', async () => {
          await page.keyboard.press('Shift');
          await page.locator('.pk-metre-pins__x').first().focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
        });
      } catch (error) {
        entry.error = error.message.split('\n')[0];
      } finally {
        report.push(entry);
        await context.close();
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({head, engine, report}, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) {
  if (r.error) console.log(`pr-shots: ${r.theme} ${r.width} 出错：${r.error}`);
  for (const [k, v] of Object.entries(r.steps)) {
    if (v.error) console.log(`pr-shots: ${r.theme} ${r.width} ${k} 出错：${v.error}`);
    else console.log(`pr-shots: ${r.theme} ${r.width} ${k} bar=${JSON.stringify(v.bar && [v.bar.toggle, v.bar.expanded, v.bar.items, v.bar.firstChild])} overComposer=${v.barOverComposer} focus=${v.focus?.tag}.${String(v.focus?.cls).split(' ')[0]} flash=${v.flash} errors=${r.pageErrors.length}`);
  }
}
