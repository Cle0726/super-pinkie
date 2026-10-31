import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pinkieReconcileOptimisticUser,transformWithStatus} from '../patch/apply-optimistic-user-reconcile.mjs';

test('only a matching send run replaces its text-only optimistic row', () => {
  const sessionKey='agent:learning:dashboard:test';
  const saved=(id,key,text='hello')=>({role:'user',content:text,__openclaw:{id,idempotencyKey:`${key}:user`}});
  const optimistic=(key,text='hello')=>({role:'user',content:[{type:'text',text}],__pinkieOptimisticRunId:key});
  const prior=saved('older','prior'),pending=optimistic('run-1'),durable=saved('new','run-1');
  const state={sessionKey,chatMessages:[prior,pending,durable]},pane={state};
  const fn=vm.runInNewContext(`(${pinkieReconcileOptimisticUser.toString()})`,{pinkieHistoryPane:()=>pane});
  let result=fn(state.chatMessages,{sessionKey});
  assert.equal(result.length,2);assert.equal(result[0],prior);assert.equal(result[1],durable);
  assert.equal(state.chatMessages,result);
  for (const other of [optimistic('other'),{...optimistic('run-1'),content:[{type:'image',url:'test'}]},optimistic('run-1','different')]) {
    state.chatMessages=[other,durable];result=fn(state.chatMessages,{sessionKey});assert.equal(result.length,2);
  }
  state.chatMessages=[optimistic('run-1'),durable];result=fn(state.chatMessages,{sessionKey:'agent:project:another'});assert.equal(result.length,2);
});

test('patch fails closed when the expected send or renderer changes', () => {
  assert.deepEqual(transformWithStatus('unknown'),{changed:false,reason:'unsupported-ui',text:'unknown'});
});
