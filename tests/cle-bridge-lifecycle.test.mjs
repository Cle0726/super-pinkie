// 桥的生命周期交接：退役 → 离线可读 → 重连 → 旧 disposer 晚到。
//
// 这些用例的目标不是"没崩"，而是每条都被单独断言：
//   1. 退役后读 selectedKey 不碰旧 host（不能靠 try/catch 吞掉同步 throw）；
//   2. 离线时的动作/RPC 立即以明确错误失败，不假成功、不排队偷偷续发；
//   3. 同步 throw 也不能留下 timeout（旧实现会漏一个 15s 定时器）；
//   4. 在途请求被拒绝时，调用方拿到真实错误；
//   5. 旧→新切换后指向新 host，旧 disposer 晚到不得覆盖新桥；
//   6. 请求不会因为重连被重放。
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeStrictHost, makeEnv, loadShim, withGlobals, RETIRED} from './fixtures/strict-host.mjs';

const shim = await loadShim();

test('退役后 currentSessionKey 返回最后已知的选中会话，且完全不触碰旧 host', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:main'});
    const ctrl = new AbortController();
    shim.installLegacyShim(A.host, ctrl.signal);

    assert.equal(window.__laolaoSidebar.currentSessionKey(), 'agent:main:main');

    A.retire();
    const callsBefore = A.state.calls.length;
    const logBefore = A.state.log.length;

    // 关键：这里一旦走旧实现（闭包里的 host.sessions.selectedKey）就会同步 throw
    assert.doesNotThrow(() => window.__laolaoSidebar.currentSessionKey());
    assert.equal(window.__laolaoSidebar.currentSessionKey(), 'agent:main:main',
      '离线时保留最后只读的归属，不编造新值');
    assert.equal(A.state.calls.length, callsBefore, '退役后不得再发请求');
    assert.equal(A.state.log.length, logBefore, '退役后不得再访问旧 host 的任何 getter');

    ctrl.abort();
  });
});

test('退役后 gwRequest 立即以明确错误失败，不假成功也不偷偷续发', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost();
    const ctrl = new AbortController();
    shim.installLegacyShim(A.host, ctrl.signal);

    A.retire();
    const before = A.state.calls.length;

    await assert.rejects(
      () => window.__laolaoSidebar.gwRequest('chat.send', {message: 'hi'}),
      (err) => {
        assert.ok(err instanceof Error, '离线必须是真实的 Error');
        assert.notEqual(err.message, 'gateway timeout', '不能伪装成超时');
        assert.match(err.message, /连接|离线|ended|重连/, `错误应说明离线原因，实际：${err.message}`);
        return true;
      },
    );
    assert.equal(A.state.calls.length, before, '离线请求不得打到旧 host');

    // 重连后也不应把刚才那次请求补发出去
    const B = makeStrictHost();
    const ctrlB = new AbortController();
    window.__cleBridge.rebind(B.host, ctrlB.signal);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(B.state.calls.length, 0, '离线时的请求不能被当成后台请求重放');
    assert.equal(A.state.calls.length, before, '旧 host 更不能再收到请求');

    ctrl.abort();
  });
});

test('host.request 同步 throw 时不留 timeout，且错误原样传回', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    // 只让 request 同步 throw
    const host = {
      get sessions() { return {selectedKey: 'agent:main:main'}; },
      request() { throw new Error(RETIRED); },
      subscribe() { return () => {}; },
      onEvent() { return () => {}; },
    };
    const ctrl = new AbortController();
    shim.installLegacyShim(host, ctrl.signal);

    // 直接盯着定时器：被测代码在本次调用里创建的 timer 必须被清掉。
    const live = new Set();
    const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
    globalThis.setTimeout = (fn, ms, ...rest) => {
      const id = realST(fn, ms, ...rest);
      live.add(id);
      return id;
    };
    globalThis.clearTimeout = (id) => { live.delete(id); return realCT(id); };
    try {
      await assert.rejects(
        () => window.__laolaoSidebar.gwRequest('sessions.list', {}, 30000),
        (err) => {
          assert.match(err.message, /activation has ended/, '同步 throw 的真实原因必须保留');
          return true;
        },
      );
      await new Promise((r) => realST(r, 30));
      assert.equal(live.size, 0, '同步 throw 不得遗留 timeout');
    } finally {
      globalThis.setTimeout = realST;
      globalThis.clearTimeout = realCT;
    }
    ctrl.abort();
  });
});

test('在途请求在退役时被拒绝，调用方拿到真实网关错误', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost();
    const ctrl = new AbortController();
    shim.installLegacyShim(A.host, ctrl.signal);

    const inflight = window.__laolaoSidebar.gwRequest('sessions.list', {});
    assert.equal(A.state.pending.length, 1, '正常在线时应真的发出去');

    A.rejectAll('gateway closed by host');
    await assert.rejects(inflight, /gateway closed by host/, '在途 reject 必须原样上报');
    ctrl.abort();
  });
});

test('重连指向新 host，旧 disposer 晚到不覆盖新桥', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:old'});
    const ctrlA = new AbortController();
    shim.installLegacyShim(A.host, ctrlA.signal);
    assert.equal(window.__laolaoSidebar.currentSessionKey(), 'agent:main:old');

    A.retire();
    const B = makeStrictHost({selectedKey: 'agent:main:new'});
    const ctrlB = new AbortController();
    window.__cleBridge.rebind(B.host, ctrlB.signal);
    assert.equal(window.__laolaoSidebar.currentSessionKey(), 'agent:main:new', '重连后必须指向新 host');

    // 旧 activation 的 disposer 晚到
    ctrlA.abort();

    assert.equal(window.__laolaoSidebar.currentSessionKey(), 'agent:main:new', '旧 disposer 不得把桥摘掉');
    const inflight = window.__laolaoSidebar.gwRequest('sessions.list', {});
    assert.equal(B.state.pending.length, 1, '旧 disposer 晚到后，新桥仍要能发请求');
    B.rejectAll();
    await inflight.catch(() => {});

    ctrlA.abort();
  });
});

test('host facade：离线只读不抛、写操作明确失败、重连后原样转发', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:facade'});
    const ctrl = new AbortController();
    const api = shim.installLegacyShim(A.host, ctrl.signal);
    const facade = api.hostFacade();

    // 在线：读 forwarded，写透传
    assert.equal(facade.sessions.selectedKey, 'agent:main:facade');
    const opened = facade.sessions.open({sessionKey: 'agent:main:facade'});
    assert.equal(A.state.calls.at(-1).method, 'sessions.open');
    await opened;

    A.retire();
    // 真实链路里 host 退役后紧接着 activation 结束；这里显式模拟这次交接。
    api.goOffline();
    // 离线：读不抛，仍是最后已知值；写立刻明确失败
    assert.doesNotThrow(() => facade.sessions.selectedKey);
    assert.equal(facade.sessions.selectedKey, 'agent:main:facade', '不编造数据，保留只读归属');
    assert.equal(facade.online(), false);
    await assert.rejects(() => facade.sessions.open({sessionKey: 'x'}), /连接已断开/);
    await assert.rejects(() => facade.request('chat.send', {message: 'x'}), /连接已断开/);
    await assert.rejects(() => facade.sessions.create({label: 'x'}), /连接已断开/);
    // 订阅/UI 在离线时是"什么都不做"，不能抛
    assert.doesNotThrow(() => facade.subscribe(() => {}));
    assert.doesNotThrow(() => facade.onEvent('chat', () => {}));
    // 不发明空的 UI 实现：classic 不用就不要有，免得"返回 noop 假装成功"。
    assert.equal(facade.ui, undefined, 'facade 不应提供未被使用的 UI 接口');

    // 重连：新 host 上正常转发
    const B = makeStrictHost({selectedKey: 'agent:main:after'});
    const ctrlB = new AbortController();
    api.rebind(B.host, ctrlB.signal);
    const facade2 = api.hostFacade();
    A.retire();
    assert.equal(facade2.online(), true);
    assert.equal(facade2.sessions.selectedKey, 'agent:main:after');
    const p = facade2.request('sessions.list', {});
    assert.equal(B.state.calls.at(-1).method, 'sessions.list');
    B.rejectAll(); await p.catch(() => {});

    ctrl.abort(); ctrlB.abort();
  });
});

test('绑定已退役的 host 不会假装在线', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:gone'});
    const ctrl = new AbortController();
    const api = shim.installLegacyShim(A.host, ctrl.signal);
    A.retire();
    api.goOffline();
    assert.equal(api.isOnline(), false);

    // 把已经退役的 host 当成新 host 传进来：必须判定为离线，而不是显示"已连接"
    api.rebind(A.host, new AbortController().signal);
    assert.equal(api.isOnline(), false, '退役 host 不得被当成可用连接');
    assert.equal(api.currentSessionKey(), 'agent:main:gone', '最后只读归属仍保留');
    await assert.rejects(() => api.gwRequest('chat.send', {}), /连接已断开/,
      '不应等到 host 抛错才失败，应直接给出离线原因');
    ctrl.abort();
  });
});

test('laolao-sidebar 的兼容入口不会覆盖安全 getter（退役后仍安全）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {fileURLToPath} = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.join(here, '..', 'services/cle-studio/static/legacy/laolao-sidebar.js'), 'utf8');

  // 静态契约：不允许再直接摸 raw host 的 sessions
  assert.doesNotMatch(src, /window\.CLE\?\.host\?\.sessions/,
    'laolao-sidebar 不得直接读 raw host 的 sessions，否则会覆盖桥的安全 getter');
  assert.match(src, /__cleBridge\?\.currentSessionKey/, '必须走公共桥');

  // 行为契约：在 shim 之后加载 sidebar 的定义，退役后从两条路径读都必须安全
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:fromBridge'});
    const ctrl = new AbortController();
    shim.installLegacyShim(A.host, ctrl.signal);
    // 模拟 laolao-sidebar.js 的执行：它把自己的定义 Object.assign 到 __laolaoSidebar
    const safeGet = () => window.__cleBridge?.currentSessionKey?.()
      ?? window.__laolaoSidebar?.currentSessionKey?.() ?? '';
    window.__laolaoSidebar = Object.assign(window.__laolaoSidebar || {}, {currentSessionKey: safeGet});

    assert.equal(window.__laolaoSidebar.currentSessionKey(), 'agent:main:fromBridge');
    A.retire();
    assert.doesNotThrow(() => window.__laolaoSidebar.currentSessionKey());
    assert.equal(window.__laolaoSidebar.currentSessionKey(), 'agent:main:fromBridge');
    ctrl.abort();
  });
});

test('重连后正常请求只发一次，不重放旧请求', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost();
    const ctrl = new AbortController();
    shim.installLegacyShim(A.host, ctrl.signal);

    const inflight = window.__laolaoSidebar.gwRequest('chat.send', {message: 'one'});
    A.retire();
    const B = makeStrictHost();
    window.__cleBridge.rebind(B.host);
    // 旧的还在途请求被结算成失败也不能触发重发
    A.rejectAll('retired mid-flight');
    await inflight.catch(() => {});
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(B.state.calls.length, 0, '旧在途请求失败后不得在新 host 上重放');

    const fresh = window.__laolaoSidebar.gwRequest('chat.send', {message: 'two'});
    assert.equal(B.state.calls.length, 1, '新请求应只发一次');
    B.rejectAll();
    await fresh.catch(() => {});
    ctrl.abort();
  });
});

// ── 审查 1：消息风暴 / 行为回退 ───────────────────────────────────────────────
// 旧 syncSelection 只有真变化才发通知；重写时误成"每次 subscribe 都发"，
// 而常驻 sidebar 监听 sessions-changed 会 fetchMode(..., true) 拉会话 —— 高频刷新。
test('同 key 同 mode 的重复 publish 零通知、零重新拉取', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:same'});
    const ctrl = new AbortController();
    shim.installLegacyShim(A.host, ctrl.signal);

    const counts = {sessions: 0, mode: 0};
    window.addEventListener('laolao:sessions-changed', () => counts.sessions++);
    window.addEventListener('laolao:modechange', () => counts.mode++);

    // 模拟 host 反复发布回调（运行事件会把 subscribe 回调叫很多次）
    assert.equal(A.state.subs.length, 1, '应该只订阅一次');
    const fire = A.state.subs[0];
    for (let i = 0; i < 12; i++) fire();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(counts.sessions, 0, '同 key 重复 publish 不得发 sessions-changed（否则 sidebar 反复 fetchMode）');
    assert.equal(counts.mode, 0, 'mode 没变不得发 modechange');

    // 真变化才发，且只发一次
    A.state.retired = false;
    A.state.calls.push({method: 'noop', params: {}}); // 保留计数语义
    ctrl.abort();
  });
});

test('session 真变化只发一次 sessions-changed 并关闭记忆编辑器；mode 变化发 modechange', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const host = makeStrictHost({selectedKey: 'agent:main:a'});
    const ctrl = new AbortController();
    shim.installLegacyShim(host.host, ctrl.signal);

    const counts = {sessions: 0, mode: 0, closed: 0};
    window.addEventListener('laolao:sessions-changed', () => counts.sessions++);
    window.addEventListener('laolao:modechange', () => counts.mode++);
    window.__clekkMemoryUI = {close: () => counts.closed++, open: () => {}};

    const fire = host.state.subs[0];

    // key 变化
    host.setSelectedKey('agent:main:b');
    fire();
    assert.equal(counts.sessions, 1, 'key 变化应发一次');
    assert.equal(counts.closed, 1, 'scope 变了要关掉记忆编辑器');

    // 同 key 再 publish：不得重复
    fire(); fire();
    assert.equal(counts.sessions, 1, '同 key 不得重复通知');
    assert.equal(counts.closed, 1, '同 key 不得重复关闭');

    // mode 变化
    document.documentElement.dataset.cleRoom = 'unrestricted';
    fire();
    assert.equal(counts.mode, 1, 'mode 变化应发 modechange');
    fire();
    assert.equal(counts.mode, 1, '同 mode 不得重复');

    delete window.__clekkMemoryUI;
    ctrl.abort();
  });
});

// ── 审查 3：pending timer 必须在退役/换代时回收 ───────────────────────────────
test('host.request 永不 settle 时，退役要取消计时并结算调用方（不挂 15s）', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    // 这个 host 的 request 永远不返回
    const host = {
      get sessions() { return {selectedKey: 'agent:main:hang'}; },
      request() { return new Promise(() => {}); },
      subscribe() { return () => {}; },
      onEvent() { return () => {}; },
    };
    const ctrl = new AbortController();
    shim.installLegacyShim(host, ctrl.signal);

    const live = new Set();
    const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
    globalThis.setTimeout = (fn, ms, ...r) => { const id = realST(fn, ms, ...r); live.add(id); return id; };
    globalThis.clearTimeout = (id) => { live.delete(id); return realCT(id); };
    try {
      const inflight = window.__laolaoSidebar.gwRequest('sessions.list', {}, 15000);
      await new Promise((r) => realST(r, 10));
      assert.ok(live.size >= 1, '在途请求应有超时计时器');

      ctrl.abort();
      await assert.rejects(inflight, (err) => {
        // 已经发出去的请求：不能说"未执行"，只能诚实标为未确认
        assert.match(err.message, /未确认/, `实际：${err.message}`);
        return true;
      });
      assert.equal(live.size, 0, '退役必须取消 pending 计时器');
    } finally {
      globalThis.setTimeout = realST; globalThis.clearTimeout = realCT;
    }
  });
});

test('发送前离线说"未执行"，发出后断线说"未确认"', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost();
    const ctrl = new AbortController();
    shim.installLegacyShim(A.host, ctrl.signal);

    // 发出后断线
    const sent = window.__laolaoSidebar.gwRequest('chat.send', {message: 'x'});
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    await assert.rejects(sent, /未确认/);

    // 发送前就离线
    await assert.rejects(() => window.__laolaoSidebar.gwRequest('chat.send', {message: 'y'}), /未执行/);
  });
});

// ── 审查 2：document 常驻桥必须跨 bundle 版本稳定 ─────────────────────────────
// 状态放在模块级 const 时，热更新后两个 ESM 实例各持一份，旧 classic 捕获的
// gwRequest/facade 永远指向旧 host。这里真的 import 两个 revision 并共享 window。
test('两个 revision 共享同一份桥状态：旧 classic 捕获的句柄会跟着新 host 走', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {fileURLToPath} = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcPath = path.join(here, '..', 'services/cle-studio/src/legacy/shim.js');
  const src = fs.readFileSync(srcPath, 'utf8');

  // 造第二个 revision：内容等价但对 ESM 而言是不同模块实例
  const revA = 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
  const revB = 'data:text/javascript;base64,' + Buffer.from(
    src.replace('// What the 2026.7 modules expected', '// revision B\n// What the 2026.7 modules expected'), 'utf8',
  ).toString('base64');
  const A = await import(revA);
  const B = await import(revB);
  assert.notEqual(A, B, '两个 revision 必须是不同模块实例');

  const env = makeEnv();
  await withGlobals(env, async () => {
    const h1 = makeStrictHost({selectedKey: 'agent:main:v1'});
    const c1 = new AbortController();
    // 旧 revision 安装，classic 捕获它的 gwRequest
    A.installLegacyShim(h1.host, c1.signal);
    const oldRequest = window.__laolaoSidebar.gwRequest;
    const oldKey = window.__laolaoSidebar.currentSessionKey;

    assert.equal(oldKey(), 'agent:main:v1');

    // 热更新：新 revision 接管新 host
    h1.retire();
    const h2 = makeStrictHost({selectedKey: 'agent:main:v2'});
    const c2 = new AbortController();
    B.installLegacyShim(h2.host, c2.signal);

    // 旧 classic 手里的函数必须已经指向新 host（同一份 slot）
    assert.equal(oldKey(), 'agent:main:v2', '旧捕获的读 key 必须跟着新 host');
    const p = oldRequest('sessions.list', {});
    assert.equal(h2.state.calls.at(-1)?.method, 'sessions.list', '旧捕获的 gwRequest 必须发到新 host');
    h2.rejectAll(); await p.catch(() => {});

    // 旧 revision 的 disposer 晚到，不得关闭新轮
    c1.abort();
    assert.equal(oldKey(), 'agent:main:v2', '旧 revision 的 abort 不得打掉新轮');
    assert.equal(window.__cleBridge.isOnline(), true);

    c2.abort();
  });
});

// ── 审查 4：已 aborted 的 signal 必须零资源早退 ───────────────────────────────
test('传入已 aborted 的 signal：零 observer/订阅、直接离线', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const host = makeStrictHost({selectedKey: 'agent:main:dead'});
    const ctrl = new AbortController();
    ctrl.abort(); // 先 abort 再 install
    env.observers.length = 0;

    shim.installLegacyShim(host.host, ctrl.signal);

    assert.equal(env.observers.filter((o) => !o.disconnected).length, 0, '不应留下未断开的 observer');
    assert.equal(host.state.subs.length, 0, '不应建立 subscribe');
    assert.equal(host.state.eventOffs.length, 0, '不应建立 onEvent');
    assert.equal(window.__cleBridge.isOnline(), false, '应直接标记离线');
    await assert.rejects(() => window.__laolaoSidebar.gwRequest('x', {}), /未执行/);
  });
});

// ── 审查 5：facade 订阅必须由桥持有并在换代后重绑 ────────────────────────────
test('facade 订阅换代后仍生效；退役前捕获的实际 wrapper 不再进入', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:one'});
    const cA = new AbortController();
    const api = shim.installLegacyShim(A.host, cA.signal);
    const facade = api.hostFacade();

    const seen = [];
    const external = () => seen.push('hit');
    const unsub = facade.subscribe(external);

    // host 上会有两条订阅：桥自己的 syncSelection（第一条），以及外部 wrapper。
    // 外部那条必须是 wrapper，不能是外部原件。
    assert.equal(A.state.subs.length, 2, '第一轮应有桥订阅 + 外部 wrapper');
    // 按身份识别，不依赖数组顺序：外部 wrapper 一定不是 external 原件
    const wrapperA = A.state.subs.find((f) => f !== external && f.name !== 'syncSelection');
    assert.ok(wrapperA, '外部 wrapper 必须绑在 host 上');
    assert.notEqual(wrapperA, external, '外部原件不得直接绑到 host');

    // 通过 host 真实触发 wrapper（不是手动调 external）
    wrapperA();
    assert.equal(seen.length, 1, '第一轮 wrapper 应把事件交给外部回调');

    // 换代
    A.retire();
    const B = makeStrictHost({selectedKey: 'agent:main:two'});
    const cB = new AbortController();
    api.rebind(B.host, cB.signal);

    assert.ok(!A.state.subs.includes(wrapperA), '旧 host 上的外部 wrapper 必须已解绑');
    const wrapperB = B.state.subs.find((f) => f.name !== 'syncSelection');
    assert.ok(wrapperB, '新 host 应重新绑一次外部 wrapper');
    assert.notEqual(wrapperB, wrapperA, '换代必须换新 wrapper');

    // 关键：调用退役前捕获的旧 wrapper —— 即使它已被 host 保存过，也不能再进入
    wrapperA();
    assert.equal(seen.length, 1, '退役前捕获的旧 wrapper 必须零次进入');

    // 新 wrapper 正常
    wrapperB();
    assert.equal(seen.length, 2, '新 wrapper 应正常送达');

    // 外部 unsubscribe 依旧有效
    unsub();
    assert.ok(!B.state.subs.includes(wrapperB), 'unsubscribe 后桥应解绑新 host 上的 wrapper');
    wrapperB();
    assert.equal(seen.length, 2, 'unsubscribe 后旧 wrapper 也不得再进入');

    cA.abort(); cB.abort();
  });
});

test('换代后旧 host 的 gateway 事件零次进入新界面', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:ev1'});
    const cA = new AbortController();
    const api = shim.installLegacyShim(A.host, cA.signal);

    const relayed = [];
    window.addEventListener('pinkie:gateway-event', (e) => relayed.push(e.detail?.event));

    // 记下 A 的 onEvent 回调，换代后手动触发它们
    const aCallbacks = Object.values(A.state.handlers || {});
    const getAHandlers = () => A.state.eventHandlers || new Map();
    const aHandlers = getAHandlers();

    // 换代
    A.retire();
    const B = makeStrictHost({selectedKey: 'agent:main:ev2'});
    const cB = new AbortController();
    api.rebind(B.host, cB.signal);

    // 旧 host 的事件回调若还活着，就会往新界面灌事件
    for (const fn of aHandlers.values()) { try { fn({stale: true}); } catch {} }
    assert.equal(relayed.length, 0, '旧 host 的事件必须是零次');

    // 新 host 的事件正常进入
    const bHandlers = B.state.eventHandlers || new Map();
    for (const fn of bHandlers.values()) { try { fn({fresh: true}); } catch {} }
    assert.ok(relayed.length > 0, '新 host 的事件应正常转达');

    cA.abort(); cB.abort();
  });
});

// ── 审查 6：真实业务错误原样传回；空 key 如实记为��� ──────────────────────────
test('facade 把同步 throw 封成 rejection，真实业务错误原样传回', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const bizError = new Error('session is locked by another pane');
    const host = {
      get sessions() {
        return {
          selectedKey: 'agent:main:x',
          open() { throw bizError; },                 // 同步 throw
          create() { return Promise.reject(bizError); }, // 异步拒绝
        };
      },
      request() { return Promise.resolve({}); },
      subscribe() { return () => {}; },
      onEvent() { return () => {}; },
    };
    const ctrl = new AbortController();
    const api = shim.installLegacyShim(host, ctrl.signal);
    const facade = api.hostFacade();

    // 同步 throw 不能漏到调用方同步栈
    const p = facade.sessions.open({sessionKey: 'x'});
    assert.ok(p instanceof Promise, '同步 throw 必须被封成 Promise');
    await assert.rejects(p, (e) => {
      assert.equal(e.message, bizError.message, '真实业务错误必须原样传回');
      return true;
    });
    await assert.rejects(() => facade.sessions.create({label: 'y'}), /locked by another pane/);
    ctrl.abort();
  });
});

test('读到空 key 时如实记为空，不沿用上一个 session', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:old'});
    const cA = new AbortController();
    shim.installLegacyShim(A.host, cA.signal);
    assert.equal(window.__laolaoSidebar.currentSessionKey(), 'agent:main:old');

    A.retire();
    // 新 host 明确的"没有选中会话"
    const B = makeStrictHost({selectedKey: ''});
    const cB = new AbortController();
    shim.installLegacyShim(B.host, cB.signal);
    assert.equal(window.__laolaoSidebar.currentSessionKey(), '', '空 key 必须记成空，不能沿用旧值');

    // 空 key 的 host 确实在线
    assert.equal(window.__cleBridge.isOnline(), true, '能读到空 key 说明 host 还活着');
    cA.abort(); cB.abort();
  });
});

// ── 审查 1（本轮）：reinstall 时"替换失败"也必须完整回收 ─────────────────────
// 不是 fresh install：先有活跃 host + 永不 settle 的请求 + facade 订阅，
// 再用 rebind(newHost, 已终止 signal) 替换 —— 这一轮其实没装上，旧资源必须全收。
test('reinstall 用已终止 signal 替换失败时，旧 pending 与外部订阅都要回收', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:live'});
    const cA = new AbortController();
    const api = shim.installLegacyShim(A.host, cA.signal);

    const stamp = document.__cleBridgeSlot_v1;
    const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
    const live = new Set();
    globalThis.setTimeout = (fn, ms, ...r) => { const id = realST(fn, ms, ...r); live.add(id); return id; };
    globalThis.clearTimeout = (id) => { live.delete(id); return realCT(id); };
    try {
      // 永不 settle 的在途请求
      const inflight = window.__laolaoSidebar.gwRequest('sessions.list', {}, 15000);
      await new Promise((r) => realST(r, 10));
      assert.ok(live.size >= 1, '应有 pending 计时器');

      // 外部订阅
      const seen = [];
      api.hostFacade().subscribe(() => seen.push('x'));
      const wrapperA = A.state.subs.find((f) => f.name !== 'syncSelection');
      assert.ok(wrapperA, '外部 wrapper 应已绑上');
      assert.equal(stamp.externals.size, 1);

      // 替换失败：新 signal 一上来就是 terminated
      const dead = new AbortController(); dead.abort();
      const B = makeStrictHost();
      api.rebind(B.host, dead.signal);

      // 旧 pending 必须被结算为"未确认"，计时器取消
      await assert.rejects(inflight, /未确认/);
      assert.equal(live.size, 0, '替换失败也必须取消旧 pending 计时器');

      // 旧外部订阅必须解绑，且旧 wrapper 不能再进入
      assert.ok(!A.state.subs.includes(wrapperA), '替换失败后旧 host 的外部 wrapper 必须解绑');
      assert.equal(stamp.externals.size, 0, '外部订阅登记必须清空');
      wrapperA();
      assert.equal(seen.length, 0, '旧 wrapper 不得再进入');

      // 而且新 host 一个资源都没装
      assert.equal(B.state.subs.length, 0, '替换失败的新 host 不应建立订阅');
      assert.equal(window.__cleBridge.isOnline(), false);
    } finally {
      globalThis.setTimeout = realST; globalThis.clearTimeout = realCT;
    }
    cA.abort();
  });
});

// ── 审查 2（本轮）：正常 abort 也要解绑外部订阅 ───────────────────────────────
test('正常 abort 后，退役前捕获的外部 wrapper 零次进入', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:x'});
    const ctrl = new AbortController();
    const api = shim.installLegacyShim(A.host, ctrl.signal);

    const seen = [];
    api.hostFacade().subscribe(() => seen.push('x'));
    const wrapperA = A.state.subs.find((f) => f.name !== 'syncSelection');
    wrapperA();
    assert.equal(seen.length, 1);

    ctrl.abort();
    // 即使 host 仍保存着这个 wrapper（off 不保证立刻生效），也不能进入
    wrapperA();
    assert.equal(seen.length, 1, 'abort 后旧 wrapper 必须零次进入');
    assert.ok(!A.state.subs.includes(wrapperA), 'abort 应解绑旧 host 上的订阅');
    // 登记要保留：classic 只在 boot 订阅一次，重连后桥必须能按新 host 重绑。
    assert.equal(document.__cleBridgeSlot_v1.externals.size, 1, 'abort 只解绑，不丢弃登记');

    // 重连：同一个外部订阅必须被重绑到新 host，并再次生效
    const B = makeStrictHost({selectedKey: 'agent:main:y'});
    const cB = new AbortController();
    shim.installLegacyShim(B.host, cB.signal);
    const wrapperB = B.state.subs.find((f) => f.name !== 'syncSelection');
    assert.ok(wrapperB, '重连后同一个外部订阅必须被重绑');
    wrapperB();
    assert.equal(seen.length, 2, '重连后外部订阅应再次生效');
    cB.abort();
  });
});

// ── 审查 3（本轮）：modechange 监听者要读到新 key，且重装补一次通知 ─────────────
test('modechange 监听者在回调里读到的是新 key（先提交快照再通知）', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const host = makeStrictHost({selectedKey: 'agent:main:before'});
    const ctrl = new AbortController();
    const api = shim.installLegacyShim(host.host, ctrl.signal);
    const facade = api.hostFacade();

    let seenKey = null;
    window.addEventListener('laolao:modechange', () => {
      seenKey = facade.sessions.selectedKey; // 监听者通过 facade 读
    });

    // 同一轮里 mode 和 key 同时换
    host.setSelectedKey('agent:main:after');
    document.documentElement.dataset.cleRoom = 'unrestricted';
    host.state.subs[0](); // 一次 publish 里两者都变

    assert.equal(seenKey, 'agent:main:after', 'modechange 回调里必须已能读到新 key');
    ctrl.abort();
  });
});

test('重装时 mode 已在离线期间变化，也要补一次正确通知', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:main:m'});
    const cA = new AbortController();
    shim.installLegacyShim(A.host, cA.signal);
    document.documentElement.dataset.cleRoom = 'code';

    const modes = [];
    window.addEventListener('laolao:modechange', (e) => modes.push(e.detail?.mode));

    // 离线期间 mode 变了，且没有触发任何 publish
    cA.abort();
    document.documentElement.dataset.cleRoom = 'unrestricted';
    assert.equal(modes.length, 0, '离线期间不应有通知');

    // 重装：应补一次正确通知
    const B = makeStrictHost({selectedKey: 'agent:main:m'});
    const cB = new AbortController();
    shim.installLegacyShim(B.host, cB.signal);
    assert.deepEqual(modes, ['unrestricted'], '重装应补一次 modechange，且是新 mode');
    cB.abort();
  });
});

test('reinstall with a different session in the same room closes the old memory scope once', async () => {
  const env = makeEnv();
  await withGlobals(env, async () => {
    const A = makeStrictHost({selectedKey: 'agent:project:old'});
    const cA = new AbortController();
    const api = shim.installLegacyShim(A.host, cA.signal);
    let closed = 0;
    const notified = [];
    window.__clekkMemoryUI = {close() { closed++; }};
    window.addEventListener('laolao:sessions-changed', () => notified.push(api.currentSessionKey()));
    cA.abort(); A.retire();
    const B = makeStrictHost({selectedKey: 'agent:project:new'});
    const cB = new AbortController();
    api.rebind(B.host, cB.signal);
    assert.deepEqual(notified, ['agent:project:new']);
    assert.equal(closed, 1);
    for (const fn of [...B.state.subs]) fn();
    assert.deepEqual(notified, ['agent:project:new'], 'same selection must not notify again');
    assert.equal(closed, 1);
    cB.abort();
  });
});
