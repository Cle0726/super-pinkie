#!/usr/bin/env node
// B85（backlog）Metre 新页面高 DPI 走查，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 协调者 11-27 10:01：本机真 WebView2 窗口因内存起不来，改走 CI，windows runner 上 deviceScaleFactor 1.25 / 1.5。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre × 1440 × 日夜 × 1.25 / 1.5，每格走这几页（11-27 合的）：
//   board         Metre 首页（总谱）
//   usage-entry   #428 侧栏「用量」入口        usage-page   #428 点进去的用量页
//   plan-card     #432 计划卡                  tasks        #434 后台任务页（失败那行点开「看结果」）
//   keymap        #441 快捷键一览（?）         engine-menu  #134 引擎菜单（滚到底）
// 计划 / 后台任务 / 工作台文件 / 用量页（sessions.usage + usage.cost，协调者 11-27 10:18 选 1）用假数据，在页里接住（照 L24 / L36）。report.json 每张量（同 b36-hidpi.mjs，另加 scroll）：
//   cut     文字被截但没有省略号        ellip   带省略号被截的（对照用）
//   hair    缩放后不足 1 设备像素的边框 / 盒子
//   scroll  只多出 1–2px 就出滚动条的元素（缩放取整造成的假滚动条）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const onlyAt = args.indexOf('--only');  // 本机抽查用，比如 --only usage-page；CI 不带，全拍
const ONLY = onlyAt >= 0 && args[onlyAt + 1] ? args[onlyAt + 1].split(',') : null;
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const SCALES = [1.25, 1.5];
const WIDTH = 1440, HEIGHT = 900;
const NAMES = ['README.md', 'package.json', 'src/app.js'];

const initScript = new Function(`
const NAMES = ${JSON.stringify(NAMES)};
const rel = (p) => { const s = String(p || ''); return s.startsWith('/proj/') ? s.slice(6) : s === '/proj' ? '' : s; };
const T = Date.now();
const PLAN = {title: '整理发布前检查', explanation: '只改 Metre 的配色，其他模式不动。', items: [
  {id: 'a', text: '读一遍改动清单', status: 'completed'}, {id: 'b', text: '跑相关单测', status: 'completed'},
  {id: 'c', text: '核对日夜对比度', status: 'in_progress'}, {id: 'd', text: '补截图', status: 'pending'}, {id: 'e', text: '写 PR 说明', status: 'pending'}]};
const WORK = (k) => ({sessionKey: k, now: T,
  background: [
    {id: 'bg-run', execId: 'e2', command: 'npm run build -- --watch', state: 'running', startedAt: T - 65000, endedAt: 0, woke: false},
    {id: 'bg-done', execId: 'e1', command: 'npm test -- --reporter=dot tests/very/long/path/that/should/wrap/instead/of/overflowing.test.mjs', state: 'done', startedAt: T - 190000, endedAt: T - 130000, woke: true}],
  reasoning: {phase: 'idle', jobs: [{id: 'j1', label: '独立解答', model: 'qa/gpt-5', state: 'failed', summary: '超时：8 分钟没有交回', startedAt: T - 600000, endedAt: T - 120000, hasOutput: true}]},
  tier: {active: true, children: [{id: 'c1', roleLabel: '查资料', model: 'qa/selected', state: 'running', summary: '在翻 docs/ARCHITECTURE.md 和 PLAN', startedAt: T - 12000, endedAt: 0, hasOutput: true}]}});
const DAY = 864e5;
const z2 = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + z2(d.getMonth() + 1) + '-' + z2(d.getDate()); };
const dayMs = (s) => { const a = String(s || '').split('-').map(Number); return a.length === 3 && a.every((n) => n > 0) ? new Date(a[0], a[1] - 1, a[2], 12).getTime() : 0; };
const SPECS = [
  {key: 'agent:metre:main', label: '新会话', agentId: 'metre', channel: 'webchat', provider: 'google', model: 'gemini-3.6-flash', w: 1.4, rate: 0.5, tools: [['read', 0.4], ['exec', 0.35], ['edit', 0.25]]},
  {key: 'agent:metre:visual-baseline', label: '视觉基线与热点核对', agentId: 'metre', channel: 'webchat', provider: 'anthropic', model: 'claude-sonnet-5-5', w: 1, rate: 4, tools: [['read', 0.5], ['browser', 0.3], ['exec', 0.2]]},
  {key: 'agent:metre:layout-regression', label: '工作台布局回归记录', agentId: 'metre', channel: 'webchat', provider: 'openai', model: 'gpt-5', w: 0.7, rate: 2.5, tools: [['edit', 0.5], ['read', 0.3], ['web_search', 0.2]]},
  {key: 'agent:main:cron:weather', label: 'weather', agentId: 'main', channel: 'cron', provider: 'google', model: 'gemini-3.6-flash', w: 0.25, rate: 0.5, tools: [['web_fetch', 1]]}];
const num = (o) => Object.keys(o).filter((k) => typeof o[k] === 'number');
const add = (a, b) => { for (const k of num(a)) a[k] += b[k] || 0; return a; };
const zeroT = () => ({input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 0});
const zeroM = () => ({total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0});
const mkT = (k, s) => {
  const input = Math.round(18000 * s.w * k), output = Math.round(4200 * s.w * k), cacheRead = Math.round(52000 * s.w * k), cacheWrite = Math.round(6000 * s.w * k);
  const c = {inputCost: input * 3e-7 * s.rate, outputCost: output * 2.5e-6 * s.rate, cacheReadCost: cacheRead * 3e-8 * s.rate, cacheWriteCost: cacheWrite * 4e-7 * s.rate};
  return {input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, totalCost: c.inputCost + c.outputCost + c.cacheReadCost + c.cacheWriteCost, ...c, missingCostEntries: 0};
};
const lat = (count, si, di) => ({count, avgMs: 2200 + si * 700 + di * 90, p95Ms: 7400 + si * 900, minMs: 520, maxMs: 12800 + si * 1500});
const USAGE = (p) => {
  const end = dayMs(p.endDate) || T, start = dayMs(p.startDate) || end;
  const n = Math.max(7, Math.min(30, Math.round((end - start) / DAY) + 1));
  const days = []; for (let i = n - 1; i >= 0; i--) days.push(ymd(end - i * DAY));
  const totals = zeroT(), messages = zeroM(), byDay = new Map(), toolMap = new Map(), byModel = new Map(), byProvider = new Map(), byAgent = new Map(), byChannel = new Map(), modelDaily = [];
  const sessions = SPECS.filter((s) => !p.key || s.key === p.key).map((s, si) => {
    const usage = zeroT(), mc = zeroM(), dailyBreakdown = [], dailyMessageCounts = [], dailyModelUsage = [], dailyLatency = [], activityDates = [];
    days.forEach((date, di) => {
      if ((di + si) % 4 === 3) return;
      const k = 1 + ((di * 7 + si * 3) % 5) / 3, t = mkT(k, s);
      const user = Math.max(1, Math.round(6 * s.w * k)), toolCalls = Math.round(9 * s.w * k), errors = (di + si) % 5 === 0 ? 1 : 0;
      const dm = {date, total: user * 2 + toolCalls * 2, user, assistant: user, toolCalls, toolResults: toolCalls, errors};
      const mu = {date, provider: s.provider, model: s.model, tokens: t.totalTokens, cost: t.totalCost, count: user};
      add(usage, t); add(mc, dm); activityDates.push(date);
      dailyBreakdown.push({date, tokens: t.totalTokens, cost: t.totalCost}); dailyMessageCounts.push(dm); dailyModelUsage.push(mu); modelDaily.push({...mu}); dailyLatency.push({date, ...lat(user, si, di)});
      const d = byDay.get(date) || {row: {date, ...zeroT()}, agg: {date, tokens: 0, cost: 0, messages: 0, toolCalls: 0, errors: 0}};
      add(d.row, t); add(d.agg, {tokens: t.totalTokens, cost: t.totalCost, messages: dm.total, toolCalls, errors}); byDay.set(date, d);
    });
    const tools = s.tools.map(([name, share]) => ({name, count: Math.max(1, Math.round(mc.toolCalls * share))}));
    const first = dayMs(activityDates[0]) - 3 * 3600e3, last = dayMs(activityDates[activityDates.length - 1]) + 2 * 3600e3;
    add(totals, usage); add(messages, mc);
    for (const x of tools) toolMap.set(x.name, (toolMap.get(x.name) || 0) + x.count);
    const mk = s.provider + '::' + s.model, bm = byModel.get(mk) || {provider: s.provider, model: s.model, count: 0, totals: zeroT()};
    bm.count += mc.user; add(bm.totals, usage); byModel.set(mk, bm);
    const bp = byProvider.get(s.provider) || {provider: s.provider, count: 0, totals: zeroT()};
    bp.count += mc.user; add(bp.totals, usage); byProvider.set(s.provider, bp);
    byAgent.set(s.agentId, add(byAgent.get(s.agentId) || zeroT(), usage));
    byChannel.set(s.channel, add(byChannel.get(s.channel) || zeroT(), usage));
    return {key: s.key, label: s.label, sessionId: 'b85-' + si, updatedAt: last, agentId: s.agentId, channel: s.channel, chatType: 'direct', model: s.model, modelProvider: s.provider,
      usage: {...usage, messageCounts: mc, toolUsage: {totalCalls: tools.reduce((a, x) => a + x.count, 0), uniqueTools: tools.length, tools},
        modelUsage: [{provider: s.provider, model: s.model, count: mc.user, totals: {...usage}}], latency: lat(mc.assistant, si, 0), dailyLatency,
        dailyBreakdown, dailyMessageCounts, dailyModelUsage, activityDates, firstActivity: first, lastActivity: last, durationMs: activityDates.length * 42 * 60000}};
  });
  const desc = (a, b) => b.totals.totalCost - a.totals.totalCost, dates = [...byDay.keys()].sort();
  const aggregates = {messages, tools: {totalCalls: [...toolMap.values()].reduce((a, b) => a + b, 0), uniqueTools: toolMap.size, tools: [...toolMap].map(([name, count]) => ({name, count})).sort((a, b) => b.count - a.count)},
    byModel: [...byModel.values()].sort(desc), byProvider: [...byProvider.values()].sort(desc),
    byAgent: [...byAgent].map(([agentId, t]) => ({agentId, totals: t})).sort(desc), byChannel: [...byChannel].map(([channel, t]) => ({channel, totals: t})).sort(desc),
    latency: lat(messages.assistant, 0, 0), dailyLatency: dates.map((date, di) => ({date, ...lat(byDay.get(date).agg.messages >> 1, 0, di)})),
    modelDaily: modelDaily.sort((a, b) => a.date.localeCompare(b.date) || b.cost - a.cost), daily: dates.map((d) => byDay.get(d).agg)};
  return {result: {updatedAt: Date.now(), startDate: days[0], endDate: days[n - 1], sessions, totals, aggregates},
    cost: {updatedAt: Date.now(), days: n, daily: dates.map((d) => byDay.get(d).row), totals: {...totals}}};
};
const answers = {
  'pinkie.plan.get': () => ({plan: {...PLAN, updatedAt: Date.now()}}),
  'pinkie.work.status': (p) => WORK(p.sessionKey),
  'pinkie.work.detail': (p) => ({found: true, output: '（截图用的假结果）' + p.kind + ' ' + p.id, sessionKey: p.sessionKey}),
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => { const d = rel(p.path); const kids = new Map();
    for (const n of NAMES) { if (d && !n.startsWith(d + '/')) continue; const rest = d ? n.slice(d.length + 1) : n; const head = rest.split('/')[0];
      kids.set(head, {name: head, path: d ? d + '/' + head : head, kind: rest.includes('/') ? 'dir' : 'file'}); }
    return {entries: [...kids.values()]}; },
  'pinkie.fs.read': (p) => { const c = ['# proj', '', 'npm run dev', ''].join(String.fromCharCode(10)); return {kind: 'text', content: c, path: p.path, readOnly: false, size: c.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', ahead: 0, behind: 0, changes: []}),
  'pinkie.fs.gitShow': () => ({content: '# proj' + String.fromCharCode(10), exists: true}),
  // 用量页：sessions.usage + usage.cost 按请求的日期范围给四个会话 × 至少七天；usage.status 不接（供应商额度区块照旧空着）。
  'sessions.usage': (p) => USAGE(p).result,
  'usage.cost': (p) => USAGE(p).cost,
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b85) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b85Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b85 = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const measure = (page) => page.evaluate(() => {
  const dpr = window.devicePixelRatio || 1;
  const visible = (el, r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const cut = [], ellip = [], hair = [], scroll = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const cs = getComputedStyle(el);
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const srOnly = cs.clip !== 'auto' || (r.width <= 1 && r.height <= 1);  // visually-hidden labels are cut on purpose
    if (text && !srOnly && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') {
      const row = {el: name(el), text: text.slice(0, 40), over: el.scrollWidth - el.clientWidth, x: Math.round(r.left), y: Math.round(r.top)};
      (cs.textOverflow === 'ellipsis' ? ellip : cut).push(row);
    }
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
      const w = parseFloat(cs['border' + side + 'Width']);
      if (w > 0 && w * dpr < 1 && cs['border' + side + 'Style'] !== 'none') hair.push({el: name(el), side, css: w, device: +(w * dpr).toFixed(2)});
    }
    if (!el.closest('svg') && ((r.height > 0 && r.height * dpr < 1) || (r.width > 0 && r.width * dpr < 1))) hair.push({el: name(el), side: 'box', css: +Math.min(r.width, r.height).toFixed(2), device: +(Math.min(r.width, r.height) * dpr).toFixed(2)});
    const dy = el.scrollHeight - el.clientHeight, dx = el.scrollWidth - el.clientWidth;
    if ((/(auto|scroll)/.test(cs.overflowY) && dy > 0 && dy <= 2) || (/(auto|scroll)/.test(cs.overflowX) && dx > 0 && dx <= 2)) scroll.push({el: name(el), dx, dy});
  }
  return {dpr, mode: document.documentElement.getAttribute('data-laolao-mode') || '', night: document.documentElement.hasAttribute('data-pinkie-night'),
    cutCount: cut.length, cut: cut.slice(0, 30), ellipCount: ellip.length, ellip: ellip.slice(0, 15), hairCount: hair.length, hair: hair.slice(0, 20), scrollCount: scroll.length, scroll: scroll.slice(0, 15)};
});

const waitFn = (page, fn, arg, ms = 15_000) => page.waitForFunction(fn, arg, {timeout: ms}).then(() => true, () => false);
const closeBoard = (page) => page.evaluate(() => window.__pinkieMetreBoard?.close?.()).catch(() => {});
const clickSel = async (page, sel) => { const el = await page.$(sel); if (!el) return false; await el.click({timeout: 5000}).catch(() => {}); return true; };

const STEPS = {
  board: async () => ({}),
  'usage-entry': async (page) => {
    await closeBoard(page);
    const onScreen = () => { const e = document.querySelector('aside.sidebar .pk-metre-nav--usage'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0; };
    if (!(await page.evaluate(onScreen))) await clickSel(page, 'button[aria-label="展开侧边栏"]');
    return {entry: await waitFn(page, onScreen, null, 5000)};
  },
  'usage-page': async (page) => {
    await STEPS['usage-entry'](page);
    const clicked = await clickSel(page, 'aside.sidebar .pk-metre-nav--usage');
    const shown = await waitFn(page, () => Boolean(document.querySelector('openclaw-usage-page')));
    const loaded = await waitFn(page, () => { const el = document.querySelector('openclaw-usage-page'); return Boolean(el && !el.usageLoading && el.usageResult?.sessions?.length && el.usageCostSummary?.daily?.length); });
    return {clicked, page: shown, loaded, sessions: await page.evaluate(() => document.querySelector('openclaw-usage-page')?.usageResult?.sessions?.length ?? 0)};
  },
  'plan-card': async (page) => {
    await closeBoard(page);
    await page.evaluate(() => window.__pinkiePlan?.refresh?.()).catch(() => {});
    const shown = await waitFn(page, () => Boolean(document.querySelector('.pk-plan .pk-plan__item')));
    await page.evaluate(() => document.querySelector('.pk-plan')?.scrollIntoView({block: 'center'})).catch(() => {});
    return {shown};
  },
  tasks: async (page) => {
    await closeBoard(page);
    await page.evaluate(() => window.__pinkieWorkbench?.show?.()).catch(() => {});
    await page.evaluate(() => window.__pinkieWorkbench?.open?.('README.md', {pinned: true})).catch(() => {});
    await waitFn(page, () => Boolean(document.querySelector('.pk-wb-tabs__actions .pk-mtask__entry')));
    await page.evaluate(() => window.Pinkie?.metreTasks?.open?.()).catch(() => {});
    const rows = await waitFn(page, () => document.querySelectorAll('.pk-mtask__row').length >= 4);
    await page.evaluate(() => [...document.querySelectorAll('.pk-mtask__row')].find((r) => r.dataset.kind === 'job')?.querySelector('.pk-mtask__more')?.click()).catch(() => {});
    return {rows, detail: await waitFn(page, () => /截图用的假结果/.test(document.querySelector('.pk-mtask__detail')?.textContent || ''), null, 8000)};
  },
  keymap: async (page) => {
    await closeBoard(page);
    await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
    await page.keyboard.press('Shift+Slash');
    let opened = await waitFn(page, () => Boolean(document.querySelector('.pinkie-shortcuts')), null, 5000);
    if (!opened) {
      await page.evaluate(() => window.PinkieArtifacts?.openShortcuts?.()).catch(() => {});
      opened = (await waitFn(page, () => Boolean(document.querySelector('.pinkie-shortcuts')), null, 5000)) ? 'via-api' : false;
    }
    return {opened};
  },
  'engine-menu': async (page) => {
    await closeBoard(page);
    const clicked = await clickSel(page, '.agent-chat__composer-controls > .pk-eng-chip');
    const menu = await waitFn(page, () => Boolean(document.querySelector('.pk-eng-menu .pk-eng-menu__item')));
    await page.evaluate(() => { const b = document.querySelector('.pk-eng-menu .pk-eng-menu__body'); if (b) b.scrollTop = b.scrollHeight; }).catch(() => {});
    return {clicked, menu, levels: await page.evaluate(() => document.querySelectorAll('.pk-eng-menu .pk-eng-menu__levels').length)};
  },
};

async function cell(step, theme, scale) {
  const tag = `${step}-${theme}-x${String(scale).replace('.', '')}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript, deviceScaleFactor: scale});
  try {
    await page.setViewportSize({width: WIDTH, height: HEIGHT});
    await page.waitForTimeout(800);
    let prepared = null, prepareError = null;
    try { prepared = await STEPS[step](page); } catch (e) { prepareError = String(e?.message || e).slice(0, 300); }
    await page.waitForTimeout(700);
    const m = await measure(page);
    const file = `b85-${tag}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name: `b85-${tag}`, file, os: process.platform, browser: engine || 'chromium', width: WIDTH, height: HEIGHT, deviceScaleFactor: scale,
      bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), cut: m.cutCount, hair: m.hairCount, scroll: m.scrollCount});
    report.push({tag, step, theme, scale, prepared, prepareError, ...m, pageErrors});
    console.log(JSON.stringify({tag, dpr: m.dpr, mode: m.mode, cut: m.cutCount, hair: m.hairCount, scroll: m.scrollCount, prepared, prepareError}));
  } finally {
    await context.close();
  }
}

try {
  for (const scale of SCALES) for (const theme of ['day', 'night']) for (const step of Object.keys(STEPS).filter((s) => !ONLY || ONLY.includes(s))) await cell(step, theme, scale);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
