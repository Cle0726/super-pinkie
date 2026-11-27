// Aborting a command serve whose stop signal fails with something other than ESRCH (EPERM here) used to leave the abort
// listener's stopRecord promise unobserved, so the gateway saw an unhandledRejection on top of the error serve already
// reports. Only the test's own harmless child is ever signalled; process.kill / child.kill are faked for that child alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {AppBrowserServers} from '../services/mode-architecture/app-browser.mjs';

const freePort = () => new Promise(done => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => done(port)); });
});

test('aborting a serve whose stop signal fails with EPERM reports it once and leaves no unhandled rejection', {timeout: 30_000}, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-abort-stop-'));
  fs.writeFileSync(path.join(home, 'idle.js'), 'setTimeout(() => {}, 15000);\n');
  const servers = new AppBrowserServers({environment: {}, homeDirectory: home, memoryFile: path.join(home, 'memory.json'),
    systemBrowser: true, systemOpener: async () => {}, serveTimeoutMs: 10_000, stopGraceMs: 50});
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error?.code || String(error));
  process.on('unhandledRejection', onUnhandled);
  const realKill = process.kill;
  let record, childKill;
  t.after(() => {
    process.off('unhandledRejection', onUnhandled);
    process.kill = realKill;
    const pid = record?.child?.pid;
    if (pid > 1) {
      if (childKill) record.child.kill = childKill;
      if (process.platform !== 'win32') { try { realKill.call(process, -pid, 'SIGKILL'); } catch {} }
      try { record.child.kill('SIGKILL'); } catch {}
    }
    servers.disposeSync();
    fs.rmSync(home, {recursive: true, force: true});
  });

  const controller = new AbortController();
  const serving = servers.serve({sessionKey: 'agent:main:main', sessionId: 's1'},
    {command: `"${process.execPath}" idle.js`, cwd: home, port: await freePort()}, {signal: controller.signal});
  serving.catch(() => {});
  for (let i = 0; i < 250 && !record; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    record = [...servers.servers].find(one => one.child?.pid > 1);
  }
  assert.ok(record, 'the command serve spawned its child');
  const pid = record.child.pid;
  const eperm = () => Object.assign(new Error('kill EPERM'), {code: 'EPERM'});
  process.kill = function (target, signal) {
    if ((target === -pid || target === pid) && signal === 'SIGTERM') throw eperm();
    return realKill.call(process, target, signal);
  };
  childKill = record.child.kill;
  record.child.kill = function (signal) { if (signal === 'SIGTERM') throw eperm(); return childKill.call(this, signal); };

  controller.abort();
  await assert.rejects(serving, {code: 'EPERM'}, 'serve still reports the failed stop');
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, [], 'the abort listener left no unhandled rejection');
});
