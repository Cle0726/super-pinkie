// P1 innerHTML 普查（#96 linux2）：脱敏浮窗的复发测试。
// laolao-desensitize.js 打开浮窗时，原来把 `${src}`（输入框原文 / localStorage 草稿）和
// `${tgt}`（localStorage 里存的模型改写结果 res.rewritten）直接拼进 pop.innerHTML 的 <textarea> 里。
// 内容里只要有 `</textarea>` 就能跳出 textarea，后面的 `<img onerror=…>` 会变成真元素。
// 修法：模板里不再插值，挂载后用 textarea.value 赋值。这里用假 DOM 跑真文件，看写进 innerHTML 的串。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-desensitize.js'), 'utf8');

function el(tag = 'div') {
  const listeners = {};
  const byId = new Map();
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(), id: '', className: '', type: '', title: '', value: '', innerHTML: '', textContent: '',
    disabled: false, isConnected: true, style: {}, dataset: {}, children: [], listeners,
    classList: {add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)},
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    appendChild(n) { this.children.push(n); return n; },
    append(...nodes) { this.children.push(...nodes); },
    insertBefore(n) { this.children.push(n); return n; },
    remove() { this.isConnected = false; },
    contains() { return false; },
    focus() {},
    getBoundingClientRect() { return {left: 900, right: 1000, top: 700, bottom: 728, width: 100, height: 28}; },
    // 假 DOM 不解析 innerHTML：按 id 发一个稳定的子元素，足够让 openPop 往下走
    querySelector(sel) { if (!sel.startsWith('#')) return null; if (!byId.has(sel)) byId.set(sel, el('x')); return byId.get(sel); },
    querySelectorAll() { return []; },
  };
}

function openWith({live = '', draftSrc = null, draftTgt = null} = {}) {
  const store = new Map();
  if (draftSrc != null) store.set('laolao:ds-src', draftSrc);
  if (draftTgt != null) store.set('laolao:ds-tgt', draftTgt);
  const actions = el('div');
  const composer = el('textarea'); composer.value = live;
  const body = el('body'), head = el('head');
  const byId = new Map();
  const document = {
    body, head,
    documentElement: {getAttribute: (k) => (k === 'data-laolao-mode' ? 'unrestricted' : null)},
    getElementById: (id) => byId.get(id) || null,
    querySelector(sel) {
      if (sel === '.agent-chat__composer-actions') return actions;
      if (sel.includes('textarea')) return composer;
      return null;
    },
    querySelectorAll() { return []; },
    createElement(tag) { return el(tag); },
    addEventListener() {},
  };
  body.appendChild = function (n) { this.children.push(n); if (n.id) byId.set(n.id, n); return n; };
  const window = {innerWidth: 1440, innerHeight: 900, addEventListener() {}, dispatchEvent() {}};
  vm.runInNewContext(source, {
    window, document, localStorage: {getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v))},
    location: {search: ''}, URLSearchParams, HTMLTextAreaElement: function () {}, Event: function () {}, CustomEvent: function () {},
    requestAnimationFrame: (cb) => { cb(); return 1; }, setTimeout: () => 1, clearInterval() {}, setInterval: () => 1,
  });
  const btn = actions.children.find((n) => n.className === 'laolao-desensitize-btn');
  assert.ok(btn, '无限制模式下输入框旁边应挂上「脱敏」按钮');
  btn.listeners.click[0]({preventDefault() {}, stopPropagation() {}});
  const pop = byId.get('laolao-desensitize-pop');
  assert.ok(pop, '点按钮应打开浮窗');
  return {pop, src: pop.querySelector('#ds-src'), tgt: pop.querySelector('#ds-tgt')};
}

const SRC_ATTACK = '</textarea><img src=x onerror="window.__pwnedSrc=1">';
const TGT_ATTACK = '</textarea><svg onload="window.__pwnedTgt=1"></svg>';

test('输入框原文里的 </textarea> 不会跳出浮窗的 textarea', () => {
  const {pop, src} = openWith({live: SRC_ATTACK});
  assert.ok(!pop.innerHTML.includes(SRC_ATTACK), '原文不应拼进 innerHTML');
  assert.ok(!/onerror|<img/i.test(pop.innerHTML), '浮窗 HTML 里不应出现原文带进来的 <img onerror>');
  assert.equal((pop.innerHTML.match(/<\/textarea>/g) || []).length, 2, '浮窗只有自己的两个 textarea');
  assert.equal(src.value, SRC_ATTACK, '原文按纯文本原样放进 textarea');
});

test('localStorage 里存的模型改写结果不会跳出 textarea', () => {
  const {pop, tgt} = openWith({draftTgt: TGT_ATTACK});
  assert.ok(!pop.innerHTML.includes(TGT_ATTACK), '改写结果不应拼进 innerHTML');
  assert.ok(!/onload/i.test(pop.innerHTML), '浮窗 HTML 里不应出现改写结果带进来的 onload');
  assert.equal(tgt.value, TGT_ATTACK, '改写结果按纯文本原样放进 textarea');
  assert.match(pop.innerHTML, /id="ds-result" style="display:flex"/, '有改写结果时结果区照常显示');
});

test('普通文字照常回填：输入框优先，没有就用草稿', () => {
  const plain = openWith({live: '  a & b < c  ', draftSrc: '旧草稿', draftTgt: ''});
  assert.equal(plain.src.value, 'a & b < c');
  assert.equal(plain.tgt.value, '');
  assert.match(plain.pop.innerHTML, /id="ds-result" style="display:none"/, '没有改写结果时结果区收着');
  const draft = openWith({draftSrc: '旧草稿', draftTgt: '改好的话'});
  assert.equal(draft.src.value, '旧草稿');
  assert.equal(draft.tgt.value, '改好的话');
});
