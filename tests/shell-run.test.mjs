import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {
  parseBang, mergeApprovals, decideTier, splitSegments, matchAllowlist, filterEnv, stripAnsi,
  outputCollector, windowsArgv, createShellRun, OUTPUT_LIMIT,
} from '../services/mode-architecture/shell-run.mjs';

const KEY = 'agent:main:main';

function harness(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-run-'));
  const state = path.join(dir, 'pinkie'), oc = path.join(dir, 'oc'), proj = path.join(dir, 'proj');
  for (const d of [state, oc, proj]) fs.mkdirSync(d, {recursive: true});
  const calls = [];
  let waiters = [];
  const deps = {
    stateRoot: state, openclawStateDir: () => oc, config: () => ({}), boundRoot: () => proj,
    rpc: async (method, params) => { calls.push({method, params}); waiters = waiters.filter((w) => !w(params)); return {}; },
    ...over,
  };
  const shell = createShellRun(deps);
  const until = (re) => new Promise((resolve) => {
    const f = (p) => (re.test(p.message) ? (resolve(p), true) : false);
    if (!calls.some((c) => f(c.params))) waiters.push(f);
  });
  const approvals = (value) => fs.writeFileSync(path.join(oc, 'exec-approvals.json'), JSON.stringify(value));
  return {dir, state, oc, proj, calls, shell, until, approvals};
}

function fakeSpawn() {
  const spawned = [];
  const spawn = (file, args, opts) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    spawned.push({file, args, opts, child});
    return child;
  };
  return {spawn, spawned};
}

test('识别规则：只有半角 ! 紧跟非空白才是命令', () => {
  assert.deepEqual(parseBang('!ls -la'), {kind: 'command', command: 'ls -la'});
  assert.deepEqual(parseBang('!!hi'), {kind: 'message', text: '!hi'});
  assert.deepEqual(parseBang('! ls'), {kind: 'message', text: '! ls'});
  assert.deepEqual(parseBang('！ls'), {kind: 'message', text: '！ls'});
  assert.deepEqual(parseBang('ls!'), {kind: 'message', text: 'ls!'});
  assert.deepEqual(parseBang('!'), {kind: 'message', text: '!'});
});

test('判档：四种组合 + deny/开关关着时 confirmed 不放行', () => {
  const on = {enabled: true};
  assert.equal(decideTier({...on, security: 'deny', ask: 'off'}), 'deny');
  assert.equal(decideTier({...on, security: 'full', ask: 'off'}), 'run');
  assert.equal(decideTier({...on, security: 'allowlist', ask: 'on-miss', inAllowlist: true}), 'run');
  assert.equal(decideTier({...on, security: 'allowlist', ask: 'on-miss', inAllowlist: false}), 'ask');
  assert.equal(decideTier({...on, security: 'full', ask: 'always'}), 'ask');
  assert.equal(decideTier({...on, security: 'full', ask: 'always', confirmed: true}), 'run');
  assert.equal(decideTier({...on, security: 'deny', ask: 'off', confirmed: true}), 'deny');
  assert.equal(decideTier({enabled: false, security: 'full', ask: 'off', confirmed: true}), 'off');
  assert.equal(decideTier({...on, security: 'weird', ask: 'off'}), 'ask');
});

test('审批合并：own → * → defaults，空文件缺省 full/off，cfg 取更严', () => {
  assert.deepEqual(mergeApprovals({}, 'main'), {security: 'full', ask: 'off', allowlist: []});
  const file = {
    defaults: {security: 'full', ask: 'always'},
    agents: {'*': {security: 'allowlist', allowlist: ['git']}, main: {ask: 'on-miss', allowlist: ['ls']}},
  };
  assert.deepEqual(mergeApprovals(file, 'main'), {security: 'allowlist', ask: 'on-miss', allowlist: ['ls', 'git']});
  assert.deepEqual(mergeApprovals(file, 'other'), {security: 'allowlist', ask: 'always', allowlist: ['git']});
  assert.equal(mergeApprovals({}, 'main', {security: 'deny'}).security, 'deny');
  assert.equal(mergeApprovals({defaults: {security: 'deny'}}, 'main', {security: 'full'}).security, 'deny');
  assert.equal(mergeApprovals({}, 'main', {ask: 'always'}).ask, 'always');
  const unknown = mergeApprovals({}, 'main', {security: 'sandbox'});
  assert.equal(decideTier({enabled: true, ...unknown}), 'ask');
});

test('切段：替换、后台 & 和未闭合引号一律认不出', () => {
  assert.deepEqual(splitSegments('a | b && c || d; e'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(splitSegments('echo "a|b" 2>&1'), ['echo "a|b" 2>&1']);
  for (const bad of ['echo `id`', 'echo $(id)', 'cat <(ls)', 'sleep 1 &', 'echo "x', 'echo "$(id)"']) {
    assert.equal(splitSegments(bad), null, bad);
  }
});

test('清单：每段都要命中，glob 与 argPattern 规则', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-run-bin-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['alpha', 'beta']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n', {mode: 0o755});
  }
  const opts = {platform: process.platform, cwd: dir, env: {PATH: bin}};
  assert.equal(matchAllowlist('alpha | beta', ['alpha'], opts), false);
  assert.equal(matchAllowlist('alpha | beta', ['alpha', 'beta'], opts), true);
  assert.equal(matchAllowlist('alpha && beta', ['*'], opts), true);
  assert.equal(matchAllowlist('alpha', [`${bin}/*`], opts), true);
  assert.equal(matchAllowlist('alpha', [`${dir}/*`], opts), false);
  assert.equal(matchAllowlist('alpha', [`${dir}/**`], opts), true);
  assert.equal(matchAllowlist('alpha', [{pattern: 'alpha', argPattern: '.*'}], opts), false);
  assert.equal(matchAllowlist('missing', ['alpha'], opts), false);
  assert.equal(matchAllowlist('echo $(alpha)', ['*'], opts), false);
});

test('POSIX 安全内建在 Windows 上不算', () => {
  assert.equal(matchAllowlist('cd sub && pwd', [], {platform: 'darwin', env: {}}), true);
  assert.equal(matchAllowlist('cd sub', [], {platform: 'win32', env: {}}), false);
});

test('环境变量：名字含 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL 的去掉', () => {
  const names = ['PATH', 'FOO_TOKEN', 'api_key', 'MY_Secret', 'DB_PASSWORD', 'AWS_CREDENTIALS', 'HOME'];
  const out = filterEnv(Object.fromEntries(names.map((n) => [n, 'v'])));
  assert.deepEqual(Object.keys(out).sort(), ['HOME', 'PATH']);
});

test('输出：去 ANSI，超 16 KB 留开头 4 KB + 结尾 12 KB', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m \x1b]0;title\x07ok'), 'red ok');
  const small = outputCollector();
  small.push('\x1b[1mhi\x1b[0m\n');
  assert.equal(small.text(), 'hi\n');
  const head = 'h'.repeat(4096), mid = 'm'.repeat(14 * 1024), tail = 't'.repeat(12 * 1024);
  const all = head + mid + tail;
  assert.ok(all.length > OUTPUT_LIMIT);
  const big = outputCollector();
  for (let i = 0; i < all.length; i += 1000) big.push(Buffer.from(all.slice(i, i + 1000)));
  assert.equal(big.text(), `${head}\n…（省略 14 KB）…\n${tail}`);
});

test('Windows：EncodedCommand 解回来等于原文（含中文和引号）', () => {
  const command = `Write-Output "你好，'世界'" ; echo 'a"b'`;
  const [file, args] = windowsArgv(command);
  assert.equal(file, 'powershell.exe');
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  const script = Buffer.from(args[3], 'base64').toString('utf16le');
  assert.match(script, /OutputEncoding = \[System\.Text\.Encoding\]::UTF8/);
  assert.ok(script.endsWith(`\n${command}`));
});

test('开关：默认关，关着拒绝；写入文件 0600', async () => {
  const h = harness({spawn: () => { throw new Error('不该启动'); }});
  assert.deepEqual(h.shell.config(), {enabled: false});
  await assert.rejects(h.shell.run({sessionKey: KEY, command: 'ls'}), /还没打开/);
  await assert.rejects(h.shell.run({sessionKey: KEY, command: 'ls', confirmed: true}), /还没打开/);
  assert.deepEqual(h.shell.setConfig({enabled: true}), {enabled: true});
  const file = path.join(h.state, 'shell.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {enabled: true});
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(h.calls.length, 0);
});

test('会话检查：没绑文件夹、分身、只读角色、正在回答、锁住各拒一次且不启动', async () => {
  const noSpawn = () => { throw new Error('不该启动'); };
  const cases = [
    [{boundRoot: () => ''}, KEY, /先给这个会话绑一个文件夹/],
    [{}, 'agent:main:subagent:abc', /分身会话只读/],
    [{}, 'agent:roles:reviewer', /只读角色/],
    [{roleCardFor: () => ({tools: ['read']})}, KEY, /只读角色/],
    [{activityFor: () => ({parentRunning: true})}, KEY, /正在回答/],
    [{lock: {assertSessionAllowed: () => { throw new Error('Metre 已上锁'); }}}, KEY, /Metre 已上锁/],
  ];
  for (const [over, key, re] of cases) {
    const h = harness({spawn: noSpawn, ...over});
    h.shell.setConfig({enabled: true});
    await assert.rejects(h.shell.run({sessionKey: key, command: 'ls'}), re, key);
    assert.equal(h.calls.length, 0);
  }
});

test('策略：on-miss 不命中先问，confirmed 才跑；deny 与 cfg 兜底文件都生效', async () => {
  const f = fakeSpawn();
  const h = harness({spawn: f.spawn, kill: () => {}});
  h.shell.setConfig({enabled: true});
  h.approvals({defaults: {security: 'allowlist', ask: 'on-miss', allowlist: []}});
  assert.deepEqual(await h.shell.run({sessionKey: KEY, command: 'ls'}), {status: 'confirm', command: 'ls', cwd: h.proj});
  assert.equal(f.spawned.length, 0);
  assert.equal((await h.shell.run({sessionKey: KEY, command: 'ls', confirmed: true})).status, 'started');
  assert.equal(f.spawned.length, 1);
  f.spawned[0].child.emit('close', 0);

  const d = harness({spawn: f.spawn});
  d.shell.setConfig({enabled: true});
  d.approvals({agents: {main: {security: 'deny'}}});
  await assert.rejects(d.shell.run({sessionKey: KEY, command: 'ls', confirmed: true}), /不跑命令/);

  const cfgFile = path.join(os.tmpdir(), `shell-run-cfg-${process.pid}.json`);
  fs.writeFileSync(cfgFile, JSON.stringify({tools: {exec: {security: 'deny'}}}));
  const c = harness({spawn: f.spawn, configFile: () => cfgFile});
  c.shell.setConfig({enabled: true});
  await assert.rejects(c.shell.run({sessionKey: KEY, command: 'ls'}), /不跑命令/);
  assert.equal(f.spawned.length, 1);
});

test('一个会话同时只跑一条；cancel 杀进程组并写回「已停止」', async () => {
  const f = fakeSpawn(), kills = [];
  const h = harness({spawn: f.spawn, kill: (pid, sig) => kills.push([pid, sig]), platform: 'darwin'});
  h.shell.setConfig({enabled: true});
  await h.shell.run({sessionKey: KEY, command: 'sleep 9'});
  assert.equal(f.spawned[0].opts.detached, true);
  await assert.rejects(h.shell.run({sessionKey: KEY, command: 'ls'}), /已有命令在跑/);
  assert.deepEqual(h.shell.cancel({sessionKey: KEY}), {stopped: true});
  assert.deepEqual(kills[0], [-4242, 'SIGTERM']);
  f.spawned[0].child.emit('close', null);
  const done = await h.until(/已停止/);
  assert.match(done.message, /\$ sleep 9/);
  assert.equal(h.shell.isRunning(KEY), false);
  assert.deepEqual(h.shell.cancel({sessionKey: KEY}), {stopped: false});
});

test('真跑：inject 只带协议字段，环境变量里的令牌被抹掉', {skip: process.platform === 'win32'}, async () => {
  const h = harness({env: {...process.env, FOO_TOKEN: 'tok-should-not-leak', SHELL_RUN_MARK: 'mark-ok'}});
  h.shell.setConfig({enabled: true});
  const res = await h.shell.run({sessionKey: KEY, command: 'echo "[$FOO_TOKEN]" "$SHELL_RUN_MARK"; pwd'});
  assert.equal(res.status, 'started');
  const done = await h.until(/退出码 0/);
  for (const {method, params} of h.calls) {
    assert.equal(method, 'chat.inject');
    assert.deepEqual(Object.keys(params).sort(), ['agentId', 'label', 'message', 'sessionKey']);
    assert.equal(params.agentId, 'main');
    assert.equal(params.label, '命令');
    assert.equal(params.sessionKey, KEY);
  }
  assert.match(h.calls[0].params.message, /^```\n\$ echo/);
  assert.match(done.message, /\[\] mark-ok/);
  assert.doesNotMatch(done.message, /tok-should-not-leak/);
  assert.match(done.message, new RegExp(path.basename(h.proj)));
});

test('超时：杀掉整个进程组（含孙进程）', {skip: process.platform === 'win32', timeout: 20000}, async () => {
  const h = harness({timeoutMs: 1500});
  const pidFile = path.join(h.dir, 'grandchild.pid');
  h.shell.setConfig({enabled: true});
  await h.shell.run({sessionKey: KEY, command: `sleep 30 & echo $! > '${pidFile}'; wait`});
  const done = await h.until(/超过 \d+ 秒，已停止/);
  assert.match(done.message, /超过 2 秒，已停止|超过 1 秒，已停止/);
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  assert.ok(pid > 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
});
