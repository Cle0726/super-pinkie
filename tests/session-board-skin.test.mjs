// S6 第 2、3 步 · 多会话看板两种皮的纯函数（briefs/program-1120/设计-S6.md 第二、四、五节）。
// 数据层（linux2 的 laolao-session-board-data.js）还没合：这里用假数据直接验 laolao-session-board.js 导出的纯函数，不起浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const FILE = new URL('../ui/injections/laolao-session-board.js', import.meta.url);
const SOURCE = fs.readFileSync(FILE, 'utf8');

function load() {
  const noop = () => {};
  const window = {addEventListener: noop, Pinkie: {}};
  const document = {readyState: 'complete', documentElement: {getAttribute: () => 'chat'}, addEventListener: noop, querySelector: () => null};
  vm.runInNewContext(SOURCE, {window, document, Promise, Date, Math, Number, String, Object, JSON});
  return window.Pinkie.sessionBoardUi;
}
const ui = load();
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);
const row = (n, extra = {}) => ({key: `agent:project:s${n}`, mode: 'project', modeLabel: '项目', title: `会话 ${n}`, state: 'run', since: NOW - 5 * 60_000, ...extra});

test('一屏最多 12 行，超出折成「还有 N 个在跑」，数据层给的 more 也算进去', () => {
  assert.equal(ui.MAX_ROWS, 12);
  const rows = Array.from({length: 13}, (_, i) => row(i));
  const html = ui.listHtml({rows}, 'pinkie', NOW);
  assert.equal((html.match(/class="pk-sb-row"/g) || []).length, 12);
  assert.match(html, /还有 1 个在跑/);
  assert.doesNotMatch(html, /agent:project:s12/, '第 13 行不画');
  assert.match(ui.listHtml({rows: rows.slice(0, 12), more: 4}, 'metre', NOW), /还有 4 个在跑/);
  assert.doesNotMatch(ui.listHtml({rows: rows.slice(0, 12)}, 'pinkie', NOW), /还有 \d+ 个在跑/);
});

test('「刚做完」单独一组，最多 5 行', () => {
  const recent = Array.from({length: 7}, (_, i) => row(100 + i, {state: 'done'}));
  const html = ui.listHtml({rows: [row(1)], recent}, 'pinkie', NOW);
  assert.match(html, /<h4 class="pk-sb-sub">刚做完<\/h4>/);
  const after = html.split('刚做完')[1];
  assert.equal((after.match(/class="pk-sb-row"/g) || []).length, 5);
});

test('两种皮同一份数据，只换文案和左侧记号', () => {
  const view = {rows: [row(1, {state: 'ask', doing: '等你确认：git push'}), row(2), row(3, {state: 'error'})]};
  const pinkie = ui.listHtml(view, 'pinkie', NOW);
  const metre = ui.listHtml(view, 'metre', NOW);
  assert.match(pinkie, /laolao-pinkie-status-asking\.png/);
  assert.match(pinkie, /laolao-pinkie-status-working\.png/);
  assert.match(pinkie, /laolao-pinkie-status-oops\.png/);
  assert.match(pinkie, /碧琪在抛气球干活…/);
  assert.doesNotMatch(metre, /碧琪|\.png/, 'Metre 皮不出碧琪口吻和贴纸');
  assert.match(metre, /在处理/);
  assert.match(metre, /class="pk-sb-lamp" data-lit="1"/);
  for (const html of [pinkie, metre]) assert.match(html, /等你确认：git push/, '数据层的「在做什么」原样显示');
});

test('空状态：碧琪坐着 / 谱台没亮灯', () => {
  assert.match(ui.listHtml({rows: []}, 'pinkie', NOW), /现在没有在跑的会话/);
  const metre = ui.listHtml({}, 'metre', NOW);
  assert.match(metre, /这一声部还没开始/);
  assert.match(metre, /data-lit="0"/);
});

test('断线：保留上一次的行、变灰，在跑写成「断线前在跑」，不显示成做完', () => {
  const html = ui.listHtml({offline: true, rows: [row(1), row(2, {state: 'ask', doing: '等你确认'}), row(3, {state: 'error'})]}, 'pinkie', NOW);
  assert.match(html, /网关断了/);
  assert.equal((html.match(/data-offline="1"/g) || []).length, 3);
  assert.equal((html.match(/>断线前在跑</g) || []).length, 2, "在跑和等你两行显示断线前在跑，出错那行照旧");
  assert.doesNotMatch(html, /完成啦|status-done/);
  assert.match(ui.listHtml({offline: true, rows: [row(1)]}, 'metre', NOW), /data-lit="0"/, '断线时 Metre 的灯不亮');
});

test('跨模式的行悬停提示会切过去；同模式不提示', () => {
  const html = ui.listHtml({rows: [row(1), row(2, {key: 'agent:learning:x', mode: 'learning', modeLabel: '学习'})]}, 'pinkie', NOW, 'project');
  assert.match(html, /data-sb-key="agent:learning:x"[^>]*title="会切到「学习」"/);
  assert.doesNotMatch(html, /data-sb-key="agent:project:s1"[^>]*title=/);
});

test('已用时：打开前就在跑的写「≥」，过一小时写时分；标题、在做什么都转义', () => {
  assert.equal(ui.elapsed({since: NOW - 30_000}, NOW), '不到 1 分');
  assert.equal(ui.elapsed({since: NOW - 7 * 60_000, sinceEstimated: true}, NOW), '≥ 7 分');
  assert.equal(ui.elapsed({since: NOW - 75 * 60_000}, NOW), '1 时 15 分');
  assert.equal(ui.elapsed({}, NOW), '');
  const html = ui.rowHtml(row(1, {title: '<img onerror=x>', doing: 'a"b'}), 'pinkie', NOW);
  assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /&lt;img onerror=x&gt;/);
  assert.match(html, /a&quot;b/);
});

test('分身挂在父行下：父行写「另有 N 个分身在跑」，N 含折掉的', () => {
  const parent = row(1, {children: [row(2), row(3)], childMore: 9});
  assert.match(ui.rowHtml(parent, 'metre', NOW), /另有 11 个分身在跑/);
  assert.doesNotMatch(ui.rowHtml(row(4), 'metre', NOW), /分身/);
});

test('总状态一句：Metre 用总控台口吻', () => {
  assert.equal(ui.summary({rows: [row(1, {state: 'ask'}), row(2)]}, 'metre'), '等你（1）');
  assert.equal(ui.summary({rows: [row(1), row(2)], running: 2}, 'metre'), '2 个声部在奏');
  assert.equal(ui.summary({rows: []}, 'metre'), '休止');
  assert.equal(ui.summary({rows: [row(1)]}, 'pinkie'), '1 个在跑');
});

test('界面文件不发请求、不开定时器、不加观察器、不新增 window.__ 全局名，不碰侧栏大文件', () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /gwRequest|fetch\(|WebSocket|setInterval|new MutationObserver|requestAnimationFrame/);
  assert.doesNotMatch(code, /window\.__\w+\s*=(?!=)/);
  assert.match(code, /window\.Pinkie\.sessionBoardUi = Object\.freeze/);
  const head = fs.readFileSync(new URL('../ui/injections/laolao-head.fragment.html', import.meta.url), 'utf8');
  for (const f of ['laolao-session-board.css', 'laolao-metre-session-board.css', 'laolao-session-board.js']) assert.match(head, new RegExp(`/${f.replace(/\./g, '\\.')}\\?v=@hash`), f);
  assert.ok(head.indexOf('laolao-metre-board.js') < head.indexOf('laolao-session-board.js'), '总控台先加载，「全部会话」一栏才在');
  const board = fs.readFileSync(new URL('../ui/injections/laolao-metre-board.js', import.meta.url), 'utf8');
  assert.match(board, /\{id: 'all', en: 'Ensemble', title: '全部会话', wide: true/);
  const css = fs.readFileSync(new URL('../ui/injections/laolao-metre-session-board.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.split('}').map((s) => s.trim()).filter((s) => s && !s.startsWith('@'))) {
    const sel = rule.split('{')[0].trim();
    if (sel) for (const part of sel.split(',')) assert.match(part.trim(), /^\[data-metre-board\]/, part);
  }
  for (const f of ['laolao-session-board.css', 'laolao-metre-session-board.css']) assert.doesNotMatch(fs.readFileSync(new URL(`../ui/injections/${f}`, import.meta.url), 'utf8'), /!\s*important/, f);
});
