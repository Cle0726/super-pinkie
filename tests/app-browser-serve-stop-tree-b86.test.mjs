// B86：serve 用 shell: true 起项目服务。Windows 上 shell 是 cmd.exe，停服务时只 child.kill(cmd.exe)，
// 真正监听端口的 node 孙进程还活着，端口一直被占着，用户再 serve 同一个端口会被拒（「端口已经被其他服务占用」）。
// 这里用 serve 起一个真的 HTTP 服务，stop 之后端口必须在几秒内放出来。POSIX 早就按进程组杀，这条在 Linux / macOS 上本来就过；
// 反例只在 Windows 上成立（换回 main 的 signalProcess，stop 后端口还开着）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {AppBrowserServers} from '../services/mode-architecture/app-browser.mjs';

const freePort = () => new Promise(done => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => done(port)); });
});
const portOpen = port => new Promise(done => {
  const socket = net.connect({port, host: '127.0.0.1'});
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
  socket.setTimeout(500, () => { socket.destroy(); done(false); });
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('B86：stop 一个 serve 起的命令服务后，真正监听端口的孙进程也停了，端口放出来', {timeout: 40_000}, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-serve-tree-'));
  const pidFile = path.join(home, 'server.pid');
  fs.writeFileSync(path.join(home, 'server.js'), [
    "require('fs').writeFileSync(process.argv[2], String(process.pid));",
    "require('http').createServer((req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');",
  ].join('\n'));
  const servers = new AppBrowserServers({environment: {}, homeDirectory: home, memoryFile: path.join(home, 'memory.json'),
    systemBrowser: true, systemOpener: async () => {}, serveTimeoutMs: 15_000, stopGraceMs: 200});
  t.after(() => {
    try { const pid = Number(fs.readFileSync(pidFile, 'utf8')); if (pid > 1) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
      else { try { process.kill(pid, 'SIGKILL'); } catch {} }
    } } catch { /* 没起来 */ }
    servers.disposeSync();
    fs.rmSync(home, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  });
  const ctx = {sessionKey: 'agent:main:main', sessionId: 's1'};
  const port = await freePort();
  await servers.serve(ctx, {command: `"${process.execPath}" server.js "${pidFile}"`, cwd: home, port});
  assert.equal(await portOpen(port), true, '服务应该已经在监听');
  await servers.stop(ctx, {port});
  let open = true;
  for (let i = 0; i < 30 && open; i += 1) { open = await portOpen(port); if (open) await sleep(100); }
  assert.equal(open, false, `stop 之后端口 ${port} 还被占着（孙进程没停）`);
});
