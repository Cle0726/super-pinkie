const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sources = ['ui/injections/laolao-model-picker.js', 'services/cle-studio/static/legacy/laolao-model-picker.js'];
const settle = () => new Promise(setImmediate);
function harness(source) {
  let key = 'agent:main:A', now = 10000, busy = true;
  const requests = [], listeners = new Map(), stored = new Map();
  const browser = {querySelectorAll: () => [], querySelector: () => null};
  const details = {open: true, isConnected: true, dataset: {},
    closest: () => ({dataset: {sessionKey: key}}),
    matches: (selector) => selector.includes('details.chat-controls__model'),
    querySelector: (selector) => selector === '.chat-controls__model-browser' ? browser : null,
    setAttribute() {}, removeAttribute() {}, toggleAttribute() {},
  };
  const window = {localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {}, dispatchEvent() {},
    __laolaoSidebar: {async gwRequest(method, params) {
      requests.push({method, params});
      if (method === 'chat.metadata') return {models: [{provider: 'mm', id: 'gemini-test', name: 'Gemini Test'}]};
      if (method === 'sessions.list') return {sessions: [{key, model: 'gemini-test', modelProvider: 'mm', hasActiveRun: busy, thinkingLevel: 'low', thinkingOptions: ['low', 'high']}]};
      return {};
    }},
  };
  const document = {addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(listener); }};
  const sourceText = fs.readFileSync(path.join(__dirname, '..', source), 'utf8').replace(/\}\)\(\);\s*$/, 'window.__test={scheduleAutoSave,persistPending,ensureFallbackData,refreshFallbackSession,fallbackStates,pendingPatches,pickerState,saveTierChoice,chosenTier};})();');
  vm.runInNewContext(sourceText, {window, document, requestAnimationFrame() {}, Event,
    Date: class extends Date { static now() { return now; } }, MutationObserver: class { observe() {} disconnect() {} }});
  return {api: window.__test, requests, details, browser, window, stored, setKey(value) { key = value; }, setBusy(value) { busy = value; },
    tick(ms = 1000) { now += ms; }, toggle() { listeners.get('toggle').forEach((listener) => listener({target: details})); }};
}
for (const source of sources) {
  test(`${source}: changing sessions before debounce cannot write the old selection into the new session`, async () => {
    const h = harness(source);
    h.api.scheduleAutoSave(h.details, {model: 'mm/picked-in-A', thinkingLevel: 'high'});
    h.setKey('agent:main:B');
    assert.equal(await h.api.persistPending(h.details), false);
    assert.equal(h.requests.length, 0);
    h.api.scheduleAutoSave(h.details, {model: 'mm/picked-in-B'});
    assert.equal(await h.api.persistPending(h.details), true);
    const request = h.requests.find((entry) => entry.method === 'sessions.patch');
    assert.equal(request.params.key, 'agent:main:B');
    assert.equal(request.params.model, 'mm/picked-in-B');
    assert.equal(request.params.thinkingLevel, undefined, 'A settings cannot be merged into B');
  });
  test(`${source}: a save already in flight remains tied to its original session`, async () => {
    const h = harness(source);
    let finishA;
    h.window.__laolaoSidebar.gwRequest = (method, params) => {
      h.requests.push({method, params});
      return params.key === 'agent:main:A' ? new Promise((resolve) => { finishA = resolve; }) : Promise.resolve({});
    };
    h.api.scheduleAutoSave(h.details, {model: 'mm/picked-in-A'});
    const saveA = h.api.persistPending(h.details);
    await settle();
    h.setKey('agent:main:B');
    h.api.scheduleAutoSave(h.details, {model: 'mm/picked-in-B'});
    const saveB = h.api.persistPending(h.details);
    finishA({}); await Promise.all([saveA, saveB]);
    assert.deepEqual(h.requests.map(({params}) => [params.key, params.model]), [
      ['agent:main:A', 'mm/picked-in-A'], ['agent:main:B', 'mm/picked-in-B'],
    ]);
  });
  test(`${source}: opening again refreshes active-run state once without refetching models or per-render requests`, async () => {
    const h = harness(source);
    const state = h.api.ensureFallbackData(h.details, h.browser);
    await settle();
    assert.equal(state.session.hasActiveRun, true);
    assert.equal(h.requests.filter((entry) => entry.method === 'sessions.list').length, 1);
    h.setBusy(false); h.tick(); h.toggle(); h.toggle();
    await settle();
    assert.equal(state.session.hasActiveRun, false, 'completed run unlocks the recovered model rows');
    assert.equal(h.requests.filter((entry) => entry.method === 'sessions.list').length, 2, 'coalesce a repeated open while a refresh is active');
    for (let i = 0; i < 30; i++) h.api.ensureFallbackData(h.details, h.browser);
    await settle();
    assert.equal(h.requests.filter((entry) => entry.method === 'sessions.list').length, 2, 'surface and stream syncs do not fetch session state');
    assert.equal(h.requests.filter((entry) => entry.method === 'chat.metadata').length, 1);
  });
}

for(const source of sources){
 test(source+': a failed compatibility choice restores the previous UI choice as well as the native session',async()=>{
  const h=harness(source),key='agent:main:A';
  const state={key,selectedModel:'mm/only-high',session:{thinkingLevel:'high'},models:[]};
  h.api.fallbackStates.set(h.details,state);h.api.saveTierChoice({tier:'high',model:state.selectedModel,backend:'high'},key);
  h.api.pickerState(h.details,null);h.api.saveTierChoice({tier:'low',model:state.selectedModel,backend:'high'},key);
  h.window.__laolaoSidebar.gwRequest=async()=>{throw Error('save failed');};
  h.api.scheduleAutoSave(h.details,{thinkingLevel:'high'});assert.equal(await h.api.persistPending(h.details),false);
  assert.equal(h.api.chosenTier(state),'high');
 });
}
