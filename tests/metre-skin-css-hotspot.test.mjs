// HOTSPOTS 第 5 名 ui/injections/laolao-metre-skin.css 的复发测试（B7 续，按 2026-11-26 重算的热点）。
// 只读 CSS 做静态断言（选择器在、关键声明、媒体 / 容器查询范围、不得出现的写法），不起浏览器、不用上游模型。
// 近 60 天的修复里已有测试会在回退时变红的不再重复；这里锁住还没人锁的 7 个修复：
//   604f0eae  分工条让出 ◆ 芯片、会话行标题链接悬停不再自己铺底、子会话模式标签
//   4b49bbc6  双开 / 停靠 / 浏览器在旁时 851–1100 宽不再给两列；分工条同输入框宽；侧栏 ≤ 250 收黑卡；抽屉有边
//   22c69832  文件卡在 Metre 里是一份细边目录，不是碧琪的阴影卡片
//   414bfdd3  后台工作条在 Metre 里是平的纸样，不是粉色渐变玻璃
//   5deb9535  后台工作条在 Metre 里小一号、贴输入框左边
//   573eb777  设置页的搜索框（input[type="search"]）也穿 Metre 输入框样式
//   a1269c4b  侧栏任意按键悬停不再被总谱那条规则撑成整行宽
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const SKIN = read('laolao-metre-skin.css');
const M = 'html[data-laolao-mode="metre"]';

// 按顶层分隔符切开（不切括号 / 方括号 / 引号里的）：选择器列表用 ','，声明用 ';'。
function splitTop(s, sep) {
  const out = []; let depth = 0; let q = ''; let cur = '';
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// 把样式表拆成规则：{selector, parts, decl, at}。at 是外层 @media / @container 的前缀；去注释，跳过引号里的花括号。
function parseRules(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = []; const stack = []; let buf = ''; let q = '';
  for (const ch of src) {
    if (q) { buf += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; buf += ch; continue; }
    if (ch === ';' && buf.trim().startsWith('@') && !stack.length) { buf = ''; continue; }
    if (ch === '{') { stack.push(buf.trim().replace(/\s+/g, ' ')); buf = ''; continue; }
    if (ch === '}') {
      const head = stack.pop() ?? '';
      if (head && !head.startsWith('@') && buf.trim()) {
        const decl = {};
        for (const d of splitTop(buf, ';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
        rules.push({selector: head, parts: splitTop(head, ','), decl, at: stack.filter((s) => s.startsWith('@'))});
      }
      buf = ''; continue;
    }
    buf += ch;
  }
  return rules;
}
const RULES = parseRules(SKIN);
const bare = (v) => (v ?? '').replace(/\s*!important$/, '').trim();
const ids = (part) => (part.match(/#_m\d/g) || []).length;

// 选择器列表里某一段以 tail 结尾（前面是 Metre 根）的规则，按源码顺序；opts.at 只要某个外层查询里的，opts.top 只要顶层的。
function find(tail, opts = {}) {
  const hits = [];
  for (const r of RULES) {
    if (opts.top && r.at.length) continue;
    if (opts.at && !r.at.some((a) => a.includes(opts.at))) continue;
    for (const part of r.parts) if (part.startsWith(M) && part.endsWith(' ' + tail)) hits.push({part, rule: r, decl: r.decl});
  }
  return hits;
}
// 源码里最后一条写了 prop 的（同优先级时后写的生效）
const lastWith = (hits, prop) => hits.filter((h) => prop in h.decl).at(-1);

// ---- 604f0eae：真机第四轮「重叠 / 子会话不显示」----
test('604f0eae：分工条左边让出运行条 ◆ 芯片（约 38px）那一格，颜色走 Metre', () => {
  const crew = lastWith(find('.pinkie-crew', {top: true}).filter((h) => !h.part.includes('workspace-split')), 'padding-left');
  assert.ok(crew, '要有 Metre 的 .pinkie-crew { padding-left } 那条');
  const pad = parseFloat(bare(crew.decl['padding-left']));
  assert.ok(pad >= 38, `分工条左内边距要 ≥ 芯片宽 38px，字才不被芯片压住（实际 ${pad}px）`);
  assert.equal(bare(crew.decl['--crew']), 'var(--metre-accent)', '分工条用 Metre 钴蓝，不用碧琪粉');
});

test('604f0eae：会话行的标题链接悬停透明，压得过侧栏通用的 :is(a, button):hover 底色；子会话模式标签不折行', () => {
  const generic = find('aside.sidebar :is(a, button):hover').filter((h) => 'background-color' in h.decl || 'background' in h.decl);
  assert.ok(generic.length, '前提：侧栏通用悬停底色那条还在（它就是行里套一块底的来源）');
  const link = lastWith(find('aside.sidebar .session-row-host .sidebar-recent-session__link:hover'), 'background');
  assert.ok(link, '要有 .session-row-host .sidebar-recent-session__link:hover 的规则');
  assert.equal(link.decl.background, 'transparent !important', '会话行底色只由整行负责');
  for (const g of generic) assert.ok(ids(link.part) > ids(g.part), `链接那条的 #_m 数（${ids(link.part)}）要多过通用悬停（${ids(g.part)}），否则还是铺一块底`);
  const mode = lastWith(find('aside.sidebar .pinkie-session-part__mode'), 'white-space');
  assert.ok(mode, '要有子会话模式标签 .pinkie-session-part__mode 的规则');
  assert.equal(bare(mode.decl['white-space']), 'nowrap');
  assert.equal(bare(mode.decl.flex), '0 0 auto', '模式标签不被标题挤缩');
});

// ---- 4b49bbc6：「模式双开下页面不适配」----
const SPLIT = [':not([data-laolao-workspace-split="1"])', ':not([data-laolao-workspace-dock="1"])', ':not([data-laolao-browser-workspace="1"])'];
test('4b49bbc6：851–1100 宽给外壳的「0 + 正文」两列，双开 / 停靠 / 浏览器在旁时不生效（那时外壳只有一列）', () => {
  const cols = RULES.filter((r) => /^0 /.test(bare(r.decl['grid-template-columns'])) && r.parts.some((p) => p.startsWith(M) && p.includes('.shell')));
  assert.ok(cols.length, '要有 Metre 窄窗外壳两列（第一列 0）那条');
  for (const r of cols) {
    assert.ok(r.at.includes('@media (min-width: 851px) and (max-width: 1100px)'), `外壳两列只在 851–1100 宽：${r.at.join(' / ') || '顶层'}`);
    for (const part of r.parts) for (const not of SPLIT) assert.ok(part.includes(not), `「${part.slice(0, 80)}…」缺 ${not}，双开时正文会落进 0 宽那列`);
  }
});

test('4b49bbc6：双开时分工条和输入框同宽；侧栏 ≤ 250 宽黑卡收成 M 方块、全屏键收进「更多工具」；抽屉右边有线', () => {
  const composer = read('laolao-ui-subtraction.css').match(/width: (min\(100% - 18px, \d+px\)) !important;/);
  assert.ok(composer, '前提：laolao-ui-subtraction.css 里双开时输入框宽 min(100% - 18px, Npx)');
  const crew = find('.pinkie-crew').filter((h) => ['workspace-split', 'workspace-dock', 'browser-workspace'].every((k) => h.part.includes(`[data-laolao-${k}="1"]`)));
  assert.ok(crew.length, '要有双开 / 停靠 / 浏览器在旁时的 .pinkie-crew 规则');
  assert.equal(bare(lastWith(crew, 'width')?.decl.width), composer[1], '分工条宽度跟输入框一样');

  const side = lastWith(find('aside.sidebar:not(.sidebar--collapsed)', {top: true}), 'container');
  assert.ok(side, '侧栏要是 metre-side 容器');
  assert.equal(bare(side.decl.container), 'metre-side / inline-size');
  const at = '@container metre-side (max-width: 250px)';
  const card = lastWith(find('aside.sidebar .laolao-mode-switcher.laolao-mode-button--plain', {at}), 'width');
  assert.ok(card, `${at} 里要收窄模式黑卡`);
  assert.equal(bare(card.decl.width), '44px');
  const hidden = find('aside.sidebar .laolao-mode-switcher.laolao-mode-button--plain :is(.laolao-mode-button__label, .laolao-mode-button__arrow)', {at});
  assert.equal(bare(lastWith(hidden, 'display')?.decl.display), 'none', '窄侧栏里黑卡不显示字和箭头');
  const full = find('aside.sidebar .sidebar-footer-bar :is(#pinkie-window-fullscreen, openclaw-tooltip:has(> #pinkie-window-fullscreen))', {at});
  assert.equal(bare(lastWith(full, 'display')?.decl.display), 'none', '窄侧栏里底栏不放全屏键');
  const shell = read('laolao-classic-shell.js');
  const from = shell.indexOf('const footerSecondaryActions = [');
  assert.ok(from >= 0 && shell.slice(from, shell.indexOf('];', from)).includes('#pinkie-window-fullscreen'), '前提：全屏键在「更多工具」里还能点到');
  assert.ok(!find('aside.sidebar .laolao-mode-switcher.laolao-mode-button--plain', {top: true}).some((h) => bare(h.decl.width) === '44px'), '44px 只在窄侧栏容器查询里，不是顶层');

  const drawer = lastWith(find('.shell.shell--nav-drawer-open > .shell-nav'), 'box-shadow');
  assert.ok(drawer, '要有打开的抽屉 .shell--nav-drawer-open > .shell-nav 的投影');
  assert.match(bare(drawer.decl['box-shadow']), /^1px 0 0 var\(--metre-line-strong\), /, '抽屉右边一条线 + 一道淡影');
});

// ---- 22c69832：「这个文件 UI 还是用碧琪的吧」----
test('22c69832：文件卡在 Metre 里是一份细边目录——无阴影、无头像缩进、行间不叠两道边、按钮透明', () => {
  const list = lastWith(find('.pinkie-file-cards', {top: true}), 'padding-left');
  assert.ok(list, '要有 Metre 的 .pinkie-file-cards 规则');
  assert.equal(bare(list.decl['padding-left']), '0', '目录和回答左边对齐，没有头像缩进');
  const card = find('.pinkie-file-card', {top: true});
  assert.equal(bare(lastWith(card, 'box-shadow')?.decl['box-shadow']), 'none', '文件卡没有碧琪的阴影');
  assert.equal(bare(lastWith(card, 'background')?.decl.background), 'var(--metre-surface)');
  assert.equal(bare(lastWith(card, 'border')?.decl.border), '1px solid var(--metre-line-strong)', '一圈细边');
  assert.equal(bare(lastWith(find('.pinkie-file-card + .pinkie-file-card'), 'border-top-width')?.decl['border-top-width']), '0', '相邻两行不叠两道边');
  assert.equal(bare(lastWith(find('.pinkie-file-card__btn', {top: true}), 'background')?.decl.background), 'transparent', '「打开 / 显示」是文字按钮');
  const pink = RULES.filter((r) => r.parts.some((p) => p.startsWith(M) && p.includes('.pinkie-file-card')) && /gradient|backdrop-filter":"blur/.test(JSON.stringify(r.decl)));
  assert.deepEqual(pink.map((r) => r.selector.slice(0, 90)), [], 'Metre 文件卡规则里不出现渐变 / 毛玻璃');
});

// ---- 414bfdd3 / 5deb9535：后台工作条（「抓到一个碧琪 UI」）----
test('414bfdd3：后台工作条在 Metre 里是平的纸样——Metre 底色、细边、无毛玻璃、无渐变', () => {
  const paper = find(':is(.pinkie-work__pill, .pinkie-work__card)', {top: true});
  assert.ok(paper.length, '要有 :is(.pinkie-work__pill, .pinkie-work__card) 那条');
  assert.equal(bare(lastWith(paper, 'background')?.decl.background), 'var(--metre-surface)');
  assert.equal(bare(lastWith(paper, 'border')?.decl.border), '1px solid var(--metre-line-strong)');
  assert.equal(bare(lastWith(paper, 'backdrop-filter')?.decl['backdrop-filter']), 'none', '不要碧琪的毛玻璃');
  assert.equal(bare(lastWith(paper, '-webkit-backdrop-filter')?.decl['-webkit-backdrop-filter']), 'none', 'WebKit 也不要毛玻璃');
  assert.equal(bare(lastWith(find(':is(.pinkie-work__icon, .pinkie-work__state)'), 'color')?.decl.color), 'var(--metre-cobalt, var(--metre-accent))', '转圈 / 对勾用钴蓝，不用粉');
  const pink = RULES.filter((r) => r.parts.some((p) => p.startsWith(M) && p.includes('.pinkie-work__')) && /gradient/.test(JSON.stringify(r.decl)));
  assert.deepEqual(pink.map((r) => r.selector.slice(0, 90)), [], 'Metre 后台工作条规则里不出现渐变');
});

test('5deb9535：后台工作条在 Metre 里小一号（3px 9px / 12px / 图标 12px），贴输入框左边；后写的那条压过纸样里的 5px 11px', () => {
  const pill = find('.pinkie-work__pill', {top: true});
  const pad = lastWith(pill, 'padding');
  assert.ok(pad, '要有 Metre 的 .pinkie-work__pill { padding }');
  assert.equal(bare(pad.decl.padding), '3px 9px', '最后生效的内边距是小一号的 3px 9px');
  assert.equal(bare(lastWith(pill, 'font-size')?.decl['font-size']), '12px');
  assert.equal(bare(lastWith(pill, 'min-height')?.decl['min-height']), '0', '不按按钮的最小高度撑高');
  assert.equal(bare(lastWith(pill, 'margin-left')?.decl['margin-left']), '0');
  assert.equal(bare(lastWith(pill, 'margin-right')?.decl['margin-right']), 'auto', '靠左，贴输入框左边');
  for (const tail of ['.pinkie-work__pill .pinkie-work__icon', '.pinkie-work__pill .pinkie-work__icon svg']) {
    const icon = find(tail, {top: true});
    assert.equal(bare(lastWith(icon, 'width')?.decl.width), '12px', `${tail} 宽 12px`);
    assert.equal(bare(lastWith(icon, 'height')?.decl.height), '12px', `${tail} 高 12px`);
  }
});

// ---- 573eb777：设置页搜索框 ----
test('573eb777：设置页输入框那条 Metre 规则也包含 input[type="search"]', () => {
  const box = RULES.filter((r) => r.parts.some((p) => p.startsWith(M) && /\.pinkie-user-settings :is\([^)]*input\[type="text"\]/.test(p)) && 'border' in r.decl);
  assert.ok(box.length, '要有 .pinkie-user-settings :is(…input[type="text"]…) 的输入框规则');
  for (const r of box) {
    assert.ok(r.selector.includes('input[type="search"]'), '搜索框不能漏掉，否则在 Metre 里还是碧琪样子');
    assert.equal(bare(r.decl.border), '1px solid var(--metre-line-strong)');
    assert.equal(bare(r.decl.background), 'var(--metre-bg)');
  }
});

// ---- a1269c4b：「显示全部」点不中 ----
test('a1269c4b：侧栏通用的 :is(a, button):hover 不带 width——悬停任何按键都不被撑成整行宽', () => {
  const generic = find('aside.sidebar :is(a, button):hover');
  assert.ok(generic.length, '前提：侧栏通用悬停那条还在');
  for (const g of generic) {
    assert.ok(!('width' in g.decl) && !('min-width' in g.decl), `「${g.part.slice(0, 90)}」不能带宽度：它和总谱键的 width: 100% 并在一条里时悬停就撑满整行`);
  }
  const board = lastWith(find('aside.sidebar .pk-metre-nav--board'), 'width');
  assert.ok(board, '总谱键自己的 width 规则还在');
  assert.ok(!board.rule.parts.some((p) => /:is\(a, button\):hover$/.test(p)), '总谱键的宽度规则不和通用悬停并在一条里');
});
