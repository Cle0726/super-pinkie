import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {ArtifactStore} from '../services/mode-architecture/artifacts.mjs';
import {DesktopApps, OFFLINE_CSP, appIdFor, icnsFromPng, icoFromPng, registerDesktopApps, safeAppName, withOfflinePolicy}
  from '../services/mode-architecture/desktop-apps.mjs';

// 作品装成桌面应用（PR①）网关这一半：拷副本、默认不联网、图标、重装、卸载。
const tmp = prefix => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const KEY = 'agent:project:dashboard:7d2c1f4e';
// 1×1 透明 PNG（真文件头 + IHDR）。
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ICON = 'data:image/png;base64,' + PNG.toString('base64');

function setup() {
  const dir = tmp('apps-');
  const artifacts = new ArtifactStore(path.join(dir, 'artifacts'));
  const record = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return artifacts.record({file, sessionKey: KEY, runId: 'r1'});
  };
  let clock = 1000;
  const apps = new DesktopApps(path.join(dir, 'apps'), {artifacts, now: () => ++clock});
  return {dir, artifacts, record, apps};
}
function fakeApi() {
  const methods = {};
  return {
    registerGatewayMethod(name, fn) { methods[name] = fn; },
    async call(name, params) { let out; await methods[name]({params, respond: (ok, value, error) => { out = ok ? value : {rpcError: error}; }}); return out; },
  };
}

test('A1 安装：html 作品拷成 apps/<id>/index.html，CSP 在第一个脚本之前；非网页作品装不了', () => {
  const {record, apps, artifacts} = setup();
  const item = record('game.html', '<!doctype html><html><head><script>window.x=1</script></head><body>hi</body></html>');
  // 前提：作品库里有这件作品、还没装过。
  assert.equal(artifacts.get(item.id).item.kind, 'html');
  assert.equal(apps.forArtifact(item.id).app, null);
  const out = apps.install({id: item.id, name: '单词小游戏', icon: ICON});
  assert.equal(out.ok, true);
  assert.equal(out.replaced, false);
  const html = fs.readFileSync(out.app.entry, 'utf8');
  const csp = html.indexOf('Content-Security-Policy');
  assert.ok(csp > 0 && csp < html.indexOf('<script>'), 'CSP 要在页面脚本之前');
  assert.ok(html.includes("connect-src 'none'"));
  assert.deepEqual(out.app.network, [], 'PR② 起 network 是放行来源清单，空的就是不联网');
  assert.equal(out.app.name, '单词小游戏');
  assert.equal(out.app.id, appIdFor(item.id));
  assert.ok(fs.existsSync(out.app.icon.ico) && fs.existsSync(out.app.icon.icns));
  assert.equal(apps.forArtifact(item.id).app.id, out.app.id);
  // 反例：markdown 作品不能装。
  const md = record('notes.md', '# hi');
  assert.throws(() => apps.install({id: md.id}), /只有网页作品/);
  assert.equal(apps.list().apps.length, 1);
});

test('A2 拷的是快照：原文件之后被改或删掉，已装的应用照样能用', () => {
  const {dir, record, apps} = setup();
  const item = record('tool.html', '<p>v1</p>');
  const {app} = apps.install({id: item.id});
  fs.writeFileSync(path.join(dir, 'tool.html'), '<p>changed</p>');
  fs.rmSync(path.join(dir, 'tool.html'));
  assert.match(fs.readFileSync(app.entry, 'utf8'), /<p>v1<\/p>/);
  assert.ok(!app.entry.startsWith(path.join(dir, 'tool')), '入口在碧琪数据目录里，不指向原文件');
});

test('A3 重装同一件作品：id 不变、覆盖成最新版本、报出旧名字；不留暂存目录', () => {
  const {dir, record, apps} = setup();
  const first = record('page.html', '<p>one</p>');
  const a = apps.install({id: first.id, name: '旧名'});
  record('page.html', '<p>two</p>');
  const b = apps.install({id: first.id, name: '新名'});
  assert.equal(b.app.id, a.app.id);
  assert.equal(b.replaced, true);
  assert.equal(b.previousName, '旧名');
  assert.equal(b.app.version, 2);
  assert.match(fs.readFileSync(b.app.entry, 'utf8'), /two/);
  assert.equal(b.app.installedAt, a.app.installedAt);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'apps')).filter(name => name.includes('staging')), []);
  // 反例：没给图标就没有图标文件（原生端用碧琪默认图标），不会留下上次的。
  assert.equal(b.app.icon.ico, '');
});

test('A4 卸载：副本目录和记录都删掉；再删一次不报错；没装过的 get 报错', () => {
  const {record, apps} = setup();
  const item = record('x.html', '<p>x</p>');
  const {app} = apps.install({id: item.id, icon: ICON});
  assert.ok(fs.existsSync(app.dir));
  assert.deepEqual(apps.remove(app.id), {ok: true, removed: true, name: 'x'});
  assert.equal(fs.existsSync(app.dir), false);
  assert.equal(apps.list().apps.length, 0);
  assert.deepEqual(apps.remove(app.id), {ok: true, removed: false});
  assert.throws(() => apps.get(app.id), /没有装过/);
});

test('A5 名字做文件名：去掉非法字符、保留中文、保留字加后缀、空名兜底', () => {
  assert.equal(safeAppName('我的:游戏/第*1版?.html'), '我的 游戏 第 1版');
  assert.equal(safeAppName('  ...  '), '作品');
  assert.equal(safeAppName('CON'), 'CON 作品');
  assert.equal([...safeAppName('长'.repeat(80))].length, 40);
  // 反例：正常名字原样不动。
  assert.equal(safeAppName('单词卡 Pro'), '单词卡 Pro');
});

test('A6 CSP 插入点：有 head 进 head；只有 html / doctype 跟在后面；片段放最前；规则本身禁网', () => {
  assert.match(withOfflinePolicy('<html lang="zh"><head><title>t</title></head></html>'), /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/);
  assert.match(withOfflinePolicy('<!doctype html><html><body>b</body></html>'), /^<!doctype html><html><meta /);
  assert.match(withOfflinePolicy('<p>片段</p><script>1</script>'), /^<meta charset="utf-8"><meta http-equiv/);
  for (const rule of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'"]) assert.ok(OFFLINE_CSP.includes(rule), rule);
  // 反例：不放行任何 http(s) 来源。
  assert.doesNotMatch(OFFLINE_CSP, /https?:|\*/);
});

test('A12 编码：作品没写 charset 时补 utf-8 且在前 1024 字节内；写了的不重复补', () => {
  const charsets = html => (html.match(/<meta\s[^>]*charset\s*=/gi) || []).length;
  for (const page of ['<!doctype html><html><head><title>拼词</title></head><body>拼词</body></html>', '<p>中文片段</p>',
    '<!doctype html><html><body>' + '<!-- 填充 -->'.repeat(200) + '中文</body></html>']) {
    const out = withOfflinePolicy(page);
    assert.equal(charsets(out), 1, page.slice(0, 40));
    assert.ok(Buffer.byteLength(out.slice(0, out.search(/<meta charset="utf-8">/i)), 'utf8') < 1024, '要在浏览器探测编码的前 1024 字节里');
  }
  // 反例：作品自己声明了编码（两种写法、大小写）就不再补，也不改它。
  for (const page of ['<html><head><meta charset="gbk"><title>t</title></head></html>',
    '<html><head><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"></head></html>']) {
    const out = withOfflinePolicy(page);
    assert.equal(charsets(out), 1, page);
    assert.doesNotMatch(out, /<meta charset="utf-8">/);
  }
  // 反例：body 脚本字符串里的 <meta charset=x>、name/content 里碰巧出现的 charset= 都不算作品声明，照样补。
  for (const page of ['<html><head></head><body><script>var s="<meta charset=x>"</script></body></html>',
    '<html><head><meta name="x" content="charset=foo"></head><body>中文</body></html>']) {
    assert.match(withOfflinePolicy(page), /<meta charset="utf-8">/, page);
  }
  // doctype 后面一大段注释：补的 charset 紧跟 doctype，标签整个落在前 1024 字节内；CSP 仍进 head。
  const padded = withOfflinePolicy('<!doctype html><!--' + 'x'.repeat(1500) + '--><html><head><title>t</title></head><body>中文</body></html>');
  const at = padded.indexOf('<meta charset="utf-8">');
  assert.ok(at >= 0 && Buffer.byteLength(padded.slice(0, at + '<meta charset="utf-8">'.length), 'utf8') <= 1024, '长注释时 charset 也要在前 1024 字节');
  assert.match(padded, /<head><meta http-equiv="Content-Security-Policy"/);
  // 没有 > 的长输入不能拖成平方级（原来 20000 个 "<meta " 要 3 秒多）。
  const t0 = performance.now();
  assert.match(withOfflinePolicy('<meta '.repeat(20000)), /^<meta charset="utf-8">/);
  assert.ok(performance.now() - t0 < 200, '20000 个 "<meta " 要在 200ms 内');
  // 装出来的副本也带上：没写 charset 的中文作品。
  const {record, apps} = setup();
  const item = record('cn.html', '<!doctype html><html><head><title>拼词</title></head><body>拼词</body></html>');
  const html = fs.readFileSync(apps.install({id: item.id, name: '拼词'}).app.entry, 'utf8');
  assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf('Content-Security-Policy'));
  assert.ok(html.includes('<body>拼词</body>'));
});

test('A7 图标：PNG 包成 ICO / ICNS 文件头正确；不是 PNG 的拒收', () => {
  const ico = icoFromPng(PNG);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.equal(ico.readUInt32LE(14), PNG.length);
  assert.ok(ico.subarray(22).equals(PNG));
  const icns = icnsFromPng(PNG);
  assert.equal(icns.toString('latin1', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.equal(icns.toString('latin1', 8, 12), 'ic08');
  assert.throws(() => icoFromPng(Buffer.from('GIF89a......................')), /不是 PNG/);
  const {record, apps} = setup();
  const item = record('y.html', '<p>y</p>');
  assert.throws(() => apps.install({id: item.id, icon: 'data:image/png;base64,' + Buffer.from('not a png at all, no').toString('base64')}), /图标不对/);
  assert.equal(apps.list().apps.length, 0, '图标不对时什么都不装');
});

test('A9 Metre 夜间装到桌面对话框主按钮字对比度 ≥ 4.5:1（uireview 02:13Z 打回：白字压 #93A5EE 只有 2.37:1）', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const read = file => fs.readFileSync(path.join(root, 'ui/injections', file), 'utf8');
  const skin = read('laolao-metre-skin.css');
  const night = skin.slice(skin.indexOf('[data-theme="dark"] {'));
  const hex = name => night.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];
  const lum = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const accent = hex('metre-accent'), surface = hex('metre-surface');
  assert.equal(accent.toUpperCase(), '#93A5EE');
  assert.ok(ratio('#FFFFFF', accent) < 4.5, '白字本来就不够，这条测试才有意义');
  // 主按钮字跟 --pk-apps-on-accent 走，默认仍是白字（日间和别的对话框不变）。
  assert.match(read('laolao-artifacts.css'), /\.pk-apps-dialog\) \.laolao-modal__button--primary \{[^}]*color:var\(--pk-apps-on-accent,#fff\)/);
  // 只在 Metre 夜间、只在 .pk-apps-dialog 里换成面板深色。
  const rule = read('laolao-desktop-apps.css').match(/^html\[data-laolao-mode="metre"\]:is\(\[data-pinkie-night\],\[data-theme="dark"\]\) \.pk-apps-dialog \{ --pk-apps-on-accent:var\(--metre-surface,(#[0-9A-Fa-f]{6})\) \}$/m);
  assert.ok(rule, '夜间对话框要设 --pk-apps-on-accent');
  assert.equal(rule[1].toLowerCase(), surface.toLowerCase());
  assert.ok(ratio(surface, accent) >= 4.5, `夜间主按钮 ${surface} / ${accent} = ${ratio(surface, accent).toFixed(2)}`);
});

test('A11 碧琪各模式下装到桌面 / 卸载确认主按钮字对比度 ≥ 4.5:1（CI 截图 7ec74580：项目模式白字压青绿 日 3.78 / 夜 2.03）', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const read = file => fs.readFileSync(path.join(root, 'ui/injections', file), 'utf8');
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = c => c.map(v => v / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  // 日间：主题里每个模式的 --accent（含 :root 默认）；夜间：laolao-night.css 每个模式的 --accent。
  const theme = read('laolao-theme.css');
  // 模式色块都在文件开头（:root 和 html[data-laolao-mode=…] 那几段），后面是各页面自己的规则。
  const head = theme.split('\n').slice(0, theme.split('\n').findIndex((line, i) => i > 0 && /^html\[data-laolao-mode="unrestricted"\] \{/.test(line)) + 10).join('\n');
  const day = [...head.matchAll(/--accent:\s*(#[0-9a-fA-F]{6})/g)].map(m => m[1]);
  const night = [...read('laolao-night.css').matchAll(/html\[data-pinkie-night\]\[data-laolao-mode="[a-z]+"\][^{]*\{[^}]*--accent:\s*(#[0-9a-fA-F]{6})/g)].map(m => m[1]);
  assert.ok(day.length >= 5 && night.length >= 5, `读到日间 ${day.length}、夜间 ${night.length} 个强调色`);
  assert.ok(night.some(c => ratio([255, 255, 255], rgb(c)) < 4.5), '白字本来就不够，这条测试才有意义');
  // 主按钮底跟 --pk-apps-accent 走，默认仍是 --pa-accent（别的对话框不变）。
  assert.match(read('laolao-artifacts.css'), /\.pk-apps-dialog\) \.laolao-modal__button--primary \{ background:var\(--pk-apps-accent,var\(--pa-accent\)\)/);
  const css = read('laolao-desktop-apps.css');
  const mix = css.match(/^html:not\(\[data-laolao-mode="metre"\]\):not\(\[data-pinkie-night\]\) \.pk-apps-dialog \{ --pk-apps-accent:color-mix\(in srgb,var\(--pa-accent\) (\d+)%,#000\) \}$/m);
  assert.ok(mix, '日间对话框要压暗主按钮底');
  const ink = css.match(/^html\[data-pinkie-night\]:not\(\[data-laolao-mode="metre"\]\) \.pk-apps-dialog \{ --pk-apps-on-accent:(#[0-9a-fA-F]{6}) \}$/m);
  assert.ok(ink, '夜间对话框主按钮要换深色字');
  for (const c of day) {
    const bg = rgb(c).map(v => (v * Number(mix[1])) / 100);
    assert.ok(ratio([255, 255, 255], bg) >= 4.5, `日间 ${c} 压到 ${mix[1]}% 白字 ${ratio([255, 255, 255], bg).toFixed(2)}`);
  }
  for (const c of night) assert.ok(ratio(rgb(ink[1]), rgb(c)) >= 4.5, `夜间 ${ink[1]} / ${c} = ${ratio(rgb(ink[1]), rgb(c)).toFixed(2)}`);
});

test('A12 跟进：权限勾选框跟主色、「更新成新版本」是主按钮（同一套对比度变量）、应用行说明栏占满不挤断', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const read = file => fs.readFileSync(path.join(root, 'ui/injections', file), 'utf8');
  const css = read('laolao-desktop-apps.css'), js = read('laolao-desktop-apps.js');
  // ① 勾选框 accent-color 跟主按钮底色同一个变量。
  assert.match(css, /^\.pk-apps-dialog__perm input \{[^}]*accent-color:var\(--pk-apps-accent,var\(--pa-accent\)\)/m);
  // ② 「更新成新版本」带 pk-apps-update，底 / 字跟对话框主按钮同一套变量；设置卡片里也设了这套变量（日压暗、夜深字、Metre 夜面板色）。
  assert.match(js, /button\('更新成新版本', 'pk-apps-update'/);
  assert.match(css, /^\.pk-apps-row \.pk-apps-update \{[^}]*background:var\(--pk-apps-accent,var\(--pa-accent\)\);color:var\(--pk-apps-on-accent,#fff\)/m);
  for (const [scope, value] of [
    ['html:not\\(\\[data-laolao-mode="metre"\\]\\):not\\(\\[data-pinkie-night\\]\\)', '--pk-apps-accent:color-mix\\(in srgb,var\\(--pa-accent\\) 85%,#000\\)'],
    ['html\\[data-pinkie-night\\]:not\\(\\[data-laolao-mode="metre"\\]\\)', '--pk-apps-on-accent:#2a2027'],
    ['html\\[data-laolao-mode="metre"\\]:is\\(\\[data-pinkie-night\\],\\[data-theme="dark"\\]\\)', '--pk-apps-on-accent:var\\(--metre-surface,#232321\\)'],
  ]) {
    const dialog = new RegExp(`^${scope} \\.pk-apps-dialog \\{ ${value} \\}$`, 'm'), card = new RegExp(`^${scope} \\.pk-apps-card \\{ ${value} \\}$`, 'm');
    assert.match(css, dialog, '对话框那条还在');
    assert.match(css, card, '设置卡片用同一个值（A11 量过的对比度）');
  }
  // Metre 皮肤用 !important 把 .pinkie-art-btn 全压成透明描边：主按钮不挂这个类，自己带尺寸；本文件不加 !important。
  assert.doesNotMatch(js, /'pinkie-art-btn[^']*pk-apps-update/);
  assert.match(css, /^\.pk-apps-row \.pk-apps-update \{ height:28px;/m);
  assert.doesNotMatch(css, /!important/);
  // ③ 应用行说明占满、按钮按内容宽（默认设置行左栏 .34fr 会把「作品有新版本…」挤成两三行）；窄屏照旧上下排。
  assert.match(css, /^#laolao-user-settings \.pk-apps-row\.pinkie-user-settings__row \{ grid-template-columns:minmax\(0,1fr\) auto \}$/m);
  assert.match(css, /@media \(max-width:780px\) \{ #laolao-user-settings \.pk-apps-row\.pinkie-user-settings__row \{ grid-template-columns:1fr \} \}/);
});

test('A13 共享皮肤主按钮（项目设置「保存」/ 快捷键一览）用装到桌面那套对比度变量，值跟 .pk-apps-dialog 一致（A11 量过 ≥ 4.5:1）', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const read = file => fs.readFileSync(path.join(root, 'ui/injections', file), 'utf8');
  const apps = read('laolao-desktop-apps.css'), skin = apps;
  const scopes = [
    'html:not\\(\\[data-laolao-mode="metre"\\]\\):not\\(\\[data-pinkie-night\\]\\)',
    'html\\[data-pinkie-night\\]:not\\(\\[data-laolao-mode="metre"\\]\\)',
    'html\\[data-laolao-mode="metre"\\]:is\\(\\[data-pinkie-night\\],\\[data-theme="dark"\\]\\)',
  ];
  for (const scope of scopes) {
    const ref = apps.match(new RegExp(`^${scope} \\.pk-apps-dialog \\{ (--pk-apps-[a-z-]+:[^}]+?) \\}$`, 'm'));
    assert.ok(ref, `装到桌面对话框那条还在：${scope}`);
    const line = new RegExp(`^${scope} \\.laolao-modal:is\\(\\.pinkie-project-settings,\\.pinkie-shortcuts\\) \\{ ([^}]+?) \\}$`, 'm');
    const got = skin.match(line);
    assert.ok(got, `共享皮肤要设同一个变量：${scope}`);
    assert.equal(got[1], ref[1], '值跟对话框那条一字不差');
  }
  // 项目设置「保存」确实是这组主按钮。
  assert.match(read('laolao-artifacts.js'), /el\('button', 'laolao-modal__button laolao-modal__button--primary', '保存'\)/);
});

// A10 用：最小假 DOM，只够 laolao-desktop-apps.js 的设置卡片和弹层（单个类选择器、append / remove、onclick）。
function fakeDom(source) {
  const hasClass = (node, name) => String(node.className || '').split(/\s+/).includes(name);
  const detach = n => { if (n.parentNode) { const list = n.parentNode.children; list.splice(list.indexOf(n), 1); n.parentNode = null; } };
  let body = null;
  const make = tag => ({
    tagName: String(tag).toUpperCase(), className: '', children: [], parentNode: null, attrs: {}, ownText: '', value: '',
    get textContent() { return this.ownText + this.children.map(c => c.textContent).join(''); },
    set textContent(text) { for (const c of [...this.children]) detach(c); this.ownText = String(text); },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    append(...nodes) { for (const n of nodes) { detach(n); n.parentNode = this; this.children.push(n); } },
    insertBefore(n, ref) { detach(n); n.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, n); return n; },
    before(n) { this.parentNode.insertBefore(n, this); },
    remove() { detach(this); },
    replaceChildren(...nodes) { for (const c of [...this.children]) detach(c); this.ownText = ''; this.append(...nodes); },
    get firstChild() { return this.children[0] ?? null; },
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === body; },
    focus() {}, select() {},
    querySelectorAll(sel) {
      const out = [];
      if (!/^\.[\w-]+$/.test(sel)) return out;
      const walk = n => { for (const c of n.children) { if (hasClass(c, sel.slice(1))) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
  });
  body = make('body');
  const keys = new Set(), listeners = {}, calls = {native: [], rpc: []}, toasts = [];
  const state = {native: {ok: true}};
  const document = {readyState: 'complete', body, createElement: make, querySelector: sel => body.querySelector(sel),
    addEventListener(type, fn) { if (type === 'keydown') keys.add(fn); }, removeEventListener(type, fn) { keys.delete(fn); }};
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    webkit: {messageHandlers: {pinkieNative: {}}},
    pinkieNative: async message => { calls.native.push(JSON.stringify(message)); return state.native; },
    __laolaoToast: text => toasts.push(text),
    __laolaoSidebar: {gwRequest: async method => {
      calls.rpc.push(method);
      return method === 'pinkie.apps.list' ? {apps: [{id: 'a1', name: '单词小游戏', version: 2, latest: 2}]} : {ok: true, removed: true};
    }},
  };
  vm.runInNewContext(source, {window, document, navigator: {platform: 'Win32'}});
  const emit = (type, detail) => (listeners[type] || []).forEach(fn => fn({detail}));
  return {body, make, hasClass, keys, calls, toasts, state, emit};
}

test('A10 卸载先弹碧琪确认框：取消 / Esc 什么都不动，确认才卸载并提示；卸载键是普通描边键（uireview 01:25Z ① ② ③）', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  // ① 对话框非主按钮也在皮肤那组 :is() 里（主按钮 A9 已管）。
  assert.match(fs.readFileSync(path.join(root, 'ui/injections/laolao-artifacts.css'), 'utf8'), /:is\([^)]*\.pk-apps-dialog\) \.laolao-modal__button \{/);
  const dom = fakeDom(fs.readFileSync(path.join(root, 'ui/injections/laolao-desktop-apps.js'), 'utf8'));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const click = node => node.onclick({stopPropagation() {}});
  const scroll = dom.make('div');
  dom.body.append(scroll);
  dom.emit('pinkie:settings-ready', scroll);
  await flush();
  const row = () => scroll.querySelector('.pk-apps-row');
  const confirmBox = () => dom.body.querySelector('.pinkie-art-confirm')?.querySelector('.laolao-modal') ?? null;
  const pick = primary => confirmBox().querySelectorAll('.laolao-modal__button').find(b => dom.hasClass(b, 'laolao-modal__button--primary') === primary);
  const uninstallBtn = row().querySelector('.pk-apps-uninstall');
  assert.equal(uninstallBtn.className, 'pinkie-art-btn pk-apps-uninstall', '② 卸载键跟「打开」一样是普通描边键，不是 --quiet');

  click(uninstallBtn); await flush();
  assert.ok(confirmBox(), '③ 点卸载先弹确认框');
  assert.ok(dom.hasClass(confirmBox(), 'pk-apps-dialog'), '确认框跟装到桌面对话框同一套碧琪皮肤');
  assert.equal(confirmBox().getAttribute('role'), 'alertdialog');
  assert.match(confirmBox().textContent, /卸载「单词小游戏」？/);
  assert.equal(dom.calls.native.length, 0, '确认前不碰原生端');
  click(pick(false)); await flush();
  assert.equal(confirmBox(), null, '取消关掉');
  assert.equal(dom.calls.native.length, 0);
  assert.ok(row(), '取消后行还在');
  assert.equal(dom.toasts.length, 0);

  click(uninstallBtn); await flush();
  for (const fn of [...dom.keys]) fn({key: 'Escape', preventDefault() {}, stopPropagation() {}});
  await flush();
  assert.equal(confirmBox(), null, 'Esc 关掉');
  assert.equal(dom.calls.native.length, 0);
  assert.equal(dom.keys.size, 0, '键盘监听收走了');

  dom.state.native = {ok: false, error: '入口删不掉'};
  click(uninstallBtn); await flush();
  click(pick(true)); await flush();
  assert.ok(row(), '原生端失败时行留着');
  assert.equal(dom.toasts.at(-1), '没卸载干净：入口删不掉');
  assert.ok(!dom.calls.rpc.includes('pinkie.apps.remove'), '入口没删掉就不删副本');

  dom.state.native = {ok: true};
  click(uninstallBtn); await flush();
  click(pick(true)); await flush();
  assert.equal(dom.calls.native.at(-1), JSON.stringify({type: 'uninstallApp', appId: 'a1'}));
  assert.ok(dom.calls.rpc.includes('pinkie.apps.remove'));
  assert.equal(row(), null, '确认后行没了');
  assert.equal(confirmBox(), null);
  assert.equal(dom.toasts.at(-1), '「单词小游戏」卸载了，图标也删了');
});

test('A8 网关方法：pinkie.apps.* 都在，出错回 {ok:false} 不抛', async () => {
  const {dir, record, artifacts} = setup();
  const api = fakeApi();
  registerDesktopApps(api, {root: path.join(dir, 'apps2'), artifacts});
  const item = record('z.html', '<p>z</p>');
  const out = await api.call('pinkie.apps.install', {id: item.id, name: 'Z'});
  assert.equal(out.ok, true);
  assert.equal((await api.call('pinkie.apps.list', {})).apps.length, 1);
  assert.equal((await api.call('pinkie.apps.forArtifact', {id: item.id})).app.name, 'Z');
  assert.equal((await api.call('pinkie.apps.remove', {id: out.app.id})).removed, true);
  const bad = await api.call('pinkie.apps.install', {id: 'nope'});
  assert.equal(bad.ok, false);
  assert.match(bad.error, /作品库里没有/);
});
