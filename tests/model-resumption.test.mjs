import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FileRunStore, ModeArchitecture, UpstreamWatchdog, WatchdogJobStore} from '../services/mode-architecture/index.mjs';

const selection = {providerOverride:'mm', modelOverride:'gemini-3.6-flash-high'};
const workflow = {
  enqueueNextTurnInjection:async()=>({enqueued:true}),
  unscheduleSessionTurnsByTag:async()=>({removed:0}),
  scheduleSessionTurn:async()=>({id:'test'}),
};

for (const tier of ['base','boost','full','marathon']) test(`${tier} resumes on the selected parent model after process restart`, t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-model-resume-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const key=`agent:unrestricted:model-${tier}`, child='agent:unrestricted:subagent:model-check';
  const runtime=new ModeArchitecture(new FileRunStore(root));
  runtime.arm(key,tier);
  assert.equal(runtime.beforeModelResolve({prompt:'修改项目'},{sessionKey:key}),undefined);
  runtime.modelStarted({sessionKey:key,provider:'mm',model:'gemini-3.6-flash-high'});
  runtime.spawned({childSessionKey:child,label:'规划',resolvedModel:'mm/gemini-3.6-flash-high'},{requesterSessionKey:key});
  // A child/fallback must not overwrite the original user choice.
  runtime.modelStarted({sessionKey:child,provider:'other',model:'fallback'});
  runtime.modelStarted({sessionKey:key,provider:'other',model:'fallback'});
  const recovered=new ModeArchitecture(new FileRunStore(root));
  assert.equal(recovered.status(key).expectedModel,'mm/gemini-3.6-flash-high');
  assert.deepEqual(recovered.beforeModelResolve({prompt:'[pinkie-tier-control] 继续'},{sessionKey:key}),selection);
  assert.deepEqual(recovered.beforeModelResolve({prompt:'\u2063'},{sessionKey:key}),selection);
  assert.deepEqual(recovered.beforeModelResolve({prompt:'完成分工'},{sessionKey:child}),selection);
  assert.equal(recovered.beforeModelResolve({prompt:'我另选一个模型'},{sessionKey:key}),undefined);
  recovered.disarm(key);
  assert.equal(recovered.beforeModelResolve({prompt:'[pinkie-tier-control] 迟到'},{sessionKey:key}),undefined);
});

test('ordinary watchdog restores its original model across restart without changing the next user selection',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-watchdog-model-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const key='agent:project:retry-model', store=new WatchdogJobStore(root);
  const api={session:{workflow}}, runner=async()=>({stdout:'{"status":"started"}'});
  const first=new UpstreamWatchdog(api,()=>'',runner,'',()=>({pending:0,quietForMs:20_000}),store);
  first.modelStarted({sessionKey:key,provider:'mm',model:'gemini-3.6-flash-high'});
  first.modelStarted({sessionKey:key,provider:'other',model:'fallback'});
  await first.agentEnded({success:false,runId:'broken',error:'connection reset'},{sessionKey:key,agentId:'project'});
  assert.equal(store.list()[0].model,'mm/gemini-3.6-flash-high');
  const recovered=new UpstreamWatchdog(api,()=>'',runner,'',()=>({pending:0,quietForMs:20_000}),store);
  await recovered.recoverPending();
  assert.deepEqual(recovered.beforeModelResolve({prompt:'\u2063'},{sessionKey:key}),selection);
  assert.equal(recovered.beforeModelResolve({prompt:'另一个问题'},{sessionKey:key}),undefined);
  recovered.modelStarted({sessionKey:key,provider:'user',model:'new-choice'});
  assert.deepEqual(recovered.beforeModelResolve({prompt:'\u2063'},{sessionKey:key}),{providerOverride:'user',modelOverride:'new-choice'});
  await recovered.cancel(key);
  assert.equal(recovered.beforeModelResolve({prompt:'\u2063'},{sessionKey:key}),undefined);
});
