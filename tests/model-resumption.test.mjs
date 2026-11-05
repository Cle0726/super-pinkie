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

test('a run that dies inside one very long model call resumes with "write it in parts", not "the network dropped"', async () => {
  const {UpstreamWatchdog, WATCHDOG_STALLED_GENERATION_MS, watchdogResumeText} = await import('../services/mode-architecture/index.mjs');
  const injected = [];
  const workflow = {
    enqueueNextTurnInjection: async value => { injected.push(value); return {enqueued: true}; },
    unscheduleSessionTurnsByTag: async () => ({removed: 0, failed: 0}),
    scheduleSessionTurn: async () => ({id: 'retry'}),
  };
  const watchdog = new UpstreamWatchdog({session: {workflow}}, () => '', async () => ({stdout: '{}'}), '');
  // 11-04 R-ppt: the 8-slide script was generated in one call; stuck recovery aborted it at 385 s.
  watchdog.modelStarted({runId: 'long', sessionKey: 'agent:project:deck', provider: 'mm', model: 'flash'});
  watchdog.lastCalls.get('long').startedAt -= 385_000;
  watchdog.modelEnded({runId: 'long', durationMs: 385_000, outcome: 'error', failureKind: 'aborted'});
  await watchdog.agentEnded({runId: 'long', success: false, error: 'AbortError: Reply operation aborted by user'}, {agentId: 'project', sessionKey: 'agent:project:deck'});
  assert.equal(injected.length, 1);
  assert.match(injected[0].text, /一口气要写的内容太长，约 6 分钟没有任何输出/);
  assert.match(injected[0].text, /拆成几段.+150 行以内.+最小版本/);
  assert.match(injected[0].text, /禁止重复/);

  // A call that never reported its end counts up to now; a quick failure is still an ordinary outage.
  watchdog.modelStarted({runId: 'open', sessionKey: 'agent:project:two', provider: 'mm', model: 'flash'});
  watchdog.lastCalls.get('open').startedAt -= WATCHDOG_STALLED_GENERATION_MS + 1_000;
  assert.ok(watchdog.stalledGenerationMs('open') >= WATCHDOG_STALLED_GENERATION_MS);
  watchdog.modelStarted({runId: 'quick', sessionKey: 'agent:project:three', provider: 'mm', model: 'flash'});
  watchdog.modelEnded({runId: 'quick', durationMs: 4_000, outcome: 'error', failureKind: 'connection_reset'});
  assert.equal(watchdog.stalledGenerationMs('quick'), 4_000);
  assert.match(watchdogResumeText({stalledMs: 4_000}), /临时上游连接中断/);
  assert.match(watchdogResumeText({incompleteToolTurn: true, stalledMs: 4_000}), /工具结果已经返回/);
  // A long call that completed normally and went on to call a tool is not a stall, even if the turn failed later.
  watchdog.modelStarted({runId: 'done', sessionKey: 'agent:project:four', provider: 'mm', model: 'flash'});
  watchdog.modelEnded({runId: 'done', durationMs: 400_000, outcome: 'completed'});
  watchdog.toolStarted({toolName: 'exec'}, {runId: 'done'});
  assert.equal(watchdog.stalledGenerationMs('done'), 0);
  // 11-04 routes-i R-ppt: stuck recovery cut the stream from outside and the runtime still reported
  // outcome=completed (its iterator's finally). No tool ever followed: that is the stall.
  watchdog.modelStarted({runId: 'cut', sessionKey: 'agent:project:five', provider: 'mm', model: 'flash'});
  watchdog.modelEnded({runId: 'cut', durationMs: 361_000, outcome: 'completed'});
  assert.equal(watchdog.stalledGenerationMs('cut'), 361_000);
  assert.match(watchdogResumeText({stalledMs: watchdog.stalledGenerationMs('cut')}), /拆成几段/);
});
