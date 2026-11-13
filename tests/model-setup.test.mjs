// 小白配模型（设定防护 B）：预设、测试连接说人话、保存只动白名单键、密钥不外露。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createModelSetup, cleanKey, explainFailure, PRESETS} from '../services/mode-architecture/model-setup.mjs';

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
