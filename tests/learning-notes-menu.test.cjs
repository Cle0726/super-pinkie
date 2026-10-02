const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('ui/injections/laolao-learning-stage.css');
const source = read('ui/injections/laolao-learning-stage.js');

const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule ${selector}`);
  return match[1];
};
const zIndexOf = selector => Number(rule(selector).match(/z-index:\s*(\d+)/)?.[1]);

test('an open note menu paints above sticky group headers, card actions and the undo bar', () => {
  assert.match(rule('.laolao-learning-note-group > summary'), /position: sticky/);
  const floating = rule('.laolao-learning-note__menu.is-floating');
  assert.match(floating, /right: auto/);
  const menu = zIndexOf('.laolao-learning-note__menu.is-floating');
  for (const selector of ['.laolao-learning-note-group > summary', '.laolao-learning-note__menu-wrap', '.laolao-learning-notes__undo']) {
    assert.ok(menu > zIndexOf(selector), `open menu (z ${menu}) must sit above ${selector} (z ${zIndexOf(selector)})`);
  }
  // A hovered card gets a transform, which makes it its own stacking context; the menu therefore
  // has to leave the card instead of relying on its z-index inside it.
  assert.match(css, /\.laolao-learning-note:hover,\n\.laolao-learning-note\.has-open-menu \{[^}]*transform: translateY\(-1px\)/);
  assert.match(source, /closeNoteMenu\(\);\s*list\.replaceChildren\(\)/);
  assert.match(source, /const closeNotebook = \(\) => \{\s*closeNoteMenu\(\);/);
  assert.match(source, /contentWrap\.addEventListener\("scroll", placeNoteMenu/);
});

function harness() {
  const body = {connected: true, children: []};
  const rect = (left, top, right, bottom) => ({left, top, right, bottom, width: right - left, height: bottom - top});
  const node = (name, box = rect(0, 0, 0, 0)) => {
    const classes = new Set();
    const item = {
      name, box, parent: null, children: [], hidden: false, dataset: {}, attributes: {}, clientTop: 1, clientLeft: 1,
      offsetWidth: 0, offsetHeight: 0, focused: false,
      style: {removeProperty(key) { delete this[key]; }},
      classList: {
        add: (...names) => names.forEach(value => classes.add(value)),
        remove: (...names) => names.forEach(value => classes.delete(value)),
        contains: value => classes.has(value),
        toggle: (value, force) => ((force ?? !classes.has(value)) ? classes.add(value) : classes.delete(value)),
      },
      get isConnected() { let at = this.parent; while (at && at !== body) at = at.parent; return at === body; },
      append(...nodes) {
        for (const child of nodes) {
          if (child.parent) child.parent.children = child.parent.children.filter(entry => entry !== child);
          child.parent = this; this.children.push(child);
        }
      },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(entry => entry !== this); this.parent = null; },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getBoundingClientRect() { return this.box; },
      querySelector(selector) { return selector === '.laolao-learning-notes__content' ? content : null; },
      focus() { this.focused = true; },
    };
    return item;
  };
  // The drawer, its scrolling list and one note card, laid out like the 408px drawer on a 1020x760 window.
  const drawer = node('drawer', rect(600, 12, 1008, 748));
  const content = node('content', rect(601, 66, 1007, 747));
  const card = node('card'); const home = node('menu-wrap'); const more = node('more'); const menu = node('menu');
  menu.offsetWidth = 122; menu.offsetHeight = 160; menu.hidden = true;
  drawer.parent = body; drawer.append(content); content.append(card); card.append(home); home.append(more, menu);
  drawer.classList.add('is-open');

  const window = {addEventListener() {}};
  const document = {
    readyState: 'loading', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: () => node('created'), body,
  };
  const exposed = source.replace(/\}\)\(\);\s*$/, 'window.__menuTest = {state, openNoteMenu, closeNoteMenu, placeNoteMenu, closeNotebook};})();');
  assert.notEqual(exposed, source);
  vm.runInNewContext(exposed, {window, document, location: {href: 'http://localhost/chat?session=agent:learning:menu'}, URL, setInterval() { return 1; }, setTimeout() { return 1; }, clearTimeout() {}});
  const hooks = window.__menuTest;
  hooks.state.drawer = drawer;
  return {hooks, rect, drawer, content, card, home, more, menu};
}

test('opening a note menu lifts it into the drawer layer and keeps it under the button when there is room', () => {
  const {hooks, rect, drawer, card, home, more, menu} = harness();
  more.box = rect(960, 430, 987, 457);
  hooks.openNoteMenu(card, home, more, menu);
  assert.equal(menu.parent, drawer, 'the open menu must leave the card and the scrolling list');
  assert.equal(menu.hidden, false);
  assert.equal(menu.classList.contains('is-floating'), true);
  assert.equal(menu.dataset.placement, 'below');
  assert.equal(menu.style.top, `${457 + 4 - 12 - 1}px`);
  assert.equal(menu.style.left, `${987 - 122 - 600 - 1}px`);
  assert.equal(card.classList.contains('has-open-menu'), true);
  assert.equal(more.attributes['aria-expanded'], 'true');

  hooks.closeNoteMenu({restoreFocus: true});
  assert.equal(menu.parent, home, 'closing returns the menu to its card');
  assert.equal(menu.hidden, true);
  assert.equal(menu.classList.contains('is-floating'), false);
  assert.equal(menu.style.top, undefined);
  assert.equal(menu.dataset.placement, undefined);
  assert.equal(card.classList.contains('has-open-menu'), false);
  assert.equal(more.attributes['aria-expanded'], 'false');
  assert.equal(more.focused, true);
  assert.equal(hooks.state.noteMenu, null);
});

test('a note menu near the bottom of the visible list flips upward instead of being clipped', () => {
  const {hooks, rect, card, home, more, menu} = harness();
  more.box = rect(960, 640, 987, 667);
  hooks.openNoteMenu(card, home, more, menu);
  assert.equal(menu.dataset.placement, 'above');
  const top = Number.parseInt(menu.style.top, 10) + 12 + 1;
  assert.equal(top + 160, 640 - 4, 'flipped menu ends just above the button');
  assert.ok(top >= 66 + 8, 'flipped menu stays inside the visible list');
});

test('a note menu closes when its button scrolls out of view, the list re-renders, or the drawer closes', () => {
  const {hooks, rect, card, home, more, menu} = harness();
  more.box = rect(960, 430, 987, 457);
  hooks.openNoteMenu(card, home, more, menu);
  more.box = rect(960, 30, 987, 57);
  hooks.placeNoteMenu();
  assert.equal(hooks.state.noteMenu, null);
  assert.equal(menu.hidden, true);

  more.box = rect(960, 430, 987, 457);
  hooks.openNoteMenu(card, home, more, menu);
  card.remove();
  hooks.closeNoteMenu();
  assert.equal(menu.parent, null, 'a menu whose card was re-rendered away is discarded, not left floating');

  const second = harness();
  second.more.box = rect(960, 430, 987, 457);
  second.hooks.openNoteMenu(second.card, second.home, second.more, second.menu);
  second.hooks.closeNotebook();
  assert.equal(second.hooks.state.noteMenu, null);
  assert.equal(second.menu.parent, second.home);
});

test('learning stage cache keys match across the head fragment and both installers', () => {
  const fragment = read('ui/injections/laolao-head.fragment.html');
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  for (const asset of ['css', 'js']) {
    const key = fragment.match(new RegExp(`laolao-learning-stage\\.${asset}\\?v=([a-z]+\\d+)`))[1];
    assert.equal(key, 'learning9');
    const macKeys = [...mac.matchAll(new RegExp(`laolao-learning-stage\\.${asset}\\?v=([a-z]+\\d+)`, 'g'))].map(match => match[1]);
    assert.ok(macKeys.length >= 2);
    assert.deepEqual([...new Set(macKeys)], [key]);
    assert.match(windows, new RegExp(`laolao-learning-stage\\.${asset}\\?v=${key}`));
    assert.match(windows, new RegExp(`'laolao-learning-stage\\.${asset}' = '${key}'`));
  }
  assert.deepEqual([...fs.readFileSync(path.join(root, 'installer/windows/apply-theme.ps1')).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
