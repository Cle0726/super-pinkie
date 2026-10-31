import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LearningInteractionStore,createLearningActivityTool,registerLearningGateway,learningPrompt} from '../services/mode-architecture/learning.mjs';
import net from 'node:net';import {spawnSync} from 'node:child_process';
import {PRACTICE_KINDS,circuitResult,subnet,networkResult,DEFAULT_C} from '../services/mode-architecture/learning-practice.mjs';
import {runLearningCompute} from '../services/mode-architecture/learning-compute.mjs';
const key='agent:learning:practice-qa';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-practice-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const opts={root:path.join(root,'state'),workspace:path.join(root,'workspace')};return {root,opts,store:new LearningInteractionStore(opts)};}
const save=(store,r,state)=>store.visuals.save(key,{id:r.id,revision:r.revision,state});

test('all subject tools expose valid inline references and persist without enabling quiz or pretending mastery',async t=>{
 const {store,opts}=fixture(t),tool=createLearningActivityTool(store,{sessionKey:key});store.setEnabled(key,false);
 for(const kind of PRACTICE_KINDS){const response=await tool.execute('call-'+kind,{action:'present',kind,visual:{}});assert.equal(response.isError,false,response.details?.error);const {visual,inline}=response.details;assert.equal(inline.kind,kind);assert.equal(new LearningInteractionStore(opts).inline(key,visual.id,kind).visual.id,visual.id);}
 assert.equal(store.status(key).enabled,false);assert.equal(store.listAttempts(key).total,0);assert.match(learningPrompt(store,key),/不伪造|不要伪造/);
});
test('circuit calculations use actual parameters and honor model limits',t=>{
 const {store}=fixture(t);let r=store.present(key,{kind:'circuit_lab',visual:{}}).visual;
 assert.throws(()=>save(store,r,{check:true}),/预测/);r=save(store,r,{prediction:'4mA',check:true});assert.equal(store.visuals.public(r).analysis.value,4);
 r=save(store,r,{parameters:{circuit:'parallel'}});assert.equal(r.state.checked,false);assert.equal(store.visuals.public(r).analysis,undefined);
 r=save(store,r,{check:true});assert.ok(Math.abs(store.visuals.public(r).analysis.value-18)<1e-10);
 const p={...r.state.parameters,circuit:'inverting',voltage:10,r1:1000,r2:2000,supply:12};const saturated=circuitResult(p);assert.equal(saturated.ideal,-20);assert.equal(saturated.value,-12);assert.match(saturated.note,/超出/);
 const rc=circuitResult({...p,circuit:'rc',r1:10000,capacitance:100,time:1});assert.equal(rc.tau,1);assert.ok(Math.abs(rc.value-10*(1-Math.exp(-1)))<1e-10);
 assert.throws(()=>save(store,r,{parameters:{r1:0}}));assert.equal(store.visuals.get(key,r.id).state.parameters.r1,1000);
});
test('subnet arithmetic rejects special prefixes and network lab derives faults rather than model text',t=>{
 const a=subnet('192.168.10.34',27);assert.deepEqual([a.network,a.broadcast,a.mask,a.hosts],['192.168.10.32','192.168.10.63','255.255.255.224',30]);assert.equal(subnet('192.168.10.32',27).validHost,false);
 for(const [ip,prefix] of [['300.1.1.1',24],['10.0.0.1',31],['10.0.0.1',32]])assert.throws(()=>subnet(ip,prefix));
 const {store}=fixture(t);let r=store.present(key,{kind:'network_lab',visual:{mode:'troubleshoot'}}).visual;assert.equal(networkResult(r.state.parameters).reachable,true);
 r=save(store,r,{prediction:'能通',check:true});assert.equal(store.visuals.public(r).analysis.reachable,true);
 r=save(store,r,{parameters:{peerVlan:20}});r=save(store,r,{check:true});assert.match(store.visuals.public(r).analysis.issue,/VLAN/);
 const website={...r.state.parameters,peerVlan:10,destination:'website',dns:false};assert.match(networkResult(website).issue,/DNS/);assert.match(networkResult({...website,dns:true,gateway:'192.168.20.1'}).issue,/网关/);
});
test('reading keeps model references private until both answer and evidence are submitted',t=>{
 const {store,opts}=fixture(t);let r=store.present(key,{kind:'english_reading',visual:{}}).visual;
 assert.doesNotMatch(JSON.stringify(r),/"answer":"1"|第二句直接|"referenceEvidence"/);
 assert.throws(()=>save(store,r,{answer:'1',check:true}),/至少一句/);
 r=save(store,r,{answer:'1',evidence:[1]});assert.equal(new LearningInteractionStore(opts).inline(key,r.id,r.kind).visual.state.evidence[0],1);
 r=save(store,r,{check:true});const publicValue=store.visuals.public(r);assert.equal(publicValue.analysis.correct,true);assert.equal(publicValue.analysis.evidenceCorrect,true);
 assert.throws(()=>save(store,r,{answer:'2'}),/重新练习/);r=save(store,r,{reset:true});assert.equal(store.visuals.public(r).analysis,undefined);
});
test('writing feedback requires an explicit request and quotes the exact saved draft',t=>{
 const {store}=fixture(t);let r=store.present(key,{kind:'english_writing',visual:{}}).visual;r=save(store,r,{draft:'I has a book.'});
 assert.throws(()=>store.visuals.feedback(key,r.id,{draft:'I has a book.',feedback:'review'}),/先在卡片/);
 r=save(store,r,{requestFeedback:true});assert.throws(()=>store.visuals.feedback(key,r.id,{draft:'old draft',feedback:'review'}),/已修改/);
 assert.throws(()=>store.visuals.feedback(key,r.id,{draft:r.state.draft,changes:[{quote:'invented',proposal:'A',reason:'B'}]}),/真实|原文/);
 r=store.visuals.feedback(key,r.id,{draft:r.state.draft,feedback:'检查主谓一致',changes:[{quote:'has',proposal:'have',reason:'I搭配have'}]});assert.equal(r.state.feedback.kind,'model-reference');
 r=save(store,r,{draft:'I have a book.'});assert.equal(r.state.feedback,null);assert.equal(r.state.feedbackRequested,false);assert.equal(store.listAttempts(key).total,0);
});
test('server-timed exam drafts survive reload, answers remain hidden and objective scores cannot be overwritten',t=>{
 const {store,opts}=fixture(t);let r=store.present(key,{kind:'mock_exam',visual:{durationMinutes:1,questions:[{id:'a',kind:'fill_blank',question:'2+2?',correct_answer:'4',points:2,explanation:'PRIVATE feedback'},{id:'b',kind:'short_answer',question:'解释',points:3,explanation:'PRIVATE rubric'}]}}).visual;
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE|"answer":"4"/);r=save(store,r,{start:true});const deadline=r.state.deadline;r=save(store,r,{answers:{a:'4',b:'my explanation'},flags:{b:true}});
 const restarted=new LearningInteractionStore(opts);assert.equal(restarted.inline(key,r.id,r.kind).visual.state.deadline,deadline);
 r=save(restarted,r,{submit:true});assert.equal(restarted.visuals.public(r).analysis.earned,2);assert.equal(restarted.visuals.public(r).analysis.pending,1);
 assert.throws(()=>save(restarted,r,{answers:{a:'5'}}),/已交卷/);r=save(restarted,r,{requestFeedback:true});
 assert.throws(()=>restarted.visuals.feedback(key,r.id,{item_results:[{item_id:'a',answer:'4',score:0}]}),/只能批改/);
 r=restarted.visuals.feedback(key,r.id,{item_results:[{item_id:'b',answer:'my explanation',score:2,feedback:'参考评分'}]});assert.equal(restarted.visuals.public(r).analysis.earned,4);assert.equal(restarted.visuals.public(r).analysis.pending,0);
});
test('deadline cannot be extended or bypassed by a late answer or a stale save',t=>{
 const {store}=fixture(t);let r=store.present(key,{kind:'mock_exam',visual:{durationMinutes:1}}).visual;r=save(store,r,{start:true});
 const file=store.visuals.file(key,r.id);const raw=JSON.parse(fs.readFileSync(file));raw.state.deadline=Date.now()-1;fs.writeFileSync(file,JSON.stringify(raw));
 const timed=store.visuals.get(key,r.id);assert.equal(timed.state.phase,'submitted');assert.equal(timed.state.reason,'timeout');assert.equal(timed.state.results[0].score,0);
 assert.throws(()=>save(store,r,{answers:{c1:'3'},submit:true}),/已更新|已交卷/);assert.equal(store.visuals.get(key,r.id).state.answers.c1,undefined);
 assert.throws(()=>save(store,timed,{deadline:Date.now()+60000}),/未知/);
});
test('review queue uses actual scoped attempts, separates due dates, and does not add its own evidence',t=>{
 const {store}=fixture(t);store.setEnabled(key,true);const q=store.present(key,{kind:'fill_blank',question:'2+2?',correct_answer:'4'}).current;store.submit(key,{activityId:q.id,answer:'5',hintUsed:true});store.resolve(key,{activity_id:q.id,feedback:'加法出错',error_type:'计算失误'});
 let r=store.present(key,{kind:'review_queue',visual:{}}).visual;assert.equal(r.analysis.total,1);assert.equal(r.analysis.due,0);assert.equal(r.analysis.items.length,0);
 r=save(store,r,{dueOnly:false});assert.equal(store.visuals.public(r).analysis.items[0].answerText,'5');assert.equal(store.visuals.public(r).analysis.items[0].hintUsed,true);
 assert.equal(store.listAttempts(key).total,1);assert.throws(()=>store.inline('agent:learning:other',r.id,r.kind),/不存在/);
});
test('practice gateway keeps compute explicit and new state mutations session fenced',async t=>{
 const {store}=fixture(t),methods=new Map();registerLearningGateway({registerGatewayMethod(n,h){methods.set(n,h);}},store);
 const rpc=(method,params)=>new Promise((resolve,reject)=>methods.get(method)({params,respond(ok,value,error){ok?resolve(value):reject(Error(error.message));}}));
 const opened=await rpc('pinkie.learning.practice.open',{sessionKey:key,kind:'c_program'});assert.equal(opened.visual.state.result,null);
 assert.ok((await rpc('pinkie.learning.practice.list',{sessionKey:key})).items.some(item=>item.id===opened.visual.id));
 await assert.rejects(rpc('pinkie.learning.practice.run',{sessionKey:'agent:learning:other',id:opened.visual.id,revision:1}),/不存在/);
});
test('real Clang output agrees with supported array, pointer and loop trace', {skip:process.platform!=='darwin'},async()=>{
 const r=await runLearningCompute('c_program',{code:DEFAULT_C,stdin:''});assert.equal(r.stdout,'20\n');assert.equal(r.exitCode,0);assert.equal(r.trace.verifiedOutput,true);assert.equal(r.trace.frames.at(-1).variables.find(v=>v.name==='sum').value,20);
 const unsupported=await runLearningCompute('c_program',{code:'#include <stdio.h>\nint f(){return 3;} int main(){printf("%d",f());}',stdin:''});assert.equal(unsupported.stdout,'3');assert.equal(unsupported.trace.verifiedOutput,false);
});
test('C runtime denies owned external reads/writes, subprocesses and networking; caps CPU/output', {skip:process.platform!=='darwin'},async t=>{
 const {root}=fixture(t),secret=path.join(root,'canary'),target=path.join(root,'written');fs.writeFileSync(secret,'OWNED_CANARY');
 const q=JSON.stringify;
 let connected=false;const server=net.createServer(socket=>{connected=true;socket.destroy();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const code=`#include <stdio.h>\n#include <stdlib.h>\n#include <sys/socket.h>\n#include <arpa/inet.h>\nint main(){FILE *f=fopen(${q(secret)},"r");printf("read=%d\\n",f!=NULL);FILE*w=fopen(${q(target)},"w");printf("write=%d\\n",w!=NULL);printf("exec=%d\\n",system("/bin/echo unexpected"));int s=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_port=htons(${server.address().port});inet_pton(AF_INET,"127.0.0.1",&a.sin_addr);printf("connect=%d\\n",connect(s,(struct sockaddr*)&a,sizeof(a)));return 0;}`;
 const r=await runLearningCompute('c_program',{code,stdin:''});assert.equal(r.exitCode,0,r.stderr);assert.match(r.stdout,/read=0/);assert.match(r.stdout,/write=0/);assert.doesNotMatch(r.stdout,/unexpected/);assert.match(r.stdout,/connect=-1/);assert.equal(connected,false);assert.equal(fs.existsSync(target),false);
 const output=await runLearningCompute('c_program',{code:'#include <stdio.h>\nint main(){for(;;)puts("bounded-output");}',stdin:''});assert.ok(output.stdout.length<=16000);assert.notEqual(output.exitCode,0);
 const loop=await runLearningCompute('c_program',{code:'int main(){for(;;){}}',stdin:''});assert.notEqual(loop.exitCode,0);
});
const mathPython=process.env.PINKIE_LEARNING_PYTHON||path.join(os.homedir(),'.openclaw/pinkie-learning-runtime/bin/python3');
const hasMathRuntime=fs.existsSync(mathPython)&&spawnSync(mathPython,['-I','-c','import sympy'],{timeout:10000}).status===0;
test('SymPy uses bounded AST parsing, checks derivatives/primitives and refuses missing two-sided limits',{skip:hasMathRuntime?false:'Optional local SymPy runtime is not installed'},async()=>{
 const r=await runLearningCompute('math_check',{operation:'derivative',expression:'x^3+2*x',answer:'3*x^2+2'});assert.equal(r.matches,true);
 const integral=await runLearningCompute('math_check',{operation:'integral',expression:'2*x',answer:'x^2+3'});assert.equal(integral.matches,true);
 const limit=await runLearningCompute('math_check',{operation:'limit',expression:'1/x',point:'0'});assert.equal(limit.status,'two-sided-limit-missing');
 await assert.rejects(runLearningCompute('math_check',{operation:'simplify',expression:'__import__("os").getcwd()'}),/仅支持/);
});

test('practice drafts survive definition replacement and feedback retries are idempotent',t=>{
 const {store}=fixture(t);let r=store.present(key,{activity_id:'draft',kind:'english_writing',visual:{prompt:'Write a letter'}}).visual;
 r=save(store,r,{draft:'I has a book.'});
 assert.throws(()=>store.present(key,{activity_id:r.id,kind:r.kind,visual:{prompt:'Replace with another task'}}),/原草稿保持原样/);
 r=save(store,r,{requestFeedback:true});
 const payload={__toolCallId:'feedback-1',draft:'I has a book.',feedback:'主谓一致',changes:[{quote:'has',proposal:'have',reason:'搭配I'}]};
 r=store.visuals.feedback(key,r.id,payload);const revision=r.revision;
 assert.equal(store.visuals.feedback(key,r.id,payload).revision,revision);
 r=save(store,r,{draft:'I have a book.'});
 assert.equal(store.visuals.feedback(key,r.id,payload).state.draft,'I have a book.');
 assert.equal(store.visuals.feedback(key,r.id,payload).state.feedback,null);
});
