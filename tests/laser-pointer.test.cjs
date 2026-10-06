const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('ui/injections/laolao-laser-pointer.js');

test('presentation toolbox is deployed by both installers at the same version', () => {
  const mac = read('installer/macos/apply-theme.sh');
  const win = read('installer/windows/apply-theme.ps1');
  assert.match(mac, /laolao-laser-pointer\.js \\/, 'macOS asset copy list');
  assert.match(mac, /\.\/laolao-laser-pointer\.js\?v=laser8/, 'macOS injection pins laser8');
  assert.match(win, /"laolao-laser-pointer\.js"/, 'Windows asset copy list');
  assert.match(win, /\.\/laolao-laser-pointer\.js\?v=laser8/, 'Windows head tag pins laser8');
});

test('toolbox entry lives in the global sidebar footer, not the per-mode rail', () => {
  // The launcher is global: it mounts into the sidebar footer icon bar so it
  // is reachable from every mode, and it reuses the native footer icon look.
  assert.match(source, /querySelector\('\.sidebar-shell__footer'\)/);
  assert.match(source, /sidebar-footer-actions/);
  assert.match(source, /sidebar-brand__icon sidebar-footer-icon/);
  // The per-mode workspace rail must no longer carry or babysit this entry.
  const css = read('ui/injections/laolao-side-layout.css');
  assert.doesNotMatch(css, /#pinkie-laser-entry/);
  const shell = read('ui/injections/laolao-classic-shell.js');
  assert.doesNotMatch(shell, /#pinkie-laser-entry/);
});

test('toolbox engine follows the observer diet and pointer contracts', () => {
  // The page froze once from subtree observers copying mutation records
  // during streaming; launchers poll on a slow timer instead. (The word
  // itself appears in a comment, so pin the constructor call.)
  assert.doesNotMatch(source, /new MutationObserver/);
  assert.match(source, /setInterval\(mount, 1500\)/);
  // Escape always leaves the toolbox; the footer button toggles it.
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /aria-pressed/);
  // Native cursor is hidden only while the toolbox is on.
  assert.match(source, /html\.laolao-laser-on[^{]*\{cursor:none !important\}/);
  // …but the toolbar and settings panel are interactive chrome: the pointer
  // must be restored over them, or there is no way to see what you click.
  assert.match(source, /#pinkie-laser-toolbar \*\{cursor:pointer !important\}/);
  assert.match(source, /#pinkie-laser-settings \*\{cursor:auto !important\}/);
  // Overlay must sit above the link viewer (z-index 10001).
  assert.match(source, /z-index:10002/);
  // Reduced motion users get a calm experience.
  assert.match(source, /prefers-reduced-motion: reduce/);
  // The laser trail is a real presentation-laser stroke: timestamped samples
  // form a smoothed (quadratic) self-consuming polyline whose tail melts by
  // age, and the resting stroke fades as one group.
  assert.match(source, /points\.push\(\{ x: event\.clientX, y: event\.clientY, t: now \}\)/);
  assert.match(source, /quadraticCurveTo/);
  assert.match(source, /TRAIL_MS/);
  assert.match(source, /IDLE_MS/);
  assert.match(source, /groupFade/);
  // The look stays restrained: hairline strokes, a whisper aura, one crisp
  // ring per click — no flashy extras.
  assert.doesNotMatch(source, /flare/i);
  assert.doesNotMatch(source, /pulse/i);
  // Right-clicking the footer button opens the settings popover; parameters
  // persist to localStorage and apply live to the frame loop.
  assert.match(source, /addEventListener\('contextmenu'/);
  assert.match(source, /laolao:laser-settings\.v2/);
  assert.match(source, /openSettings/);
  assert.match(source, /input\.type = 'range'/);
  // 轨迹持续时间最长 6 秒，停笔驻留随轨迹时长联动。
  assert.match(source, /'轨迹时长', 400, 6000/);
  assert.match(source, /IDLE_MS = Math\.max\(1300, settings\.trail \* 0\.8\)/);
  // Leaving the toolbox must release every listener and the canvas.
  assert.match(source, /removeEventListener\('pointermove', onMove\)/);
  assert.match(source, /canvas\?\.remove\(\)/);
  assert.match(source, /cancelAnimationFrame\(rafId\)/);
});

test('five tools with mac-first keyboard and wheel interactions', () => {
  // 激光 / 画笔 / 荧光 / 聚光 / 放大镜, switched by digit keys 1-5.
  assert.match(source, /TOOL_ORDER = \['laser', 'pen', 'hl', 'spot', 'mag'\]/);
  assert.match(source, /TOOL_ORDER\[Number\(event\.key\) - 1\]/);
  // macOS first: Cmd+Z undo / Cmd+Shift+Z redo (Ctrl accepted for parity).
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(source, /undoStroke/);
  assert.match(source, /redoStroke/);
  // Shift+wheel retunes the active tool without blocking normal scrolling.
  assert.match(source, /!event\.shiftKey\) return/);
  // Magnifier uses screen capture but must degrade gracefully.
  assert.match(source, /navigator\.mediaDevices\?\.getDisplayMedia/);
  assert.match(source, /setTool\('spot'\)/);
  // Floating toolbar exists with undo / redo / clear / close actions.
  assert.match(source, /pinkie-laser-toolbar/);
  assert.match(source, /data-act="undo"/);
  assert.match(source, /clearStrokes/);
  // The bar is edge-docked and auto-hides: it must never cover the composer.
  assert.match(source, /flex-direction:column/);
  assert.match(source, /translateX\(calc\(-100% \+ 8px\)\)/);
  assert.match(source, /x < 56/);
  assert.match(source, /x > 220/);
  // Debug handle exposes the toolbox surface.
  assert.match(source, /window\.__laolaoLaser = \{/);
  assert.match(source, /setTool,/);
});

test('launcher mounts into the sidebar footer ahead of the more button, idempotently', () => {
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.parentElement = null;
      this.attributes = {}; this.listeners = {}; this.textContent = ''; this.innerHTML = '';
      this.className = '';
    }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    before(node) {
      node.remove();
      const at = this.parentElement.children.indexOf(this);
      node.parentElement = this.parentElement;
      this.parentElement.children.splice(at, 0, node);
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this);
      this.parentElement = null;
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    querySelector(selector) {
      const id = selector.startsWith('#') ? selector.slice(1) : null;
      const cls = selector.startsWith('.') ? selector.slice(1) : null;
      const walk = n => [n, ...n.children.flatMap(walk)];
      return walk(this).find(n =>
        (id && n.id === id) || (cls && String(n.className).split(' ').includes(cls))) || null;
    }
  }
  const rootEl = new Element('html'), head = new Element('head'), body = new Element('body');
  let footer = new Element('div');
  const actions = new Element('div'); actions.className = 'sidebar-footer-actions';
  const more = new Element('button'); more.className = 'sidebar-brand__icon sidebar-footer-icon laolao-footer-more';
  actions.append(more);
  footer.append(actions);
  rootEl.append(head, body, footer);
  const walk = n => [n, ...n.children.flatMap(walk)];
  const document = {
    head, body, documentElement: rootEl,
    currentScript: { src: 'http://127.0.0.1:18789/laolao-laser-pointer.js' },
    querySelector: selector => (selector === '.sidebar-shell__footer' ? footer : null),
    getElementById: id => walk(rootEl).find(n => n.id === id),
    createElement: tag => new Element(tag),
  };
  let poll;
  const sandbox = {
    document, window: { matchMedia: () => ({ matches: false }) },
    location: { href: 'http://127.0.0.1:18789/' },
    setInterval: fn => { poll = fn; return 0; },
    requestAnimationFrame: fn => fn(),
    setTimeout: () => 0, clearTimeout: () => {},
  };
  sandbox.window.__laolaoLaser = undefined;
  vm.runInNewContext(source, sandbox);

  const btn = document.getElementById('pinkie-laser-entry');
  assert.ok(btn, 'entry mounted');
  assert.equal(btn.parentElement, actions, 'mounts into the footer actions bar');
  assert.equal(actions.children[0], btn, 'sits ahead of the more-tools button');
  assert.match(btn.className, /sidebar-footer-icon/, 'reuses the native footer icon look');
  assert.equal(btn.attributes['aria-pressed'], 'false');

  poll(); poll();
  assert.equal(actions.children.filter(n => n.id === 'pinkie-laser-entry').length, 1, 'no duplicates');

  footer.remove(); footer = new Element('div'); rootEl.append(footer); poll();
  assert.equal(document.getElementById('pinkie-laser-entry').parentElement, footer, 'remounts after footer swap');

  footer.remove(); footer = null; poll();
  assert.equal(document.getElementById('pinkie-laser-entry'), undefined, 'leaves with the footer');

  const handle = sandbox.window.__laolaoLaser;
  assert.equal(typeof handle?.toggle, 'function', 'debug handle exposed');
  assert.equal(typeof handle?.setTool, 'function', 'tool switching exposed');
  assert.equal(typeof handle?.undo, 'function', 'undo exposed');
});
