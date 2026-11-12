// A5：在真 Windows 上跑 computer_flow 的 PowerShell 脚本。只测，不改任何东西。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const OUT = path.resolve('probe-out');
fs.mkdirSync(OUT, {recursive: true});
process.env.PINKIE_STATE_ROOT = path.join(os.tmpdir(), 'pinkie-probe-state');
const {runSteps} = await import('../services/mode-architecture/desk.mjs');
const report = {node: process.version, os: os.release(), ps: null, parse: null, runs: []};
const ps = (cmd) => spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], {encoding: 'utf8'});
report.ps = ps('$PSVersionTable.PSVersion.ToString()').stdout.trim();
// 1. 先让 powershell.exe（5.1）解析 desk.ps1 本身
await runSteps([{op: 'windows'}]).catch(() => {});
const script = path.join(process.env.PINKIE_STATE_ROOT, 'desk', 'desk.ps1');
report.scriptExists = fs.existsSync(script);
if (report.scriptExists) {
  const r = ps(`$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${script}',[ref]$t,[ref]$e);if($e){$e|%{$_.Message+' @'+$_.Extent.StartLineNumber}}else{'PARSE_OK'}`);
  report.parse = (r.stdout + r.stderr).trim();
}
const run = async (name, steps) => {
  const t0 = Date.now();
  let res;
  try { res = await runSteps(steps); } catch (e) { res = {error: String(e.message)}; }
  report.runs.push({name, ms: Date.now() - t0, res});
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log('RUN', name, Date.now() - t0, 'ms', JSON.stringify(res).slice(0, 1500));
};
const shot = (n) => path.join(OUT, n + '.png');
const kill = () => ps('Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force');
await run('windows list', [{op: 'windows'}]);
await run('open notepad (name=notepad)', [{op: 'open_app', name: 'notepad'}, {op: 'wait_window', window: 'Notepad', timeout: 15000}, {op: 'type', text: '今天完成了测试'}, {op: 'keys', keys: 'ctrl+a'}, {op: 'keys', keys: 'ctrl+c'}, {op: 'clipboard_get'}, {op: 'ui'}, {op: 'screenshot', path: shot('notepad-1')}]);
await run('ui_click File', [{op: 'ui_click', name: 'File'}, {op: 'wait', ms: 500}, {op: 'screenshot', path: shot('notepad-file-menu')}, {op: 'keys', keys: 'esc'}]);
await run('ui_click 文件 (Chinese name, expect NO_ELEMENT on English OS)', [{op: 'ui_click', name: '文件'}]);
await run('window_set', [{op: 'window_set', window: 'Notepad', x: 100, y: 100, w: 700, h: 500}, {op: 'windows'}]);
await run('click by coordinate', [{op: 'click', x: 300, y: 300}]);
await run('type again + clipboard_set/get with Chinese', [{op: 'clipboard_set', text: '剪贴板中文测试'}, {op: 'clipboard_get'}, {op: 'keys', keys: 'ctrl+v'}, {op: 'ui'}]);
await run('wait_window missing (expect failure message)', [{op: 'wait_window', window: '不存在的窗口XYZ', timeout: 3000}]);
await run('close_app notepad', [{op: 'close_app', name: 'notepad'}]);
kill();
await run('open_app 记事本 (Chinese name)', [{op: 'open_app', name: '记事本'}, {op: 'wait_window', window: 'Notepad', timeout: 10000}]);
kill();
await run('final windows', [{op: 'windows'}]);
console.log('DONE');
