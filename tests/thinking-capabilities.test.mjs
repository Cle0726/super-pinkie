import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {transform,transformModelUtils,transformCompletions} from '../patch/apply-thinking-capabilities.mjs';
const original='function resolveThinkingProfile(params) {const context = resolveThinkingPolicyContext(params); return {levels:[{id:"off"}]};}';
function profile(model){const c={resolveThinkingPolicyContext:v=>v,normalizeThinkLevel:v=>v==='none'?'off':['off','minimal','low','medium','high','xhigh','adaptive','max','ultra'].includes(v)?v:undefined,THINKING_LEVEL_RANKS:{off:0,minimal:1,low:2,medium:3,high:4,xhigh:5,adaptive:6,max:7,ultra:8}};vm.runInNewContext(transform(original)+';this.profile=resolveThinkingProfile;',c);return c.profile(model);}
test('custom providers follow exact explicit capabilities, retaining native Max and removing invented levels',()=>{
 const p=profile({reasoning:true,compat:{supportedReasoningEfforts:['low','medium','high','xhigh','max']}});assert.deepEqual(Array.from(p.levels,l=>l.id),['low','medium','high','xhigh','max']);assert.equal(p.defaultLevel,'medium');
 const binary=profile({reasoning:true,compat:{supportedReasoningEfforts:['high']}});assert.deepEqual(Array.from(binary.levels,l=>l.id),['high']);
 const off=profile({reasoning:true,compat:{supportedReasoningEfforts:['none','low']}});assert.equal(off.levels[0].id,'off');
});
test('false reasoning and invalid declarations cannot fabricate native support; patch is idempotent',()=>{assert.equal(profile({reasoning:false,compat:{supportedReasoningEfforts:['high']}}).levels[0].id,'off');assert.equal(profile({reasoning:true,compat:{supportedReasoningEfforts:['invented']}}).levels[0].id,'off');assert.equal(transform(transform(original)),transform(original));assert.throws(()=>transform('changed'),/变化/);});
test('configured fixed routes with absent reasoning metadata do not advertise discarded efforts',()=>{
 const p=profile({provider:'mm',model:'fixed-preview',catalog:[{provider:'mm',id:'fixed-preview'}]});
 assert.deepEqual(Array.from(p.levels,l=>l.id),['off']);
});

test('SDK capability clamping preserves explicitly declared XHigh and Max',()=>{
 const source='function getSupportedThinkingLevels(model) { const thinkingLevelMap = resolveThinkingLevelMap(model); return ["off","high"]; } function clampThinkingLevel() {}';
 const context={resolveThinkingLevelMap:model=>model.thinkingLevelMap,EXTENDED_THINKING_LEVELS:['off','minimal','low','medium','high','xhigh','max','ultra']};
 const patched=transformModelUtils(source);vm.runInNewContext(patched+';this.levels=getSupportedThinkingLevels;',context);
 assert.deepEqual(Array.from(context.levels({compat:{supportedReasoningEfforts:['low','medium','high','xhigh','max']}})),['low','medium','high','xhigh','max']);
 assert.deepEqual(Array.from(context.levels({compat:{supportedReasoningEfforts:['none','low','xhigh']},thinkingLevelMap:{xhigh:null}})),['off','low']);
 assert.equal(transformModelUtils(patched),patched);
});
test('SDK sends native Max and explicit none without breaking legacy custom Max',()=>{
 const source='function payload(model,clampedReasoning) { const reasoningEffort = clampedReasoning === "off" ? void 0 : clampedReasoning === "max" ? "xhigh" : clampedReasoning; const offValue = model.thinkingLevelMap?.off; return clampedReasoning === "off" ? offValue : reasoningEffort; }';
 const patched=transformCompletions(source),context={};vm.runInNewContext(patched+';this.payload=payload;',context);
 assert.equal(context.payload({compat:{supportedReasoningEfforts:['high','xhigh','max']}},'max'),'max');
 assert.equal(context.payload({},'max'),'xhigh');
 assert.equal(context.payload({compat:{supportedReasoningEfforts:['none','low']}},'off'),'none');
 assert.equal(context.payload({compat:{supportedReasoningEfforts:['none']},thinkingLevelMap:{off:'disabled'}},'off'),'disabled');
 assert.equal(transformCompletions(patched),patched);
});
