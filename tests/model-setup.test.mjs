// 小白配模型（设定防护 B）：预设、测试连接说人话、保存只动白名单键、密钥不外露。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createModelCapabilityTool, createModelSetup, cleanKey, explainFailure, PRESETS, supplementMinimalModelCapability} from '../services/mode-architecture/model-setup.mjs';

const KEY = 'sk-test-1234567890abcd';
function harness(routes, initial = {}) {
  let cfg = structuredClone(initial);
  const config = {current: () => cfg, async mutateConfigFile({mutate}) { const draft = structuredClone(cfg); await mutate(draft); cfg = draft; }};
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, init});
    const route = routes(url, init);
    if (route instanceof Error) throw route;
    return {ok: route.status < 300, status: route.status, text: async () => JSON.stringify(route.body ?? {})};
  };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-setup-'));
  return {setup: createModelSetup({config, fetchImpl, stateDir}), get cfg() { return cfg; }, calls, stateDir};
}
const models = {data: [{id: 'deepseek-flash', name: 'DeepSeek Flash', context_window: 1048576}, {id: 'deepseek-v4-pro'}, {id: 'text-embedding-x'}]};

test('presets cover the planned providers and every one but custom has a key link', () => {
  const ids = PRESETS.map(p => p.id);
  for (const id of ['deepseek', 'bailian', 'kimi', 'zhipu', 'ark', 'siliconflow', 'openrouter', 'openai', 'gemini', 'custom']) assert.ok(ids.includes(id), id);
  for (const p of PRESETS.filter(p => p.id !== 'custom')) { assert.match(p.baseUrl, /^https:\/\//); assert.match(p.keyUrl, /^https:\/\//); assert.ok(p.models.length); }
});

test('pasted keys lose quotes, spaces and a Bearer prefix', () => {
  assert.equal(cleanKey(`  "Bearer ${KEY}"\n`), KEY);
  assert.equal(cleanKey(`“${KEY}”`), KEY);
});

test('test connection lists chat models and the key is sent only as a header', async () => {
  const h = harness(url => (url.endsWith('/models') ? {status: 200, body: models} : {status: 404}));
  const result = await h.setup.test({preset: 'deepseek', apiKey: ` '${KEY}' `});
  assert.equal(result.ok, true);
  assert.deepEqual(result.models.map(m => m.id), ['deepseek-flash', 'deepseek-v4-pro']);
  assert.equal(h.calls[0].url, 'https://api.deepseek.com/models');
  assert.equal(h.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(result).includes(KEY));
});

test('failures are explained in plain Chinese', async () => {
  const cases = [
    [{status: 401, body: {error: {message: `Incorrect API key ${KEY}`}}}, 'auth', /密钥不对/],
    [{status: 402, body: {error: 'Insufficient Balance'}}, 'balance', /余额不足/],
    [new Object(Object.assign(new Error('timeout'), {name: 'TimeoutError'})), 'network', /超时/],
  ];
  for (const [route, kind, pattern] of cases) {
    const h = harness(() => route);
    const result = await h.setup.test({preset: 'openai', apiKey: KEY});
    assert.equal(result.ok, false); assert.equal(result.kind, kind); assert.match(result.message, pattern);
    assert.ok(!JSON.stringify(result).includes(KEY));
  }
  assert.match(explainFailure({error: Object.assign(new Error('x'), {code: 'ECONNREFUSED'}), preset: 'gemini'}).message, /代理/);
  // 11-13 验收：fetch 失败是 TypeError，原因藏在 cause 里；界面上不能出现 TypeError 这类英文名
  const fetchFailed = Object.assign(new TypeError('fetch failed'), {cause: Object.assign(new Error('connect'), {code: 'ECONNREFUSED'})});
  const refused = explainFailure({error: fetchFailed, preset: 'custom'}).message;
  assert.match(refused, /没有服务在响应/); assert.doesNotMatch(refused, /TypeError|ECONN/);
  assert.doesNotMatch(explainFailure({error: new TypeError('fetch failed'), preset: 'custom'}).message, /TypeError/);
  assert.match(explainFailure({error: Object.assign(new TypeError('fetch failed'), {cause: {code: 'ENOTFOUND'}}), preset: 'kimi'}).message, /找不到这个地址/);
  // 错模型
  const h = harness(url => (url.endsWith('/models') ? {status: 200, body: models} : {status: 404, body: {error: {message: 'Model Not Exist'}}}));
  const wrong = await h.setup.test({preset: 'deepseek', apiKey: KEY, model: 'deepseek-nope'});
  assert.equal(wrong.kind, 'model'); assert.match(wrong.message, /deepseek-nope.*用不了/);
});

test('a provider without a model list is probed with one short chat', async () => {
  const h = harness(url => (url.endsWith('/models') ? {status: 404} : {status: 200, body: {choices: [{message: {content: '好'}}]}}));
  const result = await h.setup.test({preset: 'ark', apiKey: KEY});
  assert.equal(result.ok, true); assert.equal(result.listed, false);
  assert.deepEqual(result.models.map(m => m.id), ['doubao-seed-2-1-pro-260915']);
  assert.equal(JSON.parse(h.calls[1].init.body).max_tokens, 8);
});

test('save writes only models + default model keys; author providers stay; list masks the key', async () => {
  const initial = {models: {providers: {mm: {baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'author-secret', models: [{id: 'a'}]}, deepseek: {baseUrl: 'https://api.deepseek.com/v1', apiKey: 'x', models: [{id: 'old'}]}}},
    agents: {defaults: {model: {primary: 'mm/a', fallbacks: ['mm/a']}}, list: [{id: 'main', model: 'mm/a'}, {id: 'unrestricted', model: {primary: 'mm/a'}}]},
    plugins: {entries: {x: {enabled: true}}}};
  const h = harness(() => ({status: 200, body: models}), initial);
  const saved = await h.setup.save({preset: 'deepseek', apiKey: KEY, models: ['deepseek-flash'], defaultModel: 'deepseek-flash'});
  assert.equal(saved.providerId, 'deepseek-2'); // 作者自己的 deepseek 不被覆盖
  assert.deepEqual(h.cfg.models.providers.mm, initial.models.providers.mm);
  assert.equal(h.cfg.models.providers['deepseek-2'].apiKey, KEY);
  assert.ok(h.cfg.models.providers['deepseek-2'].models.every(model => model.reasoning === true));
  assert.equal(h.cfg.agents.defaults.model.primary, 'deepseek-2/deepseek-flash');
  assert.deepEqual(h.cfg.agents.defaults.model.fallbacks, ['mm/a']);
  assert.equal(h.cfg.agents.list[0].model, 'deepseek-2/deepseek-flash');
  assert.deepEqual(h.cfg.agents.list[1].model, {primary: 'mm/a'}); // 无限制模式归用户自己，不动
  assert.deepEqual(h.cfg.plugins, initial.plugins);
  const listed = h.setup.list();
  assert.ok(!JSON.stringify(listed).includes(KEY)); assert.ok(!JSON.stringify(listed).includes('author-secret'));
  assert.equal(listed.providers.find(p => p.id === 'deepseek-2').keyTail, '••••abcd');
  assert.equal(listed.needsSetup, false);
  assert.equal(fs.statSync(path.join(h.stateDir, 'pinkie-model-setup.json')).mode & 0o777, 0o600);
  // 作者自己的服务商在这里删不了
  await assert.rejects(h.setup.remove({providerId: 'mm'}), /只能删除/);
  // 编辑时不填密钥 = 沿用
  await h.setup.save({providerId: 'deepseek-2', preset: 'deepseek', models: ['deepseek-flash', 'deepseek-v4-pro']});
  assert.equal(h.cfg.models.providers['deepseek-2'].apiKey, KEY);
  // 默认模型不能直接停用；换掉默认后停用 → 启用 → 删除
  await assert.rejects(h.setup.disable({providerId: 'deepseek-2'}), /默认/);
  await h.setup.setDefault({model: 'mm/a'});
  await h.setup.disable({providerId: 'deepseek-2'});
  assert.equal(h.cfg.models.providers['deepseek-2'], undefined);
  assert.equal(h.setup.list().providers.find(p => p.id === 'deepseek-2').enabled, false);
  await h.setup.enable({providerId: 'deepseek-2'});
  assert.equal(h.cfg.models.providers['deepseek-2'].apiKey, KEY);
  await h.setup.remove({providerId: 'deepseek-2'});
  assert.equal(h.cfg.models.providers['deepseek-2'], undefined);
});

test('a blank profile needs setup', () => {
  assert.equal(harness(() => ({status: 200})).setup.list().needsSetup, true);
});

test('test preserves upstream vision/context metadata and save keeps explicit vision choice', async () => {
  const upstream = {data: [
    {id: 'vision-1', name: 'Vision One', context_window: 262144, input_modalities: ['text', 'image']},
    {id: 'text-1', name: 'Text One', context_window: 65536},
  ]};
  const h = harness(url => (url.endsWith('/models') ? {status: 200, body: upstream} : {status: 200, body: {}}));
  const tested = await h.setup.test({preset: 'openai', apiKey: KEY});
  assert.equal(tested.models.find(m => m.id === 'vision-1').vision, true);
  assert.equal(tested.models.find(m => m.id === 'text-1').vision, false);
  await h.setup.save({
    preset: 'openai',
    apiKey: KEY,
    models: [
      {id: 'vision-1', name: 'Vision One', vision: false, meta: tested.models[0].meta},
      {id: 'text-1', name: 'Text One', vision: true, meta: tested.models[1].meta},
    ],
  });
  const savedModels = h.cfg.models.providers.openai.models;
  assert.deepEqual(savedModels.find(m => m.id === 'vision-1').input, ['text']);
  assert.equal(savedModels.find(m => m.id === 'vision-1').contextWindow, 262144);
  assert.deepEqual(savedModels.find(m => m.id === 'text-1').input, ['text', 'image']);
  // Editing without overriding vision preserves existing input
  await h.setup.save({providerId: 'openai', preset: 'openai', models: ['text-1']});
  assert.deepEqual(h.cfg.models.providers.openai.models[0].input, ['text', 'image']);
});

test('setCapability and pinkie_model_capability toggle image input safely without leaking secrets', async () => {
  const initial = {
    models: {
      providers: {
        mm: {
          baseUrl: 'http://127.0.0.1:1467/v1',
          apiKey: 'mm-secret-xyz',
          models: [
            {id: 'workbuddy/hy4flash', name: 'HY4 Flash', input: ['text', 'audio']},
            {id: 'shared-id', name: 'Shared MM', input: ['text']},
          ],
        },
        deepseek: {
          baseUrl: 'https://api.deepseek.com',
          apiKey: KEY,
          models: [
            {id: 'deepseek-chat', name: 'DeepSeek Chat', input: ['text']},
            {id: 'shared-id', name: 'Shared DS', input: ['text']},
          ],
        },
      },
    },
    agents: {defaults: {model: {primary: 'deepseek/deepseek-chat'}}},
  };
  const h = harness(() => ({status: 200}), initial);
  const tool = createModelCapabilityTool(h.setup);

  // Full provider/modelId with nested slash works and preserves other modalities like audio
  const r1 = await tool.execute('c1', {model: 'mm/workbuddy/hy4flash', vision: true});
  assert.equal(r1.isError, false);
  assert.deepEqual(h.cfg.models.providers.mm.models[0].input, ['text', 'audio', 'image']);
  assert.match(r1.details.message, /如果上游其实不支持，发图时会报错，可以再关掉/);
  assert.ok(!JSON.stringify(r1).includes('mm-secret-xyz'));

  // Unique short model id works
  const r2 = await tool.execute('c2', {model: 'deepseek-chat', vision: true});
  assert.equal(r2.isError, false);
  assert.deepEqual(h.cfg.models.providers.deepseek.models[0].input, ['text', 'image']);

  // Turning off removes image, keeps text + audio, and records override in pinkie-model-setup.json
  const r3 = await tool.execute('c3', {model: 'mm/workbuddy/hy4flash', vision: false});
  assert.equal(r3.isError, false);
  assert.deepEqual(h.cfg.models.providers.mm.models[0].input, ['text', 'audio']);
  const reg = JSON.parse(fs.readFileSync(path.join(h.stateDir, 'pinkie-model-setup.json'), 'utf8'));
  assert.equal(reg.capabilities['mm/workbuddy/hy4flash'].vision, false);

  // Ambiguous short id across providers fails clearly
  const r4 = await tool.execute('c4', {model: 'shared-id', vision: true});
  assert.equal(r4.isError, true);
  assert.match(r4.details.error, /多个服务商.*mm\/shared-id.*deepseek\/shared-id/);

  // Unknown model suggests configured models and default without leaking keys
  const r5 = await tool.execute('c5', {model: 'deepseek', vision: true});
  assert.equal(r5.isError, true);
  assert.match(r5.details.error, /deepseek\/deepseek-chat/);
  assert.ok(!JSON.stringify(r5).includes(KEY));
  assert.ok(!JSON.stringify(r5).includes('mm-secret-xyz'));

  // list() exposes vision per model
  const listed = h.setup.list();
  assert.equal(listed.providers.find(p => p.id === 'deepseek').models.find(m => m.id === 'deepseek-chat').vision, true);
  assert.equal(listed.providers.find(p => p.id === 'mm').models.find(m => m.id === 'workbuddy/hy4flash').vision, false);
});

test('supplementMinimalModelCapability allows pinkie_model_capability in restrictive profiles only when no allow override exists', () => {
  const cfg = {tools: {profile: 'minimal', alsoAllow: ['pinkie_sessions']}};
  assert.equal(supplementMinimalModelCapability(cfg), true);
  assert.deepEqual(cfg.tools.alsoAllow, ['pinkie_sessions', 'pinkie_model_capability']);
  assert.equal(supplementMinimalModelCapability(cfg), false);
  const coding = {tools: {profile: 'coding'}};
  assert.equal(supplementMinimalModelCapability(coding), true);
  assert.deepEqual(coding.tools.alsoAllow, ['pinkie_model_capability']);
  const messaging = {tools: {profile: 'messaging'}};
  assert.equal(supplementMinimalModelCapability(messaging), true);
  assert.deepEqual(messaging.tools.alsoAllow, ['pinkie_model_capability']);
  assert.equal(supplementMinimalModelCapability({tools: {profile: 'minimal', allow: ['read']}}), false);
  assert.equal(supplementMinimalModelCapability({tools: {profile: 'coding', allow: ['read']}}), false);
  assert.equal(supplementMinimalModelCapability({tools: {profile: 'full'}}), false);
});

test('pinkie_model_capability supports current-session model alias and uses committed nextConfig over stale snapshot', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-model-setup-stale-'));
  let stored = {
    agents: {defaults: {model: {primary: 'deepseek/deepseek-chat'}}},
    models: {providers: {deepseek: {baseUrl: 'https://api.deepseek.com', apiKey: KEY, models: [{id: 'deepseek-chat', input: ['text']}]}}},
  };
  const staleSnapshot = structuredClone(stored);
  const setup = createModelSetup({
    stateDir,
    config: {
      // Simulates a runtime whose current() hasn't reloaded yet right after mutateConfigFile
      current: () => staleSnapshot,
      async mutateConfigFile({mutate}) {
        const draft = structuredClone(stored);
        await mutate(draft);
        stored = draft;
        return {nextConfig: structuredClone(stored)};
      },
    },
  });
  const tool = createModelCapabilityTool(setup, {modelProvider: 'deepseek', modelId: 'deepseek-chat'});
  const out = await tool.execute('c-cur', {model: 'current', vision: true});
  assert.equal(out.isError, false);
  assert.equal(out.details.vision, true);
  // RPC wrapper calls setup.list(params || {}) with an empty object; list must ignore RPC params
  assert.equal(setup.list({}).providers.length, 1);
  const res = await setup.setCapability({providerId: 'deepseek', modelId: 'deepseek-chat', vision: false});
  assert.equal(res.providers[0].models[0].vision, false, 'returned list reflects committed nextConfig even if current() is stale');
});

test('laolao-model-setup UI renders per-model vision switches for managed and existing providers and saves toggles', async () => {
  function makeNode(tag) {
    const listeners = new Map();
    const attrs = new Map();
    const children = [];
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      id: '',
      type: '',
      value: '',
      textContent: '',
      hidden: false,
      disabled: false,
      open: false,
      checked: false,
      placeholder: '',
      dataset: {},
      children,
      isConnected: true,
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
      dispatchEvent(ev) { for (const fn of listeners.get(ev.type) || []) fn(ev); },
      appendChild(child) { children.push(child); child.parentElement = node; return child; },
      insertBefore(child, before = null) {
        const idx = before ? children.indexOf(before) : -1;
        if (idx >= 0) children.splice(idx, 0, child);
        else children.push(child);
        child.parentElement = node;
        return child;
      },
      after(child) { if (node.parentElement) node.parentElement.appendChild(child); },
      replaceChildren(...items) { children.length = 0; for (const c of items) node.appendChild(c); },
      remove() { node.isConnected = false; },
      scrollIntoView() {},
      focus() {},
      click() { node.dispatchEvent({type: 'click', preventDefault() {}, stopPropagation() {}}); },
      querySelectorAll(sel) {
        const out = [];
        const walk = cur => {
          for (const ch of cur.children || []) {
            if (sel.startsWith('.') && ch.className.split(/\s+/).includes(sel.slice(1))) out.push(ch);
            if (sel === 'button[role="switch"]' && ch.tagName === 'BUTTON' && ch.getAttribute('role') === 'switch') out.push(ch);
            walk(ch);
          }
        };
        walk(node);
        return out;
      },
    };
    return node;
  }
  const rpcCalls = [];
  let currentList = {
    needsSetup: false,
    defaultModel: 'mm/plain-m',
    providers: [
      {id: 'mm', label: 'mm', enabled: true, managed: false, isDefault: true, modelCount: 1, hasKey: true, keyTail: '••••1234', models: [{id: 'plain-m', name: 'Plain M', vision: false}]},
      {id: 'custom', label: '自配', enabled: true, managed: true, isDefault: false, modelCount: 1, hasKey: true, keyTail: '••••5678', models: [{id: 'vl-m', name: 'VL M', vision: true}]},
    ],
  };
  const windowObj = {
    location: {pathname: '/settings/general', hash: ''},
    sessionStorage: {getItem() { return null; }, setItem() {}, removeItem() {}},
    addEventListener() {},
    dispatchEvent() {},
    CustomEvent: class { constructor(type) { this.type = type; } },
    confirm: () => true,
    __laolaoSidebar: {
      async gwRequest(method, params) {
        rpcCalls.push({method, params});
        if (method === 'pinkie.modelSetup.presets') return {presets: PRESETS};
        if (method === 'pinkie.modelSetup.list') return currentList;
        if (method === 'pinkie.modelSetup.setCapability') {
          currentList = {
            ...currentList,
            providers: currentList.providers.map(p => p.id === params.providerId ? {...p, models: [{...p.models[0], vision: params.vision}]} : p),
          };
          return {ok: true, ...currentList};
        }
        return {ok: true};
      },
    },
  };
  const doc = {
    readyState: 'complete',
    body: makeNode('body'),
    createElement: makeNode,
    addEventListener() {},
    querySelector() { return null; },
    getElementById() { return null; },
  };
  const src = fs.readFileSync(new URL('../ui/injections/laolao-model-setup.js', import.meta.url), 'utf8');
  vm.runInNewContext(src, {window: windowObj, document: doc, location: windowObj.location, CustomEvent: windowObj.CustomEvent, setTimeout, clearTimeout, setInterval, clearInterval, Set, Map, Promise, Error});
  const host = makeNode('div');
  windowObj.__pinkieModelSetup.mount(host);
  await new Promise(r => setTimeout(r, 20));
  const switches = host.querySelectorAll('button[role="switch"]');
  assert.equal(switches.length, 2, 'renders vision switches for both existing and managed providers');
  assert.equal(switches[0].getAttribute('aria-checked'), 'false');
  assert.equal(switches[1].getAttribute('aria-checked'), 'true');
  switches[0].click();
  await new Promise(r => setTimeout(r, 20));
  const capCall = rpcCalls.find(c => c.method === 'pinkie.modelSetup.setCapability');
  assert.deepEqual(JSON.parse(JSON.stringify(capCall?.params)), {providerId: 'mm', modelId: 'plain-m', vision: true});
  const updatedSwitches = host.querySelectorAll('button[role="switch"]');
  assert.equal(updatedSwitches[0].getAttribute('aria-checked'), 'true');
  assert.equal(updatedSwitches[1].getAttribute('aria-checked'), 'true');
});
