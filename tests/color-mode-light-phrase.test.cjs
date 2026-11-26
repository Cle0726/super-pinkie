// 上游中文包把 common.light 译成「浅睡」（和梦境 phase.light 撞了词），配色键会显示「颜色模式：浅睡」。
// 上游模板（ui/runtime/index-*.js，openclaw-theme-mode-toggle）：
//   <openclaw-tooltip .content=${e}><button class="theme-mode-toggle" aria-label=${e}>…
//   e = D(`common.colorModeOption`, {mode: D(`common.light` | `common.dark` | `common.system`)})
// 覆盖层只在配色键上把它统一成「配色：浅色 / 深色 / 跟随系统」；tooltip 的文字来自 .content，
// 弹出层挂在 body 上、不经过观察器，所以要连 .content 一起改。正文和梦境里的「浅睡」不能动。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function el(tag, {classes = '', attrs = {}, parent = null, props = {}} = {}) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), parentElement: parent, children: [], dataset: {}, isConnected: true,
    classSet: new Set(classes.split(/\s+/).filter(Boolean)), attrs: new Map(Object.entries(attrs)), ...props,
    get classList() { return {contains: (name) => node.classSet.has(name)}; },
    getAttribute(name) { return node.attrs.has(name) ? node.attrs.get(name) : null; },
    hasAttribute(name) { return node.attrs.has(name); },
    setAttribute(name, value) { node.attrs.set(name, String(value)); },
    removeAttribute(name) { node.attrs.delete(name); },
    matches(selector) { return selector.split(',').some((alt) => matchChain(node, alt.trim().split(/\s+/))); },
    closest(selector) {
      for (let current = node; current; current = current.parentElement) if (current.matches(selector)) return current;
      return null;
    },
    querySelectorAll(selector) {
      const out = [];
      const walk = (n) => n.children.forEach((child) => { if (child.matches(selector)) out.push(child); walk(child); });
      walk(node);
      return out;
    },
  };
  if (parent) parent.children.push(node);
  return node;
}
function matchCompound(node, compound) {
  const match = /^([a-z-]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(compound);
  if (!match) return false;
  if (match[1] && node.tagName !== match[1].toUpperCase()) return false;
  if (!match[2].split('.').filter(Boolean).every((name) => node.classSet.has(name))) return false;
  return [...match[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) =>
    value === undefined ? node.attrs.has(name) : node.attrs.get(name) === value);
}
function matchChain(node, parts) {
  if (!matchCompound(node, parts.at(-1))) return false;
  let rest = parts.slice(0, -1);
  for (let ancestor = node.parentElement; rest.length && ancestor; ancestor = ancestor.parentElement) {
    if (matchCompound(ancestor, rest.at(-1))) rest = rest.slice(0, -1);
  }
  return rest.length === 0;
}
const textNode = (nodeValue, parentElement) => ({nodeType: 3, nodeValue, parentElement, isConnected: true});

function loadPhrases(mode = null) {
  const source = read('ui/injections/laolao-phrases.js')
    .replace(/\}\)\(\);\s*$/, 'window.__phrasesTest = {localizeText, syncBrandChrome};})();');
  const window = {addEventListener() {}, dispatchEvent() {}};
  const documentElement = {getAttribute: (name) => (name === 'data-laolao-mode' ? mode : null)};
  const document = {readyState: 'loading', addEventListener() {}, title: '', documentElement};
  vm.runInNewContext(source, {
    window, document, Node: {TEXT_NODE: 3, ELEMENT_NODE: 1}, NodeFilter: {SHOW_TEXT: 4}, CustomEvent: class {}, console,
  });
  return window.__phrasesTest;
}

// 原生配色键：openclaw-tooltip 包着 button.theme-mode-toggle，两处是同一个字符串。
function colorToggle(label) {
  const app = el('openclaw-app');
  const tip = el('openclaw-tooltip', {parent: app, props: {content: label}});
  const button = el('button', {classes: 'theme-mode-toggle', attrs: {type: 'button', 'aria-label': label}, parent: tip});
  return {app, tip, button};
}

for (const mode of [null, 'metre']) {
  const {syncBrandChrome, localizeText} = loadPhrases(mode);
  const where = mode ? 'Metre' : '碧琪';

  test(`${where}：配色键的 aria-label 和 tooltip 文字从上游中文包统一成「配色：…」`, () => {
    for (const [upstream, ours] of [
      ['颜色模式：浅睡', '配色：浅色'],
      ['颜色模式：深色', '配色：深色'],
      ['颜色模式：系统', '配色：跟随系统'],
      ['顏色模式：淺層', '顏色模式：淺色'],
      // 英文兜底那一路原来就有，不能被这次改动带坏。
      ['Color mode: Light', '配色：浅色'],
    ]) {
      const {app, tip, button} = colorToggle(upstream);
      syncBrandChrome(app);
      syncBrandChrome(app);
      assert.equal(button.getAttribute('aria-label'), ours, upstream);
      assert.equal(tip.content, ours, `${upstream}（tooltip .content）`);
    }
  });

  test(`${where}：配色键以外同样的字不动，梦境的「浅睡」不动`, () => {
    const app = el('openclaw-app');
    const other = el('button', {classes: 'dreams-phase', attrs: {title: '颜色模式：浅睡', 'aria-label': '浅睡'}, parent: app});
    syncBrandChrome(app);
    assert.equal(other.getAttribute('title'), '颜色模式：浅睡');
    assert.equal(other.getAttribute('aria-label'), '浅睡');

    const phaseText = textNode('浅睡', el('span', {classes: 'dreams-phase__label', parent: app}));
    localizeText(phaseText);
    assert.equal(phaseText.nodeValue, '浅睡');

    const bodyText = textNode('颜色模式：浅睡', el('div', {classes: 'chat-text', parent: el('div', {classes: 'chat-bubble', parent: app})}));
    localizeText(bodyText);
    assert.equal(bodyText.nodeValue, '颜色模式：浅睡');

    const loose = textNode('颜色模式：浅睡', el('span', {parent: app}));
    localizeText(loose);
    assert.equal(loose.nodeValue, '颜色模式：浅睡');
  });
}

test('改名后 classic-shell 仍认得出配色键和浅色档', () => {
  const source = read('ui/injections/laolao-classic-shell.js');
  assert.ok(source.includes('[aria-label^="配色"]'));
  assert.ok(source.includes('/浅/.test(label) ? "浅色"'));
});
