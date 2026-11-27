// T3 #12（L26）：Metre 输入框图片缩略条点开放大。laolao-metre-thumbs.js 在极简假 DOM 里跑，不启动浏览器。
// 改前：原生输入框附件条（.chat-attachments-preview > .chat-attachment-thumb > img）只画缩略图，点了没反应，
// laolao-image-viewer.js 的选择器只认对话区的 .chat-message-image。改后：Metre 下点缩略图 / Enter 用同一个看图器打开原图；
// 移除键、文件附件、其他模式一律不动（反例）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SRC = read('ui/injections/laolao-metre-thumbs.js');

class El {
  constructor(tag, cls = '') { this.tagName = tag.toUpperCase(); this.className = cls; this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
  has(c) { return this.className.split(/\s+/).includes(c); }
  // 只认本文件用到的几种选择器
  matches(sel) {
    return sel.split(',').map((s) => s.trim()).some((s) => {
      if (s === 'textarea' || s === 'input') return this.tagName === s.toUpperCase();
      if (s === '[contenteditable="true"]') return this.attrs.contenteditable === 'true';
      if (s === '.chat-attachment-remove') return this.has('chat-attachment-remove');
      if (s === '.chat-attachments-preview .chat-attachment-thumb:not(.chat-attachment-thumb--file)') {
        if (!this.has('chat-attachment-thumb') || this.has('chat-attachment-thumb--file')) return false;
        for (let n = this.parent; n; n = n.parent) if (n.has?.('chat-attachments-preview')) return true;
        return false;
      }
      if (s === 'img') return this.tagName === 'IMG';
      throw new Error('fake DOM does not know selector: ' + s);
    });
  }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches?.(sel)) return n; return null; }
  querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const d = c.querySelector(sel); if (d) return d; } return null; }
}

function env({mode = 'metre', viewer = true} = {}) {
  const listen = {};
  const opened = [];
  const win = {addEventListener: (t, f, cap) => { (listen[t] ||= []).push({f, cap}); }, Pinkie: {}};
  if (viewer) win.__laolaoImageViewer = {open: (src, alt) => opened.push([src, alt]), close() {}};
  const html = {getAttribute: (k) => (k === 'data-laolao-mode' ? mode : null)};
  vm.runInNewContext(SRC, {window: win, document: {documentElement: html}});

  // 原生 uy() 的结构：一张图片附件 + 一个文件附件，各带移除键
  const strip = new El('div', 'chat-attachments-preview');
  const imgCell = new El('div', 'chat-attachment-thumb');
  const img = new El('img'); img.src = 'data:image/png;base64,QUJD'; img.alt = 'Attachment preview';
  const removeImg = new El('button', 'chat-attachment-remove');
  imgCell.append(img, removeImg);
  const fileCell = new El('div', 'chat-attachment-thumb chat-attachment-thumb--file');
  const fileName = new El('span', 'chat-attachment-file__name'); const removeFile = new El('button', 'chat-attachment-remove');
  fileCell.append(fileName, removeFile);
  strip.append(imgCell, fileCell);
  const textarea = new El('textarea');
  const msgImg = new El('img', 'chat-message-image'); msgImg.src = 'data:image/png;base64,REVG';

  const fire = (type, target, extra = {}) => {
    const ev = {type, target, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra};
    for (const {f} of listen[type] || []) f(ev);
    return ev;
  };
  return {win, listen, opened, imgCell, img, removeImg, fileCell, fileName, removeFile, textarea, msgImg, fire, setMode: (m) => { mode = m; }};
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
    e.fire('pointerover', e.img); e.fire('focusin', e.imgCell);
    const key = e.fire('keydown', e.imgCell, {key: 'Enter'});
    assert.deepEqual(e.opened, [], `mode=${mode}`);
    assert.ok(!ev.prevented && !ev.stopped && !key.prevented, `mode=${mode} 不拦`);
    assert.deepEqual(e.imgCell.attrs, {}, `mode=${mode} 不补属性`);
    e.setMode('metre');
    e.fire('click', e.img);
    assert.equal(e.opened.length, 1, '切回 Metre 生效');
  }
});

test('键盘：指针 / 焦点经过补 tabindex 和 role=button；Enter / 空格打开；输入框里打字的 Enter 不拦', () => {
  const e = env();
  e.fire('pointerover', e.img);
  assert.equal(e.imgCell.getAttribute('tabindex'), '0');
  assert.equal(e.imgCell.getAttribute('role'), 'button');
  assert.equal(e.imgCell.getAttribute('aria-label'), '点开放大');
  assert.equal(e.fileCell.getAttribute('tabindex'), null, '文件附件不补');
  e.fire('focusin', e.fileCell); assert.equal(e.fileCell.getAttribute('tabindex'), null);
  for (const key of ['Enter', ' ']) assert.ok(e.fire('keydown', e.imgCell, {key}).prevented, key);
  assert.equal(e.opened.length, 2);
  assert.ok(!e.fire('keydown', e.imgCell, {key: 'a'}).prevented);
  assert.ok(!e.fire('keydown', e.textarea, {key: 'Enter'}).prevented, '输入框里的 Enter 照旧发送');
  assert.ok(!e.fire('keydown', e.removeImg, {key: 'Enter'}).prevented, '移除键的 Enter 照旧移除');
  assert.equal(e.opened.length, 2);
});

test('看图器还没加载时不拦，原生行为照旧', () => {
  const e = env({viewer: false});
  const ev = e.fire('click', e.img);
  assert.ok(!ev.prevented && !ev.stopped);
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
