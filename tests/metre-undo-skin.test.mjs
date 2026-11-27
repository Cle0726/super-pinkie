// L29（T3 #17 归档后可撤销）：Metre 里「已归档 · 撤销」那一条换成 Metre 的样子（ui/injections/laolao-metre-undo.css）。
// 撤销条本身早已在 main：laolao-sidebar.js showArchiveUndo，Metre 侧栏悬停「归档」小键（laolao-metre-list.js）和 Delete 键
// （laolao-session-list.js）都走 archiveWithUndo；但它的样式只有 laolao-sidebar.css 里那几条碧琪粉，Metre 下也是粉的。
// 本文件是静态检查（不开浏览器）：只在 Metre 生效、颜色全用 Metre 变量、压得过原来的粉色规则、登记在原规则之后加载。
// 反例：去掉 laolao-metre-undo.css（连同头片段和 regions.json 里那一行），这里必须变红。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const read = (f) => fs.readFileSync(inj(f), 'utf8');
const FILE = 'laolao-metre-undo.css';
const METRE = 'html[data-laolao-mode="metre"]';
const BAR = '.pinkie-archive-undo';

// 顶层规则（含 @media 里的）：[{selectors, decls: Map(prop -> value)}]
function rules(css) {
  const out = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const decls = new Map();
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':');
      if (i > 0) decls.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
    out.push({selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), decls});
  }
  return out;
}
const declsOf = (rs, selector) => rs.find((r) => r.selectors.includes(selector))?.decls;

// 选择器优先级 [id, 类/属性/伪类, 标签]；只处理本测试会碰到的写法。
function specificity(selector) {
  let s = selector.replace(/::[\w-]+/g, '').replace(/:not\(([^()]*)\)/g, ' $1');
  const attrs = (s.match(/\[[^\]]*\]/g) || []).length;
  s = s.replace(/\[[^\]]*\]/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+/g) || []).length + (s.match(/:[\w-]+/g) || []).length;
  const types = (s.replace(/[.#:][\w-]+/g, ' ').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [ids, attrs + classes, types];
}
const atLeast = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return true; };

test('every rule only applies in Metre, no !important, colors only from Metre variables', () => {
  const css = read(FILE);
  const rs = rules(css);
  assert.ok(rs.length >= 2, '撤销条和「撤销」键都有规则');
  for (const r of rs) for (const sel of r.selectors) assert.ok(sel.startsWith(`${METRE} ${BAR}`), `只在 Metre 下、只管撤销条：${sel}`);
  assert.doesNotMatch(css, /!important/, '不加强制覆盖');
  const bodies = rs.flatMap((r) => [...r.decls.values()]).join(';');
  assert.doesNotMatch(bodies, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, '颜色不写死，全用 Metre 变量（日夜跟着变量走）');
  const vars = [...new Set([...bodies.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
  assert.ok(vars.length >= 5);
  const skin = read('laolao-metre-skin.css');
  for (const v of vars) {
    assert.ok(v.startsWith('--metre-'), `只用 Metre 自己的变量：${v}`);
    assert.match(skin, new RegExp(v.replace(/-/g, '\\-') + '\\s*:'), `${v} 在 laolao-metre-skin.css 里有定义`);
  }
});

test('the bar and its undo button get Metre colors and beat the pink rules in laolao-sidebar.css', () => {
  const mine = rules(read(FILE));
  const bar = declsOf(mine, `${METRE} ${BAR}`), btn = declsOf(mine, `${METRE} ${BAR} button`), focus = declsOf(mine, `${METRE} ${BAR} button:focus-visible`);
  assert.ok(bar && btn && focus, '撤销条、撤销键、键盘焦点三条都在');
  assert.equal(bar.get('background'), 'var(--metre-surface)');
  assert.equal(bar.get('color'), 'var(--metre-text)');
  assert.equal(bar.get('box-shadow'), 'var(--metre-pop-shadow)');
  assert.equal(bar.get('border'), '1px solid var(--metre-line)');
  assert.equal(btn.get('color'), 'var(--metre-cobalt)');
  assert.match(focus.get('outline') || '', /var\(--metre-cobalt\)/);

  // 原来的粉色规则（laolao-sidebar.css）：每条都要有 Metre 的对应规则，并且同一属性上优先级不低于它。
  const pink = rules(read('laolao-sidebar.css'));
  const pairs = [
    [BAR, `${METRE} ${BAR}`],
    [`html[data-pinkie-night] ${BAR}`, `${METRE} ${BAR}`],
    [`${BAR} button`, `${METRE} ${BAR} button`],
    [`${BAR} button:focus-visible`, `${METRE} ${BAR} button:focus-visible`],
  ];
  for (const [orig, ours] of pairs) {
    const o = declsOf(pink, orig), m = declsOf(mine, ours);
    assert.ok(o, `laolao-sidebar.css 里还有 ${orig}（这条测试要对着它比）`);
    for (const prop of ['background', 'color', 'box-shadow', 'outline']) {
      // 只管写了具体颜色的（碧琪粉、夜里的深紫、粉色阴影）；transparent / inherit 不是粉色，不用换。
      if (!o.has(prop) || !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(o.get(prop))) continue;
      assert.ok(m.has(prop), `${orig} 设了 ${prop}（${o.get(prop)}），Metre 下要换掉`);
      assert.ok(atLeast(specificity(ours), specificity(orig)), `${ours} 的优先级 ${specificity(ours)} 不低于 ${orig} 的 ${specificity(orig)}`);
    }
  }
});

test('registered once: loaded after laolao-sidebar.css with ?v=@hash and listed in the metre region only', () => {
  const head = read('laolao-head.fragment.html');
  const sidebar = head.indexOf('<link rel="stylesheet" href="/laolao-sidebar.css?v=@hash">');
  const undo = head.indexOf(`<link rel="stylesheet" href="/${FILE}?v=@hash">`);
  assert.ok(sidebar >= 0 && undo >= 0, '两张样式表都在头片段里，版本号用 @hash');
  assert.ok(undo > sidebar, '在 laolao-sidebar.css 之后加载：同优先级时（夜间那条）靠后者胜');
  assert.equal(head.split(FILE).length - 1, 1, '只登记一次');
  const regions = JSON.parse(read('regions.json')).regions;
  assert.deepEqual(regions.filter((r) => r.files.includes(FILE)).map((r) => r.id), ['metre']);
  assert.ok(read(FILE).split('\n').length <= 1500);
});

test('the undo bar this skins is still the one archiveWithUndo shows (hover 归档 and Delete in the Metre sidebar)', () => {
  const sidebar = read('laolao-sidebar.js');
  assert.match(sidebar, /bar\.className='pinkie-archive-undo'/);
  assert.match(sidebar, /async function archiveWithUndo\(key\)\{try\{await archiveSession\(key,\{undo:true\}\);/);
  assert.match(read('laolao-metre-list.js'), /mini\('归档', '⌫', \(\) => api\.archiveWithUndo\?\.\(s\.key\)\)/);
  assert.match(read('laolao-session-list.js'), /event\.key==='Delete'[^\n]*\n\s*event\.preventDefault\(\);void current\.api\.archiveWithUndo\(row\.dataset\.sessionKey\);/);
});
