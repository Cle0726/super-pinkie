// L93：会动的碧琪换图时图加载失败（setImage ← companion 不接 reject），不能漏成 unhandledRejection。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// 什么都能点、什么都能调的占位对象：给 WebGL 上下文、画布、figure 用，本测试不关心画出来什么。
function any() {
  const fn = function () {};
  const proxy = new Proxy(fn, {
    get(_t, key) {
      if (key === 'then') return undefined;
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      return proxy;
    },
    set: () => true,
    apply: () => proxy,
    construct: () => proxy,
  });
  return proxy;
}

// 一律加载失败的图：设 src 后下一拍触发 onerror。
class BrokenImage {
  set src(v) { this._src = v; queueMicrotask(() => this.onerror?.(new Error('图加载失败：' + v))); }
  get src() { return this._src; }
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

test('换图时图加载失败：setImage 不漏 unhandledRejection，返回 false，留着当前这张', async (t) => {
  const leaked = [];
  const onLeak = (reason) => leaked.push(reason);
  process.on('unhandledRejection', onLeak);
  t.after(() => process.off('unhandledRejection', onLeak));

  const window = Object.assign(new EventTarget(), {devicePixelRatio: 1});
  const document = Object.assign(new EventTarget(), {hidden: false, createElement: () => any()});
  const globals = {
    window, document,
    Image: BrokenImage,
    matchMedia: () => ({matches: false}),
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  const saved = Object.fromEntries(Object.keys(globals).map((k) => [k, globalThis[k]]));
  Object.assign(globalThis, globals);
  let rig, direct, fromCompanion;
  try {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-buddy-rig.js'), 'utf8'), {filename: 'laolao-buddy-rig.js'});
    rig = window.__pinkieBuddyRig.attach(any());
    assert.ok(rig, '占位 WebGL 下应能挂上 rig');
    // companion.js:176 / :211 的写法：不 await、不 catch
    fromCompanion = rig.setImage('https://example.invalid/pinkie-a.png');
    direct = await rig.setImage('https://example.invalid/pinkie-b.png').then((v) => v, (e) => e);
    await settle();
  } finally {
    rig?.destroy?.();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }

  assert.deepEqual(leaked.map((e) => e?.message || String(e)), [], '图加载失败不应变成 unhandledRejection');
  assert.equal(direct, false, '加载失败时 setImage 返回 false');
  assert.equal(rig.front, null, '没有图可换时不挂空的 front');
  void fromCompanion;
});
