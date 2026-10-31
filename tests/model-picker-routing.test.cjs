const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(file){const stored=new Map();const window={addEventListener(){},removeEventListener(){},localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)}};const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\}\)\(\);\s*$/,'window.__test={presentationModels,modelFamily,familyTargetModel,modelSelectionPatch,fallbackThinkingLevel,recentModels,rememberModel,extendNativeRange,nativeTierFor,selectionFor,tierChoice,saveTierChoice,chosenTier};})();');vm.runInNewContext(source,{window,document:{addEventListener(){}},requestAnimationFrame(){}});return {api:window.__test,stored};}
const model=(id,contextWindow=128000,extra={})=>({provider:'mm',id,name:id,reasoning:false,input:['text'],contextWindow,...extra});
for(const file of ['ui/injections/laolao-model-picker.js','services/cle-studio/static/legacy/laolao-model-picker.js']){
 test(file+': native Max keeps a distinct custom Ultra and single-level routes keep both enhancements',()=>{const {api,stored}=fixture(file);const details={closest(){return {dataset:{sessionKey:'agent:learning:tiers'}};}};for(const native of ['low,medium,high,xhigh,max','high','off,low,high']){const range={dataset:{chatThinkingValues:native},value:'0',disabled:false};const state=api.extendNativeRange(range,details);const values=range.dataset.chatThinkingValues.split(',');assert.equal(values.filter(v=>v==='max').length,1);assert.equal(values.filter(v=>v==='ultra').length,1);assert.equal(Number(range.max),values.length-1);stored.set('laolao:reasoning-enhance:v1:agent:learning:tiers','ultra');api.extendNativeRange(range,details);assert.equal(Number(range.value),values.indexOf('ultra'));stored.clear();assert.ok(state);}});
 test(file+': context-size variants become one model with exact live route metadata',()=>{const {api}=fixture(file);const models=[model('example-sonnet-5-5',1000000),model('example-sonnet-5-5-low'),model('example-sonnet-5-5-medium'),model('example-sonnet-5-5-high'),model('claude-fable-5'),model('claude-fable-5-1')];const shown=api.presentationModels(models,'mm/example-sonnet-5-5-high');assert.equal(shown.length,3);const family=shown.find(m=>m.family);assert.equal(family.contextWindow,128000);assert.equal(family.sources.length,4);const state={models,session:{modelProvider:'mm',model:'example-sonnet-5-5-high',thinkingLevel:'off'}};assert.equal(api.fallbackThinkingLevel(state),'high');for(const level of ['low','medium','high'])assert.equal(api.familyTargetModel(state,level),`mm/example-sonnet-5-5-${level}`);assert.equal(api.familyTargetModel(state,'ultra'),'mm/example-sonnet-5-5-high');});
 test(file+': known thinking toggles, lite/agent versions and different modalities preserve actual choices',()=>{const {api}=fixture(file);const models=[model('gemini-2.5-flash'),model('gemini-2.5-flash-thinking',1000000,{reasoning:true}),model('gemini-2.5-flash-lite'),model('gemini-2.5-flash-agent'),model('gemini-3.8-flash-low'),model('gemini-3.8-flash-high',1000000,{input:['text','image']})];const shown=api.presentationModels(models);assert.equal(shown.length,5);const state={models,session:{modelProvider:'mm',model:'gemini-2.5-flash'}};assert.equal(api.familyTargetModel(state,'off'),'mm/gemini-2.5-flash');assert.equal(api.familyTargetModel(state,'high'),'mm/gemini-2.5-flash-thinking');});
 test(file+': selecting a family sends the real endpoint and retains original non-family behavior',()=>{const {api}=fixture(file);const models=[model('example-sonnet-5-5',1000000),model('example-sonnet-5-5-low'),model('example-sonnet-5-5-high'),model('plain',128000,{reasoning:true}),model('workbuddy/deepseek-v4.1-flash',1000000,{reasoning:true})];const patch=api.modelSelectionPatch('mm/example-sonnet-5-5','family',models,'high');assert.equal(patch.model,'mm/example-sonnet-5-5-high');assert.equal(patch.thinkingLevel,'off');assert.deepEqual(JSON.parse(JSON.stringify(api.modelSelectionPatch('mm/plain','',models,'high'))),{model:'mm/plain'});assert.deepEqual(JSON.parse(JSON.stringify(api.modelSelectionPatch('mm/workbuddy/deepseek-v4.1-flash','',models,'low'))),{model:'mm/workbuddy/deepseek-v4.1-flash',thinkingLevel:'high',reasoningLevel:'stream'});});
 test(file+': unavailable routes never become family targets and recent storage is limited to six',()=>{const {api,stored}=fixture(file);const models=[model('example-low'),model('example-medium'),model('example-high',128000,{available:false})];const state={models,session:{modelProvider:'mm',model:'example-low'}};assert.equal(api.familyTargetModel(state,'high'),'mm/example-medium');for(let i=0;i<20;i++)api.rememberModel(`mm/model-${i}`);api.rememberModel('mm/model-18');const rows=api.recentModels();assert.equal(rows.length,6);assert.equal(rows[0],'mm/model-18');assert.equal(JSON.parse(stored.get('pinkie:model-picker:recent:v1')).length,6);});
}
for(const file of ['ui/injections/laolao-model-picker.js','services/cle-studio/static/legacy/laolao-model-picker.js']){
 test(file+': fixed binary reasoning routes expose endpoint selection, without pretending to accept native effort',()=>{
  const {api}=fixture(file),models=[model('grok-4.20-0309-non-reasoning',128000,{reasoning:true}),model('grok-4.20-0309-reasoning',128000,{reasoning:true})];
  const state={models,session:{modelProvider:'mm',model:models[1].id}},family=api.modelFamily(models[1],models);
  assert.deepEqual(Array.from(family.endpointLevels),['off','high']);assert.equal(family.flexibleRoute,'');
  assert.equal(api.familyTargetModel(state,'off'),'mm/grok-4.20-0309-non-reasoning');assert.equal(api.familyTargetModel(state,'ultra'),'mm/grok-4.20-0309-reasoning');
  assert.equal(api.modelSelectionPatch('mm/'+models[1].id,family,models,'high').thinkingLevel,'off');
 });
}

for(const file of ['ui/injections/laolao-model-picker.js','services/cle-studio/static/legacy/laolao-model-picker.js']){
 test(file+': all nine visual tiers route only to supported native efforts, retaining custom choices',()=>{
  const {api}=fixture(file),levels=['off','minimal','low','medium','high','xhigh','adaptive','max','ultra'];
  for(const native of [['high'],['off'],['low','medium','high','xhigh','max'],['off','low','high']]){
   for(const tier of levels)assert.ok(native.includes(api.nativeTierFor(tier,native)),tier+' '+native);
  }
  assert.equal(api.nativeTierFor('max',['low','medium','high','xhigh','max']),'max');
  assert.equal(api.nativeTierFor('ultra',['low','medium','high','xhigh','max']),'max');
  assert.equal(api.nativeTierFor('adaptive',['low','medium','high'],'medium'),'medium');
  const state={key:'agent:learning:choice',selectedModel:'mm/fixed',session:{thinkingLevel:'high'}};
  api.saveTierChoice({tier:'low',model:'mm/fixed',backend:'high'},state.key);
  assert.equal(api.chosenTier(state),'low');
  state.session.thinkingLevel='off';assert.equal(api.chosenTier(state),'','external changes supersede stale aliases');
  state.session.thinkingLevel='high';state.selectedModel='mm/other';assert.equal(api.chosenTier(state),'');
 });
}
