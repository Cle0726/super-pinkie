import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerWorkGateway} from '../services/mode-architecture/work-status.mjs';
import {ReasoningEnhancer, ReviewStore} from '../services/mode-architecture/reasoning.mjs';
const architecturePath=process.env.PINKIE_TEST_ARCHITECTURE || new URL('../services/mode-architecture/index.mjs',import.meta.url);
const {ModeArchitecture,FileRunStore}=await import(typeof architecturePath==='string'?pathToFileURL(architecturePath):architecturePath);

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-work-api-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const methods=new Map();
  const architecture=new ModeArchitecture(new FileRunStore(path.join(root,'runs')));
  const reasoning=new ReasoningEnhancer({}, {store:new ReviewStore(path.join(root,'reviews'))});
  const background={status:key=>key.endsWith(':one')?[{id:'bg-one',state:'running',command:'test build'}]:[]};
  registerWorkGateway({registerGatewayMethod:(name,fn,options)=>methods.set(name,{fn,options})},{architecture,reasoning,background});
  const call=(name,params)=>{let answer;methods.get(name).fn({params,respond:(ok,payload,error)=>{answer={ok,payload,error};}});return answer;};
  return {architecture,reasoning,call,methods,root};
}

test('the panel aggregates actual stored jobs, worker hooks and background commands for the requested session',t=>{
  const {architecture,reasoning,call,methods}=fixture(t),key='agent:learning:one';
  architecture.arm(key,'full');
  architecture.spawned({childSessionKey:'agent:learning:subagent:worker-one',label:'solver-1',resolvedModel:'qa/selected'}, {requesterSessionKey:key});
  reasoning.store.set({sessionKey:key,requestId:'review-request-one',tier:'max',level:'max',phase:'answering',jobs:[{id:'solver-one',role:'solver',state:'running',output:''}]});
  const value=call('pinkie.work.status',{sessionKey:key});assert.equal(value.ok,true);
  assert.equal(value.payload.sessionKey,key);assert.equal(value.payload.reasoning.jobs[0].id,'solver-one');assert.equal(value.payload.tier.children.length,1);
  assert.equal(value.payload.tier.children[0].state,'running');assert.equal(value.payload.tier.children[0].model,'qa/selected');assert.equal(value.payload.background.length,1);
  assert.equal(methods.get('pinkie.work.status').options.scope,'operator.admin');assert.equal(methods.get('pinkie.work.detail').options.scope,'operator.admin');
  const other=call('pinkie.work.status',{sessionKey:'agent:learning:two'}).payload;
  assert.equal(other.reasoning.phase,'idle');assert.equal(other.tier.active,false);assert.deepEqual(other.background,[]);
});

test('child results survive reload and neither child nor solver output can be read through another parent',t=>{
  const {architecture,reasoning,call,root}=fixture(t),key='agent:project:one';
  architecture.arm(key,'full');
  const child='agent:project:subagent:worker-one';
  architecture.spawned({childSessionKey:child,label:'solver-1',resolvedModel:'qa/selected'}, {requesterSessionKey:key});
  architecture.ended({targetSessionKey:child,outcome:'ok',resultText:'本次独立解答已按题干逐项核算，十七加二十五等于四十二；采用拆成二十加二十二的方法复核，结果一致。'});
  const row=architecture.status(key).children[0];assert.equal(row.state,'done');assert.equal(row.hasOutput,true);
  assert.match(call('pinkie.work.detail',{sessionKey:key,kind:'child',id:row.id}).payload.output,/四十二/);
  assert.equal(call('pinkie.work.detail',{sessionKey:'agent:project:two',kind:'child',id:row.id}).payload.found,false);
  reasoning.store.set({sessionKey:key,requestId:'review-one',phase:'passed',jobs:[{id:'same-job',output:'only parent one',state:'done'}]});
  assert.equal(call('pinkie.work.detail',{sessionKey:key,kind:'job',id:'same-job'}).payload.output,'only parent one');
  assert.equal(call('pinkie.work.detail',{sessionKey:'agent:project:two',kind:'job',id:'same-job'}).payload.found,false);
  const restored=new ModeArchitecture(new FileRunStore(path.join(root,'runs')));assert.equal(restored.status(key).children[0].state,'done');assert.match(restored.childOutput(key,row.id).output,/四十二/);
});

test('invalid and internal session keys are rejected before any status lookup',t=>{
  const {call}=fixture(t);
  for(const sessionKey of ['', '../one','agent:other:one','agent:learning:subagent:x','agent:learning:internal-session-effects:x']) {
    const value=call('pinkie.work.status',{sessionKey});assert.equal(value.ok,false);assert.equal(value.error.code,'INVALID_REQUEST');
  }
});
