import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, createLearningActivityTool, registerLearningGateway, learningPrompt} from '../services/mode-architecture/learning.mjs';
import {mapReduceData} from '../services/mode-architecture/learning-labs.mjs';
const key='agent:learning:round2';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-labs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const options={root:path.join(root,'state'),workspace:path.join(root,'workspace')};return {store:new LearningInteractionStore(options),options};}
const sentence=()=>({kind:'sentence_parse',topic:'主干和定语从句',visual:{sentence:'The book that I read is useful.',segments:[
 {id:'subject',text:'The book ',role:'subject',explanation:'PRIVATE 主语解析'},
 {id:'clause',text:'that I read ',role:'clause',accepted_roles:['modifier'],explanation:'PRIVATE 从句解析',referent:'that指代The book'},
 {id:'predicate',text:'is ',role:'predicate',explanation:'PRIVATE 谓语解析'},
 {id:'complement',text:'useful.',role:'complement',explanation:'PRIVATE 表语解析'},
]}});
const lab=()=>({kind:'mapreduce_lab',topic:'词频',visual:{input:'hello hello hadoop',workers:2}});

test('sentence drafts and public RPC responses conceal the demonstration until the student checks',async t=>{
 const {store,options}=fixture(t);const tool=createLearningActivityTool(store,{sessionKey:key});
 const shown=(await tool.execute('parse-one',{action:'present',...sentence()})).details;
 assert.equal(shown.inline.kind,'sentence_parse');assert.doesNotMatch(JSON.stringify(shown),/PRIVATE|acceptedRoles|"role":/);
 const id=shown.visual.id;assert.throws(()=>store.visuals.save(key,{id,revision:1,state:{check:true}}),/先标注/);
 const methods=new Map();registerLearningGateway({registerGatewayMethod(n,h){methods.set(n,h)}},store,{});
 const rpc=(method,params)=>new Promise((resolve,reject)=>methods.get(method)({params,respond(ok,value,error){ok?resolve(value):reject(Error(error.message))}}));
 const saved=await rpc('pinkie.learning.inline.save',{sessionKey:key,id,revision:1,state:{labels:{subject:'subject',clause:'modifier'}}});
 assert.doesNotMatch(JSON.stringify(saved),/PRIVATE|acceptedRoles|"role":/);
 const restarted=new LearningInteractionStore(options);assert.equal(restarted.inline(key,id,'sentence_parse').visual.state.labels.clause,'modifier');
 const checked=await rpc('pinkie.learning.inline.save',{sessionKey:key,id,revision:2,state:{check:true}});
 assert.equal(checked.visual.analysis.correct,2);assert.equal(checked.visual.analysis.total,4);assert.match(JSON.stringify(checked),/PRIVATE/);
 assert.throws(()=>store.visuals.save(key,{id,revision:3,state:{labels:{subject:'object'}}}),/不能改写/);
 assert.equal(store.listAttempts(key).attempts.length,0,'annotation comparison never fabricates question/mastery evidence');
 const reset=await rpc('pinkie.learning.inline.save',{sessionKey:key,id,revision:3,state:{reset:true}});assert.doesNotMatch(JSON.stringify(reset),/PRIVATE|acceptedRoles|"role":/);
});

test('sentence definitions must cover the actual original and invalid writes are atomic and session scoped',t=>{
 const {store}=fixture(t);assert.throws(()=>store.present(key,{...sentence(),visual:{...sentence().visual,sentence:'Different sentence'}}),/完整对应/);
 for(const id of ['__proto__','constructor'])assert.throws(()=>store.present(key,{...sentence(),visual:{segments:[{id,text:'A ',role:'subject'},{id:'b',text:'works.',role:'predicate'}]}}),/编号/);
 const shown=store.present(key,sentence()).visual;
 assert.throws(()=>store.visuals.save(key,{id:shown.id,revision:1,state:{labels:{subject:'subject',missing:'clause'}}}),/无效/);
 assert.deepEqual(store.visuals.get(key,shown.id).state.labels,{});
 assert.throws(()=>store.inline('agent:learning:other',shown.id,'sentence_parse'),/不存在/);
 assert.throws(()=>store.visuals.save(key,{id:shown.id,revision:1,state:{html:'<script>bad</script>'}}),/未知/);
});

test('MapReduce lab computes actual data, validates grouping, persists phases, and does not grade',t=>{
 const {store,options}=fixture(t);const shown=store.present(key,lab()).visual;let record=shown;
 const data=mapReduceData(record.state.input,2);assert.deepEqual(data.output,[{key:'hadoop',count:1},{key:'hello',count:2}]);
 assert.equal(data.pairs[0].bucket,data.pairs[1].bucket);
 const wrong=Object.fromEntries(data.pairs.map(pair=>[pair.id,(pair.bucket+1)%2]));
 record=store.visuals.save(key,{id:record.id,revision:record.revision,state:{phase:'shuffle',assignments:wrong}});
 assert.throws(()=>store.visuals.save(key,{id:record.id,revision:record.revision,state:{phase:'reduce'}}),/先按key/);
 assert.equal(store.visuals.get(key,record.id).state.phase,'shuffle');
 record=store.visuals.save(key,{id:record.id,revision:record.revision,state:{assignments:Object.fromEntries(data.pairs.map(p=>[p.id,p.bucket])),phase:'reduce'}});
 const restored=new LearningInteractionStore(options).inline(key,record.id,'mapreduce_lab').visual;assert.equal(restored.state.phase,'reduce');
 assert.match(learningPrompt(store,key),/"count":2/);assert.equal(store.listAttempts(key).attempts.length,0);
 assert.throws(()=>store.visuals.save(key,{id:record.id,revision:record.revision,state:{input:'hello',assignments:{'pair-2':0}}}),/不正确/);
 assert.equal(store.visuals.get(key,record.id).state.input,'hello hello hadoop');
 record=store.visuals.save(key,{id:record.id,revision:record.revision,state:{input:'a a b'}});assert.deepEqual(record.state.assignments,{});assert.equal(record.state.phase,'input');
 record=store.visuals.save(key,{id:record.id,revision:record.revision,state:{demonstrate:true,phase:'reduce'}});assert.equal(record.state.usedDemo,true);
});

test('MapReduce limits and private revisions reject invalid or stale input',t=>{
 const {store}=fixture(t);assert.throws(()=>mapReduceData('word '.repeat(81)),/1–80/);
 for(const workers of [0,5,2.5])assert.throws(()=>store.present(key,{...lab(),visual:{input:'hello',workers}}),/1–4/);
 const record=store.present(key,lab()).visual;
 assert.throws(()=>store.visuals.save(key,{id:record.id,revision:0,state:{phase:'map'}}),/已更新/);
 assert.throws(()=>store.visuals.save(key,{id:record.id,revision:1,state:{assignments:{'pair-0':3}}}),/不正确/);
});

test('step solutions enforce order and preserve one auditable attempt per checkpoint',t=>{
 const {store}=fixture(t);store.setEnabled(key,true);
 const current=store.present(key,{kind:'step_solution',question:'解 2x+2=10',items:[
  {id:'step-1',kind:'fill_blank',question:'移项后2x等于多少？',correct_answer:'8'},
  {id:'step-2',kind:'fill_blank',question:'两边除以2，x等于多少？',correct_answer:'4'},
 ]}).current;
 assert.equal(current.presentation,'step_solution');
 assert.throws(()=>store.submit(key,{activityId:current.id,itemId:'step-2',answer:'4'}),/先完成/);assert.equal(store.listAttempts(key).attempts.length,0);
 store.submit(key,{activityId:current.id,itemId:'step-1',answer:'8'});
 assert.throws(()=>store.submit(key,{activityId:current.id,itemId:'step-2',answer:'4'}),/先完成/);
 store.resolve(key,{activity_id:current.id,item_results:[{item_id:'step-1',correct:true,explanation:'10−2=8'}]});
 store.submit(key,{activityId:current.id,itemId:'step-2',answer:'4'});store.resolve(key,{activity_id:current.id,item_results:[{item_id:'step-2',correct:true,explanation:'8÷2=4'}]});
 assert.equal(store.status(key).current.result.correct,true);assert.equal(store.listAttempts(key).attempts.length,2);
});

test('comparison quotes use only the actual submitted answer and cannot rewrite deterministic grading',t=>{
 const {store}=fixture(t);store.setEnabled(key,true);const current=store.present(key,{kind:'fill_blank',question:'2+2?',correct_answer:'4'}).current;
 store.submit(key,{activityId:current.id,answer:'我算得 5'});
 store.resolve(key,{activity_id:current.id,correct:true,comparison:[{answer_quote:'我算得 5',expected:'2+2=4',reason:'把加法结果核对一遍'},{answer_quote:'凭空捏造的学生回答',expected:'不要伪造回答',reason:'合成验收'}]});
 const result=store.status(key).current.result;assert.equal(result.correct,false);assert.equal(result.comparison[0].quote,'我算得 5');assert.equal(result.comparison[1].quote,'');
});

test('bound diagram references validate the actual library page range',t=>{
 const {store}=fixture(t);store.library={get(id){if(id!=='book-1')throw Error('不存在');return {locations:3}}};
 const record=store.present(key,{...lab(),sources:[{bookId:'book-1',location:2,title:'合成讲义',quote:'MapReduce'}]}).visual;assert.equal(record.sources[0].location,2);
 assert.throws(()=>store.present(key,{...lab(),sources:[{bookId:'book-1',location:4}]}),/范围内/);
 assert.throws(()=>store.present(key,{...lab(),sources:[{bookId:'invented',location:1}]}),/不存在/);
});
