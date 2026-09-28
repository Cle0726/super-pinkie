import test from 'node:test';
import assert from 'node:assert/strict';
import {chatModelIds, createModelSynchronizer, newModelEntries} from '../services/mode-architecture/model-sync.mjs';

test('only chat IDs enter the model catalog, with duplicates removed', () => {
  assert.deepEqual(chatModelIds({data: [
    {id: 'gemini-3.1-pro-high'}, {id: 'gemini-3.1-pro-high'},
    {id: 'grok-imagine-video'}, {id: 'gpt-image-2'}, {id: 'veo-3.1-generate-preview'},
    {id: 'bad/id'}, {id: 'gemini-2.5-flash-lite'},
  ]}), ['gemini-3.1-pro-high', 'gemini-2.5-flash-lite']);
});

test('new effort endpoint inherits known sibling capabilities without modifying it', () => {
  const current = [{id: 'gemini-3.1-pro-low', name: 'Gemini Pro', reasoning: true,
    input: ['text', 'image'], contextWindow: 1000000, compat: {supportedReasoningEfforts: ['low', 'high']}}];
  const [added] = newModelEntries(current, ['gemini-3.1-pro-low', 'gemini-3.1-pro-high']);
  assert.equal(added.id, 'gemini-3.1-pro-high');
  assert.deepEqual(added.input, ['text', 'image']);
  added.input.pop();
  assert.deepEqual(current[0].input, ['text', 'image']);
});

test('verified clekk GPT-6 gets slider capabilities while an unverified provider stays conservative', () => {
  const [unknown] = newModelEntries([], ['gpt-6-sol']);
  assert.equal(unknown.name, 'GPT-6 Sol');
  assert.equal(unknown.reasoning, false);
  assert.equal(unknown.compat, undefined);
  const [verified] = newModelEntries([], ['gpt-6-sol'], {verifiedGpt6: true});
  assert.equal(verified.reasoning, true);
  assert.deepEqual(verified.compat.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh']);
});

test('sync adds upstream models once, preserves configured entries, and does not expose the key', async () => {
  const original = {id: 'gemini-2.5-flash', name: 'Custom name', contextWindow: 1000000,
    input: ['text', 'image'], reasoning: true, compat: {supportedReasoningEfforts: ['low', 'high']}};
  const config = {models: {providers: {mm: {baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'test-secret', models: [original]}}}};
  let writes = 0;
  let requested;
  const api = {runtime: {config: {
    current: () => config,
    async mutateConfigFile({base, afterWrite, mutate}) {
      assert.equal(base, 'source');
      assert.deepEqual(afterWrite, {mode: 'auto'});
      writes++;
      mutate(config);
      return {result: undefined};
    },
  }}};
  const fetchImpl = async (url, options) => {
    requested = {url: String(url), auth: options.headers.Authorization};
    return new Response(JSON.stringify({data: [
      {id: 'gemini-2.5-flash'}, {id: 'gemini-2.5-flash-thinking'},
      {id: 'gemini-2.5-flash-lite'}, {id: 'gpt-image-2'},
    ]}), {status: 200});
  };
  const sync = createModelSynchronizer(api, {fetchImpl});
  assert.equal((await sync.sync()).added, 2);
  assert.equal(requested.url, 'http://127.0.0.1:1467/v1/models');
  assert.equal(requested.auth, 'Bearer test-secret');
  assert.equal(writes, 1);
  assert.equal(config.models.providers.mm.models[0], original);
  assert.deepEqual(config.models.providers.mm.models.map((model) => model.id), [
    'gemini-2.5-flash', 'gemini-2.5-flash-thinking', 'gemini-2.5-flash-lite',
  ]);
  assert.equal((await sync.sync({force: true})).added, 0);
  assert.equal(writes, 1);
});

test('failed upstream fetch never mutates local models', async () => {
  const config = {models: {providers: {mm: {baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'secret', models: []}}}};
  let writes = 0;
  const sync = createModelSynchronizer({runtime: {config: {
    current: () => config,
    mutateConfigFile: () => { writes++; },
  }}}, {fetchImpl: async () => new Response('no', {status: 503})});
  await assert.rejects(sync.sync(), /503/);
  assert.equal(writes, 0);
});

test('sync also follows the configured clekk catalog without inventing GPT-6 entries', async () => {
  const config = {models: {providers: {
    mm: {baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'mm-secret', models: []},
    clekk: {baseUrl: 'http://127.0.0.1:54395/v1', apiKey: 'clekk-secret', models: [
      {id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', input: ['text'], contextWindow: 128000},
    ]},
  }}};
  const api = {runtime: {config: {
    current: () => config,
    async mutateConfigFile({mutate}) { mutate(config); },
  }}};
  const fetchImpl = async (url) => new Response(JSON.stringify({data: String(url).includes('54395')
    ? [{id: 'gpt-5.6-sol'}, {id: 'gpt-5.6-luna'}, {id: 'gpt-image-2'}]
    : [{id: 'gemini-3.8-flash-tiered'}]}), {status: 200});
  const result = await createModelSynchronizer(api, {fetchImpl}).sync();
  assert.equal(result.providers.clekk.added, 1);
  assert.equal(result.providers.mm.added, 1);
  assert.deepEqual(config.models.providers.clekk.models.map((model) => model.id),
    ['gpt-5.6-sol', 'gpt-5.6-luna']);
  assert.equal(config.models.providers.clekk.models.some((model) => model.id.startsWith('gpt-6')), false);
});

test('sync upgrades only its old clekk GPT-6 placeholders, preserving custom and other-provider entries', async () => {
  const placeholder = (id) => ({id, name: `GPT 6 ${id.split('-').at(-1)[0].toUpperCase()}${id.split('-').at(-1).slice(1)}`,
    reasoning: false, input: ['text'], contextWindow: 128000, contextTokens: 128000});
  const custom = {...placeholder('gpt-6-luna'), name: 'My Luna'};
  const config = {models: {providers: {
    mm: {baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'mm-secret', models: [placeholder('gpt-6-sol')]},
    clekk: {baseUrl: 'http://127.0.0.1:54395/v1', apiKey: 'clekk-secret',
      models: [placeholder('gpt-6-sol'), custom]},
  }}};
  let writes = 0;
  const api = {runtime: {config: {
    current: () => config,
    async mutateConfigFile({mutate}) { writes++; mutate(config); },
  }}};
  const fetchImpl = async () => new Response(JSON.stringify({data: [
    {id: 'gpt-6-sol'}, {id: 'gpt-6-luna'},
  ]}), {status: 200});
  const result = await createModelSynchronizer(api, {fetchImpl}).sync();
  assert.equal(result.added, 1);
  assert.equal(result.upgraded, 1);
  assert.equal(writes, 1);
  assert.equal(config.models.providers.mm.models[0].reasoning, false);
  assert.equal(config.models.providers.clekk.models[0].name, 'GPT-6 Sol');
  assert.equal(config.models.providers.clekk.models[0].reasoning, true);
  assert.deepEqual(config.models.providers.clekk.models[0].compat.supportedReasoningEfforts,
    ['low', 'medium', 'high', 'xhigh']);
  assert.equal(config.models.providers.clekk.models[1].name, 'My Luna');
  assert.equal(config.models.providers.clekk.models[1].reasoning, false);
});

test('one unavailable provider does not block a healthy provider catalog', async () => {
  const config = {models: {providers: {
    mm: {baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'mm-secret', models: []},
    clekk: {baseUrl: 'http://127.0.0.1:54395/v1', apiKey: 'clekk-secret', models: []},
  }}};
  const sync = createModelSynchronizer({runtime: {config: {
    current: () => config,
    async mutateConfigFile({mutate}) { mutate(config); },
  }}}, {fetchImpl: async (url) => String(url).includes('1467')
    ? new Response('unavailable', {status: 503})
    : new Response(JSON.stringify({data: [{id: 'gpt-5.6-sol'}]}), {status: 200})});
  const result = await sync.sync();
  assert.equal(result.failed, 1);
  assert.equal(result.providers.clekk.added, 1);
  assert.deepEqual(config.models.providers.clekk.models.map((model) => model.id), ['gpt-5.6-sol']);
});

test('sync refuses an unencrypted non-local endpoint before sending credentials', async () => {
  let fetched = false;
  const sync = createModelSynchronizer({runtime: {config: {
    current: () => ({models: {providers: {mm: {baseUrl: 'http://example.com/v1', apiKey: 'secret', models: []}}}}),
  }}}, {fetchImpl: async () => { fetched = true; throw new Error('must not fetch'); }});
  await assert.rejects(sync.sync(), /不安全/);
  assert.equal(fetched, false);
});
