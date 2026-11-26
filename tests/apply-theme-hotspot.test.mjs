// 热点 2（installer/macos/apply-theme.sh）与热点 6（installer/windows/apply-theme.ps1）复发锁：
// 已上 main、此前没有自动化测试会在「只回退该修复」时变红的几处修复。
//   fe1fb2b2 apply-theme.sh 重新真正执行 apply-same-session-recovery.mjs（9-13 同步时被误删；
//            patches-wired 把 install.sh / install.ps1 一起算，那两处还在，所以它看不出来）。
//   c8f05679 apply-stream-survive-steer.mjs 进 sh 与 ps1 的补丁清单（补丁已烘进 ui/runtime，
//            patches-wired 视为已接，删掉清单那一行也不会红）。
//   c092fc4b 补丁可能重写入口，最终皮肤必须在所有运行时补丁之后、由 bundle.py 统一装一遍；
//            Windows 跳过补丁的分支也要装皮肤。
//   689c8980 ps1：PINKIE_SKIP_RUNTIME_PATCHES=1 时不跑补丁；补丁失败按退出码告警，不再被吞掉。
//   e413e182 判断启动器是否已是新版时，探测串要选二进制真正保留的字符串。
// sh 部分在临时目录里真跑 bash：假 HOME、假 OPENCLAW_ROOT、不存在的 App 路径，node / python /
// shasum 用 PATH 里的假桩只记日志，不碰真实系统，也不执行任何补丁。本机没有 pwsh，ps1 只做静态断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shPath = path.join(root, 'installer/macos/apply-theme.sh');
const sh = fs.readFileSync(shPath, 'utf8');
const ps1 = fs.readFileSync(path.join(root, 'installer/windows/apply-theme.ps1'), 'utf8');

const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return text.slice(start, end);
};

/* ── macOS：在假环境里真跑一遍 apply-theme.sh ─────────────────────────────── */

function writeStub(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

function runMacInstaller() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-apply-theme-'));
  const bin = path.join(tmp, 'bin');
  const home = path.join(tmp, 'home');
  const openclaw = path.join(tmp, 'openclaw');
  const controlUi = path.join(openclaw, 'dist/control-ui');
  const log = path.join(tmp, 'calls.log');
  for (const dir of [bin, home, controlUi]) fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(openclaw, 'openclaw.mjs'), '');
  fs.writeFileSync(path.join(controlUi, 'index.html'), '<html><head><title>OpenClaw</title></head><body></body></html>\n');
  fs.writeFileSync(log, '');
  // 假 node：只记下「当时的 OPENCLAW_ROOT + 参数」，不执行任何补丁。
  writeStub(bin, 'node', 'printf \'node\\t%s\\t%s\\n\' "${OPENCLAW_ROOT:-}" "$*" >> "$PINKIE_TEST_LOG"');
  // 假 python：记日志；bundle.py install 时像真的一样写出 pinkie-ui-manifest.json。
  writeStub(bin, 'python3', [
    'printf \'python\\t%s\\t%s\\n\' "${OPENCLAW_ROOT:-}" "$*" >> "$PINKIE_TEST_LOG"',
    'if [[ "${1:-}" == */bundle.py && "${2:-}" == install ]]; then',
    '  while [[ $# -gt 1 ]]; do',
    '    if [[ "$1" == --control-ui ]]; then printf \'{"run":"%s"}\\n\' "$RANDOM" > "$2/pinkie-ui-manifest.json"; fi',
    '    shift',
    '  done',
    'fi',
  ].join('\n'));
  // Linux 上未必有 shasum（macOS 自带），用 sha256sum 顶上。
  writeStub(bin, 'shasum', 'sha256sum "${@: -1}"');
  const result = spawnSync('bash', [shPath], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      OPENCLAW_ROOT: openclaw,
      PINKIE_APP_PATH: path.join(tmp, 'no-such.app'),
      PINKIE_SKIP_APP_BUNDLES: '1',
      PINKIE_BUNDLE_BUILD_ONLY: '1',
      PINKIE_PYTHON_BIN: path.join(bin, 'python3'),
      PINKIE_TEST_LOG: log,
    },
  });
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => {
    const [tool, env, args] = line.split('\t');
    return {tool, env, args};
  });
  const title = fs.readFileSync(path.join(controlUi, 'index.html'), 'utf8').match(/<title>([^<]*)<\/title>/)?.[1];
  fs.rmSync(tmp, {recursive: true, force: true});
  return {result, calls, openclaw, controlUi, title};
}

const patchOf = (call) => (call.tool === 'node' ? call.args.split(' ')[0].match(/\/patch\/((?:re)?apply-[a-z0-9-]+\.mjs)$/)?.[1] : undefined);
// Windows 上 ui 来自 path.join（全反斜杠），脚本里是 "$OPENCLAW_ROOT/dist/control-ui"（反斜杠根 + 正斜杠尾），
// 逐字比永远对不上。两边先统一成 / 再比，比较本身不放宽。
const slash = (p) => p.replaceAll('\\', '/');
const isSkinInstall = (call, ui) => call.tool === 'python' && /\/tools\/ui-parity\/bundle\.py install /.test(slash(call.args))
  && slash(call.args).endsWith(`--control-ui ${slash(ui)}`);

let macRun;
const mac = () => (macRun ??= runMacInstaller());

test('apply-theme.sh 在假环境里能完整跑完（后面几条的前提）', () => {
  const {result} = mac();
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `apply-theme.sh 退出码 ${result.status}\n${result.stderr}`);
  assert.ok(mac().calls.some((c) => patchOf(c)), '一个运行时补丁都没跑，假桩没生效');
});

test('apply-theme.sh 真正执行 same-session-recovery 与 stream-survive-steer 补丁（fe1fb2b2 / c8f05679）', () => {
  const {calls, openclaw} = mac();
  const ran = calls.map(patchOf).filter(Boolean);
  for (const name of ['apply-same-session-recovery.mjs', 'apply-stream-survive-steer.mjs']) {
    // 只出现在注释或别的安装脚本里不算：必须是 apply-theme.sh 自己执行了它。
    assert.equal(ran.filter((n) => n === name).length, 1, `apply-theme.sh 没有（或重复）执行 patch/${name}；实际执行：${ran.join(', ')}`);
  }
  for (const call of calls.filter(patchOf)) {
    assert.equal(call.env, openclaw, `${patchOf(call)} 运行时 OPENCLAW_ROOT 不是目标运行时`);
  }
});

test('apply-theme.sh 在全部运行时补丁之后才用 bundle.py 装最终皮肤（c092fc4b）', () => {
  const {calls, controlUi, title} = mac();
  const lastPatch = calls.findLastIndex((c) => patchOf(c));
  const lastSkin = calls.findLastIndex((c) => isSkinInstall(c, controlUi));
  assert.ok(lastSkin >= 0, 'apply-theme.sh 没有对 $OPENCLAW_ROOT/dist/control-ui 跑 bundle.py install');
  assert.ok(lastSkin > lastPatch, `最终皮肤（第 ${lastSkin} 次调用）早于最后一个补丁（第 ${lastPatch} 次调用），补丁重写的入口会盖掉皮肤`);
  assert.equal(title, '超級碧琪', '装皮肤后入口标题应改成 超級碧琪');
});

test('isSkinInstall：Windows 斜杠混用的路径能认出，不相关的调用不误判', () => {
  const ui = path.win32.join('D:\\a\\tmp\\openclaw', 'dist/control-ui');
  const py = (args) => ({tool: 'python', env: '', args});
  const hit = py('D:\\a\\repo/tools/ui-parity/bundle.py install --root D:\\a\\repo --control-ui D:\\a\\tmp\\openclaw/dist/control-ui');
  // 复发：逐字比时 windows-checks 上就是这样对不上。
  assert.equal(hit.args.endsWith(`--control-ui ${ui}`), false);
  assert.ok(isSkinInstall(hit, ui), '反斜杠根 + /dist/control-ui 的装皮肤调用没认出来');
  assert.ok(isSkinInstall(py('/r/tools/ui-parity/bundle.py install --root /r --control-ui /t/openclaw/dist/control-ui'), '/t/openclaw/dist/control-ui'));
  for (const miss of [
    py('D:\\a\\repo/tools/ui-parity/bundle.py install --root D:\\a\\repo --control-ui D:\\a\\tmp\\other/dist/control-ui'),
    py('D:\\a\\repo/tools/ui-parity/bundle.py install --root D:\\a\\repo --control-ui D:\\a\\tmp\\openclaw/dist/control-ui-old'),
    py('D:\\a\\repo/tools/ui-parity/bundle.py build --root D:\\a\\repo --control-ui D:\\a\\tmp\\openclaw/dist/control-ui'),
    {tool: 'node', env: '', args: 'D:\\a\\repo/tools/ui-parity/bundle.py install --control-ui D:\\a\\tmp\\openclaw/dist/control-ui'},
  ]) assert.equal(isSkinInstall(miss, ui), false, `误判成装皮肤：${miss.tool} ${miss.args}`);
});

/* ── Windows：apply-theme.ps1 静态断言（本机无 pwsh） ───────────────────── */

const psLoop = between(ps1, 'foreach ($packageRoot in $packageRoots) {', 'if (-not $didAny)');
const psPatchList = () => {
  const block = psLoop.match(/\$runtimePatches = @\(([\s\S]*?)\)\s*\|/);
  assert.ok(block, 'apply-theme.ps1 不再声明 $runtimePatches = @( ... )');
  return [...block[1].matchAll(/'((?:re)?apply-[a-z0-9-]+\.mjs)'/g)].map((m) => m[1]);
};

test('apply-theme.ps1 的补丁清单含 stream-survive-steer，且每一项都真实存在（c8f05679）', () => {
  const list = psPatchList();
  assert.ok(list.includes('apply-stream-survive-steer.mjs'), 'apply-theme.ps1 的 $runtimePatches 丢了 apply-stream-survive-steer.mjs');
  // 清单后面有 Where-Object { Test-Path $_ }，写错名字会被悄悄跳过。
  for (const name of list) assert.ok(fs.existsSync(path.join(root, 'patch', name)), `apply-theme.ps1 列了不存在的 patch/${name}`);
});

test('apply-theme.ps1 跳过补丁时仍装皮肤，正常路径在补丁之后才装皮肤（c092fc4b / 689c8980）', () => {
  const skipAt = psLoop.indexOf('if ($env:PINKIE_SKIP_RUNTIME_PATCHES -eq "1") {');
  assert.ok(skipAt >= 0, 'apply-theme.ps1 没有 PINKIE_SKIP_RUNTIME_PATCHES 跳过分支');
  const skipBody = between(psLoop.slice(skipAt), '{', '\n            }');
  const skinInSkip = skipBody.indexOf('Apply-UISkin $uiRoot');
  assert.ok(skinInSkip >= 0, '跳过补丁的分支没有装皮肤（发行包会只剩快照里的旧皮肤）');
  assert.ok(skinInSkip < skipBody.indexOf('continue'), '跳过分支要先装皮肤再 continue');
  assert.equal(psLoop.slice(0, skipAt).indexOf('Apply-UISkin'), -1, '皮肤不能在补丁之前装（补丁可能重写入口）');
  const afterSkip = psLoop.slice(skipAt + skipBody.length);
  const patchLoop = afterSkip.indexOf('foreach ($runtimePatch in $runtimePatches)');
  assert.ok(patchLoop >= 0, '正常路径不再逐个运行补丁');
  assert.ok(afterSkip.lastIndexOf('Apply-UISkin $uiRoot') > patchLoop, '正常路径的最终皮肤必须在补丁循环之后');
  // 跳过分支必须在任何补丁运行之前 continue。
  assert.equal(psLoop.slice(0, skipAt).indexOf('$runtimePatch'), -1, '跳过分支之前不应运行补丁');
});

test('apply-theme.ps1 补丁失败按退出码告警，不再被吞掉（689c8980）', () => {
  const body = between(psLoop, 'foreach ($runtimePatch in $runtimePatches) {', '} finally {');
  assert.doesNotMatch(body, /Out-Null/, '补丁输出被丢进 Out-Null');
  assert.doesNotMatch(body, /catch\s*\{\s*\}/, '补丁失败被空 catch 吞掉');
  assert.match(body, /& \$node\.Source \$runtimePatch/);
  assert.match(body, /if \(\$LASTEXITCODE -ne 0\)\s*\{\s*Write-Warning "[^"]*\$runtimePatch[^"]*\$LASTEXITCODE/, '补丁失败要带补丁名和退出码告警');
});

/* ── macOS：启动器新旧探测串（e413e182） ─────────────────────────────────── */

test('启动器新旧探测只用编译进二进制的字面量字符串（e413e182）', () => {
  const fn = between(sh, 'rebuild_launcher_if_needed() {', 'temp_binary="$(mktemp');
  const probes = [...fn.matchAll(/strings "\$target_file" \| grep -Fq '([^']+)'/g)].map((m) => m[1]);
  assert.ok(probes.length >= 5, `探测串太少：${probes.join(', ')}`);
  // e413e182：'open-default' 只是 switch 的分支标签，新版二进制里 strings 找不到，
  // 用它探测会让每次安装都误判为旧版、重新编译启动器。
  assert.ok(!probes.includes('open-default'), '探测串又换回了二进制里不保留的 open-default');
  const supportLine = sh.split('\n').find((line) => line.startsWith('LAUNCHER_SUPPORT_SOURCES='));
  const compiled = ['Launcher.swift', ...[...supportLine.matchAll(/([A-Za-z]+\.swift)/g)].map((m) => m[1])];
  // Swift 把不超过 15 字节的字符串字面量直接编进指令（small string），strings 读不到；
  // 探测串必须落在某个超过 15 字节的字面量（按插值 \( 切开后的那一段）里才可靠。按文件分别切，
  // 免得某个文件里引号配错位一路错到别的文件。
  const literals = compiled.flatMap((name) => {
    const text = fs.readFileSync(path.join(root, 'desktop/macos/pinkie/Sources', name), 'utf8');
    return [...text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].flatMap((m) => m[1].split('\\('));
  });
  for (const probe of probes) {
    const hosts = literals.filter((lit) => lit.includes(probe));
    assert.ok(hosts.length > 0, `探测串 ${probe} 不在 apply-theme.sh 编译的任何 Swift 字符串字面量里`);
    assert.ok(hosts.some((lit) => Buffer.byteLength(lit, 'utf8') > 15),
      `探测串 ${probe} 只出现在不超过 15 字节的字面量里（Swift 内联进指令，strings 读不到）`);
  }
});
