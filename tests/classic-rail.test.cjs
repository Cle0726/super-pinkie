const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../ui/injections/laolao-classic-shell.js'),
  'utf8',
);

function makeRail(kind, parent) {
  return {
    kind,
    parentElement: parent,
    dataset: kind === 'fallback' ? {laolaoFallbackRail: '1'} : {},
    children: [],
    removed: false,
    className: 'chat-workspace-rail chat-workspace-rail--collapsed',
    attrs: new Map(),
    querySelector(selector) {
      if (selector === '.laolao-classic-rail__toggle') {
        return this.children.find((node) => node.className === 'laolao-classic-rail__toggle') || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('#pinkie-party-entry')) return [...this.children];
      return [];
    },
    append(node) {
      const oldParent = node.parentElement;
      if (oldParent?.children) {
        const index = oldParent.children.indexOf(node);
        if (index >= 0) oldParent.children.splice(index, 1);
      }
      node.parentElement = this;
      this.children.push(node);
    },
    prepend(node) {
      node.parentElement = this;
      this.children.unshift(node);
    },
    remove() {
      this.removed = true;
      this.parentElement = null;
    },
    setAttribute(name, value) {
      this.attrs.set(name, value);
    },
  };
}

function runShell({rails: initialRails = []} = {}) {
  const rails = [...initialRails];
  const body = {};
  const shell = {};
  const workbench = {
    children: rails.filter((rail) => rail.parentElement === null),
    append(node) {
      node.parentElement = this;
      if (!rails.includes(node)) rails.push(node);
      if (!this.children.includes(node)) this.children.push(node);
    },
  };
  initialRails.forEach((rail) => {
    if (!rail.parentElement) rail.parentElement = workbench;
    if (!workbench.children.includes(rail)) workbench.children.push(rail);
  });
  const rootAttributes = new Map();
  const document = {
    body,
    readyState: 'complete',
    documentElement: {
      getAttribute: (key) => rootAttributes.get(key) || null,
      setAttribute: (key, value) => rootAttributes.set(key, value),
    },
    querySelector(selector) {
      if (selector === '.shell.shell--chat' || selector.includes('openclaw-app-shell .shell.shell--chat')) return shell;
      if (selector === '.chat-workbench') return workbench;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.chat-workspace-rail') return rails.filter((rail) => !rail.removed);
      return [];
    },
    createElement(tagName) {
      if (tagName === 'aside') return makeRail('fallback', null);
      return {
        className: '',
        setAttribute() {},
        addEventListener() {},
      };
    },
  };

  vm.runInNewContext(source, {
    document,
    window: {addEventListener() {}},
    location: {search: '?session=agent:project:dashboard:test'},
    localStorage: {getItem() { return null; }},
    URLSearchParams,
    requestAnimationFrame: (callback) => { callback(); return 1; },
    setInterval() { return 1; },
  });

  return {rails, workbench};
}

test('native workspace rail retires only the marked fallback and keeps its identity', () => {
  const workbench = {};
  const fallback = makeRail('fallback', workbench);
  const native = makeRail('native', workbench);
  native.classList = {
    add() {
      throw new Error('classic shell must never tag a native workspace rail');
    },
  };
  const party = {id: 'pinkie-party-entry', parentElement: fallback};
  const roundtable = {id: 'pinkie-roundtable-entry', parentElement: fallback};
  fallback.children.push(party, roundtable);

  const {rails} = runShell({rails: [fallback, native]});

  assert.equal(fallback.removed, true);
  assert.equal(native.parentElement, workbench);
  assert.deepEqual(native.children.map((node) => node.id), [party.id, roundtable.id]);
  assert.equal(native.className.includes('laolao-classic-workspace-rail'), false);
  assert.deepEqual(rails.filter((rail) => !rail.removed), [native]);
});

test('creates one data-marked fallback only when no native workspace rail exists', () => {
  const {rails, workbench} = runShell();
  assert.equal(rails.length, 1);
  const [fallback] = rails;
  assert.equal(fallback.dataset.laolaoFallbackRail, '1');
  assert.equal(fallback.parentElement, workbench);
  assert.equal(fallback.className.includes('laolao-classic-workspace-rail'), false);
  assert.equal(fallback.children[0].className, 'laolao-classic-rail__toggle');
});

test('rail styling targets the direct native workbench child and marks fallback-only rules', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const side = read('ui/injections/laolao-side-layout.css');
  const classic = read('ui/injections/laolao-classic-shell.css');
  const subtraction = read('ui/injections/laolao-ui-subtraction.css');

  assert.match(side, /\.chat-workbench > \.chat-workspace-rail \{/);
  assert.match(side, /\.chat-workbench > \.chat-workspace-rail:not\(\.chat-workspace-rail--collapsed\)/);
  assert.match(side, /data-laolao-fallback-rail="1"/);
  assert.match(classic, /\.chat-workspace-rail\[data-laolao-fallback-rail="1"\]/);
  assert.match(subtraction, /\.chat-workspace-rail\[data-laolao-fallback-rail="1"\]/);
  assert.match(side, /\.chat-workspace-rail\.chat-workspace-rail--collapsed \{[\s\S]*border-radius: 18px !important;/);
  assert.match(side, /#pinkie-roundtable-entry,[\s\S]*#pinkie-party-entry[\s\S]*min-height: 58px !important;/);
  assert.match(side, /writing-mode: horizontal-tb !important;/);
  assert.doesNotMatch(source, /laolao-classic-workspace-rail/);
  assert.doesNotMatch(side, /laolao-classic-workspace-rail/);
  assert.doesNotMatch(classic, /laolao-classic-workspace-rail/);
  assert.doesNotMatch(subtraction, /laolao-classic-workspace-rail/);
});
