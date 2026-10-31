import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const {ReasoningEnhancer,ReviewStore,nativeLevels,recipeFor}=await import(pathToFileURL(process.env.PINKIE_TEST_REASONING || path.join(repo,'services/mode-architecture/reasoning.mjs')));
function picker(file){
  const window={addEventListener(){},localStorage:{getItem(){return null;}}};
  const source=fs.readFileSync(file,'utf8').replace(/\}\)\(\);\s*$/,'window.qa={presentationModels,modelFamily,familyTargetModel,modelSelectionPatch,selectionFor};})();');
  vm.runInNewContext(source,{window,document:{addEventListener(){}},requestAnimationFrame(){}});return window.qa;
}
const record=(id,provider='mm')=>({provider,id,name:id,reasoning:false,input:['text'],contextWindow:128000});
const variants=base=>[record(base),...['low','medium','high'].map(level=>record(base+'-'+level))];
for(const file of [process.env.PINKIE_TEST_MODEL_PICKER || path.join(repo,'ui/injections/laolao-model-picker.js'),path.join(repo,'services/cle-studio/static/legacy/laolao-model-picker.js')]){
  const ui=picker(file);
  test(path.basename(path.dirname(file))+': both Claude pools survive, only At levels fold together',()=>{
    for(const base of ['claude-sonnet-5-5','claude-opus-5-5']){
      const models=variants(base),shown=ui.presentationModels(models);
      assert.equal(shown.length,2);
      const account=shown.find(m=>m.id===base),at=shown.find(m=>m.family);
      assert.ok(account);assert.equal(account.name,base);assert.equal(account.family,null);
      assert.match(at.name,/ ·At$/);assert.equal(at.sources.length,3);assert.equal(at.sources.includes('mm/'+base),false);
      assert.deepEqual(Array.from(at.family.endpointLevels),['low','medium','high']);
      const state={models,session:{modelProvider:'mm',model:base+'-medium'},selectedModel:'mm/'+base+'-medium'};
      for(const [tier,endpoint] of Object.entries({off:'low',minimal:'low',low:'low',medium:'medium',high:'high',xhigh:'high',max:'high',ultra:'high'})){
        assert.equal(ui.familyTargetModel(state,tier),'mm/'+base+'-'+endpoint);
        const wire=ui.modelSelectionPatch('mm/'+at.id,at.family,models,tier);
        assert.equal(wire.model,'mm/'+base+'-'+endpoint);assert.equal(wire.thinkingLevel,'off');
      }
      assert.equal(ui.familyTargetModel({...state,session:{modelProvider:'mm',model:base}},'ultra'),'','Account pool never hops into At');
    }
    const sameId=ui.presentationModels([record('claude-sonnet-5-5'),record('claude-sonnet-5-5','antigravity')]);
    assert.equal(sameId.length,2,'Identical names on distinct upstream pools stay separate');
    assert.equal(sameId.filter(m=>/ ·At$/.test(m.name)).length,1);
  });
}
test('effective At effort differs from the adapter parameter; all custom tiers keep their recipes',async()=>{
  const ui=picker(process.env.PINKIE_TEST_MODEL_PICKER || path.join(repo,'ui/injections/laolao-model-picker.js'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-at-routing-'));
  try{
    for(const base of ['claude-sonnet-5-5','claude-opus-5-5']){
      const models=variants(base);
      for(const level of ['off','minimal','low','medium','high','xhigh','adaptive','max','ultra']){
        const state={models,session:{modelProvider:'mm',model:base+'-medium'}};
        const target=ui.familyTargetModel(state,level),selected=target.slice(3),entry={providerOverride:'mm',modelOverride:base+'-medium'};
        const calls=[],key='agent:learning:'+base+'-'+level;
        const api={config:{agents:{defaults:{model:'mm/'+base,workspace:root}},models:{providers:{mm:{models}}}},runtime:{agent:{session:{getSessionEntry:()=>entry},runEmbeddedAgent:async params=>{
          calls.push(params);return {payloads:[{text:/独立解题助手/.test(params.prompt)?'42':'{"pass":true,"issues":[]}'}]};
        }}}};
        const engine=new ReasoningEnhancer(api,{store:new ReviewStore(path.join(root,base+'-'+level))});
        const result=await engine.prepare({sessionKey:key,requestId:'at-route-'+base+'-'+level,level,message:'你好'});
        assert.equal(result.thinkingLevel,'off');
        if(result.model)entry.modelOverride=result.model.slice(3);
        if(level!=='adaptive')assert.equal(entry.modelOverride,selected,'Client and backend choose the same source endpoint');
        const expected={off:['down','low'],minimal:['down','low'],low:['native','low'],medium:['native','medium'],high:['native','high'],xhigh:['up','high'],adaptive:['adaptive','low'],max:['enhanced','high'],ultra:['enhanced','high']}[level];
        assert.equal(result.recipe.kind,expected[0]);assert.equal(result.recipe.native,expected[1]);
        assert.equal(result.recipe.solvers,({xhigh:1,max:2,ultra:3})[level]||0);
        if(['xhigh','max','ultra'].includes(level)){
          engine.beforePromptBuild({prompt:'你好',messages:[]},{sessionKey:key,agentId:'learning'});
          await engine.agentEnded({success:true,messages:[{role:'assistant',content:'42'}]},{sessionKey:key,agentId:'learning'});
          assert.equal(calls.length,result.recipe.solvers+1);
          for(const call of calls){assert.equal(call.model,base+'-high');assert.equal(call.provider,'mm');assert.equal(call.thinkLevel,'off');}
        }
        engine.cancel({sessionKey:key});
      }
      const entry={providerOverride:'mm',modelOverride:base+'-low'};
      const api={config:{agents:{defaults:{model:'mm/'+base}},models:{providers:{mm:{models}}}},runtime:{agent:{session:{getSessionEntry:()=>entry}}}};
      const engine=new ReasoningEnhancer(api,{store:new ReviewStore(path.join(root,base+'-adaptive-hard'))});
      const hard=await engine.prepare({sessionKey:'agent:learning:hard-'+base,requestId:'hard-'+base,level:'adaptive',message:'请证明并计算这个逻辑方程，检查代码报错'});
      assert.equal(hard.model,'mm/'+base+'-high');assert.equal(hard.thinkingLevel,'off');assert.equal(hard.recipe.as,'xhigh');assert.equal(hard.recipe.solvers,1);
      assert.deepEqual(nativeLevels(record(base)),['off']);
      assert.equal(recipeFor('ultra',record(base)).native,'off','The account pool retains its original custom logic');
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
