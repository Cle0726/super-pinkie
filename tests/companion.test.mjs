import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CompanionAssistant, DEFAULT_COMPANION_MODEL, registerCompanionGateway} from '../services/mode-architecture/companion.mjs';

function fixture(options = {}) {
  const config = {models: {providers: {mm: {api: 'openai-completions', baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'helper-test-key',
    models: [{id: 'gemini-2.5-flash-lite', name: 'Helper Small'}, {id: 'chat-large', name: 'Current Chat'}]},
    other: {api: 'openai-completions', baseUrl: 'http://127.0.0.1:1468/v1', apiKey: 'other-test-key', models: [{id: 'small'}]}},
  }, agents: {defaults: {model: {primary: 'mm/chat-large'}}}};
  const api = {config, runtime: {config: {current: () => config}, agent: new Proxy({}, {
    get() { throw new Error('The companion must never call the chat agent'); },
  })}};
  const assistant = new CompanionAssistant(api, null, options);
  return {api, config, assistant};
}

const reply = text => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({text})}, finish_reason: 'stop'}]}));

test('all helper tasks use a fixed independent model and leave an active chat untouched', async () => {
  const calls = [];
  const {config, assistant} = fixture({fetchImpl: async (url, options) => {
    calls.push({url: String(url), ...options}); return reply('用简单的话解释。');
  }});
  const chat = {modelOverride: 'mm/chat-large', runId: 'running-chat', draft: '写了一半', history: ['PRIVATE_CHAT_SENTINEL']};
  const before = JSON.stringify({chat, config});
  for (const kind of ['explain', 'summary', 'clarify']) {
    const result = await assistant.ask({kind, mode: 'learning', text: 'API', context: '选中的一段话', sessionKey: 'private-session', chat});
    assert.equal(result.model, DEFAULT_COMPANION_MODEL);
    assert.equal(result.independent, true);
    assert.equal(result.text, '用简单的话解释。');
  }
  assert.equal(calls.length, 3);
  for (const request of calls) {
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'gemini-2.5-flash-lite');
    assert.equal(body.stream, false);
    assert.equal(request.redirect, 'error');
    assert.equal(request.url, 'http://127.0.0.1:1467/v1/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer helper-test-key');
    assert.doesNotMatch(request.body, /PRIVATE_CHAT_SENTINEL|private-session|running-chat|chat-large/);
  }
  assert.equal(JSON.stringify({chat, config}), before);
  assert.doesNotMatch(JSON.stringify(assistant.status()), /helper-test-key|baseUrl|1467/);
});

test('unavailable helper model never falls back to the current chat model', async () => {
  let calls = 0;
  const {config, assistant} = fixture({fetchImpl: async () => { calls++; return reply('unexpected'); }});
  config.models.providers.mm.models = [{id: 'chat-large'}];
  assert.equal(assistant.status().available, false);
  await assert.rejects(assistant.ask({kind: 'explain', text: 'API'}), /独立模型暂时不可用/);
  assert.equal(calls, 0);
});

test('explicit helper configuration uses the configured provider without modifying chat configuration', async () => {
  let request;
  const {config, assistant} = fixture({fetchImpl: async (url, options) => { request = {url: String(url), ...options}; return reply('问题正文'); }});
  config.plugins = {entries: {'pinkie-mode-architecture': {config: {companionModel: 'other/small'}}}};
  const before = JSON.stringify(config);
  await assistant.ask({kind: 'clarify', mode: 'project', text: '怎么安排工作'});
  assert.equal(request.url, 'http://127.0.0.1:1468/v1/chat/completions');
  assert.equal(JSON.parse(request.body).model, 'small');
  assert.match(JSON.parse(request.body).messages[0].content, /老板/);
  assert.equal(JSON.stringify(config), before);
});

test('invalid requests, malformed answers and timeouts return errors and release the helper slot', async () => {
  let calls = 0;
  const {assistant} = fixture({fetchImpl: async () => { calls++; return reply(''); }});
  await assert.rejects(assistant.ask({kind: 'send', text: 'hello'}), /不支持/);
  await assert.rejects(assistant.ask({kind: 'summary', text: ''}), /先选择/);
  assert.equal(calls, 0);
  await assert.rejects(assistant.ask({kind: 'summary', text: 'hello'}), /格式/);
  assert.equal(assistant.pending.size, 0);
  const slow = fixture({timeoutMs: 5, fetchImpl: () => new Promise(() => {})}).assistant;
  await assert.rejects(slow.ask({kind: 'explain', text: 'API'}), /超时/);
  assert.equal(slow.pending.size, 0);
});

test('helper input is bounded and methods are admin scoped', async () => {
  let body;
  const {api, assistant} = fixture({fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return reply('结果'); }});
  const methods = new Map();
  registerCompanionGateway({...api, registerGatewayMethod(name, handler, options) {
    assert.equal(options.scope, 'operator.admin'); methods.set(name, handler);
  }}, null, {assistant});
  let result;
  await methods.get('pinkie.companion.ask')({params: {kind: 'explain', text: 'a'.repeat(10_000), context: 'b'.repeat(3000)},
    respond(ok, value) { result = {ok, value}; }});
  assert.equal(result.ok, true);
  const input = JSON.parse(body.messages[1].content).notes[0];
  assert.equal(input.text.length, 8000);
  assert.equal(input.context.length, 1600);
  assert.ok(methods.has('pinkie.companion.status'));
  assert.ok(methods.has('pinkie.companion.settings.set'));
  assert.ok(methods.has('pinkie.companion.test'));
});

test('model and parameters persist per mode, survive restart and can sync to all five modes',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-helper-settings-'));
  try{
    const settingsFile=path.join(root,'settings.json'),{config,assistant}=fixture({settingsFile,fetchImpl:async()=>reply('结果')});
    const before=JSON.stringify(config),settings={model:'other/small',thinking:'auto',temperature:.4,maxTokens:900,timeoutSeconds:60};
    assistant.setSettings({mode:'learning',settings});assert.deepEqual(assistant.status('learning').settings,settings);
    assert.equal(assistant.status('project').model,DEFAULT_COMPANION_MODEL);
    const reloaded=fixture({settingsFile}).assistant;assert.deepEqual(reloaded.status('learning').settings,settings);
    assert.equal(fs.statSync(settingsFile).mode & 0o777,0o600);assert.equal(JSON.stringify(config),before);
    reloaded.setSettings({mode:'learning',settings,allModes:true});
    for(const mode of ['chat','project','thinking','learning','unrestricted'])assert.deepEqual(reloaded.status(mode).settings,settings);
    assert.doesNotMatch(fs.readFileSync(settingsFile,'utf8'),/test-key|baseUrl|chat-large/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('saved parameters reach the selected provider and output remains capped by model capacity',async()=>{
  let request;
  const {config,assistant}=fixture({fetchImpl:async(url,options)=>{request={url:String(url),body:JSON.parse(options.body)};return reply('结果');}});
  config.models.providers.other.models[0]={id:'small',reasoning:true,maxTokens:2000,compat:{maxTokensField:'max_completion_tokens'}};
  assistant.setSettings({mode:'thinking',settings:{model:'other/small',thinking:'high',temperature:.2,maxTokens:3000,timeoutSeconds:80}});
  await assistant.ask({kind:'summary',mode:'thinking',text:'一段回复'});
  assert.equal(request.url,'http://127.0.0.1:1468/v1/chat/completions');assert.equal(request.body.model,'small');
  assert.equal(request.body.reasoning_effort,'high');assert.equal(request.body.temperature,.2);assert.equal(request.body.max_completion_tokens,2000);
  assert.equal(assistant.status('thinking').models.find(model=>model.id==='other/small').thinkingLevels.length,4);
});

test('Responses parameters use their native request fields and a test does not save unsaved settings',async()=>{
  let body;
  const {config,assistant}=fixture({fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({output_text:JSON.stringify({text:'连接正常'})}));}});
  config.models.providers.other.api='openai-responses';config.models.providers.other.models[0].reasoning=true;
  const before=assistant.status('learning').settings;
  const result=await assistant.testConnection({mode:'learning',settings:{model:'other/small',thinking:'low',temperature:.7,maxTokens:800,timeoutSeconds:45}});
  assert.equal(result.ok,true);assert.deepEqual(body.reasoning,{effort:'low'});assert.equal(body.max_output_tokens,800);assert.equal(body.store,false);assert.equal(body.temperature,.7);
  assert.deepEqual(assistant.status('learning').settings,before);
});

test('invalid parameters do not overwrite saved settings and unsupported capabilities are explicit',()=>{
  const {config,assistant}=fixture();
  config.models.providers.other.models[0].compat={supportsTemperature:false,supportsReasoningEffort:false};
  assistant.setSettings({mode:'learning',settings:{model:'other/small'}});const before=assistant.status('learning').settings;
  for(const settings of [{model:'missing/model'},{temperature:2.1},{maxTokens:0},{timeoutSeconds:2},{thinking:'high'},{model:'other/small',temperature:.3}])
    assert.throws(()=>assistant.setSettings({mode:'learning',settings}));
  assert.throws(()=>assistant.setSettings({mode:'invalid',settings:{}}));assert.throws(()=>assistant.setSettings({mode:'learning',settings:[]}));
  assert.deepEqual(assistant.status('learning').settings,before);
  const model=assistant.status('learning').models.find(model=>model.id==='other/small');assert.deepEqual(model.thinkingLevels,['auto']);assert.equal(model.temperatureSupported,false);
});

test('connection failure returns a readable error without changing saved model or leaking credentials',async()=>{
  const {assistant}=fixture({fetchImpl:async()=>{throw new Error('secret: helper-test-key');}});
  assistant.setSettings({mode:'chat',settings:{model:'other/small'}});
  await assert.rejects(assistant.testConnection({mode:'chat',settings:{model:DEFAULT_COMPANION_MODEL}}),error=>{
    assert.match(error.message,/暂时没连上/);assert.doesNotMatch(error.message,/test-key|secret/);return true;
  });
  assert.equal(assistant.status('chat').model,'other/small');assert.equal(assistant.pending.size,0);
});

test('saved waiting time is honored rather than silently falling back to twenty five seconds',async()=>{
  const {assistant}=fixture();let options;
  assistant.transport.requestModel=async(_model,_rules,_notes,_deep,value)=>{options=value;return{text:'结果'};};
  assistant.setSettings({mode:'project',settings:{timeoutSeconds:120}});await assistant.ask({mode:'project',kind:'explain',text:'API'});
  assert.equal(options.timeoutMs,120000);
});
