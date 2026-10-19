const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/* A deliberately tiny DOM: only the compound selectors gaze.js actually uses
   (`.a`, `input.a`, `:scope > .a`) plus a comma list. Anything else throws, so a new
   selector in the module cannot silently pass this test. */
function matches(node, selector, scope = node.parentElement) {
  for (const alternative of selector.split(',').map((part) => part.trim())) {
    if (alternative.startsWith(':scope > ')) {
      if (node.parentElement === scope && simple(node, alternative.slice(9))) return true;
      continue;
    }
    if (simple(node, alternative)) return true;
  }
  return false;
}
function simple(node, selector) {
  const match = /^([a-z]*)((?:\.[\w-]+)*)$/i.exec(selector);
  if (!match) throw new Error(`unsupported selector: ${selector}`);
  if (match[1] && node.tagName !== match[1].toUpperCase()) return false;
  return match[2].split('.').filter(Boolean).every((name) => node.classList.contains(name));
}

function el(tag, className = '') {
  const node = {
    tagName: tag.toUpperCase(),
    children: [],
    parentElement: null,
    dataset: {},
    attributes: new Map(),
    textContent: '',
    title: '',
    innerHTML: '',
    classList: {
      set: new Set(className.split(/\s+/).filter(Boolean)),
      contains(name) { return this.set.has(name); },
      add(name) { this.set.add(name); },
      remove(name) { this.set.delete(name); },
      toggle(name, on) { const next = on === undefined ? !this.set.has(name) : Boolean(on); if (next) this.set.add(name); else this.set.delete(name); return next; },
    },
    get className() { return [...this.classList.set].join(' '); },
    set className(value) { this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean)); },
    append(...nodes) { for (const child of nodes) { child.parentElement = node; node.children.push(child); } },
    prepend(node) { node.parentElement = this; this.children.unshift(node); },
    insertBefore(node, ref) {
      node.parentElement = this;
      const at = ref ? this.children.indexOf(ref) : -1;
      if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
      return node;
    },
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); },
    remove() {
      if (!this.parentElement) return;
      const at = this.parentElement.children.indexOf(this);
      if (at >= 0) this.parentElement.children.splice(at, 1);
      this.parentElement = null;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      // the real DOM reflects data-* onto dataset; gaze.js reads dataset, the tests set attributes
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = String(value);
      }
    },
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
    // the real DOM reflects title as both property and attribute; the tests rely on that
    get title() { return this.attributes.get('title') || ''; },
    set title(value) { this.attributes.set('title', String(value)); },
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        delete this.dataset[key];
      }
    },
    hasAttribute(name) { return this.attributes.has(name); },
    toggleAttribute(name, on) { if (on === undefined ? !this.attributes.has(name) : on) this.attributes.set(name, ''); else this.attributes.delete(name); return this.attributes.has(name); },
    matches(selector) { return matches(this, selector, this.parentElement); },
    descendants() {
      return this.children.flatMap((child) => [child, ...child.descendants()]);
    },
    querySelectorAll(selector) {
      return this.descendants().filter((child) => matches(child, selector, this));
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  return node;
}

function loadGaze() {
  const levels = read('services/cle-studio/src/composer/gaze-levels.js')
    .replace(/export const/g, 'const').replace(/export function/g, 'function');
  const gaze = read('services/cle-studio/src/composer/gaze.js')
    .replace(/^import '\.\/models\.css';$/m, '')
    .replace(/^import \{[^}]*\} from '\.\/gaze-levels\.js';$/m, '')
    .replace(/^export \{[^}]*\}[^;]*;$/m, '')
    .replace(/export function/g, 'function');
  const sandbox = {
    console,
    requestAnimationFrame: (fn) => fn(),
    document: {createElement: (tag) => el(tag), createDocumentFragment: () => el('fragment')},
  };
  vm.runInNewContext(`${levels}\n${gaze}\nthis.__gaze={decoratePicker};`, sandbox, {});
  return sandbox.__gaze;
}

function picker({open = true} = {}) {
  const details = el('details', 'chat-controls__inline-select chat-controls__effort-picker');
  details.open = open;
  details.isConnected = true;
  const summary = el('summary', 'chat-controls__inline-select-trigger chat-controls__effort-trigger');
  summary.dataset.chatThinkingValue = 'high';
  const label = el('span', 'chat-controls__inline-select-label');
  label.textContent = 'High';
  summary.append(label);
  const menu = el('div', 'chat-controls__inline-select-menu chat-controls__effort-menu');
  const panel = el('div', 'chat-controls__reasoning-panel');
  const range = el('input', 'chat-controls__reasoning-range');
  range.min = '0'; range.max = '3'; range.value = '2'; range.disabled = false;
  range.dataset.chatThinkingValues = 'off,low,high,max';
  panel.append(range);
  menu.append(panel);
  details.append(summary, menu);
  return {details, summary, label, menu, panel, range};
}

test('the eye opens to the committed level and the native label text is untouched', () => {
  const {decoratePicker} = loadGaze();
  const {details, summary, label} = picker();
  const before = label.textContent;
  decoratePicker(details);
  const eye = summary.querySelector('.cle-eye');
  assert.ok(eye, 'an eye is inserted into the trigger');
  assert.match(eye.innerHTML, /<svg/);
  assert.equal(eye.dataset.cleOpen, '0.68', 'High is a half-open gaze, not a fully lit one');
  assert.equal(eye.hasAttribute('data-lit'), false);
  assert.equal(label.textContent, before, 'Lit owns the label text node; we never rewrite it');
  assert.equal(label.dataset.cleTier, undefined,
    'the native label already says High — no duplicate suffix is added');
  assert.equal(label.textContent, 'High');
  assert.equal(summary.dataset.cleLevel, 'high');
  assert.match(summary.title, /High/);

  summary.dataset.chatThinkingValue = 'max';
  decoratePicker(details);
  assert.equal(eye.dataset.cleOpen, '0.93');
  assert.equal(eye.hasAttribute('data-lit'), true, 'Max lights the iris');
  assert.match(eye.innerHTML, /cle-eye__iris/);
});

test('stops come from the model, and the current one is marked once', () => {
  const {decoratePicker} = loadGaze();
  const {details, panel} = picker();
  decoratePicker(details);
  const host = panel.querySelector('.cle-gaze-stops');
  assert.ok(host, 'a stop row is rendered inside the reasoning panel');
  const names = host.querySelectorAll('.cle-gaze-stop').map((stop) => stop.querySelector('.cle-gaze-stop__name').textContent);
  assert.deepEqual(names, ['Off', 'Low', 'High', 'Max'], 'the real four stops, in the real order');
  const current = host.querySelectorAll('.cle-gaze-stop').filter((stop) => stop.hasAttribute('data-current'));
  assert.equal(current.length, 1);
  assert.equal(current[0].dataset.stop, '2');
  assert.equal(host.hasAttribute('data-disabled'), false);
  assert.equal(host.querySelector('.cle-gaze-stops__why'), null);
});

test('a disabled slider states its reason instead of looking broken', () => {
  const {decoratePicker} = loadGaze();
  const {details, range, panel} = picker();
  range.disabled = true;
  // the real picker marks the trigger when thinking is locked, exactly as the CUA snapshot showed
  details.querySelector(':scope > summary').setAttribute('data-chat-thinking-disabled', 'true');
  details.querySelector(':scope > summary').setAttribute('title', '会话运行中，暂不可调整');
  decoratePicker(details);
  const host = panel.querySelector('.cle-gaze-stops');
  assert.equal(host.hasAttribute('data-disabled'), true);
  const why = host.querySelector('.cle-gaze-stops__why');
  assert.ok(why, 'the reason is shown, not just a dimmed control');
  assert.equal(why.textContent, '会话运行中，暂不可调整');
  assert.equal(host.title, '会话运行中，暂不可调整');
});

test('our own tier description is never reported as the reason a control is locked', () => {
  const {decoratePicker} = loadGaze();
  const {details, summary, panel} = picker();
  // a first pass writes our descriptive title
  decoratePicker(details);
  assert.match(summary.getAttribute('title'), /思考强度 · High/);
  // then the native picker locks the control and publishes the real reason
  summary.setAttribute('data-chat-thinking-disabled', 'true');
  summary.setAttribute('title', '会话运行中，暂不可调整');
  decoratePicker(details);
  const why = panel.querySelector('.cle-gaze-stops__why');
  assert.ok(why, 'a reason is shown');
  assert.equal(why.textContent, '会话运行中，暂不可调整',
    'the live native reason wins over our own description');
  assert.doesNotMatch(why.textContent, /思考强度/);
});

test('a disabled control with no native reason still says something honest', () => {
  const {decoratePicker} = loadGaze();
  const {details, summary, panel} = picker();
  decoratePicker(details);
  summary.setAttribute('data-chat-thinking-disabled', 'true');
  // the native build left our descriptive title in place and published no other reason
  decoratePicker(details);
  const why = panel.querySelector('.cle-gaze-stops__why');
  assert.ok(why);
  assert.doesNotMatch(why.textContent, /认真推敲/, 'a tier hint is not a lock reason');
});

test('a model with one level says so and never draws a fake ladder', () => {
  const {decoratePicker} = loadGaze();
  const {details, range, panel} = picker();
  range.dataset.chatThinkingValues = 'medium';
  range.max = '0';
  range.value = '0';
  decoratePicker(details);
  const host = panel.querySelector('.cle-gaze-stops');
  assert.ok(host.classList.contains('is-note'));
  assert.match(host.textContent, /只有一个思考档位 · Medium/);
  assert.equal(host.querySelectorAll('.cle-gaze-stop').length, 0, 'no invented stops');
});

test('a translated native label still resolves to the right level', () => {
  const {decoratePicker} = loadGaze();
  const {details, summary, label} = picker();
  summary.dataset.chatThinkingValue = '';
  label.textContent = '最高';
  decoratePicker(details);
  assert.equal(summary.dataset.cleLevel, 'max');
  assert.equal(label.dataset.cleTier, 'Max', 'the standard name is shown next to the translated one');
});
