// Real Gemini 3.8 run of app_browser with site memory, against Codex's round-7
// pages and native WKWebView host. Pass 1 is a first visit (empty memory);
// pass 2 is a new session on the same pages with new values, where the saved
// steps should let the model replay instead of exploring.
// Launched by NativeBrowserAgentHost (PINKIE_BROWSER_QA_DIR = this folder).
import fs from 'node:fs';
import {createAppBrowserTool,requestAppBrowser,BrowserSiteMemory} from '../../services/mode-architecture/app-browser.mjs';
const out=new URL('./',import.meta.url),base=process.env.PINKIE_BROWSER_QA_BASE;
const config=JSON.parse(fs.readFileSync('/Users/Admin/.openclaw/openclaw.json','utf8')),provider=config.models.providers.mm;
const environment={...process.env},memoryFile=new URL('site-memory.json',out).pathname;
fs.rmSync(memoryFile,{force:true});
const memory=new BrowserSiteMemory(memoryFile);
const report={status:'running',model:'gemini-3.8-flash-tiered',base,startedAt:new Date().toISOString(),passes:[],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}};
let current;
const servers={memory,async request(action,params,opts){
 if(action==='eval')return {ok:false,reason:'本验收要求真实控件操作，不允许eval。'};
 if(action==='open'&&!String(params.url||'').startsWith(base+'/'))return {ok:false,reason:'本验收只访问独立测试端口。'};
 const started=Date.now();const response=await requestAppBrowser(action,params,{...opts,environment});
 current.actions.push({action,params:{...params},ok:response.ok,elapsedMs:Date.now()-started,...(!response.ok?{reason:response.reason}:{})});return response;
}};
// Codex's system prompt, unchanged, so the comparison only measures the tool.
const system='你正在验收碧琪的内置悬浮浏览器操控。仅访问用户指定的隔离端口。只能调用app_browser操作真实控件，禁止eval和执行脚本，禁止通过修改页面源码伪造结果。普通控件优先ref/role/name；滑杆优先set_slider并检查返回的实际数值；悬停和拖拽使用专用动作。已有操作后observation时直接利用，避免无效重复snapshot。失败先观察已完成部分，不能盲目重放提交动作。同页已明确的连续动作可使用batch。完成后用简短中文报告你实际观察到的结果。';
const passes=[
 {name:'首次访问',values:{freq:73,note:'广西专升本验收',value:'42'}},
 {name:'再次访问',values:{freq:58,note:'第二次验收',value:'57'}},
];
const scenarios=v=>[
 {name:'表单点击与精确滑杆',url:'form.html',goal:`将课程改为数字电路，频率滑杆设为${v.freq}，备注填写“${v.note}”，点击保存参数，只保存一次。核对最终数值和保存次数。`,verify:q=>q&&q.saves===1&&q.result?.course==='digital'&&q.result?.frequency===v.freq&&q.result?.note===v.note&&q.sliderTrusted===true},
 {name:'悬停菜单与Canvas拖拽',url:'lab.html',goal:'悬停“高级实验”展开菜单，点击打开画布，将实验画布中心的节点拖到右边目标区，再点击检查结果。确认页面显示检查通过。',verify:q=>q&&q.opened&&q.aligned&&q.moves>3&&q.trusted===true&&q.checks===1},
 {name:'长表格内部定位',url:'table.html',goal:`在参数表中找到第38项，将该行参数改为${v.value}，点击该行的保存按钮，只保存一次。不要让整个网页滚动；只操作表格内部。核对保存结果。`,verify:q=>q&&q.saves===1&&q.item===38&&q.value===v.value&&q.pageScrollY===0&&q.tableScroll>0},
];
const write=()=>fs.writeFileSync(new URL('gemini-memory-acceptance.json',out),JSON.stringify(report,null,2));
try{
 for(const [passIndex,pass] of passes.entries()){
  const entry={name:pass.name,cases:[]};report.passes.push(entry);
  for(const scene of scenarios(pass.values).filter(x=>!process.env.PINKIE_QA_ONLY||x.url===process.env.PINKIE_QA_ONLY)){
   const sessionKey=`agent:learning:browser-memory-qa-${passIndex}-${scene.url}`;
   const tool=createAppBrowserTool({sessionKey},{servers});
   current={name:scene.name,sessionKey,startedAt:new Date().toISOString(),actions:[],rounds:[],status:'running'};entry.cases.push(current);write();
   const messages=[{role:'system',content:system},{role:'user',content:`打开 ${base}/${scene.url} 。任务：${scene.goal}`}];
   const started=Date.now();
   for(let round=0;round<14;round++){
    const t=Date.now();const response=await fetch(provider.baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+provider.apiKey},body:JSON.stringify({model:report.model,messages,tools:[{type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters}}],tool_choice:'auto',parallel_tool_calls:false,max_tokens:3000,temperature:0.1}),signal:AbortSignal.timeout(60000)});
    const data=await response.json();if(!response.ok)throw new Error('Gemini HTTP '+response.status+' '+JSON.stringify(data.error||'').slice(0,300));
    for(const k of Object.keys(report.usage))report.usage[k]+=Number(data.usage?.[k]||0);
    const msg=data.choices?.[0]?.message;if(!msg)throw new Error('Gemini did not return an assistant message');
    current.rounds.push({round,model:data.model,latencyMs:Date.now()-t,toolCalls:(msg.tool_calls||[]).map(x=>({name:x.function?.name,arguments:x.function?.arguments})),...(msg.tool_calls?.length?{}:{final:msg.content})});write();
    messages.push({role:'assistant',content:msg.content||null,...(msg.tool_calls?.length?{tool_calls:msg.tool_calls}:{})});
    if(!msg.tool_calls?.length){current.final=msg.content;break;}
    for(const call of msg.tool_calls){
     let result;
     try{const params=JSON.parse(call.function.arguments);result=call.function.name===tool.name?await tool.execute(call.id,params):{isError:true,content:[{type:'text',text:'只能使用app_browser'}]};}
     catch(e){result={isError:true,content:[{type:'text',text:String(e.message)}]};}
     current.rounds.at(-1).results=(current.rounds.at(-1).results||[]).concat([{ok:!result.isError,known:!!result.details?.known,remembered:result.details?.remembered?.id,reason:result.details?.reason}]);
     messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result.details||result.content)});
    }
    write();
   }
   // What the gateway's agent_end hook does: keep an unsaved successful trail.
   memory.flush(sessionKey);
   const oracle=await requestAppBrowser('qa-oracle',{},{environment,timeoutMs:15000});
   current.actual=oracle.result;current.elapsedMs=Date.now()-started;
   current.status=scene.verify(oracle.result)?'passed':'failed';
   current.toolCalls=current.rounds.flatMap(r=>r.toolCalls.map(c=>JSON.parse(c.arguments||'{}').action));
   current.nativeActionMs=current.actions.reduce((n,a)=>n+a.elapsedMs,0);current.modelWaitMs=current.rounds.reduce((n,r)=>n+r.latencyMs,0);
   write();console.log(JSON.stringify({pass:pass.name,name:scene.name,status:current.status,rounds:current.rounds.length,calls:current.toolCalls,elapsedMs:current.elapsedMs}));
  }
 }
 report.memory=JSON.parse(fs.readFileSync(memoryFile,'utf8'));
 report.status=report.passes.every(p=>p.cases.every(x=>x.status==='passed'))?'passed':'failed';
}catch(e){report.status='failed';report.error=String(e.stack||e.message);if(current)current.status='failed';}
report.completedAt=new Date().toISOString();write();
console.log(JSON.stringify({status:report.status,usage:report.usage}));
