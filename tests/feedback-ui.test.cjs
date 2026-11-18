const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function makeDom() {
  const makeNode = (tag) => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      className: '',
      id: '',
      textContent: '',
      hidden: false,
      disabled: false,
      dataset: {},
      attributes: new Map(),
      children: [],
      listeners: new Map(),
      parentNode: null,
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      getAttribute(k) { return this.attributes.get(k) ?? null; },
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      },
      dispatch(type, event = {}) {
        for (const fn of this.listeners.get(type) || []) fn(event);
      },
      append(...nodes) {
        for (const child of nodes) {
          if (child && typeof child === 'object') {
            child.parentNode = this;
            this.children.push(child);
          }
        }
      },
      before(node) {
        if (!this.parentNode) return;
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) {
          node.parentNode = this.parentNode;
          this.parentNode.children.splice(idx, 0, node);
        }
      },
      remove() {
        if (!this.parentNode) return;
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
      },
      focus() {},
      querySelector(sel) {
        if (sel.startsWith('#')) {
          const id = sel.slice(1);
          const walk = (n) => {
            if (n.id === id) return n;
            for (const c of n.children || []) { const hit = walk(c); if (hit) return hit; }
            return null;
          };
          return walk(this);
        }
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          const walk = (n) => {
            if (String(n.className || '').split(/\s+/).includes(cls)) return n;
            for (const c of n.children || []) { const hit = walk(c); if (hit) return hit; }
            return null;
          };
          return walk(this);
        }
        return null;
      },
      closest(sel) {
        if (sel.startsWith('#') && this.id === sel.slice(1)) return this;
        return this.parentNode ? this.parentNode.closest?.(sel) || null : null;
      },
    };
    return el;
  };
  const body = makeNode('body');
  const document = {
    readyState: 'complete',
    body,
    documentElement: makeNode('html'),
    createElement: (tag) => makeNode(tag),
    getElementById: (id) => body.querySelector(`#${id}`),
    querySelector: (sel) => body.querySelector(sel),
    addEventListener() {},
  };
  return {document, body, makeNode};
}

function loadFeedbackUi(gwRequest) {
  const {document, body, makeNode} = makeDom();
  const listeners = new Map();
  const window = {
    location: {href: 'http://127.0.0.1:18789/chat'},
    __laolaoSidebar: {gwRequest},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
  };
  vm.runInNewContext(read('ui/injections/laolao-feedback.js'), {
    window, document, URL, JSON, Date, Number, String, Boolean, Array, Promise, Math,
  }, {filename: 'laolao-feedback.js'});
  return {window, document, body, makeNode};
}

test('feedback UI assets are registered in shared head and both installers', () => {
  require('./fixtures/shared-ui.cjs').sharedUi({
    entries: ['laolao-feedback.css', 'laolao-feedback.js'],
    assets: [],
  });
});

test('release build prompts once on first launch with two equal buttons, dev build never prompts', async () => {
  const devCalls = [];
  const devUi = loadFeedbackUi(async (method) => {
    devCalls.push(method);
    return {ok: true, isRelease: false, asked: false, consent: false, localDebug: false, queueCount: 0};
  });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(devUi.body.querySelector('#pinkie-feedback-onboarding'), null);
  assert.ok(devCalls.includes('pinkie.feedback.status'));

  let state = {ok: true, isRelease: true, asked: false, consent: false, localDebug: false, queueCount: 0, uploadedCount: 0};
  const relCalls = [];
  const relUi = loadFeedbackUi(async (method, params) => {
    relCalls.push({method, params});
    if (method === 'pinkie.feedback.setPrefs') {
      state = {...state, consent: Boolean(params.consent), asked: true};
    }
    return state;
  });
  await new Promise(r => setTimeout(r, 20));
  const modal = relUi.body.querySelector('#pinkie-feedback-onboarding');
  assert.ok(modal, 'first-launch prompt should appear in release build');

  // 找到两个分量一致的按钮并测试点击「愿意帮忙」
  const buttons = [];
  const walk = (n) => {
    if (n.tagName === 'BUTTON' && n.className === 'pinkie-feedback-modal__equal-btn') buttons.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(modal);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].textContent, '暂不开启');
  assert.equal(buttons[1].textContent, '愿意帮忙');
  assert.equal(buttons[0].className, buttons[1].className);

  buttons[1].dispatch('click');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(relCalls.some(c => c.method === 'pinkie.feedback.setPrefs' && c.params.consent === true && c.params.asked === true), true);
  assert.equal(relUi.body.querySelector('#pinkie-feedback-onboarding'), null);
  assert.equal(await relUi.window.__pinkieFeedback.checkOnboarding(), false);
});

test('settings card supports toggle, previewing queued JSON, and clearing pending local records', async () => {
  let state = {ok: true, isRelease: true, asked: true, consent: true, localDebug: false, queueCount: 1, uploadedCount: 0};
  const rpcCalls = [];
  const ui = loadFeedbackUi(async (method, params) => {
    rpcCalls.push({method, params});
    if (method === 'pinkie.feedback.status') return state;
    if (method === 'pinkie.feedback.setPrefs') {
      state = {...state, consent: Boolean(params.consent)};
      return state;
    }
    if (method === 'pinkie.feedback.preview') {
      return {
        ok: true,
        count: state.queueCount,
        items: state.queueCount ? [{id: 'u1', type: 'usage', mode: 'project', workKind: 'code', outcome: 'success'}] : [],
        sample: {id: '0', type: 'usage'},
        status: state,
      };
    }
    if (method === 'pinkie.feedback.clear') {
      const cleared = state.queueCount;
      state = {...state, queueCount: 0};
      return {ok: true, cleared, status: state};
    }
    return {ok: true};
  });

  const scroll = ui.makeNode('div');
  ui.makeNode('footer');
  const card = ui.window.__pinkieFeedback.mount(scroll);
  assert.ok(card);
  await new Promise(r => setTimeout(r, 20));

  await ui.window.__pinkieFeedback.openPreview();
  const previewPre = ui.body.querySelector('.pinkie-feedback-modal__pre');
  assert.ok(previewPre);
  assert.match(previewPre.textContent, /"workKind": "code"/);

  await ui.window.__pinkieFeedback.clearPending();
  assert.equal(state.queueCount, 0);
  assert.equal(rpcCalls.some(c => c.method === 'pinkie.feedback.clear'), true);
});
