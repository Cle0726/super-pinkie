#!/usr/bin/env node
// R2 每个聊天会话一个终端（briefs/program-1120/设计-R2.md）的 PR 截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 页面：真的 laolao-workbench.js + laolao-workbench-term.js，网关打桩，终端组件换成不画字的假组件（不连网关、不碰用户会话）。
// 1440 / 820 × 日 / 夜，每格两张：
//   title   会话 A 的终端面板：「本会话终端 · <文件夹名>」+「打开终端」
//   switch  A 开过终端后切到同文件夹的会话 B：B 没有自己的终端，面板又回到「打开终端」
// report.json / shots.jsonl 另记标题、按钮文字对所在底的对比度，按钮是否出卡片 / 面板（重叠），文字是否被截断。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const inj = rel => fileURLToPath(new URL('../../ui/injections/' + rel, import.meta.url));
const read = rel => fs.readFileSync(inj(rel), 'utf8');
const ORIGIN = 'http://127.0.0.1:30148';
const ROOT = '/work/my proj';
const A = 'agent:project:a', B = 'agent:project:b';
const HEIGHT = 800;
const TYPES = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', ttf: 'font/ttf', woff2: 'font/woff2', svg: 'image/svg+xml', png: 'image/png'};
// 日 / 夜只给工作台取色用的几个变量（真页面由应用主题给）。
const THEME = {
  day: '--bg:#fbf6f8;--bg-elevated:#fff8fb;--text:#2a2130;--muted:#6f6070;--accent:#d6336c;--cle-accent:#1c6fd1;--border:#e8dde3',
  night: '--bg:#18121b;--bg-elevated:#2a2030;--text:#efe5ea;--muted:#a898a3;--accent:#ff7aa2;--cle-accent:#62b4ff;--border:#3a2f3f',
};
const page = theme => `<!doctype html><html data-laolao-mode="project"${theme === 'night' ? ' data-pinkie-night' : ''} style="${THEME[theme]}"><head>
<link rel="stylesheet" href="/laolao-workbench.css"><style>body{margin:0;background:var(--bg);color:var(--text);font-family:sans-serif}</style></head><body>
<main class="content content--chat" style="position:fixed;inset:0;overflow:auto"><openclaw-chat-pane active><div class="chat-thread"><p style="padding:16px">碧琪对话</p></div></openclaw-chat-pane></main></body></html>`;

const measure = p => p.evaluate(() => {
  const P = c => { const m = c.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0]; return {r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1}; };
  const L = ({r, g, b}) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
  const bgOf = e => {
    const stack = [];
    for (let x = e; x; x = x.parentElement) { const c = P(getComputedStyle(x).backgroundColor); if (c.a > 0) stack.push(c); if (c.a >= 1) break; }
    let base = {r: 255, g: 255, b: 255, a: 1};
    for (const c of stack.reverse()) base = over(c, base);
    return base;
  };
  const box = e => { const r = e.getBoundingClientRect(); return {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom)}; };
  const one = sel => {
    const e = document.querySelector(sel);
    if (!e) return {sel, missing: true};
    const s = getComputedStyle(e), bg = bgOf(e), fg = over(P(s.color), bg), a = L(fg), b = L(bg);
    return {sel, text: (e.textContent || '').trim().slice(0, 40), color: s.color, fontSize: s.fontSize,
      bg: `rgb(${[bg.r, bg.g, bg.b].map(Math.round).join(',')})`, ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
      truncated: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1, ...box(e)};
  };
  const inside = (inner, outer) => { const i = document.querySelector(inner), o = document.querySelector(outer); if (!i || !o) return null; const a = i.getBoundingClientRect(), b = o.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.top >= b.top - 0.5 && a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5; };
  return {
    title: one('.pk-wb-empty--terminal > p'),
    button: one('.pk-wb-empty--terminal .pk-wb-btn'),
    tab: one('.pk-wb-panel__tab.is-active'),
    buttonInCard: inside('.pk-wb-empty--terminal .pk-wb-btn', '.pk-wb-empty--terminal'),
    cardInPanel: inside('.pk-wb-empty--terminal', '.pk-wb-panel__body'),
  };
});

async function open(browser, theme, width) {
  const p = await browser.newPage({viewport: {width, height: HEIGHT}});
  p.setDefaultTimeout(10_000);
  await p.route(`${ORIGIN}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/chat') return route.fulfill({contentType: 'text/html; charset=utf-8', body: page(theme)});
    const file = inj(url.pathname.slice(1));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status: 404, body: ''});
    return route.fulfill({contentType: TYPES[file.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(file)});
  });
  await p.goto(`${ORIGIN}/chat?session=${encodeURIComponent(A)}`);
  await p.evaluate(root => {
    const live = new Set(); let seq = 0;
    document.documentElement.dataset.openclawTerminalEnabled = 'true';
    window.__laolaoSidebar = {gwRequest: async (method, params = {}) => {
      if (method === 'pinkie.fs.status') return {root, agentId: 'project', name: 'my proj', bound: true, unrestricted: false, terminal: {enabled: true}};
      if (method === 'pinkie.fs.list') return {entries: []};
      if (method === 'pinkie.fs.git') return {repo: false};
      if (method === 'terminal.list') return {sessions: [...live].map(sessionId => ({sessionId}))};
      if (method === 'terminal.open') { const sessionId = 't' + (++seq); live.add(sessionId); return {sessionId, cwd: root, shell: '/bin/zsh'}; }
      if (method === 'terminal.attach') return {buffer: ''};
      return {};
    }};
    // 假终端组件：照原生 restoreSessions 的「接回或新开」，不画字
    customElements.define('openclaw-terminal-panel', class extends HTMLElement {
      connectedCallback() {
        if (this.started) return;
        this.started = true; this.tabs = []; this.booting = true;
        void (async () => {
          const r = await this.client.request('terminal.open', {cols: 80, rows: 24});
          this.tabs.push({id: 'x', gatewaySessionId: r.sessionId, status: 'live'}); this.activeId = 'x'; this.booting = false;
        })();
      }
    });
  }, ROOT);
  for (const f of ['laolao-dom-watch.js', 'laolao-workbench-term.js', 'laolao-workbench.js']) await p.addScriptTag({content: read(f)});
  if (!(await p.evaluate(() => window.__pinkieWorkbench.show()))) throw new Error(`workbench did not come out at ${width}`);
  await p.evaluate(() => window.__pinkieWorkbench.togglePanel('terminal', true));
  await p.locator('.pk-wb-empty--terminal .pk-wb-btn:not([disabled])').waitFor();
  await p.waitForTimeout(300);
  return p;
}

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const browser = await playwright()[engine].launch({headless: true});
const lines = [], report = [];
const record = async (p, name, extra) => {
  const panel = await p.locator('.pk-wb-panel').first().boundingBox().catch(() => null);
  const file = `${name}.png`;
  const buf = await p.screenshot({path: path.join(out, file)});
  const metrics = await measure(p);
  const {width} = p.viewportSize();
  lines.push({name, file, os: process.platform, browser: engine, width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), panel, metrics, ...extra});
  report.push({name, width, ...extra, metrics});
};
try {
  for (const width of [1440, 820]) for (const theme of ['day', 'night']) {
    const p = await open(browser, theme, width);
    try {
      await record(p, `term-title-${width}-${theme}`, {theme, session: 'A'});
      // A 开终端（假组件新开 t1），再切到同文件夹的 B
      await p.locator('.pk-wb-empty--terminal .pk-wb-btn:not([disabled])').click();
      await p.waitForFunction(() => document.querySelector('openclaw-terminal-panel')?.booting === false);
      await p.evaluate(key => { history.pushState(null, '', '/chat?session=' + encodeURIComponent(key)); window.dispatchEvent(new CustomEvent('pinkie:session-selected', {detail: {sessionKey: key}})); }, B);
      await p.waitForFunction(key => window.__pinkieWorkbench.state.key === key && !document.querySelector('openclaw-terminal-panel'), B);
      await p.locator('.pk-wb-empty--terminal .pk-wb-btn:not([disabled])').waitFor();
      await p.waitForTimeout(300);
      await record(p, `term-switch-${width}-${theme}`, {theme, session: 'B'});
    } finally { await p.close(); }
  }
} finally {
  await browser.close();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map(l => JSON.stringify(l) + '\n').join(''));
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
