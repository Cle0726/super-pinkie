// 11-26 ui4 A3（协调者 21:00）：原生 /cron 页在 Metre 里残留的英文和字母「v」筛选箭头。
// ① skin.js 把 /cron 页里整段就是相对时间 / 间隔的文字换成中文（in 5h →「5 小时后」、19h ago →「19 小时前」、Every 30m →「每 30 分钟」），
//    任务名、提示词里的英文不碰，别的页面也不碰；② 「筛选」折叠条的 ::after 不再是字母 v，换成侧栏同款 chevron。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const between = (text, from, to) => {
  const a = text.indexOf(from); assert.ok(a >= 0, `找不到「${from}」`);
  const b = text.indexOf(to, a); assert.ok(b > a, `找不到「${to}」`);
  return text.slice(a, b);
};
const skin = inj('laolao-metre-skin.js');
const {local, cron} = new Function(`${between(skin, '  const RULES = [', '\n  function rewriteText(')}\nreturn {local, cron};`)();
const inCron = {closest: (sel) => (sel === 'openclaw-cron-page' ? {} : null)};
const elsewhere = {closest: () => null};

test('A3 /cron 措辞：相对时间和间隔换成中文，保留两边空白', () => {
  const cases = {
    'in 5h': '5 小时后', '19h ago': '19 小时前', 'in 12m': '12 分钟后', '18m ago': '18 分钟前', '6d ago': '6 天前',
    'in 30s': '30 秒后', 'just now': '刚刚', 'in <1m': '不到 1 分钟后',
    'Every 30m': '每 30 分钟', 'Every 2h': '每 2 小时', 'Every 1d': '每 1 天',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(local(inCron, from), to, from);
  assert.equal(local(inCron, '\n        5h ago\n      '), '\n        5 小时前\n      ', '原生模板两边有换行缩进，只换中间');
  // 页头「下次唤醒」：周五, 2026/11/20 04:12:00 (in 12m) → 只换括号里那段
  assert.equal(local(inCron, '周五, 2026/11/20 04:12:00 (in 12m)'), '周五, 2026/11/20 04:12:00 (12 分钟后)');
});

test('A3 /cron 措辞反例：任务名、提示词、别的页面里的同样英文都不换', () => {
  for (const text of ['weather', 'ci', 'Every morning', 'Every 30m please', 'check in 5h', 'in 5 hours', 'Cron 0 8 * * * (Asia/Shanghai)', 'n/a', '(in 12m', 'done (ok)']) {
    assert.equal(cron(text), text, text);
  }
  for (const text of ['in 5h', '19h ago', 'Every 30m']) assert.equal(local(elsewhere, text), text, `${text} 在 /cron 页外面不该换`);
  assert.equal(local(inCron, 'Configure →'), '设置 →', '/cron 页里原来的措辞规则照旧');
});

test('A3 /cron：skin.js 的作用域含 openclaw-cron-page（页面晚出现也会被换）', () => {
  const scope = skin.match(/const SCOPE = '([^']+)'/);
  assert.ok(scope && scope[1].split(/,\s*/).includes('openclaw-cron-page'));
});

test('A3 /cron：「筛选」箭头不是字母 v，是侧栏同款 chevron（M6 9l6 6 6-6），只在 Metre 里', () => {
  const css = inj('laolao-metre-skin.css');
  const line = css.split(/\r?\n/).find((l) => l.includes('openclaw-cron-page .cron-filter-panel__summary::after'));
  assert.ok(line, '要有 .cron-filter-panel__summary::after 那条');
  assert.match(line, /^html\[data-laolao-mode="metre"\]/);
  const rule = line.split('/*')[0];
  assert.match(rule, /content: "";/, '原生 content:"v" 要清掉');
  assert.match(rule, /M6 9l6 6 6-6/, '和侧栏 ICONS.chevron 同一条路径');
  assert.match(rule, /-webkit-mask: var\(--pk-a3-chev\)/);
  assert.match(rule, /background: currentColor;/, '颜色跟着文字，日夜都看得见');
  assert.match(inj('laolao-sidebar.js'), /chevron: svg\('<path d="M6 9l6 6 6-6"\/>'\)/, '侧栏 chevron 变了，这里要跟着改');
  const dir = process.env.PINKIE_CONTROL_UI_ROOT ? path.join(process.env.PINKIE_CONTROL_UI_ROOT, 'assets') : '';
  if (dir && fs.existsSync(dir)) {
    const all = fs.readdirSync(dir).filter((n) => n.endsWith('.css')).map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n');
    assert.match(all, /\.cron-filter-panel__summary:after\{content:"v"/, '原生箭头不再是 ::after 里的 v？这条规则要重看');
  }
});
