#!/usr/bin/env node
// B11 全页面走查（碧琪项目 / project 模式）截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），不连网关、不碰用户会话。1440 / 820 × 日 / 夜，每格拍：
//   home-*        首页（home-project 场景：项目模式启动首页）
//   settings-N-*  设置页（settings 场景，项目模式；按设置页滚动容器一屏一屏往下拍，最多 4 屏）
//   library-*     作品库（PinkieArtifacts.open()；pinkie.artifacts.* 在页面里接到四条示例作品）
//   viewer-*      作品查看器（作品库里打开第一条）
//   workbench-*   工作台（__pinkieWorkbench.show()；pinkie.fs.* 接到一个小项目 /proj，打开 README.md）
// report.json 每张图一条，只量当屏、没被别的东西盖住的元素：
//   smallText    小字（WCAG 非大字）文字 / 底对比度 < 4.5（largeText：大字 < 3）
//   border       控件边框对外底 < 3，且控件自身底对外底也 < 3（非控件的装饰边框记 borderDecor）
//   icon         图标（svg / mask 图标 / codicon 字体图标）对底 < 3
//   overlap      两个互不包含的文字 / 控件 / 图标框相交（≥ 较小者 15%），相交处一个盖住另一个
//   truncate     scrollWidth > clientWidth，且没有省略号（text-overflow / line-clamp）、自己和祖先都没有 title
// 底色按祖先 background-color 逐层叠到不透明为止；途中遇到背景图 / backdrop-filter、或一直没叠到不透明，记 bgUncertain。
// 禁用控件（:disabled / aria-disabled / inert）按 WCAG 不计对比度。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const HEIGHT = 900;
const CAP = 40;

// ---- 示例数据：四条作品 + 一个小项目 ----
const T = H.FROZEN_TIME_MS;
const versions = (n) => Array.from({length: n}, (_, i) => ({v: i + 1, ts: T - (n - i) * 3_600_000, size: 2048, runId: '', source: 'tool', snapshot: true}));
const item = (id, kind, title, extra = {}) => ({
  id, kind, title, path: '/proj/' + title, mode: 'project', sessionKey: 'agent:project:dashboard:prev01',
  createdAt: T - 86_400_000, updatedAt: T - 600_000, exists: true, size: 2048, version: 3, total: 3, versions: versions(3), ...extra,
});
const ITEMS = [
  item('a1', 'html', '单词小游戏.html'),
  item('a2', 'image', '封面草图.png', {version: 1, total: 1, versions: versions(1)}),
  item('a3', 'doc', '二〇二七年第一季度产品路线图与里程碑说明（定稿，内部传阅版）.docx'),
  item('a4', 'sheet', '预算.xlsx', {exists: false, sessionKey: 'agent:project:dashboard:gone', updatedAt: T - 40 * 86_400_000}),
];
const HTML = '<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;font:20px system-ui;background:#fff7fb;color:#7a2350">单词小游戏</body>';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FILES = {
  'README.md': '# 单词小游戏\n\n给小学生背单词用的网页小游戏。\n\n## 启动\n\n```\nnpm run dev\n```\n',
  'index.html': '<!doctype html>\n<title>单词小游戏</title>\n<script type="module" src="./src/game.js"></script>\n',
  'src/game.js': "export const words = ['apple', 'banana', 'cherry'];\n",
};

// 页面里：假网关赋 window.WebSocket 时接住它（同 tools/pr-shots/218-r5-open-chip.mjs），
// pinkie.artifacts.* / pinkie.apps.* / pinkie.fs.* 答成上面的示例；其余照旧交给假网关。
const fixture = new Function(`const ITEMS = ${JSON.stringify(ITEMS)};
const FILES = ${JSON.stringify(FILES)};
const HTML = ${JSON.stringify(HTML)};
const PNG = ${JSON.stringify(PNG)};
const rel = (p) => String(p || '').replace(/^\\/proj\\/?/, '').replace(/\\/$/, '');
const byId = (id) => ITEMS.find((x) => x.id === id) || ITEMS[0];
const answers = {
  'pinkie.artifacts.list': () => ({ok: true, items: ITEMS, cursor: null}),
  'pinkie.artifacts.get': (p) => ({ok: true, item: byId(p.id)}),
  'pinkie.artifacts.read': (p) => (byId(p.id).kind === 'image'
    ? {ok: true, v: 1, size: 68, mime: 'image/png', encoding: 'base64', data: PNG}
    : {ok: true, v: 3, size: HTML.length, mime: 'text/html', encoding: 'utf8', data: HTML}),
  'pinkie.apps.forArtifact': () => ({ok: true, app: null}),
  'pinkie.apps.list': () => ({ok: true, apps: []}),
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'project', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => {
    const dir = rel(p.path);
    const seen = new Map();
    for (const f of Object.keys(FILES)) {
      if (dir && !f.startsWith(dir + '/')) continue;
      const rest = dir ? f.slice(dir.length + 1) : f;
      const head = rest.split('/')[0];
      seen.set(head, {name: head, path: (dir ? dir + '/' : '') + head, kind: rest.includes('/') ? 'dir' : 'file'});
    }
    return {entries: [...seen.values()]};
  },
  'pinkie.fs.read': (p) => { const content = FILES[rel(p.path)] || ''; return {kind: 'text', content, path: p.path, readOnly: false, size: content.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', changes: [{path: 'src/game.js', status: 'M'}]}),
  'pinkie.fs.gitShow': (p) => { const c = FILES[rel(p.path)]; return c ? {content: c, exists: true} : {content: '', exists: false}; },
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b11ProjectShots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b11Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b11ProjectShots = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

// ---- 页面里：量当屏的对比度 / 重叠 / 截断 ----
function audit({cap}) {
  const vw = innerWidth, vh = innerHeight;
  const parentOf = (e) => e.parentElement || (e.getRootNode && e.getRootNode() instanceof ShadowRoot ? e.getRootNode().host : null);
  const contains = (a, b) => { for (let x = b; x; x = parentOf(x)) if (x === a) return true; return false; };
  const deepPoint = (x, y) => {
    let t = document.elementFromPoint(x, y);
    while (t && t.shadowRoot) { const n = t.shadowRoot.elementFromPoint(x, y); if (!n || n === t) break; t = n; }
    return t;
  };
  const styles = new Map();
  const cs = (e) => { let s = styles.get(e); if (!s) { s = getComputedStyle(e); styles.set(e, s); } return s; };
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', {willReadFrequently: true});
  const colors = new Map();
  const rgba = (c) => {
    if (!c || c === 'none' || c.startsWith('url(')) return null;
    if (colors.has(c)) return colors.get(c);
    let v = null;
    const m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
    if (m) v = {r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : (m[5] ? +m[4] / 100 : +m[4])};
    else if (c === 'transparent') v = {r: 0, g: 0, b: 0, a: 0};
    else {
      cx.fillStyle = '#010203'; cx.fillStyle = c;
      if (cx.fillStyle !== '#010203') {
        cx.clearRect(0, 0, 1, 1); cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        v = {r: d[0], g: d[1], b: d[2], a: d[3] / 255};
      }
    }
    colors.set(c, v);
    return v;
  };
  const lum = ({r, g, b}) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2); };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const bgMemo = new Map();
  const bgOf = (e) => {
    if (!e) return {c: {r: 255, g: 255, b: 255, a: 1}, uncertain: true, from: null};
    if (bgMemo.has(e)) return bgMemo.get(e);
    const stack = [];
    let uncertain = false, from = null;
    for (let x = e; x; x = parentOf(x)) {
      const s = cs(x);
      if ((s.backgroundImage && s.backgroundImage !== 'none') || (s.backdropFilter && s.backdropFilter !== 'none')) uncertain = true;
      const c = rgba(s.backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a >= 0.999) { from = x; break; }
    }
    if (!from) uncertain = true;
    let base = {r: 255, g: 255, b: 255, a: 1};
    for (const c of stack.reverse()) base = over(c, base);
    const v = {c: base, uncertain, from};
    bgMemo.set(e, v);
    return v;
  };
  const fade = (e, stop) => { let o = 1; for (let x = e; x && x !== stop; x = parentOf(x)) { const v = parseFloat(cs(x).opacity); if (!Number.isNaN(v)) o *= v; } return o; };
  const fgOn = (color, e, bg, extra = 1) => { const f = rgba(color); return f ? over({...f, a: f.a * extra * fade(e, bg.from)}, bg.c) : null; };
  const name1 = (e) => e.localName + (e.id ? '#' + e.id : '') + [...(e.classList || [])].slice(0, 3).map((c) => '.' + c).join('');
  const pathOf = (e) => { const p = []; for (let x = e, i = 0; x && i < 4; x = parentOf(x), i++) { p.unshift(name1(x)); if (x.id) break; } return p.join(' > '); };
  const box = (r) => ({x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)});
  const ownText = (e) => { let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim(); };
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'br', 'option']);
  const CONTROL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=checkbox], [role=switch], [role=radio], [role=menuitem], [role=option], [contenteditable="true"], [contenteditable=""]';
  const off = (e) => { for (let x = e; x; x = parentOf(x)) if (x.matches?.(':disabled, [aria-disabled="true"], [inert]')) return true; return false; };
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return null;
    if (e.checkVisibility && !e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return null;
    const s = cs(e);
    if (s.visibility !== 'visible') return null;
    const x = (Math.max(0, r.left) + Math.min(vw, r.right)) / 2, y = (Math.max(0, r.top) + Math.min(vh, r.bottom)) / 2;
    const top = deepPoint(x, y);
    if (!top || !(top === e || contains(e, top) || (contains(top, e) && s.pointerEvents === 'none'))) return null;
    return r;
  };

  const all = [];
  const walk = (root) => { for (const e of root.querySelectorAll('*')) { if (SKIP.has(e.localName) || e.ownerSVGElement) continue; all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
  walk(document);
  const found = {smallText: [], largeText: [], border: [], borderDecor: [], icon: [], truncate: []};
  const cands = [];
  let visible = 0;
  for (const e of all) {
    const r = shown(e);
    if (!r) continue;
    visible++;
    const s = cs(e);
    const disabled = off(e);
    const text = ownText(e);
    const control = e.matches(CONTROL);
    const isSvg = e.localName === 'svg';
    const isMask = !text && e.childElementCount === 0 && [s.maskImage, s.webkitMaskImage].some((v) => v && v !== 'none');
    const isFont = !text && e.matches('.codicon');

    if (text && !disabled) {
      const bg = bgOf(e), fg = fgOn(s.color, e, bg);
      if (fg) {
        const size = parseFloat(s.fontSize) || 16, weight = parseInt(s.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const k = ratio(fg, bg.c);
        if (k < (large ? 3 : 4.5)) {
          (large ? found.largeText : found.smallText).push({path: pathOf(e), text: text.slice(0, 30), ratio: k, fg: hex(fg), bg: hex(bg.c), color: s.color,
            size, weight, bgUncertain: bg.uncertain || undefined, ...box(r)});
        }
      }
    }
    if ((e.localName === 'input' || e.localName === 'textarea') && !e.value && e.placeholder && !disabled) {
      const bg = bgOf(e), fg = fgOn(getComputedStyle(e, '::placeholder').color, e, bg);
      if (fg) {
        const k = ratio(fg, bg.c);
        if (k < 4.5) found.smallText.push({path: pathOf(e) + '::placeholder', text: e.placeholder.slice(0, 30), ratio: k, fg: hex(fg), bg: hex(bg.c),
          size: parseFloat(s.fontSize) || 16, bgUncertain: bg.uncertain || undefined, ...box(r)});
      }
    }
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((d) => (parseFloat(s['border' + d + 'Width']) || 0) >= 0.5 && !/none|hidden/.test(s['border' + d + 'Style']));
    if (sides.length && !disabled) {
      const bc = rgba(s['border' + sides[0] + 'Color']);
      if (bc && bc.a > 0) {
        const outside = bgOf(parentOf(e)), inside = bgOf(e);
        const rb = ratio(over({...bc, a: bc.a * fade(e, outside.from)}, outside.c), outside.c);
        const rf = ratio(inside.c, outside.c);
        if (Math.max(rb, rf) < 3) {
          (control ? found.border : found.borderDecor).push({path: pathOf(e), text: (e.textContent || e.placeholder || e.getAttribute('aria-label') || '').trim().slice(0, 30),
            ratio: rb, fill: rf, border: s['border' + sides[0] + 'Color'], bg: hex(outside.c), sides: sides.join(''), bgUncertain: outside.uncertain || undefined, ...box(r)});
        }
      }
    }
    if ((isSvg || isMask || isFont) && !disabled && r.width >= 6 && r.height >= 6 && r.width <= 64 && r.height <= 64) {
      let color = s.color, who = e, extra = 1;
      if (isSvg) {
        const shape = e.querySelector('path, circle, rect, line, polyline, polygon, ellipse, use');
        const ss = shape ? getComputedStyle(shape) : s;
        const useStroke = ss.stroke && ss.stroke !== 'none' && !ss.stroke.startsWith('url');
        color = useStroke ? ss.stroke : ss.fill;
        extra = parseFloat(useStroke ? ss.strokeOpacity : ss.fillOpacity);
        if (Number.isNaN(extra)) extra = 1;
        if (shape) who = shape;
      } else if (isMask) color = s.backgroundColor;
      const bg = isMask ? bgOf(parentOf(e)) : bgOf(e);
      const fg = fgOn(color, who, bg, extra);
      if (fg) {
        const k = ratio(fg, bg.c);
        const host = parentOf(e);
        if (k < 3) found.icon.push({path: pathOf(e), label: (e.getAttribute('aria-label') || host?.getAttribute?.('aria-label') || host?.getAttribute?.('title') || '').slice(0, 30),
          ratio: k, fg: hex(fg), bg: hex(bg.c), color, bgUncertain: bg.uncertain || undefined, inControl: Boolean(e.closest?.(CONTROL)) || undefined, ...box(r)});
      }
    }
    if (!/^(input|textarea|select)$/.test(e.localName) && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && !/auto|scroll/.test(s.overflowX)) {
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 300) {
        const ellipsis = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none');
        let titled = false;
        for (let x = e; x && !titled; x = parentOf(x)) titled = Boolean(x.getAttribute?.('title')?.trim());
        if (!ellipsis && !titled) found.truncate.push({path: pathOf(e), text: t.slice(0, 40), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth,
          overflowX: s.overflowX, whiteSpace: s.whiteSpace, ariaLabel: e.getAttribute('aria-label') || undefined, ...box(r)});
      }
    }
    if ((text || control || isSvg || isMask || isFont) && cands.length < 900) cands.push({e, r, text: text || e.getAttribute('aria-label') || ''});
  }

  const overlap = [];
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const A = cands[i], B = cands[j];
      const ix = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      if (ix < 2) continue;
      const iy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (iy < 2) continue;
      if (contains(A.e, B.e) || contains(B.e, A.e)) continue;
      const small = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
      if (ix * iy < 0.15 * small) continue;
      const left = Math.max(A.r.left, B.r.left), top = Math.max(A.r.top, B.r.top);
      const t = deepPoint(left + ix / 2, top + iy / 2);
      const onA = Boolean(t && contains(A.e, t)), onB = Boolean(t && contains(B.e, t));
      if (!onA && !onB) continue;
      const [up, down] = onA ? [A, B] : [B, A];
      overlap.push({top: pathOf(up.e), topText: String(up.text).slice(0, 24), under: pathOf(down.e), underText: String(down.text).slice(0, 24),
        area: Math.round(ix * iy), share: +(ix * iy / small).toFixed(2), adornment: /^(input|textarea|select)$/.test(down.e.localName) || undefined,
        x: Math.round(left), y: Math.round(top), w: Math.round(ix), h: Math.round(iy)});
    }
  }

  const group = (list, byRatio) => {
    const m = new Map();
    for (const row of list) {
      const k = JSON.stringify([row.path || row.top, row.text ?? row.label ?? row.topText, row.ratio ?? row.under]);
      const g = m.get(k);
      if (g) g.n++; else m.set(k, {...row, n: 1});
    }
    const v = [...m.values()];
    if (byRatio) v.sort((a, b) => a.ratio - b.ratio);
    return v;
  };
  const counts = {}, items = {};
  for (const [k, list] of Object.entries({...found, overlap})) {
    const g = group(list, k !== 'overlap' && k !== 'truncate');
    counts[k] = list.length;
    items[k] = g.slice(0, k === 'borderDecor' ? 10 : cap);
  }
  counts.overlapNonAdornment = overlap.filter((o) => !o.adornment).length;
  return {mode: document.documentElement.getAttribute('data-laolao-mode'), path: location.pathname, viewport: [vw, vh], elements: all.length, visible, counts, items};
}

// 设置页：找到真正在滚的那个容器，滚到第 i 屏
function scrollSettings(i) {
  const root = document.querySelector('#laolao-user-settings');
  if (!root) return null;
  const room = (e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) ? e.scrollHeight - e.clientHeight : 0; };
  let box = null;
  for (let e = root; e && !box; e = e.parentElement) if (room(e) > 20) box = e;
  if (!box) {
    let best = 20;
    for (const e of root.querySelectorAll('*')) { const v = room(e); if (v > best) { best = v; box = e; } }
  }
  if (!box) box = document.scrollingElement;
  box.scrollTop = Math.round(i * box.clientHeight * 0.85);
  return {top: Math.round(box.scrollTop), max: box.scrollHeight - box.clientHeight, box: box.id || String(box.className || box.localName).slice(0, 60)};
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const msg = (error) => String(error?.message || error).split('\n')[0];

const shoot = async (page, name, meta) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name, file, os: process.platform, browser: engine || 'chromium', width: meta.width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
  let measured;
  try { measured = await page.evaluate(audit, {cap: CAP}); } catch (error) { measured = {error: msg(error)}; }
  report.push({name, file, ...meta, ...measured});
  console.log(`${name}: mode=${measured.mode} ${JSON.stringify(measured.counts || measured.error)}`);
};

async function scene(id, theme, width, opts, run) {
  let opened;
  try {
    opened = await H.openRealScenePage(browser, server.origin, id, theme, {timezoneId: 'Asia/Shanghai', ...opts});
  } catch (error) {
    report.push({scene: id, theme, width, step: 'open', error: msg(error)});
    console.log(`[b11] ${id} ${width}-${theme} 打不开：${msg(error)}`);
    return;
  }
  const {context, page, pageErrors} = opened;
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForTimeout(400);
    await run(page, pageErrors);
  } catch (error) {
    report.push({scene: id, theme, width, step: 'run', error: msg(error), pageErrors: pageErrors.slice(0, 5)});
    console.log(`[b11] ${id} ${width}-${theme} 出错：${msg(error)}`);
  } finally {
    await context.close().catch(() => {});
  }
}

const note = (page, step, theme, width) => (error) => report.push({page, theme, width, step, error: msg(error)});

async function cell(theme, width) {
  const tag = `${width}-${theme}`;
  const base = (page, errs, extra = {}) => ({page, theme, width, pageErrors: errs.slice(0, 5), ...extra});

  await scene('home-project', theme, width, {}, async (page, errs) => {
    await shoot(page, `home-${tag}`, base('home', errs));
  });

  await scene('settings', theme, width, {}, async (page, errs) => {
    for (let i = 0; i < 4; i++) {
      const pos = await page.evaluate(scrollSettings, i);
      await page.waitForTimeout(300);
      await shoot(page, `settings-${i + 1}-${tag}`, base('settings', errs, {step: i + 1, scroll: pos}));
      if (!pos || pos.top >= pos.max - 1) break;
    }
  });

  await scene('sidebar-expanded', theme, width, {initScript: fixture}, async (page, errs) => {
    await page.waitForFunction(() => typeof window.PinkieArtifacts?.open === 'function', null, {timeout: 15_000});
    await page.evaluate(() => { window.PinkieArtifacts.open(); });
    await page.waitForFunction(() => document.querySelectorAll('.pinkie-art-page .pinkie-art-card').length >= 4, null, {timeout: 15_000})
      .catch(note('library', 'cards', theme, width));
    await page.waitForTimeout(800);
    await shoot(page, `library-${tag}`, base('library', errs));
    await page.evaluate(() => { void window.PinkieArtifacts.openViewer('a1'); });
    await page.waitForSelector('.pinkie-art-viewer', {timeout: 10_000}).catch(note('viewer', 'open', theme, width));
    await page.waitForTimeout(800);
    await shoot(page, `viewer-${tag}`, base('viewer', errs));
  });

  await scene('sidebar-expanded', theme, width, {initScript: fixture}, async (page, errs) => {
    await page.waitForFunction(() => typeof window.__pinkieWorkbench?.show === 'function', null, {timeout: 15_000});
    const shown = await page.evaluate(() => window.__pinkieWorkbench.show()).catch((error) => msg(error));
    await page.waitForFunction(() => window.__pinkieWorkbench?.state?.visible === true, null, {timeout: 15_000})
      .catch(note('workbench', 'visible', theme, width));
    await page.evaluate(() => { void window.__pinkieWorkbench.open('/proj/README.md', {pinned: true}); });
    await page.waitForFunction(() => (window.__pinkieWorkbench?.state?.tabs || []).some((x) => /README\.md$/.test(x.path)), null, {timeout: 15_000})
      .catch(note('workbench', 'readme', theme, width));
    await page.waitForTimeout(1500);
    const bench = await page.evaluate(() => {
      const w = window.__pinkieWorkbench, d = document.documentElement.dataset;
      return {visible: Boolean(w?.state?.visible), root: w?.state?.root || '', tabs: (w?.state?.tabs || []).map((x) => x.path), narrow: d.pkWbNarrow, view: d.pkWbView};
    });
    await shoot(page, `workbench-${tag}`, base('workbench', errs, {shown, bench}));
  });
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await cell(theme, width);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
