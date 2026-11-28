// L93：看板后台读列表（看门狗、节流后的 requestList、网关重连 onReady）在 sessions.list 失败时
// 不能漏成 unhandledRejection；读不到就留着上一份列表。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function load() {
  const previous = Object.prototype.hasOwnProperty.call(globalThis, 'window') ? globalThis.window : Symbol.for('none');
  const prevModule = Object.prototype.hasOwnProperty.call(globalThis, 'module') ? globalThis.module : Symbol.for('none');
  const window = Object.assign(new EventTarget(), {Pinkie: {}});
  const module = {exports: {}};
  globalThis.window = window;
  globalThis.module = module;
  try {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-session-board-data.js'), 'utf8'), {
      filename: 'laolao-session-board-data.js',
    });
    return module.exports;
  } finally {
    if (previous === Symbol.for('none')) delete globalThis.window;
    else globalThis.window = previous;
    if (prevModule === Symbol.for('none')) delete globalThis.module;
    else globalThis.module = prevModule;
  }
}

function clock(start = 1_000_000) {
  let now = start;
  const timers = [];
  let seq = 1;
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = seq++; timers.push({id, at: now + (Number(ms) || 0), fn}); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    tick(ms) {
      now += ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at || a.id - b.id);
        if (!due.length) break;
        for (const t of due) { timers.splice(timers.indexOf(t), 1); t.fn(); }
      }
    },
  };
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

test('sessions.list 失败时，看门狗 / 节流读列表 / 重连都不漏 unhandledRejection，旧列表保留', async (t) => {
  const leaked = [];
  const onLeak = (reason) => leaked.push(reason);
  process.on('unhandledRejection', onLeak);
  t.after(() => process.off('unhandledRejection', onLeak));

  const api = load();
  const clk = clock();
  const target = new EventTarget();
  let fail = false, listCalls = 0;
  const gw = async (method) => {
    if (method === 'sessions.list') {
      listCalls++;
      if (fail) throw new Error('网关断了');
      return {sessions: [{key: 'agent:main:a', label: '甲', hasActiveRun: true, status: '', updatedAt: 1_000_000}]};
    }
    return [];
  };
  const board = api.createSessionBoard({
    now: clk.now, setTimeout: clk.setTimeout.bind(clk), clearTimeout: clk.clearTimeout.bind(clk), gwRequest: gw, target,
  });
  t.after(() => board.dispose());
  await board.start();
  assert.equal(board.view().rows[0]?.key, 'agent:main:a');

  fail = true;
  const before = listCalls;
  // 1) 节流已过：sessions.changed 立刻读一次
  clk.tick(1500);
  target.dispatchEvent(new CustomEvent('laolao:sessions-changed'));
  await settle();
  // 2) 节流窗口内再来一次：排队，计时器到点再读
  target.dispatchEvent(new CustomEvent('laolao:sessions-changed'));
  clk.tick(1000);
  await settle();
  // 3) 看门狗：有在跑的会话、20 秒没事件
  clk.tick(20_000);
  await settle();
  // 4) 网关重连
  target.dispatchEvent(new CustomEvent('pinkie:sidebar-gateway-ready'));
  await settle();

  assert.ok(listCalls - before >= 4, `四条路径都应真的去读了列表，实际 ${listCalls - before} 次`);
  assert.deepEqual(leaked.map((e) => e?.message || String(e)), [], '读列表失败不应变成 unhandledRejection');
  assert.equal(board.view().rows[0]?.key, 'agent:main:a', '读不到时保留上一份列表');
});
