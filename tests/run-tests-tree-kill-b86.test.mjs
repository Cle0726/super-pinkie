// B86：run_tests 用 shell: true 跑测试命令。超时时只杀 shell 的话，测试命令起的子进程（npm → node 这种）
// 还占着 stdout，close 事件不来，run_tests 会一直等到孙进程自己退出，超时形同虚设，孙进程也留在后台。
// 这里起一个真的孙进程：继承 stdout、睡 20 秒、把自己的 pid 写进文件。run_tests 给 2 秒超时，
// 应该在几秒内回来、标 timedOut，而且孙进程已经被杀掉。反例：换回 main 的 runCommand，要等满 20 秒才回来。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRunTestsTool, forgetBaselines} from '../services/mode-architecture/code-work.mjs';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('B86：run_tests 超时会连测试命令起的孙进程一起停掉，按时回来', {timeout: 40_000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b86-tree-'));
  const pidFile = path.join(dir, 'grandchild.pid');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'parent.js'), [
    "const {spawn} = require('child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 20000);`)}], {stdio: 'inherit'});`,
    'setTimeout(() => {}, 20000);',
  ].join('\n'));
  forgetBaselines();
  const tool = createRunTestsTool({sessionKey: 'agent:project:b86'}, {rootFor: () => dir});
  const started = Date.now();
  const r = await tool.execute('1', {command: `"${process.execPath}" parent.js`, timeout: 2});
  const seconds = (Date.now() - started) / 1000;
  assert.equal(r.details?.timedOut, true, `应标超时：${JSON.stringify(r.details)}`);
  assert.ok(seconds < 10, `超时 2 秒却过了 ${seconds.toFixed(1)} 秒才回来（孙进程占着 stdout）`);
  assert.ok(fs.existsSync(pidFile), '孙进程没起来，测试本身不成立');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  let gone = false;
  for (let i = 0; i < 30 && !gone; i += 1) { gone = !alive(pid); if (!gone) await sleep(100); }
  if (!gone) try { process.kill(pid, 'SIGKILL'); } catch { /* 收尾 */ }
  assert.ok(gone, `超时后孙进程 ${pid} 还活着`);
});
