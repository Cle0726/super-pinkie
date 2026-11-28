// L93：AI 模型路由扫描结束后重读路由（pinkie.ai.route.get）失败时，不能漏成 unhandledRejection。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// 什么都能点、什么都能调的占位对象：只给加载时用到的 monaco / 工作台杂项，本测试不关心它们。
function any() {
  const fn = function () {};
  const proxy = new Proxy(fn, {
    get(_t, key) {
      if (key === 'then') return undefined;
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      return proxy;
    },
    apply: () => proxy,
    construct: () => proxy,
  });
  return proxy;
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

test('扫描结束后重读路由失败：不漏 unhandledRejection，扫描完的提示照常出', async (t) => {
  const leaked = [];
  const onLeak = (reason) => leaked.push(reason);
  process.on('unhandledRejection', onLeak);
  t.after(() => process.off('unhandledRejection', onLeak));

  const calls = [], toasts = [], refreshed = [];
  const own = {
    rpc: async (method) => { calls.push(method); throw new Error('还没连上网关'); },
    toast: (text) => toasts.push(text),
    refreshPage: (id) => refreshed.push(id),
    state: {tabs: [], root: ''},
    extraStatus: new Map(),
    tabActions: new Map(),
  };
  const rest = any();
  const wb = new Proxy(own, {get: (o, k) => (k in o ? o[k] : rest[k])});
  const window = Object.assign(new EventTarget(), {__pinkieWorkbench: wb, monaco: any()});
  const document = Object.assign(new EventTarget(), {querySelector: () => null, activeElement: null, createElement: () => any()});

  const saved = {window: globalThis.window, document: globalThis.document};
  globalThis.window = window;
  globalThis.document = document;
  try {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-workbench-code.js'), 'utf8'), {filename: 'laolao-workbench-code.js'});
    await settle();
    leaked.length = 0; // 加载时自己的请求不算在本测试里
    calls.length = 0;
    window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: 'plugin.pinkie.ai.scan', payload: {finished: true, ok: 1, total: 2}}}));
    await settle();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }

  assert.deepEqual(calls, ['pinkie.ai.route.get'], '扫描结束应去重读一次路由');
  assert.ok(toasts.some((s) => s.startsWith('扫描完了')), '扫描完的提示照常出');
  assert.deepEqual(leaked.map((e) => e?.message || String(e)), [], '重读失败不应变成 unhandledRejection');
});
