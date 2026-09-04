import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin,{FileRunStore,ModeArchitecture,ModelUsageLedger,TierContinuation,UpstreamWatchdog,buildDeliberationPlan,deliberationRequirements,isTransientFailure,modeForContext} from '../services/mode-architecture/index.mjs';

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
  const marathon=buildDeliberationPlan('marathon','project');
  assert.match(marathon,/无人值守的长时任务/);assert.match(marathon,/主代理在子代理工作时继续/);
  assert.match(marathon,/pinkie-longrun-complete/);assert.match(marathon,/总派生上限 512/);
  assert.match(base,/后端硬验收/);assert.match(full,/真实验证×2/);assert.match(marathon,/反批评×3/);
  assert.match(base,/交付契约/);assert.match(base,/不得把两者一律写成研究报告/);
  assert.match(full,/主代理必须继续调用真实工具完成修改\/产物并运行验证/);
  assert.match(base,/不得汇报角色数量、流水线、打回轮次或审议过程/);
  assert.doesNotMatch(base,/报告实际使用的角色数/);
  assert.deepEqual(deliberationRequirements('base','project').roles,{planner:1,solver:3,critic:2,judge:1});
  assert.equal(deliberationRequirements('boost','none').dynamicUpgradeKinds,2);
});

function completeRole(runtime,ctx,role,count){
  for(let i=0;i<count;i+=1){
    const child=`${ctx.sessionKey}:subagent:${role}-${i}`;
    runtime.spawned({childSessionKey:child,label:`${role} ${i}`,mode:'run',agentId:ctx.agentId,runId:`run-${role}-${i}`},{requesterSessionKey:ctx.sessionKey});
    runtime.ended({targetSessionKey:child,targetKind:'subagent',reason:'completed',outcome:'ok'});
  }
}

test('every tier blocks a prose-only answer until real child runs complete',()=>{
  for(const tier of ['base','boost','full','marathon']){
    const runtime=new ModeArchitecture();const ctx={agentId:'project',sessionKey:`agent:project:${tier}`,runId:`run-${tier}`};
    runtime.arm(ctx.sessionKey,tier);
    const gate=runtime.finalize({lastAssistantMessage:'几位角色已经分析完毕。'},ctx);
    assert.equal(gate.action,'revise');assert.match(gate.reason,/真实调用未达标/);
    assert.ok(gate.retry.maxAttempts>=5);
  }
});

test('base tier needs completed planner solvers critics and judge, not spawn attempts',()=>{
  const runtime=new ModeArchitecture();const ctx={agentId:'project',sessionKey:'agent:project:gated',runId:'gated'};
  runtime.arm(ctx.sessionKey,'base');
  const pending=`${ctx.sessionKey}:subagent:pending`;
  runtime.spawned({childSessionKey:pending,label:'规划 1',mode:'run',agentId:'project',runId:'pending'},{requesterSessionKey:ctx.sessionKey});
  assert.match(runtime.finalize({lastAssistantMessage:'done'},ctx).reason,/等待中的子任务 1/);
  runtime.ended({targetSessionKey:pending,targetKind:'subagent',reason:'failed',outcome:'error'});
  for(const [role,count] of Object.entries({planner:1,solver:3,critic:2,judge:1}))completeRole(runtime,ctx,role,count);
  assert.equal(runtime.finalize({lastAssistantMessage:'真实完成'},ctx),undefined);
});

test('child completion reconciliation is idempotent when both lifecycle events arrive',()=>{
  const runtime=new ModeArchitecture(),ctx={agentId:'project',sessionKey:'agent:project:idempotent'};
  runtime.arm(ctx.sessionKey,'base');
  const child=`${ctx.sessionKey}:subagent:planner`;
  runtime.spawned({childSessionKey:child,label:'规划·1'}, {requesterSessionKey:ctx.sessionKey});
  runtime.ended({targetSessionKey:child,outcome:'ok'});
  runtime.ended({targetSessionKey:child,outcome:'ok'});
  const status=runtime.status(ctx.sessionKey);
  assert.equal(status.completedRoles.planner,1);assert.equal(status.pending,0);
  assert.equal(status.required,7);assert.equal(status.completed,1);
  assert.equal(status.phase,'waiting');assert.equal(status.roles.find(role=>role.role==='planner').label,'规划');
});

test('child results are collected once and returned to the parent as candidate evidence',t=>{
  const root=workspace(t,'evidence');
  const runtime=new ModeArchitecture(),ctx={agentId:'project',sessionKey:'agent:project:evidence'};
  runtime.arm(ctx.sessionKey,'base');
  const child=`${ctx.sessionKey}:subagent:planner`;
  runtime.spawned({childSessionKey:child,label:'规划·1'}, {requesterSessionKey:ctx.sessionKey});
  runtime.ended({targetSessionKey:child,outcome:'ok'});
  runtime.ended({targetSessionKey:child,outcome:'ok',resultText:'先读取项目，再按验收清单执行。'});
  const status=runtime.status(ctx.sessionKey);
  const prompt=runtime.prompt({prompt:'继续'}, {...ctx,workspaceDir:root});
  assert.equal(status.completedRoles.planner,1);assert.equal(status.collectedResults,1);
  assert.match(prompt.appendSystemContext,/已完成子任务的候选证据/);
  assert.match(prompt.appendSystemContext,/先读取项目，再按验收清单执行/);
});

test('full tier requires all six upgrade families to finish',()=>{
  const runtime=new ModeArchitecture();const ctx={agentId:'project',sessionKey:'agent:project:full-gate',runId:'full-gate'};
  runtime.arm(ctx.sessionKey,'full');
  for(const [role,count] of Object.entries(deliberationRequirements('full','project').roles))completeRole(runtime,ctx,role,count);
  assert.equal(runtime.finalize({lastAssistantMessage:'全部完成'},ctx),undefined);
});

test('completed tier audit remains queryable after the parent turn ends',()=>{
  const runtime=new ModeArchitecture();const ctx={agentId:'project',sessionKey:'agent:project:audit',runId:'audit'};
  runtime.arm(ctx.sessionKey,'base');
  for(const [role,count] of Object.entries(deliberationRequirements('base','project').roles))completeRole(runtime,ctx,role,count);
  assert.equal(runtime.status(ctx.sessionKey).active,true);
  runtime.finishTurn(ctx,{success:true,lastAssistantMessage:'成品已经完成并验证通过。'});
  const status=runtime.status(ctx.sessionKey);
  assert.equal(status.active,false);assert.equal(status.complete,true);assert.equal(status.completedRoles.solver,3);
  assert.equal(status.completed,status.required);assert.equal(status.phase,'done');assert.ok(status.endedAt>0);
});

test('a completed role audit cannot end on sessions_yield or an empty parent turn',()=>{
  const runtime=new ModeArchitecture();const ctx={agentId:'project',sessionKey:'agent:project:needs-final',runId:'needs-final'};
  runtime.arm(ctx.sessionKey,'base');
  for(const [role,count] of Object.entries(deliberationRequirements('base','project').roles))completeRole(runtime,ctx,role,count);
  runtime.finishTurn(ctx,{success:true,messages:[{role:'assistant',stopReason:'toolUse',content:[{type:'text',text:'等待子任务完成。'}]}]});
  assert.equal(runtime.status(ctx.sessionKey).active,true);
  runtime.finishTurn(ctx,{success:true,lastAssistantMessage:''});
  assert.equal(runtime.status(ctx.sessionKey).active,true);
  runtime.finishTurn(ctx,{success:true,lastAssistantMessage:'已完成实际交付。'});
  assert.equal(runtime.status(ctx.sessionKey).active,false);
});

test('arming cannot overwrite a tier run that is still active',()=>{
  const runtime=new ModeArchitecture();const sessionKey='agent:project:no-overlap';
  runtime.arm(sessionKey,'base');
  assert.throws(()=>runtime.arm(sessionKey,'full'),/上一轮档位任务仍在执行/);
  assert.equal(runtime.status(sessionKey).tier,'base');
});

test('a late tier fallback becomes silent after the real final was delivered',t=>{
  const root=workspace(t,'stale-control');
  const runtime=new ModeArchitecture();const ctx={agentId:'project',sessionKey:'agent:project:stale-control'};
  runtime.arm(ctx.sessionKey,'base');
  for(const [role,count] of Object.entries(deliberationRequirements('base','project').roles))completeRole(runtime,ctx,role,count);
  runtime.finishTurn(ctx,{success:true,lastAssistantMessage:'成品已交付。'});
  const prompt=runtime.prompt({prompt:'[pinkie-tier-control] 迟到的内部续跑'}, {...ctx,workspaceDir:root});
  assert.match(prompt.appendSystemContext,/过期内部续跑指令/);
  assert.match(prompt.appendSystemContext,/只输出 NO_REPLY/);
  assert.doesNotMatch(prompt.appendSystemContext,/极致思考运行单/);
});

test('tier audit survives separate plugin instances through the durable store',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-run-store-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const parent='agent:unrestricted:durable',ctx={agentId:'unrestricted',sessionKey:parent};
  const armed=new ModeArchitecture(new FileRunStore(root));armed.arm(parent,'base');
  const spawning=new ModeArchitecture(new FileRunStore(root));
  const adjusted=spawning.beforeTool({toolName:'sessions_spawn',params:{task:'plan',label:'plan-1'}},ctx);
  assert.equal(adjusted.params.label,'规划·1');
  spawning.modelStarted({sessionKey:parent,provider:'mm',model:'gemini-3.6-flash-high'});
  assert.equal(spawning.beforeTool({toolName:'sessions_spawn',params:{task:'solve',label:'solve-1'}},ctx).params.model,'mm/gemini-3.6-flash-high');
  const child='agent:unrestricted:subagent:durable';
  spawning.spawned({childSessionKey:child,label:'规划·1',resolvedModel:'mm/gemini-3.6-flash-high'},{requesterSessionKey:parent});
  const ending=new ModeArchitecture(new FileRunStore(root));ending.ended({targetSessionKey:child,outcome:'ok'});
  const status=new ModeArchitecture(new FileRunStore(root)).status(parent);
  assert.equal(status.spawned,1);assert.equal(status.completedRoles.planner,1);assert.equal(status.pending,0);
  assert.deepEqual(status.childModels,{'mm/gemini-3.6-flash-high':1});assert.equal(status.modelMismatches,0);
});

test('native derivation inherits agent/workspace and only passes the current resolved model',()=>{
  const runtime=new ModeArchitecture();
  runtime.arm('agent:project:one','base');
  const result=runtime.beforeTool({toolName:'sessions_spawn',params:{task:'x',taskName:'solver_1',label:'求解者',agentId:'other',cwd:'/tmp/other',model:'other/model',thinking:'low',runtime:'acp'}},{agentId:'project',sessionKey:'agent:project:one'});
  assert.equal(result.params.context,'fork');assert.equal(result.params.runtime,'subagent');assert.equal(result.params.mode,'run');
  assert.equal(result.params.expectsCompletionMessage,false);
  assert.equal(result.params.label,'求解·1');assert.equal(result.params.taskName,'solver_1');
  for(const key of ['agentId','cwd','model','thinking'])assert.equal(key in result.params,false);
});

test('explicit role label wins over role words mentioned inside the task body',()=>{
  const runtime=new ModeArchitecture();
  runtime.arm('agent:project:role-priority','base');
  const result=runtime.beforeTool({toolName:'sessions_spawn',params:{
    label:'solve-2',taskName:'solver_2',task:'提出方案，并说明如何验证以及如何回应批评。',
  }},{agentId:'project',sessionKey:'agent:project:role-priority'});
  assert.equal(result.params.label,'求解·2');
});

test('repeated role labels receive unique ordinals before OpenClaw stores them',()=>{
  const runtime=new ModeArchitecture(),ctx={agentId:'unrestricted',sessionKey:'agent:unrestricted:labels',runId:'run'};
  runtime.arm(ctx.sessionKey,'full');
  const first=runtime.beforeTool({toolName:'sessions_spawn',toolCallId:'a',runId:'run',params:{label:'多轮对抗',task:'x'}},ctx);
  const second=runtime.beforeTool({toolName:'sessions_spawn',toolCallId:'b',runId:'run',params:{label:'多轮对抗',task:'y'}},ctx);
  assert.equal(first.params.label,'多轮对抗·1');assert.equal(second.params.label,'多轮对抗·2');
});

test('backend caps both live concurrency and duplicate role fan-out',()=>{
  const runtime=new ModeArchitecture(),ctx={agentId:'unrestricted',sessionKey:'agent:unrestricted:bounded'};
  runtime.arm(ctx.sessionKey,'full');
  completeRole(runtime,ctx,'planner',1);
  const duplicate=runtime.beforeTool({toolName:'sessions_spawn',params:{label:'规划·2',task:'again'}},ctx);
  assert.equal(duplicate.block,true);assert.match(duplicate.blockReason,/不要重复派生/);
  for(let i=0;i<5;i+=1){
    const child=`${ctx.sessionKey}:subagent:pending-${i}`;
    runtime.spawned({childSessionKey:child,label:`求解·${i+1}`},{requesterSessionKey:ctx.sessionKey});
  }
  const overflow=runtime.beforeTool({toolName:'sessions_spawn',params:{label:'批评·1',task:'critic'}},ctx);
  assert.equal(overflow.block,true);assert.match(overflow.blockReason,/5 个子任务/);
});

test('parallel spawn calls reserve slots before child lifecycle events arrive',()=>{
  const runtime=new ModeArchitecture(),ctx={agentId:'unrestricted',sessionKey:'agent:unrestricted:reserved',runId:'run'};
  runtime.arm(ctx.sessionKey,'full');
  for(let i=0;i<5;i+=1){
    const allowed=runtime.beforeTool({toolName:'sessions_spawn',toolCallId:`call-${i}`,runId:'run',params:{label:`未分类${i}`,task:'x'}},ctx);
    assert.equal(allowed.block,undefined);
  }
  const blocked=runtime.beforeTool({toolName:'sessions_spawn',toolCallId:'call-5',runId:'run',params:{label:'未分类5',task:'x'}},ctx);
  assert.equal(blocked.block,true);assert.equal(runtime.status(ctx.sessionKey).reserved,5);
  runtime.afterTool({toolName:'sessions_spawn',toolCallId:'call-0',runId:'run'},ctx);
  assert.equal(runtime.status(ctx.sessionKey).reserved,4);
});

test('the full tier plan is reloaded only for the parent, never recursively for children',t=>{
  const root=workspace(t,'unrestricted');
  const storeRoot=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-parent-only-'));
  t.after(()=>fs.rmSync(storeRoot,{recursive:true,force:true}));
  const runtime=new ModeArchitecture(new FileRunStore(storeRoot));
  const parent='agent:unrestricted:parent-only';
  runtime.arm(parent,'full');
  const child=`${parent}:subagent:child`;
  runtime.spawned({childSessionKey:child,label:'求解·1'},{requesterSessionKey:parent});
  const parentPrompt=runtime.prompt({prompt:'继续'}, {agentId:'unrestricted',sessionKey:parent,workspaceDir:root});
  const childPrompt=runtime.prompt({prompt:'执行分工'}, {agentId:'unrestricted',sessionKey:child,workspaceDir:root});
  assert.match(parentPrompt.appendSystemContext,/极致思考运行单/);
  assert.doesNotMatch(childPrompt.appendSystemContext,/极致思考运行单/);
});

test('plugin exposes persistent arm/disarm RPC and lifecycle hooks',async()=>{
  const hooks=new Map(),methods=new Map(),queued=[];
  plugin.register({
    on:(name,fn)=>hooks.set(name,fn),
    registerGatewayMethod:(name,fn,opts)=>methods.set(name,{fn,opts}),
    // Some compatible OpenClaw builds resolve a successful enqueue with no
    // payload; the control RPC must still stay usable in that case.
    session:{workflow:{enqueueNextTurnInjection:async value=>{queued.push(value);}}},
  });
  for(const name of ['before_prompt_build','before_tool_call','after_tool_call','subagent_spawned','subagent_ended','before_compaction','after_compaction','before_agent_finalize','model_call_started','model_call_ended','llm_output','agent_end'])assert.ok(hooks.has(name));
  assert.equal(methods.get('pinkie.deepThink.arm').opts.scope,'operator.admin');
  assert.equal(methods.get('pinkie.deepThink.disarm').opts.scope,'operator.admin');
  assert.equal(methods.get('pinkie.deepThink.status').opts.scope,'operator.admin');
  let response;
  await methods.get('pinkie.deepThink.arm').fn({params:{sessionKey:'agent:thinking:one',tier:'boost'},respond:(...args)=>{response=args;}});
  assert.equal(response[0],true);assert.equal(response[1].armed,true);assert.equal(response[1].mode,'ideas');assert.equal(queued.length,1);assert.match(queued[0].text,/反批评/);
  await methods.get('pinkie.deepThink.disarm').fn({params:{sessionKey:'agent:thinking:one'},respond:(...args)=>{response=args;}});
  assert.equal(response[0],true);assert.equal(response[1].disarmed,true);
});

test('marathon tier keeps revising until it completes or genuinely needs user input',()=>{
  const runtime=new ModeArchitecture();const ctx={agentId:'project',sessionKey:'agent:project:overnight',runId:'run-1'};
  runtime.arm(ctx.sessionKey,'marathon');
  const retry=runtime.finalize({lastAssistantMessage:'完成了第一阶段，接下来继续。'},ctx);
  assert.equal(retry.action,'revise');assert.equal(retry.retry.maxAttempts,64);
  for(const [role,count] of Object.entries(deliberationRequirements('marathon','project').roles))completeRole(runtime,ctx,role,count);
  assert.equal(runtime.finalize({lastAssistantMessage:'全部验证通过。\n<!-- pinkie-longrun-complete -->'},ctx),undefined);
  assert.equal(runtime.finalize({lastAssistantMessage:'需要用户提供新权限。\n<!-- pinkie-longrun-pause -->'},ctx),undefined);
});

test('upstream watchdog retries transient failures invisibly and ignores explicit cancellation',async()=>{
  const scheduled=[],injected=[],removed=[];
  const watchdog=new UpstreamWatchdog({session:{workflow:{
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
    unscheduleSessionTurnsByTag:async value=>{removed.push(value);return {removed:0,failed:0};},
    scheduleSessionTurn:async value=>{scheduled.push(value);return {id:'retry'};},
  }}});
  watchdog.modelEnded({runId:'r1',outcome:'error',failureKind:'connection_reset'});
  await watchdog.agentEnded({runId:'r1',success:false,error:'upstream network failed'},{agentId:'project',sessionKey:'agent:project:one'});
  assert.equal(injected.length,1);assert.match(injected[0].text,/已经完成.+禁止重复/);
  assert.equal(scheduled.length,1);assert.equal(scheduled[0].message,'\u2063');assert.equal(scheduled[0].deliveryMode,'none');
  assert.equal(removed[0].tag,scheduled[0].tag);
  await watchdog.agentEnded({runId:'r2',success:false,error:'user aborted'},{agentId:'project',sessionKey:'agent:project:one'});
  assert.equal(scheduled.length,1);
  assert.equal(isTransientFailure('connection_closed'),true);assert.equal(isTransientFailure('invalid api key'),false);
  assert.equal(isTransientFailure('AbortError after connection_closed'),true);
  assert.equal(isTransientFailure('This operation was aborted'),true);
  assert.equal(isTransientFailure('incomplete turn without a final reply'),true);
  assert.equal(isTransientFailure('session file changed while embedded prompt lock was released: /tmp/session.jsonl'),true);
  assert.equal(isTransientFailure('EmbeddedAttemptSessionTakeoverError'),true);
  assert.equal(isTransientFailure('cancelled by user'),false);
  assert.equal(isTransientFailure('user aborted'),false);
});

test('watchdog recovers an aborted provider run even when agent_end has no top-level error',async()=>{
  const scheduled=[],injected=[];
  const watchdog=new UpstreamWatchdog({session:{workflow:{
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
    unscheduleSessionTurnsByTag:async()=>({removed:0}),
    scheduleSessionTurn:async value=>{scheduled.push(value);return {id:'retry'};},
  }}});
  watchdog.modelEnded({runId:'provider-abort',outcome:'aborted',stopReason:'aborted'});
  const retried=await watchdog.agentEnded({runId:'provider-abort',success:false},{agentId:'project',sessionKey:'agent:project:provider-abort'});
  assert.equal(retried,true);assert.equal(injected.length,1);assert.equal(scheduled.length,1);

  const messageOnly=new UpstreamWatchdog({session:{workflow:{
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
    unscheduleSessionTurnsByTag:async()=>({removed:0}),
    scheduleSessionTurn:async value=>{scheduled.push(value);return {id:'retry-2'};},
  }}});
  const fromMessage=await messageOnly.agentEnded({success:false,messages:[{
    role:'assistant',content:[],stopReason:'aborted',errorMessage:'Request was aborted.',
  }]},{agentId:'unrestricted',sessionKey:'agent:unrestricted:message-abort'});
  assert.equal(fromMessage,true);assert.equal(injected.length,2);assert.equal(scheduled.length,2);
});

test('watchdog resumes a failed tool-use turn that has no top-level error text',async()=>{
  const scheduled=[],injected=[];
  const watchdog=new UpstreamWatchdog({session:{workflow:{
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
    unscheduleSessionTurnsByTag:async()=>({removed:0}),
    scheduleSessionTurn:async value=>{scheduled.push(value);return {id:'retry'};},
  }}});
  const retried=await watchdog.agentEnded({success:false,messages:[
    {role:'assistant',content:[{type:'toolCall',name:'write'}],stopReason:'toolUse'},
    {role:'toolResult',toolName:'write',content:[{type:'text',text:'Successfully wrote file'}]},
  ]},{agentId:'project',sessionKey:'agent:project:tool-use-gap'});
  assert.equal(retried,true);assert.equal(injected.length,1);assert.equal(scheduled.length,1);
  assert.match(injected[0].text,/工具结果已经返回/);assert.match(injected[0].text,/禁止重复/);
});

test('watchdog reads structured incomplete-turn errors from agent_end',async()=>{
  const injected=[];
  const watchdog=new UpstreamWatchdog({session:{workflow:{
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
    unscheduleSessionTurnsByTag:async()=>({removed:0}),
    scheduleSessionTurn:async()=>({id:'retry'}),
  }}});
  const retried=await watchdog.agentEnded({success:false,error:{
    kind:'incomplete_turn',message:"Agent couldn't generate a response.",
  }},{agentId:'thinking',sessionKey:'agent:thinking:structured-gap'});
  assert.equal(retried,true);assert.equal(injected.length,1);
});

test('watchdog defaults unknown failed turns and context overflow to recovery',async()=>{
  const injected=[];
  const workflow={
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
    unscheduleSessionTurnsByTag:async()=>({removed:0}),scheduleSessionTurn:async()=>({id:'retry'}),
  };
  const watchdog=new UpstreamWatchdog({session:{workflow}});
  assert.equal(await watchdog.agentEnded({success:false,error:'unclassified provider failure'},
    {agentId:'main',sessionKey:'agent:main:unknown'}),true);
  assert.equal(await watchdog.agentEnded({success:false,error:'Context overflow: prompt too large for the model'},
    {agentId:'project',sessionKey:'agent:project:overflow'}),true);
  assert.equal(injected.length,2);
});

test('watchdog resumes custom-agent sessions by default, with an opt-out for legacy mode-only hosts',async()=>{
  const injected=[];
  const workflow={
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
    unscheduleSessionTurnsByTag:async()=>({removed:0}),scheduleSessionTurn:async()=>({id:'retry'}),
  };
  const watchdog=new UpstreamWatchdog({session:{workflow}});
  const custom={agentId:'local-llm',sessionKey:'agent:local-llm:api-drop'};
  assert.equal(await watchdog.agentEnded({success:false,error:'socket hang up'},custom),true);
  assert.equal(injected.length,1);
  const previous=process.env.PINKIE_WATCHDOG_ALL;
  process.env.PINKIE_WATCHDOG_ALL='0';
  try {
    assert.equal(await watchdog.agentEnded({success:false,error:'socket hang up'},
      {agentId:'local-llm',sessionKey:'agent:local-llm:legacy'}),false);
  } finally {
    if (previous === undefined) delete process.env.PINKIE_WATCHDOG_ALL;
    else process.env.PINKIE_WATCHDOG_ALL=previous;
  }
});

test('watchdog never loops permanent configuration failures',async()=>{
  const injected=[];
  const watchdog=new UpstreamWatchdog({session:{workflow:{
    enqueueNextTurnInjection:async value=>{injected.push(value);},
    unscheduleSessionTurnsByTag:async()=>({removed:0}),scheduleSessionTurn:async()=>({id:'retry'}),
  }}});
  assert.equal(await watchdog.agentEnded({success:false,error:'Unknown model: removed/model'},
    {agentId:'main',sessionKey:'agent:main:bad-model'}),false);
  assert.equal(await watchdog.agentEnded({success:false,error:'invalid API key'},
    {agentId:'main',sessionKey:'agent:main:bad-key'}),false);
  assert.equal(injected.length,0);
});

test('marathon watchdog keeps a delayed cron fallback while manual cancellation still wins',async()=>{
  const scheduled=[];
  const api={session:{workflow:{
    enqueueNextTurnInjection:async()=>({enqueued:true}),unscheduleSessionTurnsByTag:async()=>({removed:0}),
    scheduleSessionTurn:async value=>{scheduled.push(value);return {id:'retry'};},
  }}};
  const watchdog=new UpstreamWatchdog(api,()=> 'marathon');
  await watchdog.agentEnded({success:false,error:'network timeout'},{agentId:'main',sessionKey:'agent:main:cron:night'});
  assert.equal(scheduled[0].delayMs,90000);
  await watchdog.cancel('agent:main:cron:night',true);
  await watchdog.agentEnded({success:false,error:'This operation was aborted'},{agentId:'main',sessionKey:'agent:main:cron:night'});
  assert.equal(scheduled.length,1);
});

test('online watchdog uses the authenticated local CLI and removes its cron fallback',async()=>{
  const calls=[],removed=[];
  const api={session:{workflow:{unscheduleSessionTurnsByTag:async value=>{removed.push(value);return {removed:1};}}}};
  const runner=async(file,args,options)=>{calls.push({file,args,options});return {stdout:'{"status":"started","runId":"next"}',stderr:''};};
  const watchdog=new UpstreamWatchdog(api,()=>'',runner,'/runtime/openclaw/dist/index.js');
  assert.equal(await watchdog.dispatchImmediate({
    sessionKey:'agent:project:one',agentId:'project',runId:'failed-run',attempt:1,tag:'pinkie-watchdog-test',
  }),true);
  assert.equal(calls.length,1);assert.equal(calls[0].file,process.execPath);
  assert.deepEqual(calls[0].args.slice(1,4),['gateway','call','chat.send']);
  const params=JSON.parse(calls[0].args[calls[0].args.indexOf('--params')+1]);
  assert.equal(params.sessionKey,'agent:project:one');assert.equal(params.agentId,'project');
  assert.equal(params.message,'\u2063');assert.equal(params.deliver,false);
  assert.match(params.idempotencyKey,/failed-run-1$/);assert.equal(calls[0].options.timeout,20000);
  assert.deepEqual(removed,[{sessionKey:'agent:project:one',tag:'pinkie-watchdog-test'}]);
});

test('watchdog waits for child announcements and a quiet session fence before retrying',async t=>{
  const calls=[];
  let activity={pending:2,quietForMs:0};
  const runner=async()=>{calls.push('sent');return {stdout:'{"status":"started","runId":"next"}',stderr:''};};
  const api={session:{workflow:{unscheduleSessionTurnsByTag:async()=>({removed:1})}}};
  const watchdog=new UpstreamWatchdog(api,()=> 'full',runner,'/runtime/openclaw/dist/index.js',()=>activity);
  t.after(()=>void watchdog.cancel('agent:project:fence'));
  assert.equal(await watchdog.dispatchImmediate({sessionKey:'agent:project:fence',agentId:'project',runId:'failed',attempt:1,tag:'fence'}),false);
  assert.equal(calls.length,0);assert.equal(watchdog.timers.has('agent:project:fence'),true);
  clearTimeout(watchdog.timers.get('agent:project:fence'));watchdog.timers.delete('agent:project:fence');
  activity={pending:0,quietForMs:900};
  assert.equal(await watchdog.dispatchImmediate({sessionKey:'agent:project:fence',agentId:'project',runId:'failed',attempt:1,tag:'fence'}),false);
  assert.equal(calls.length,0);
  clearTimeout(watchdog.timers.get('agent:project:fence'));watchdog.timers.delete('agent:project:fence');
  activity={pending:0,quietForMs:4_000};
  assert.equal(await watchdog.dispatchImmediate({sessionKey:'agent:project:fence',agentId:'project',runId:'failed',attempt:1,tag:'fence'}),true);
  assert.equal(calls.length,1);
});

test('both retry paths refuse to write while the parent model run is active',async t=>{
  const calls=[];
  const runner=async()=>{calls.push('sent');return {stdout:'{"status":"started"}',stderr:''};};
  const api={session:{workflow:{unscheduleSessionTurnsByTag:async()=>({removed:1}),scheduleSessionTurn:async()=>({id:'fallback'})}}};
  const watchdog=new UpstreamWatchdog(api,()=> 'full',runner,'/runtime/openclaw/dist/index.js',()=>({parentRunning:true,pending:0,quietForMs:20_000}));
  t.after(()=>void watchdog.cancel('agent:project:busy'));
  assert.equal(await watchdog.dispatchImmediate({sessionKey:'agent:project:busy',agentId:'project',runId:'failed',attempt:1,tag:'busy'}),false);
  clearTimeout(watchdog.timers.get('agent:project:busy'));watchdog.timers.delete('agent:project:busy');
  const continuation=new TierContinuation(api,()=>({active:true,complete:false,pending:0,parentRunning:true}),()=>({parentRunning:true,pending:0,quietForMs:20_000}),runner,'/runtime/openclaw/dist/index.js');
  assert.equal(await continuation.schedule('agent:project:busy','project'),false);
  assert.equal(calls.length,0);
});

test('an incomplete tier with no live children schedules one invisible continuation',async()=>{
  const scheduled=[],removed=[],calls=[],injected=[];
  const api={session:{workflow:{
    scheduleSessionTurn:async value=>{scheduled.push(value);return {id:'fallback'};},
    unscheduleSessionTurnsByTag:async value=>{removed.push(value);return {removed:1};},
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
  }}};
  const runner=async(file,args)=>{calls.push({file,args});return {stdout:'{"status":"started"}',stderr:''};};
  const continuation=new TierContinuation(
    api,
    ()=>({active:true,complete:false,pending:0,spawned:4,missing:['批评 0/2']}),
    ()=>({pending:0,quietForMs:13_000}),
    runner,
    '/runtime/openclaw/dist/index.js',
  );
  const sessionKey='agent:unrestricted:tier-gap';
  assert.equal(await continuation.schedule(sessionKey,'unrestricted'),true);
  clearTimeout(continuation.timers.get(sessionKey));continuation.timers.delete(sessionKey);
  assert.equal(scheduled.length,1);assert.equal(scheduled[0].deliveryMode,'none');
  assert.equal(injected.length,1);assert.match(injected[0].text,/批评 0\/2/);assert.match(injected[0].text,/不得输出 NO_REPLY/);
  assert.equal(await continuation.dispatch({sessionKey,agentId:'unrestricted',tag:continuation.tag(sessionKey)}),true);
  const params=JSON.parse(calls[0].args[calls[0].args.indexOf('--params')+1]);
  assert.match(params.message,/^\[pinkie-tier-control\]/);assert.match(params.message,/批评 0\/2/);assert.equal(params.deliver,false);
  assert.ok(removed.length>=2);
});

test('a completed audit still gets one parent wake-up for final synthesis',async()=>{
  const calls=[];
  const api={session:{workflow:{
    scheduleSessionTurn:async()=>({id:'fallback'}),unscheduleSessionTurnsByTag:async()=>({removed:1}),
  }}};
  const continuation=new TierContinuation(
    api,
    ()=>({active:true,complete:true,pending:0}),
    ()=>({pending:0,quietForMs:13_000}),
    async(file,args)=>{calls.push({file,args});return {stdout:'{"status":"started"}',stderr:''};},
    '/runtime/openclaw/dist/index.js',
  );
  const sessionKey='agent:unrestricted:tier-final';
  assert.equal(await continuation.schedule(sessionKey,'unrestricted'),true);
  clearTimeout(continuation.timers.get(sessionKey));continuation.timers.delete(sessionKey);
  assert.equal(await continuation.dispatch({sessionKey,agentId:'unrestricted',tag:continuation.tag(sessionKey)}),true);
  assert.equal(calls.length,1);
});

test('online retry timers survive a temporary local gateway call failure',async t=>{
  const api={session:{workflow:{unscheduleSessionTurnsByTag:async()=>({removed:0}),scheduleSessionTurn:async()=>({id:'fallback'})}}};
  const runner=async()=>{throw new Error('temporary gateway timeout');};
  const watchdog=new UpstreamWatchdog(api,()=> 'marathon',runner,'/runtime/openclaw/dist/index.js',()=>({pending:0,quietForMs:20_000}));
  const sessionKey='agent:unrestricted:retry-local';
  assert.equal(await watchdog.dispatchImmediate({sessionKey,agentId:'unrestricted',runId:'failed',attempt:2,tag:'retry'}),false);
  assert.equal(watchdog.timers.has(sessionKey),true);
  clearTimeout(watchdog.timers.get(sessionKey));watchdog.timers.delete(sessionKey);
  const continuation=new TierContinuation(api,()=>({active:true,complete:false,pending:0,parentRunning:false,missing:['求解 0/5']}),()=>({pending:0,quietForMs:20_000}),runner,'/runtime/openclaw/dist/index.js');
  assert.equal(await continuation.dispatch({sessionKey,agentId:'unrestricted',tag:'tier-retry'}),false);
  assert.equal(continuation.timers.has(sessionKey),true);
  clearTimeout(continuation.timers.get(sessionKey));continuation.timers.delete(sessionKey);
  t.after(()=>void watchdog.cancel(sessionKey));
});

test('mode architecture tracks child activity even outside a selected tier',()=>{
  const runtime=new ModeArchitecture();
  const parent='agent:main:plain',child=`${parent}:subagent:one`;
  assert.equal(runtime.activityFor(parent).pending,0);
  runtime.spawned({childSessionKey:child,label:'普通子任务'},{requesterSessionKey:parent});
  assert.equal(runtime.activityFor(parent).pending,1);
  runtime.ended({targetSessionKey:child,outcome:'ok'});
  const activity=runtime.activityFor(parent);
  assert.equal(activity.pending,0);assert.ok(activity.quietForMs<100);
});

test('custom plugin never relies on OpenClaw trusted-only in-process gateway requests',()=>{
  const source=fs.readFileSync(new URL('../services/mode-architecture/index.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/runtime\.gateway\.request/);
  assert.match(source,/'gateway', 'call', 'chat\.send'/);
});

test('a completed turn cancels every pending watchdog fallback to prevent duplicate replies',async()=>{
  const removed=[];
  const api={session:{workflow:{unscheduleSessionTurnsByTag:async value=>{removed.push(value);return {removed:1};}}}};
  const watchdog=new UpstreamWatchdog(api);
  const sessionKey='agent:project:done';
  let fired=false;
  watchdog.timers.set(sessionKey,setTimeout(()=>{fired=true;},20));
  await watchdog.agentEnded({success:true,runId:'finished'},{agentId:'project',sessionKey});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(fired,false);assert.equal(watchdog.timers.has(sessionKey),false);
  assert.equal(removed.length,1);assert.equal(removed[0].sessionKey,sessionKey);
});

test('a native stop RPC wins the short aborted-error grace window',async()=>{
  const scheduled=[];
  const api={session:{workflow:{
    enqueueNextTurnInjection:async()=>({enqueued:true}),unscheduleSessionTurnsByTag:async()=>({removed:0}),
    scheduleSessionTurn:async value=>{scheduled.push(value);return {id:'retry'};},
  }}};
  const watchdog=new UpstreamWatchdog(api);
  const ctx={agentId:'project',sessionKey:'agent:project:stop-race'};
  const ending=watchdog.agentEnded({success:false,error:'This operation was aborted'},ctx);
  setTimeout(()=>void watchdog.cancel(ctx.sessionKey,true),10);
  assert.equal(await ending,false);assert.equal(scheduled.length,0);
});

test('every visible model output increases the persistent display estimate',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-usage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'usage.json'),ledger=new ModelUsageLedger(file);
  ledger.record({provider:'relay',model:'a',assistantTexts:['完成'],usage:{input:100,output:20}});
  ledger.record({provider:'relay',model:'b',assistantTexts:['继续'],usage:{input:50,output:10}});
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(value.requests,2);assert.equal(value.input,150);assert.equal(value.output,30);
  assert.equal(value.pricingVersion,2);assert.ok(value.cost>0.02&&value.cost<0.03);
  fs.writeFileSync(file,JSON.stringify({...value,cost:999,pricingVersion:1}));
  ledger.record({provider:'relay',model:'c',assistantTexts:['再继续'],usage:{input:50,output:10}});
  const migrated=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(migrated.requests,3);assert.ok(migrated.cost>0.03&&migrated.cost<0.04);
});
