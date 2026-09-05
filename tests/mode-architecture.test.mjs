import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin,{CleKkAuditLog,CleKkSupervisor,CompletionIntegrityGuard,FileRunStore,ModeArchitecture,ModelUsageLedger,TierContinuation,UpstreamWatchdog,WatchdogJobStore,buildDeliberationPlan,deliberationRequirements,isTransientFailure,modeForContext} from '../services/mode-architecture/index.mjs';

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
  assert.match(result.appendSystemContext,/全局交付真实性门禁/);
  assert.doesNotMatch(result.appendSystemContext,/persona-B|index-B/);
  assert.ok(fs.existsSync(b));
});

test('global integrity gate rejects completion claims without real execution',()=>{
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'main',sessionKey:'agent:main:integrity',runId:'run-integrity'};
  guard.begin({prompt:'调用 skill 完成视频工作'},ctx);
  const blocked=guard.finalize({lastAssistantMessage:'已经全部完成并成功交付。'},ctx);
  assert.equal(blocked.action,'revise');
  assert.match(blocked.reason,/没有任何真实执行工具记录/);
});

test('execution requests cannot evade the gate by omitting the word completed',()=>{
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'project',sessionKey:'agent:project:evasive-delivery'};
  guard.begin({prompt:'执行并交付这个项目'},ctx);
  const blocked=guard.finalize({lastAssistantMessage:'交付成果如下：文件在 output 目录。'},ctx);
  assert.equal(blocked.action,'revise');
  assert.match(blocked.reason,/没有任何真实执行工具记录/);
});

test('an explicit incomplete report is not forced to fake success',()=>{
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'project',sessionKey:'agent:project:honest-block'};
  guard.begin({prompt:'执行并发布这个项目'},ctx);
  assert.equal(guard.finalize({lastAssistantMessage:'本轮未完成：小红书出现人机验证，需要用户确认。'},ctx),undefined);
});

test('global integrity gate rejects contradictory completed and still-running claims',()=>{
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'project',sessionKey:'agent:project:contradiction',runId:'run-contradiction'};
  guard.begin({prompt:'生成视频'},ctx);
  guard.afterTool({toolName:'exec',result:'ok'},ctx);
  const blocked=guard.finalize({lastAssistantMessage:'视频已经完整完成，客户端仍在后台生成中。'},ctx);
  assert.equal(blocked.action,'revise');
  assert.match(blocked.reason,/状态自相矛盾/);
});

test('global integrity gate cannot finalize directly after a failed tool',()=>{
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'unrestricted',sessionKey:'agent:unrestricted:last-error'};
  guard.begin({prompt:'修复程序'},ctx);
  guard.afterTool({toolName:'exec',error:'command failed',result:'Command exited with code 1'},ctx);
  const blocked=guard.finalize({lastAssistantMessage:'程序已经成功修复完成。'},ctx);
  assert.equal(blocked.action,'revise');
  assert.match(blocked.reason,/最后一次工具调用失败/);
});

test('loaded skill completion contract is mechanically enforced',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-contract-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills','video','SKILL.md');
  const verifier=path.join(root,'skills','video','tools','verify_completion.py');
  fs.mkdirSync(path.dirname(verifier),{recursive:true});
  fs.writeFileSync(skill,'# video');
  fs.writeFileSync(verifier,'import json,sys\nprint(json.dumps({"status":"FAIL","issues":["没有本轮视频"]},ensure_ascii=False))\nsys.exit(1)\n');
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'project',sessionKey:'agent:project:contract',runId:'run-contract'};
  guard.begin({prompt:'调用 skill 生成视频'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  guard.afterTool({toolName:'exec',result:'SUBMITTED'},ctx);
  const blocked=guard.finalize({lastAssistantMessage:'真实视频已经全部生成完成。'},ctx);
  assert.equal(blocked.action,'revise');
  assert.match(blocked.reason,/没有本轮视频/);
});

test('a zero-exit verifier still needs strict PASS JSON',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-strict-verifier-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills','simple','SKILL.md');
  const verifier=path.join(root,'skills','simple','tools','verify_completion.py');
  fs.mkdirSync(path.dirname(verifier),{recursive:true});fs.writeFileSync(skill,'# simple');
  fs.writeFileSync(verifier,'print("ok")\n');
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:'agent:project:strict-json'};
  guard.begin({prompt:'调用 skill 完成任务'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  guard.afterTool({toolName:'exec',params:{command:'true'},result:'ok'},ctx);
  const synchronous=guard.finalize({lastAssistantMessage:'任务已经全部完成。'},ctx);
  assert.match(synchronous.reason,/PASS JSON/);
  const asynchronous=await guard.verifyExternal(ctx.sessionKey);
  assert.equal(asynchronous.ok,false);assert.match(asynchronous.reason,/PASS JSON/);
});

test('a real mutation invalidates a previously cached verifier attestation',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-attestation-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills','simple','SKILL.md');
  const verifier=path.join(root,'skills','simple','tools','verify_completion.py');
  const target=path.join(root,'artifact.txt');
  fs.mkdirSync(path.dirname(verifier),{recursive:true});fs.writeFileSync(skill,'# simple');
  fs.writeFileSync(verifier,'import json\nprint(json.dumps({"status":"PASS","verified":True}))\n');
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:'agent:project:fresh-attestation'};
  guard.begin({prompt:'调用 skill 修改文件'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  assert.equal((await guard.verifyExternal(ctx.sessionKey)).ok,true);
  guard.beforeTool({toolName:'write',toolCallId:'w',params:{path:target}},ctx);
  fs.writeFileSync(target,'changed');
  guard.afterTool({toolName:'write',toolCallId:'w',params:{path:target},result:{ok:true}},ctx);
  guard.afterTool({toolName:'read',params:{path:target},result:'changed'},ctx);
  const blocked=guard.finalize({lastAssistantMessage:'任务已经全部完成。'},ctx,{verifyExternal:false});
  assert.match(blocked.reason,/未用成果核验工具验证本轮最新产物/);
});

test('a skill without an independent verifier cannot self-certify completion',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-no-contract-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills','video','SKILL.md');
  fs.mkdirSync(path.dirname(skill),{recursive:true});
  fs.writeFileSync(skill,'# video');
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'project',sessionKey:'agent:project:no-contract'};
  guard.begin({prompt:'调用 skill 完成全部工作'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  guard.afterTool({toolName:'exec',params:{command:'run something'},result:'ok'},ctx);
  const blocked=guard.finalize({lastAssistantMessage:'全部工作已经成功完成。'},ctx);
  assert.equal(blocked.action,'revise');
  assert.match(blocked.reason,/没有独立 verify_completion\.py/);
});

test('copied evidence and forged timestamps cannot pass the global gate',()=>{
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'project',sessionKey:'agent:project:copied-evidence'};
  guard.begin({prompt:'生成视频并发布'},ctx);
  guard.afterTool({
    toolName:'exec',
    params:{command:"python3 -c \"import os,shutil; shutil.copy2('/tmp/output/old.png','/tmp/runs/new/published.png'); os.utime('/tmp/runs/new/published.png',None)\""},
    result:'ok',
  },ctx);
  const blocked=guard.finalize({lastAssistantMessage:'视频已经生成并发布完成。'},ctx);
  assert.equal(blocked.action,'revise');
  assert.match(blocked.reason,/修改文件时间戳|复制旧/);
});

test('douyin workflow cannot pass by listing image assets and self-authored state',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-douyin-contract-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills','douyin-ai-video-workflow','SKILL.md');
  const verifier=path.join(root,'skills','douyin-ai-video-workflow','tools','verify_completion.py');
  fs.mkdirSync(path.dirname(verifier),{recursive:true});
  fs.writeFileSync(skill,'# workflow');
  fs.writeFileSync(verifier,'import sys\nprint("ok")\nsys.exit(0)\n');
  const guard=new CompletionIntegrityGuard();
  const ctx={agentId:'project',sessionKey:'agent:project:douyin-self-report'};
  guard.begin({prompt:'调用 skill 完成视频制作和发布'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  guard.afterTool({toolName:'exec',params:{command:'python3 pipeline_state.py init --run-dir /tmp/run'},result:'INITIALIZED'},ctx);
  guard.afterTool({toolName:'image_generate',params:{action:'list'},result:'[]'},ctx);
  const blocked=guard.finalize({lastAssistantMessage:'全部视频和发布工作已经完成。'},ctx);
  assert.equal(blocked.action,'revise');
  assert.match(blocked.reason,/没有真实提交新的分镜生成请求/);
});

test('a blocked Doubao adapter cannot mint an authoritative submission ledger',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-blocked-submit-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills','douyin-ai-video-workflow','SKILL.md');
  const verifier=path.join(root,'skills','douyin-ai-video-workflow','tools','verify_completion.py');
  const pipeline=path.join(root,'skills','douyin-ai-video-workflow','scripts','pipeline_state.py');
  const runDir=path.join(root,'runs','run-now');
  fs.mkdirSync(path.dirname(verifier),{recursive:true});fs.mkdirSync(path.dirname(pipeline),{recursive:true});
  fs.mkdirSync(path.join(runDir,'reports'),{recursive:true});
  fs.writeFileSync(skill,'# workflow');fs.writeFileSync(verifier,'print("never reached")\n');fs.writeFileSync(pipeline,'# locked validator\n');
  fs.writeFileSync(path.join(runDir,'pipeline_state.json'),JSON.stringify({created_at:new Date().toISOString()}));
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:'agent:project:blocked-submit'};
  guard.begin({prompt:'调用 skill 生成并发布视频'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  guard.afterTool({toolName:'exec',params:{command:`python3 ${pipeline} init --run-dir "${runDir}"`},result:'INITIALIZED'},ctx);
  guard.afterTool({toolName:'exec',params:{command:'python3 /Library/Mac/自动化管理/scripts/desktop/doubao_adapter_macos.py --action submit'},result:'{"status":"SUBMISSION_BLOCKED","error":"真实提交尚未实现"}'},ctx);
  await assert.rejects(()=>guard.recordEvidence(ctx.sessionKey,{kind:'submission_ledger',run_dir:runDir,data:{items:[{unit_id:'u1'}]}}),/真实豆包提交次数不足/);
});

test('the verifier dependency closure is hash locked with the Skill',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-verifier-dependency-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills','douyin-ai-video-workflow','SKILL.md');
  const verifier=path.join(root,'skills','douyin-ai-video-workflow','tools','verify_completion.py');
  const pipeline=path.join(root,'skills','douyin-ai-video-workflow','scripts','pipeline_state.py');
  fs.mkdirSync(path.dirname(verifier),{recursive:true});fs.mkdirSync(path.dirname(pipeline),{recursive:true});
  fs.writeFileSync(skill,'# workflow');fs.writeFileSync(verifier,'import json\nprint(json.dumps({"status":"PASS","verified":True}))\n');
  fs.writeFileSync(pipeline,'# original validator\n');
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:'agent:project:dependency-lock'};
  guard.begin({prompt:'调用 skill 完成视频'},ctx);guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  fs.writeFileSync(pipeline,'# weakened validator\n');
  const checked=await guard.verifyExternal(ctx.sessionKey);
  assert.equal(checked.ok,false);assert.match(checked.reason,/校验依赖/);
});

test('runtime blocks credential extraction and forged evidence before the tool runs',()=>{
  const runtime=new ModeArchitecture();
  const ctx={agentId:'project',sessionKey:'agent:project:tool-policy'};
  const cookie=runtime.beforeTool({toolName:'browser',params:{action:'act',request:{kind:'evaluate',fn:'() => document.cookie'}}},ctx);
  assert.equal(cookie.block,true);
  assert.match(cookie.blockReason,/Cookie/);
  const forged=runtime.beforeTool({toolName:'write',params:{path:'/tmp/publish_receipt.json',content:'{}'}},ctx);
  assert.equal(forged.block,true);
  assert.match(forged.blockReason,/不能直接手写/);
  const pageProof=runtime.beforeTool({toolName:'write',params:{path:'/tmp/public_page_evidence.txt',content:'fake'}},ctx);
  assert.equal(pageProof.block,true);assert.match(pageProof.blockReason,/不能直接手写/);
  const controlRead=runtime.beforeTool({toolName:'read',params:{path:'/Users/Admin/.openclaw/pinkie-deep-think/runs/state.json'}},ctx);
  assert.equal(controlRead.block,true);assert.match(controlRead.blockReason,/宿主运行层维护/);
});

test('CLE Kk blocks a false terminal before it reaches transcript or delivery',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-supervisor-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const integrity=new CompletionIntegrityGuard();
  const supervisor=new CleKkSupervisor({integrity,audit:new CleKkAuditLog(root)});
  const retries=[];
  supervisor.setRetryScheduler(async value=>{retries.push(value);return true;});
  const ctx={agentId:'project',sessionKey:'agent:project:cle-kk',runId:'run-one'};
  supervisor.begin({prompt:'帮我修复项目文件'},ctx);
  const message={role:'assistant',stopReason:'stop',content:[{type:'text',text:'已经全部修复完成，可以用了。'}]};
  assert.deepEqual(supervisor.beforeMessageWrite({message},ctx),{block:true});
  const delivery=await supervisor.beforeReplyPayload({kind:'final',payload:{text:'已经全部修复完成，可以用了。'},runId:'run-one'},ctx);
  assert.equal(delivery.cancel,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(retries.length,1);assert.match(retries[0].decision.reason,/没有任何真实执行工具记录/);
  assert.equal(supervisor.hasPending(ctx.sessionKey),true);
});

test('CLE Kk never shows its internal watchdog/control text',async()=>{
  const supervisor=new CleKkSupervisor({audit:new CleKkAuditLog('')});
  const ctx={agentId:'main',sessionKey:'agent:main:hidden-control'};
  const message={role:'assistant',stopReason:'stop',content:[{type:'text',text:'【自动续接保护】从未完成处继续。'}]};
  assert.deepEqual(supervisor.beforeMessageWrite({message},ctx),{block:true});
  const delivery=await supervisor.beforeReplyPayload({kind:'final',payload:{text:'[pinkie-tier-control] 继续'},sessionKey:ctx.sessionKey},ctx);
  assert.equal(delivery.cancel,true);
});

test('CLE Kk durable rejection is recovered after a gateway restart',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-recovery-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const key='agent:project:restart-recovery',ctx={agentId:'project',sessionKey:key,runId:'before-restart'};
  const first=new CleKkSupervisor({audit:new CleKkAuditLog(root)});
  first.begin({prompt:'修改项目并验证'},ctx);
  first.recordFinalize({lastAssistantMessage:'已经完成。'},ctx,new CompletionIntegrityGuard().revise(key,'没有真实产物'));

  const recovered=[];
  const second=new CleKkSupervisor({audit:new CleKkAuditLog(root)});
  second.setRetryScheduler(async value=>{recovered.push(value);return true;});
  assert.equal(await second.recoverPending(),1);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(recovered.length,1);assert.equal(recovered[0].sessionKey,key);
  assert.equal(second.hasPending(key),true);
});

test('CLE Kk replays tool provenance after a gateway restart without rewriting a huge state file',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-tool-replay-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const target=path.join(root,'artifact.txt');
  const key='agent:project:tool-replay',ctx={agentId:'project',sessionKey:key,runId:'same-run'};
  const first=new CleKkSupervisor({audit:new CleKkAuditLog(path.join(root,'audit'))});
  first.begin({prompt:'帮我修改项目文件'},ctx);
  first.integrity.beforeTool({toolName:'write',toolCallId:'w1',params:{path:target}},ctx);
  fs.writeFileSync(target,'real change');
  first.afterTool({toolName:'write',toolCallId:'w1',params:{path:target},result:{status:'completed'}},ctx);
  first.integrity.beforeTool({toolName:'read',toolCallId:'r1',params:{path:target}},ctx);
  first.afterTool({toolName:'read',toolCallId:'r1',params:{path:target},result:'real change'},ctx);
  const stateFile=first.audit.stateFileFor(key);
  assert.ok(fs.statSync(stateFile).size<30_000);

  const second=new CleKkSupervisor({audit:new CleKkAuditLog(path.join(root,'audit'))});
  second.begin({prompt:''},ctx);
  assert.equal(second.integrity.runs.get(key).tools.length,2);
  assert.equal(second.integrity.finalize({lastAssistantMessage:'项目已经修复完成。'},ctx,{verifyExternal:false}),undefined);
});

test('CLE Kk audit and durable state detect tampering',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-audit-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const key='agent:project:audit-chain',audit=new CleKkAuditLog(root);
  audit.append('turn_start',key,{prompt:'one'});audit.append('tool_result',key,{tool:'write'});
  assert.equal(audit.verify(key).ok,true);
  audit.writeState(key,{active:true,pending:{decision:{action:'revise'}}});
  const stateFile=audit.stateFileFor(key),state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  state.pending=null;
  fs.writeFileSync(stateFile,JSON.stringify(state));
  assert.equal(audit.readState(key).corrupted,true);
  const lines=fs.readFileSync(audit.fileFor(key),'utf8').trim().split('\n');
  const first=JSON.parse(lines[0]);first.type='forged';lines[0]=JSON.stringify(first);
  fs.writeFileSync(audit.fileFor(key),`${lines.join('\n')}\n`);
  assert.equal(audit.verify(key).ok,false);
});

test('FileRunStore rejects tampered run and child state and migrates legacy files',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-file-store-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const key='agent:project:file-store',child=`${key}:subagent:one`,store=new FileRunStore(root);
  const runtime=new ModeArchitecture(store);runtime.arm(key,'base');store.mapChild(child,key);
  const runFile=store.runFile(key),childFile=store.childFile(child);
  const signedRun=JSON.parse(fs.readFileSync(runFile,'utf8'));
  const legacyState=structuredClone(signedRun.state);
  signedRun.state.tier='full';fs.writeFileSync(runFile,JSON.stringify(signedRun));
  assert.equal(store.get(key),null);
  const signedChild=JSON.parse(fs.readFileSync(childFile,'utf8'));
  signedChild.parentSessionKey='agent:project:forged';fs.writeFileSync(childFile,JSON.stringify(signedChild));
  assert.equal(store.parentForChild(child),'');

  const legacy={sessionKey:signedRun.sessionKey,state:legacyState};
  fs.writeFileSync(runFile,JSON.stringify(legacy));
  assert.equal(store.get(key).tier,'base');
  const migrated=JSON.parse(fs.readFileSync(runFile,'utf8'));
  assert.equal(migrated.v,1);assert.ok(migrated.digest);
});

test('a file-changing task needs a real effect and a post-change check',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-effect-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'app.txt');
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:'agent:project:effect'};
  guard.begin({prompt:'帮我修改这个项目文件'},ctx);
  guard.beforeTool({toolName:'write',toolCallId:'write-1',params:{path:file}},ctx);
  fs.writeFileSync(file,'fixed');
  guard.afterTool({toolName:'write',toolCallId:'write-1',params:{path:file},result:{status:'completed'}},ctx);
  let result=guard.finalize({lastAssistantMessage:'已经修复完成。'},ctx);
  assert.match(result.reason,/之后没有读取、测试或检查真实结果/);
  guard.beforeTool({toolName:'read',toolCallId:'read-1',params:{path:file}},ctx);
  guard.afterTool({toolName:'read',toolCallId:'read-1',params:{path:file},result:'fixed'},ctx);
  result=guard.finalize({lastAssistantMessage:'已经修复完成。'},ctx);
  assert.equal(result,undefined);
});

test('an empty write result plus a read cannot fake a host file change',()=>{
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:'agent:project:no-effect'};
  guard.begin({prompt:'帮我修改项目文件'},ctx);
  guard.beforeTool({toolName:'write',toolCallId:'fake-write',params:{path:'/tmp/cle-kk-never-created'}},ctx);
  guard.afterTool({toolName:'write',toolCallId:'fake-write',params:{path:'/tmp/cle-kk-never-created'},result:{status:'completed'}},ctx);
  guard.afterTool({toolName:'read',params:{path:'/tmp/cle-kk-never-created'},result:'模型声称读到了'},ctx);
  const result=guard.finalize({lastAssistantMessage:'已经全部修复完成。'},ctx);
  assert.match(result.reason,/没有主机确认的文件变化/);
});

test('past or negated incomplete wording cannot bypass a completion claim',()=>{
  for(const [index,reply] of [
    '之前未完成的问题已经修复，现在全部完成。',
    '虽然上一轮未完成，这一轮已经成功交付。',
    '未完成项：无，所有工作已经完成。',
  ].entries()){
    const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:`agent:project:wording-${index}`};
    guard.begin({prompt:'修复项目文件'},ctx);
    const result=guard.finalize({lastAssistantMessage:reply},ctx);
    assert.equal(result.action,'revise');assert.match(result.reason,/没有任何真实执行工具记录/);
  }
});

test('a bare continue message is not misclassified as a new file mutation',()=>{
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'main',sessionKey:'agent:main:continue-chat'};
  guard.begin({prompt:'继续'},ctx);
  assert.equal(guard.finalize({lastAssistantMessage:'接着上面的解释往下说。'},ctx),undefined);
  const blocked=guard.finalize({lastAssistantMessage:'上一个项目已经全部修复完成。'},ctx);
  assert.equal(blocked.action,'revise');assert.match(blocked.reason,/没有任何真实执行工具记录/);
});

test('external actions also need a separate post-action observation',()=>{
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:'agent:project:external-check'};
  guard.begin({prompt:'帮我发布这个项目'},ctx);
  guard.afterTool({toolName:'publish_project',params:{target:'remote'},result:{ok:true}},ctx);
  let blocked=guard.finalize({lastAssistantMessage:'项目已经发布完成。'},ctx);
  assert.match(blocked.reason,/之后没有读取、测试或检查真实结果/);
  guard.afterTool({toolName:'check_publish_status',params:{target:'remote'},result:{status:'live'}},ctx);
  blocked=guard.finalize({lastAssistantMessage:'项目已经发布完成。'},ctx);
  assert.equal(blocked,undefined);
});

test('a verifier created after Skill load cannot self-certify the same turn',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-late-verifier-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills','late','SKILL.md');
  const verifier=path.join(root,'skills','late','tools','verify_completion.py');
  fs.mkdirSync(path.dirname(skill),{recursive:true});fs.writeFileSync(skill,'# late');
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:'agent:project:late-verifier'};
  guard.begin({prompt:'调用 Skill 完成项目'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  fs.mkdirSync(path.dirname(verifier),{recursive:true});fs.writeFileSync(verifier,'print("ok")\n');
  guard.afterTool({toolName:'read',params:{path:verifier},result:'loaded'},ctx);
  guard.afterTool({toolName:'exec',params:{command:'true'},result:'ok'},ctx);
  const result=guard.finalize({lastAssistantMessage:'项目已经完成。'},ctx);
  assert.match(result.reason,/没有独立 verify_completion\.py/);
});

function integrityContract(t,label,verifierCode='import json\nprint(json.dumps({"status":"PASS","verified":True}))\n') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-contract-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const skill=path.join(root,'skills',label,'SKILL.md');
  const verifier=path.join(path.dirname(skill),'tools','verify_completion.py');
  fs.mkdirSync(path.dirname(verifier),{recursive:true});
  fs.writeFileSync(skill,'# independent workflow');
  if(verifierCode!==null)fs.writeFileSync(verifier,verifierCode);
  const guard=new CompletionIntegrityGuard(),ctx={agentId:'project',sessionKey:`agent:project:${label}`};
  return {root,skill,verifier,guard,ctx};
}

test('an immediately installed existing contract can verify without an artificial age delay',async t=>{
  const {skill,guard,ctx}=integrityContract(t,'fresh-install');
  guard.begin({prompt:'调用 Skill 验证项目'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  assert.equal((await guard.verifyExternal(ctx.sessionKey)).verified,true);
});

test('creating or changing a verifier before first Skill read cannot self-certify',async t=>{
  for(const existing of [false,true]){
    const {skill,verifier,guard,ctx}=integrityContract(t,`pre-read-${existing}`,existing?'print("FAIL")\n':null);
    guard.begin({prompt:'调用 Skill 完成项目'},ctx);
    fs.writeFileSync(verifier,'import json\nprint(json.dumps({"status":"PASS","verified":True}))\n');
    guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
    guard.afterTool({toolName:'exec',params:{command:'true'},result:'ok'},ctx);
    const checked=await guard.verifyExternal(ctx.sessionKey);
    assert.equal(checked.ok,false);assert.match(checked.reason,/没有独立 verify_completion\.py/);
    assert.match(guard.finalize({lastAssistantMessage:'项目已经全部完成。'},ctx).reason,/没有独立 verify_completion\.py/);
  }
});

test('rereading changed Skill or verifier never replaces the original contract lock',async t=>{
  for(const target of ['skill','verifier']){
    const fixture=integrityContract(t,`reread-${target}`),{skill,verifier,guard,ctx}=fixture;
    guard.begin({prompt:'调用 Skill 完成项目'},ctx);
    guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
    const original=guard.runs.get(ctx.sessionKey).skills.get(skill);
    fs.appendFileSync(fixture[target],'\n# modified by execution model\n');
    guard.afterTool({toolName:'read',params:{path:verifier},result:'loaded again'},ctx);
    guard.afterTool({toolName:'read',params:{path:skill},result:'loaded again'},ctx);
    assert.equal(guard.runs.get(ctx.sessionKey).skills.get(skill),original);
    const checked=await guard.verifyExternal(ctx.sessionKey);
    assert.equal(checked.ok,false);assert.match(checked.reason,/契约文件被替换或修改/);
  }
});

test('one valid Skill cannot certify a second Skill with a missing verifier',async t=>{
  const {root,skill,guard,ctx}=integrityContract(t,'valid-plus-missing');
  const missing=path.join(root,'skills','missing','SKILL.md');
  fs.mkdirSync(path.dirname(missing),{recursive:true});fs.writeFileSync(missing,'# missing verifier');
  guard.begin({prompt:'调用这两个 Skill 完成项目'},ctx);
  for(const file of [missing,skill])guard.afterTool({toolName:'read',params:{path:file},result:'loaded'},ctx);
  guard.afterTool({toolName:'exec',params:{command:'true'},result:'ok'},ctx);
  const checked=await guard.verifyExternal(ctx.sessionKey);
  assert.equal(checked.ok,false);assert.ok(checked.reason.includes(missing));
  for(const options of [{},{verifyExternal:false}]){
    assert.match(guard.finalize({lastAssistantMessage:'项目已经全部完成。'},ctx,options).reason,/没有独立 verify_completion\.py/);
  }
});

test('empty contracts and unsuccessful Skill reads cannot mint a verified attestation',async t=>{
  const {skill,guard,ctx}=integrityContract(t,'failed-read');
  guard.begin({prompt:'调用 Skill 完成项目'},ctx);
  for(const event of [
    {toolName:'read',params:{path:skill},error:'permission denied',result:'failed'},
    {toolName:'write',params:{path:skill},result:'ok'},
  ])guard.afterTool(event,ctx);
  assert.equal(guard.runs.get(ctx.sessionKey).loadedSkills.size,0);
  const checked=await guard.verifyExternal(ctx.sessionKey);
  assert.equal(checked.ok,false);assert.equal(checked.verified,undefined);
  assert.equal(guard.runs.get(ctx.sessionKey).verification,null);
});

test('symlink contracts cannot act as completion authorities',async t=>{
  const {root,skill,verifier,guard,ctx}=integrityContract(t,'linked-verifier');
  const other=path.join(root,'outside.py');fs.renameSync(verifier,other);fs.symlinkSync(other,verifier);
  guard.begin({prompt:'调用 Skill 完成项目'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  assert.equal((await guard.verifyExternal(ctx.sessionKey)).ok,false);
});

test('fresh evidence cannot follow a file or parent symlink outside its run',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-evidence-links-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const run=path.join(root,'run'),outside=path.join(root,'outside');
  fs.mkdirSync(run);fs.mkdirSync(outside);
  const file=path.join(outside,'capture.txt');fs.writeFileSync(file,'new evidence');
  fs.symlinkSync(file,path.join(run,'linked.txt'));
  fs.symlinkSync(outside,path.join(run,'linked-directory'));
  const guard=new CompletionIntegrityGuard();
  for(const candidate of [path.join(run,'linked.txt'),path.join(run,'linked-directory','capture.txt')]){
    assert.throws(()=>guard.assertFreshRunFile(candidate,run,Date.now()-100,'截图'),/不在本轮运行目录/);
  }
  const own=path.join(run,'own.txt');fs.writeFileSync(own,'own evidence');
  assert.equal(guard.assertFreshRunFile(own,run,Date.now()-100,'证据').path,own);
});

test('controlled writer rejects escaped run directories and output parents',async t=>{
  const {root,skill,guard,ctx}=integrityContract(t,'douyin-ai-video-workflow');
  const pipeline=path.join(path.dirname(skill),'scripts','pipeline_state.py');
  fs.mkdirSync(path.dirname(pipeline),{recursive:true});fs.writeFileSync(pipeline,'# validator');
  const runs=path.join(root,'runs'),outside=path.join(root,'outside'),realRun=path.join(runs,'real');
  fs.mkdirSync(realRun,{recursive:true});fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(runs,'escaped'));fs.symlinkSync(outside,path.join(realRun,'reports'));
  fs.writeFileSync(path.join(realRun,'pipeline_state.json'),JSON.stringify({created_at:new Date().toISOString()}));
  guard.begin({prompt:'调用 Skill 生成视频'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  assert.throws(()=>guard.workflowContext(ctx.sessionKey,path.join(runs,'escaped')),/运行目录必须/);
  guard.afterTool({toolName:'exec',params:{command:`python3 ${pipeline} init --run-dir "${realRun}"`},result:'INITIALIZED'},ctx);
  await assert.rejects(()=>guard.recordEvidence(ctx.sessionKey,{kind:'submission_ledger',run_dir:realRun,data:{}}),/符号链接离开/);
  assert.deepEqual(fs.readdirSync(outside),[]);
});

test('a verifier cannot change its own contract while returning PASS',async t=>{
  const {skill,guard,ctx}=integrityContract(t,'self-changing',
    'import json\nwith open(__file__,"a") as f: f.write("\\n# changed\\n")\nprint(json.dumps({"status":"PASS","verified":True}))\n');
  guard.begin({prompt:'调用 Skill 完成项目'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  const checked=await guard.verifyExternal(ctx.sessionKey);
  assert.equal(checked.ok,false);assert.match(checked.reason,/契约文件被替换或修改/);
});

test('an artifact mutation during asynchronous verification invalidates its result',async t=>{
  const {root,skill,guard,ctx}=integrityContract(t,'verification-race',
    'import json,time\ntime.sleep(0.08)\nprint(json.dumps({"status":"PASS","verified":True}))\n');
  guard.begin({prompt:'调用 Skill 修改文件'},ctx);
  guard.afterTool({toolName:'read',params:{path:skill},result:'loaded'},ctx);
  const pending=guard.verifyExternal(ctx.sessionKey),target=path.join(root,'changed.txt');
  guard.beforeTool({toolName:'write',toolCallId:'concurrent',params:{path:target}},ctx);
  fs.writeFileSync(target,'changed during verification');
  guard.afterTool({toolName:'write',toolCallId:'concurrent',params:{path:target},result:'ok'},ctx);
  const checked=await pending;
  assert.equal(checked.ok,false);assert.match(checked.reason,/验收期间产物或 Skill 契约发生变化/);
  assert.equal(guard.runs.get(ctx.sessionKey).verification,null);
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
  assert.match(marathon,/无人值守的长时任务/);assert.match(marathon,/真正独立的子任务才并行/);
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
    runtime.ended({targetSessionKey:child,targetKind:'subagent',reason:'completed',outcome:'ok',resultText:`${role} ${i} 已完成独立分析：核对了原始要求、真实现场和边界条件，并给出可执行步骤、风险点以及对应的机械验证办法。`});
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

test('model-authored skip markers cannot bypass a selected tier',()=>{
  const runtime=new ModeArchitecture(),ctx={agentId:'project',sessionKey:'agent:project:no-skip',runId:'run-no-skip'};
  runtime.arm(ctx.sessionKey,'base');
  const result=runtime.finalize({lastAssistantMessage:'直接完成。 <!-- pinkie-deliberation-skip -->'},ctx);
  assert.equal(result.action,'revise');assert.match(result.reason,/真实调用未达标/);
});

test('empty, canned, and duplicated child answers do not satisfy role counts',()=>{
  const runtime=new ModeArchitecture(),ctx={agentId:'project',sessionKey:'agent:project:child-quality'};
  runtime.arm(ctx.sessionKey,'base');
  const first=`${ctx.sessionKey}:subagent:one`,second=`${ctx.sessionKey}:subagent:two`;
  runtime.spawned({childSessionKey:first,label:'求解·1'},{requesterSessionKey:ctx.sessionKey});
  runtime.ended({targetSessionKey:first,outcome:'ok',resultText:'已完成'});
  assert.equal(runtime.status(ctx.sessionKey).completedRoles.solver,undefined);
  const substantive='逐项核对了原需求和真实项目现场，给出了具体文件改动、风险边界、执行顺序以及可以重复运行的验证命令。';
  runtime.ended({targetSessionKey:first,outcome:'ok',resultText:substantive});
  runtime.spawned({childSessionKey:second,label:'求解·2'},{requesterSessionKey:ctx.sessionKey});
  runtime.ended({targetSessionKey:second,outcome:'ok',resultText:substantive});
  assert.equal(runtime.status(ctx.sessionKey).completedRoles.solver,1);
  assert.equal(runtime.status(ctx.sessionKey).failedChildren,1);
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
  assert.equal(runtime.status(ctx.sessionKey).pending,1);
  runtime.ended({targetSessionKey:child,outcome:'ok',resultText:'已拆出完整验收清单，逐项对应原始要求，并为文件变化、命令结果和最终交付分别标明了可重复的机械验证方法。'});
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
  runtime.ended({targetSessionKey:child,outcome:'ok',resultText:'先完整读取项目和用户点名的文件，再把每项要求映射到实际改动，最后运行测试并对照验收清单逐项核对。'});
  const status=runtime.status(ctx.sessionKey);
  const prompt=runtime.prompt({prompt:'继续'}, {...ctx,workspaceDir:root});
  assert.equal(status.completedRoles.planner,1);assert.equal(status.collectedResults,1);
  assert.match(prompt.appendSystemContext,/已完成子任务的候选证据/);
  assert.match(prompt.appendSystemContext,/先完整读取项目和用户点名的文件/);
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
  const ending=new ModeArchitecture(new FileRunStore(root));ending.ended({targetSessionKey:child,outcome:'ok',resultText:'已完成规划：列出了逐项可执行、可验证的交付清单，并给每个步骤标注依赖、风险以及失败后的恢复路径。'});
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
  const hooks=new Map(),methods=new Map(),queued=[],tools=[];
  plugin.register({
    on:(name,fn)=>hooks.set(name,fn),
    registerGatewayMethod:(name,fn,opts)=>methods.set(name,{fn,opts}),
    registerTool:(factory,opts)=>tools.push({factory,opts}),
    // Some compatible OpenClaw builds resolve a successful enqueue with no
    // payload; the control RPC must still stay usable in that case.
    session:{workflow:{enqueueNextTurnInjection:async value=>{queued.push(value);}}},
  });
  for(const name of ['before_agent_run','before_prompt_build','before_tool_call','after_tool_call','subagent_spawned','subagent_ended','before_compaction','after_compaction','before_agent_finalize','before_message_write','reply_payload_sending','model_call_started','model_call_ended','llm_output','agent_end'])assert.ok(hooks.has(name));
  assert.equal(methods.get('pinkie.deepThink.arm').opts.scope,'operator.admin');
  assert.equal(methods.get('pinkie.deepThink.disarm').opts.scope,'operator.admin');
  assert.equal(methods.get('pinkie.deepThink.status').opts.scope,'operator.admin');
  assert.equal(tools.length,1);assert.equal(tools[0].opts.name,'delivery_guard');
  const guardTool=tools[0].factory({sessionKey:'agent:project:registered-tool'});
  assert.equal(guardTool.name,'delivery_guard');assert.equal(guardTool.label,'成果核验');
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

test('ordinary watchdog jobs survive a gateway restart',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-watchdog-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new WatchdogJobStore(root),injected=[],scheduled=[];
  const workflow={
    enqueueNextTurnInjection:async value=>{injected.push(value);return {enqueued:true};},
    unscheduleSessionTurnsByTag:async()=>({removed:0}),
    scheduleSessionTurn:async value=>{scheduled.push(value);return {id:'fallback'};},
  };
  const key='agent:project:durable-upstream';
  const first=new UpstreamWatchdog({session:{workflow}},()=>'',async()=>({stdout:'{}'}),'',()=>({pending:0,quietForMs:20_000}),store);
  assert.equal(await first.agentEnded({success:false,runId:'broken',error:'connection reset'},{agentId:'project',sessionKey:key}),true);
  assert.equal(store.list().length,1);

  const second=new UpstreamWatchdog({session:{workflow}},()=>'',async()=>({stdout:'{"status":"started"}'}),'/runtime/openclaw/dist/index.js',()=>({pending:0,quietForMs:20_000}),store);
  assert.equal(await second.recoverPending(),1);
  assert.equal(injected.some(value=>value.metadata?.recovered),true);
  assert.equal(second.timers.has(key),true);
  await second.cancel(key);
  assert.equal(store.list().length,0);
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
  // Local desktop sessions use the authenticated CLI timer. A cron fallback
  // has no channel and would fail with "Channel is required".
  assert.equal(scheduled.length,0);
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
