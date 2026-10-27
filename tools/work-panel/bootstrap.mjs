// Execute the real plugin entry in a private state directory. This catches an
// installed index that imports an engine but forgets to register its UI API.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
if(!process.env.PINKIE_STATE_ROOT || !process.env.OPENCLAW_STATE_DIR || !process.env.PINKIE_LEARNING_WORKSPACE)throw Error('An isolated state root and workspace are required');
const workspace=process.env.PINKIE_LEARNING_WORKSPACE;fs.mkdirSync(workspace,{recursive:true});
const model={id:'fixture-gemini',reasoning:true,compat:{supportedReasoningEfforts:['low','medium','high','xhigh']}};
const config={agents:{defaults:{workspace,model:'qa/fixture-gemini'},list:[{id:'learning',workspace,model:'qa/fixture-gemini'}]},models:{providers:{qa:{models:[model]}}}};
fs.mkdirSync(process.env.OPENCLAW_STATE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.OPENCLAW_STATE_DIR,'openclaw.json'),JSON.stringify(config));
const plugin=(await import(pathToFileURL(process.argv[2]))).default;
function instance(){
 const methods=new Map(),hooks=new Map(),calls=[];
 const api={config,pluginConfig:{},logger:{info(){},warn(){},error(){}},
  runtime:{state:{resolveStateDir:()=>process.env.OPENCLAW_STATE_DIR},config:{current:()=>config},agent:{session:{getSessionEntry:()=>({providerOverride:'qa',modelOverride:model.id})},runEmbeddedAgent:async params=>{calls.push(params);return {payloads:[{text:'42'}]};}}},
  registerGatewayMethod:(name,fn,options)=>methods.set(name,{fn,options}),registerTool(){},registerService(){},registerHttpRoute(){},registerCli(){},registerCommand(){},
  on:(name,fn,options)=>{if(!hooks.has(name))hooks.set(name,[]);hooks.get(name).push({fn,options});},
 };
 plugin.register(api);
 const call=(name,params)=>new Promise((resolve,reject)=>{const entry=methods.get(name);if(!entry)return reject(Error('Missing registration '+name));void entry.fn({params,respond:(ok,value,error)=>ok?resolve(value):reject(Error(error?.message||'RPC error'))});});
 return {api,methods,hooks,calls,call};
}
const gateway=instance(),runtime=instance(),sessionKey='agent:learning:bootstrap-fixture';
for(const name of ['pinkie.work.status','pinkie.work.detail'])assert.equal(gateway.methods.get(name)?.options.scope,'operator.admin');
await gateway.call('pinkie.reasoning.prepare',{sessionKey,requestId:'bootstrap-review-123',level:'max',message:'计算17+25'});
const hook=runtime.hooks.get('before_prompt_build').find(h=>h.options?.priority===-11900);assert.ok(hook);
hook.fn({prompt:'计算17+25',messages:[]},{sessionKey,agentId:'learning'});
let status;
for(let i=0;i<100;i++){status=await gateway.call('pinkie.work.status',{sessionKey});if(status.reasoning.jobs?.filter(j=>j.role==='solver'&&j.state==='done').length===2)break;await new Promise(r=>setTimeout(r,10));}
assert.equal(status.sessionKey,sessionKey);assert.equal(status.reasoning.jobs.length,3);assert.equal(status.reasoning.jobs.filter(j=>j.role==='solver'&&j.state==='done').length,2);
const id=status.reasoning.jobs.find(j=>j.role==='solver').id;
assert.equal((await gateway.call('pinkie.work.detail',{sessionKey,kind:'job',id})).output,'42');
assert.equal((await gateway.call('pinkie.work.detail',{sessionKey:'agent:learning:other',kind:'job',id})).found,false);
await gateway.call('pinkie.reasoning.cancel',{sessionKey});assert.equal((await gateway.call('pinkie.work.status',{sessionKey})).reasoning.phase,'idle');
console.log(JSON.stringify({status:'passed',methods:gateway.methods.size,independentInstances:2,workerRows:3,completedSolvers:2,detailsVerified:true,sessionIsolation:true}));
