// Subject-specific widgets share the existing durable, session-scoped store.
// Definitions are data; answers and model references remain private until check.
import {buildBankPaper, drawBankItems, toExamQuestions} from './learning-zsb.mjs';
export const PRACTICE_KINDS=new Set(['c_program','memory_lab','circuit_lab','network_lab','math_check','english_reading','english_writing','mock_exam','review_queue']);
export const PRACTICE_LABELS={c_program:'C语言练习',memory_lab:'C 指针内存图',circuit_lab:'电路实验',network_lab:'网络实验',math_check:'数学核验',english_reading:'阅读证据练习',english_writing:'英语写作',mock_exam:'限时模拟',review_queue:'错题复习'};
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const clone=value=>structuredClone(value);
const assert=(value,message)=>{if(!value)throw Error(message);};
const numeric=(v,min,max)=>{assert(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,'实验参数超出有效范围');return v;};
const choice=(v,values)=>{assert(values.includes(v),'不支持此选项');return v;};
const normalize=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const DEFAULT_C='#include <stdio.h>\nint main(void) {\n  int values[4] = {2, 4, 6, 8};\n  int sum = 0;\n  int *p = values;\n  for (int i = 0; i < 4; i++) {\n    sum += *(p + i);\n  }\n  printf("%d\\n", sum);\n  return 0;\n}\n';
const mathDefaults={operation:'derivative',expression:'x^3 + 2*x',answer:'',point:'0'};
const circuitDefaults={circuit:'series',voltage:12,r1:1000,r2:2000,capacitance:100,time:.1,supply:12,logic:'and',a:0,b:1};
const networkDefaults={mode:'subnet',ip:'192.168.10.34',prefix:27,gateway:'192.168.10.33',peer:'192.168.10.60',clientVlan:10,peerVlan:10,trunk:true,dhcp:true,dns:true,destination:'peer'};
const id=(v,fallback)=>{const result=text(v||fallback,80);assert(/^[\w:-]+$/.test(result)&&!['__proto__','constructor','prototype'].includes(result),'题目编号不正确');return result;};
function questions(raw) {
  assert(Array.isArray(raw)&&raw.length>0&&raw.length<=150,'模拟卷需要1–150道题');
  const items=raw.map((q,i)=>{
    assert(q&&typeof q==='object'&&text(q.question,8000),'每道题都需要题干');
    const kind=choice(q.kind||'fill_blank',['single_choice','judgement','fill_blank','short_answer']);
    const options=kind==='judgement'?[{id:'true',label:'正确'},{id:'false',label:'错误'}]:(q.options||[]).map((o,j)=>typeof o==='string'?{id:String(j+1),label:text(o,1000)}:{id:id(o.id,j+1),label:text(o.label,1000)});
    if(kind==='single_choice')assert(options.length>=2&&options.length<=8&&new Set(options.map(o=>o.id)).size===options.length,'选择题选项不正确');
    let answer=text(q.correct_answer,4000);
    if(kind==='judgement')answer=answer==='正确'?'true':answer==='错误'?'false':answer;
    if(['single_choice','judgement'].includes(kind))assert(options.some(o=>o.id===answer),'选择题需要正确的选项编号');
    if(kind==='fill_blank')assert(answer||q.accepted_answers?.length,'填空题需要参考答案');
    return {id:id(q.id,`q-${i+1}`),kind,question:text(q.question,8000),subject:text(q.subject,80),options,
      answer,accepted:(Array.isArray(q.accepted_answers)?q.accepted_answers:[]).map(v=>text(v,4000)).slice(0,12),
      explanation:text(q.explanation,4000),points:numeric(q.points??5,.5,100)};
  });
  assert(new Set(items.map(q=>q.id)).size===items.length,'题目编号不能重复');return items;
}
export function sampleExam() {
  return [
    {id:'c1',subject:'C语言',kind:'fill_blank',question:'int a=3; printf("%d",a++); 输出什么？',correct_answer:'3',explanation:'后置自增先使用旧值，再增加1。'},
    {id:'c2',subject:'C语言',kind:'single_choice',question:'int a[3]={2,4,6}; a[1] 的值是？',options:['2','4','6'],correct_answer:'2',explanation:'数组下标从0开始。'},
    {id:'c3',subject:'C语言',kind:'judgement',question:'for循环的条件表达式在每轮循环体执行前检查。',correct_answer:'true',explanation:'for先判断条件，再执行循环体。'},
    {id:'c4',subject:'C语言',kind:'short_answer',question:'解释break与continue在循环中的区别，并各举一例。',explanation:'break退出整个循环；continue进入下一次循环的控制步骤。'},
    {id:'e1',subject:'电工电子',kind:'fill_blank',question:'两个电阻3Ω和6Ω并联，等效电阻是多少Ω？',correct_answer:'2',explanation:'R=3×6/(3+6)=2Ω。'},
    {id:'e2',subject:'电工电子',kind:'single_choice',question:'理想反相比例运放，Rin=10kΩ，Rf=20kΩ，电压增益是多少？',options:['2','-2','0.5'],correct_answer:'2',explanation:'增益为-Rf/Rin=-2。'},
    {id:'e3',subject:'电工电子',kind:'judgement',question:'电容电压在有限电流换路瞬间可以突变。',correct_answer:'false',explanation:'有限电流下电容电压不能突变。'},
    {id:'e4',subject:'电工电子',kind:'fill_blank',question:'R=10kΩ、C=100μF，RC时间常数是多少秒？',correct_answer:'1',explanation:'τ=RC=10000×100×10⁻⁶=1秒。'},
    {id:'n1',subject:'计算机网络',kind:'fill_blank',question:'/26对应的子网掩码是什么？',correct_answer:'255.255.255.192',explanation:'最后一字节前两位置1，即11000000₂=192。'},
    {id:'n2',subject:'计算机网络',kind:'single_choice',question:'自动获取IP失败后出现169.254开头的地址，优先检查哪项服务？',options:['DNS','DHCP','HTTP'],correct_answer:'2',explanation:'DHCP负责动态分配地址。'},
    {id:'n3',subject:'计算机网络',kind:'judgement',question:'TCP提供面向连接的可靠传输服务。',correct_answer:'true',explanation:'TCP通过确认、重传等机制提供可靠传输。'},
    {id:'n4',subject:'计算机网络',kind:'short_answer',question:'同一VLAN的两台电脑不能互通，你会按什么顺序排查？',explanation:'检查物理连接、IP和掩码、接入口VLAN、交换机间trunk及允许列表。'},
  ].map(q=>({...q,points:5}));
}
export function normalizePractice(payload) {
  const kind=payload.kind, spec=payload.visual||{};assert(PRACTICE_KINDS.has(kind),'不支持这种练习');
  let definition;
  if((kind==='c_program'||kind==='memory_lab')){
    const code=String(spec.code??(kind==='memory_lab'?'#include <stdio.h>\nint main(void) {\n  int a[3] = {10, 20, 30};\n  int *p = a;\n  p++;\n  *p = 42;\n  printf("%d\\n", a[1]);\n  return 0;\n}':DEFAULT_C));assert(Buffer.byteLength(code)<=16000,'C代码最多16000字节');
    definition={code,stdin:text(spec.stdin,4000)};
  } else if(kind==='math_check')definition={...mathDefaults,...Object.fromEntries(Object.keys(mathDefaults).filter(k=>spec[k]!==undefined).map(k=>[k,text(spec[k],300)]))};
  else if(kind==='circuit_lab')definition=validateCircuit({...circuitDefaults,...pick(spec,Object.keys(circuitDefaults))});
  else if(kind==='network_lab')definition=validateNetwork({...networkDefaults,...pick(spec,Object.keys(networkDefaults))});
  else if(kind==='english_reading'){
    const passage=text(spec.passage||'Lin studies programming every evening. She tests each program before explaining it to her classmates.',6000);
    const sentences=passage.match(/[^.!?。！？]+[.!?。！？]?/g)?.map(s=>s.trim()).filter(Boolean)||[passage];
    assert(sentences.length<=40,'阅读材料请控制在40句内');
    const qs=questions(spec.questions||[{kind:'single_choice',question:'What does Lin do before explaining a program?',options:['She tests it.','She deletes it.','She copies it.'],correct_answer:'1',explanation:'第二句直接说明她先测试程序。'}]);
    assert(qs.length===1&&qs[0].kind==='single_choice','阅读证据卡每次使用一道选择题');
    const evidence=spec.evidence||[sentences.length-1];
    assert(Array.isArray(evidence)&&evidence.length>0&&evidence.length<=10&&evidence.every(i=>Number.isInteger(i)&&i>=0&&i<sentences.length),'阅读证据需要有效句子序号（从0开始）');
    definition={passage,sentences,question:qs[0],evidence:[...new Set(evidence)]};
  } else if(kind==='english_writing')definition={prompt:text(spec.prompt||payload.question||'Write an email inviting a classmate to a study group. Explain when, where, and what you will study.',4000),minWords:numeric(spec.minWords??80,10,1000),maxWords:numeric(spec.maxWords??120,10,2000)};
  else if(kind==='mock_exam'&&spec.bank){
    // 专升本题库组卷：题目与答案由服务器从本机题库抽取，不经过模型。
    const exclude=payload.__bankExclude instanceof Set?payload.__bankExclude:new Set();
    const paper=spec.bank.paper?buildBankPaper(spec.bank.paper,{seed:spec.bank.seed,exclude}):null;
    const qs=paper?paper.questions:drawBankItems(spec.bank,{exclude}).flatMap(q=>toExamQuestions(q,q.t==='write'?q.pts:{single:4,judge:3,fill:2,app:12.5}[q.t]));
    definition={durationMinutes:numeric(spec.durationMinutes??paper?.durationMinutes??Math.min(180,Math.max(5,qs.length*2)),1,180),questions:questions(qs),origin:text(paper?.origin||'题目来自本机专升本题库与程序生成题，非官方真题',200)};
    if(paper&&!payload.topic)payload={...payload,topic:paper.title};
  }
  else if(kind==='mock_exam')definition={durationMinutes:numeric(spec.durationMinutes??30,1,180),questions:questions(spec.questions||sampleExam()),origin:text(spec.origin||'自编练习，非官方真题',200)};
  else definition={};
  if(kind==='math_check')choice(definition.operation,['derivative','integral','limit','simplify']);
  if(kind==='english_writing')assert(definition.minWords<=definition.maxWords,'字数范围不正确');
  return {kind,title:text(payload.topic||PRACTICE_LABELS[kind],160),definition};
}
const pick=(obj,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(obj,k)).map(k=>[k,obj[k]]));
function validateCircuit(p) {
  choice(p.circuit,['series','parallel','rc','inverting','noninverting','logic']);choice(p.logic,['and','or','xor','nand']);
  numeric(p.voltage,-100,100);numeric(p.r1,1,1e7);numeric(p.r2,1,1e7);numeric(p.capacitance,.001,1e6);numeric(p.time,0,1e5);numeric(p.supply,.1,100);choice(p.a,[0,1]);choice(p.b,[0,1]);return p;
}
export function ipv4(raw) {
  assert(typeof raw==='string'&&/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw),'请输入完整IPv4地址');
  const octets=raw.split('.').map(Number);assert(octets.every(n=>n>=0&&n<=255),'IP地址每段需要0–255');
  return octets.reduce((n,o)=>n*256+o,0);
}
const ipString=n=>[24,16,8,0].map(shift=>Math.floor(n/2**shift)%256).join('.');
function validateNetwork(p) {
  choice(p.mode,['subnet','troubleshoot']);choice(p.destination,['peer','internet','website']);
  ipv4(p.ip);ipv4(p.peer);ipv4(p.gateway);assert(Number.isInteger(p.prefix)&&p.prefix>=1&&p.prefix<=30,'练习前缀长度为1–30；/31、/32用途不同，不套用普通主机公式');
  for(const key of ['clientVlan','peerVlan'])assert(Number.isInteger(p[key])&&p[key]>=1&&p[key]<=4094,'VLAN编号范围为1–4094');
  for(const key of ['trunk','dhcp','dns'])assert(typeof p[key]==='boolean','开关状态不正确');return p;
}
export function subnet(ip,prefix) {
  const value=ipv4(ip);assert(Number.isInteger(prefix)&&prefix>=1&&prefix<=30,'练习前缀长度为1–30');
  const size=2**(32-prefix),network=Math.floor(value/size)*size,broadcast=network+size-1;
  return {network:ipString(network),broadcast:ipString(broadcast),mask:ipString(2**32-size),first:ipString(network+1),last:ipString(broadcast-1),hosts:size-2,validHost:value>network&&value<broadcast};
}
export function circuitResult(p) {
  validateCircuit(p);
  if(p.circuit==='logic'){
    const and=p.a&p.b,output=p.logic==='and'?and:p.logic==='or'?p.a|p.b:p.logic==='xor'?p.a^p.b:1-and;
    return {value:output,unit:'逻辑电平',formula:`${p.logic.toUpperCase()}(${p.a}, ${p.b}) = ${output}`,note:'理想逻辑门模型'};
  }
  if(['inverting','noninverting'].includes(p.circuit)){
    const gain=p.circuit==='inverting'?-p.r2/p.r1:1+p.r2/p.r1,ideal=gain*p.voltage,value=Math.min(p.supply,Math.max(-p.supply,ideal));
    return {value,unit:'V',gain,ideal,formula:p.circuit==='inverting'?'Au = −Rf/Rin':'Au = 1 + Rf/Rg',note:Math.abs(ideal)>p.supply?'输出达到设定电源轨，线性增益公式已超出适用范围。':'理想运放、负反馈、双电源±设定电源轨；真实器件可能提前饱和。'};
  }
  if(p.circuit==='rc'){
    const tau=p.r1*p.capacitance*1e-6;return {value:p.voltage*(1-Math.exp(-p.time/tau)),unit:'V',tau,formula:'Uc(t) = U × (1 − exp(−t/RC))',note:'理想RC充电，初始电容电压为0；C以μF输入。',samples:Array.from({length:61},(_,i)=>({x:tau*5*i/60,y:p.voltage*(1-Math.exp(-5*i/60))}))};
  }
  const resistance=p.circuit==='series'?p.r1+p.r2:p.r1*p.r2/(p.r1+p.r2);
  return {value:p.voltage/resistance*1000,unit:'mA',resistance,voltage1:p.circuit==='series'?p.voltage*p.r1/resistance:p.voltage,formula:p.circuit==='series'?'R = R1 + R2；I = U/R':'R = R1×R2/(R1+R2)；I = U/R',note:'理想电源与理想电阻；数值按当前参数计算。'};
}
export function networkResult(p) {
  validateNetwork(p);const details=subnet(p.ip,p.prefix),peer=subnet(p.peer,p.prefix),gateway=subnet(p.gateway,p.prefix);
  let issue='';
  if(!p.dhcp)issue='DHCP未分配地址（本实验使用自动获取地址）';
  else if(!details.validHost)issue='本机地址是网络地址或广播地址，不能分配给普通主机';
  else if(p.clientVlan!==p.peerVlan&&p.destination==='peer')issue='两端VLAN不同，当前拓扑没有配置VLAN间路由';
  else if(!p.trunk)issue='交换机间链路没有允许当前VLAN通过';
  else if(p.destination==='peer'&&(!peer.validHost||peer.network!==details.network))issue='目标主机不在同一子网，当前拓扑没有目标路由';
  else if(p.destination!=='peer'&&(!gateway.validHost||gateway.network!==details.network))issue='默认网关不在本机子网的有效主机范围内';
  else if(p.destination==='website'&&!p.dns)issue='DNS不可用：IP链路可用，域名解析失败';
  return {...details,reachable:!issue,issue,path:p.destination==='peer'?['本机IP/掩码','接入口VLAN','交换机间链路','目标主机']:['本机IP/掩码','接入口VLAN','交换机间链路','默认网关',...(p.destination==='website'?['DNS解析']:[]),'外网服务'],note:'教学拓扑模拟；不向真实网络发送数据包。外网出口及服务端默认正常。'};
}
export function createPracticeState(normalized,previous) {
  if(previous&&JSON.stringify(previous.definition)===JSON.stringify(normalized.definition))return clone(previous.state);
  const {kind,definition:d}=normalized;
  if((kind==='c_program'||kind==='memory_lab'))return {code:d.code,stdin:d.stdin,prediction:'',result:null,...(kind==='memory_lab'?{traceStep:0}:{})};
  if(kind==='math_check')return {...d,result:null};
  if(kind==='circuit_lab'||kind==='network_lab')return {parameters:clone(d),prediction:'',checked:false,step:0};
  if(kind==='english_reading')return {answer:'',evidence:[],checked:false};
  if(kind==='english_writing')return {draft:'',feedback:null,feedbackRequested:false};
  if(kind==='mock_exam')return {phase:'ready',answers:{},flags:{},selected:d.questions[0].id};
  return {dueOnly:true};
}
export function finishExam(record,now=Date.now(),reason='submitted') {
  const state=clone(record.state);if(state.phase==='submitted')return state;
  const results=record.definition.questions.map(q=>{
    const answer=state.answers[q.id]||'',answered=Boolean(answer.trim());
    const correct=q.kind==='short_answer'?null:[q.answer,...q.accepted].some(expected=>normalize(answer)===normalize(expected));
    return {id:q.id,answer,correct,score:correct===null?answered?null:0:correct?q.points:0,points:q.points,pending:correct===null&&answered,explanation:q.explanation,reference:q.answer,gradeSource:correct===null&&answered?'pending':'deterministic'};
  });
  return {...state,phase:'submitted',submittedAt:now,reason,results};
}
export function savePracticeState(record,patch,now=Date.now()) {
  assert(patch&&typeof patch==='object'&&!Array.isArray(patch),'练习状态格式不正确');
  const next=clone(record.state),kind=record.kind;
  const keys={c_program:['code','stdin','prediction'],memory_lab:['code','stdin','prediction','traceStep'],math_check:['operation','expression','answer','point'],circuit_lab:['parameters','prediction','check','step'],network_lab:['parameters','prediction','check','step'],english_reading:['answer','evidence','check','reset'],english_writing:['draft','requestFeedback'],mock_exam:['start','answers','flags','selected','submit','requestFeedback'],review_queue:['dueOnly']}[kind];
  assert(Object.keys(patch).every(k=>keys.includes(k)),'练习状态包含未知字段');
  if((kind==='c_program'||kind==='memory_lab')||kind==='math_check'){
    for(const [key,value] of Object.entries(patch)){
      if(key==='traceStep') {assert(Number.isInteger(value)&&value>=0&&value<(next.result?.trace?.frames?.length||1),'观察步骤不存在');next.traceStep=value;continue;}
      assert(typeof value==='string'&&value.length<=(key==='code'?16000:key==='stdin'?4000:300),'输入长度或格式不正确');
      if(key==='operation')choice(value,['derivative','integral','limit','simplify']);
      if(value!==next[key])next.result=null;next[key]=value;
    }
  } else if(kind==='circuit_lab'||kind==='network_lab'){
    if(patch.parameters){assert(typeof patch.parameters==='object'&&!Array.isArray(patch.parameters)&&Object.keys(patch.parameters).every(k=>Object.hasOwn(record.definition,k)),'实验参数名称不正确');
      const parameters={...next.parameters,...patch.parameters};(kind==='circuit_lab'?validateCircuit:validateNetwork)(parameters);
      if(JSON.stringify(parameters)!==JSON.stringify(next.parameters))Object.assign(next,{parameters,checked:false,step:0});}
    if(patch.prediction!==undefined){assert(typeof patch.prediction==='string'&&patch.prediction.length<=300,'预测答案最多300字');next.prediction=patch.prediction;next.checked=false;}
    if(patch.check===true){assert(next.prediction.trim(),'先填写预测，再查看计算结果');next.checked=true;}
    if(patch.step!==undefined){assert(Number.isInteger(patch.step)&&patch.step>=0&&patch.step<8,'实验步骤不正确');next.step=patch.step;}
  } else if(kind==='english_reading'){
    if(patch.reset)return {answer:'',evidence:[],checked:false};
    assert(!next.checked,'已核对，请先重新练习');
    if(patch.answer!==undefined){assert(record.definition.question.options.some(o=>o.id===patch.answer),'答案选项不正确');next.answer=patch.answer;}
    if(patch.evidence!==undefined){assert(Array.isArray(patch.evidence)&&patch.evidence.every(i=>Number.isInteger(i)&&i>=0&&i<record.definition.sentences.length),'证据句不正确');next.evidence=[...new Set(patch.evidence)];}
    if(patch.check===true){assert(next.answer&&next.evidence.length,'先选择答案和至少一句原文证据');next.checked=true;}
  } else if(kind==='english_writing'){
    if(patch.draft!==undefined){assert(typeof patch.draft==='string'&&patch.draft.length<=8000,'作文最多8000字');if(next.draft!==patch.draft)Object.assign(next,{draft:patch.draft,feedback:null,feedbackRequested:false});}
    if(patch.requestFeedback){assert(next.draft.trim(),'先写下自己的作文');next.feedbackRequested=true;}
  } else if(kind==='mock_exam'){
    if(next.phase==='submitted'){assert(patch.requestFeedback===true&&Object.keys(patch).length===1,'模拟卷已交卷，不能修改答案');return {...next,feedbackRequested:true};}
    if(patch.start){assert(next.phase==='ready','模拟卷已经开始');Object.assign(next,{phase:'running',startedAt:now,deadline:now+record.definition.durationMinutes*60000});}
    assert(next.phase==='running','先开始模拟卷');assert(now<next.deadline||patch.submit===true,'考试已到时间，请交卷查看结果');
    for(const field of ['answers','flags'])if(patch[field]){
      assert(typeof patch[field]==='object'&&!Array.isArray(patch[field]),'逐题草稿格式不正确');
      for(const [qid,value] of Object.entries(patch[field])){const q=record.definition.questions.find(q=>q.id===qid);assert(q,'题号不存在');
        if(field==='answers'){assert(typeof value==='string'&&value.length<=8000,'答案格式不正确');if(['single_choice','judgement'].includes(q.kind)&&value)assert(q.options.some(o=>o.id===value),'选项不存在');}
        else assert(typeof value==='boolean','标记状态不正确');next[field][qid]=value;}
    }
    if(patch.selected!==undefined){assert(record.definition.questions.some(q=>q.id===patch.selected),'题号不存在');next.selected=patch.selected;}
    if(patch.submit===true)return finishExam({...record,state:next},now,now>=next.deadline?'timeout':'submitted');
  } else if(kind==='review_queue'){if(patch.dueOnly!==undefined){assert(typeof patch.dueOnly==='boolean','筛选状态不正确');next.dueOnly=patch.dueOnly;}}
  return next;
}
export function publicPractice(record,learning) {
  const value=clone(record),{kind,state,definition:d}=value;
  if(kind==='circuit_lab'&&state.checked)value.analysis=circuitResult(state.parameters);
  if(kind==='network_lab'&&state.checked)value.analysis=networkResult(state.parameters);
  if(kind==='english_reading'){
    if(state.checked)value.analysis={correct:state.answer===d.question.answer,evidenceCorrect:d.evidence.every(i=>state.evidence.includes(i))&&state.evidence.every(i=>d.evidence.includes(i)),referenceEvidence:d.evidence,explanation:d.question.explanation};
    delete d.evidence;delete d.question.answer;delete d.question.accepted;delete d.question.explanation;
  }
  if(kind==='mock_exam'){
    if(state.phase!=='submitted')for(const q of d.questions){delete q.answer;delete q.accepted;delete q.explanation;}
    else {const pending=state.results.filter(r=>r.pending);value.analysis={earned:state.results.reduce((sum,r)=>sum+(r.score||0),0),total:d.questions.reduce((sum,q)=>sum+q.points,0),pending:pending.length,pendingPoints:pending.reduce((sum,r)=>sum+r.points,0)};}
  }
  if(kind==='review_queue'){
    const now=Date.now(),all=learning.allAttempts(record.sessionKey).filter(a=>a.result?.correct===false&&!a.verifiedBy);
    const due=all.filter(a=>Number(a.nextRetestAt||0)<=now),selected=(state.dueOnly?due:all).sort((a,b)=>(a.nextRetestAt||0)-(b.nextRetestAt||0));
    value.analysis={total:all.length,due:due.length,items:selected.slice(0,30).map(a=>learning.publicAttempt(a)),hasMore:selected.length>30};
  }
  return value;
}
export function applyPracticeFeedback(record,payload) {
  const next=clone(record.state);assert(next.feedbackRequested,'请先在卡片中请求批改');
  if(record.kind==='english_writing'){
    assert(payload.draft===next.draft,'作文已修改，请针对当前草稿重新批改');
    const changes=(Array.isArray(payload.changes)?payload.changes:[]).slice(0,15).map(change=>({quote:text(change.quote,1000),proposal:text(change.proposal,1000),reason:text(change.reason,1000)}));
    assert(changes.every(c=>c.quote&&next.draft.includes(c.quote)),'修改引用必须来自当前作文原文');
    next.feedback={summary:text(payload.feedback,4000),changes,kind:'model-reference',at:Date.now()};next.feedbackRequested=false;
  }else if(record.kind==='mock_exam'){
    assert(next.phase==='submitted','请先交卷');assert(Array.isArray(payload.item_results)&&payload.item_results.length>0,'需要逐题提供评分');
    for(const raw of payload.item_results){const result=next.results.find(r=>r.id===raw.item_id);assert(result&&result.pending,'只能批改待评的主观题');assert(raw.answer===result.answer,'作答已变化');numeric(raw.score,0,result.points);result.score=raw.score;result.feedback=text(raw.feedback,3000);result.pending=false;result.gradeSource='model-reference';}
    next.feedbackRequested=false;
  }else throw Error('这张练习无需模型批改');
  return next;
}
