import test from 'node:test';import assert from 'node:assert/strict';import {transformWithStatus} from '../patch/apply-retry-user-preservation.mjs';
const original='if (activeContextEngine && !beforeAgentFinalizeRevisionReason) flushSessionManagerFile(activeSessionManager);';
const originalMerge=`if (orphanPromptMerge.removeLeaf) {
\t\t\t\t\t\tif (leafEntry.parentId) sessionManager.branch(leafEntry.parentId);
\t\t\t\t\t\telse sessionManager.resetLeaf();
\t\t\t\t\t\tconst sessionContext = sessionManager.buildSessionContext();
\t\t\t\t\t\tactiveSession.agent.state.messages = sessionContext.messages;
\t\t\t\t\t}`;
const originalPrepare='if (sm.wasRecoveredFromCorruptHeader?.() || preservesForkedBranch) {';
const originalCall=`await prepareSessionManagerForRun({
\t\t\t\t\tsessionManager,
\t\t\t\t\tsessionFile: params.sessionFile,
\t\t\t\t\thadSessionFile,
\t\t\t\t\tsessionId: params.sessionId,
\t\t\t\t\tcwd: effectiveCwd
\t\t\t\t});`;
const fixture=original+'\n// MERGE\n'+originalMerge+'\n// PREPARE\n'+originalPrepare+' return true; } return false;\n// CALL\n'+originalCall;
test('retry patch is structural, idempotent and fails closed on an unknown runtime',()=>{
 const x=transformWithStatus(fixture);assert.equal(x.changed,true);assert.match(x.text,/pinkie-flush-first-user-before-retry:v1/);assert.match(x.text,/pinkie-preserve-user-leaf-on-retry:v1/);assert.match(x.text,/pinkie-preserve-pending-user-on-retry:v1/);
 assert.equal(transformWithStatus(x.text).reason,'already-patched');assert.equal(transformWithStatus('upstream changed').reason,'unsupported-runtime');
 assert.equal(transformWithStatus(fixture+'\n'+original).reason,'unsupported-runtime');
});
test('only a pending new transcript in an included session is flushed during a retry',()=>{
 const text=transformWithStatus(fixture).text.split('\n// MERGE\n')[0];
 const execute=new Function('activeContextEngine','beforeAgentFinalizeRevisionReason','params','activeSessionManager','flushSessionManagerFile',text);
 const run=(key,flushed,entries,revision=true,engine=false)=>{let writes=0;execute(engine,revision,{sessionKey:key},{flushed,getEntries:()=>entries},()=>writes++);return writes};
 const user=[{type:'message',message:{role:'user'}}];
 assert.equal(run('agent:learning:qa',false,user),1);
 assert.equal(run('agent:project:qa',false,user),1);
 assert.equal(run('agent:other:qa',false,user),0);
 assert.equal(run('agent:learning:qa',true,user),0);
 assert.equal(run('agent:learning:qa',false,[]),0);
 assert.equal(run('agent:learning:qa',false,user,false),0);
 assert.equal(run('agent:learning:qa',true,user,false,true),1,'existing normal context flush remains');
});
test('retry merges user context for the model without removing its durable leaf',()=>{
 const text=transformWithStatus(fixture).text.split('\n// MERGE\n')[1].split('\n// PREPARE\n')[0];
 const execute=new Function('orphanPromptMerge','params','leafEntry','sessionManager','activeSession',text);
 const run=(key,suppress)=>{let removed=0;const messages=[{role:'assistant'},{role:'user'}],sessionManager={buildSessionContext:()=>({messages}),branch:()=>removed++,resetLeaf:()=>removed++},active={agent:{state:{}}};
  execute({removeLeaf:true},{sessionKey:key,suppressNextUserMessagePersistence:suppress},{parentId:'p'},sessionManager,active);
  return {removed,roles:active.agent.state.messages.map(x=>x.role)};};
 assert.deepEqual(run('agent:learning:qa',true),{removed:0,roles:['assistant']});
 assert.deepEqual(run('agent:learning:qa',false),{removed:1,roles:['assistant','user']});
 assert.deepEqual(run('agent:other:qa',true),{removed:1,roles:['assistant','user']});
});
test('a retry preserves a pending user when reopening a session without an assistant',()=>{
 const text=transformWithStatus(fixture).text.split('\n// PREPARE\n')[1].split('\n// CALL\n')[0];
 const execute=new Function('params','sm','preservesForkedBranch',text);
 const manager={fileEntries:[{type:'message',message:{role:'user'}}],wasRecoveredFromCorruptHeader:()=>false};
 assert.equal(execute({preservePendingUser:true},manager,false),true);
 assert.equal(execute({preservePendingUser:false},manager,false),false);
 assert.equal(execute({preservePendingUser:true},{...manager,fileEntries:[]},false),false);
});
