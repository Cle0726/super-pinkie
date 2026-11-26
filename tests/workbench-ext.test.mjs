import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {EventEmitter} from 'node:events';

// 工作台扩展市场（workbench-ext.mjs）的纯逻辑单测：目录、查找可执行文件、安装命令拼装、安装任务状态机、
// Homebrew 搜索结果解析、格式化器选择。全部在临时目录里做：HOME 与 PINKIE_STATE_ROOT 指到临时目录，
// 要用到的 npm / go / brew / gofmt 等都是临时目录里的假脚本；本机代理端口探测换成假的 net.connect，
// 不联网、不装任何真软件、不碰用户目录。依赖可执行位和 /bin/sh，Windows 上整文件跳过。
const SKIP = process.platform === 'win32' && '依赖 POSIX 可执行位与 /bin/sh';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-wbext-'));
const HOME = path.join(ROOT, 'home');
process.env.HOME = HOME;
process.env.PINKIE_STATE_ROOT = path.join(ROOT, 'state');
process.on('exit', () => fs.rmSync(ROOT, {recursive: true, force: true}));
// 代理探测：一律当作端口没开（不去连本机真实的 7897 / 7890）
const probed = [];
net.connect = opts => { probed.push(opts.port); const s = new EventEmitter(); s.destroy = () => {}; setImmediate(() => s.emit('error', new Error('refused'))); return s; };

const X = await import('../services/mode-architecture/workbench-ext.mjs');
const {CATALOG, ExtensionMarket, LSP_DIR, formatText, formatters, searchDirs, toolPath, which} = X;
const BIN = path.join(LSP_DIR, 'bin');

function exe(dir, name, body = 'exit 0') {
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}
// 安装命令依赖的工具：放进 LSP_DIR/bin（searchDirs 第二位，优先于系统目录）
const TOOLS = ['npm', 'go', 'rustup', 'uv', 'jq'];
for (const name of TOOLS) exe(BIN, name);
exe(path.join(HOME, '.local/bin'), 'python3');
const FAKE_BREW = exe(path.join(HOME, '.homebrew/bin'), 'brew', [
  'if [ "$1" = search ]; then printf "jq\\nBAD NAME\\njq-extra\\n\\n"; exit 0; fi',
  'printf \'{"formulae":[{"name":"jq","desc":"JSON 处理","versions":{"stable":"1.7"},"homepage":"https://jq","license":"MIT","installed":[{}]}]}\'',
].join('\n'));
const realBrewFirst = fs.existsSync('/opt/homebrew/bin/brew'); // 本机真有 Homebrew 时它排在假 brew 前面
const BREW_SKIP = SKIP || (realBrewFirst && '本机 /opt/homebrew 的 brew 排在假 brew 前面');

// 已知 bug 先钉住现状：里面写的是正确行为，外面断言「目前仍然不成立」。
// 源码修好后这里会变红，届时去掉 stillBuggy 包装和 todo 标记，直接断言正确行为。
async function stillBuggy(correct) {
  await assert.rejects(async () => correct(), {name: 'AssertionError'}, '这个已知 bug 好像已经修好了：请去掉 stillBuggy 包装和 todo 标记，直接断言正确行为');
}

test('目录：id 不重复，种类 / 安装方式取值合法；每项都能判断是否已装；needs 指向目录里的工具', {skip: SKIP}, () => {
  const ids = CATALOG.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of CATALOG) {
    assert.ok(['lsp', 'format', 'runtime', 'tool'].includes(e.kind), e.id);
    assert.ok(['npm', 'brew', 'go', 'rustup', 'uv', 'system'].includes(e.install.via), e.id);
    assert.ok(e.bin || typeof e.detect === 'function', `${e.id} 既没有 bin 也没有 detect`);
    if (e.install.via !== 'system') assert.ok(e.install.pkg, `${e.id} 缺包名`);
    if (e.kind === 'lsp' || e.kind === 'format') assert.ok(e.langs?.length, `${e.id} 缺语言`);
    // needs 可能是命令名（go）或目录里某项的包名（rustup 由 id = rust 的条目装）
    if (e.needs) assert.ok(CATALOG.some(c => c.bin === e.needs || c.id === e.needs || c.install.pkg === e.needs), `${e.id} needs ${e.needs}`);
    for (const k of ['name', 'desc', 'license', 'icon']) assert.ok(e[k], `${e.id} 缺 ${k}`);
  }
});

test('which / searchDirs / toolPath：按优先级找第一个可执行文件；没执行权限的文件和目录不算；PATH 去重', {skip: SKIP}, () => {
  const dirs = searchDirs();
  assert.equal(dirs[0], path.join(LSP_DIR, 'node_modules/.bin'));
  assert.equal(dirs[1], BIN);
  assert.ok(dirs.includes(path.join(HOME, '.local/bin')));
  const a = path.join(ROOT, 'wa'), b = path.join(ROOT, 'wb');
  exe(b, 'tool-x');
  assert.equal(which('tool-x', [a, b]), path.join(b, 'tool-x'));
  exe(a, 'tool-x');
  assert.equal(which('tool-x', [a, b]), path.join(a, 'tool-x'), '排前面的目录优先');
  fs.writeFileSync(path.join(a, 'plain'), 'x');
  fs.mkdirSync(path.join(a, 'dir-y'));
  assert.equal(which('plain', [a]), '');
  assert.equal(which('dir-y', [a]), '');
  assert.equal(which('nope', [a, path.join(ROOT, 'missing')]), '');
  assert.equal(which('jq'), path.join(BIN, 'jq'));
  const parts = toolPath().split(':');
  assert.equal(new Set(parts).size, parts.length);
  assert.ok(parts.includes(path.dirname(process.execPath)));
  assert.ok(parts.every(Boolean));
  assert.deepEqual(parts.slice(0, 3), dirs.slice(0, 3));
});

test('已知 bug：多个 nvm 版本时按字符串倒序挑，v9 排在 v20 前面、v20.9 排在 v20.11 前面', {skip: SKIP, todo: '源码未修：nvmBins() 用 sort().reverse() 按字典序而不是版本号排序'}, async () => {
  for (const v of ['v9.11.2', 'v20.11.0', 'v20.9.0']) fs.mkdirSync(path.join(HOME, '.nvm/versions/node', v, 'bin'), {recursive: true});
  try {
    await stillBuggy(() => {
      const order = searchDirs().filter(d => d.includes('.nvm')).map(d => d.split(path.sep).at(-2));
      assert.deepEqual(order, ['v20.11.0', 'v20.9.0', 'v9.11.2']);
    });
  } finally {
    fs.rmSync(path.join(HOME, '.nvm'), {recursive: true, force: true});
  }
});

test('command：npm 装到 LSP_DIR 并走 npmmirror，首次会建 package.json；go / rustup / uv 各自拼对参数', {skip: SKIP}, () => {
  const m = new ExtensionMarket();
  const [npm, args] = m.command(m.entry('pyright'), 'install');
  assert.equal(npm, path.join(BIN, 'npm'));
  assert.deepEqual(args, ['install', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com', '--prefix', LSP_DIR, 'pyright@latest']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(LSP_DIR, 'package.json'), 'utf8')), {name: 'pinkie-lsp', private: true});
  fs.writeFileSync(path.join(LSP_DIR, 'package.json'), '{"name":"keep"}');
  assert.deepEqual(m.command(m.entry('pyright'), 'uninstall')[1], ['uninstall', '--prefix', LSP_DIR, 'pyright']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(LSP_DIR, 'package.json'), 'utf8')).name, 'keep', '已有的 package.json 不覆盖');
  const [go, goArgs, goEnv] = m.command(m.entry('gopls'), 'install');
  assert.deepEqual([go, goArgs], [path.join(BIN, 'go'), ['install', 'golang.org/x/tools/gopls@latest']]);
  assert.deepEqual(goEnv, {GOBIN: BIN, GOPROXY: 'https://goproxy.cn,direct', GOSUMDB: 'sum.golang.google.cn', GOFLAGS: '-modcacherw'});
  assert.deepEqual(m.command(m.entry('gopls'), 'uninstall'), ['rm', ['-f', path.join(BIN, 'gopls')], {}]);
  assert.deepEqual(m.command(m.entry('rustfmt'), 'install'), [path.join(BIN, 'rustup'), ['component', 'add', 'rustfmt'], {}]);
  assert.deepEqual(m.command(m.entry('rust-analyzer'), 'uninstall')[1], ['component', 'remove', 'rust-analyzer']);
  assert.deepEqual(m.command(m.entry('ruff'), 'install'), [path.join(BIN, 'uv'), ['tool', 'install', '--force', 'ruff'], {}]);
  assert.deepEqual(m.command(m.entry('ruff'), 'uninstall')[1], ['tool', 'uninstall', 'ruff']);
});

test('command / brewCommand：系统自带的不装（Xcode 工具多一句提示）；Homebrew 包名先校验再拼参数', {skip: BREW_SKIP}, () => {
  const m = new ExtensionMarket();
  assert.throws(() => m.command(m.entry('clangd'), 'install'), {message: '这个是系统自带的，不需要安装。如果没有，请在终端运行 xcode-select --install。'});
  assert.throws(() => m.command(m.entry('gofmt'), 'install'), {message: '这个是系统自带的，不需要安装。'});
  const [brew, args, env] = m.command(m.entry('jq'), 'install');
  assert.equal(brew, FAKE_BREW);
  assert.deepEqual(args, ['install', '--formula', 'jq']);
  assert.deepEqual(env, {HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_ENV_HINTS: '1', HOMEBREW_NO_ANALYTICS: '1', NONINTERACTIVE: '1'});
  assert.deepEqual(m.brewCommand('jq', 'uninstall')[1], ['uninstall', '--formula', 'jq']);
  for (const ok of ['python@3.12', 'gcc', 'libxml++', 'homebrew/core/jq', 'a.b_c-d']) assert.doesNotThrow(() => m.brewCommand(ok, 'install'), ok);
  for (const bad of ['', 'Jq', '-rf', 'a b', 'a;rm', '../x', 'a/b/c/d', 'x'.repeat(82), '/abs']) assert.throws(() => m.brewCommand(bad, 'install'), /软件名不正确/, bad);
});

test('install / uninstall：目录里没有的 id 报错；系统自带的不能卸载', {skip: SKIP}, () => {
  const m = new ExtensionMarket({spawn: () => assert.fail('不该真的启动安装')});
  assert.throws(() => m.install('nope'), /目录里没有这个扩展/);
  assert.throws(() => m.uninstall('nope'), /目录里没有这个扩展/);
  assert.throws(() => m.uninstall('clangd'), /系统自带的组件不能在这里卸载/);
  assert.equal(m.entry('nope'), null);
  assert.equal(m.entry('jq').name, 'jq');
});

test('list：每项都列出，按假工具判断已安装和路径；系统自带的、~/.local/bin 的 python 不给卸载；缺依赖时标 needs', {skip: SKIP}, () => {
  const m = new ExtensionMarket();
  const {items, brew} = m.list();
  assert.equal(items.length, CATALOG.length);
  assert.equal(brew, true);
  const by = Object.fromEntries(items.map(i => [i.id, i]));
  assert.deepEqual([by.jq.installed, by.jq.path, by.jq.removable, by.jq.source, by.jq.via], [true, path.join(BIN, 'jq'), true, 'Homebrew', 'brew']);
  assert.equal(by.python.installed, true);
  assert.equal(by.python.path, path.join(HOME, '.local/bin/python3'));
  assert.equal(by.python.removable, false);
  assert.equal(by.gopls.needs, undefined, '假 go 在，gopls 不缺依赖');
  assert.equal(by.pyright.source, 'npm 镜像（npmmirror）');
  assert.deepEqual(by.cmake.langs, []);
  for (const i of items) {
    if (i.via === 'system') assert.equal(i.removable, false, i.id);
    if (!i.installed) assert.deepEqual([i.path, i.removable], ['', false], i.id);
    assert.equal(i.job, undefined);
  }
});

function fakeSpawn() {
  // 启动的子进程按顺序交给 nextChild() 的等待者；先启动、后来取的先存着
  const calls = [], waiting = [], ready = [];
  const impl = (file, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = sig => { child.killed = sig; };
    calls.push({file, args, opts, child});
    const w = waiting.shift();
    if (w) w(child); else ready.push(child);
    return child;
  };
  return {impl, calls, nextChild: () => (ready.length ? Promise.resolve(ready.shift()) : new Promise(r => waiting.push(r)))};
}

test('run：排队 → 运行 → 完成的事件顺序；环境变量与 cwd；输出去颜色、按行切、截 400 字；退出码决定成败；同一项不能重复提交', {skip: SKIP}, async () => {
  fs.mkdirSync(LSP_DIR, {recursive: true});
  const sp = fakeSpawn();
  const m = new ExtensionMarket({spawn: sp.impl});
  const events = [];
  m.listeners.add(e => events.push(e));
  m.listeners.add(() => { throw new Error('坏掉的监听器不影响别人'); });
  const first = sp.nextChild();
  assert.deepEqual(m.run('jq', 'install', ['/bin/fake', ['a'], {MY: '1', CI: '0'}]), {id: 'jq', state: 'queued', action: 'install'});
  assert.throws(() => m.run('jq', 'install', ['/bin/fake', [], {}]), /正在处理，请稍候/);
  const child = await first;
  const {opts} = sp.calls[0];
  assert.equal(opts.cwd, LSP_DIR);
  assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.deepEqual([opts.env.MY, opts.env.CI, opts.env.TERM, opts.env.NO_COLOR, opts.env.HOME, opts.env.PATH], ['1', '1', 'dumb', '1', HOME, toolPath()]);
  assert.equal(opts.env.HTTPS_PROXY, process.env.HTTPS_PROXY, '代理端口没开就不额外设代理');
  assert.deepEqual(probed.slice(-2), [7897, 7890]);
  assert.equal(m.jobs.get('jq').state, 'running');
  child.stdout.emit('data', Buffer.from('\x1b[32mok\x1b[0m line\r\n  \nprogress 1\rprogress 2\n'));
  child.stderr.emit('data', 'w'.repeat(500));
  for (let i = 0; i < 405; i += 1) child.stdout.emit('data', `n${i}\n`);
  child.emit('close', 0);
  await m.queue;
  const job = m.jobs.get('jq');
  assert.deepEqual([job.state, job.ok, job.action], ['done', true, 'install']);
  assert.ok(job.finishedAt >= job.startedAt);
  assert.equal(job.log.length, 400, '日志最多留 400 行');
  assert.equal(job.log.at(-1), 'n404');
  const lines = events.filter(e => e.line).map(e => e.line);
  assert.deepEqual(lines.slice(0, 4), ['ok line', 'progress 1', 'progress 2', 'w'.repeat(400)]);
  assert.deepEqual(events.filter(e => e.state).map(e => [e.state, e.ok]), [['queued', undefined], ['running', undefined], ['done', true]]);
  assert.deepEqual(m.list().items.find(i => i.id === 'jq').job, {state: 'done', ok: true, log: job.log.slice(-12), action: 'install'});
  // 完成后可以再提交；非零退出码 = 失败；spawn 出错时把错误写进日志并算失败
  const second = sp.nextChild();
  m.run('jq', 'uninstall', ['/bin/fake', [], {}]);
  (await second).emit('close', 1);
  await m.queue;
  assert.deepEqual([m.jobs.get('jq').ok, m.jobs.get('jq').action], [false, 'uninstall']);
  const third = sp.nextChild();
  m.run('gh', 'install', ['/bin/fake', [], {}]);
  (await third).emit('error', new Error('spawn /bin/fake ENOENT'));
  await m.queue;
  assert.deepEqual([m.jobs.get('gh').ok, m.jobs.get('gh').log], [false, ['spawn /bin/fake ENOENT']]);
});

test('run：多个安装排成一队，前一个结束才启动下一个', {skip: SKIP}, async () => {
  fs.mkdirSync(LSP_DIR, {recursive: true});
  const sp = fakeSpawn();
  const m = new ExtensionMarket({spawn: sp.impl});
  const first = sp.nextChild();
  m.run('a', 'install', ['/bin/a', [], {}]);
  m.run('b', 'install', ['/bin/b', [], {}]);
  const ca = await first;
  await new Promise(r => setTimeout(r, 20));
  assert.equal(sp.calls.length, 1);
  assert.equal(m.jobs.get('b').state, 'queued');
  const second = sp.nextChild();
  ca.emit('close', 0);
  (await second).emit('close', 0);
  await m.queue;
  assert.deepEqual(sp.calls.map(c => c.file), ['/bin/a', '/bin/b']);
});

test('已知 bug：LSP_DIR 还没建时，非 npm 的安装（brew / go / rustup / uv）以它为 cwd 启动，直接 spawn ENOENT 失败', {skip: SKIP, todo: '源码未修：只有 npm 分支 mkdir LSP_DIR，run() 却总用 LSP_DIR 当 cwd'}, async () => {
  fs.rmSync(LSP_DIR, {recursive: true, force: true});
  const m = new ExtensionMarket();
  try {
    m.run('probe', 'install', [process.execPath, ['-e', 'console.log("hi")'], {}]);
    await m.queue;
    await stillBuggy(() => assert.equal(m.jobs.get('probe').ok, true, m.jobs.get('probe').log.join(' ')));
  } finally {
    for (const name of TOOLS) exe(BIN, name);
  }
});

test('brewSearch：空词返回空；搜索词校验；只收合法包名并合并 info 里的描述、版本与安装状态', {skip: BREW_SKIP}, async () => {
  const m = new ExtensionMarket();
  assert.deepEqual(await m.brewSearch(''), {results: []});
  assert.deepEqual(await m.brewSearch('   '), {results: []});
  await assert.rejects(() => m.brewSearch('jq; rm -rf'), /搜索词只能是字母/);
  await assert.rejects(() => m.brewSearch('x'.repeat(61)), /搜索词只能是字母/);
  m.jobs.set('brew:jq', {state: 'running', log: []});
  const {results} = await m.brewSearch(' jq ');
  assert.deepEqual(results, [
    {name: 'jq', desc: 'JSON 处理', version: '1.7', homepage: 'https://jq', license: 'MIT', installed: true, job: 'running'},
    {name: 'jq-extra', desc: '', version: '', homepage: '', license: '', installed: false, job: undefined},
  ]);
});

test('formatters / formatText：按语言挑已装的格式化器，内容走 stdin；失败带上格式化器名和前 3 行报错；taplo 只认 .toml；没有可用的返回 unavailable', {skip: SKIP}, async () => {
  exe(BIN, 'gofmt', 'tr a-z A-Z');
  // 假 shfmt 先读完 stdin 再报错（真格式化器也是读完输入才报语法错）
  exe(BIN, 'shfmt', 'cat >/dev/null; echo "第一行错" >&2; echo "第二行" >&2; echo "" >&2; echo "第三行" >&2; echo "第四行" >&2; exit 3');
  exe(BIN, 'taplo', 'cat');
  const f = formatters();
  assert.deepEqual([f.go, f.shell, f.toml, f.ini], ['gofmt', 'shfmt', 'taplo', 'taplo']);
  assert.deepEqual(await formatText({language: 'go', content: 'package main\n', filePath: 'a.go', cwd: ROOT}), {text: 'PACKAGE MAIN\n', formatter: 'gofmt'});
  await assert.rejects(() => formatText({language: 'shell', content: 'x', filePath: 'a.sh', cwd: ROOT}), {message: 'shfmt 格式化失败：第一行错 第二行 第三行'});
  assert.deepEqual(await formatText({language: 'toml', content: 'a = 1\n', filePath: 'Cargo.TOML', cwd: ROOT}), {text: 'a = 1\n', formatter: 'taplo'});
  assert.deepEqual(await formatText({language: 'ini', content: 'a=1', filePath: 'a.ini', cwd: ROOT}), {unavailable: true});
  assert.deepEqual(await formatText({language: 'cobol', content: 'x', filePath: 'a.cob', cwd: ROOT}), {unavailable: true});
  assert.equal(f.cobol, undefined);
});
