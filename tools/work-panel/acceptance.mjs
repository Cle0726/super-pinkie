// Real production panel and aggregation API, controlled execution adapter.
// Synthetic stores live outside ~/.openclaw; no user messages or tasks run here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const modules=process.env.PINKIE_WORK_MODULE_ROOT || path.join(repo,'services/mode-architecture');
const ui=process.env.PINKIE_WORK_UI || path.join(repo,'ui/injections');
const assets=path.join(repo,'ui/assets');
const out=process.env.PINKIE_WORK_OUTPUT || path.join(os.tmpdir(),'pinkie-work-panel-acceptance');fs.mkdirSync(out,{recursive:true});
const {ReasoningEnhancer,ReviewStore,registerReasoningGateway}=await import(pathToFileURL(path.join(modules,'reasoning.mjs')));
const {ModeArchitecture,FileRunStore}=await import(pathToFileURL(path.join(modules,'index.mjs')));
const {registerWorkGateway}=await import(pathToFileURL(path.join(modules,'work-status.mjs')));
const {BackgroundJobs}=await import(pathToFileURL(path.join(modules,'background-jobs.mjs')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-work-panel-'));
const keys={A:'agent:learning:panel-A',B:'agent:learning:panel-B',C:'agent:project:panel-C',D:'agent:thinking:panel-D'};
const methods=new Map(),pending=[],gates=new Map(),rpcCalls=[],errors=[];
const model={id:'fixture-gemini',reasoning:true,compat:{supportedReasoningEfforts:['low','medium','high','xhigh']}};
const api={config:{agents:{defaults:{workspace:root,model:'qa/fixture-gemini'}},models:{providers:{qa:{models:[model]}}}},runtime:{agent:{session:{getSessionEntry:()=>({modelOverride:model.id,providerOverride:'qa'})},runEmbeddedAgent:params=>new Promise((resolve,reject)=>{
 const sessionKey=Object.values(keys).find(key=>params.prompt.includes(key));
 if(!sessionKey){reject(Error('No isolated parent for execution'));return;}
 const row={sessionKey,role:/独立解题助手/.test(params.prompt)?'solver':'critic',params,resolve,reject,state:'running'};pending.push(row);
 params.abortSignal?.addEventListener('abort',()=>{row.state='cancelled';reject(Error('isolated execution cancelled'));},{once:true});
})}},on(){},registerGatewayMethod:(name,fn)=>methods.set(name,fn)};
const store=new ReviewStore(path.join(root,'reviews'));
const engine=registerReasoningGateway(api,new ReasoningEnhancer(api,{store}));
const architecture=new ModeArchitecture(new FileRunStore(path.join(root,'runs')));
const background=new BackgroundJobs({alive:()=>true,pollMs:60000});
registerWorkGateway(api,{reasoning:engine,architecture,background});
methods.set('pinkie.deepThink.status',({params,respond})=>respond(true,architecture.status(params.sessionKey)));
async function rpc(method,params){
 if(!Object.values(keys).includes(params?.sessionKey))throw Error('Only isolated fixture sessions are allowed');
 rpcCalls.push({method,sessionKey:params.sessionKey,at:Date.now()});
 const handler=methods.get(method);if(!handler)throw Error('Unknown method '+method);
 const result=await new Promise((resolve,reject)=>{void handler({params,respond:(ok,payload,error)=>ok?resolve(payload):reject(Error(error?.message||'RPC failed'))});});
 const gate=gates.get(method+'|'+params.sessionKey);
 if(gate){gates.delete(method+'|'+params.sessionKey);gate.received=true;await new Promise(resolve=>gate.release=resolve);}
 return result;
}
async function start(name){
 const sessionKey=keys[name],message=sessionKey+'。计算17+25，只回答数字。';
 engine.cancel({sessionKey});await engine.prepare({sessionKey,requestId:'panel-'+randomUUID(),level:'max',message});
 engine.beforePromptBuild({prompt:message,messages:[]},{sessionKey});
 return {sessionKey};
}
function release(name,role,fail=false){
 const row=pending.find(p=>p.sessionKey===keys[name]&&p.role===role&&p.state==='running');if(!row)throw Error('No pending '+name+' '+role);
 row.state=fail?'failed':'done';if(fail)row.reject(Error('测试分支失败'));else row.resolve({payloads:[{text:role==='solver'?'42':'{"pass":true,"issues":[]}'}]});
}
async function control(input){
 const name=input.name||'A',sessionKey=keys[name];
 if(input.action==='start')return start(name);
 if(input.action==='solver'){release(name,'solver',Boolean(input.fail));return {ok:true};}
 if(input.action==='finish-main'){void engine.agentEnded({success:true,messages:[{role:'assistant',content:'42'}]},{sessionKey}).catch(e=>errors.push(String(e)));return {ok:true};}
 if(input.action==='critic'){release(name,'critic');return {ok:true};}
 if(input.action==='extras'){
  architecture.arm(sessionKey,'full');architecture.spawned({childSessionKey:sessionKey+':worker',label:'solver-1',resolvedModel:'qa/fixture-gemini'},{requesterSessionKey:sessionKey});
  architecture.ended({targetSessionKey:sessionKey+':worker',outcome:'ok',resultText:'这是实际子代理钩子记录的测试结果：十七加二十五等于四十二，已经按二十加二十二的拆分方法复核，两个计算结果完全一致。'});
  background.afterTool({toolName:'exec',params:{command:'isolated-build',background:true},result:'Command still running (session isolated-process, pid 999999)'},{sessionKey});
  return {ok:true};
 }
 if(input.action==='fixed-id'){
  store.set({sessionKey,requestId:'isolated-fixed-'+name,tier:'max',level:'max',phase:'passed',jobs:[{id:'shared-id',role:'solver',label:'独立解答 '+name,state:'done',endedAt:Date.now(),output:'结果仅属于会话 '+name,summary:'会话 '+name+' 的结果'}]});return {ok:true};
 }
 if(input.action==='gate') {gates.set(input.method+'|'+sessionKey,{method:input.method,sessionKey,received:false,release:null});return {ok:true};}
 if(input.action==='ungate') {for(const gate of gates.values())gate.release?.();for(const gate of inflightGates)gate.release?.();return {ok:true};}
 if(input.action==='oracle')return {pending:pending.filter(p=>p.state==='running').map(p=>({sessionKey:p.sessionKey,role:p.role})),cancelled:pending.filter(p=>p.state==='cancelled'&&p.sessionKey===keys.C).length,rpcCalls,gates:inflightGates.map(g=>({method:g.method,sessionKey:g.sessionKey,received:g.received})),errors};
 throw Error('Unknown isolated action');
}
const inflightGates=[];
// Preserve a reference after rpc() removes a gate from the next-request map.
const originalSet=gates.set.bind(gates);gates.set=(key,gate)=>{inflightGates.push(gate);return originalSet(key,gate);};
const html=name=>`<!doctype html><html data-laolao-mode="${name==='C'?'project':name==='D'?'thinking':'learning'}"><meta charset="utf-8"><title>工作面板 · 隔离联调</title><link rel="stylesheet" href="/asset/laolao-theme.css"><style>body{margin:0;background:#fcf5fa;color:#543c58;font:14px/1.6 system-ui}main{max-width:760px;margin:auto;padding:24px}h1{font-size:18px}p{font-size:12px}.agent-chat__composer-shell{position:fixed;left:24px;right:24px;bottom:48px;min-height:52px;padding:12px;border:1px solid #ba8eac;border-radius:18px;background:#fff8fc}.agent-chat__composer-actions{position:fixed;bottom:16px;left:24px;right:24px;display:flex;gap:8px}html[data-pinkie-night] body{background:#211a29;color:#f6e4f0}#switches{display:flex;gap:6px}</style><main><h1>工作面板 · 隔离联调</h1><p>实际前端、聚合接口与任务存储；执行由可控适配器驱动，不是用户 App 主窗口。</p><div id="switches">${Object.keys(keys).map(k=>'<button data-session="'+k+'">会话 '+k+'</button>').join('')}<button id="theme">切换日夜</button></div></main><div class="agent-chat__composer-shell"><span>会话 ${name} 的独立输入区</span></div><div class="agent-chat__composer-actions"></div><script>const keys=${JSON.stringify(keys)};window.__laolaoSidebar={gwRequest:async(method,params)=>{const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});const value=await r.json();if(value.error)throw Error(value.error);return value;}};document.querySelector('#switches').onclick=e=>{const name=e.target.dataset.session;if(!name)return;const key=keys[name];history.pushState({},'','/?session='+encodeURIComponent(key));document.querySelector('.agent-chat__composer-shell span').textContent='会话 '+name+' 的独立输入区';document.documentElement.setAttribute('data-laolao-mode',name==='C'?'project':name==='D'?'thinking':'learning');window.dispatchEvent(new CustomEvent('pinkie:session-selected',{detail:{sessionKey:key}}));};document.querySelector('#theme').onclick=()=>document.documentElement.toggleAttribute('data-pinkie-night');</script><script src="/asset/laolao-deep-think.js"></script>`;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');
 try{
  if(url.pathname.startsWith('/asset/')){const file=path.basename(url.pathname),p=fs.existsSync(path.join(ui,file))?path.join(ui,file):path.join(assets,file);if(!/^laolao-[\w-]+\.(?:js|css|webm|png)$/.test(file)||!fs.existsSync(p)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webm')?'video/webm':'image/png');return res.end(fs.readFileSync(p));}
  if(req.method==='POST') {let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw Error('request too large');}const p=JSON.parse(body);const value=url.pathname==='/rpc'?await rpc(p.method,p.params):await control(p);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(value));}
  const name=Object.entries(keys).find(([,key])=>key===url.searchParams.get('session'))?.[0]||'A';res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html(name));
 }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:String(error.message||error)}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
fs.writeFileSync(path.join(out,'endpoint.json'),JSON.stringify({base,url:base+'/?session='+encodeURIComponent(keys.A),modules,ui},null,2));
if(!process.argv.includes('--test'))console.log(base+'/?session='+encodeURIComponent(keys.A));
else{
 const require=createRequire(import.meta.url);const {chromium,webkit}=require('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const report={status:'pending',engines:{},scope:'Actual production panel + aggregation + execution engines; isolated controlled execution adapter'};
 const qa=async body=>{const r=await fetch(base+'/qa',{method:'POST',body:JSON.stringify(body)});const data=await r.json();if(data.error)throw Error(data.error);return data;};
 const waitGate=async(method,key)=>{const end=Date.now()+8000;while(Date.now()<end){if((await qa({action:'oracle'})).gates.some(g=>g.method===method&&g.sessionKey===key&&g.received))return;await new Promise(r=>setTimeout(r,25));}throw Error('The controlled response gate was not reached');};
 try{
  for(const [name,type] of Object.entries({chromium,webkit})){
   for(const [letter,key] of Object.entries(keys))keys[letter]=key.split(':panel-')[0]+':panel-'+name+'-'+letter+'-'+randomUUID().slice(0,8);
   const browser=await type.launch(name==='chromium'?{channel:'chrome',headless:true}:{headless:true});const page=await browser.newPage({viewport:{width:1000,height:800}});
   const row=report.engines[name]={checks:[],errors:[]};page.on('pageerror',e=>row.errors.push(String(e)));
   try{
    await qa({action:'start'});await page.goto(base+'/?session='+encodeURIComponent(keys.A));
    await page.locator('#pinkie-work-panel:not([hidden])').waitFor();
    await page.locator('.pinkie-work__pill').click();await page.locator('.pinkie-work__row').nth(2).waitFor();
    assert.equal(await page.locator('.pinkie-work__row').count(),3);row.checks.push('真实引擎启动后显示主回答及两份独立解答，胶囊展开可见逐项状态');
    await qa({action:'solver'});await page.locator('.pinkie-work__row[data-has-output="1"]').waitFor();
    await page.locator('.pinkie-work__row[data-has-output="1"]').click();await page.waitForFunction(()=>document.querySelector('.pinkie-work__detail')?.textContent==='42');row.checks.push('点击已完成的真实任务读取存储结果');
    await qa({action:'solver',fail:true});await page.locator('.pinkie-work__row[data-state="failed"]').waitFor();row.checks.push('失败分支显示失败，不伪装完成');
    await qa({action:'finish-main'});await page.waitForFunction(()=>document.querySelector('.pinkie-work__title')?.textContent.includes('批评'));
    await qa({action:'critic'});await page.waitForFunction(()=>document.querySelector('.pinkie-work__title')?.textContent.includes('通过'));row.checks.push('主回答→批评→通过的实际状态流可见');
    await qa({action:'extras'});await page.waitForFunction(()=>document.querySelector('.pinkie-work__rows')?.textContent.includes('后台命令'));assert.ok((await page.locator('.pinkie-work__rows').innerText()).includes('Fixture Gemini'));row.checks.push('四档子代理钩子与后台命令进入同一面板');
    if(name==='chromium'){await page.locator('#pinkie-work-panel').screenshot({path:path.join(out,'panel-day.png')});await page.locator('#theme').click();await page.locator('#pinkie-work-panel').screenshot({path:path.join(out,'panel-night.png')});}
    await page.getByRole('button',{name:'会话 B',exact:true}).click();assert.equal(await page.locator('#pinkie-work-panel').isVisible(),false);assert.equal(await page.locator('#laolao-deep-think-status').isVisible(),false);row.checks.push('切会话立即隐藏新面板和旧四档胶囊');
    await qa({action:'gate',name:'A',method:'pinkie.work.status'});await page.getByRole('button',{name:'会话 A',exact:true}).click();
    await waitGate('pinkie.work.status',keys.A);
    await page.getByRole('button',{name:'会话 B',exact:true}).click();await qa({action:'ungate'});await page.waitForTimeout(200);assert.equal(await page.locator('#pinkie-work-panel').isVisible(),false);row.checks.push('旧会话迟到状态不能恢复已隐藏面板');
    await qa({action:'fixed-id',name:'A'});await qa({action:'fixed-id',name:'B'});
    await page.getByRole('button',{name:'会话 A',exact:true}).click();await page.locator('#pinkie-work-panel:not([hidden])').waitFor();await page.locator('.pinkie-work__pill').click();
    await qa({action:'gate',name:'A',method:'pinkie.work.detail'});await page.locator('.pinkie-work__row[data-id="shared-id"]').click();
    await waitGate('pinkie.work.detail',keys.A);
    await page.getByRole('button',{name:'会话 B',exact:true}).click();await page.locator('#pinkie-work-panel:not([hidden])').waitFor();await page.locator('.pinkie-work__pill').click();await page.locator('.pinkie-work__row[data-id="shared-id"]').click();
    await page.waitForFunction(()=>document.querySelector('.pinkie-work__detail')?.textContent==='结果仅属于会话 B');await qa({action:'ungate'});await page.waitForTimeout(200);assert.equal(await page.locator('.pinkie-work__detail').innerText(),'结果仅属于会话 B');row.checks.push('重名任务 ID 的迟到详情不能覆盖新会话结果');
    for(let i=0;i<20;i++)await page.getByRole('button',{name:'会话 '+(i%2?'B':'A'),exact:true}).click();assert.equal(await page.locator('#pinkie-work-panel').count(),1);row.checks.push('快速往返切换保持单一实例且不继承展开状态');
    await page.getByRole('button',{name:'会话 C',exact:true}).click();assert.equal(await page.locator('#pinkie-work-panel').isVisible(),false);await qa({action:'start',name:'C'});await page.locator('#pinkie-work-panel:not([hidden])').waitFor();assert.equal(await page.locator('#pinkie-work-panel').getAttribute('data-session-key'),keys.C);row.checks.push('切换模式也只显示新模式当前会话');
    await page.locator('.pinkie-work__pill').click();await page.getByRole('button',{name:'停止核对',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#pinkie-work-panel')?.hidden);assert.ok((await qa({action:'oracle'})).cancelled>=2);row.checks.push('停止入口真正取消执行适配器中的独立任务');
    await page.setViewportSize({width:360,height:800});await page.getByRole('button',{name:'会话 B',exact:true}).click();await page.locator('#pinkie-work-panel:not([hidden])').waitFor();await page.waitForFunction(()=>{const box=document.querySelector('#pinkie-work-panel')?.getBoundingClientRect();return box&&box.left>=0&&box.right<=innerWidth;});const bounds=await page.locator('#pinkie-work-panel').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=360);row.checks.push('360px 内面板不越界');
    await page.setViewportSize({width:1000,height:800});await qa({action:'start',name:'D'});
    await page.evaluate(src=>{const frame=document.createElement('iframe');frame.id='secondary-panel';frame.src=src;frame.style.cssText='width:480px;height:500px';document.querySelector('main').append(frame);},base+'/?session='+encodeURIComponent(keys.D));
    const side=page.frameLocator('#secondary-panel');await side.locator('#pinkie-work-panel:not([hidden])').waitFor();
    assert.equal(await side.locator('#pinkie-work-panel').getAttribute('data-session-key'),keys.D);assert.equal(await page.locator('#pinkie-work-panel').getAttribute('data-session-key'),keys.B);
    await side.getByRole('button',{name:'会话 C',exact:true}).click();assert.equal(await side.locator('#pinkie-work-panel').isVisible(),false);assert.equal(await page.locator('#pinkie-work-panel').getAttribute('data-session-key'),keys.B);row.checks.push('模式双开文档各自持有当前会话；副窗切换不影响主窗任务');
    await page.locator('#secondary-panel').evaluate(frame=>frame.remove());
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const beforeCalls=(await qa({action:'oracle'})).rpcCalls.filter(c=>c.method==='pinkie.work.status'&&c.sessionKey===keys.B);
    await page.evaluate(()=>{const root=document.createElement('div');document.body.append(root);for(let i=0;i<2000;i++){const n=document.createElement('span');n.textContent='流式片段 '+i;root.append(n);}root.remove();});
    const afterCalls=(await qa({action:'oracle'})).rpcCalls.filter(c=>c.method==='pinkie.work.status'&&c.sessionKey===keys.B).slice(Math.max(0,beforeCalls.length-1));for(let i=1;i<afterCalls.length;i++)assert.ok(afterCalls[i].at-afterCalls[i-1].at>=850);row.checks.push('2000 次流式 DOM 变化不会造成状态查询风暴');
    assert.deepEqual(row.errors,[]);
   }finally{for(const key of Object.values(keys))engine.cancel({sessionKey:key});for(const gate of inflightGates)gate.release?.();background.jobs.clear();if(background.shared.timer){clearInterval(background.shared.timer);background.shared.timer=null;}await browser.close();}
  }
  report.status='passed';
 }catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'browser-acceptance.json'),JSON.stringify(report,null,2));server.close();fs.rmSync(root,{recursive:true,force:true});}
 console.log(JSON.stringify(report,null,2));
}
