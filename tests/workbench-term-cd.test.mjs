// R2：开终端后按 terminal.open 返回的 result.shell 生成 cd（briefs/program-1120/设计-R2.md 第四节）。
// 三种 shell × 普通 / 空格 / ' / % / "。POSIX 那一路在本机真 sh 里跑一遍，确认引号真能进到目录。
// 反例：去掉 ' 的转义（POSIX 或 PowerShell）、去掉 cmd 的 % / " 拒发，本测试都应红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(repo, 'ui/injections/laolao-workbench-term.js');

function load() {
  const window = {sessionStorage: null};
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), {window}, {filename: SRC});
  return window.Pinkie.workbench.term;
}
const term = load();
// vm 里造的对象原型不是本上下文的 Object.prototype，deepStrictEqual 会比原型，先展开成普通对象。
const cd = (shell, root) => ({...term.cdCommand(shell, root)});

test('按 result.shell 判断 shell 种类，不看界面平台', () => {
  for (const s of ['/bin/zsh', '/bin/bash', '/usr/bin/fish', '', undefined]) assert.equal(term.shellKind(s), 'posix', String(s));
  for (const s of ['C:\\Windows\\System32\\cmd.exe', 'cmd.exe', 'CMD.EXE', '"C:\\Windows\\system32\\cmd.exe"']) assert.equal(term.shellKind(s), 'cmd', s);
  for (const s of ['pwsh', '/usr/local/bin/pwsh', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'powershell.exe']) assert.equal(term.shellKind(s), 'powershell', s);
});

const ROOTS = {
  plain: '/Users/a/proj',
  space: '/Users/a/my proj',
  quote: "/Users/a/bob's proj",
  percent: '/Users/a/100% done',
  dquote: '/Users/a/say "hi"',
};

test('POSIX：cd -- 单引号，内嵌 \' 写成 \'\\\'\'，换行 \\r', () => {
  assert.equal(term.cdCommand('/bin/zsh', ROOTS.plain).text, "cd -- '/Users/a/proj' && clear\r");
  assert.equal(term.cdCommand('/bin/zsh', ROOTS.space).text, "cd -- '/Users/a/my proj' && clear\r");
  assert.equal(term.cdCommand('/bin/zsh', ROOTS.quote).text, "cd -- '/Users/a/bob'\\''s proj' && clear\r");
  assert.equal(term.cdCommand('/bin/zsh', ROOTS.percent).text, "cd -- '/Users/a/100% done' && clear\r");
  assert.equal(term.cdCommand('/bin/zsh', ROOTS.dquote).text, "cd -- '/Users/a/say \"hi\"' && clear\r");
});

test('cmd.exe：cd /d "<root>" && cls；含 % 或 " 不发，给手动 cd 提示', () => {
  const cmd = 'C:\\Windows\\System32\\cmd.exe';
  assert.deepEqual(cd(cmd, 'C:\\Users\\a\\proj'), {kind: 'cmd', text: 'cd /d "C:\\Users\\a\\proj" && cls\r', refuse: null});
  assert.equal(term.cdCommand(cmd, 'C:\\Users\\a\\my proj').text, 'cd /d "C:\\Users\\a\\my proj" && cls\r');
  assert.equal(term.cdCommand(cmd, "C:\\Users\\a\\bob's proj").text, 'cd /d "C:\\Users\\a\\bob\'s proj" && cls\r');
  for (const bad of ['C:\\Users\\a\\100% done', 'C:\\Users\\a\\%PATH%', 'C:\\Users\\a\\say "hi"']) {
    assert.deepEqual(cd(cmd, bad), {kind: 'cmd', text: null, refuse: '路径含特殊字符，请手动 cd'}, bad);
  }
});

test('PowerShell：Set-Location -LiteralPath 单引号，内嵌 \' 写成 \'\'', () => {
  assert.equal(term.cdCommand('pwsh', 'C:\\Users\\a\\proj').text, "Set-Location -LiteralPath 'C:\\Users\\a\\proj'; Clear-Host\r");
  assert.equal(term.cdCommand('pwsh', 'C:\\Users\\a\\my proj').text, "Set-Location -LiteralPath 'C:\\Users\\a\\my proj'; Clear-Host\r");
  assert.equal(term.cdCommand('pwsh', "C:\\Users\\a\\bob's proj").text, "Set-Location -LiteralPath 'C:\\Users\\a\\bob''s proj'; Clear-Host\r");
  assert.equal(term.cdCommand('powershell.exe', 'C:\\Users\\a\\100% done').text, "Set-Location -LiteralPath 'C:\\Users\\a\\100% done'; Clear-Host\r");
  assert.equal(term.cdCommand('pwsh', 'C:\\Users\\a\\say "hi"').text, "Set-Location -LiteralPath 'C:\\Users\\a\\say \"hi\"'; Clear-Host\r");
});

test('root 为空时不发 cd', () => {
  for (const shell of ['/bin/zsh', 'cmd.exe', 'pwsh']) assert.equal(term.cdCommand(shell, '').text, null);
});

test('POSIX：生成的 cd 在真 sh 里能进到带空格 / \' / % / " 的目录', {skip: process.platform === 'win32' && 'Windows 上没有 /bin/sh'}, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-term-cd-'));
  try {
    for (const name of ['plain', 'my proj', "bob's proj", '100% done', 'say "hi"', "a'b' && echo PWNED"]) {
      const dir = path.join(base, name);
      fs.mkdirSync(dir);
      const line = term.cdCommand('/bin/sh', dir).text.replace(/ && clear\r$/, '');
      const got = execFileSync('/bin/sh', ['-c', `${line} && pwd -P`], {encoding: 'utf8'}).trim();
      assert.equal(got, fs.realpathSync(dir), name);
    }
  } finally {
    fs.rmSync(base, {recursive: true, force: true});
  }
});
