// B130（installer/windows/apply-theme.ps1 带空格 + 中文路径的参数引用，真实 PowerShell 执行回归锁）：
// 之前只有字符串层面的静态断言（见 apply-theme-hotspot.test.mjs 开头注释），没有真的跑过
// powershell.exe 验证 $UiRoot（可能带空格、中文字符，来自 $env:OPENCLAW_ROOT）在传给 node/python
// 时是否被 PowerShell 给原生命令自动加引号的规则拆开或吞字符。
//
// 这里真跑一遍 apply-theme.ps1：假 $env:OPENCLAW_ROOT 建在一个「空格 + 中文」目录下，node/python
// 换成真实 node.exe 的拷贝（原生二进制，argv 不经 cmd.exe 批处理解析），用 NODE_OPTIONS --require
// 在加载「主脚本」（bundle.py 等，根本不是 JS）之前就记录 argv 并退出，不受 cmd.exe 对非 ASCII
// 字符的代码页转换影响（见 status/engines.md 11-28 09:07Z 的实测记录）。锁住：
//   1) bundle.py install 的 --control-ui、stamp.mjs 的 --control-ui、sw_cache.py 的位置参数，
//      都原样收到完整的 $UiRoot，不被拆成两段、不丢字符；
//   2) 顺带断言这些参数都不以反斜杠收尾——PowerShell 给原生 exe 自动加引号时，「参数带空格
//      且以反斜杠收尾」会让结尾的 \ 把自动补上的右引号转义掉，和下一个参数拼成一段（已用独立
//      复现验证，见同一条 engines.md 记录），防止以后哪个变量不小心带了尾部 \。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ps1Path = path.join(root, 'installer/windows/apply-theme.ps1');

function findPowerShell() {
  if (process.platform !== 'win32') return null;
  for (const exe of ['powershell.exe', 'powershell']) {
    const probe = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {encoding: 'utf8'});
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
}

const POWERSHELL = findPowerShell();
const SKIP = POWERSHELL ? false : '需要 Windows 且安装了 powershell.exe/pwsh，本机没有就跳过（和 apply-theme-hotspot.test.mjs 的 Windows 部分一样曾是纯静态断言）';

function runApplyThemeUnderSpaceAndChinesePath() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-b130-'));
  const stubbin = path.join(tmp, 'stubbin');
  // 空格 + 中文只放在「被测对象」$env:OPENCLAW_ROOT 这条链路上，测试基础设施（桩、日志）留在
  // 纯 ASCII 目录里，不掺进不相关的变量。
  const base = path.join(tmp, '测试 路径 dir');
  const openclaw = path.join(base, 'repo', 'fakeopenclaw');
  const controlUi = path.join(openclaw, 'dist', 'control-ui');
  const log = path.join(tmp, 'calls.log');
  for (const dir of [stubbin, controlUi]) fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(openclaw, 'openclaw.mjs'), '');
  fs.writeFileSync(path.join(controlUi, 'index.html'), '<html><head><title>OpenClaw</title></head><body></body></html>\n');
  fs.writeFileSync(path.join(controlUi, 'sw.js'), [
    'const EMBEDDED_CACHE_VERSION = "v1-clekk-history-render-12";',
    '// Cache-first for hashed assets; network-first for HTML/other.',
    'caches.match(event.request).then(',
    '        (cached) =>',
    '          cached ||',
    '          fetch(event.request).then((response) => {',
    '            if (response.ok) {',
    '              const clone = response.clone();',
    '              void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));',
    '            }',
    '            return response;',
    '          }),',
    '      )',
  ].join('\n') + '\n');
  fs.writeFileSync(log, '');

  // node.exe / python.exe 桩：都是真 node.exe 的拷贝，argv 走原生 CreateProcess，不经 cmd.exe
  // 的批处理 %* 解析（那是另一层、和本测试无关的编码坑）。用 NODE_OPTIONS --require 在 node
  // 加载「主脚本」（这里其实是 bundle.py / sw_cache.py，根本不是合法 JS）之前就记录 argv 并
  // process.exit(0)，所以永远不会真的去解析那个不存在/非 JS 的主脚本路径。
  const hook = path.join(stubbin, 'argv-logger.cjs');
  fs.writeFileSync(hook, [
    "const fs = require('fs');",
    "const path = require('path');",
    "const tool = path.basename(process.execPath).replace(/\\.exe$/i, '');",
    "fs.appendFileSync(process.env.PINKIE_TEST_LOG, JSON.stringify({",
    "  tool, openclawRoot: process.env.OPENCLAW_ROOT || '', args: process.argv.slice(1),",
    '}) + "\\n");',
    'process.exit(0);',
  ].join('\n'));
  fs.copyFileSync(process.execPath, path.join(stubbin, 'node.exe'));
  fs.copyFileSync(process.execPath, path.join(stubbin, 'python.exe'));

  const result = spawnSync(POWERSHELL, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path,
  ], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${stubbin};${process.env.PATH || ''}`,
      // NODE_OPTIONS 自己做一层极简的类 shell 解析，反斜杠在里面是转义符，会被吃掉
      // （已实测：F:\tmp\...\argv-logger.cjs 变成 F:tmp...argv-logger.cjs）。Windows 路径
      // 的分隔符换成正斜杠，Node 两种都认，绕开这个坑。
      NODE_OPTIONS: `--require "${hook.replaceAll('\\', '/')}"`,
      OPENCLAW_ROOT: openclaw,
      // 和 build-win.ps1 调用 apply-theme.ps1 时一样：只装 OPENCLAW_ROOT 这一个包根，
      // 跳过运行时补丁循环（那 23 个补丁不碰 $UiRoot/$RepoRoot，和本测试无关，会稀释日志）。
      PINKIE_SKIP_APP_BUNDLES: '1',
      PINKIE_SKIP_RUNTIME_PATCHES: '1',
      PINKIE_TEST_LOG: log,
    },
  });
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  fs.rmSync(tmp, {recursive: true, force: true});
  return {result, calls, controlUi};
}

let winRun;
const win = () => (winRun ??= runApplyThemeUnderSpaceAndChinesePath());

test('apply-theme.ps1 在带空格 + 中文的真实路径下能跑完（B130，后面几条的前提）', {skip: SKIP}, () => {
  const {result} = win();
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `apply-theme.ps1 退出码 ${result.status}\n${result.stderr}\n${result.stdout}`);
});

test('bundle.py install 的 --control-ui 原样收到完整的空格 + 中文 $UiRoot，不被拆成两段（B130）', {skip: SKIP}, () => {
  const {calls, controlUi} = win();
  const call = calls.find((c) => c.tool === 'python' && c.args.some((a) => /bundle\.py$/.test(a)) && c.args.includes('install'));
  assert.ok(call, `没有抓到 bundle.py install 调用；实际调用：${JSON.stringify(calls)}`);
  const idx = call.args.indexOf('--control-ui');
  assert.ok(idx >= 0 && idx + 1 < call.args.length, '--control-ui 后面没有紧跟着一个参数');
  assert.equal(call.args[idx + 1], controlUi, '--control-ui 的值被拆开或丢了字符');
  assert.equal(call.args.length, idx + 2, '--control-ui 的值之后还多出了别的参数（被拆成了两段）');
});

test('stamp.mjs 的 --control-ui 同样原样收到完整路径（B130）', {skip: SKIP}, () => {
  const {calls, controlUi} = win();
  const call = calls.find((c) => c.tool === 'node' && c.args.some((a) => /stamp\.mjs$/.test(a)));
  assert.ok(call, `没有抓到 stamp.mjs 调用；实际调用：${JSON.stringify(calls)}`);
  const idx = call.args.indexOf('--control-ui');
  assert.ok(idx >= 0, 'stamp.mjs 调用里没有 --control-ui');
  assert.equal(call.args[idx + 1], controlUi);
});

test('sw_cache.py 的位置参数是完整的 $UiRoot\\sw.js（B130）', {skip: SKIP}, () => {
  const {calls, controlUi} = win();
  const call = calls.find((c) => c.tool === 'python' && c.args.some((a) => /sw_cache\.py$/.test(a)));
  assert.ok(call, `没有抓到 sw_cache.py 调用；实际调用：${JSON.stringify(calls)}`);
  const scriptIdx = call.args.findIndex((a) => /sw_cache\.py$/.test(a));
  assert.equal(call.args[scriptIdx + 1], path.join(controlUi, 'sw.js'));
  assert.equal(call.args.length, scriptIdx + 2, 'sw_cache.py 的路径参数被拆成了多段');
});

test('传给 node/python 的空格 + 中文路径参数都不以反斜杠收尾（B130 已知雷，防回归）', {skip: SKIP}, () => {
  const {calls} = win();
  const spaced = calls.flatMap((c) => c.args).filter((a) => a.includes(' '));
  assert.ok(spaced.length > 0, '没有抓到任何带空格的参数，锁不住这条——先确认假路径真的带了空格');
  for (const arg of spaced) {
    assert.ok(!arg.endsWith('\\'), `参数以反斜杠收尾、又带空格，PowerShell 给原生 exe 自动加引号时会被结尾的 \\ 转义吞掉右引号：${arg}`);
  }
});
