const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('ui/injections/laolao-laser-pointer.js');

test('laser pointer is deployed by both installers at the same version', () => {
  const mac = read('installer/macos/apply-theme.sh');
  const win = read('installer/windows/apply-theme.ps1');
  assert.match(mac, /laolao-laser-pointer\.js \\/, 'macOS asset copy list');
  assert.match(mac, /\.\/laolao-laser-pointer\.js\?v=laser4/, 'macOS injection pins laser4');
  assert.match(win, /"laolao-laser-pointer\.js"/, 'Windows asset copy list');
  assert.match(win, /\.\/laolao-laser-pointer\.js\?v=laser4/, 'Windows head tag pins laser4');
});

test('laser entry joins the compact rail selectors and hides when expanded', () => {
  const css = read('ui/injections/laolao-side-layout.css');
  assert.match(css, /chat-workspace-rail--collapsed > :is\([\s\S]*#pinkie-party-entry,[\s\S]*#pinkie-laser-entry[\s\S]*min-height: 58px !important;/);
  assert.match(css, /chat-workspace-rail--collapsed > :is\([\s\S]*#pinkie-laser-entry[\s\S]*\) span \{/);
  assert.match(css, /:not\(\.chat-workspace-rail--collapsed\) > :is\([\s\S]*#pinkie-laser-entry[\s\S]*display: none !important;/);
  const shell = read('ui/injections/laolao-classic-shell.js');
  assert.match(shell, /:scope > #pinkie-roundtable-entry, :scope > #pinkie-laser-entry/);
});

test('laser engine follows the observer diet and pointer contracts', () => {
  // The page froze once from subtree observers copying mutation records
  // during streaming; rail launchers poll on a slow timer instead. (The word
  // itself appears in a comment, so pin the constructor call.)
  assert.doesNotMatch(source, /new MutationObserver/);
  assert.match(source, /setInterval\(mount, 1500\)/);
  // Escape always leaves laser mode; the rail button toggles it.
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /aria-pressed/);
  // Native cursor is hidden only while the laser is on.
  assert.match(source, /html\.laolao-laser-on[^{]*\{cursor:none !important\}/);
  // Overlay must sit above the link viewer (z-index 10001).
  assert.match(source, /z-index:10002/);
  // Reduced motion users get a calm dot, not particles and pulses.
  assert.match(source, /prefers-reduced-motion: reduce/);
  // The trail is a real presentation-laser stroke, not disconnected dots:
  // timestamped samples form a smoothed (quadratic) self-consuming polyline
  // whose tail melts by age, and the resting stroke fades as one group.
  assert.match(source, /points\.push\(\{ x: event\.clientX, y: event\.clientY, t: now \}\)/);
  assert.match(source, /quadraticCurveTo/);
  assert.match(source, /TRAIL_MS/);
  assert.match(source, /IDLE_MS/);
  assert.match(source, /groupFade/);
  // The look stays restrained: a hairline stroke with a whisper aura, a small
  // crisp head, and exactly one hairline ring per click — no flashy extras.
  assert.doesNotMatch(source, /flare/i);
  assert.doesNotMatch(source, /pulse/i);
  // Right-clicking the rail button opens the settings popover; parameters
  // persist to localStorage and apply live to the frame loop.
  assert.match(source, /addEventListener\('contextmenu'/);
  assert.match(source, /laolao:laser-settings\.v1/);
  assert.match(source, /openSettings/);
  assert.match(source, /input\.type = 'range'/);
  // 轨迹持续时间最长 6 秒，停笔驻留随轨迹时长联动。
  assert.match(source, /'轨迹时长', 400, 6000/);
  assert.match(source, /IDLE_MS = Math\.max\(1300, settings\.trail \* 0\.8\)/);
  // Leaving laser mode must release every listener and the canvas.
  assert.match(source, /removeEventListener\('pointermove', onMove\)/);
  assert.match(source, /canvas\?\.remove\(\)/);
  assert.match(source, /cancelAnimationFrame\(rafId\)/);
});

test('launcher mounts into the rail ahead of the party entry, idempotently', () => {
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.parentElement = null;
      this.attributes = {}; this.listeners = {}; this.textContent = ''; this.innerHTML = '';
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
      const walk = n => [n, ...n.children.flatMap(walk)];
      return walk(this).find(n => id && n.id === id) || null;
    }
  }
  const rootEl = new Element('html'), head = new Element('head'), body = new Element('body');
  let rail = new Element('aside');
  const party = new Element('a'); party.id = 'pinkie-party-entry'; rail.append(party);
  rootEl.append(head, body, rail);
  const walk = n => [n, ...n.children.flatMap(walk)];
  const document = {
    head, body, documentElement: rootEl,
    currentScript: { src: 'http://127.0.0.1:18789/laolao-laser-pointer.js' },
    querySelector: selector => (selector === '.chat-workspace-rail' ? rail : null),
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
  assert.equal(btn.parentElement, rail);
  assert.equal(rail.children[0], btn, 'laser sits above the party entry');
  assert.equal(btn.attributes['aria-pressed'], 'false');
  assert.equal(btn.children.at(-1).textContent, '激光笔');

  poll(); poll();
  assert.equal(rail.children.filter(n => n.id === 'pinkie-laser-entry').length, 1, 'no duplicates');

  rail.remove(); rail = new Element('aside'); rootEl.append(rail); poll();
  assert.equal(document.getElementById('pinkie-laser-entry').parentElement, rail, 'remounts after rail swap');

  rail.remove(); rail = null; poll();
  assert.equal(document.getElementById('pinkie-laser-entry'), undefined, 'leaves with the rail');

  assert.equal(typeof sandbox.window.__laolaoLaser?.toggle, 'function', 'debug handle exposed');
});
