import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin,{ModeArchitecture,buildDeliberationPlan,modeForContext} from '../services/mode-architecture/index.mjs';

function workspace(t,label){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-mode-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const dir of ['persona','memory/context','memory/feedback'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'persona/core.md'),`persona-${label}`);
  fs.writeFileSync(path.join(root,'persona/voice_examples.md'),`voice-${label}`);
  fs.writeFileSync(path.join(root,'memory/INDEX.md'),`index-${label}`);
  fs.writeFileSync(path.join(root,'memory/identity.md'),`identity-${label}`);
  fs.writeFileSync(path.join(root,'memory/context/active.md'),`active-${label}`);
  return root;
}

test('existing agent ids map to display modes without renaming agents',()=>{
  assert.equal(modeForContext({agentId:'main'}),'chat');
  assert.equal(modeForContext({sessionKey:'agent:project:abc'}),'project');
  assert.equal(modeForContext({agentId:'thinking'}),'ideas');
  assert.equal(modeForContext({agentId:'unrestricted'}),'none');
  assert.equal(modeForContext({agentId:'ideas'}),null);
});

test('each prompt loads only its runtime workspace persona and memory',t=>{
  const a=workspace(t,'A'),b=workspace(t,'B');
  const runtime=new ModeArchitecture();
  const result=runtime.prompt({prompt:'hello',messages:[]},{agentId:'main',sessionKey:'agent:main:a',workspaceDir:a});
  assert.match(result.appendSystemContext,/persona-A/);
  assert.match(result.appendSystemContext,/index-A/);
  assert.match(result.appendSystemContext,/identity-A/);
  assert.match(result.appendSystemContext,/active-A/);
  assert.doesNotMatch(result.appendSystemContext,/persona-B|index-B/);
  assert.ok(fs.existsSync(b));
});

test('deep-think tiers are bounded and mode-aware',()=>{
  const base=buildDeliberationPlan('base','project');
  assert.match(base,/Planner ×1/);assert.match(base,/Solver ×3~5/);assert.match(base,/Critic ×2~3/);assert.match(base,/Judge ×1/);
  assert.match(base,/不启用六项升级/);assert.match(base,/总派生上限 20/);
  assert.match(buildDeliberationPlan('boost','project'),/真实执行验证.*递归分解/);
  assert.match(buildDeliberationPlan('boost','ideas'),/反批评.*两条独立完整流水线/);
  assert.match(buildDeliberationPlan('boost','none'),/可执行产物优先/);
  const full=buildDeliberationPlan('full','none');
  assert.match(full,/全部六项升级/);assert.match(full,/执行验证仅在存在可验证产物/);assert.match(full,/总派生上限 96/);
});

test('native derivation inherits session and changes labels only, never agent/workspace/model',()=>{
  const runtime=new ModeArchitecture();
  runtime.arm('agent:project:one','base');
  const result=runtime.beforeTool({toolName:'sessions_spawn',params:{task:'x',taskName:'solver_1',label:'求解者',agentId:'other',cwd:'/tmp/other',model:'other/model',thinking:'low',runtime:'acp'}},{agentId:'project',sessionKey:'agent:project:one'});
  assert.equal(result.params.context,'fork');assert.equal(result.params.runtime,'subagent');assert.equal(result.params.mode,'run');
  assert.equal(result.params.label,'求解者');assert.equal(result.params.taskName,'solver_1');
  for(const key of ['agentId','cwd','model','thinking'])assert.equal(key in result.params,false);
});

test('plugin exposes one-shot arm RPC and lifecycle hooks',async()=>{
  const hooks=new Map(),methods=new Map(),queued=[];
  plugin.register({
    on:(name,fn)=>hooks.set(name,fn),
    registerGatewayMethod:(name,fn,opts)=>methods.set(name,{fn,opts}),
    session:{workflow:{enqueueNextTurnInjection:async value=>{queued.push(value);return {enqueued:true,id:'x',sessionKey:value.sessionKey};}}},
  });
  for(const name of ['before_prompt_build','before_tool_call','subagent_spawned','subagent_ended','before_compaction','after_compaction'])assert.ok(hooks.has(name));
  assert.equal(methods.get('pinkie.deepThink.arm').opts.scope,'operator.admin');
  let response;
  await methods.get('pinkie.deepThink.arm').fn({params:{sessionKey:'agent:thinking:one',tier:'boost'},respond:(...args)=>{response=args;}});
  assert.equal(response[0],true);assert.equal(response[1].mode,'ideas');assert.equal(queued.length,1);assert.match(queued[0].text,/反批评/);
});
