// L37 / T3#9：Metre 工作过程里命令那一步的「命令头」（laolao-metre-cmdout.js）。
// 复发防护：
//   1. 原生展开 exec 这一步只给参数 JSON 和输出原文，看不出跑的是哪条命令、成没成功、是不是还在后台跑。
//      Metre 里必须在输出上方写出 `$ 命令` 和结果（退出码 N / 没成功 / 还在后台跑 / 跑完了），说不清就不写、不猜。
//   2. 「复制输出」去掉终端颜色控制码，规则和 R2 会话终端上报前的清理是同一个（window.Pinkie.workbench.term.plainText）。
//   3. 只在 Metre 生效，其他模式一个字不动；不新增观察器、循环定时器、window.__ 全局名、!important。
// 纯 node（vm 里跑注入脚本 + 最小假 DOM），不起浏览器。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const js = read('../ui/injections/laolao-metre-cmdout.js');
const css = read('../ui/injections/laolao-metre-cmdout.css');
const termJs = read('../ui/injections/laolao-workbench-term.js');
const head = read('../ui/injections/laolao-head.fragment.html');
const regions = JSON.parse(read('../ui/injections/regions.json'));

// ---------- 最小假 DOM：只够脚本找到工具步骤、在输出上方加命令头 ----------
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; this.className = ''; this._text = ''; this.title = ''; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); for (const c of this.children) c.parent = null; this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...nodes) { for (const n of nodes) { n.remove?.(); n.parent = this; this.children.push(n); } }
  prepend(...nodes) { for (const n of nodes.reverse()) { n.remove?.(); n.parent = this; this.children.unshift(n); } }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
  has(cls) { return ` ${this.className} `.includes(` ${cls} `); }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelector(sel) {
    if (sel === ':scope > .pk-mcmd') return this.children.find(c => c.has('pk-mcmd')) || null;
    const cls = sel.replace(/^\./, '');
    return this.all().find(c => c.has(cls)) || null;
  }
  querySelectorAll() { return []; }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matchesSel?.(sel) || n.has(sel.replace(/^\./, ''))) return n; return null; }
}

function load({mode = 'metre', withTerm = false, history = [], night = false} = {}) {
  const watches = [], frames = [], queried = [];
  const attrs = {'data-laolao-mode': mode};
  const bodies = [];
  const document = {
    documentElement: {getAttribute: n => attrs[n] ?? null, hasAttribute: n => n in attrs},
    addEventListener() {},
    createElement: tag => new El(tag),
    querySelector: () => null,
    querySelectorAll: sel => {
      queried.push(sel);
      if (sel === '.pinkie-process .chat-tool-msg-body') return bodies;
      if (sel === '.pk-mcmd') return bodies.flatMap(b => b.children.filter(c => c.has('pk-mcmd')));
      return [];
    },
  };
  const window = {
    Pinkie: {domWatch: {watch: (selector, fn, options) => { watches.push({selector, fn, options}); return {disconnect() {}}; }}},
    __pinkieToolKind: {rowCallId: row => row.dataset.callId || ''},
    addEventListener() {},
  };
  const ctx = {window, document, navigator: {}, setTimeout, clearTimeout, requestAnimationFrame: fn => { frames.push(fn); return frames.length; }};
  vm.createContext(ctx);
  if (withTerm) vm.runInContext(termJs, ctx);
  vm.runInContext(js, ctx);
  // 一个工具步骤：.chat-tool-msg-collapse > summary + body；pane 里放这一轮的历史
  const pane = new El('openclaw-chat-pane');
  pane.matchesSel = sel => sel === 'openclaw-chat-pane';
  pane.state = {chatMessages: history};
  const addStep = callId => {
    const collapse = new El('div'); collapse.className = 'chat-tool-msg-collapse';
    const summary = new El('button'); summary.className = 'chat-tool-msg-summary'; summary.dataset.callId = callId;
    const body = new El('div'); body.className = 'chat-tool-msg-body';
    collapse.append(summary, body); pane.append(collapse); bodies.push(body);
    return body;
  };
  const flush = () => { while (frames.length) frames.shift()(); };
  return {api: window.Pinkie.metreCmdout, window, watches, queried, addStep, flush, setMode: m => { attrs['data-laolao-mode'] = m; }};
}
const plain = value => JSON.parse(JSON.stringify(value));
const t = text => [{type: 'text', text}];
const HISTORY = [
  {role: 'user', content: t('跑一下测试'), timestamp: 1},
  {role: 'assistant', content: [{type: 'toolCall', id: 'c1', name: 'exec', arguments: {command: 'npm test -- --grep login'}}], timestamp: 2},
  {role: 'toolResult', toolCallId: 'c1', toolName: 'exec', isError: true, content: t('\x1b[31mFAIL\x1b[0m tests/login.test.js\n\n(Command exited with code 1)'), timestamp: 3},
  {role: 'assistant', content: [{type: 'toolCall', id: 'c2', name: 'exec', arguments: {command: 'npm run dev'}}], timestamp: 4},
  {role: 'toolResult', toolCallId: 'c2', toolName: 'exec', content: t('Command still running (session dawn-glade, pid 29891). Use process for follow-up.'), timestamp: 5},
  {role: 'assistant', content: [{type: 'toolCall', id: 'r1', name: 'read', arguments: {path: 'README.md'}}], timestamp: 6},
  {role: 'toolResult', toolCallId: 'r1', toolName: 'read', content: t('# proj'), timestamp: 7},
];
const headOf = body => body.children.find(c => c.has('pk-mcmd')) || null;
const parts = h => ({
  line: h.children.find(c => c.has('pk-mcmd__line'))?.textContent,
  status: h.children.find(c => c.has('pk-mcmd__status'))?.textContent,
  kind: h.children.find(c => c.has('pk-mcmd__status'))?.dataset.kind,
  buttons: (h.children.find(c => c.has('pk-mcmd__actions'))?.children || []).map(b => b.textContent),
});

test('registered in the head fragment and the metre region, right after laolao-metre-code.css', () => {
  assert.match(head, /laolao-metre-code\.css\?v=@hash">\n<link rel="stylesheet" href="\/laolao-metre-cmdout\.css\?v=@hash">\n<script defer src="\/laolao-metre-cmdout\.js\?v=@hash"><\/script>/);
  const metre = regions.regions.find(r => r.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-cmdout.css') && metre.files.includes('laolao-metre-cmdout.js'));
});

test('no new observer, interval, window.__ global or !important; every CSS rule is scoped to Metre', () => {
  assert.doesNotMatch(js, /MutationObserver|setInterval|window\.__\w+\s*=(?!=)|globalThis\.__/);
  assert.doesNotMatch(css, /!\s*important/i);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{/g) || [];
  assert.ok(rules.length >= 5, 'has rules');
  for (const rule of rules) {
    for (const sel of rule.slice(0, -1).split(',')) assert.match(sel.trim(), /^html\[data-laolao-mode="metre"\]/, 'scoped to Metre: ' + sel.trim());
  }
  assert.equal(load().watches.length, 1, 'exactly one shared domWatch registration');
});

// linux-review 12:28Z（#444 评论 7218279617）：夜间失败色只写在 [data-pinkie-night] 下，Metre 夜间只带 data-theme="dark" 时
// 会停在日间 #9A3B2F（对夜间底 #151514 约 2.6:1）。颜色必须跟皮肤的日夜变量走，不自己按 data-pinkie-night 分日夜。
test('status colours follow the Metre skin variables, so night works with data-theme="dark" too', () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bare, /\.pk-mcmd__status\[data-kind="fail"\]\s*\{\s*color:\s*var\(--metre-danger\b/, 'fail colour is the skin --metre-danger');
  assert.doesNotMatch(bare, /\[data-pinkie-night\]/, 'no rule that only applies under data-pinkie-night');
  for (const m of bare.matchAll(/color:\s*([^;}]+)/g)) assert.match(m[1].trim(), /^var\(--metre-[\w-]+/, 'every colour comes from a Metre skin variable: ' + m[1].trim());
});

// uireview 15:26Z（#444 截图审，run 46009337154）：日间按钮字用 --metre-muted（#77736B）叠在 #F7F6F3 上只有 4.18–4.37，
// 12px 正文要 4.5；命令行用 <code> 时被通用 code 样式铺了一块底色和内边距。按钮字改用 --metre-text，命令行改成 <span>。
test('copy buttons use --metre-text (not the muted grey) and the command line is a plain span, not a <code>', () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const btn = bare.match(/\.pk-mcmd__btn\s*\{([^}]*)\}/);
  assert.ok(btn, 'has a .pk-mcmd__btn rule');
  assert.match(btn[1], /(?:^|[;\s])color:\s*var\(--metre-text\b/, 'button text is --metre-text');
  assert.doesNotMatch(btn[1], /--metre-muted/, 'button text is not the muted grey (under 4.5 by day)');
  const page = load({history: HISTORY});
  const body = page.addStep('c1');
  page.api.paint(); page.flush();
  const line = headOf(body).children.find(c => c.has('pk-mcmd__line'));
  assert.equal(line.tagName, 'SPAN', 'command line is not a <code>, so the shared code background does not apply');
});

test('in Metre: each command step gets `$ command`, the result it really had, and copy buttons; other tools get nothing', () => {
  const page = load({history: HISTORY});
  const failed = page.addStep('c1'), running = page.addStep('c2'), reading = page.addStep('r1');
  page.api.paint(); page.flush();
  assert.ok(headOf(failed), 'failed command has a header');
  assert.deepEqual(parts(headOf(failed)), {line: '$ npm test -- --grep login', status: '退出码 1', kind: 'fail', buttons: ['复制命令', '复制输出']});
  assert.equal(failed.children[0], headOf(failed), 'header sits above the native output');
  assert.deepEqual(parts(headOf(running)), {line: '$ npm run dev', status: '还在后台跑', kind: 'running', buttons: ['复制命令', '复制输出']});
  assert.equal(headOf(reading), null, 'read step is not a command');
  // 重画不重复加
  page.api.paint(); page.flush();
  assert.equal(failed.children.filter(c => c.has('pk-mcmd')).length, 1);
  // 离开 Metre：命令头拿掉，不再去查工具步骤
  page.setMode('chat');
  page.queried.length = 0;
  page.api.paint(); page.flush();
  assert.equal(headOf(failed), null);
  assert.equal(headOf(running), null);
  assert.ok(!page.queried.includes('.pinkie-process .chat-tool-msg-body'), 'outside Metre the tool steps are not touched');
});

test('in other modes nothing is painted', () => {
  const page = load({mode: 'project', history: HISTORY});
  const body = page.addStep('c1');
  page.api.paint(); page.flush();
  assert.equal(headOf(body), null);
  assert.equal(body.children.length, 0);
});

test('command line comes from the call arguments (object, JSON string, cmd, argv)', () => {
  const {api} = load();
  assert.equal(api.commandOf({command: 'npm test'}), 'npm test');
  assert.equal(api.commandOf('{"command":"git status --short"}'), 'git status --short');
  assert.equal(api.commandOf({cmd: 'ls -la'}), 'ls -la');
  assert.equal(api.commandOf({command: ['python', '-m', 'unittest']}), 'python -m unittest');
  assert.equal(api.commandOf({path: 'a.txt'}), '');
  assert.equal(api.commandOf('not json'), '');
  assert.equal(api.model({name: 'read', args: {command: 'x'}}), null, 'non-command tools get no header');
  assert.equal(api.model({name: 'exec', args: {}}), null, 'no command, no header');
});

test('status only says what the output or isError says; otherwise nothing', () => {
  const {api} = load();
  assert.deepEqual(plain(api.statusOf('FAIL a.test.js\n(Command exited with code 1)')), {kind: 'fail', code: 1, text: '退出码 1'});
  assert.deepEqual(plain(api.statusOf('build ok\n\nProcess exited with code 0.')), {kind: 'ok', code: 0, text: '退出码 0'});
  assert.deepEqual(plain(api.statusOf('Command still running (session tidal-harbor, pid 28573). Use process …')), {kind: 'running', text: '还在后台跑'});
  assert.deepEqual(plain(api.statusOf('boom', true)), {kind: 'fail', text: '没成功'});
  assert.deepEqual(plain(api.statusOf('shared UI check OK', false)), {kind: 'ok', text: '跑完了'});
  assert.deepEqual(plain(api.statusOf('shared UI check OK')), {kind: '', text: ''}, 'unknown → no guess');
});

// linuxwatch 11:48Z（#444 评论 7217495613）在 vm 里实测的三条：两句话出现在命令自己打印的内容里（grep 到源码、子进程日志），
// 旧实现取第一处、不看 isError，写成「还在后台跑」「退出码 1」，第 3 条甚至把失败写成「退出码 0」（ok）。
test('status: only the leading background line and the trailing exit line count; isError true is never shown as ok', () => {
  const {api} = load();
  // 1. git grep 命中源码里那句，命令本身末尾退出码 0
  assert.deepEqual(plain(api.statusOf('services/mode-architecture/background-jobs.mjs:12:  // e.g. Command still running (session calm-reef, pid 1)\n\n(Command exited with code 0)', false)),
    {kind: 'ok', code: 0, text: '退出码 0'}, 'a grep hit is not a background command');
  assert.deepEqual(plain(api.statusOf('Command still running (session calm-reef, pid 1)\nfrom a test fixture\n\n(Command exited with code 0)')),
    {kind: 'ok', code: 0, text: '退出码 0'}, 'even at the very start, a trailing exit line means the command finished');
  // 2. 子进程日志里有一行退出码 1，整条命令退出码 0
  assert.deepEqual(plain(api.statusOf('[worker] Process exited with code 1\nretrying… ok\n\n(Command exited with code 0)', false)),
    {kind: 'ok', code: 0, text: '退出码 0'}, 'a child log line is not the command exit code');
  // 3. 子进程日志里有一行退出码 0，整条命令退出码 2，内核 isError 为真
  assert.deepEqual(plain(api.statusOf('[child] Process exited with code 0\nboom\n\n(Command exited with code 2)', true)),
    {kind: 'fail', code: 2, text: '退出码 2'}, 'a failed command is never shown as exit 0');
  // 矛盾时只写「没成功」
  assert.deepEqual(plain(api.statusOf('done\n\n(Command exited with code 0)', true)), {kind: 'fail', text: '没成功'});
  assert.deepEqual(plain(api.statusOf('Command still running (session s1, pid 4242). Use process for follow-up.', true)), {kind: 'fail', text: '没成功'});
  // 末尾空白不影响；只在中间出现、末尾没有的不算
  assert.deepEqual(plain(api.statusOf('x\n(Command exited with code 3)\n\n  \n')), {kind: 'fail', code: 3, text: '退出码 3'});
  assert.deepEqual(plain(api.statusOf('Process exited with code 1\nstill printing')), {kind: '', text: ''});
  assert.deepEqual(plain(api.statusOf('log: Command still running (session s1, pid 9)\nmore')), {kind: '', text: ''});
});

test('copied output drops terminal control codes with the same rule as the R2 session terminal', () => {
  const raw = '\x1b[32mPASS\x1b[0m tests/a.test.js\r\n\x1b]0;title\x07done\r\n\n';
  const own = load().api.model({name: 'exec', args: {command: 'npm test'}, output: raw});
  assert.equal(own.output, 'PASS tests/a.test.js\ndone');
  const shared = load({withTerm: true});
  assert.equal(typeof shared.window.Pinkie.workbench.term.plainText, 'function');
  assert.equal(shared.api.plainText(raw), shared.window.Pinkie.workbench.term.plainText(raw), 'uses the R2 cleanup when it is loaded');
  assert.equal(own.output, shared.window.Pinkie.workbench.term.plainText(raw).replace(/\n+$/, ''), 'fallback is the same rule');
});
