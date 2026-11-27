// P4：脱敏浮窗的状态行不再把英文异常原文 / 上游错误体写进界面。
// 复发场景：网关超时时 gwRequest 抛 Error('gateway timeout')；上游模型回 4xx/5xx 时服务端
// （services/mode-architecture/index.mjs pinkie.desensitize.rewrite）把错误体原文拼进 message。
// 修复前状态行显示「失败: gateway timeout」或带英文 JSON 的原文；修复后显示中文，原文只进 console.warn。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui/injections/laolao-desensitize.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

// 只够脱敏浮窗用的小 DOM：innerHTML 里带 id 的节点按 id 建好，querySelector('#id') 能拿到。
function makeDocument() {
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.byId = new Map(); this.listeners = new Map();
      this.style = {}; this.dataset = {}; this.disabled = false; this.value = ''; this.textContent = ''; this.isConnected = true;
      this.classList = {add() {}, remove() {}, toggle() {}, contains: () => false};
    }
    set innerHTML(html) {
      this.byId = new Map();
      for (const match of String(html).matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) this.byId.set(match[2], new Element(match[1]));
    }
    get innerHTML() { return ''; }
    appendChild(node) { this.children.push(node); return node; }
    insertBefore(node) { this.children.push(node); return node; }
    remove() { this.isConnected = false; }
    contains() { return false; }
    addEventListener(type, handler) { (this.listeners.get(type) || this.listeners.set(type, []).get(type)).push(handler); }
    removeEventListener() {}
    async fire(type) { for (const handler of this.listeners.get(type) || []) await handler({preventDefault() {}, stopPropagation() {}, target: this}); }
    querySelector(selector) { return selector.startsWith('#') ? this.byId.get(selector.slice(1)) || null : null; }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return {left: 600, right: 700, top: 700, bottom: 730, width: 100, height: 30}; }
    focus() {}
  }
  const actions = new Element('div');
  const body = new Element('body');
  const document = {
    documentElement: {getAttribute: name => (name === 'data-laolao-mode' ? 'unrestricted' : null)},
    head: new Element('head'), body,
    createElement: tag => new Element(tag),
    getElementById: () => null,
    querySelector: selector => (selector === '.agent-chat__composer-actions' ? actions : null),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  return {document, actions, body};
}

async function runRewrite(gwRequest) {
  const {document, actions, body} = makeDocument();
  const warnings = [];
  const store = new Map();
  const window = {
    location: {search: ''}, innerWidth: 1440, innerHeight: 900,
    __laolaoSidebar: {gwRequest},
    addEventListener() {}, dispatchEvent() {},
  };
  const context = {
    window, document,
    console: {warn: (...args) => warnings.push(args.map(a => String(a?.stack || a?.message || a)).join(' ')), log() {}, error() {}},
    localStorage: {getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v))},
    requestAnimationFrame: fn => fn(), setTimeout: () => 0, setInterval: () => 1, clearInterval() {},
    HTMLTextAreaElement: {prototype: {}}, Event: class {}, CustomEvent: class {}, URLSearchParams,
  };
  vm.runInNewContext(source, context, {filename: 'laolao-desensitize.js'});
  const btn = actions.children[0];
  assert.ok(btn, '脱敏按钮应该挂到输入框动作栏上');
  await btn.fire('click');
  const pop = body.children.find(node => node.querySelector('#ds-run'));
  assert.ok(pop, '点按钮应该打开脱敏浮窗');
  pop.querySelector('#ds-src').value = '帮我查一下某个目标';
  await pop.querySelector('#ds-run').fire('click');
  await settle();
  return {status: pop.querySelector('#ds-status').textContent, warnings};
}

const ENGLISH_SENTENCE = /[A-Za-z]{3,}(?:[\s:_-]+[A-Za-z]{2,})+/;

test('网关超时：状态行显示中文，原文 gateway timeout 只进 console.warn', async () => {
  const {status, warnings} = await runRewrite(async () => { throw new Error('gateway timeout'); });
  assert.match(status, /^失败：/);
  assert.doesNotMatch(status, /gateway|timeout/i);
  assert.match(status, /[\u3400-\u9fff]/);
  assert.ok(warnings.some(line => /gateway timeout/.test(line)), `原文应进日志，实际：${warnings.join(' | ')}`);
});

test('网关没连上：不显示 gateway socket unavailable', async () => {
  const {status} = await runRewrite(async () => { throw new Error('gateway socket unavailable'); });
  assert.doesNotMatch(status, ENGLISH_SENTENCE);
  assert.match(status, /连上/);
});

test('上游模型 4xx/5xx：状态码保留，英文错误体不上界面', async () => {
  const raw = '上游模型响应异常 (429): {"error":{"message":"Resource has been exhausted (e.g. check quota).","code":429}}';
  const {status, warnings} = await runRewrite(async () => { throw new Error(raw); });
  assert.match(status, /429/);
  assert.doesNotMatch(status, /Resource|exhausted|quota|[{}"]/);
  assert.ok(warnings.some(line => line.includes('Resource has been exhausted')), '上游原文应进日志');
});

test('Node 系统异常：只显示中文兜底', async () => {
  const {status} = await runRewrite(async () => { throw new Error("ENOENT: no such file or directory, open 'C:/x/openclaw.json'"); });
  assert.doesNotMatch(status, /ENOENT|no such file|openclaw/);
  assert.match(status, /[\u3400-\u9fff]/);
});

test('服务端本来就是中文的提示照原样显示', async () => {
  const {status} = await runRewrite(async () => { throw new Error('模型未返回改写内容'); });
  assert.match(status, /^失败[:：]\s*模型未返回改写内容$/);
});
