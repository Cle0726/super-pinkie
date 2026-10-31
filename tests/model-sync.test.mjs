import test from 'node:test';
import assert from 'node:assert/strict';
import {chatModelIds, createModelSynchronizer, newModelEntries} from '../services/mode-architecture/model-sync.mjs';

test('only chat IDs enter the model catalog, with duplicates removed', () => {
  assert.deepEqual(chatModelIds({data: [
    {id: 'gemini-3.1-pro-high'}, {id: 'gemini-3.1-pro-high'},
    {id: 'grok-imagine-video'}, {id: 'gpt-image-2'}, {id: 'veo-3.1-generate-preview'},
    {id: 'bad//id'}, {id: 'gemini-2.5-flash-lite'},
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
  assert.deepEqual(verified.input, ['text', 'image']);
  assert.deepEqual(verified.compat.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
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
      {id: 'gemini-2.5-flash-lite'}, {id: 'gpt-image-2'}, {id: 'workbuddy/glm-5.3'},
    ]}), {status: 200});
  };
  const sync = createModelSynchronizer(api, {fetchImpl});
  assert.equal((await sync.sync()).added, 3);
  assert.equal(requested.url, 'http://127.0.0.1:1467/v1/models');
  assert.equal(requested.auth, 'Bearer test-secret');
  assert.equal(writes, 1);
  assert.equal(config.models.providers.mm.models[0], original);
  assert.deepEqual(config.models.providers.mm.models.map((model) => model.id), [
    'gemini-2.5-flash', 'gemini-2.5-flash-thinking', 'gemini-2.5-flash-lite', 'workbuddy/glm-5.3',
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
  assert.deepEqual(config.models.providers.clekk.models[0].input, ['text', 'image']);
  assert.deepEqual(config.models.providers.clekk.models[0].compat.supportedReasoningEfforts,
    ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(config.models.providers.clekk.models[1].name, 'My Luna');
  assert.equal(config.models.providers.clekk.models[1].reasoning, false);
});

test('sync adds image input only to its exact prior clekk GPT-6 entries', async () => {
  const current = (id) => ({id, name: id === 'gpt-6-sol' ? 'GPT-6 Sol' : 'My Astra',
    reasoning: true, input: ['text'], contextWindow: 128000, contextTokens: 128000,
    compat: {supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh']}});
  const config = {models: {providers: {
    clekk: {baseUrl: 'http://127.0.0.1:54395/v1', apiKey: 'secret',
      models: [current('gpt-6-sol'), current('gpt-6-astra')]},
  }}};
  let writes = 0;
  const sync = createModelSynchronizer({runtime: {config: {
    current: () => config,
    async mutateConfigFile({mutate}) { writes++; mutate(config); },
  }}}, {fetchImpl: async () => new Response(JSON.stringify({data: [
    {id: 'gpt-6-sol'}, {id: 'gpt-6-astra'},
  ]}), {status: 200})});
  const result = await sync.sync();
  assert.equal(result.upgraded, 1);
  assert.equal(writes, 1);
  assert.deepEqual(config.models.providers.clekk.models[0].input, ['text', 'image']);
  assert.deepEqual(config.models.providers.clekk.models[1].input, ['text']);
  assert.equal((await sync.sync({force: true})).upgraded, 0);
  assert.equal(writes, 1);
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


test('namespaced upstream IDs keep their full routing path and reject malformed IDs and media', () => {
  assert.deepEqual(chatModelIds({data: [
    {id: 'workbuddy/glm-5.3'}, {id: 'workbuddy/glm-5.3'}, {id: 'workbuddy/hy3-x'},
    {id: '../glm-5.3'}, {id: 'workbuddy/../glm-5.3'}, {id: '/workbuddy/glm-5.3'},
    {id: 'workbuddy//glm-5.3'}, {id: 'workbuddy/glm-5.3/'}, {id: 'workbuddy/gpt-image-2'},
    {id: 'workbuddy/image'}, {id: 'x'.repeat(129)},
  ]}), ['workbuddy/glm-5.3', 'workbuddy/hy3-x']);
  const [entry] = newModelEntries([], ['workbuddy/glm-5.3']);
  assert.equal(entry.id, 'workbuddy/glm-5.3');
  assert.equal(entry.name, 'GLM 5.3');
  assert.equal(newModelEntries([], ['workbuddy/deepseek-v4-pro'])[0].name, 'DeepSeek V4 Pro · WB');
  assert.equal(entry.reasoning, false, 'ID alone does not prove parameter support');
});

test('explicit upstream windows initialize new models and ignore output-only metadata', async () => {
  const config = {models:{providers:{mm:{baseUrl:'http://127.0.0.1:1467/v1',apiKey:'secret',models:[]}}}};
  const payload = {data:[{id:'workbuddy/deepseek-v4.1-flash',context_window:1000000,max_output_tokens:128000},
    {id:'workbuddy/glm-5.3',context_length:1000000},
    {id:'workbuddy/kimi-k2.7',contextWindow:256000},
    {id:'workbuddy/hy3',maxInputTokens:192000,maxOutputTokens:64000}]};
  const sync = createModelSynchronizer({runtime:{config:{current:()=>config,
    async mutateConfigFile({mutate}){mutate(config);}}}},
    {fetchImpl:async()=>new Response(JSON.stringify(payload))});
  const result = await sync.sync();
  assert.equal(result.added,4);
  assert.deepEqual(config.models.providers.mm.models.map(m=>[m.contextWindow,m.contextTokens]),
    [[1000000,1000000],[1000000,1000000],[256000,256000],[128000,128000]]);
  assert.equal(config.models.providers.mm.models[0].maxTokens,undefined,'output budget is not silently changed');
});

test('sync refreshes existing windows by exact provider and namespace and is idempotent', async () => {
  const entry = {id:'workbuddy/deepseek-v4.1-flash',name:'DeepSeek custom · WB',contextWindow:128000,
    contextTokens:128000,reasoning:true,input:['text','image'],maxTokens:32768,compat:{custom:true}};
  const config = {agents:{defaults:{contextTokens:1000000}},models:{providers:{
    mm:{baseUrl:'http://127.0.0.1:1467/v1',apiKey:'secret',models:[structuredClone(entry),
      {...entry,id:'deepseek-v4.1-flash'}]},
    clekk:{baseUrl:'http://127.0.0.1:54395/v1',apiKey:'other',models:[structuredClone(entry)]}}}};
  const before=structuredClone(config);let writes=0;
  const sync=createModelSynchronizer({runtime:{config:{current:()=>config,
    async mutateConfigFile({mutate}){writes++;mutate(config);}}}},
    {fetchImpl:async url=>new Response(JSON.stringify({data:[{id:entry.id,
      ...(String(url).includes('1467')?{context_window:1000000}: {})}]}))});
  const result=await sync.sync();
  assert.equal(result.contextUpdated,1);
  assert.equal(result.providers.mm.contextUpdated,1);
  assert.deepEqual(config.models.providers.mm.models[0],{...entry,contextWindow:1000000,contextTokens:1000000});
  assert.deepEqual(config.models.providers.mm.models[1],before.models.providers.mm.models[1]);
  assert.deepEqual(config.models.providers.clekk,before.models.providers.clekk);
  assert.deepEqual(config.agents,before.agents);
  assert.equal((await sync.sync({force:true})).contextUpdated,0);
  assert.equal(writes,1);
});

test('invalid windows are ignored and conflicting declarations choose the smaller limit', async () => {
  const models=['missing','zero','negative','fraction','huge','string','conflict','duplicate'].map(id=>
    ({id,contextWindow:128000,contextTokens:128000}));
  const config={models:{providers:{mm:{baseUrl:'http://localhost:1467/v1',apiKey:'secret',models}}}};
  const rows=[{id:'missing',max_output_tokens:1000000},{id:'zero',context_window:0},
    {id:'negative',context_window:-1},{id:'fraction',context_window:1.5},
    {id:'huge',context_window:1e15},{id:'string',context_window:'1000000'},
    {id:'conflict',context_window:1000000,context_length:256000},
    {id:'duplicate',context_window:1000000},{id:'duplicate',context_window:192000},
    {id:'gpt-image-2',context_window:1000000}];
  const sync=createModelSynchronizer({runtime:{config:{current:()=>config,
    async mutateConfigFile({mutate}){mutate(config);}}}},
    {fetchImpl:async()=>new Response(JSON.stringify({data:rows}))});
  const result=await sync.sync();assert.equal(result.contextUpdated,2);
  assert.deepEqual(models.map(m=>m.contextWindow),[128000,128000,128000,128000,128000,128000,256000,192000]);
  assert.equal(result.added,0);
});

test('context sync respects a concurrent config edit while updating unaffected models', async () => {
  const models=[{id:'a',contextWindow:128000,contextTokens:128000},{id:'b',contextWindow:128000,contextTokens:128000}];
  const config={models:{providers:{mm:{baseUrl:'http://localhost:1467/v1',apiKey:'secret',models}}}};
  const sync=createModelSynchronizer({runtime:{config:{current:()=>config,
    async mutateConfigFile({mutate}){models[0].contextTokens=64000;mutate(config);}}}},
    {fetchImpl:async()=>new Response(JSON.stringify({data:[{id:'a',context_window:1000000},{id:'b',context_window:256000}]}))});
  const result=await sync.sync();assert.equal(result.contextUpdated,1);
  assert.equal(models[0].contextTokens,64000);
  assert.equal(models[0].contextWindow,128000);
  assert.equal(models[1].contextTokens,256000);
});

test('known WorkBuddy reasoning models get verified high support only on the local mm route',()=>{
  const [known]=newModelEntries([],['workbuddy/glm-5.3'],{verifiedWorkBuddy:true});
  assert.equal(known.reasoning,true);
  assert.deepEqual(known.compat,{supportsReasoningEffort:true,supportedReasoningEfforts:['high']});
  assert.equal(newModelEntries([],['workbuddy/glm-5.3'])[0].reasoning,false,'an arbitrary provider is not verified');
  assert.equal(newModelEntries([],['workbuddy/auto'],{verifiedWorkBuddy:true})[0].reasoning,false);
});

test('existing automatic WorkBuddy placeholders gain reasoning while custom capabilities stay untouched',async()=>{
  const placeholder=newModelEntries([],['workbuddy/deepseek-v4.1-flash'])[0];
  placeholder.contextWindow=1000000;placeholder.contextTokens=1000000;
  const custom={...structuredClone(placeholder),id:'workbuddy/glm-5.3',name:'My GLM'};
  const config={models:{providers:{mm:{baseUrl:'http://localhost:1467/v1',apiKey:'secret',models:[placeholder,custom]},
    other:{baseUrl:'http://localhost:12345/v1',apiKey:'secret',models:[structuredClone(placeholder)]}}}};
  const sync=createModelSynchronizer({runtime:{config:{current:()=>config,
    async mutateConfigFile({mutate}){mutate(config);}}}},
    {fetchImpl:async()=>new Response(JSON.stringify({data:[{id:placeholder.id},{id:custom.id}]}))});
  const result=await sync.sync();
  assert.equal(result.providers.mm.upgraded,1);
  assert.equal(config.models.providers.mm.models[0].reasoning,true);
  assert.deepEqual(config.models.providers.mm.models[0].compat.supportedReasoningEfforts,['high']);
  assert.equal(config.models.providers.mm.models[0].contextTokens,1000000);
  assert.equal(config.models.providers.mm.models[1].reasoning,false);
  assert.equal(config.models.providers.other.models[0].reasoning,false);
  assert.equal((await sync.sync({force:true})).upgraded,0);
});


test('all default clekk GPT native profiles recover exact levels including 6.1 Sol and Mini', async()=>{
 const entries=['gpt-6.1-sol','gpt-5.4-mini','gpt-5.4','gpt-5.5'].map(id=>({id,name:id.replace('gpt-','GPT-').replace(/-mini$/,' Mini').replace(/-sol$/,' Sol'),reasoning:id==='gpt-5.4'||id==='gpt-5.5',input:['text'],contextWindow:1100000,contextTokens:1100000}));
 const config={models:{providers:{clekk:{baseUrl:'http://127.0.0.1:49684/v1',apiKey:'fixture',models:entries}}}};
 const api={runtime:{config:{current:()=>config,mutateConfigFile:async({mutate})=>mutate(config)}}};
 const sync=createModelSynchronizer(api,{fetchImpl:async()=>new Response(JSON.stringify({data:entries.map(({id})=>({id}))}))});
 assert.equal((await sync.sync()).upgraded,4);
 for(const model of config.models.providers.clekk.models){
  assert.equal(model.reasoning,true);
  assert.deepEqual(model.compat.supportedReasoningEfforts,model.id==='gpt-6.1-sol'?['low','medium','high','xhigh','max']:['none','low','medium','high','xhigh']);
 }
 assert.equal((await sync.sync({force:true})).upgraded,0);
});

test('explicit upstream effort metadata is honored without replacing a custom capability declaration',async()=>{
 const custom={id:'custom',name:'Custom model',reasoning:true,compat:{supportedReasoningEfforts:['high']}};
 const config={models:{providers:{fixture:{baseUrl:'https://example.invalid/v1',apiKey:'fixture',models:[custom,{id:'new-known',name:'New Known',reasoning:false}]}}}};
 const api={runtime:{config:{current:()=>config,mutateConfigFile:async({mutate})=>mutate(config)}}};
 const payload={data:[{id:'custom',reasoning_efforts:['low','max']},{id:'new-known',capabilities:{reasoning:{efforts:['medium','high','max']}}},{id:'discovered',supported_reasoning_efforts:['LOW','HIGH']}]};
 await createModelSynchronizer(api,{fetchImpl:async()=>new Response(JSON.stringify(payload))}).sync();
 const models=config.models.providers.fixture.models;assert.deepEqual(custom.compat.supportedReasoningEfforts,['high']);
 assert.deepEqual(models.find(m=>m.id==='new-known').compat.supportedReasoningEfforts,['medium','high','max']);
 assert.deepEqual(models.find(m=>m.id==='discovered').compat.supportedReasoningEfforts,['low','high']);
});
