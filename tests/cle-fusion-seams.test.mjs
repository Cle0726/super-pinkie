// 融合接缝的回归闸门：
//  1) 静态契约 —— 我负责的三个文件不能新增粉色/旧渐变字面量，且必须走 token；
//  2) 真实浏览器 —— 用 headless Chrome 量计算样式（对比度、命中区、降级文案）。
// 本机没有 Chrome 时跳过第 2 段，并在输出里说明，而不是假装通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const studio = path.join(root, 'services/cle-studio');
const read = (p) => fs.readFileSync(path.join(studio, p), 'utf8');

const BRIDGE = read('src/styles/bridge.css');
const PRESENTATION = read('static/legacy/presentation.css');
const UTILITIES = read('src/legacy/utilities.js');

/* ── 1. 静态契约 ────────────────────────────────────────────────────────── */
test('融合样式只引用 token，不再引入新的粉色/紫罗兰字面量', () => {
  // 只抓"装饰性粉色/紫罗兰"：色相在品红-紫一带且足够饱和。
  // 真实的错误红（#B23A33）与暖金（#8A6A24）不在这个范围，不能被误判。
  const decorativePink = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return false;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return false;
    let hue;
    if (max === r) hue = (60 * ((g - b) / d) + 360) % 360;
    else if (max === g) hue = 60 * ((b - r) / d) + 120;
    else hue = 60 * ((r - g) / d) + 240;
    const sat = d / max;
    return hue >= 300 && hue <= 355 && sat > 0.3 && max > 0.55;
  };
  const pinkish = decorativePink;
  const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [name, css] of [['bridge.css', BRIDGE], ['presentation.css', PRESENTATION]]) {
    const offenders = (stripComments(css).match(/#[0-9a-fA-F]{6}\b/g) || []).filter(pinkish);
    assert.deepEqual(offenders, [], `${name} 仍有粉色字面量：${offenders.join(', ')}`);
  }
});

test('语义色单独定义，且深浅主题各有一套', () => {
  assert.match(BRIDGE, /html\[data-cle\] \{[^}]*--cle-ok:[^}]*--cle-danger:[^}]*--cle-warn:/);
  assert.match(BRIDGE, /html\[data-cle\]\[data-theme-mode="dark"\] \{[^}]*--cle-ok:/);
  // 成功/失败不能复用装饰性的金或冰蓝，否则状态就失去意义
  const light = BRIDGE.match(/html\[data-cle\] \{([^}]*)\}/)?.[1] || '';
  assert.match(light, /--cle-ok: #3F6B4F/);
  assert.match(light, /--cle-danger: #B23A33/);
});

test('功能面板的每一块表面都指向 token，而不是固定纸色', () => {
  assert.match(BRIDGE, /#cle-utilities \{[^}]*background: var\(--cle-surface\)/);
  assert.match(BRIDGE, /\.cle-utilities__action \{[^}]*background: var\(--cle-paper\)[^}]*color: var\(--cle-ink\)/);
  assert.match(BRIDGE, /\.cle-utilities__group-title \{[^}]*color: var\(--cle-ink-2\)/);
  // 分组小标题曾经用 ink-3，在纸面上只有 2.8:1，必须用可读的二级墨色
  assert.doesNotMatch(BRIDGE, /\.cle-utilities__group-title \{[^}]*--cle-ink-3/);
});

test('演示工具的色板保留功能色，只改边框与选中环', () => {
  assert.match(PRESENTATION, /\.laser-swatch \{[^}]*border: 2px solid var\(--cle-surface\)/);
  assert.doesNotMatch(PRESENTATION, /\.laser-swatch \{[^}]*background:/, '色板底色是功能参数，不能被样式改写');
  // 设置面板整体重新指向冰蓝，否则滑块和读数会退回默认粉色
  assert.match(PRESENTATION, /#pinkie-laser-settings \{[^}]*--accent: var\(--cle-gaze\)/);
});

test('功能入口复用原生 footer 图标尺寸，不再自带文字胶囊', () => {
  assert.match(UTILITIES, /`\$\{S\}-entry sidebar-footer-icon`/);
  assert.doesNotMatch(UTILITIES, /node\('button', 'cle-utilities-entry', '功能'\)/);
  assert.match(UTILITIES, /aria-haspopup/);
});

test('异步移植模块缺席时给出真实降级，而不是空白或伪造成功', () => {
  assert.match(UTILITIES, /定时任务和连接器没能加载/);
  assert.match(UTILITIES, /统计源暂时读不到，先不显示数字/);
  assert.match(UTILITIES, /演示工具还在加载/);
  assert.match(UTILITIES, /记忆匣还没准备好/);
  // 空间入口：没有原生桥时保留真实地址，并说明是网页标签
  assert.match(UTILITIES, /当前是网页环境，没有 App 的原生桥/);
});

test('重复激活不会在 footer 里留下两个入口', () => {
  assert.match(UTILITIES, /for \(const stale of document\.querySelectorAll\('\.cle-utilities-entry, \.cle-utilities-layer'\)\) stale\.remove\(\)/);
});

/* ── 2. 真实浏览器测量 ──────────────────────────────────────────────────── */
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserAvailable = fs.existsSync(CHROME) && process.env.CLE_SKIP_BROWSER !== '1';

test('headless Chrome 量到的对比度与命中区达到 4.5:1 / 原生 30×30', {skip: !browserAvailable && 'no Chrome on this host'}, async () => {
  const port = 18980 + Math.floor(Math.random() * 40);
  const cdp = 9500 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, [path.join(studio, '.harness/serve-fusion.mjs')], {
    env: {...process.env, FUSION_HARNESS_PORT: String(port)}, stdio: 'ignore',
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // 等静态服务起来（最多 5s）
    let up = false;
    for (let i = 0; i < 25 && !up; i++) {
      await wait(200);
      up = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false);
    }
    assert.ok(up, 'harness 服务应已启动');

    const run = spawn(process.execPath, [path.join(studio, '.harness/run-fusion.mjs')], {
      env: {...process.env, FUSION_HARNESS_URL: `http://127.0.0.1:${port}/`, CLE_AUDIT_CDP: String(cdp)},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    run.stdout.on('data', (d) => { out += d; });
    run.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => { run.kill('SIGKILL'); resolve(-1); }, 60000);
      run.on('exit', (c) => { clearTimeout(timer); resolve(c); });
    });

    assert.equal(code, 0, `harness 应正常结束，实际 ${code}\n${out}`);
    assert.match(out, /DONE_MARKER/);

    // 入口必须和原生图标同尺寸、同基线，且不是粉色
    const size = out.match(/ENTRY size (\d+(?:\.\d+)?)x(\d+(?:\.\d+)?) native (\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    assert.ok(size, '应输出入口/原生图标的尺寸对比');
    assert.equal(size[1], size[3]);
    assert.equal(size[2], size[4]);
    assert.match(out, /ENTRY aligns yes/);
    assert.match(out, /ENTRY pinkish no/);

    // 面板与各类文字的对比度：全部 >= 4.5
    const contrasts = [...out.matchAll(/contrast (\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    assert.ok(contrasts.length >= 5, '应量到多处对比度');
    for (const c of contrasts) assert.ok(c >= 4.5, `对比度 ${c}:1 低于 4.5:1\n${out}`);

    // 演示工具：色板预设色必须原样保留，滑块走冰蓝
    assert.match(out, /LASER swatch bg rgb\(224, 64, 127\)[^\n]*preservesPreset yes/);
    assert.match(out, /LASER range accent #2A63E8/);

    // 状态与降级：明确、可读，且不把按钮文字改写成加载中
    assert.match(out, /DEMO label "打开演示工具" disabled true/);
    assert.match(out, /DEMO status "[^"]*加载/);
    assert.match(out, /PARTY present native=0 target=_blank/);

    // 焦点回收与夜间主题
    assert.match(out, /ESC hidden true focusReturned true/);
    assert.match(out, /DARK bg rgb\(17, 21, 34\)/);
  } finally {
    server.kill('SIGKILL');
  }
});

/* ── 3. brand.js 覆盖范围审计（记录残留，作为交给主控的回归依据）──────────
   这些断言锁定的是"当前真实行为"，不是"理想行为"：
   - 正文/代码保护有效（必须一直成立）；
   - 文本节点里的 OpenClaw 会被替换（必须一直成立）；
   - ClawHub 与 aria-label / title / alt / placeholder 目前**不会**被替换（已知缺口）。
   一旦有人修好 src/core/brand.js，最后一条会失败并提醒主控更新交接单——
   这正是我们要的通知，而不是悄悄放过。 */
test('brand 审计：正文受保护，但属性与 ClawHub 仍是 chrome 残留', {skip: !browserAvailable && 'no Chrome on this host'}, async () => {
  const port = 19020 + Math.floor(Math.random() * 40);
  const cdp = 9800 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, [path.join(studio, '.harness/serve-fusion.mjs')], {
    env: {...process.env, FUSION_HARNESS_PORT: String(port)}, stdio: 'ignore',
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let up = false;
    for (let i = 0; i < 25 && !up; i++) {
      await wait(200);
      up = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false);
    }
    assert.ok(up, 'harness 服务应已启动');
    const run = spawn(process.execPath, [path.join(studio, '.harness/run-fusion.mjs')], {
      env: {...process.env, FUSION_HARNESS_URL: `http://127.0.0.1:${port}/brand-audit.html`, CLE_AUDIT_CDP: String(cdp)},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    run.stdout.on('data', (d) => { out += d; });
    run.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => { run.kill('SIGKILL'); resolve(-1); }, 60000);
      run.on('exit', (c) => { clearTimeout(timer); resolve(c); });
    });
    assert.equal(code, 0, `brand 审计应正常结束\n${out}`);

    // 必须保护：用户正文与代码块一字不改
    assert.match(out, /USER-TEXT "我的笔记：OpenClaw 的 docs\.openclaw\.ai 文档，别改这行。"/);
    assert.match(out, /CODE "npm i -g openclaw@latest  # OpenClaw CLI"/);
    // 必须生效：chrome 文本节点被替换（含异步插入的节点）
    assert.match(out, /TOPBAR-TITLE text="C\.le\."/);
    assert.match(out, /LOGIN-TITLE text="C\.le\."/);
    assert.match(out, /LATE-NODE "C\.le\. 配置"/);

    // 已知缺口（交接项 A/B）：修好后这里会失败，主控据此更新报告
    assert.match(out, /CLAWHUB title="ClawHub"/, 'ClawHub 文本仍未被替换');
    assert.match(out, /CLAWHUB title="ClawHub" placeholder="Search ClawHub skills…"/, 'placeholder 属性未被扫描');
    assert.match(out, /TOOLTIP aria="OpenClaw 文档" title="OpenClaw docs"/, 'aria-label/title 未被扫描');
    assert.match(out, /TOPBAR-BRAND aria="OpenClaw"/, 'aria-label 未被扫描');
    assert.match(out, /SIDEBAR-NATIVE-BRAND alt="OpenClaw"/, 'img alt 未被扫描');
  } finally {
    server.kill('SIGKILL');
  }
});
