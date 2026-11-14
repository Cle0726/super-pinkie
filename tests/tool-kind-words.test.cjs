// PLAN 2.8 状态词补全：每个类别一条用例（A3-2），四张文案表对齐（A3-4），看图 / 生图分开（A3-3），
// Windows 命令（WINDOWS-PROMPT 第四节：del、move、ren、Remove-Item、winget、Invoke-WebRequest）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TK = require('../ui/injections/laolao-tool-kind.js');

const PLAN_KINDS = ['create', 'write', 'delete', 'move', 'install', 'build', 'git', 'download', 'view', 'shot',
  'dispatch', 'wait', 'review', 'manage', 'models'];

test('the shared table lists exactly the PLAN 2.8 categories', () => {
  assert.deepEqual(TK.KINDS, PLAN_KINDS);
  for (const k of PLAN_KINDS) {
    assert.ok(TK.ING[k], 'ING.' + k);
    assert.equal(typeof TK.DONE[k], 'function', 'DONE.' + k);
  }
});

test('commands are classified by their leading program, macOS and Windows alike', () => {
  const cases = [
    ['rm -rf build', 'delete'], ['del /q C:\\tmp\\a.txt', 'delete'], ['erase a.txt', 'delete'], ['rd /s /q out', 'delete'],
    ['Remove-Item -Recurse -Force .\\dist', 'delete'], ['trash ~/Desktop/old.png', 'delete'],
    ['mv a.txt b.txt', 'move'], ['move C:\\a.txt D:\\b.txt', 'move'], ['ren 旧名.txt 新名.txt', 'move'], ['Move-Item a b', 'move'], ['Rename-Item a b', 'move'],
    ['npm install left-pad', 'install'], ['pnpm add zod', 'install'], ['yarn', 'install'], ['pip install requests', 'install'],
    ['brew install ffmpeg', 'install'], ['winget install --id Git.Git', 'install'], ['choco install nodejs', 'install'],
    ['npm run build', 'build'], ['pnpm build', 'build'], ['make -j8', 'build'], ['cargo build --release', 'build'], ['dotnet build', 'build'], ['go build ./...', 'build'],
    ['git commit -m "x"', 'git'], ['git push origin HEAD', 'git'], ['git pull --rebase', 'git'], ['git fetch origin', 'git'],
    ['curl -O https://x/y.zip', 'download'], ['curl -L -o out.zip https://x', 'download'], ['wget https://x/y.zip', 'download'],
    ['Invoke-WebRequest -Uri https://x/y.zip -OutFile y.zip', 'download'], ['iwr https://x -OutFile y', 'download'],
    // 前缀：sudo、环境变量、cd 目录 &&、cmd /c、带路径的程序
    ['sudo rm /tmp/x', 'delete'], ['FOO=1 npm install', 'install'], ['cd C:\\proj && git push', 'git'], ['cmd /c del a.txt', 'delete'],
    ['C:\\Windows\\System32\\winget.exe install x', 'install'], ['"C:\\Program Files\\Git\\bin\\git.exe" commit -m x', 'git'],
  ];
  for (const [cmd, want] of cases) assert.equal(TK.ofCommand(cmd), want, cmd);
});

test('commands that cannot be told apart fall back (no guessing)', () => {
  for (const cmd of ['ls -la', 'git status', 'git log', 'curl https://x', 'Invoke-WebRequest https://x', 'npm test', 'node a.js', 'python -m http.server', 'echo hi', '']) {
    assert.equal(TK.ofCommand(cmd), '', cmd);
    assert.equal(TK.refine('exec', 'exec', {command: cmd}, null), 'exec', cmd);
  }
});

test('each PLAN 2.8 category has a case through refine / runKind', () => {
  const r = (base, name, args, trace) => TK.refine(base, name, args, trace);
  assert.equal(r('write', 'write', {path: 'a.txt'}, {created: true}), 'create');
  assert.equal(r('write', 'write', {path: 'a.txt'}, {created: false}), 'write');
  assert.equal(r('write', 'write', {path: 'a.txt'}, null), 'write', 'no backend record → the old word');
  assert.equal(r('exec', 'exec', {command: 'Remove-Item a.txt'}), 'delete');
  assert.equal(r('exec', 'exec', {command: 'ren a b'}), 'move');
  assert.equal(r('exec', 'exec', {command: 'winget install x'}), 'install');
  assert.equal(r('exec', 'exec', {command: 'npm run build'}), 'build');
  assert.equal(r('exec', 'exec', {command: 'git commit -m x'}), 'git');
  assert.equal(r('exec', 'exec', {command: 'Invoke-WebRequest u -OutFile f'}), 'download');
  assert.equal(r('read', 'read', {path: 'C:\\Users\\me\\图片\\截图 1.png'}), 'view');
  assert.equal(r('read', 'read', {path: 'notes.md'}), 'read');
  assert.equal(r('browse', 'browser', {action: 'screenshot'}), 'shot');
  assert.equal(r('computer', 'computer', {action: 'screenshot'}), 'shot');
  assert.equal(r('browse', 'browser', {action: 'navigate'}), 'browse');
  assert.equal(r('session', 'pinkie_session_start', {mode: 'project'}), 'dispatch');
  assert.equal(r('session', 'pinkie_session_message', {}), 'session');
  assert.equal(r('manage', 'pinkie_sessions', {}), 'manage');
  assert.equal(r('models', 'pinkie_models', {}), 'models');
  assert.equal(TK.runKind({metre: true, ended: true, childrenRunning: 2}), 'wait');
  assert.equal(TK.runKind({metre: true, woken: true}), 'review');
  assert.equal(TK.runKind({metre: false, ended: true, childrenRunning: 2}), '', 'only Metre waits on children');
  assert.equal(TK.runKind({metre: true, ended: true, childrenRunning: 0}), '');
});

test('A3-3: the image tool is "looking at a picture", image_generate is still "generating"', () => {
  assert.equal(TK.refine('image', 'image', {image: 'a.png'}), 'view');
  assert.equal(TK.refine('image', 'image_generate', {prompt: 'cat'}), 'image');
  const stage = read('ui/injections/laolao-cle-stage.js');
  assert.match(stage, /image: '图片生成中'/);
  assert.match(stage, /view: '正在看图片'/);
});

test('git says commit / push / pull while running', () => {
  assert.equal(TK.ing('git', 'git commit -m x'), '正在提交');
  assert.equal(TK.ing('git', 'git push'), '正在推送');
  assert.equal(TK.ing('git', 'git pull --rebase'), '正在拉取');
  assert.equal(TK.ing('git', {command: 'git fetch'}), '正在拉取');
});

test('done words name the file, Windows paths included (A3-9)', () => {
  assert.equal(TK.done('create', 'C:\\Users\\me\\项目\\新建 文件.txt'), '创建了 新建 文件.txt');
  assert.equal(TK.done('create', '~/proj/a.txt:1–20'), '创建了 a.txt');
  assert.equal(TK.done('write', '/Users/me/a.md'), '写入了 a.md');
  assert.equal(TK.done('delete', 'del /q D:\\旧\\a.txt'), '删除了 a.txt');
  assert.equal(TK.done('view', 'D:\\图\\截图 1.png'), '看了 截图 1.png');
  assert.equal(TK.done('dispatch', '项目模式'), '派给了 项目模式');
  assert.equal(TK.done('build', ''), '构建完成');
  assert.equal(TK.done('git', 'git push'), '已推送');
  assert.equal(TK.done('shot', ''), '截了一张图');
});

// ── A3-4：舞台、话术、工具流、状态条四张表 ──
function stageTables() {
  const src = read('ui/injections/laolao-cle-stage.js');
  const objectAt = (name) => {
    const start = src.indexOf('const ' + name + ' = {');
    assert.ok(start >= 0, name);
    let depth = 0, i = src.indexOf('{', start);
    const from = i;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
    return src.slice(from, i + 1);
  };
  const ctx = {window: {__pinkieToolKind: TK}, cnNum: (n) => String(n)};
  const VERB = vm.runInNewContext('(' + objectAt('VERB') + ')', ctx);
  const DONE_WORD = vm.runInNewContext('(' + objectAt('DONE_WORD') + ')', ctx);
  return {VERB, DONE_WORD};
}
function toolStreamTable() {
  const window = {addEventListener() {}};
  const document = {readyState: 'loading', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }};
  vm.runInNewContext(read('ui/injections/laolao-tool-stream.js'), {window, document, location: {search: ''}, URLSearchParams, setTimeout() {}, setInterval() {}});
  return window.__laolaoToolStream.KIND_CN;
}
function runStatusTable() {
  const window = {localStorage: {getItem() { return null; }, setItem() {}, removeItem() {}}};
  const document = {readyState: 'loading', hidden: false, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, documentElement: {dataset: {}}};
  vm.runInNewContext(read('ui/injections/laolao-run-status.js'), {window, document, localStorage: window.localStorage, console, URL, Map, Set, WeakMap, Date, Math, JSON, Promise, CustomEvent: class {}});
  return window.__pinkieRunStatus.TOOL_PHRASE;
}

test('A3-4: the four word tables cover the same categories', () => {
  const {VERB, DONE_WORD} = stageTables();
  const tables = {
    stage: Object.keys(VERB).filter((k) => PLAN_KINDS.includes(k)),
    stageDone: Object.keys(DONE_WORD).filter((k) => PLAN_KINDS.includes(k)),
    phrases: Object.keys(TK.ING),
    toolStream: Object.keys(toolStreamTable()),
    runStatus: Object.keys(runStatusTable()),
  };
  for (const [name, keys] of Object.entries(tables)) assert.deepEqual([...keys].sort(), [...PLAN_KINDS].sort(), name);
  // 进行中的说法：舞台和话术逐字一致
  for (const k of PLAN_KINDS) assert.equal(VERB[k], TK.ING[k], 'VERB.' + k);
  // 完成后的说法：一次时说清对象
  assert.equal(DONE_WORD.create(1, 'C:\\a\\新.txt'), '创建了 新.txt');
  assert.equal(DONE_WORD.create(3, ''), '创建了 3 个文件');
  assert.equal(DONE_WORD.view(1, 'shot.png'), '看了 shot.png');
});

test('the stage knows the new tools, and the shared table loads before the stage', () => {
  const stage = read('ui/injections/laolao-cle-stage.js');
  assert.match(stage, /pinkie_sessions: 'manage'/);
  assert.match(stage, /pinkie_models: 'models'/);
  assert.match(stage, /pinkie:tool-trace/);
  const head = read('ui/injections/laolao-head.fragment.html');
  const at = (s) => head.indexOf(s);
  assert.ok(at('laolao-tool-kind.js') > 0);
  assert.ok(at('laolao-tool-kind.js') < at('laolao-tool-stream.js'));
  assert.ok(at('laolao-tool-kind.js') < at('laolao-run-status.js'));
  assert.ok(at('laolao-tool-kind.js') < at('laolao-cle-stage.js'));
  const phrases = read('ui/injections/laolao-phrases.js');
  assert.match(phrases, /pinkie_sessions:'整理会话'/);
  assert.match(phrases, /pinkie_models:'看可用模型'/);
  assert.match(phrases, /image:'看图片',image_generate:'生成图片'/);
});

test('run status follows Metre sessions too and words a working run by its kind', () => {
  const src = read('ui/injections/laolao-run-status.js');
  assert.match(src, /const SESSION = \/\^agent:\(\?:main\|project\|thinking\|learning\|unrestricted\|metre\):\//);
  const window = {localStorage: {getItem() { return null; }, setItem() {}, removeItem() {}}};
  const document = {readyState: 'loading', hidden: false, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, documentElement: {dataset: {}}};
  vm.runInNewContext(src, {window, document, localStorage: window.localStorage, console, URL, Map, Set, WeakMap, Date, Math, JSON, Promise, CustomEvent: class {}});
  const api = window.__pinkieRunStatus;
  const T0 = 1_800_000_000_000;
  const plain = api.describe({now: T0 + 5000, conn: {online: true}, live: {active: true, state: 'working', tool: 'install', startedAt: T0}});
  assert.equal(plain.visible, false, 'a plain working run stays hidden (the process card says it)');
  assert.equal(plain.text, '碧琪在安装依赖…');
  const wait = api.describe({now: T0 + 5000, conn: {online: true}, live: {active: true, state: 'thinking', tool: 'wait', startedAt: T0}});
  assert.equal(wait.visible, true);
  assert.equal(wait.text, '在等子会话做完');
});

test('rowCallId finds the call id in both layouts (tool result rows and timeline rows)', () => {
  const row = (messageId) => ({closest: () => ({dataset: {messageId}})});
  const messages = [
    {role: 'user', timestamp: 1},
    {role: 'assistant', timestamp: 1794647759985, content: [{type: 'text'}, {type: 'toolCall', id: 'call-a'}, {type: 'toolCall', id: 'call-b'}]},
  ];
  const doc = {querySelector: (sel) => (sel === 'openclaw-chat-pane' ? {state: {chatMessages: messages}} : null)};
  const ctx = {document: doc, window: {}, module: {exports: {}}};
  vm.runInNewContext(read('ui/injections/laolao-tool-kind.js'), ctx);
  const api = ctx.module.exports;
  assert.equal(api.rowCallId(row('tool:toolResult:chatcmpl-tool-9c7d')), 'chatcmpl-tool-9c7d');
  assert.equal(api.rowCallId(row('msg:assistant:1794647759985:1:timeline:tool:0:timeline:tool:0')), 'call-a');
  assert.equal(api.rowCallId(row('msg:assistant:1794647759985:1:timeline:tool:1')), 'call-b');
  assert.equal(api.rowCallId(row('msg:assistant:1794647759985:7:timeline:tool:1')), 'call-b', 'index moved: found by timestamp');
  assert.equal(api.rowCallId(row('msg:assistant:42:1:timeline:tool:0')), '', 'unknown message → no guess');
});
