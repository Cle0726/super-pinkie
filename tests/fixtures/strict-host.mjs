// 严格退役 host + 生命周期行为测试（真实行为，不是假设）。
//
// 背景（主控 19789 learning QA 实测堆栈）：插件 UI activation 退役后，host 的 getter
// 会同步抛 `This plugin UI activation has ended. Use the current activation.`
// 但 classic legacy 脚本是 document 常驻，不跟插件退役，于是
// __laolaoSidebar.currentSessionKey 闭包、window.CLE.host 都还指向旧 host，
// 断线期间就不断出 uncaught，gwRequest 的 timer 还会漏。
//
// 这个文件的 host 故意做到"比真机更严"：
//   - 任何属性访问、任何方法调用、任何事件订阅，在退役后一律同步 throw；
//   - 未退役时也只允许白名单方法，避免测试因宽容实现而假通过。
import test from 'node:test';
import assert from 'node:assert/strict';

const RETIRED = 'This plugin UI activation has ended. Use the current activation.';

// ── 严格 host 工厂 ───────────────────────────────────────────────────────────
function makeStrictHost({selectedKey = 'agent:main:main', requests = [], asyncReject = null} = {}) {
  const state = {
    retired: false,
    calls: [],            // {method, params}
    pending: [],          // 未结算的 promise 控制器
    subs: [],
    eventOffs: [],
    eventHandlers: new Map(),
    log: [],
  };

  const guard = (label) => {
    if (state.retired) throw new Error(RETIRED);
    state.log.push(label);
  };

  const host = {
    get sessions() {
      guard('get sessions');
      return {
        get selectedKey() { guard('get sessions.selectedKey'); return selectedKey; },
        open: async (args) => { guard('sessions.open'); state.calls.push({method: 'sessions.open', params: args}); return true; },
        create: async (args) => { guard('sessions.create'); state.calls.push({method: 'sessions.create', params: args}); return 'agent:main:new'; },
      };
    },
    request(method, params) {
      guard('request ' + method);
      state.calls.push({method, params});
      requests.push({method, params});
      if (asyncReject) return Promise.reject(new Error(asyncReject));
      // 记录 pending，让你能模拟"在途请求"在退役时仍未返回
      return new Promise((resolve, reject) => {
        state.pending.push({method, params, resolve, reject});
      });
    },
    subscribe(fn) {
      guard('subscribe');
      state.subs.push(fn);
      // 真实 host 的 off 会真的解绑；这里如实模拟，否则测试只能测到"桥以为自己解绑了"。
      return () => {
        const i = state.subs.indexOf(fn);
        if (i >= 0) state.subs.splice(i, 1);
        state.eventOffs.push('sub');
      };
    },
    onEvent(name, fn) {
      guard('onEvent ' + name);
      state.eventOffs.push(name);
      // 记下回调，测试才能模拟"旧 host 的老回调在换代后仍被调用"
      if (!state.eventHandlers) state.eventHandlers = new Map();
      state.eventHandlers.set(name, fn);
      return () => {
        state.eventHandlers?.delete(name);
        state.log.push('off:' + name);
      };
    },
    ui: {
      registerReplacement() { guard('ui.registerReplacement'); return () => { state.log.push('ui.replace.dispose'); }; },
      selectReplacement() { guard('ui.selectReplacement'); },
    },
  };

  return {
    host,
    state,
    setSelectedKey(next) { selectedKey = next; },
    retire() { state.retired = true; },
    // 模拟"在途请求被网关拒绝"
    rejectAll(error = 'gateway closed') {
      for (const p of state.pending.splice(0)) p.reject(new Error(error));
    },
    // 模拟"在途请求在退役后仍被结算"（必须不影响新桥）
    resolveAll(value = {ok: true}) {
      for (const p of state.pending.splice(0)) p.resolve(value);
    },
  };
}

// ── 从一个"缺省即可"的最小 DOM 环境跑 shim ───────────────────────────────────
// shim 依赖 window / document / CustomEvent / MutationObserver / setTimeout。
// 这里用 node 的 EventTarget 做一个够用的骨架，避免引入 jsdom 依赖。
function makeEnv() {
  const events = [];
  const listeners = new Map();
  const target = {
    dispatchEvent(e) {
      events.push(e);
      for (const fn of listeners.get(e.type) || []) fn(e);
      return true;
    },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener(type, fn) { const a = listeners.get(type) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
  };
  const observers = [];
  class MutationObserverShim {
    constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const documentElement = {dataset: {cleRoom: 'code'}};
  const win = { ...target, __laolaoSidebar: {}, CLE: {}, location: {search: ''}, URLSearchParams: globalThis.URLSearchParams };
  return {win, doc: {documentElement}, events, observers, MutationObserverShim};
}

// shim 是 ESM 且直接用全局 window/document，所以按源码文本求值，注入假环境。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const shimPath = path.join(here, '..', '..', 'services/cle-studio/src/legacy/shim.js');

async function loadShim() {
  const src = fs.readFileSync(shimPath, 'utf8');
  const mod = src
    .replace(/^export function installLegacyShim/m, 'export function installLegacyShim');
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(mod, 'utf8').toString('base64');
  return import(dataUrl);
}

// 把 shim 想要的全局挂上，返回清理函数
function withGlobals(env, fn) {
  const saved = {
    window: globalThis.window, document: globalThis.document,
    CustomEvent: globalThis.CustomEvent, MutationObserver: globalThis.MutationObserver,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  };
  globalThis.window = env.win;
  globalThis.document = env.doc;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };
  globalThis.MutationObserver = env.MutationObserverShim;
  return Promise.resolve(fn()).finally(() => Object.assign(globalThis, saved));
}

export {makeStrictHost, makeEnv, loadShim, withGlobals, RETIRED};
