// T3 #12（L26）：Metre 输入框图片缩略条点开放大。laolao-metre-thumbs.js 在极简假 DOM 里跑，不启动浏览器。
// 改前：原生输入框附件条（.chat-attachments-preview > .chat-attachment-thumb > img）只画缩略图，点了没反应，
// laolao-image-viewer.js 的选择器只认对话区的 .chat-message-image。改后：Metre 下点缩略图 / Enter 用同一个看图器打开原图；
// 移除键、文件附件、其他模式一律不动（反例）。
// uireview 08:45Z：只用键盘的人要能 Tab 到缩略图（焦点从移除键 / 输入框来，不是直接落在格子上）；
// role=button 挂在 img 上，不挂在包着原生移除 <button> 的格子上。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SRC = read('ui/injections/laolao-metre-thumbs.js');
const THUMB_SEL = '.chat-attachments-preview .chat-attachment-thumb:not(.chat-attachment-thumb--file)';

class El {
  constructor(tag, cls = '') { this.tagName = tag.toUpperCase(); this.className = cls; this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
  has(c) { return this.className.split(/\s+/).includes(c); }
  // 只认本文件用到的几种选择器
  matches(sel) {
    return sel.split(',').map((s) => s.trim()).some((s) => {
      if (s === 'textarea' || s === 'input') return this.tagName === s.toUpperCase();
      if (s === '[contenteditable="true"]') return this.attrs.contenteditable === 'true';
      if (s === '.chat-attachment-remove' || s === '.chat-attachments-preview') return this.has(s.slice(1));
      if (s === THUMB_SEL) {
        if (!this.has('chat-attachment-thumb') || this.has('chat-attachment-thumb--file')) return false;
        for (let n = this.parent; n; n = n.parent) if (n.has?.('chat-attachments-preview')) return true;
        return false;
      }
      if (s === THUMB_SEL + ' img') return this.tagName === 'IMG' && Boolean(this.parent?.closest(THUMB_SEL));
      if (s === 'img[data-pk-metre-thumb="1"]') return this.tagName === 'IMG' && this.dataset.pkMetreThumb === '1';
      if (s === 'img') return this.tagName === 'IMG';
      throw new Error('fake DOM does not know selector: ' + s);
    });
  }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches?.(sel)) return n; return null; }
  querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const d = c.querySelector(sel); if (d) return d; } return null; }
  querySelectorAll(sel, out = []) { for (const c of this.children) { if (c.matches(sel)) out.push(c); c.querySelectorAll(sel, out); } return out; }
}

// 原生 uy() 的结构：一张图片附件 + 一个文件附件，各带移除键；下面是输入框。
function thumbCell(src) {
  const cell = new El('div', 'chat-attachment-thumb');
  const img = new El('img'); img.src = src; img.alt = 'Attachment preview';
  const remove = new El('button', 'chat-attachment-remove');
  cell.append(img, remove);
  return {cell, img, remove};
}

function env({mode = 'metre', viewer = true} = {}) {
  const listen = {};
  const opened = [];
  const body = new El('body');
  const strip = new El('div', 'chat-attachments-preview');
  const a = thumbCell('data:image/png;base64,QUJD');
  const fileCell = new El('div', 'chat-attachment-thumb chat-attachment-thumb--file');
  const fileName = new El('span', 'chat-attachment-file__name'); const removeFile = new El('button', 'chat-attachment-remove');
  fileCell.append(fileName, removeFile);
  strip.append(a.cell, fileCell);
  const textarea = new El('textarea');
  const msgImg = new El('img', 'chat-message-image'); msgImg.src = 'data:image/png;base64,REVG';
  body.append(strip, textarea, msgImg);

  const win = {addEventListener: (t, f, cap) => { (listen[t] ||= []).push({f, cap}); }, Pinkie: {}};
  if (viewer) win.__laolaoImageViewer = {open: (src, alt) => opened.push([src, alt]), close() {}};
  const html = {getAttribute: (k) => (k === 'data-laolao-mode' ? mode : null)};
  const doc = {documentElement: html, querySelectorAll: (s) => body.querySelectorAll(s)};
  vm.runInNewContext(SRC, {window: win, document: doc});

  const fire = (type, target, extra = {}) => {
    const ev = {type, target, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra};
    for (const {f} of listen[type] || []) f(ev);
    return ev;
  };
  const addImage = (src) => { const t = thumbCell(src); strip.children.splice(1, 0, t.cell); t.cell.parent = strip; return t; };
  return {win, listen, opened, strip, imgCell: a.cell, img: a.img, removeImg: a.remove, fileCell, fileName, removeFile, textarea, msgImg, fire, addImage,
    setMode: (m) => { mode = m; }};
}

test('Metre：点输入框里的图片缩略图，用同一个看图器打开整张原图，并先于原生接住', () => {
  const e = env();
  const ev = e.fire('click', e.img);
  assert.deepEqual(e.opened, [['data:image/png;base64,QUJD', '输入框里的图片']]);
  assert.ok(ev.prevented && ev.stopped, '点了只开看图器');
  const cellClick = e.fire('click', e.imgCell);
  assert.equal(e.opened.length, 2, '点到格子边上也算');
  assert.ok(cellClick.prevented);
  for (const {cap} of e.listen.click) assert.equal(cap, true, '捕获阶段');
});

test('反例：移除键、文件附件、对话区里的图、修饰键 / 右键都不归这里管', () => {
  const e = env();
  for (const t of [e.removeImg, e.fileCell, e.fileName, e.removeFile, e.msgImg, e.textarea]) {
    const ev = e.fire('click', t);
    assert.ok(!ev.prevented && !ev.stopped, '不拦：' + (t.className || t.tagName));
  }
  for (const extra of [{button: 2}, {metaKey: true}, {ctrlKey: true}, {shiftKey: true}, {altKey: true}]) {
    const ev = e.fire('click', e.img, extra);
    assert.ok(!ev.prevented, '不拦：' + JSON.stringify(extra));
  }
  assert.deepEqual(e.opened, []);
});

test('反例：其他模式一个字不动（不打开、不拦、不补属性）；切回 Metre 才生效', () => {
  for (const mode of ['chat', 'baton', 'project', 'study', 'infinite', null]) {
    const e = env({mode});
    const ev = e.fire('click', e.img);
    e.fire('pointerover', e.img); e.fire('focusin', e.removeImg); e.fire('focusin', e.textarea);
    e.fire('keydown', e.textarea, {key: 'Tab'});
    const key = e.fire('keydown', e.img, {key: 'Enter'});
    assert.deepEqual(e.opened, [], `mode=${mode}`);
    assert.ok(!ev.prevented && !ev.stopped && !key.prevented, `mode=${mode} 不拦`);
    assert.deepEqual([e.img.attrs, e.img.dataset, e.imgCell.attrs], [{}, {}, {}], `mode=${mode} 不补属性`);
    e.setMode('metre');
    e.fire('click', e.img);
    assert.equal(e.opened.length, 1, '切回 Metre 生效');
  }
});

test('键盘：焦点到移除键或输入框（不碰鼠标）时，附件条里的图片就能 Tab 到；Enter / 空格打开', () => {
  for (const from of ['removeImg', 'textarea', 'removeFile']) {
    const e = env();
    assert.equal(e.img.getAttribute('tabindex'), null, '还没补');
    e.fire('focusin', e[from]);
    assert.equal(e.img.getAttribute('tabindex'), '0', `焦点从 ${from} 来以后图片可 Tab`);
    assert.equal(e.img.getAttribute('role'), 'button');
    assert.equal(e.img.getAttribute('aria-label'), '点开放大');
    for (const key of ['Enter', ' ']) assert.ok(e.fire('keydown', e.img, {key}).prevented, key);
    assert.equal(e.opened.length, 2);
    assert.ok(!e.fire('keydown', e.img, {key: 'a'}).prevented);
    assert.ok(!e.fire('keydown', e.textarea, {key: 'Enter'}).prevented, '输入框里的 Enter 照旧发送');
    assert.ok(!e.fire('keydown', e.removeImg, {key: 'Enter'}).prevented, '移除键的 Enter 照旧移除');
    assert.equal(e.opened.length, 2);
  }
});

test('键盘：刚贴进来的图，在 Tab 按下（焦点移动之前）就补上；文件附件不补', () => {
  const e = env();
  e.fire('focusin', e.textarea);
  const late = e.addImage('data:image/png;base64,TEFURQ==');
  assert.equal(late.img.getAttribute('tabindex'), null);
  const tab = e.fire('keydown', e.textarea, {key: 'Tab', shiftKey: true});
  assert.ok(!tab.prevented, 'Tab 本身不拦');
  assert.equal(late.img.getAttribute('tabindex'), '0', 'Shift+Tab 从输入框回到附件条时新图已可 Tab');
  assert.deepEqual(e.fileCell.attrs, {}, '文件附件格子不补');
  assert.equal(e.fileName.getAttribute('tabindex'), null);
});

test('读屏：role=button 挂在 img 上，不挂在包着原生移除 <button> 的格子上；Tab 顺序是图片 → 移除', () => {
  const e = env();
  e.fire('focusin', e.removeImg);
  assert.deepEqual(e.imgCell.attrs, {}, '格子上不加 tabindex / role / aria-label');
  assert.equal(e.img.getAttribute('role'), 'button');
  assert.equal(e.removeImg.getAttribute('role'), null, '移除键不动');
  const kids = e.imgCell.children;
  assert.ok(kids.indexOf(e.img) < kids.indexOf(e.removeImg) && e.img.parent === e.removeImg.parent, 'img 和移除键是兄弟，img 在前');
});

test('离开 Metre：补上的属性原样拿掉；再回来重新补', () => {
  const e = env();
  e.fire('focusin', e.textarea);
  assert.equal(e.img.getAttribute('tabindex'), '0');
  e.setMode('chat'); e.fire('laolao:modechange', e.textarea);
  assert.deepEqual([e.img.attrs, e.img.dataset], [{}, {}], '其他模式下不留任何属性');
  e.setMode('metre'); e.fire('laolao:modechange', e.textarea);
  assert.equal(e.img.getAttribute('tabindex'), '0');
});

test('看图器还没加载时不拦，原生行为照旧', () => {
  const e = env({viewer: false});
  const ev = e.fire('click', e.img);
  assert.ok(!ev.prevented && !ev.stopped);
  e.fire('focusin', e.textarea);
  assert.ok(!e.fire('keydown', e.img, {key: 'Enter'}).prevented);
});

test('改前缺口：laolao-image-viewer.js 的选择器不含输入框缩略图，原生模板里缩略图 img 没有点击处理', () => {
  const viewer = read('ui/injections/laolao-image-viewer.js');
  const sel = /closest\?\.\("([^"]+)"\)/.exec(viewer)?.[1] || '';
  assert.ok(sel.includes('.chat-message-image'), sel);
  assert.ok(!/chat-attachment/.test(sel), '看图器本身不管输入框缩略图：' + sel);
  const page = fs.readdirSync(path.join(root, 'ui/runtime')).find((f) => /^chat-page-.*\.js$/.test(f));
  const src = read('ui/runtime/' + page);
  const at = src.indexOf('<div class="chat-attachments-preview">');
  assert.ok(at > 0, '原生输入框附件条还在');
  const tpl = src.slice(at, at + 800);
  assert.match(tpl, /<img src=\$\{wu\(t\)\} alt="Attachment preview" \/>/, '原生缩略图结构没变（变了就要重看本文件的选择器），img 上没有 @click');
});

test('接线：头片段在 suggest 后面加载、登记在 metre 区域、例外增量各 1 行；不加样式、定时器、观察器和 window.__ 赋值', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  assert.match(head, /<script defer src="\/laolao-metre-suggest\.js\?v=@hash"><\/script>\n<script defer src="\/laolao-metre-thumbs\.js\?v=@hash"><\/script>\n/);
  assert.ok(!/laolao-metre-thumbs\.css/.test(head), '不带样式文件');
  assert.ok(/"id": "metre"[\s\S]*?"laolao-metre-thumbs\.js"/.test(read('ui/injections/regions.json')));
  const ex = JSON.parse(read('tools/health/exceptions.d/linux-l26-metre-thumbs.json'));
  assert.deepEqual(ex.map((x) => [x.file, x.metric, x.add]), [['ui/injections/laolao-head.fragment.html', 'lines', 1], ['ui/injections/regions.json', 'lines', 1]]);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setInterval|setTimeout|MutationObserver|ResizeObserver|!important|\.style\b/);
  assert.doesNotMatch(code, /window\s*\.\s*__[\w$]+\s*(?:\|\||&&|\?\?)?=(?!=)/, '只读看图器，不新挂 window.__');
  assert.ok(SRC.split('\n').length < 1500);
});

// uireview 13:16Z / mac1 13:59Z：Tab 落到图片上了，但 focus 和 strip 两张图逐字节相同。原生 .chat-attachment-thumb 是
// overflow: hidden、6px 圆角，img 撑满格子，Metre 通用焦点环（[tabindex]:focus-visible，外扩 2px）画在 img 外面，整圈被格子裁掉。
// 修法：Metre 下 img 聚焦时把环画在格子自己身上（格子的 outline 不受它自己的 overflow 裁剪）。去掉这条规则这里就红。
test('焦点环画在格子上：img 聚焦时格子画钴蓝环（外扩、不被格子自己的 overflow 裁掉），只在 Metre，不加 !important', () => {
  const css = read('ui/injections/laolao-metre-chat.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const RING = /^html\[data-laolao-mode="metre"\]\s+\.chat-attachment-thumb:has\(\s*>\s*img:focus-visible\s*\)$/;
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({sels: m[1].split(',').map((s) => s.trim()), body: m[2]}));
  const ring = rules.find((r) => r.sels.some((s) => RING.test(s)));
  assert.ok(ring, 'laolao-metre-chat.css 要有一条「格子里的 img 聚焦时给格子画环」的规则');
  const decl = {};
  for (const d of ring.body.split(';')) { const at = d.indexOf(':'); if (at > 0) decl[d.slice(0, at).trim()] = d.slice(at + 1).trim(); }
  const outline = /^(\d+(?:\.\d+)?)px solid var\(--metre-cobalt\)$/.exec(decl.outline || '');
  assert.ok(outline && Number(outline[1]) >= 2, `环要是 ≥2px 的钴蓝实线：${decl.outline}`);
  const offset = /^(-?\d+(?:\.\d+)?)px$/.exec(decl['outline-offset'] || '');
  assert.ok(offset && Number(offset[1]) >= 0, `环画在格子外面（格子自己的 overflow 不裁 outline）：outline-offset ${decl['outline-offset']}`);
  assert.doesNotMatch(ring.body, /!\s*important/);
  // run 46101879996：环的下边外扩进输入框（实色底、定位元素、DOM 里靠后）被盖住。聚焦的格子要抬一层画在输入框上面。
  assert.equal(decl.position, 'relative', `聚焦格子要是定位元素，z-index 才生效：position ${decl.position}`);
  assert.ok(Number(decl['z-index']) >= 1, `聚焦格子要抬到输入框上面，环的下边才不被盖住：z-index ${decl['z-index']}`);
  // 环挂的格子就是 thumbs.js 让 img 可 Tab 的那种格子：img 是格子的直接子元素（原生模板 <div class="chat-attachment-thumb"><img …>）
  const e = env();
  e.fire('focusin', e.textarea);
  assert.equal(e.img.getAttribute('tabindex'), '0');
  assert.equal(e.img.parent, e.imgCell, 'img 是格子的直接子元素');
});
