// 17（uireview #98：日 1440 左下 METRE 黑卡压住底栏图标）的反例。
// 原生 /cron、/settings 这些页重新载入时，upstream 的 .shell 只有在聊天页才带 shell--chat（index-*.js：n===`chat`?`shell--chat`:``）。
// laolao-classic-shell.js 的 render() 原来见不到 .shell--chat 就直接返回：data-laolao-classic-shell 不设、
// 底栏的次要键（文档 / 配对移动设备 / 配色 / 长期记忆）不收进「更多工具」，五个图标全摊在底栏，压在模式卡和方灯下面。
// 在 app 里从聊天页点过去时这些状态是聊天页留下的，所以只有重新载入才露馅。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-classic-shell.js'), 'utf8');

function el(className = '', attrs = {}) {
  const map = new Map(Object.entries(attrs));
  return {
    className, dataset: {}, parentElement: null, children: [], hidden: false, isConnected: true, innerHTML: '', title: '',
    setAttribute(k, v) { map.set(k, String(v)); },
    getAttribute(k) { return map.has(k) ? map.get(k) : null; },
    addEventListener() {},
    append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } },
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); },
    matches() { return false; },
    querySelector(sel) {
      const want = sel.startsWith('.') ? sel.slice(1) : null;
      const walk = (n) => { for (const c of n.children) { if (want && c.className.split(/\s+/).includes(want)) return c; const hit = walk(c); if (hit) return hit; } return null; };
      return walk(this);
    },
    closest(sel) {
      for (const part of sel.split(',').map((s) => s.trim())) {
        if (!part.startsWith('.')) continue;
        for (let n = this; n; n = n.parentElement) if (n.className.split(/\s+/).includes(part.slice(1))) return n;
      }
      return null;
    },
  };
}

// 重新载入的原生页：shell 没有 shell--chat；底栏里每个次要键都包在一层 tooltip 里（和真页面一样）
function runReloadedPage({shellClass = 'shell', mode = 'metre'} = {}) {
  const footer = el('sidebar-shell__footer');
  const bar = el('sidebar-footer-bar');
  footer.append(bar);
  const keys = {
    settings: el('sidebar-footer-icon', {'aria-label': '设置'}),
    docs: el('sidebar-footer-icon', {'aria-label': '文档'}),
    pair: el('sidebar-footer-icon', {'aria-label': '配对移动设备'}),
    theme: el('theme-mode-toggle', {'aria-label': '配色：浅色'}),
    memory: el('laolao-memory-entry', {'aria-label': '打开当前模式的独立长期记忆'}),
  };
  const wraps = {};
  for (const [k, node] of Object.entries(keys)) { const w = el('openclaw-tooltip'); w.append(node); bar.append(w); wraps[k] = w; }
  const shell = el(shellClass);
  const body = el('body');
  const root = new Map([['data-laolao-mode', mode]]);
  const document = {
    body, readyState: 'complete',
    documentElement: {getAttribute: (k) => (root.has(k) ? root.get(k) : null), setAttribute: (k, v) => root.set(k, String(v))},
    querySelector(sel) {
      if (sel === '.sidebar-shell__footer') return footer;
      if (sel.includes('sidebar-shell__footer') || sel.includes('sidebar-nav') || sel.includes('sidebar-session-toolbar')) return null;
      if (sel.includes('shell--chat')) return null; // 这是 /cron，不是聊天页
      if (/(^|[\s,])\.shell\b/.test(sel)) return shell;
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes('文档')) return [keys.docs];
      if (sel.includes('配对移动设备')) return [keys.pair];
      if (sel.includes('theme-mode-toggle')) return [keys.theme];
      if (sel.includes('laolao-memory-entry')) return [keys.memory];
      return [];
    },
    createElement(tag) { const n = el(''); n.tagName = tag.toUpperCase(); return n; },
  };
  vm.runInNewContext(source, {
    document,
    window: {addEventListener() {}, innerWidth: 1440, innerHeight: 900},
    location: {search: '', pathname: '/cron'},
    localStorage: {getItem() { return null; }},
    URLSearchParams,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setInterval() { return 1; },
  });
  return {root, bar, wraps};
}

test('reloaded non-chat page (/cron) still folds the secondary footer keys into 更多工具', () => {
  const {root, bar, wraps} = runReloadedPage();
  // 隐藏次要键的 CSS（laolao-classic-shell.css）挂在这个属性上
  assert.equal(root.get('data-laolao-classic-shell'), '1');
  for (const k of ['docs', 'pair', 'theme', 'memory']) assert.equal(wraps[k].dataset.laolaoFooterSecondary, '1', `${k} should be folded`);
  assert.equal(wraps.settings.dataset.laolaoFooterSecondary, undefined, '设置 stays in the footer');
  const more = bar.children.find((n) => n.className.includes('laolao-footer-more'));
  assert.ok(more, '更多工具 button is mounted in the footer bar');
  assert.equal(more.hidden, false);
});

test('onboarding / booting shells are left alone', () => {
  for (const shellClass of ['shell shell--onboarding', 'shell shell--booting']) {
    const {root, wraps} = runReloadedPage({shellClass});
    assert.equal(root.get('data-laolao-classic-shell'), undefined, shellClass);
    assert.equal(wraps.docs.dataset.laolaoFooterSecondary, undefined, shellClass);
  }
});
