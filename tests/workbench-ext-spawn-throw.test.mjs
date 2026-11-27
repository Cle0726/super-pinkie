import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {EventEmitter} from 'node:events';

// 工作台扩展市场（workbench-ext.mjs）：spawn 同步抛错时的安装队列（backlog P2）。
// 例：Windows 上 Node ≥18.20 / 20.12 不带 shell 直接起 .cmd / .bat 会同步抛 EINVAL。
// run() 把这一步放在 new Promise(async resolve => …) 里，同步抛错变成 async 执行器的拒绝：
// 没人接 → unhandledRejection（网关进程直接退出）；resolve() 永远不调 → this.queue 卡死，
// 这一项停在 running，后面所有安装 / 卸载一直 queued。
// 不起真进程：spawn 是桩；代理端口探测换成假的 net.connect；PINKIE_STATE_ROOT 指到临时目录。
// 不依赖可执行位和 /bin/sh，三个平台都跑（workbench-ext.test.mjs 在 Windows 上整文件跳过）。
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-wbext-throw-'));
process.env.PINKIE_STATE_ROOT = path.join(ROOT, 'state');
process.on('exit', () => fs.rmSync(ROOT, {recursive: true, force: true}));
net.connect = () => { const s = new EventEmitter(); s.destroy = () => {}; setImmediate(() => s.emit('error', new Error('refused'))); return s; };

const {ExtensionMarket, LSP_DIR} = await import('../services/mode-architecture/workbench-ext.mjs');

const settled = (promise, ms = 2000) => Promise.race([
  Promise.resolve(promise).then(() => true, () => true),
  new Promise(resolve => setTimeout(() => resolve(false), ms).unref?.()),
]);

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

test('run：spawn 同步抛错时这一项记失败、错误写进日志，不留 unhandledRejection，队列照常往下走', async () => {
  fs.mkdirSync(LSP_DIR, {recursive: true});
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const calls = [];
    let next = null;
    const spawn = (file, args, opts) => {
      calls.push(file);
      if (file === '/bin/throws') {
        const error = new Error('spawn EINVAL');
        error.code = 'EINVAL';
        throw error;
      }
      next = fakeChild();
      return next;
    };
    const m = new ExtensionMarket({spawn});
    const events = [];
    m.listeners.add(e => events.push(e));

    assert.deepEqual(m.run('bad', 'install', ['/bin/throws', [], {}]), {id: 'bad', state: 'queued', action: 'install'});
    m.run('good', 'install', ['/bin/ok', [], {}]);

    // 第一项抛错后，第二项应该照常启动
    for (let i = 0; i < 100 && !next; i += 1) await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(calls, ['/bin/throws', '/bin/ok'], '第一项 spawn 抛错后，队列里的下一项没有启动');
    next.emit('close', 0);
    assert.equal(await settled(m.queue), true, '安装队列没有结束');
    await new Promise(r => setImmediate(r));

    const bad = m.jobs.get('bad');
    assert.deepEqual([bad.state, bad.ok], ['done', false]);
    assert.ok(Number.isFinite(bad.finishedAt));
    assert.ok(bad.log.some(line => line.includes('spawn EINVAL')), `日志里应有错误：${JSON.stringify(bad.log)}`);
    assert.deepEqual(events.filter(e => e.id === 'bad' && e.state).map(e => [e.state, e.ok]), [['queued', undefined], ['running', undefined], ['done', false]]);
    assert.deepEqual([m.jobs.get('good').state, m.jobs.get('good').ok], ['done', true]);

    // 同一项失败后可以重新提交（不会一直报「正在处理」）
    assert.doesNotThrow(() => m.run('bad', 'install', ['/bin/throws', [], {}]));
    assert.equal(await settled(m.queue), true, '重新提交后安装队列没有结束');
    await new Promise(r => setImmediate(r));
    assert.deepEqual([m.jobs.get('bad').state, m.jobs.get('bad').ok], ['done', false]);

    assert.deepEqual(unhandled.map(r => String(r?.message || r)), [], 'spawn 抛错变成了 unhandledRejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
