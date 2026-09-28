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

test('sync refuses an unencrypted non-local endpoint before sending credentials', async () => {
  let fetched = false;
  const sync = createModelSynchronizer({runtime: {config: {
    current: () => ({models: {providers: {mm: {baseUrl: 'http://example.com/v1', apiKey: 'secret', models: []}}}}),
  }}}, {fetchImpl: async () => { fetched = true; throw new Error('must not fetch'); }});
  await assert.rejects(sync.sync(), /不安全/);
  assert.equal(fetched, false);
});
