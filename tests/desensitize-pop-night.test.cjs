// B11：脱敏浮窗夜间漏认 data-pinkie-night 的复发测试（静态部分，真页面对比度见 desensitize-pop-night-real.test.mjs）。
// 原来浮窗的夜间规则只写 html[data-theme-mode="dark"]，碧琪自己的夜间（只打 data-pinkie-night）下浮窗仍是亮底；
// 而且夜间规则只改了浮窗本身，输入框 / 下拉 / 按钮还是日间的浅色细线。这里用假 DOM 跑真文件，拿到注入的 CSS 文本查规则。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-desensitize.js'), 'utf8');
const N = ':is(html[data-theme-mode="dark"],html[data-pinkie-night])';

function injectedCss(src) {
  const el = (tag) => ({tagName: tag.toUpperCase(), id: '', textContent: '', innerHTML: '', className: '', style: {}, children: [],
    classList: {add() {}, remove() {}}, addEventListener() {}, appendChild(n) { this.children.push(n); return n; },
    insertBefore(n) { this.children.push(n); return n; }, querySelector() { return null; }, remove() {}});
  const head = el('head');
  const document = {
    head, body: el('body'),
    documentElement: {getAttribute: (k) => (k === 'data-laolao-mode' ? 'unrestricted' : null)},
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: el, addEventListener() {},
  };
  vm.runInNewContext(src, {
    window: {addEventListener() {}, dispatchEvent() {}}, document, localStorage: {getItem: () => null, setItem() {}},
    URLSearchParams, requestAnimationFrame: (cb) => { cb(); return 1; }, setTimeout: () => 1, setInterval: () => 1, clearInterval() {},
  });
  const style = head.children.find((n) => n.id === 'laolao-desensitize-css');
  assert.ok(style, '应注入 #laolao-desensitize-css');
  return style.textContent;
}

// 夜间规则必须同时认两种夜间标记，并覆盖浮窗内会看不清的每一类元素
const NIGHT_TARGETS = ['#laolao-desensitize-pop', '.ds-head__title', ':is(.ds-select,.ds-input)', '.ds-input::placeholder', '.ds-status', '.ds-run', '.ds-apply'];
function nightProblems(css) {
  const out = [];
  for (const t of NIGHT_TARGETS) if (!css.includes(`${N} ${t}{`)) out.push(`缺夜间规则：${N} ${t}`);
  if (/(^|[\s},])html\[data-theme-mode="dark"\]\s+(#laolao-desensitize-pop|\.ds-)/.test(css)) out.push('残留只认 data-theme-mode="dark" 的浮窗规则');
  const popNight = css.slice(css.indexOf(`${N} #laolao-desensitize-pop{`)).split('}')[0];
  if (!/background:linear-gradient\(145deg,rgba\(46,30,42,/.test(popNight)) out.push('夜间浮窗不是深底');
  return out;
}

// 触发钮静息 / hover / 原生暗色规则一字不动
const BTN_BLOCKS = [
  `.laolao-desensitize-btn {
  display:inline-flex;align-items:center;justify-content:center;gap:3px;
  height:28px;min-width:28px;padding:0 8px;
  border:1px solid rgba(255,255,255,.56);border-radius:999px;
  background:linear-gradient(135deg,rgba(255,252,253,.72),rgba(250,224,238,.58));
  -webkit-backdrop-filter:blur(14px) saturate(1.1);backdrop-filter:blur(14px) saturate(1.1);
  color:#8c4a6a;cursor:pointer;
  font:600 10.5px/1 ui-sans-serif,system-ui,sans-serif;
  white-space:nowrap;
  box-shadow:0 1px 3px rgba(84,42,65,.08),inset 0 1px rgba(255,255,255,.7);
  transition:all .18s ease;order:7;
}`,
  `.laolao-desensitize-btn:hover,.laolao-desensitize-btn.is-open {
  background:linear-gradient(135deg,rgba(255,252,253,.88),rgba(246,212,232,.76));
  border-color:rgba(255,255,255,.78);color:#6d3650;
  box-shadow:0 3px 10px rgba(84,42,65,.13),inset 0 1px rgba(255,255,255,.82);
}`,
  `html[data-theme-mode="dark"] .laolao-desensitize-btn{
  background:linear-gradient(135deg,rgba(255,249,252,.68),rgba(248,220,236,.55));
  border-color:rgba(255,255,255,.48);color:#8c4a6a;
}`,
];
function btnProblems(css) {
  const out = BTN_BLOCKS.filter((b) => !css.includes(b)).map((b) => `触发钮规则被改：${b.split('{')[0].trim()}`);
  const n = (css.match(/\.laolao-desensitize-btn/g) || []).length;
  if (n !== 4) out.push(`.laolao-desensitize-btn 出现 ${n} 次（应只在原有 3 条规则里共 4 次）`);
  return out;
}

test('夜间规则同时认 data-theme-mode="dark" 与 data-pinkie-night，覆盖浮窗内输入框 / 下拉 / 按钮', () => {
  assert.deepEqual(nightProblems(injectedCss(source)), []);
});

test('触发钮静息态与原生暗色规则一字未动', () => {
  assert.deepEqual(btnProblems(injectedCss(source)), []);
});

test('反例：夜间选择器退回只认 data-theme-mode="dark" 必须被抓到', () => {
  const broken = source.split(N).join('html[data-theme-mode="dark"]');
  assert.notEqual(broken, source);
  const p = nightProblems(injectedCss(broken));
  assert.ok(p.some((x) => x.startsWith('缺夜间规则')), p.join('\n'));
  assert.ok(p.includes('残留只认 data-theme-mode="dark" 的浮窗规则'), p.join('\n'));
});

test('反例：夜间浮窗退回亮底、或触发钮被顺手改色都必须被抓到', () => {
  const lightPop = source.replace('rgba(46,30,42,.96)', 'rgba(255,249,252,.84)');
  assert.ok(nightProblems(injectedCss(lightPop)).includes('夜间浮窗不是深底'));
  const btnTouched = source.replace('color:#8c4a6a;cursor:pointer;', 'color:#5a2e44;cursor:pointer;');
  assert.notEqual(btnTouched, source);
  assert.ok(btnProblems(injectedCss(btnTouched)).length > 0);
  const btnNight = source.replace(`${N} .ds-apply{`, `${N} .laolao-desensitize-btn{color:#fff}${N} .ds-apply{`);
  assert.ok(btnProblems(injectedCss(btnNight)).some((x) => x.includes('出现 5 次')));
});
