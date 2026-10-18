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
    assert.equal(facade.online, false);
    await assert.rejects(() => facade.sessions.open({sessionKey: 'x'}), /连接已断开/);
    await assert.rejects(() => facade.request('chat.send', {message: 'x'}), /连接已断开/);
    await assert.rejects(() => facade.sessions.create({label: 'x'}), /连接已断开/);
    // 订阅/UI 在离线时是"什么都不做"，不能抛
    assert.doesNotThrow(() => facade.subscribe(() => {}));
    assert.doesNotThrow(() => facade.onEvent('chat', () => {}));
    assert.doesNotThrow(() => facade.ui.registerReplacement({}));

    // 重连：新 host 上正常转发
    const B = makeStrictHost({selectedKey: 'agent:main:after'});
    const ctrlB = new AbortController();
    api.rebind(B.host, ctrlB.signal);
    const facade2 = api.hostFacade();
    A.retire();
    assert.equal(facade2.online, true);
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
